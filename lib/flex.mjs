/** Flexible start-time recommendations per approach direction of a park company. Pure and browser-safe; no IO. */
import { buildCongestionRankings, CONGESTED_LEVELS, PROFILE_BIN_MINUTES, WINDOW_START_MINUTE, EXPECTED_MINUTES } from './ranking.mjs';
import { distanceMeters } from './park.mjs';

export const SECTORS = [
  { key: 'north', name: '北', from: 315, to: 45 },
  { key: 'east', name: '東', from: 45, to: 135 },
  { key: 'south', name: '南', from: 135, to: 225 },
  { key: 'west', name: '西', from: 225, to: 315 },
];
/** Recommendations move in the same 15-minute steps as the live check. */
export const CHECK_INTERVAL_MINUTES = PROFILE_BIN_MINUTES;
/** A 15-minute period counts as jammed when at least half of its classified minutes are E/F. */
export const JAM_SHARE = 0.5;
export const CANDIDATE_RADIUS_METERS = 2000;
const WINDOW_END_MINUTE = WINDOW_START_MINUTE + EXPECTED_MINUTES;

export const minuteText = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const parseMinute = (text) => { const [h, m] = String(text).split(':').map(Number); return h * 60 + m; };

/** Compass bearing in degrees from one [lon, lat] point to another (0 = north, 90 = east). */
export function bearingDegrees([lon1, lat1], [lon2, lat2]) {
  const dx = (lon2 - lon1) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180), dy = lat2 - lat1;
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}
export const sectorOf = (bearing) => SECTORS.find((sector) => (sector.from > sector.to ? bearing >= sector.from || bearing < sector.to : bearing >= sector.from && bearing < sector.to));

/**
 * Candidate segments of each direction: surface-road detector segments (expressways excluded, one detector per LinkID) within
 * radius of the company, whose midpoint lies in that compass sector seen from the company and whose travel direction brings the
 * vehicle closer to the company (end nearer than start).
 */
export function directionCandidates(location, directions, { radiusMeters = CANDIDATE_RADIUS_METERS } = {}) {
  const point = [location.lon, location.lat];
  const result = Object.fromEntries(SECTORS.map((sector) => [sector.key, []]));
  const seen = new Set();
  const ordered = [...directions].sort((a, b) => (a.representativePriority ?? Infinity) - (b.representativePriority ?? Infinity) || String(a.vdId).localeCompare(String(b.vdId)));
  for (const direction of ordered) {
    const geometry = direction.geometry;
    if (!geometry?.start || !geometry?.end || direction.scope?.category === 'expressway' || seen.has(direction.linkId)) continue;
    seen.add(direction.linkId);
    const mid = [(geometry.start[0] + geometry.end[0]) / 2, (geometry.start[1] + geometry.end[1]) / 2];
    if (distanceMeters(mid, point) > radiusMeters || distanceMeters(geometry.end, point) >= distanceMeters(geometry.start, point)) continue;
    result[sectorOf(bearingDegrees(point, mid)).key].push(direction);
  }
  return result;
}

/**
 * One direction: rank candidates by congested share; the benchmark is the most congested one that the authority also publishes
 * (has a Taipei section, so its levels were cross-checked), else the most congested one. Each 15-minute period is jammed when
 * >= JAM_SHARE of its minutes are E/F over the selected dates; the latest flexible start is the end of the last jammed period.
 */
export function recommendDirection(candidates, dates, { baselineMinute, jamShare = JAM_SHARE } = {}) {
  const ranked = buildCongestionRankings(candidates.map((direction) => ({ ...direction, isRepresentative: true, scope: { ...direction.scope, included: true } })), dates, { limit: Infinity });
  if (!ranked.length) return { candidates: [], benchmark: null, recommendedMinute: baselineMinute, extensionMinutes: 0, baselineMinute };
  const benchmark = ranked.find((row) => row.geometry?.sectionId) ?? ranked[0];
  const days = dates.map((date) => benchmark.days?.find((day) => day.date === date)).filter((day) => day?.congestionProfile?.observedMinutes > 0);
  const periods = Array.from({ length: EXPECTED_MINUTES / PROFILE_BIN_MINUTES }, (_, index) => {
    const classified = days.reduce((sum, day) => sum + day.congestionProfile.bins[index][0], 0);
    const congested = days.reduce((sum, day) => sum + day.congestionProfile.bins[index][1], 0);
    const jammedDays = days.filter((day) => { const [all, jam] = day.congestionProfile.bins[index]; return all > 0 && jam / all >= jamShare; }).length;
    const start = WINDOW_START_MINUTE + index * PROFILE_BIN_MINUTES;
    return { start, end: start + PROFILE_BIN_MINUTES, classified, congested, share: classified ? congested / classified : null, jammed: classified > 0 && congested / classified >= jamShare, jammedDays, days: days.length };
  });
  const jammed = periods.filter((period) => period.jammed);
  const clearMinute = jammed.length ? jammed.at(-1).end : null;
  const recommendedMinute = clearMinute == null ? baselineMinute : Math.max(baselineMinute, clearMinute);
  return {
    candidates: ranked, benchmark, verified: Boolean(benchmark.geometry?.sectionId), days: days.length, periods,
    jamStart: jammed[0]?.start ?? null, clearMinute, reachesEnd: clearMinute === WINDOW_END_MINUTE,
    recommendedMinute, extensionMinutes: Math.max(0, recommendedMinute - baselineMinute), baselineMinute, jamShare,
  };
}

export function buildFlexRecommendations(company, directions, dates, options) {
  const candidates = directionCandidates(company, directions, options);
  return SECTORS.map((sector) => ({ ...sector, ...recommendDirection(candidates[sector.key], dates, options) }));
}

/**
 * Live 15-minute rule (operating design): at check time t, take the benchmark's levels for the last 15 minutes; if at least
 * JAM_SHARE of them are E/F, the jam has not cleared and today's latest flexible start becomes max(recommendation, t + 15).
 */
export function liveUpdate(recommendedMinute, checkMinute, recentLevels, { jamShare = JAM_SHARE, interval = CHECK_INTERVAL_MINUTES } = {}) {
  const levels = recentLevels.filter((level) => level != null).slice(-interval);
  const share = levels.length ? levels.filter((level) => CONGESTED_LEVELS.includes(level)).length / levels.length : 0;
  const jammed = levels.length > 0 && share >= jamShare;
  return { jammed, share, recommendedMinute: jammed ? Math.max(recommendedMinute, checkMinute + interval) : recommendedMinute };
}
