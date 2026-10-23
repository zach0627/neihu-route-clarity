// One live 15-minute check: poll the TDX live VD feed once a minute, then apply the snapshot's quality rules,
// five-minute speed, official thresholds and the flexible-start live rule. Writes data/live.json (public data only).
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRecord, congestionLevel, CONGESTED_LEVELS, SPEED_WINDOW_MINUTES, representativeDirections } from '../lib/ranking.mjs';
import { buildFlexRecommendations, liveUpdate, minuteText, parseMinute, JAM_SHARE, CHECK_INTERVAL_MINUTES } from '../lib/flex.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const API = 'https://tdx.transportdata.tw/api/basic/v2/Road/Traffic';
const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
const minutes = Number(option('--minutes', String(CHECK_INTERVAL_MINUTES)));
const intervalMs = Number(option('--interval-seconds', '60')) * 1000;
try { process.loadEnvFile(resolve(ROOT, '.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const clientId = process.env.TDX_CLIENT_ID;
const clientSecret = process.env.TDX_CLIENT_SECRET;
if (!clientId || !clientSecret) throw new Error('Set TDX_CLIENT_ID and TDX_CLIENT_SECRET (local .env.local or CI secrets).');
const redact = (message) => String(message).split(clientSecret).join('[REDACTED]').split(clientId).join('[REDACTED]').replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const taipei = (ms) => { const date = new Date(ms + 8 * 3600e3); return { date: date.toISOString().slice(0, 10), minute: date.getUTCHours() * 60 + date.getUTCMinutes() }; };

let token;
async function authenticate() {
  const response = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`TDX authentication failed (HTTP ${response.status})`);
  token = (await response.json()).access_token;
}
async function get(url) {
  if (!token) await authenticate();
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(60000) });
    if (response.status === 401 && attempt === 0) { await authenticate(); continue; }
    if (response.status === 429 && attempt < 2) { await delay(15000); continue; }
    if (!response.ok) throw new Error(`TDX HTTP ${response.status}`);
    return response.json();
  }
}

try {
  const snapshot = JSON.parse(await readFile(resolve(ROOT, 'data/dashboard.json'), 'utf8'));
  const reference = JSON.parse(await readFile(resolve(ROOT, 'data/reference.json'), 'utf8'));
  const neihu = new Set(snapshot.directions.map((direction) => direction.vdId));
  const staticUrl = `${API}/VD/City/Taipei?%24format=JSON`, liveUrl = `${API}/Live/VD/City/Taipei?%24format=JSON`;
  const stations = new Map(((await get(staticUrl)).VDs ?? []).filter((vd) => neihu.has(vd.VDID)).map((vd) => [vd.VDID, vd]));
  // Minute series per direction: same record screening as the historical pipeline, identical repeats count once.
  const series = new Map();
  for (let poll = 0; poll < minutes; poll++) {
    const started = Date.now();
    for (const raw of (await get(liveUrl)).VDLives ?? []) {
      if (!stations.has(raw.VDID)) continue;
      // The live API names the lane quality code ErrorType (one string); the historical API calls it ErrorDiags (an array).
      // Both are documented by TDX as 車道內車流偵測資訊異常類型代碼, so the live value is wrapped to reuse the same rule.
      const record = { ...raw, LinkFlows: (raw.LinkFlows ?? []).map((flow) => ({ ...flow, Lanes: (flow.Lanes ?? []).map(({ ErrorType, ...lane }) => ({ ...lane, ErrorDiags: lane.ErrorDiags ?? (ErrorType != null ? [ErrorType] : undefined) })) })) };
      const stamp = Date.parse(record.DataCollectTime); if (!Number.isFinite(stamp)) continue;
      for (const direction of analyzeRecord(record, stations.get(record.VDID)).directions) {
        if (!series.has(direction.id)) series.set(direction.id, new Map());
        const minute = taipei(stamp).minute, existing = series.get(direction.id).get(minute);
        if (!existing) series.get(direction.id).set(minute, direction);
        else if (existing.fingerprint !== direction.fingerprint) series.get(direction.id).set(minute, { ...existing, valid: false, speed: null });
      }
    }
    console.log(`poll ${poll + 1}/${minutes}: ${series.size} directions`);
    if (poll < minutes - 1) await delay(Math.max(13000, intervalMs - (Date.now() - started)));
  }
  const levelsFor = (direction) => reference.congestionLevels.find((item) => item.CongestionLevelID === direction.geometry?.congestionLevelId)?.Levels ?? null;
  const recentLevels = (direction) => {
    const minutesMap = series.get(direction.id); const levels = levelsFor(direction);
    if (!minutesMap || !levels) return [];
    return [...minutesMap.keys()].sort((a, b) => a - b).map((minute) => {
      const own = minutesMap.get(minute); if (!own?.valid) return null;
      let weight = 0, total = 0;
      for (let back = 0; back < SPEED_WINDOW_MINUTES; back++) { const earlier = minutesMap.get(minute - back); if (earlier?.valid && earlier.speed != null) { weight += earlier.speedVolume; total += earlier.speed * earlier.speedVolume; } }
      return weight ? { minute, speed: total / weight, level: congestionLevel(total / weight, levels) } : null;
    }).filter(Boolean);
  };
  const allMinutes = [...series.values()].flatMap((map) => [...map.keys()]);
  const now = taipei(Date.now());
  const checkMinute = Math.floor(now.minute / CHECK_INTERVAL_MINUTES) * CHECK_INTERVAL_MINUTES;
  const segments = representativeDirections(snapshot.directions).map((direction) => {
    const levels = recentLevels(direction).slice(-CHECK_INTERVAL_MINUTES);
    const classified = levels.filter((item) => item.level != null), jam = classified.filter((item) => CONGESTED_LEVELS.includes(item.level));
    const latest = levels.at(-1);
    return { id: direction.id, vdId: direction.vdId, roadName: direction.roadName, bearing: direction.bearing, category: direction.scope.category, minutes: classified.length, latestMinute: latest ? minuteText(latest.minute) : null, latestSpeed: latest ? Math.round(latest.speed * 10) / 10 : null, latestLevel: latest?.level ?? null, share15: classified.length ? jam.length / classified.length : null, jammed15: classified.length > 0 && jam.length / classified.length >= JAM_SHARE };
  });
  const companies = (snapshot.companies?.list ?? []).map((company) => {
    const baselineMinute = parseMinute(snapshot.companies.defaults?.baselineStart ?? '08:30');
    const recommendations = buildFlexRecommendations(company.location, snapshot.directions, snapshot.coverage.availableDates, { baselineMinute });
    return { id: company.id, baselineStart: minuteText(baselineMinute), checkTime: minuteText(checkMinute), directions: recommendations.map((rec) => {
      if (!rec.benchmark) return { key: rec.key, benchmarkId: null, historicalMinute: rec.recommendedMinute, recommendedMinute: rec.recommendedMinute, jammed: false, share: null };
      const update = liveUpdate(rec.recommendedMinute, checkMinute, recentLevels(rec.benchmark).map((item) => item.level));
      return { key: rec.key, benchmarkId: rec.benchmark.id, historicalMinute: rec.recommendedMinute, recommendedMinute: update.recommendedMinute, jammed: update.jammed, share: update.share };
    }) };
  });
  const live = {
    generatedAt: new Date().toISOString(), date: now.date,
    from: allMinutes.length ? minuteText(Math.min(...allMinutes)) : null, to: allMinutes.length ? minuteText(Math.max(...allMinutes)) : null,
    inWindow: now.minute >= 420 && now.minute <= 570, polls: minutes,
    rule: `近 ${CHECK_INTERVAL_MINUTES} 分鐘有 ${JAM_SHARE * 100}% 以上分鐘為 ${CONGESTED_LEVELS.map((level) => 'ABCDEF'[level - 1]).join('、')} 級，視為塞車未解除；當天最晚彈性上班 = max(歷史建議, 檢查時間 + ${CHECK_INTERVAL_MINUTES} 分鐘)。`,
    sources: [staticUrl, liveUrl].map((url) => url.replace('?%24format=JSON', '')),
    segments, companies,
  };
  await writeFile(resolve(ROOT, 'data/live.json'), `${JSON.stringify(live, null, 2)}\n`);
  console.log(`live.json: ${live.from}–${live.to}, ${segments.filter((segment) => segment.jammed15).length} jammed segments`);
} catch (error) {
  console.error(redact(error.message));
  process.exit(1);
}
