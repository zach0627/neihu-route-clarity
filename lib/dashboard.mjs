/** Park-wide summaries for the dashboard, from the same per-day counts as the rankings. Pure and browser-safe. */
import { representativeDirections, CONGESTED_LEVELS, PROFILE_BIN_MINUTES, WINDOW_START_MINUTE, EXPECTED_MINUTES } from './ranking.mjs';

const congested = (levelMinutes = {}) => CONGESTED_LEVELS.reduce((sum, level) => sum + (levelMinutes[level] ?? 0), 0);
const classified = (levelMinutes = {}) => Object.values(levelMinutes).reduce((sum, count) => sum + count, 0);
const PERIODS = EXPECTED_MINUTES / PROFILE_BIN_MINUTES;
export const WEEKDAYS = ['週一', '週二', '週三', '週四', '週五'];
export const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay() - 1;

/** Ranked (park-bound, one per LinkID) directions only, so park-wide numbers match the two Top 10 tables. */
export const parkDirections = (directions) => representativeDirections(directions);

/** Per ranked segment: overall E/F share and the share in each 15-minute period, summed over the selected dates. */
export function heatmapRows(directions, dates) {
  return parkDirections(directions).map((direction) => {
    const days = (direction.days ?? []).filter((day) => dates.includes(day.date) && day.congestionProfile);
    const periods = Array.from({ length: PERIODS }, (_, index) => {
      const all = days.reduce((sum, day) => sum + day.congestionProfile.bins[index][0], 0), jam = days.reduce((sum, day) => sum + day.congestionProfile.bins[index][1], 0);
      return { start: WINDOW_START_MINUTE + index * PROFILE_BIN_MINUTES, classified: all, congested: jam, share: all ? jam / all : null };
    });
    const all = periods.reduce((sum, period) => sum + period.classified, 0), jam = periods.reduce((sum, period) => sum + period.congested, 0);
    return { direction, share: all ? jam / all : null, classified: all, periods };
  }).filter((row) => row.classified > 0).sort((a, b) => b.share - a.share || a.direction.id.localeCompare(b.direction.id));
}

/** Park-wide share per 15-minute period (all ranked segments pooled). */
export function parkPeriods(rows) {
  return Array.from({ length: PERIODS }, (_, index) => {
    const all = rows.reduce((sum, row) => sum + row.periods[index].classified, 0), jam = rows.reduce((sum, row) => sum + row.periods[index].congested, 0);
    return { start: WINDOW_START_MINUTE + index * PROFILE_BIN_MINUTES, classified: all, congested: jam, share: all ? jam / all : null };
  });
}

/** One point per date: park-wide E/F share, vehicles per segment-minute, data completeness and official agreement. */
export function dailySeries(directions, dates, holidays = []) {
  const ranked = parkDirections(directions);
  const holidayName = new Map(holidays.map((item) => [item.date, item.name]));
  return [...dates].sort().map((date) => {
    let jam = 0, all = 0, volume = 0, valid = 0, officialMinutes = 0, officialExact = 0;
    for (const direction of ranked) {
      const day = direction.days?.find((item) => item.date === date);
      if (!day) continue;
      jam += congested(day.levelMinutes); all += classified(day.levelMinutes);
      volume += day.volume ?? 0; valid += day.validMinutes ?? 0;
      if (day.officialComparison) { officialMinutes += day.officialComparison.minutes; officialExact += day.officialComparison.exact; }
    }
    return { date, weekday: weekdayOf(date), holiday: holidayName.get(date) ?? null, share: all ? jam / all : null, perMinute: valid ? volume / valid : null, completeness: ranked.length ? valid / (ranked.length * EXPECTED_MINUTES) : null, officialMinutes, officialAgreement: officialMinutes ? officialExact / officialMinutes : null, congested: jam, classified: all, volume, valid };
  });
}

/** Monday–Friday pooled from the daily series; holidays can be left out to show their effect. */
export function weekdaySeries(daily, { skipHolidays = false } = {}) {
  return WEEKDAYS.map((name, index) => {
    const days = daily.filter((day) => day.weekday === index && (!skipHolidays || !day.holiday));
    const jam = days.reduce((sum, day) => sum + day.congested, 0), all = days.reduce((sum, day) => sum + day.classified, 0);
    const volume = days.reduce((sum, day) => sum + day.volume, 0), valid = days.reduce((sum, day) => sum + day.valid, 0);
    return { name, days: days.length, share: all ? jam / all : null, perMinute: valid ? volume / valid : null };
  });
}
