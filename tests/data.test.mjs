import test from 'node:test';
import assert from 'node:assert/strict';
import { weekdaysBetween, taipeiMinute, analyzeRecord, aggregateRecords, buildRankings, buildObservedRankings } from '../lib/ranking.mjs';

const metadata = { VDID: 'VD1', TownName: '內湖區', RoadName: '港墘路', PositionLat: 25.08, PositionLon: 121.57, DetectionLinks: [{ LinkID: 'L1', Bearing: 'SW', RoadDirection: 'SW', LaneNum: 2, ActualLaneNum: 2 }] };
const lane = (LaneID, volumes = [3, 2]) => ({ LaneID, Vehicles: volumes.map((Volume, i) => ({ VehicleType: ['S', 'M'][i], Volume })), ErrorDiags: ['diag0'] });
const record = (time = '2026-10-22T07:00:00+08:00') => ({ VDID: 'VD1', Status: 0, DataCollectTime: time, LinkFlows: [{ LinkID: 'L1', Lanes: [lane(0), lane(1, [4, 1])] }] });
const direction = (vdId, linkId, volumes, included = true) => ({ id: `${vdId}:${linkId}`, vdId, linkId, scope: { included, status: 'proposed' }, days: volumes.map(([date, volume, validMinutes = 150]) => ({ date, volume, receivedMinutes: 150, validMinutes })) });

test('dates use Monday through Friday and retain inclusive date boundaries', () => {
  assert.deepEqual(weekdaysBetween('2026-10-16', '2026-10-20'), ['2026-10-16', '2026-10-19', '2026-10-20']);
  assert.equal(weekdaysBetween('2026-09-23', '2026-10-22').length, 22);
  assert.throws(() => weekdaysBetween('2026-02-30', '2026-03-02'), /date/i);
});

test('Taipei minute window includes 07:00 and excludes 09:30 regardless of source offset', () => {
  assert.deepEqual(taipeiMinute('2026-10-21T23:00:00Z'), { date: '2026-10-22', minute: 420, second: 0, inWindow: true });
  assert.equal(taipeiMinute('2026-10-22T06:59:00+08:00').inWindow, false);
  assert.equal(taipeiMinute('2026-10-22T09:29:00+08:00').inWindow, true);
  assert.equal(taipeiMinute('2026-10-22T09:30:00+08:00').inWindow, false);
  assert.equal(taipeiMinute('not-a-date'), null);
});

test('each real minute sums every lane and vehicle class exactly once', () => {
  const result = analyzeRecord(record(), metadata);
  assert.equal(result.directions[0].valid, true);
  assert.equal(result.directions[0].volume, 10);
  assert.deepEqual(result.directions[0].laneVolumes.map((v) => v.volume), [5, 5]);
});

test('strict quality rejects abnormal status, lane mismatch, duplicate IDs and flagged data', () => {
  const badStatus = record(); badStatus.Status = 1;
  assert.ok(analyzeRecord(badStatus, metadata).directions[0].reasons.includes('status'));
  const missingLane = record(); missingLane.LinkFlows[0].Lanes.pop();
  assert.ok(analyzeRecord(missingLane, metadata).directions[0].reasons.includes('lane_count'));
  const duplicateLane = record(); duplicateLane.LinkFlows[0].Lanes[1].LaneID = 0;
  assert.ok(analyzeRecord(duplicateLane, metadata).directions[0].reasons.includes('duplicate_lane'));
  const flagged = record(); flagged.LinkFlows[0].Lanes[0].ErrorDiags = ['diag0', 'diag4'];
  assert.ok(analyzeRecord(flagged, metadata).directions[0].reasons.includes('error_diag'));
  const negative = record(); negative.LinkFlows[0].Lanes[0].Vehicles[0].Volume = -99;
  assert.equal(analyzeRecord(negative, metadata).directions[0].volume, null);
  const missingDiags = record(); delete missingDiags.LinkFlows[0].Lanes[0].ErrorDiags;
  assert.equal(analyzeRecord(missingDiags, metadata).directions[0].valid, false);
});

test('missing and duplicate vehicle classes invalidate a direction-minute', () => {
  const missing = record(); missing.LinkFlows[0].Lanes[0].Vehicles = [];
  assert.equal(analyzeRecord(missing, metadata).directions[0].valid, false);
  const repeated = record(); repeated.LinkFlows[0].Lanes[0].Vehicles.push({ VehicleType: 'S', Volume: 100 });
  assert.ok(analyzeRecord(repeated, metadata).directions[0].reasons.includes('duplicate_vehicle_type'));
});

test('identical minute reports count once; conflicting duplicates invalidate that minute', () => {
  const one = record();
  const repeated = { ...record(), UpdateTime: '2026-10-22T08:00:00+08:00' };
  let days = aggregateRecords([one, repeated], [metadata], '2026-10-22');
  assert.equal(days[0].receivedMinutes, 1);
  assert.equal(days[0].validMinutes, 1);
  assert.equal(days[0].volume, 10);
  const conflict = record(); conflict.LinkFlows[0].Lanes[0].Vehicles[0].Volume = 99;
  days = aggregateRecords([one, conflict, one], [metadata], '2026-10-22');
  assert.equal(days[0].validMinutes, 0);
  assert.equal(days[0].volume, null);
  assert.equal(days[0].reasonCounts.conflicting_duplicate, 1);
});

test('a missing minute remains missing and partial observed volume is never expanded', () => {
  const rows = Array.from({ length: 149 }, (_, i) => record(new Date(Date.UTC(2026, 9, 21, 23, i)).toISOString()));
  const [day] = aggregateRecords(rows, [metadata], '2026-10-22');
  assert.equal(day.validMinutes, 149);
  assert.equal(day.volume, 1490);
  assert.equal(day.reasonCounts.missing_minute, 1);
  assert.deepEqual(buildRankings([{ ...direction('VD1', 'L1', []), days: [day] }], ['2026-10-22']), []);
});

test('ranks require all 150 valid minutes on the same supplied dates for every direction', () => {
  const ds = [
    direction('A', 'L1', [['2026-10-21', 100], ['2026-10-22', 400]]),
    direction('B', 'L2', [['2026-10-21', 1000, 149], ['2026-10-22', 900]]),
    direction('C', 'L3', [['2026-10-22', 600]]),
    direction('D', 'L4', [['2026-10-21', 300], ['2026-10-22', 400]], false),
  ];
  const ranks = buildRankings(ds, ['2026-10-21', '2026-10-22']);
  assert.equal(ranks.length, 1);
  assert.equal(ranks[0].totalVolume, 500);
  assert.equal(ranks[0].averageDailyVolume, 250);
  assert.equal(ranks[0].validDays, 2);
  assert.deepEqual(ranks[0].commonDays, ['2026-10-21', '2026-10-22']);
  assert.equal(buildRankings(ds, []).length, 0);
  assert.equal(buildRankings(ds, ['2026-10-22'])[0].vdId, 'B');
});

test('serial detectors with the same LinkID select a stable representative without adding', () => {
  const a = direction('A', 'L1', [['2026-10-22', 100]]);
  const b = direction('B', 'L1', [['2026-10-22', 900]]);
  assert.deepEqual(buildRankings([b, a], ['2026-10-22']).map((d) => d.totalVolume), [100]);
  b.representative = true;
  assert.deepEqual(buildRankings([a, b], ['2026-10-22']).map((d) => d.totalVolume), [900]);
});

test('measurement duplicates with reordered lanes and vehicle classes retain one minute', () => {
  const a = record();
  const b = record(); b.LinkFlows[0].Lanes.reverse();
  b.LinkFlows[0].Lanes[0].Vehicles.reverse();
  const [day] = aggregateRecords([a, b], [metadata], '2026-10-22');
  assert.equal(day.validMinutes, 1);
  assert.equal(day.volume, 10);
});

test('quality screening detects partially monitored roads and non-minute-aligned records', () => {
  const partial = structuredClone(metadata); partial.DetectionLinks[0].ActualLaneNum = 3;
  assert.ok(analyzeRecord(record(), partial).directions[0].reasons.includes('partial_lane_coverage'));
  assert.ok(analyzeRecord(record('2026-10-22T07:00:30+08:00'), metadata).directions[0].reasons.includes('timestamp_alignment'));
  const [day] = aggregateRecords([record(), record('2026-10-22T07:00:30+08:00')], [metadata], '2026-10-22');
  assert.equal(day.validMinutes, 0);
});

test('configured representative priority takes precedence over station ID and traffic volume', () => {
  const a = direction('A', 'L1', [['2026-10-22', 900]]); a.representativePriority = 2;
  const b = direction('B', 'L1', [['2026-10-22', 100]]); b.representativePriority = 1;
  assert.equal(buildRankings([a, b], ['2026-10-22'])[0].vdId, 'B');
});

test('observed ranking compares measured minute means without expanding partial counts', () => {
  const ds = [
    direction('A', 'L1', [['2026-10-21', 1000, 100], ['2026-10-22', 1000, 100]]),
    direction('B', 'L2', [['2026-10-21', 1200, 50]]),
    direction('C', 'L3', [['2026-10-21', null, 0]]),
    direction('D', 'L4', [['2026-10-21', 9999, 1]], false),
  ];
  const ranks = buildObservedRankings(ds, ['2026-10-21', '2026-10-22', '2026-10-22']);
  assert.deepEqual(ranks.map((d) => d.vdId), ['B', 'A']);
  assert.equal(ranks[0].averageMinuteVolume, 24);
  assert.equal(ranks[0].totalObservedVolume, 1200);
  assert.equal(ranks[0].validMinutes, 50);
  assert.equal(ranks[0].expectedMinutes, 300);
  assert.equal(ranks[0].observedDays, 1);
  assert.equal(ranks[0].averageDailyVolume, undefined);
  assert.deepEqual(ranks[0].selectedDates, ['2026-10-21', '2026-10-22']);
  assert.equal(buildRankings(ds, ['2026-10-21', '2026-10-22']).length, 0);
});

test('observed comparison retains genuine zero counts, stable representatives and date filters', () => {
  const a = direction('A', 'L1', [['2026-10-21', 0, 149], ['2026-10-22', 30, 2]]);
  const b = direction('B', 'L1', [['2026-10-21', 900, 150]]);
  const invalid = direction('C', 'L2', [['2026-10-21', -1, 150], ['2026-10-22', 100, 151]]);
  const result = buildObservedRankings([b, invalid, a], ['2026-10-21']);
  assert.equal(result.length, 1);
  assert.equal(result[0].vdId, 'A');
  assert.equal(result[0].averageMinuteVolume, 0);
  assert.equal(result[0].validMinutes, 149);
  assert.equal(buildObservedRankings([a], ['2026-10-22'])[0].averageMinuteVolume, 15);
  assert.deepEqual(buildObservedRankings([a], []), []);
});

test('snapshot records missing requested dates, actual evidence, and partial coverage', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { buildSnapshot } = await import('../scripts/aggregate.mjs');
  const root = await mkdtemp(join(tmpdir(), 'neihu-data-test-'));
  try {
    await mkdir(join(root, 'research')); await mkdir(join(root, 'config'));
    await writeFile(join(root, 'research/2026-10-22-taipei-vd-static.jsonl'), `${JSON.stringify(metadata)}\n`);
    const rows = Array.from({ length: 150 }, (_, i) => record(new Date(Date.UTC(2026, 9, 21, 23, i)).toISOString()));
    await writeFile(join(root, 'research/2026-10-22-neihu-morning.jsonl'), rows.map(JSON.stringify).join('\n'));
    await writeFile(join(root, 'config/directions.json'), JSON.stringify({ directions: [{ vdId: 'VD1', linkId: 'L1', included: true, status: 'proposed', reason: 'Test geographic assumption' }] }));
    const uncommitted = await buildSnapshot({ root, start: '2026-10-21', end: '2026-10-22' });
    assert.deepEqual(uncommitted.coverage.availableDates, []);
    assert.equal(uncommitted.coverage.pendingDates.length, 2);
    await writeFile(join(root, 'research/2026-10-22-download-manifest.json'), JSON.stringify({ date: '2026-10-22', download: { status: 'completed' } }));
    const snapshot = await buildSnapshot({ root, start: '2026-10-21', end: '2026-10-22' });
    assert.equal(snapshot.coverage.status, 'partial');
    assert.deepEqual(snapshot.coverage.requestedDates, ['2026-10-21', '2026-10-22']);
    assert.deepEqual(snapshot.coverage.availableDates, ['2026-10-22']);
    assert.equal(snapshot.coverage.failedDates.length, 0);
    assert.equal(snapshot.coverage.pendingDates[0].date, '2026-10-21');
    assert.equal(snapshot.rankings[0].totalObservedVolume, 1500);
    assert.equal(snapshot.rankings[0].averageMinuteVolume, 10);
    assert.equal(snapshot.strictRankings[0].totalVolume, 1500);
    assert.equal(snapshot.sample.calculation.total, 10);
    assert.ok(snapshot.sample.dynamic.LinkFlows);
    assert.match(snapshot.sources[0].sha256, /^[a-f0-9]{64}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('official reference geometry decides scope, and congestion and authority comparison enter the snapshot', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { buildSnapshot } = await import('../scripts/aggregate.mjs');
  const root = await mkdtemp(join(tmpdir(), 'neihu-geometry-test-'));
  try {
    await mkdir(join(root, 'research')); await mkdir(join(root, 'data'));
    const twoLinks = { ...metadata, DetectionLinks: [{ LinkID: 'IN', Bearing: 'E', RoadDirection: 'E', LaneNum: 2, ActualLaneNum: 2 }, { LinkID: 'OUT', Bearing: 'W', RoadDirection: 'W', LaneNum: 2, ActualLaneNum: 2 }] };
    await writeFile(join(root, 'research/2026-10-22-taipei-vd-static.jsonl'), `${JSON.stringify(twoLinks)}\n`);
    const flows = (minute, speed) => ({ VDID: 'VD1', Status: 0, DataCollectTime: new Date(Date.UTC(2026, 9, 21, 23, minute)).toISOString(), LinkFlows: ['IN', 'OUT'].map((LinkID) => ({ LinkID, Lanes: [0, 1].map((LaneID) => ({ LaneID, Speed: speed, Occupancy: 20, Vehicles: [{ VehicleType: 'S', Volume: 6 }], ErrorDiags: ['diag0'] })) })) });
    // Five-minute window: minute 1 is (15×12 + 70×12) ÷ 24 = 42.5 km/h → A.
    await writeFile(join(root, 'research/2026-10-22-neihu-morning.jsonl'), [flows(0, 15), flows(1, 70)].map(JSON.stringify).join('\n'));
    await writeFile(join(root, 'research/2026-10-22-download-manifest.json'), JSON.stringify({ date: '2026-10-22', download: { status: 'completed' } }));
    const official = [{ SectionID: 'L_IN', TravelSpeed: 16, CongestionLevel: '6', DataCollectTime: '2026-10-21T23:00:00+00:00' }, { SectionID: 'L_IN', TravelSpeed: 44, CongestionLevel: '1', DataCollectTime: '2026-10-21T23:01:00+00:00' }].map(JSON.stringify).join('\n') + '\n';
    await writeFile(join(root, 'research/2026-10-22-section-live-morning.jsonl'), official);
    await writeFile(join(root, 'research/2026-10-22-section-manifest.json'), JSON.stringify({ status: 'completed', morningFile: '2026-10-22-section-live-morning.jsonl', morningFileSHA256: createHash('sha256').update(official).digest('hex') }));
    const levels = [{ Level: 6, LevelName: 'F', TopValue: 20, LowValue: 0 }, { Level: 1, LevelName: 'A', LowValue: 40 }, { Level: 5, LevelName: 'E', TopValue: 25, LowValue: 20 }];
    const parkAddress = { query: 'Q0', matchedAddress: '臺北市內湖區測試園區路1號', lon: 121.575, lat: 25.0752, accepted: true };
    await writeFile(join(root, 'data/reference.json'), JSON.stringify({
      boundary: { ranges: [{ road: '測試園區路', parity: 'all' }] },
      geocodes: [parkAddress, { query: 'Q9', matchedAddress: '臺北市內湖區其他路1號', lon: 121.6, lat: 25.1, accepted: false, reason: '不在官方範圍' }],
      parkRoads: [{ road: '測試園區路', links: [{ LinkID: 'P1', direction: 'E', start: [121.5745, 25.0751], end: [121.578, 25.0751], shape: [[121.5745, 25.0751], [121.578, 25.0751]] }] }],
      links: [{ LinkID: 'IN', RoadClass: 6, RoadClassName: '市區一般道路', Length: 0.3, StartPoint: [121.565, 25.075], EndPoint: [121.575, 25.075] }, { LinkID: 'OUT', RoadClass: 6, RoadClassName: '市區一般道路', Length: 0.3, StartPoint: [121.575, 25.075], EndPoint: [121.565, 25.075] }],
      congestionLevels: [{ CongestionLevelID: 'RoadClass6_default', CongestionLevelName: '市區一般道路', MeasureIndex: 'Speed', Levels: levels }],
      sections: [{ SectionID: 'L_IN', LinkIDs: ['IN'], CongestionLevelID: 'RoadClass6_default' }],
      sources: [{ name: 'links', method: 'POST', url: 'https://tdx.transportdata.tw/api/basic/v2/Road/Link/LinkID', fetchedAt: '2026-10-23T00:00:00Z', sha256: 'x' }],
    }));
    const snapshot = await buildSnapshot({ root, start: '2026-10-22', end: '2026-10-22' });
    const byLink = Object.fromEntries(snapshot.directions.map((direction) => [direction.linkId, direction]));
    assert.equal(byLink.IN.scope.category, 'entering');
    assert.equal(byLink.IN.scope.included, true);
    assert.equal(byLink.IN.scope.status, 'geometry');
    assert.equal(byLink.OUT.scope.category, 'leaving');
    assert.equal(byLink.OUT.scope.included, false);
    assert.deepEqual(snapshot.rankings.map((row) => row.linkId), ['IN'], 'leaving links never enter the volume ranking');
    assert.equal(snapshot.congestionRankings[0].linkId, 'IN');
    assert.equal(snapshot.congestionRankings[0].congestedShare, 50);
    assert.deepEqual(byLink.IN.days[0].levelMinutes, { 6: 1, 1: 1 });
    assert.equal(byLink.IN.geometry.congestionLevelId, 'RoadClass6_default');
    assert.equal(snapshot.validation.minutes, 2);
    assert.equal(snapshot.validation.exact, 2);
    assert.equal(snapshot.meta.park.acceptedPoints.length, 1);
    assert.equal(snapshot.meta.park.stretches.length, 1);
    assert.equal(snapshot.meta.park.rejectedPoints.length, 1);
    assert.deepEqual(snapshot.summary.categories, { entering: 1, internal: 0, leaving: 1, outside: 0, expressway: 0 });
    assert.equal(snapshot.meta.park.radiusMeters, 80, 'default radius when no scopeRule is configured');
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function createCacheFixture() {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const root = await mkdtemp(join(tmpdir(), 'neihu-integrity-test-'));
  await mkdir(join(root, 'research'));
  const staticText = `${JSON.stringify(metadata)}\n`;
  const morningText = `${JSON.stringify(record())}\n`;
  const staticPath = join(root, 'research/2026-10-22-taipei-vd-static.jsonl');
  const morningPath = join(root, 'research/2026-10-22-neihu-morning.jsonl');
  const manifestPath = join(root, 'research/2026-10-22-download-manifest.json');
  await writeFile(staticPath, staticText); await writeFile(morningPath, morningText);
  const hash = (content) => createHash('sha256').update(content).digest('hex');
  const manifest = { date: '2026-10-22', download: { status: 'completed' }, staticFileSHA256: hash(staticText), morningFileSHA256: hash(morningText) };
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, staticPath, morningPath, manifestPath, manifest, writeFile, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('tampered cached bytes cannot add an available date or any derived direction', async (t) => {
  const { buildSnapshot } = await import('../scripts/aggregate.mjs');
  for (const field of ['staticPath', 'morningPath']) await t.test(field, async () => {
    const fixture = await createCacheFixture();
    try {
      const { readFile } = await import('node:fs/promises');
      await fixture.writeFile(fixture[field], `${await readFile(fixture[field], 'utf8')}\n`);
      const snapshot = await buildSnapshot({ root: fixture.root, start: '2026-10-22', end: '2026-10-22' });
      assert.deepEqual(snapshot.coverage.availableDates, []);
      assert.equal(snapshot.coverage.failedDates.length, 1);
      assert.match(snapshot.coverage.failedDates[0].reason, /SHA-256/);
      assert.deepEqual(snapshot.directions, []);
      assert.deepEqual(snapshot.dailyStats, []);
      assert.deepEqual(snapshot.sources, []);
      assert.equal(snapshot.sample, null);
    } finally { await fixture.cleanup(); }
  });
});

test('completed cache with only unknown stations or another date is not available', async () => {
  const { buildSnapshot } = await import('../scripts/aggregate.mjs');
  const fixture = await createCacheFixture();
  try {
    const rows = [record('2026-10-21T07:00:00+08:00'), { ...record(), VDID: 'UNKNOWN' }];
    await fixture.writeFile(fixture.morningPath, rows.map(JSON.stringify).join('\n'));
    delete fixture.manifest.morningFileSHA256;
    await fixture.writeFile(fixture.manifestPath, JSON.stringify(fixture.manifest));
    const snapshot = await buildSnapshot({ root: fixture.root, start: '2026-10-22', end: '2026-10-22' });
    assert.deepEqual(snapshot.coverage.availableDates, []);
    assert.match(snapshot.coverage.failedDates[0].reason, /內湖區.*早尖峰/);
    assert.deepEqual(snapshot.directions, []);
  } finally { await fixture.cleanup(); }
});
