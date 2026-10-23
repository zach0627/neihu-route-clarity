import test from 'node:test';
import assert from 'node:assert/strict';
import { recentCalendarRange, weekdaysBetween } from '../lib/ranking.mjs';

test('default 30-day period ends yesterday in Taipei even when UTC is still the prior day', () => {
  const range = recentCalendarRange(new Date('2026-10-22T16:30:00Z'));
  assert.deepEqual(range, { start: '2026-09-23', end: '2026-10-22' });
  assert.equal(weekdaysBetween(range.start, range.end).length, 22);
});
test('rolling date defaults move through month and year boundaries', () => {
  assert.deepEqual(recentCalendarRange(new Date('2027-01-01T00:30:00+08:00')), { start: '2026-12-02', end: '2026-12-31' });
});
