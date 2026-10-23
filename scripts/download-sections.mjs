// Official Taipei section live-traffic history (TravelSpeed, CongestionLevel) used to cross-check VD-derived congestion.
import { readFile, writeFile, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { recentCalendarRange, weekdaysBetween } from '../lib/ranking.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE = resolve(ROOT, 'research');
const TOP = 3000000;
const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
const defaults = recentCalendarRange();
const oneDate = option('--date');
const dates = weekdaysBetween(oneDate || option('--start', defaults.start), oneDate || option('--end', defaults.end));
try { process.loadEnvFile(resolve(ROOT, '.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const clientId = process.env.TDX_CLIENT_ID;
const clientSecret = process.env.TDX_CLIENT_SECRET;
if (!clientId || !clientSecret) throw new Error('Set TDX_CLIENT_ID and TDX_CLIENT_SECRET in local .env.local (copy .env.example).');
const redact = (message) => String(message).split(clientSecret).join('[REDACTED]').split(clientId).join('[REDACTED]').replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]');
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
const fileHash = async (path) => { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); };

/** Official section list when available; Taipei history rows carry SectionID only (observed form L_<LinkID>). */
async function neihuSectionIds() {
  try {
    const reference = JSON.parse(await readFile(resolve(ROOT, 'data/reference.json'), 'utf8'));
    if (reference.sections?.length) return { ids: new Set(reference.sections.map((section) => section.SectionID)), basis: 'data/reference.json sections' };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = (await readdir(CACHE)).filter((file) => /^\d{4}-\d{2}-\d{2}-taipei-vd-static\.jsonl$/.test(file));
  const ids = new Set();
  for (const file of files) for (const line of (await readFile(resolve(CACHE, file), 'utf8')).split(/\r?\n/).filter(Boolean)) {
    const vd = JSON.parse(line);
    if (vd.TownName === '內湖區') for (const link of vd.DetectionLinks ?? []) ids.add(`L_${link.LinkID}`);
  }
  if (!ids.size) throw new Error('No cached Neihu VD static file; run npm run data:download first.');
  return { ids, basis: 'L_<LinkID> from cached Neihu VD static files' };
}

async function downloadDay(date, sectionIds) {
  const morningFile = `${date}-section-live-morning.jsonl`;
  const manifestPath = resolve(CACHE, `${date}-section-manifest.json`);
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.status === 'completed' && await fileHash(resolve(CACHE, morningFile)) === manifest.morningFileSHA256) { console.log(`${date}: cached (hash verified)`); return; }
  } catch {}
  const url = new URL('https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic/Live/City/Taipei');
  url.search = new URLSearchParams({ Dates: date, '$format': 'JSONL', '$top': String(TOP) }).toString();
  if (!token) await authenticate();
  const startedAt = new Date().toISOString();
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    await delay(Math.max(0, nextRequestAt - Date.now())); nextRequestAt = Date.now() + 13000;
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(900000) });
    if (response.status === 401 && attempt === 0) { await response.body?.cancel(); await authenticate(); continue; }
    if (response.status === 429 && attempt < 2) { await response.body?.cancel(); await delay(Math.min(120000, Math.max(30000, Number(response.headers.get('retry-after') || 60) * 1000))); continue; }
    break;
  }
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`TDX HTTP ${response.status}`), { statusCode: response.status }); }
  const timeStart = Date.parse(`${date}T07:00:00+08:00`), timeEnd = Date.parse(`${date}T09:30:00+08:00`);
  const decoder = new StringDecoder('utf8');
  const selected = [];
  let pending = '', records = 0, parseErrors = 0;
  const consume = (line) => {
    if (!line.trim()) return;
    records++;
    if (!sectionIds.ids.has(line.match(/"SectionID"\s*:\s*"([^"]+)"/)?.[1])) return;
    try {
      const row = JSON.parse(line.replace(/^﻿/, ''));
      const stamp = Date.parse(row.DataCollectTime);
      if (stamp >= timeStart && stamp < timeEnd) selected.push(row);
    } catch { parseErrors++; }
  };
  for await (const chunk of Readable.fromWeb(response.body)) {
    pending += decoder.write(chunk); let at;
    while ((at = pending.indexOf('\n')) >= 0) { consume(pending.slice(0, at)); pending = pending.slice(at + 1); }
  }
  consume(pending + decoder.end());
  if (records >= TOP) throw new Error('Section history reached $top; refusing truncated data');
  if (!selected.length || parseErrors) throw new Error(`Incomplete section history: ${selected.length} target rows, ${parseErrors} parse errors`);
  await writeFile(resolve(CACHE, `${morningFile}.part`), selected.map((row) => JSON.stringify(row)).join('\n') + '\n');
  await rename(resolve(CACHE, `${morningFile}.part`), resolve(CACHE, morningFile));
  const manifest = { date, status: 'completed', sourceUrl: url.toString(), startedAt, finishedAt: new Date().toISOString(), httpStatus: response.status, sourceRecords: records, morningRecords: selected.length, sectionBasis: sectionIds.basis, morningFile, morningFileSHA256: await fileHash(resolve(CACHE, morningFile)), credentialsIncluded: false };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${date}: ${records.toLocaleString()} source rows, ${selected.length.toLocaleString()} Neihu morning section rows`);
}

await mkdir(CACHE, { recursive: true });
const sectionIds = await neihuSectionIds();
let completed = 0;
for (const date of dates) {
  try { await downloadDay(date, sectionIds); completed++; }
  catch (error) {
    await rm(resolve(CACHE, `${date}-section-live-morning.jsonl.part`), { force: true });
    console.log(`${date}: ${redact(error.message)}`);
    if ([402, 403, 429].includes(error.statusCode)) { console.log('Stopped early: account service or frequency limit; rerun later to continue.'); break; }
  }
}
console.log(`Section history finished: ${completed}/${dates.length} weekdays available.`);
