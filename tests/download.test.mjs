import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const root = resolve('.');
const fakeSecret = 'synthetic-secret-not-a-real-credential';
async function fixture(fn) {
  const temp = await mkdtemp(join(tmpdir(), 'neihu-download-'));
  try {
    await mkdir(join(temp, 'scripts')); await mkdir(join(temp, 'lib'));
    await cp(join(root, 'scripts/download.mjs'), join(temp, 'scripts/download.mjs'));
    await cp(join(root, 'lib/ranking.mjs'), join(temp, 'lib/ranking.mjs'));
    await writeFile(join(temp, '.env.local'), `TDX_CLIENT_ID=synthetic-test-id\nTDX_CLIENT_SECRET=${fakeSecret}\n`);
    await writeFile(join(temp, 'mock.mjs'), `
let tick=0;const realNow=Date.now;Date.now=()=>realNow()+(tick+=14000);
const vd={VDID:'TEST1',TownName:'內湖區',RoadName:'測試道路',DetectionLinks:[{LinkID:'LINK1',LaneNum:1,ActualLaneNum:1}]};
globalThis.fetch=async(url)=>{
 if(process.env.TEST_MODE==='no-network')throw new Error('Unexpected network call with valid cache');
 if(String(url).includes('/openid-connect/token'))return Response.json({access_token:'synthetic-test-token',expires_in:86400});
 if(process.env.TEST_MODE==='forbidden')return new Response('synthetic-secret-not-a-real-credential',{status:403});
 if(!String(url).includes('/Live/VD/'))return new Response(JSON.stringify(vd)+'\\n');
 if(process.env.TEST_MODE==='broken')return new Response('{"VDID":"TEST1",bad-data}\\n');
 const rows=Array.from({length:150},(_,i)=>({VDID:'TEST1',Status:0,DataCollectTime:new Date(Date.parse((process.env.TEST_MODE==='stale'?'2026-10-21':'2026-10-22')+'T07:00:00+08:00')+i*60000).toISOString(),LinkFlows:[{LinkID:'LINK1',Lanes:[{LaneID:0,ErrorDiags:['diag0'],Vehicles:[{VehicleType:'S',Volume:1}]}]}]}));
 return new Response('\\uFEFF'+rows.map(r=>JSON.stringify(r)).join('\\n')+'\\n');
};
`);
    const run = (mode='success') => spawnSync(process.execPath, ['--import', join(temp, 'mock.mjs'), join(temp, 'scripts/download.mjs'), '--date', '2026-10-22'], { cwd: temp, env: { ...process.env, TEST_MODE: mode }, encoding: 'utf8', timeout: 20000 });
    await fn(temp, run);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
test('download writes hashed complete cache, accepts BOM and reuses valid cache without network', async () => fixture(async (temp, run) => {
  const result=run();assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(await readFile(join(temp,'research/2026-10-22-download-manifest.json'),'utf8'));
  assert.equal(manifest.download.morningRecords,150);assert.equal(manifest.download.records,150);
  assert.match(manifest.rawFileSHA256,/^[a-f0-9]{64}$/);assert.match(manifest.staticFileSHA256,/^[a-f0-9]{64}$/);assert.match(manifest.morningFileSHA256,/^[a-f0-9]{64}$/);
  assert.equal(manifest.offlineValidation.targetParseErrors,0);
  const cached=run('no-network');assert.equal(cached.status,0,cached.stderr);assert.match(cached.stdout,/cached \(hash verified\)/);
}));
test('broken target JSON never publishes a completed manifest or partial output', async () => fixture(async (temp,run)=>{
  const result=run('broken');assert.equal(result.status,0,result.stderr);
  const files=await readdir(join(temp,'research'));assert.ok(!files.includes('2026-10-22-download-manifest.json'));assert.ok(!files.some(f=>f.endsWith('.part')));
  assert.ok(files.includes('2026-10-22-download-error.json'));
}));
test('tampered cached data is withheld after failed redownload and server body cannot disclose credentials', async () => fixture(async(temp,run)=>{
  assert.equal(run().status,0);
  await writeFile(join(temp,'research/2026-10-22-neihu-morning.jsonl'),'tampered');
  const result=run('forbidden');assert.equal(result.status,0,result.stderr);
  const files=await readdir(join(temp,'research'));assert.ok(!files.includes('2026-10-22-download-manifest.json'));
  const failure=JSON.parse(await readFile(join(temp,'research/2026-10-22-download-error.json'),'utf8'));assert.equal(failure.statusCode,403);
  assert.ok(!result.stdout.includes(fakeSecret));assert.ok(!result.stderr.includes(fakeSecret));
}));

test('stale prior-day timestamps are not accepted as target-day traffic', async () => fixture(async (temp,run) => {
  const result=run('stale');assert.equal(result.status,0,result.stderr);
  const files=await readdir(join(temp,'research'));assert.ok(!files.includes('2026-10-22-download-manifest.json'));
  const failure=JSON.parse(await readFile(join(temp,'research/2026-10-22-download-error.json'),'utf8'));
  assert.equal(failure.observed.matchedStationRecords,150);
  assert.match(failure.observed.minCollectTime,/2026-10-20T23:00/);
  assert.match(failure.reason,/0 target rows/);
}));
