import test from 'node:test';
import assert from 'node:assert/strict';
import { heatmapRows, parkPeriods, dailySeries, weekdaySeries, weekdayOf } from '../lib/dashboard.mjs';

const bins = (jamAt) => Array.from({ length: 10 }, (_, i) => [10, i === jamAt ? 6 : 0]);
const day = (date, jamAt, extra = {}) => ({ date, volume: 1500, validMinutes: 150, levelMinutes: { 1: 94, 5: 6 }, congestionProfile: { bins: bins(jamAt), observedMinutes: 100 }, ...extra });
const direction = (id, days, included = true) => ({ id, vdId: id, linkId: id, roadName: id, scope: { included, category: 'internal' }, days });

test('heatmap rows and park periods pool ranked segments only', () => {
  const ds = [direction('A', [day('2026-10-21', 3), day('2026-10-22', 3)]), direction('B', [day('2026-10-21', 5)]), direction('X', [day('2026-10-21', 0)], false)];
  const rows = heatmapRows(ds, ['2026-10-21', '2026-10-22']);
  assert.deepEqual(rows.map((row) => row.direction.id), ['A', 'B'], 'excluded segments are not part of the dashboard');
  assert.equal(rows[0].periods[3].share, 0.6);
  assert.equal(rows[0].share, 12 / 200);
  const periods = parkPeriods(rows);
  assert.equal(periods[3].congested, 12);
  assert.equal(periods[5].share, 6 / 30);
});

test('daily and weekday series label holidays and can leave them out', () => {
  assert.equal(weekdayOf('2026-10-19'), 0, 'Monday');
  const holiday = { date: '2026-10-09', name: '國慶日補假' };
  const ds = [direction('A', [day('2026-10-09', 3, { levelMinutes: { 1: 100 } }), day('2026-10-16', 3), day('2026-10-19', 3, { officialComparison: { minutes: 10, exact: 8 } })])];
  const daily = dailySeries(ds, ['2026-10-19', '2026-10-09', '2026-10-16'], [holiday]);
  assert.deepEqual(daily.map((item) => item.date), ['2026-10-09', '2026-10-16', '2026-10-19']);
  assert.equal(daily[0].holiday, '國慶日補假');
  assert.equal(daily[0].share, 0);
  assert.equal(daily[1].share, 0.06);
  assert.equal(daily[2].officialAgreement, 0.8);
  assert.equal(daily[1].perMinute, 10);
  const friday = (series) => series.find((item) => item.name === '週五');
  assert.equal(friday(weekdaySeries(daily)).days, 2);
  assert.equal(friday(weekdaySeries(daily)).share, 6 / 200);
  assert.equal(friday(weekdaySeries(daily, { skipHolidays: true })).share, 0.06);
});
