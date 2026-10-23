import test from 'node:test';
import assert from 'node:assert/strict';
import { bearingDegrees, sectorOf, directionCandidates, recommendDirection, buildFlexRecommendations, liveUpdate, minuteText, parseMinute } from '../lib/flex.mjs';

const company = { lon: 121.57, lat: 25.08 };
// A segment of ~200 m whose midpoint is offset (dx, dy) degrees from the company; `toward` makes it end nearer the company.
const segment = (id, dx, dy, { toward = true, category = 'internal', section = null, linkId = id, bins = null } = {}) => {
  const far = [company.lon + dx * 1.1, company.lat + dy * 1.1], near = [company.lon + dx * 0.9, company.lat + dy * 0.9];
  return { id, vdId: id, linkId, roadName: `測試路${id}`, bearing: 'W', scope: { included: category !== 'outside', category }, isRepresentative: true, geometry: { start: toward ? far : near, end: toward ? near : far, sectionId: section }, days: bins ? [{ date: '2026-10-22', speedMinutes: 150, speedSum: 3000, levelMinutes: { 1: 150 - bins.reduce((s, [, c]) => s + c, 0), 5: bins.reduce((s, [, c]) => s + c, 0) }, congestionProfile: { bins, firstMinute: null, lastMinute: null, observedMinutes: 150 } }] : [] };
};
const quietBins = () => Array.from({ length: 10 }, () => [15, 0]);

test('compass sectors follow bearing from the company', () => {
  assert.equal(Math.round(bearingDegrees([121.57, 25.08], [121.57, 25.09])), 0);
  assert.equal(Math.round(bearingDegrees([121.57, 25.08], [121.58, 25.08])), 90);
  assert.equal(sectorOf(10).key, 'north');
  assert.equal(sectorOf(330).key, 'north');
  assert.equal(sectorOf(45).key, 'east');
  assert.equal(sectorOf(180).key, 'south');
  assert.equal(sectorOf(300).key, 'west');
  assert.equal(minuteText(555), '09:15');
  assert.equal(parseMinute('08:30'), 510);
});

test('candidates approach the company, stay within the radius, skip expressways and repeat LinkIDs', () => {
  const directions = [
    segment('E1', 0.008, 0), segment('E2', 0.008, 0.001, { toward: false }), segment('E3', 0.03, 0),
    segment('N1', 0, 0.006), segment('X1', -0.006, 0, { category: 'expressway' }), segment('S1', 0, -0.006, { category: 'outside' }), segment('S2', 0.0001, -0.006, { linkId: 'S1' }),
  ];
  const groups = directionCandidates(company, directions);
  assert.deepEqual(groups.east.map((d) => d.id), ['E1'], 'E2 drives away and E3 is beyond 2 km');
  assert.deepEqual(groups.north.map((d) => d.id), ['N1']);
  assert.deepEqual(groups.west, [], 'expressway segments are not candidates');
  assert.deepEqual(groups.south.map((d) => d.id), ['S1'], 'outside-scope surface roads count, one detector per LinkID');
});

test('the benchmark prefers an officially published section; the last jammed 15-minute period sets the latest start', () => {
  const hot = quietBins().map(([all], i) => [all, i >= 1 ? 12 : 0]);
  const verified = quietBins(); verified[5] = [15, 9]; verified[6] = [15, 8]; verified[7] = [15, 6];
  const directions = [segment('HOT', 0.008, 0, { bins: hot }), segment('OK', 0.008, 0.0005, { section: 'L_OK', bins: verified })];
  const rec = recommendDirection(directions, ['2026-10-22'], { baselineMinute: parseMinute('08:30') });
  assert.equal(rec.benchmark.id, 'OK', 'the hotter segment has no official section');
  assert.equal(rec.verified, true);
  assert.deepEqual(rec.periods.filter((p) => p.jammed).map((p) => minuteText(p.start)), ['08:15', '08:30'], '9/15 and 8/15 are at least half; 6/15 is not');
  assert.equal(minuteText(rec.clearMinute), '08:45');
  assert.equal(minuteText(rec.recommendedMinute), '08:45');
  assert.equal(rec.extensionMinutes, 15);
  assert.equal(rec.periods[5].jammedDays, 1);
  const early = recommendDirection(directions, ['2026-10-22'], { baselineMinute: parseMinute('09:00') });
  assert.equal(minuteText(early.recommendedMinute), '09:00', 'never earlier than the company start');
  assert.equal(early.extensionMinutes, 0);
});

test('jams to the end of the window, unverified fallbacks and empty directions are reported as such', () => {
  const late = quietBins(); late[9] = [15, 10];
  const rec = recommendDirection([segment('L', 0.008, 0, { bins: late })], ['2026-10-22'], { baselineMinute: 510 });
  assert.equal(rec.verified, false);
  assert.equal(rec.reachesEnd, true);
  assert.equal(minuteText(rec.recommendedMinute), '09:30');
  const none = recommendDirection([], ['2026-10-22'], { baselineMinute: 510 });
  assert.equal(none.benchmark, null);
  assert.equal(none.recommendedMinute, 510);
  const all = buildFlexRecommendations(company, [segment('E1', 0.008, 0, { bins: quietBins() })], ['2026-10-22'], { baselineMinute: 510 });
  assert.deepEqual(all.map((r) => r.key), ['north', 'east', 'south', 'west']);
  assert.equal(all[1].clearMinute, null, 'no jammed period keeps the standard start');
});

test('live 15-minute rule extends today only while the last 15 minutes are mostly jammed', () => {
  assert.deepEqual(liveUpdate(540, 540, [...Array(7).fill(1), ...Array(8).fill(6)]), { jammed: true, share: 8 / 15, recommendedMinute: 555 });
  assert.equal(liveUpdate(540, 525, Array(15).fill(5)).recommendedMinute, 540, 'never earlier than the historical recommendation');
  assert.equal(liveUpdate(540, 540, [...Array(8).fill(1), ...Array(7).fill(6)]).jammed, false);
  assert.equal(liveUpdate(540, 540, []).jammed, false);
});
