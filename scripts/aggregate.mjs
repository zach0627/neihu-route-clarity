import { createReadStream } from 'node:fs';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateRecords, buildRankings, buildObservedRankings, buildCongestionRankings, representativeDirections, weekdaysBetween, recentCalendarRange, taipeiMinute, EXPECTED_MINUTES, CONGESTED_LEVELS, SEVERE_LEVEL, SPEED_WINDOW_MINUTES } from '../lib/ranking.mjs';
import { classifyLink, parkDistance, parkStretches, sliceLine, parseAddress, matchRange, distanceMeters } from '../lib/park.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const HISTORICAL_BASE = 'https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic';
const BOUNDARY_NOTE = '以臺北時間 07:00 ≤ DataCollectTime < 09:30 篩選 150 個分鐘標記。官方時間戳記代表統計區間起點或終點尚待確認，實際邊界可能差一分鐘。';
const QUALITY_RULE = '逐分鐘保守篩選：Status=0、動態車道數與當日靜態 LaneNum 相符、ActualLaneNum 若提供也須相符、車道與車種無重複、Volume 為非負整數、所有車道 ErrorDiags 只有 diag0。僅使用通過分鐘的實測車次，不補零、不插值；異常旗標不等於已證明流量錯誤。';

async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function readJsonl(path) {
  const records = [];
  let lineNumber = 0;
  for await (const raw of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    lineNumber += 1;
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line) continue;
    try { records.push(JSON.parse(line)); }
    catch { throw new Error(`JSONL 第 ${lineNumber} 行無法解析，整日未納入`); }
  }
  return records;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function apiUrl(date, live) {
  return `${HISTORICAL_BASE}/${live ? 'Live/' : ''}VD/City/Taipei?Dates=${date}&%24format=JSONL&%24top=${live ? 2000000 : 2000}`;
}

function safeSourceUrl(value, fallback) {
  try {
    const parsed = new URL(value);
    if (parsed.origin !== 'https://tdx.transportdata.tw') return fallback;
    const allowed = new URL(parsed.origin + parsed.pathname);
    for (const key of ['Dates', '$format', '$top', '$skip']) if (parsed.searchParams.has(key)) allowed.searchParams.set(key, parsed.searchParams.get(key));
    return allowed.toString();
  } catch { return fallback; }
}

const categoryText = (radius) => ({
  entering: `入園路段：官方路段終點在園區內道路區段 ${radius} 公尺內、起點不在，車輛沿此路段抵達園區。`,
  internal: `園區內路段：官方路段起點與終點都在園區內道路區段 ${radius} 公尺內，車輛已在園區道路上。`,
  leaving: `出園路段：官方路段起點在園區內道路區段 ${radius} 公尺內、終點不在，車輛正離開園區，不列入往園區排名。`,
  outside: `園區外或邊界路段：官方路段起點與終點都不在園區內道路區段 ${radius} 公尺內（只有單側屬園區的邊界道路也在此類），無法由道路幾何確認車輛會進入園區，不列入往園區排名。`,
  expressway: '市區快速道路或匝道（官方道路分類）：主線車流須經匝道與平面道路才能抵達園區，平面道路另有偵測器；不列入往園區排名。',
});

/** Geometry scope from official link endpoints and geocoded official park addresses; manual entries may only add documented overrides. */
function buildGeography(reference, boundary) {
  if (!reference?.links?.length) return null;
  const rule = boundary?.scopeRule;
  const ranges = boundary?.ranges ?? reference.boundary?.ranges ?? [];
  const roads = [...new Set(ranges.map((range) => range.road))];
  // Acceptance is re-derived from the returned address so a range correction never depends on a stale flag.
  const points = (reference.geocodes ?? []).flatMap((item) => {
    const parsed = item.lon != null ? parseAddress(item.matchedAddress, roads) : null;
    const range = matchRange(parsed, ranges);
    return range ? [{ lon: item.lon, lat: item.lat, road: range.road, parity: range.parity, range, number: parsed.lane ?? parsed.number, query: item.query, matchedAddress: item.matchedAddress }] : [];
  });
  const stretches = parkStretches(reference.parkRoads ?? [], points, ranges);
  if (!points.length || !stretches.length) return null;
  const radius = rule?.radiusMeters ?? 80;
  const excluded = new Set(rule?.excludeRoadClasses ?? [2, 7]);
  const include = new Set(rule?.include ?? ['entering', 'internal']);
  const text = categoryText(radius);
  const sectionByLink = new Map();
  for (const section of reference.sections ?? []) for (const linkId of section.LinkIDs ?? []) sectionByLink.set(linkId, section);
  const links = new Map(reference.links.map((link) => {
    const category = excluded.has(link.RoadClass) ? 'expressway' : classifyLink(link.StartPoint, link.EndPoint, stretches, radius);
    const section = sectionByLink.get(link.LinkID);
    const levelId = section?.CongestionLevelID ?? `RoadClass${link.RoadClass}_default`;
    const levels = reference.congestionLevels?.find((item) => item.CongestionLevelID === levelId) ?? null;
    const shape = (reference.linkShapes?.[link.LinkID] ?? [link.StartPoint, link.EndPoint]).map(([lon, lat]) => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
    return [link.LinkID, { linkId: link.LinkID, roadClass: link.RoadClass, roadClassName: link.RoadClassName, length: link.Length, start: link.StartPoint, end: link.EndPoint, shape, category, categoryText: text[category], included: include.has(category), startDistance: Math.round(parkDistance(link.StartPoint, stretches).distance), endDistance: Math.round(parkDistance(link.EndPoint, stretches).distance), sectionId: section?.SectionID ?? null, congestionLevelId: levels ? levelId : null, congestionLevelBasis: section?.CongestionLevelID ? '臺北市發布路段指定的壅塞水準組別' : '無發布路段，採同道路分類的預設組別', levels: levels?.Levels ?? null }];
  }));
  return { radius, excludedRoadClasses: [...excluded], points, stretches, rejected: (reference.geocodes ?? []).length - points.length, links, include: [...include] };
}

function resolveScope(config, geography, vdId, linkId) {
  const entries = Array.isArray(config?.directions) ? config.directions : [];
  const entry = entries.find((item) => (item.id === `${vdId}:${linkId}`) || (item.vdId === vdId && item.linkId === linkId));
  const priority = {
    ...(Number.isFinite(entry?.representativePriority) ? { representativePriority: entry.representativePriority } : {}),
    ...(entry?.representative === true ? { representative: true } : {}),
  };
  const geometry = geography?.links.get(linkId);
  if (geometry) {
    const { levels, categoryText: text, ...evidence } = geometry;
    const override = entry?.override;
    const reason = `${text}起點距園區內道路區段約 ${geometry.startDistance} 公尺、終點約 ${geometry.endDistance} 公尺。`;
    return { scope: override ? { included: override.included === true, status: 'override', reason: `${override.reason}（幾何判定：${reason}）`, category: geometry.category } : { included: geometry.included, status: 'geometry', reason, category: geometry.category }, geometry: evidence, ...priority };
  }
  if (!entry) return { scope: { included: false, status: 'proposed', reason: '尚未確認此測點方向是否朝內湖科技園區，暫不納入排名。' } };
  return { scope: { included: entry.included === true, status: entry.status ?? 'proposed', reason: entry.reason ?? '方向範圍待核對。' }, ...priority };
}

/** Where the park reaches, from the official addresses only: extreme addresses, size, one-sided boundary roads and road-label anchors. */
function describeExtent(geography, ranges, directions, parkRoads) {
  const points = geography?.points ?? [];
  if (!points.length) return null;
  const pick = (better) => points.reduce((best, point) => (better(point, best) ? point : best));
  const asPlace = ({ matchedAddress, lat, lon }) => ({ address: matchedAddress.replace(/^台北市/, '臺北市'), lat, lon });
  const north = pick((a, b) => a.lat > b.lat), south = pick((a, b) => a.lat < b.lat), east = pick((a, b) => a.lon > b.lon), west = pick((a, b) => a.lon < b.lon);
  const parityName = { odd: '單號', even: '雙號', all: '全部' };
  const byRoad = new Map();
  for (const range of ranges) byRoad.set(range.road, [...(byRoad.get(range.road) ?? []), range]);
  const rangeText = (range) => `${parityName[range.parity]}${range.from != null ? ` ${range.from}${range.to != null ? `–${range.to}` : ''} 號${range.to == null ? '以後' : ''}` : range.laneFrom != null ? ` ${range.laneFrom} 巷以後` : range.parity === 'all' ? '' : '全部'}`;
  const boundaryRoads = [...byRoad].filter(([, list]) => new Set(list.map((range) => range.parity)).size === 1 && list[0].parity !== 'all').map(([road, list]) => ({ road, side: parityName[list[0].parity], text: list.map(rangeText).join('、') }));
  // Label each nearby road at its official geometry point closest to the road's centre within the park's bounding box.
  const margin = 0.0015;
  const inBox = ([lon, lat]) => lon >= west.lon - margin && lon <= east.lon + margin && lat >= south.lat - margin && lat <= north.lat + margin;
  const lines = new Map();
  const addLine = (road, shape) => { if (shape?.length) lines.set(road, [...(lines.get(road) ?? []), ...shape.filter(inBox)]); };
  for (const road of parkRoads ?? []) for (const link of road.links) addLine(road.road, link.shape);
  for (const direction of directions) addLine(direction.roadName, direction.geometry?.shape);
  const labels = [...lines].filter(([, shape]) => shape.length).map(([road, shape]) => {
    const centre = [shape.reduce((sum, p) => sum + p[0], 0) / shape.length, shape.reduce((sum, p) => sum + p[1], 0) / shape.length];
    const [lon, lat] = shape.reduce((best, p) => (Math.hypot(p[0] - centre[0], p[1] - centre[1]) < Math.hypot(best[0] - centre[0], best[1] - centre[1]) ? p : best));
    return { road, lon, lat, boundary: boundaryRoads.some((item) => item.road === road || item.road.startsWith(road)) };
  });
  return { north: asPlace(north), south: asPlace(south), east: asPlace(east), west: asPlace(west), northSouthKm: Math.round(distanceMeters([north.lon, north.lat], [north.lon, south.lat]) / 10) / 100, eastWestKm: Math.round(distanceMeters([west.lon, west.lat], [east.lon, west.lat]) / 10) / 100, boundaryRoads, labels };
}

/** Official section minute levels for one date, keyed by SectionID then Taipei minute-of-day. */
async function readOfficialSections(root, date) {
  const manifest = await optionalJson(join(root, 'research', `${date}-section-manifest.json`));
  if (manifest?.status !== 'completed') return null;
  const path = join(root, 'research', `${date}-section-live-morning.jsonl`);
  if (await sha256(path) !== manifest.morningFileSHA256) throw new Error('官方發布路段快取 SHA-256 與下載紀錄不符，整日未納入。');
  const bySection = new Map();
  for (const row of await readJsonl(path)) {
    const time = taipeiMinute(row.DataCollectTime);
    if (!time?.inWindow || time.date !== date) continue;
    if (!bySection.has(row.SectionID)) bySection.set(row.SectionID, new Map());
    bySection.get(row.SectionID).set(time.minute, { level: Number(row.CongestionLevel), speed: Number(row.TravelSpeed) });
  }
  return { bySection, source: { date, url: manifest.sourceUrl, file: `research/${manifest.morningFile}`, sha256: manifest.morningFileSHA256, sourceRecords: manifest.sourceRecords, morningRecords: manifest.morningRecords } };
}

/** Reproducible derived snapshot; this function never reads process.env or credential files. */
export async function buildSnapshot({ root = PROJECT_ROOT, start = recentCalendarRange().start, end = recentCalendarRange().end } = {}) {
  const requestedDates = weekdaysBetween(start, end);
  const config = await optionalJson(join(root, 'config/directions.json'));
  const reference = await optionalJson(join(root, 'data/reference.json'));
  const boundaryConfig = await optionalJson(join(root, 'config/park-boundary.json'));
  const companyConfig = await optionalJson(join(root, 'config/companies.json'));
  const holidayConfig = await optionalJson(join(root, 'config/holidays.json'));
  const geography = buildGeography(reference, boundaryConfig);
  const officialSources = [];
  const officialMissing = [];
  const availableDates = [];
  const failedDates = [];
  const pendingDates = [];
  const sources = [];
  const directionsById = new Map();
  const dailyStats = [];
  let sample = null;
  for (const date of requestedDates) {
    const staticFile = `${date}-taipei-vd-static.jsonl`;
    const morningFile = `${date}-neihu-morning.jsonl`;
    const staticPath = join(root, 'research', staticFile);
    const morningPath = join(root, 'research', morningFile);
    const manifest = await optionalJson(join(root, 'research', `${date}-download-manifest.json`));
    const failedDownload = await optionalJson(join(root, 'research', `${date}-download-error.json`));
    if (manifest?.date !== date || manifest?.download?.status !== 'completed') {
      if (failedDownload && failedDownload.status !== 'deferred') failedDates.push({ date, reason: failedDownload.reason ?? '下載失敗，尚未取得完成的快取。' });
      else pendingDates.push({ date, reason: failedDownload?.reason ?? '尚待下載完成並寫入當日完成紀錄。' });
      continue;
    }
    try {
      // Finish all filesystem checks before committing any date or derived observations.
      const [morningSHA256, staticSHA256, morningStat] = await Promise.all([
        sha256(morningPath), sha256(staticPath), stat(morningPath),
      ]);
      if (manifest.staticFileSHA256 !== undefined && manifest.staticFileSHA256 !== staticSHA256) throw new Error('靜態快取 SHA-256 與下載完成紀錄不符，整日未納入。');
      if (manifest.morningFileSHA256 !== undefined && manifest.morningFileSHA256 !== morningSHA256) throw new Error('早尖峰快取 SHA-256 與下載完成紀錄不符，整日未納入。');
      const hasBothHashes = manifest.staticFileSHA256 !== undefined && manifest.morningFileSHA256 !== undefined;
      const allStatic = await readJsonl(staticPath);
      const staticVDs = allStatic.filter((vd) => vd.TownName === '內湖區');
      if (staticVDs.length === 0) throw new Error('靜態資料沒有內湖區測點，無法建立當日分析');
      const staticIds = new Set(staticVDs.map((vd) => vd.VDID));
      if (staticIds.size !== staticVDs.length) throw new Error('同日靜態測點 VDID 重複，需先核對設備資料');
      const records = await readJsonl(morningPath);
      if (records.length === 0) throw new Error('早尖峰快取沒有紀錄');
      let official = null;
      try { official = await readOfficialSections(root, date); }
      catch (error) { officialMissing.push({ date, reason: error.message }); }
      if (!official && !officialMissing.some((item) => item.date === date)) officialMissing.push({ date, reason: '尚未下載官方發布路段歷史資料（npm run data:sections）。' });
      const linkOf = (id) => id.slice(id.indexOf(':') + 1);
      const results = aggregateRecords(records, staticVDs, date, {
        levelsFor: (id) => geography?.links.get(linkOf(id))?.levels ?? null,
        officialFor: (id) => { const sectionId = geography?.links.get(linkOf(id))?.sectionId; return sectionId ? official?.bySection.get(sectionId) ?? null : null; },
      });
      if (!results.some((result) => result.receivedMinutes > 0)) throw new Error('快取沒有符合當日內湖區測點的早尖峰紀錄，整日未納入。');
      const staticById = new Map(staticVDs.map((vd) => [vd.VDID, vd]));
      const dayDirections = new Map();
      let daySample = null;
      for (const vd of staticVDs) {
        for (const link of vd.DetectionLinks ?? []) {
          const id = `${vd.VDID}:${link.LinkID}`;
          const existing = directionsById.get(id);
          const direction = existing
            ? { ...existing, days: [...existing.days] }
            : { id, vdId: vd.VDID, linkId: link.LinkID, roadName: vd.RoadName, bearing: link.Bearing, roadDirection: link.RoadDirection, position: { lat: vd.PositionLat, lon: vd.PositionLon }, laneCount: link.LaneNum, actualLaneCount: link.ActualLaneNum ?? null, ...resolveScope(config, geography, vd.VDID, link.LinkID), days: [] };
          dayDirections.set(id, direction);
        }
      }
      for (const result of results) {
        const { id, example, ...day } = result;
        const direction = dayDirections.get(id);
        direction.days.push({ ...day, ...(example ? { example: { timestamp: example.timestamp, volume: example.volume, laneVolumes: example.laneVolumes } } : {}) });
        if (!sample && !daySample && example) {
          const vd = staticById.get(direction.vdId);
          const terms = example.laneVolumes.map((lane) => lane.volume);
          daySample = {
            static: { VDID: vd.VDID, RoadName: vd.RoadName, TownName: vd.TownName, PositionLat: vd.PositionLat, PositionLon: vd.PositionLon, DetectionLinks: vd.DetectionLinks },
            dynamic: example.raw,
            calculation: { date, directionId: id, timestamp: example.timestamp, laneVolumes: example.laneVolumes, formula: `${terms.join(' + ')} = ${example.volume}`, total: example.volume, unit: '輛／分鐘', note: '本例是同一筆真實紀錄的各車道、各車種計數加總；整段 150 分鐘需各自通過品質檢查後加總。' },
          };
        }
      }
      const dayStats = { date, stations: staticVDs.length, directions: results.length, receivedMinutes: results.reduce((sum, day) => sum + day.receivedMinutes, 0), validMinutes: results.reduce((sum, day) => sum + day.validMinutes, 0), fullDirections: results.filter((day) => day.validMinutes === EXPECTED_MINUTES).length, qualifiedDirections: results.filter((day) => dayDirections.get(day.id).scope.included && day.validMinutes === EXPECTED_MINUTES).length };
      const downloadedAt = manifest.download.finishedAt ?? morningStat.mtime.toISOString();
      const source = { date, staticUrl: safeSourceUrl(manifest.staticSourceUrl, apiUrl(date, false)), liveUrl: safeSourceUrl(manifest.sourceUrl, apiUrl(date, true)), rawFile: `research/${manifest.rawFile ?? morningFile}`, sha256: manifest.rawFileSHA256 ?? morningSHA256, downloadedAt, staticFile: `research/${staticFile}`, staticSHA256, morningFile: `research/${morningFile}`, morningSHA256, downloadedRecords: manifest.offlineValidation?.records ?? manifest.download.records ?? records.length, cacheIntegrity: hasBothHashes ? 'verified' : 'legacy-unverified', integrityNote: hasBothHashes ? '已比對當日靜態與早尖峰快取 SHA-256，皆符合下載完成紀錄。' : '舊版下載紀錄未提供靜態或早尖峰快取雜湊；此處顯示目前檔案 SHA-256，無法回溯驗證下載後是否曾修改。' };
      // Commit this day only after all checks and source metadata have succeeded.
      for (const [id, direction] of dayDirections) directionsById.set(id, direction);
      if (official) officialSources.push(official.source);
      availableDates.push(date);
      dailyStats.push(dayStats);
      sources.push(source);
      if (!sample && daySample) sample = daySample;
    } catch (error) {
      const reason = error.code === 'ENOENT' ? (failedDownload?.reason ?? '尚未下載完整的當日靜態與早尖峰資料') : error.message;
      failedDates.push({ date, reason });
    }
  }
  const directions = [...directionsById.values()].sort((a, b) => a.roadName.localeCompare(b.roadName, 'zh-Hant') || a.id.localeCompare(b.id));
  const selected = representativeDirections(directions);
  for (const direction of directions) {
    const representative = selected.find((candidate) => candidate.linkId === direction.linkId);
    direction.isRepresentative = Boolean(representative && representative.id === direction.id);
    direction.representativeId = representative?.id ?? null;
    direction.days.sort((a, b) => a.date.localeCompare(b.date));
  }
  const allQualified = buildRankings(directions, availableDates, { limit: Infinity });
  const observedRankings = buildObservedRankings(directions, availableDates, { limit: Infinity });
  const congestionRankings = buildCongestionRankings(directions, availableDates, { limit: Infinity });
  const emptyComparison = () => ({ minutes: 0, exact: 0, withinOne: 0, bothCongested: 0, vdCongested: 0, officialCongested: 0, speedAbsDiffSum: 0 });
  const addComparison = (target, source) => { if (source) for (const key of Object.keys(target)) target[key] += source[key]; };
  // Validation covers every Neihu direction that has an official section; the per-direction list keeps only ranked ones.
  const validation = emptyComparison();
  const singleMinute = emptyComparison();
  const validationByDirection = [];
  for (const direction of directions) {
    const total = emptyComparison();
    for (const day of direction.days) { addComparison(total, day.officialComparison); addComparison(singleMinute, day.singleMinuteComparison); }
    if (!total.minutes) continue;
    addComparison(validation, total);
    if (direction.scope.included) validationByDirection.push({ id: direction.id, vdId: direction.vdId, roadName: direction.roadName, bearing: direction.bearing, sectionId: direction.geometry?.sectionId ?? null, ...total });
  }
  const levelSet = (reference?.congestionLevels ?? []).filter((item) => directions.some((direction) => direction.scope.included && direction.geometry?.congestionLevelId === item.CongestionLevelID));
  return {
    meta: { title: '內湖園區搞清楚要走的路', generatedAt: new Date().toISOString(), requestedStart: start, requestedEnd: end, timeStart: '07:00', timeEnd: '09:30', timezone: 'Asia/Taipei', timestampConvention: '[07:00,09:30)；統計區間起訖意義尚待官方確認', boundaryNote: BOUNDARY_NOTE, qualityRule: QUALITY_RULE, rankingMetric: 'observed-volume-per-valid-minute', rankingRule: '以通過品質檢查的實測累計車次 ÷ 有效分鐘降序比較，最多列十名；各方向有效時刻可能不同，無法保證等同完整早尖峰排名。', congestionMetric: 'congested-share-of-speed-minutes', congestionRule: `每分鐘車速 = 該分鐘與前 ${SPEED_WINDOW_MINUTES - 1} 分鐘（共 ${SPEED_WINDOW_MINUTES} 分鐘）通過品質檢查的紀錄中，各車道 Speed 以車次加權平均；依臺北市在 TDX 發布的壅塞水準門檻分為 A–F（1–6 級），本專案以 ${CONGESTED_LEVELS.map((level) => 'ABCDEF'[level - 1]).join('、')} 級為壅塞分鐘、${'ABCDEF'[SEVERE_LEVEL - 1]} 級為嚴重壅塞。排名依壅塞分鐘 ÷ 已分級分鐘降序，同分再比嚴重壅塞比例、平均車速。5 分鐘內都沒有車通過的分鐘沒有車速，不列入分母。`, congestedLevels: CONGESTED_LEVELS, severeLevel: SEVERE_LEVEL, congestionLevels: levelSet, expectedMinutesPerDay: EXPECTED_MINUTES, workdayRule: '週一至週五，依使用者要求排除六日；未另扣國定假日。', representativeRule: '同一 LinkID 只保留一個代表測點：設定的代表優先序由小到大，未設定時依 VDID 字典順序；選取與車流量無關。', geographyNote: geography ? `只分析當日靜態資料 TownName=內湖區的測點。園區範圍採臺北市商業處公布的門牌範圍，經 TDX 地址定位取得 ${geography.points.length} 個官方園區門牌座標（另有 ${geography.rejected} 個查詢點定位結果不在官方範圍內，未採用）。以 TDX 官方路段編碼的起點與終點，再以 TDX 官方路段線形求出同一條路兩側都在官方範圍內的園區內道路區段；偵測器所在官方路段的起點或終點在這些區段 ${geography.radius} 公尺內即視為位於園區。只排名入園路段與園區內路段，只有單側屬園區的邊界道路、官方道路分類為市區快速道路或匝道者不列入。偵測器無法追蹤個別車輛目的地。` : '只分析當日靜態資料 TownName=內湖區的測點。朝園區方向來自人工路線假設，未追蹤車輛實際目的地。', volumeNote: 'Volume 是每分鐘、每車道、每車種的偵測計數。僅加總有效原始值，不以缺漏分鐘推估或放大。', park: { ...(config?.park ?? {}), ...(reference ? { boundarySource: reference.boundary?.source, radiusMeters: geography?.radius ?? null, extent: describeExtent(geography, boundaryConfig?.ranges ?? reference?.boundary?.ranges ?? [], directions, reference?.parkRoads), stretches: (geography?.stretches ?? []).flatMap((stretch) => stretch.intervals.map(([low, high]) => ({ road: stretch.road, direction: stretch.direction, lengthMeters: Math.round(high - low), line: sliceLine(stretch.line, low, high).map(([lon, lat]) => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]) }))), excludedRoadClasses: geography?.excludedRoadClasses ?? [], acceptedPoints: (geography?.points ?? []).map(({ query, matchedAddress, lon, lat, road, parity }) => ({ query, matchedAddress, lon, lat, road, parity })), rejectedPoints: (reference.geocodes ?? []).filter((item) => !(geography?.points ?? []).some((point) => point.query === item.query)).map(({ query, matchedAddress, reason }) => ({ query, matchedAddress, reason })) } : {}) } },
    holidays: holidayConfig ? { source: holidayConfig.source, dates: holidayConfig.dates.filter((item) => requestedDates.includes(item.date)), all: holidayConfig.dates } : null,
    companies: companyConfig ? { defaults: companyConfig.defaults, list: companyConfig.companies.flatMap((company) => { const located = (reference?.companies ?? []).find((item) => item.id === company.id); return located ? [{ ...company, location: { lon: located.lon, lat: located.lat, matchedAddress: located.matchedAddress, officialAddress: located.officialAddress, reportDate: located.reportDate } }] : []; }) } : null,
    coverage: { requestedDates, availableDates, failedDates, pendingDates, commonDates: availableDates, status: availableDates.length === requestedDates.length && requestedDates.length > 0 ? 'complete' : 'partial' },
    summary: { stations: new Set(directions.map((direction) => direction.vdId)).size, directions: directions.length, inScopeDirections: directions.filter((direction) => direction.scope.included).length, qualifiedDirections: allQualified.length, observedComparableDirections: observedRankings.length, congestionComparableDirections: congestionRankings.length, representativeDirections: selected.length, categories: Object.fromEntries(['entering', 'internal', 'leaving', 'outside', 'expressway'].map((key) => [key, directions.filter((direction) => direction.scope.category === key).length])) },
    directions,
    rankings: observedRankings.slice(0, 10),
    congestionRankings: congestionRankings.slice(0, 10),
    strictRankings: allQualified.slice(0, 10),
    validation: { ...validation, singleMinute, windowMinutes: SPEED_WINDOW_MINUTES, byDirection: validationByDirection, dates: officialSources.map((item) => item.date), missingDates: officialMissing, sources: officialSources },
    referenceSources: (reference?.sources ?? []).map(({ name, method, url, fetchedAt, sha256: hash }) => ({ name, method, url: url.replace(/Address\/[^?]+/, 'Address/{門牌}'), fetchedAt, sha256: hash })).filter((item, index, list) => !item.name.startsWith('geocode-') || list.findIndex((other) => other.name.startsWith('geocode-')) === index),
    dailyStats,
    sources,
    sample,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
  const defaults = recentCalendarRange();
  const snapshot = await buildSnapshot({ start: value('--start', defaults.start), end: value('--end', defaults.end) });
  const target = resolve(PROJECT_ROOT, value('--output', 'data/dashboard.json'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`資料快照已更新：${snapshot.coverage.availableDates.length}/${snapshot.coverage.requestedDates.length} 個週一至週五日期；${snapshot.summary.observedComparableDirections} 個方向可比較有效分鐘實測平均，顯示前 ${snapshot.rankings.length} 名；${snapshot.summary.congestionComparableDirections} 個方向可比較壅塞比例；官方發布路段比對 ${snapshot.validation.dates.length} 日、${snapshot.validation.minutes} 分鐘；另有 ${snapshot.summary.qualifiedDirections} 個方向符合嚴格完整條件；狀態 ${snapshot.coverage.status}。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
