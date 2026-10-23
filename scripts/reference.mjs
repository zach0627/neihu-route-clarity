// Official reference data: park address geocodes, link geometry, Taipei sections and congestion thresholds.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAddress, matchRange } from '../lib/park.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RAW = resolve(ROOT, 'research/reference');
const API = 'https://tdx.transportdata.tw/api';
try { process.loadEnvFile(resolve(ROOT, '.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const clientId = process.env.TDX_CLIENT_ID;
const clientSecret = process.env.TDX_CLIENT_SECRET;
if (!clientId || !clientSecret) throw new Error('Set TDX_CLIENT_ID and TDX_CLIENT_SECRET in local .env.local (copy .env.example).');
const redact = (message) => String(message).split(clientSecret).join('[REDACTED]').split(clientId).join('[REDACTED]').replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let token, nextRequestAt = 0;
async function authenticate() {
  const response = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`TDX authentication failed (HTTP ${response.status}); check local credentials.`);
  token = (await response.json()).access_token;
}
const sources = [];
/** One request every 13 seconds, same pacing as the flow downloader; raw bytes and SHA-256 are kept. */
async function request(name, url, body) {
  if (!token) await authenticate();
  for (let attempt = 0; attempt < 3; attempt++) {
    await delay(Math.max(0, nextRequestAt - Date.now())); nextRequestAt = Date.now() + 13000;
    const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000) });
    if (response.status === 401 && attempt === 0) { await authenticate(); continue; }
    if (response.status === 429 && attempt < 2) { await response.body?.cancel(); await delay(30000); continue; }
    const text = (await response.text()).replace(/^﻿/, '');
    if (!response.ok) throw new Error(`${name}: TDX HTTP ${response.status}`);
    const file = `research/reference/${name}.json`;
    await writeFile(resolve(ROOT, file), text);
    sources.push({ name, method: body ? 'POST' : 'GET', url, ...(body ? { requestBody: body } : {}), fetchedAt: new Date().toISOString(), httpStatus: response.status, rawFile: file, sha256: sha256(text) });
    return JSON.parse(text);
  }
}

/** Every Neihu link seen in any cached daily static file, so detectors present on only some days are covered too. */
async function cachedStatic() {
  const files = (await readdir(resolve(ROOT, 'research'))).filter((file) => /^\d{4}-\d{2}-\d{2}-taipei-vd-static\.jsonl$/.test(file)).sort();
  if (!files.length) throw new Error('No cached Taipei VD static file; run npm run data:download first.');
  const vds = [];
  for (const file of files) for (const line of (await readFile(resolve(ROOT, 'research', file), 'utf8')).split(/\r?\n/).filter(Boolean)) { const vd = JSON.parse(line); if (vd.TownName === '內湖區') vds.push(vd); }
  return { files, vds };
}

async function previousReference() {
  try { return JSON.parse(await readFile(resolve(ROOT, 'data/reference.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

try {
  await mkdir(RAW, { recursive: true });
  const boundary = JSON.parse(await readFile(resolve(ROOT, 'config/park-boundary.json'), 'utf8'));
  const roads = [...new Set(boundary.ranges.map((range) => range.road))];
  const { files: staticFiles, vds } = await cachedStatic();
  const linkIds = [...new Set(vds.flatMap((vd) => (vd.DetectionLinks ?? []).map((link) => link.LinkID)))].sort();
  const previous = await previousReference();
  const refresh = process.argv.includes('--refresh-geocodes');

  const links = await request('links', `${API}/basic/v2/Road/Link/LinkID?%24format=JSON`, linkIds);
  const shapes = await request('link-shapes', `${API}/basic/v2/Road/Link/Shape/Geometry/GeoJson?%24format=JSON`, linkIds);
  const congestionLevels = await request('congestion-levels-taipei', `${API}/basic/v2/Road/Traffic/CongestionLevel/City/Taipei?%24format=JSON`);
  const sections = await request('sections-taipei', `${API}/basic/v2/Road/Traffic/Section/City/Taipei?%24format=JSON`);
  const live = await request('section-live-taipei', `${API}/basic/v2/Road/Traffic/Live/City/Taipei?%24format=JSON`);

  // Whole official road geometry for every listed road that can be in range on both sides (全部, or both odd and even ranges).
  const twoSidedRoads = roads.filter((road) => { const parities = new Set(boundary.ranges.filter((range) => range.road === road).map((range) => range.parity)); return parities.has('all') || (parities.has('odd') && parities.has('even')); });
  const roadLinks = [];
  for (const road of twoSidedRoads) {
    const rows = await request(`road-links-${road}`, `${API}/basic/v2/Road/Link/CityRoad/Taipei/${encodeURIComponent(road)}?%24format=JSON`);
    roadLinks.push({ road, rows: rows.filter((link) => link.RoadName === road) });
  }
  const roadShapes = await request('road-link-shapes', `${API}/basic/v2/Road/Link/Shape/Geometry/GeoJson?%24format=JSON`, roadLinks.flatMap((item) => item.rows.map((link) => link.LinkID)));
  const roadShapeById = Object.fromEntries((roadShapes.features ?? []).map((feature) => [feature.properties.LinkID, feature.geometry.coordinates]));
  const toPoint = (text) => text.split(',').map(Number);
  const parkRoads = roadLinks.map(({ road, rows }) => ({ road, links: rows.map((link) => ({ LinkID: link.LinkID, direction: link.RoadDirection, start: toPoint(link.StartPoint), end: toPoint(link.EndPoint), shape: (roadShapeById[link.LinkID] ?? [toPoint(link.StartPoint), toPoint(link.EndPoint)]).map(([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]) })) }));

  const geocodes = [];
  // Geocodes are reused from the previous snapshot unless --refresh-geocodes; acceptance is always re-evaluated against the current ranges.
  const reused = new Map(refresh ? [] : (previous?.geocodes ?? []).map((item) => [item.query, item]));
  const previousSources = new Map((previous?.sources ?? []).map((source) => [source.url, source]));
  for (const [index, probe] of boundary.probes.entries()) {
    const query = `臺北市內湖區${probe}`;
    const url = `${API}/advanced/V3/Map/GeoCode/Coordinate/Address/${encodeURIComponent(query)}?%24format=JSON`;
    let hit;
    if (reused.has(query) && previousSources.has(url)) {
      const old = reused.get(query);
      hit = old.matchedAddress ? { Address: old.matchedAddress, Geometry: old.lon != null ? `POINT (${old.lon} ${old.lat})` : null } : null;
      sources.push({ ...previousSources.get(url), reusedAt: new Date().toISOString() });
    } else {
      const rows = await request(`geocode-${String(index).padStart(3, '0')}`, url);
      hit = Array.isArray(rows) ? rows[0] : null;
    }
    const point = hit?.Geometry?.match(/POINT \(([-\d.]+) ([-\d.]+)\)/);
    const parsed = parseAddress(hit?.Address, roads);
    const range = matchRange(parsed, boundary.ranges);
    geocodes.push({ query, matchedAddress: hit?.Address ?? null, lon: point ? Number(point[1]) : null, lat: point ? Number(point[2]) : null, parsed, accepted: Boolean(point && range), reason: !hit ? '定位服務沒有回傳結果' : !point ? '回傳結果沒有座標' : range ? `符合官方範圍：${range.road}${{ odd: '單號', even: '雙號', all: '全部' }[range.parity]}` : '回傳的實際門牌不在官方範圍內，不採用' });
    console.log(`${probe} → ${hit?.Address ?? '無結果'} ${geocodes.at(-1).accepted ? '採用' : '不採用'}`);
  }

  // Template companies: official address from the TWSE listed-company profile when a stock code is given, then the TDX geocoder.
  const companyConfig = JSON.parse(await readFile(resolve(ROOT, 'config/companies.json'), 'utf8'));
  let listed = null;
  if (companyConfig.companies.some((company) => company.stockCode)) {
    const url = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`TWSE OpenAPI HTTP ${response.status}`);
    const text = await response.text();
    await writeFile(resolve(RAW, 'twse-listed-companies.json'), text);
    sources.push({ name: 'twse-listed-companies', method: 'GET', url, fetchedAt: new Date().toISOString(), httpStatus: response.status, rawFile: 'research/reference/twse-listed-companies.json', sha256: sha256(text) });
    listed = JSON.parse(text);
  }
  const companies = [];
  for (const company of companyConfig.companies) {
    const profile = listed?.find((row) => row['公司代號'] === company.stockCode) ?? null;
    if (company.stockCode && profile?.['住址'] !== company.address) console.log(`注意：${company.shortName} 設定住址「${company.address}」與證交所資料「${profile?.['住址'] ?? '查無'}」不同，請核對。`);
    const query = company.geocodeAddress ?? company.address;
    const url = `${API}/advanced/V3/Map/GeoCode/Coordinate/Address/${encodeURIComponent(query)}?%24format=JSON`;
    const old = (previous?.companies ?? []).find((item) => item.id === company.id && item.query === query);
    let hit;
    if (old && !refresh && previousSources.has(url)) { hit = { Address: old.matchedAddress, Geometry: `POINT (${old.lon} ${old.lat})` }; sources.push({ ...previousSources.get(url), reusedAt: new Date().toISOString() }); }
    else { const rows = await request(`company-${company.id}`, url); hit = Array.isArray(rows) ? rows[0] : null; }
    const point = hit?.Geometry?.match(/POINT \(([-\d.]+) ([-\d.]+)\)/);
    if (!point) throw new Error(`${company.shortName} 地址定位沒有座標`);
    companies.push({ id: company.id, query, matchedAddress: hit.Address, lon: Number(point[1]), lat: Number(point[2]), officialAddress: profile?.['住址'] ?? null, reportDate: profile?.['出表日期'] ?? null });
    console.log(`${company.shortName}：${profile?.['住址'] ?? company.address} → ${hit.Address}`);
  }

  const ours = new Set(linkIds);
  const liveBySection = new Map((live.LiveTraffics ?? []).map((item) => [item.SectionID, item]));
  const reference = {
    generatedAt: new Date().toISOString(),
    note: '官方參考資料快照；由 scripts/reference.mjs 以本機憑證下載，原始回應存於 research/reference，此檔只保留分析需要的欄位與來源雜湊。',
    staticFiles: staticFiles.map((file) => `research/${file}`),
    boundary: { source: boundary.source, ranges: boundary.ranges, probeNote: boundary.probeNote },
    geocodes,
    companies,
    parkRoads,
    links: links.map(({ LinkID, RoadName, RoadClass, RoadClassName, RoadDirection, Bearing, StartNode, EndNode, Length, StartPoint, EndPoint, Version }) => ({ LinkID, RoadName, RoadClass, RoadClassName, RoadDirection, Bearing, StartNode, EndNode, Length, StartPoint: StartPoint.split(',').map(Number), EndPoint: EndPoint.split(',').map(Number), Version })),
    linkShapes: Object.fromEntries((shapes.features ?? []).map((feature) => [feature.properties.LinkID, feature.geometry.coordinates])),
    congestionLevels: congestionLevels.CongestionLevels ?? [],
    sections: (sections.Sections ?? []).filter((section) => (section.LinkIDs ?? []).some((item) => ours.has(item.LinkID))).map((section) => ({ SectionID: section.SectionID, SectionName: section.SectionName, RoadName: section.RoadName, RoadClass: section.RoadClass, RoadDirection: section.RoadDirection, SectionLength: section.SectionLength, LinkIDs: section.LinkIDs.map((item) => item.LinkID), CongestionLevelID: liveBySection.get(section.SectionID)?.CongestionLevelID ?? null })),
    sources,
  };
  await writeFile(resolve(ROOT, 'data/reference.json'), `${JSON.stringify(reference, null, 2)}\n`);
  console.log(`官方參考資料已更新：${links.length} 條路段、${geocodes.filter((item) => item.accepted).length}/${geocodes.length} 個門牌定位點採用、${reference.sections.length} 個發布路段。`);
} catch (error) {
  console.error(redact(error.message));
  process.exit(1);
}
