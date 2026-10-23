import { taipeiMinute, congestionLevel, SPEED_WINDOW_MINUTES } from './ranking.mjs';
import { CHECK_INTERVAL_MINUTES } from './flex.mjs';

const MINUTE_MS = 60000;
const DAY_MINUTES = 1440;
const TAIPEI_OFFSET_MINUTES = 480;

/** A source minute must belong to the poll's Taipei date and be at most five minutes old. */
export function freshLiveMinute(timestamp, polledAt) {
  const source = taipeiMinute(timestamp);
  const poll = Number.isFinite(polledAt) ? taipeiMinute(new Date(polledAt).toISOString()) : null;
  const stamp = Date.parse(timestamp);
  const age = polledAt - stamp;
  if (!source || !poll || source.date !== poll.date || stamp % MINUTE_MS !== 0 || age < 0 || age > 5 * MINUTE_MS) return null;
  return stamp / MINUTE_MS;
}

/** Anchor one real 15-minute window to the latest source still fresh at completion. */
export function liveObservationWindow(sourceMinutes, endedAt) {
  const fresh = sourceMinutes.filter(minute => Number.isInteger(minute) && freshLiveMinute(new Date(minute * MINUTE_MS).toISOString(), endedAt) != null);
  if (!fresh.length) return null;
  const end = Math.max(...fresh);
  const dayStart = Math.floor((end + TAIPEI_OFFSET_MINUTES) / DAY_MINUTES) * DAY_MINUTES - TAIPEI_OFFSET_MINUTES;
  const start = Math.max(dayStart, end - CHECK_INTERVAL_MINUTES + 1);
  const observed = sourceMinutes.filter(minute => minute >= start && minute <= end);
  return {
    start, end, warmupStart: Math.max(dayStart, start - SPEED_WINDOW_MINUTES + 1),
    sourceFrom: new Date(Math.min(...observed) * MINUTE_MS).toISOString(),
    sourceTo: new Date(end * MINUTE_MS).toISOString(),
  };
}

/** Only window minutes count; the preceding four minutes may warm the weighted speed. */
export function liveWindowLevels(minutesMap, levels, window) {
  if (!minutesMap || !levels || !window) return [];
  return [...minutesMap.keys()].filter(minute => minute >= window.start && minute <= window.end).sort((a, b) => a - b).map(epochMinute => {
    if (!minutesMap.get(epochMinute)?.valid) return null;
    let weight = 0, total = 0;
    for (let back = 0; back < SPEED_WINDOW_MINUTES && epochMinute - back >= window.warmupStart; back++) {
      const earlier = minutesMap.get(epochMinute - back);
      if (earlier?.valid && earlier.speed != null) { weight += earlier.speedVolume; total += earlier.speed * earlier.speedVolume; }
    }
    const minute = (epochMinute + TAIPEI_OFFSET_MINUTES) % DAY_MINUTES;
    return weight ? { minute, epochMinute, speed: total / weight, level: congestionLevel(total / weight, levels) } : null;
  }).filter(Boolean);
}
