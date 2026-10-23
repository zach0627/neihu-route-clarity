import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = resolve('.');
async function observe(options = {}) {
  const temp = await mkdtemp(join(tmpdir(), 'neihu-live-window-'));
  try {
    await mkdir(join(temp, 'scripts'));
    await mkdir(join(temp, 'data'));
    await cp(join(root, 'scripts/live-update.mjs'), join(temp, 'scripts/live-update.mjs'));
    await cp(join(root, 'lib'), join(temp, 'lib'), { recursive: true });
    const direction = {
      id: 'TEST1:LINK1', vdId: 'TEST1', linkId: 'LINK1', roadName: '測試道路', bearing: 'S',
      scope: { included: true, category: 'internal' },
      geometry: { start: [121.57, 25.086], end: [121.57, 25.084], congestionLevelId: 'TEST', sectionId: 'SECTION1' },
      days: [{ date: '2026-10-22', speedMinutes: 150, speedSum: 7500, levelMinutes: { 1: 150 }, congestionProfile: { observedMinutes: 150, bins: Array.from({ length: 10 }, () => [15, 0]) } }],
    };
    await writeFile(join(temp, 'data/dashboard.json'), JSON.stringify({
      directions: [direction], coverage: { availableDates: ['2026-10-22'] },
      companies: { defaults: { baselineStart: '08:30' }, list: [{ id: 'company', location: { lon: 121.57, lat: 25.08 } }] },
    }));
    await writeFile(join(temp, 'data/reference.json'), JSON.stringify({ congestionLevels: [{ CongestionLevelID: 'TEST', Levels: [{ Level: 5, LowValue: 0, TopValue: 20 }, { Level: 1, LowValue: 20, TopValue: null }] }] }));
    await writeFile(join(temp, 'mock.mjs'), `
const options = JSON.parse(process.env.LIVE_TEST_OPTIONS);
const RealDate = Date;
let clock = RealDate.parse(options.start || '2026-10-23T08:30:00+08:00');
let poll = 0;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
globalThis.setTimeout = (callback) => { clock += (options.stepMinutes || 1) * 60000; callback(); return 0; };
const station = { VDID: 'TEST1', DetectionLinks: [{ LinkID: 'LINK1', LaneNum: 1 }] };
globalThis.fetch = async (url) => {
  if (String(url).includes('/openid-connect/token')) return Response.json({ access_token: 'synthetic-test-token' });
  if (!String(url).includes('/Live/VD/')) return Response.json({ VDs: [station] });
  const stamp = options.sourceTime || new RealDate(clock - (options.lagMinutes ?? 1) * 60000).toISOString();
  const speed = poll++ < (options.warmupFastPolls || 0) ? 50 : 5;
  const response = Response.json({ VDLives: [{ VDID: 'TEST1', DataCollectTime: stamp, Status: 0, LinkFlows: [{ LinkID: 'LINK1', Lanes: [{ LaneID: 0, ErrorType: 'diag0', Speed: speed, Occupancy: 20, Vehicles: [{ VehicleType: 'S', Volume: 1 }] }] }] }] });
  if (poll === (options.polls || 15)) clock += (options.finalDelayMinutes || 0) * 60000;
  return response;
};
`);
    const result = spawnSync(process.execPath, ['--import', join(temp, 'mock.mjs'), join(temp, 'scripts/live-update.mjs'), '--minutes', String(options.polls || 15)], {
      cwd: temp, env: { ...process.env, TDX_CLIENT_ID: 'synthetic-live-id', TDX_CLIENT_SECRET: 'synthetic-live-secret', LIVE_TEST_OPTIONS: JSON.stringify(options) }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return JSON.parse(await readFile(join(temp, 'data/live.json'), 'utf8'));
  } finally { await rm(temp, { recursive: true, force: true }); }
}

const advice = (live) => live.companies[0].directions.find(direction => direction.key === 'north');

for (const [name, sourceTime] of [
  ['a previous-day record with normal equipment status', '2026-10-22T08:29:00+08:00'],
  ['a same-day record older than five minutes', '2026-10-23T08:24:00+08:00'],
  ['a future record', '2026-10-23T08:31:00+08:00'],
]) test(`live polling rejects ${name}`, async () => {
  const live = await observe({ polls: 1, sourceTime });
  assert.equal(live.segments[0].minutes, 0);
  assert.equal(live.sourceFrom, null);
  assert.equal(live.sourceTo, null);
  assert.equal(advice(live).jammed, false);
  assert.equal(advice(live).recommendedMinute, 510);
});

test('a normal one-minute source lag retains all fifteen actual minutes and their source dates', async () => {
  const live = await observe();
  assert.equal(live.segments[0].minutes, 15);
  assert.equal(live.segments[0].jammed15, true);
  assert.equal(live.from, '08:29');
  assert.equal(live.to, '08:43');
  assert.equal(live.sourceFrom, '2026-10-23T00:29:00.000Z');
  assert.equal(live.sourceTo, '2026-10-23T00:43:00.000Z');
  assert.equal(advice(live).recommendedMinute, 525);
});

test('exactly five-minute-old source minutes are accepted', async () => {
  const live = await observe({ polls: 1, lagMinutes: 5 });
  assert.equal(live.segments[0].minutes, 1);
  assert.equal(live.sourceTo, '2026-10-23T00:25:00.000Z');
});

test('a gap across fifteen polls is truncated to the actual fifteen-minute source window', async () => {
  const live = await observe({ stepMinutes: 2 });
  assert.equal(live.segments[0].minutes, 8);
  assert.equal(live.from, '08:43');
  assert.equal(live.to, '08:57');
  assert.equal(live.segments[0].jammed15, false);
  assert.equal(advice(live).share, null);
  assert.equal(advice(live).recommendedMinute, 510);
});

test('the four minutes before the source window warm speed without counting toward its congestion share', async () => {
  const live = await observe({ polls: 19, warmupFastPolls: 4 });
  assert.equal(live.segments[0].minutes, 15);
  assert.equal(live.from, '08:33');
  assert.equal(live.to, '08:47');
  assert.equal(live.segments[0].share15, 12 / 15);
  assert.equal(advice(live).share, 12 / 15);
});

test('a source that expires before completion produces no current window', async () => {
  const live = await observe({ finalDelayMinutes: 6 });
  assert.equal(live.segments[0].minutes, 0);
  assert.equal(live.sourceTo, null);
  assert.equal(advice(live).recommendedMinute, 510);
});

test('a two-poll check cannot publish a complete congestion conclusion or extend work hours', async () => {
  const live = await observe({ polls: 2 });
  assert.equal(live.segments[0].minutes, 2);
  assert.equal(live.segments[0].jammed15, false);
  assert.equal(advice(live).recommendedMinute, 510);
  assert.equal(advice(live).share, null);
});

test('Taipei midnight rejects yesterday even when its source is only two minutes old', async () => {
  const live = await observe({ polls: 1, start: '2026-10-23T00:01:00+08:00', sourceTime: '2026-10-22T23:59:00+08:00' });
  assert.equal(live.segments[0].minutes, 0);
  assert.equal(live.sourceTo, null);
});

test('the source date follows Taipei when UTC is still on the previous day', async () => {
  const live = await observe({ polls: 1, start: '2026-10-22T23:02:00Z' });
  assert.equal(live.date, '2026-10-23');
  assert.equal(live.from, '07:01');
  assert.equal(live.sourceTo, '2026-10-22T23:01:00.000Z');
});

for (const start of ['2026-10-23T09:16:00+08:00', '2026-10-23T22:00:00+08:00']) {
  test(`a full observation ending outside morning hours keeps historical work hours (${start})`, async () => {
    const live = await observe({ start });
    assert.equal(live.segments[0].minutes, 15);
    assert.equal(live.inWindow, false);
    assert.equal(advice(live).recommendedMinute, 510);
    assert.equal(advice(live).jammed, false);
  });
}
