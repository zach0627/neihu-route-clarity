import { readFile, writeFile, mkdir, access, rename, rm } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { recentCalendarRange } from '../lib/ranking.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE = resolve(ROOT, 'research');
const BASE = 'https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic';
const TOP = 2000000;
const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
const dayString = (date) => date.toISOString().slice(0, 10);
const defaults = recentCalendarRange();
const start = option('--start', defaults.start);
const end = option('--end', defaults.end);
const oneDate = option('--date');
const concurrency = Number(option('--concurrency', '2'));
// CI keeps only the small morning/static extracts between runs; the full-day archive is hashed at download time, then removed.
const keepRaw = !argv.includes('--no-raw');
function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || dayString(new Date(`${value}T00:00:00Z`)) !== value) throw new Error('Dates must be valid YYYY-MM-DD values');
}
validateDate(start); validateDate(end); if (oneDate) validateDate(oneDate);
if (start > end || ![1, 2].includes(concurrency)) throw new Error('Use start <= end and concurrency 1 or 2');
const dates = [];
for (let d = new Date(`${oneDate || start}T00:00:00Z`); dayString(d) <= (oneDate || end); d.setUTCDate(d.getUTCDate() + 1)) {
  if (![0, 6].includes(d.getUTCDay())) dates.push(dayString(d));
}
if (dates.length > 45) throw new Error('Limit each run to at most 45 weekdays');
try { process.loadEnvFile(resolve(ROOT, '.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const clientId = process.env.TDX_CLIENT_ID;
const clientSecret = process.env.TDX_CLIENT_SECRET;
if (!clientId || !clientSecret) throw new Error('Set TDX_CLIENT_ID and TDX_CLIENT_SECRET in local .env.local (copy .env.example).');
const redact = (message) => String(message).split(clientSecret).join('[REDACTED]').split(clientId).join('[REDACTED]').replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]');
let token, tokenExpires = 0;
let tokenPromise;
async function authenticate() {
  if (token && Date.now() < tokenExpires) return token;
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    const response = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`TDX authentication failed (HTTP ${response.status}); check local credentials.`);
    const data = await response.json();
    if (!data.access_token) throw new Error('TDX did not return an access token');
    token = data.access_token; tokenExpires = Date.now() + Math.max(1, data.expires_in - 60) * 1000;
    return token;
  })();
  try { return await tokenPromise; } finally { tokenPromise = null; }
}
let nextRequestAt = 0;
let queue = Promise.resolve();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function rateLimit() {
  const reserved = queue.then(async () => { await delay(Math.max(0, nextRequestAt - Date.now())); nextRequestAt = Date.now() + 13000; });
  queue = reserved.catch(() => {}); await reserved;
}
async function request(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const accessToken = await authenticate(); await rateLimit();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(600000) });
    if (response.status === 401 && attempt === 0) { token = null; continue; }
    if (response.status === 429 && attempt < 2) { await response.body?.cancel(); await delay(Math.min(60000, Math.max(15000, Number(response.headers.get('retry-after') || 30) * 1000))); continue; }
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error(`TDX HTTP ${response.status}; ${response.status === 403 ? 'check account service permissions or quota' : response.status === 429 ? 'request frequency or account quota limit' : 'request not completed'}`);
      error.statusCode = response.status; throw error;
    }
    return response;
  }
}
const urlFor = (kind, date, top) => {
  const url = new URL(`${BASE}/${kind}/City/Taipei`);
  url.search = new URLSearchParams({ Dates: date, '$format': 'JSONL', '$top': String(top) }).toString();
  return url.toString();
};
const exists = (path) => access(path).then(() => true, () => false);
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
await mkdir(CACHE, { recursive: true });
let accountBlocked = false;
const results = [];
async function downloadDay(date) {
  const manifestPath = resolve(CACHE, `${date}-download-manifest.json`);
  const staticFile = `${date}-taipei-vd-static.jsonl`;
  const morningFile = `${date}-neihu-morning.jsonl`;
  const rawFile = `${date}-taipei-history.jsonl.gz`;
  if (await exists(manifestPath) && await exists(resolve(CACHE, staticFile)) && await exists(resolve(CACHE, morningFile))) {
    try {
      const m = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (m.date === date && m.download?.status === 'completed' && m.staticFileSHA256 && m.morningFileSHA256 &&
          await fileHash(resolve(CACHE, staticFile)) === m.staticFileSHA256 &&
          await fileHash(resolve(CACHE, morningFile)) === m.morningFileSHA256 &&
          (!keepRaw || await fileHash(resolve(CACHE, rawFile)) === m.rawFileSHA256)) {
        console.log(`${date}: cached (hash verified)`); results.push({ date, status: 'cached' }); return;
      }
      console.log(`${date}: cache integrity requires a fresh download`);
    } catch {}
  }
  if (accountBlocked) { results.push({ date, status: 'deferred', reason: 'An earlier request hit an account service/quota limit' }); return; }
  await rm(manifestPath, { force: true });
  const startedAt = new Date().toISOString();
  const observed = { sourceLines: 0, matchedStationRecords: 0, minCollectTime: null, maxCollectTime: null };
  console.log(`${date}: downloading static and historical flow`);
  try {
    const staticSourceUrl = urlFor('VD', date, 2000);
    const staticResponse = await request(staticSourceUrl);
    const staticText = (await staticResponse.text()).replace(/^\uFEFF/, '');
    const staticRows = staticText.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    if (staticRows.length >= 2000) throw new Error('Static response reached sample limit; refusing truncated data');
    const ids = new Set(staticRows.filter((r) => r.TownName === '內湖區').map((r) => r.VDID));
    if (!ids.size) throw new Error('No Neihu District static records were returned');
    await writeFile(resolve(CACHE, `${staticFile}.part`), staticText);
    const sourceUrl = urlFor('Live/VD', date, TOP);
    const response = await request(sourceUrl);
    const decoder = new StringDecoder('utf8');
    let pending = '', records = 0, bytes = 0, parseErrors = 0, first = true;
    const selected = [];
    const timeStart = Date.parse(`${date}T07:00:00+08:00`), timeEnd = Date.parse(`${date}T09:30:00+08:00`);
    const consume = (line) => {
      if (first) { line = line.replace(/^\uFEFF/, ''); first = false; }
      if (!line.trim()) return;
      records++; observed.sourceLines = records;
      const id = line.match(/"VDID"\s*:\s*"([^"]+)"/)?.[1];
      if (!ids.has(id)) return;
      try {
        const record = JSON.parse(line); const stamp = Date.parse(record.DataCollectTime);
        if (!Number.isFinite(stamp)) { parseErrors++; return; }
        observed.matchedStationRecords++;
        const iso = new Date(stamp).toISOString();
        if (!observed.minCollectTime || iso < observed.minCollectTime) observed.minCollectTime = iso;
        if (!observed.maxCollectTime || iso > observed.maxCollectTime) observed.maxCollectTime = iso;
        if (stamp >= timeStart && stamp < timeEnd) selected.push(record);
      } catch { parseErrors++; }
    };
    const inspect = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length; pending += decoder.write(chunk); let at;
        while ((at = pending.indexOf('\n')) >= 0) { consume(pending.slice(0, at)); pending = pending.slice(at + 1); }
        callback(null, chunk);
      },
      flush(callback) { pending += decoder.end(); consume(pending); callback(); },
    });
    const tempFile = resolve(CACHE, `${rawFile}.part`);
    await pipeline(Readable.fromWeb(response.body), inspect, createGzip({ level: 4 }), createWriteStream(tempFile));
    if (records >= TOP) throw new Error('History response reached sample limit; refusing truncated data');
    if (!selected.length || parseErrors) throw new Error(`Incomplete/unreadable target data: ${selected.length} target rows, ${parseErrors} parse errors; matched-station timestamps ${observed.minCollectTime ?? 'none'} to ${observed.maxCollectTime ?? 'none'}`);
    await writeFile(resolve(CACHE, `${morningFile}.part`), selected.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await rename(tempFile, resolve(CACHE, rawFile));
    await rename(resolve(CACHE, `${staticFile}.part`), resolve(CACHE, staticFile));
    await rename(resolve(CACHE, `${morningFile}.part`), resolve(CACHE, morningFile));
    const rawFileSHA256 = await fileHash(resolve(CACHE, rawFile));
    const staticFileSHA256 = await fileHash(resolve(CACHE, staticFile));
    const morningFileSHA256 = await fileHash(resolve(CACHE, morningFile));
    if (!keepRaw) await rm(resolve(CACHE, rawFile), { force: true });
    const manifest = { date, sourceUrl, staticSourceUrl, rawFileKept: keepRaw, download: { status: 'completed', records, bytes, startedAt, finishedAt: new Date().toISOString(), httpStatus: response.status, morningRecords: selected.length, neihuStations: ids.size }, rawFile, staticFile, morningFile, rawFileSHA256, staticFileSHA256, morningFileSHA256, offlineValidation: { records, targetParseErrors: parseErrors, scope: 'Only Neihu District target records are JSON-parsed; total records is source line count.' }, credentialsIncluded: false };
    await writeFile(`${manifestPath}.part`, JSON.stringify(manifest, null, 2) + '\n');
    await rename(`${manifestPath}.part`, manifestPath);
    await rm(resolve(CACHE, `${date}-download-error.json`), { force: true });
    results.push({ date, status: 'completed', records, morningRecords: selected.length });
    console.log(`${date}: complete; ${records.toLocaleString()} source rows, ${selected.length.toLocaleString()} Neihu morning rows`);
  } catch (error) {
    const reason = redact(error.message);
    await Promise.all([rawFile, staticFile, morningFile, `${date}-download-manifest.json`].map((file) => rm(resolve(CACHE, `${file}.part`), { force: true })));
    await writeFile(resolve(CACHE, `${date}-download-error.json`), JSON.stringify({ date, reason, statusCode: error.statusCode, observed, attemptedAt: new Date().toISOString() }, null, 2) + '\n');
    if ([402, 403, 429].includes(error.statusCode)) accountBlocked = true;
    results.push({ date, status: 'failed', reason });
    console.log(`${date}: ${reason}`);
  }
}
const remaining = [...dates].reverse();
await Promise.all(Array.from({ length: concurrency }, async () => { while (remaining.length) await downloadDay(remaining.shift()); }));
for (const entry of results.filter((r) => r.status === 'deferred')) await writeFile(resolve(CACHE, `${entry.date}-download-error.json`), JSON.stringify({ ...entry, attemptedAt: new Date().toISOString() }, null, 2) + '\n');
await writeFile(resolve(CACHE, 'latest-download-run.json'), JSON.stringify({ requestedStart: oneDate || start, requestedEnd: oneDate || end, dates, finishedAt: new Date().toISOString(), results }, null, 2) + '\n');
console.log(`Finished: ${results.filter((r) => ['completed', 'cached'].includes(r.status)).length}/${dates.length} weekdays available. Run npm run data:aggregate, then npm run build.`);
