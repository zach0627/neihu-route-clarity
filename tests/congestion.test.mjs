import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRecord, aggregateRecords, congestionLevel, buildCongestionRankings, CONGESTED_LEVELS, SEVERE_LEVEL } from '../lib/ranking.mjs';

// Same shape as the Taipei RoadClass6_default definition returned by TDX CongestionLevel/City/Taipei.
const levels = [{ Level: 6, LevelName: 'F', TopValue: 20, LowValue: 0 }, { Level: 1, LevelName: 'A', LowValue: 40 }, { Level: 2, LevelName: 'B', TopValue: 40, LowValue: 35 }, { Level: 3, LevelName: 'C', TopValue: 35, LowValue: 30 }, { Level: 4, LevelName: 'D', TopValue: 30, LowValue: 25 }, { Level: 5, LevelName: 'E', TopValue: 25, LowValue: 20 }];
const metadata = { VDID: 'VD1', DetectionLinks: [{ LinkID: 'L1', LaneNum: 2, ActualLaneNum: 2 }] };
const lane = (LaneID, volume, Speed, Occupancy = 10) => ({ LaneID, Speed, Occupancy, Vehicles: [{ VehicleType: 'S', Volume: volume }], ErrorDiags: ['diag0'] });
const record = (minute, lanes) => ({ VDID: 'VD1', Status: 0, DataCollectTime: new Date(Date.UTC(2026, 9, 21, 23, minute)).toISOString(), LinkFlows: [{ LinkID: 'L1', Lanes: lanes }] });

test('official speed bands are lower-inclusive and upper-exclusive', () => {
  assert.equal(congestionLevel(40, levels), 1);
  assert.equal(congestionLevel(39.9, levels), 2);
  assert.equal(congestionLevel(25, levels), 4);
  assert.equal(congestionLevel(24.99, levels), 5);
  assert.equal(congestionLevel(20, levels), 5);
  assert.equal(congestionLevel(19.5, levels), 6);
  assert.equal(congestionLevel(0.5, levels), 6);
  assert.equal(congestionLevel(null, levels), null);
  assert.equal(congestionLevel(30, null), null);
  assert.deepEqual(CONGESTED_LEVELS, [5, 6]);
  assert.equal(SEVERE_LEVEL, 6);
});

test('minute speed is the lane speed weighted by lane vehicles; empty minutes have no speed', () => {
  const busy = analyzeRecord(record(0, [lane(0, 30, 10), lane(1, 10, 50)]), metadata).directions[0];
  assert.equal(busy.volume, 40);
  assert.equal(busy.speed, 20, '(30×10 + 10×50) ÷ 40');
  const empty = analyzeRecord(record(1, [lane(0, 0, 0), lane(1, 0, 0)]), metadata).directions[0];
  assert.equal(empty.valid, true);
  assert.equal(empty.volume, 0);
  assert.equal(empty.speed, null);
  const flagged = record(2, [lane(0, 5, 30), lane(1, 5, 30)]); flagged.LinkFlows[0].Lanes[0].ErrorDiags = ['diag3'];
  assert.equal(analyzeRecord(flagged, metadata).directions[0].speed, null, 'invalid minutes contribute neither volume nor speed');
});

test('daily levels use the vehicle-weighted speed of the current and four previous valid minutes', () => {
  const rows = [record(0, [lane(0, 10, 10), lane(1, 10, 14)]), record(1, [lane(0, 10, 45), lane(1, 10, 45)]), record(2, [lane(0, 0, 0), lane(1, 0, 0)]), record(3, [lane(0, 5, 22), lane(1, 5, 22)]), record(4, [lane(0, 5, 30), lane(1, 5, 30)])];
  // Minute 424 has an official level but an abnormal speed (-99), as seen in real Taipei history rows; it is not compared.
  const official = new Map([[420, { level: 6, speed: 13 }], [421, { level: 1, speed: 44 }], [423, { level: 4, speed: 26 }], [424, { level: 6, speed: -99 }]]);
  const [day] = aggregateRecords(rows, [metadata], '2026-10-22', { levelsFor: () => levels, officialFor: () => official });
  assert.equal(day.validMinutes, 5);
  assert.equal(day.speedMinutes, 5, 'the empty minute 422 takes the window speed of 420–422');
  assert.equal(day.noFlowMinutes, 0);
  assert.deepEqual(day.levelMinutes, { 6: 1, 4: 4 }, '12 → F; then 28.5, 28.5, 27.2, 27.67 km/h → D');
  assert.ok(Math.abs(day.speedSum - (12 + 28.5 + 28.5 + 27.2 + 1660 / 60)) < 1e-9);
  assert.equal(day.officialComparison.minutes, 3);
  assert.equal(day.officialComparison.exact, 2);
  assert.equal(day.officialComparison.withinOne, 2);
  assert.equal(day.officialComparison.bothCongested, 1);
  assert.ok(Math.abs(day.officialComparison.speedAbsDiffSum - (1 + 15.5 + 1.2)) < 1e-9);
  const [plain] = aggregateRecords(rows, [metadata], '2026-10-22');
  assert.equal(plain.levelMinutes, undefined, 'no thresholds, no levels');
});

test('invalid minutes never enter the speed window, and a window without vehicles has no level', () => {
  const flagged = record(1, [lane(0, 10, 5), lane(1, 10, 5)]); flagged.LinkFlows[0].Lanes[0].ErrorDiags = ['diag3'];
  const rows = [record(0, [lane(0, 10, 40), lane(1, 10, 40)]), flagged, record(2, [lane(0, 10, 40), lane(1, 10, 40)]), record(10, [lane(0, 0, 0), lane(1, 0, 0)])];
  const [day] = aggregateRecords(rows, [metadata], '2026-10-22', { levelsFor: () => levels });
  assert.equal(day.validMinutes, 3);
  assert.deepEqual(day.levelMinutes, { 1: 2 }, 'the flagged 5 km/h minute does not drag minute 422 down');
  assert.equal(day.noFlowMinutes, 1, 'minute 430 has no vehicles in 426–430');
});

test('daily congestion profile has 15-minute bins and the first and last sustained jams', () => {
  // 07:00–07:09 slow (F), 07:10–07:12 fast, 07:13–07:15 slow (only 3 minutes), then fast until 09:29.
  const speeds = (minute) => (minute < 10 || (minute >= 13 && minute <= 15) ? 10 : 45);
  const rows = Array.from({ length: 150 }, (_, minute) => record(minute, [lane(0, 10, speeds(minute)), lane(1, 10, speeds(minute))]));
  const [day] = aggregateRecords(rows, [metadata], '2026-10-22', { levelsFor: () => levels });
  const profile = day.congestionProfile;
  assert.equal(profile.bins.length, 10);
  assert.equal(profile.observedMinutes, 150);
  assert.equal(profile.firstMinute, 420);
  // Window speeds: 07:10 = 17 (F), 07:11 = 24 (E), 07:12–07:14 = 31 (C), 07:15–07:17 = 24 (E), then faster.
  assert.equal(profile.lastMinute, 431, 'the 3-minute 07:15–07:17 run is not sustained, so the last sustained jam ends at 07:11');
  assert.deepEqual([profile.bins[0][1], profile.bins[1][1]], [12, 3], 'bins still count every congested minute');
});

test('single-minute speed bookkeeping keeps the vehicles behind each speed', () => {
  const busy = analyzeRecord(record(0, [lane(0, 30, 10), lane(1, 10, 50)]), metadata).directions[0];
  assert.equal(busy.speedVolume, 40);
  assert.equal(analyzeRecord(record(1, [lane(0, 0, 0), lane(1, 0, 0)]), metadata).directions[0].speedVolume, 0);
});

const direction = (id, days, included = true) => ({ id, vdId: id, linkId: id, scope: { included }, days });
test('congestion ranking orders by congested share, then severe share, then mean speed, without filling', () => {
  const ds = [
    direction('A', [{ date: '2026-10-21', speedMinutes: 100, speedSum: 2500, noFlowMinutes: 0, levelMinutes: { 1: 50, 5: 30, 6: 20 } }]),
    direction('B', [{ date: '2026-10-21', speedMinutes: 10, speedSum: 150, noFlowMinutes: 40, levelMinutes: { 5: 2, 6: 3, 4: 5 } }]),
    direction('C', [{ date: '2026-10-21', speedMinutes: 100, speedSum: 3000, levelMinutes: { 5: 40, 6: 10, 1: 50 } }]),
    direction('D', [{ date: '2026-10-21', speedMinutes: 0, speedSum: 0, levelMinutes: {} }]),
    direction('E', [{ date: '2026-10-21', speedMinutes: 100, speedSum: 500, levelMinutes: { 6: 100 } }], false),
  ];
  const ranks = buildCongestionRankings(ds, ['2026-10-21']);
  assert.deepEqual(ranks.map((row) => row.vdId), ['B', 'A', 'C'], 'all three tie at 50%; F shares are B 30%, A 20%, C 10%');
  assert.equal(ranks[1].congestedShare, 50);
  assert.equal(ranks[1].severeShare, 20);
  assert.equal(ranks[1].averageSpeed, 25);
  assert.equal(ranks[0].noFlowMinutes, 40);
  assert.equal(ranks[0].classifiedMinutes, 10);
  const slower = direction('F', [{ date: '2026-10-21', speedMinutes: 100, speedSum: 1000, levelMinutes: { 5: 30, 6: 20, 1: 50 } }]);
  assert.deepEqual(buildCongestionRankings([ds[0], slower], ['2026-10-21']).map((row) => row.vdId), ['F', 'A'], 'equal shares fall back to the lower mean speed');
  assert.deepEqual(buildCongestionRankings(ds, []), []);
  assert.deepEqual(buildCongestionRankings(ds, ['2026-10-22']), [], 'dates without data never become zero congestion');
});
