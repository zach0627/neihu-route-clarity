/** Shared, browser-safe calculation rules. No IO or credentials enter this module. */
export const EXPECTED_MINUTES = 150;
/** Minutes in the trailing speed window: the current minute and the four before it. */
export const SPEED_WINDOW_MINUTES = 5;
/** 07:00 in minutes after Taipei midnight; profiles cover [07:00, 09:30). */
export const WINDOW_START_MINUTE = 420;
export const PROFILE_BIN_MINUTES = 15;
/** A congestion run counts as sustained when at least this many consecutive minutes are congested. */
export const SUSTAINED_MINUTES = 5;
const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid ISO date');
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Invalid ISO date');
  return time;
}

/** Latest 30 complete calendar days, interpreted in Taipei, independent of host timezone. */
export function recentCalendarRange(now = new Date()) {
  const local = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  if (!Number.isFinite(local.getTime())) throw new Error('Invalid reference date');
  const end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - DAY_MS);
  return { start: new Date(end.getTime() - 29 * DAY_MS).toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Calendar dates are inclusive; workday here means Monday–Friday, including public holidays. */
export function weekdaysBetween(start, end) {
  const first = parseDate(start);
  const last = parseDate(end);
  if (first > last) throw new Error('Start date must be before end date');
  const dates = [];
  for (let time = first; time <= last; time += DAY_MS) {
    const date = new Date(time);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

/** Taiwan has UTC+08 throughout the data period; use UTC getters to avoid host timezone changes. */
export function taipeiMinute(timestamp) {
  if (typeof timestamp !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(timestamp)) return null;
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time + TAIPEI_OFFSET_MS);
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  return { date: date.toISOString().slice(0, 10), minute, second: date.getUTCSeconds(), inWindow: minute >= 420 && minute < 570 };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** One VD record yields independently screened direction-minutes. Invalid sums remain null. */
export function analyzeRecord(record, staticVD) {
  const time = taipeiMinute(record?.DataCollectTime);
  const result = { timestamp: record?.DataCollectTime ?? null, date: time?.date ?? null, minute: time?.minute ?? null, inWindow: Boolean(time?.inWindow), directions: [] };
  if (!staticVD || !Array.isArray(staticVD.DetectionLinks)) return result;
  for (const link of staticVD.DetectionLinks) {
    const reasons = [];
    if (record?.VDID !== staticVD.VDID) reasons.push('station_mismatch');
    if (!time) reasons.push('timestamp');
    else if (time.second !== 0 || Date.parse(record.DataCollectTime) % 1000 !== 0) reasons.push('timestamp_alignment');
    if (record?.Status !== 0) reasons.push('status');
    const matches = (Array.isArray(record?.LinkFlows) ? record.LinkFlows : []).filter((flow) => flow.LinkID === link.LinkID);
    if (matches.length !== 1) reasons.push(matches.length ? 'duplicate_link' : 'missing_link');
    const flow = matches[0];
    const lanes = Array.isArray(flow?.Lanes) ? flow.Lanes : [];
    if (!Number.isInteger(link.LaneNum) || link.LaneNum <= 0 || lanes.length !== link.LaneNum) reasons.push('lane_count');
    if (link.ActualLaneNum !== undefined && (!Number.isInteger(link.ActualLaneNum) || link.ActualLaneNum !== link.LaneNum)) reasons.push('partial_lane_coverage');
    const laneIds = lanes.map((lane) => lane.LaneID);
    if (laneIds.some((id) => !Number.isInteger(id) || id < 0)) reasons.push('lane_id');
    if (new Set(laneIds).size !== laneIds.length) reasons.push('duplicate_lane');
    const laneVolumes = [];
    let speedWeight = 0, speedTotal = 0, occupancyTotal = 0, speedInvalid = false;
    for (const lane of lanes) {
      const flags = lane.ErrorDiags;
      if (!Array.isArray(flags) || flags.length === 0 || flags.some((flag) => flag !== 'diag0')) reasons.push('error_diag');
      const vehicles = Array.isArray(lane.Vehicles) ? lane.Vehicles : [];
      if (vehicles.length === 0) reasons.push('missing_vehicles');
      const classes = vehicles.map((vehicle) => vehicle.VehicleType);
      if (classes.some((type) => typeof type !== 'string' || type.length === 0)) reasons.push('vehicle_type');
      if (new Set(classes).size !== classes.length) reasons.push('duplicate_vehicle_type');
      if (vehicles.some(({ Volume }) => !Number.isSafeInteger(Volume) || Volume < 0)) reasons.push('volume');
      const laneVolume = vehicles.reduce((sum, vehicle) => sum + (Number.isSafeInteger(vehicle.Volume) && vehicle.Volume >= 0 ? vehicle.Volume : 0), 0);
      laneVolumes.push({ laneId: lane.LaneID, volume: laneVolume, vehicles: vehicles.map(({ VehicleType, Volume }) => ({ type: VehicleType, volume: Volume })) });
      // Lane Speed is the lane's mean speed (km/h); weight by the vehicles that produced it.
      if (laneVolume > 0) {
        if (!Number.isFinite(lane.Speed) || lane.Speed <= 0 || lane.Speed > 200) speedInvalid = true;
        else { speedWeight += laneVolume; speedTotal += lane.Speed * laneVolume; }
      }
      occupancyTotal += Number.isFinite(lane.Occupancy) ? lane.Occupancy : 0;
    }
    const uniqueReasons = [...new Set(reasons)];
    const valid = uniqueReasons.length === 0;
    result.directions.push({ id: `${staticVD.VDID}:${link.LinkID}`, linkId: link.LinkID, valid, volume: valid ? laneVolumes.reduce((sum, lane) => sum + lane.volume, 0) : null, speed: valid && !speedInvalid && speedWeight > 0 ? speedTotal / speedWeight : null, speedVolume: valid && !speedInvalid ? speedWeight : 0, occupancy: valid && lanes.length ? occupancyTotal / lanes.length : null, reasons: uniqueReasons, laneVolumes, fingerprint: canonical({ status: record?.Status, reasons: uniqueReasons, flow: flow ? { ...flow, Lanes: lanes.map((lane) => ({ ...lane, Vehicles: Array.isArray(lane.Vehicles) ? [...lane.Vehicles].sort((a, b) => String(a.VehicleType).localeCompare(String(b.VehicleType))) : lane.Vehicles, ErrorDiags: Array.isArray(lane.ErrorDiags) ? [...lane.ErrorDiags].sort() : lane.ErrorDiags })).sort((a, b) => a.LaneID - b.LaneID) } : null }) });
  }
  return result;
}

/** Official speed bands: LowValue <= speed < TopValue; a missing TopValue is open-ended. Returns the level number or null. */
export function congestionLevel(speed, levels) {
  if (!Number.isFinite(speed) || !Array.isArray(levels)) return null;
  const match = levels.find((item) => item.Level > 0 && speed >= Number(item.LowValue) && (item.TopValue == null || speed < Number(item.TopValue)));
  return match ? match.Level : null;
}

/** Aggregate a day at direction × minute grain; conflicting repeats never overwrite evidence. */
export function aggregateRecords(records, staticVDs, date, { levelsFor, officialFor } = {}) {
  parseDate(date);
  const stations = new Map(staticVDs.map((vd) => [vd.VDID, vd]));
  const minutesByDirection = new Map();
  for (const station of staticVDs) {
    for (const link of station.DetectionLinks ?? []) minutesByDirection.set(`${station.VDID}:${link.LinkID}`, new Map());
  }
  for (const record of records) {
    const analysis = analyzeRecord(record, stations.get(record.VDID));
    if (!analysis.inWindow || analysis.date !== date) continue;
    for (const direction of analysis.directions) {
      const minutes = minutesByDirection.get(direction.id);
      const old = minutes.get(analysis.minute);
      if (!old) minutes.set(analysis.minute, { ...direction, example: { record, timestamp: analysis.timestamp } });
      else if (old.fingerprint !== direction.fingerprint || old.conflict) minutes.set(analysis.minute, { ...old, valid: false, volume: null, speed: null, conflict: true, reasons: ['conflicting_duplicate'] });
    }
  }
  return [...minutesByDirection].map(([id, minutes]) => {
    const reasonCounts = {};
    const accepted = [...minutes.values()].filter((minute) => minute.valid);
    for (const minute of minutes.values()) for (const reason of minute.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    if (minutes.size < EXPECTED_MINUTES) reasonCounts.missing_minute = EXPECTED_MINUTES - minutes.size;
    const example = accepted[0];
    // Rolling speed of each valid minute: vehicle-weighted over the valid minutes in [t-4, t] (the window that best matched official section speeds).
    const rolling = new Map();
    for (const [minuteOfDay, minute] of minutes) {
      if (!minute.valid) continue;
      let weight = 0, total = 0;
      for (let back = 0; back < SPEED_WINDOW_MINUTES; back++) {
        const earlier = minutes.get(minuteOfDay - back);
        if (earlier?.valid && earlier.speed != null) { weight += earlier.speedVolume; total += earlier.speed * earlier.speedVolume; }
      }
      if (weight > 0) rolling.set(minuteOfDay, total / weight);
    }
    const levels = levelsFor?.(id);
    const levelMinutes = {};
    if (levels) for (const speed of rolling.values()) { const level = congestionLevel(speed, levels); if (level != null) levelMinutes[level] = (levelMinutes[level] ?? 0) + 1; }
    // Time-of-day profile: 15-minute bins and the first/last sustained congestion run (>= SUSTAINED_MINUTES consecutive congested minutes).
    let congestionProfile;
    if (levels) {
      const bins = Array.from({ length: EXPECTED_MINUTES / PROFILE_BIN_MINUTES }, () => [0, 0]);
      const runs = [];
      let runStart = null, previous = null;
      for (let minuteOfDay = WINDOW_START_MINUTE; minuteOfDay < WINDOW_START_MINUTE + EXPECTED_MINUTES; minuteOfDay++) {
        const level = rolling.has(minuteOfDay) ? congestionLevel(rolling.get(minuteOfDay), levels) : null;
        if (level != null) { const bin = bins[Math.floor((minuteOfDay - WINDOW_START_MINUTE) / PROFILE_BIN_MINUTES)]; bin[0]++; if (CONGESTED_LEVELS.includes(level)) bin[1]++; }
        const congested = level != null && CONGESTED_LEVELS.includes(level);
        if (congested && runStart === null) runStart = minuteOfDay;
        if (!congested && runStart !== null) { runs.push([runStart, previous]); runStart = null; }
        if (congested) previous = minuteOfDay;
      }
      if (runStart !== null) runs.push([runStart, previous]);
      const sustained = runs.filter(([start, end]) => end - start + 1 >= SUSTAINED_MINUTES);
      congestionProfile = { bins, firstMinute: sustained[0]?.[0] ?? null, lastMinute: sustained.at(-1)?.[1] ?? null, observedMinutes: bins.reduce((sum, bin) => sum + bin[0], 0) };
    }
    // Cross-check against the authority's own section level for the same minute; official level 0 (unknown), -99 (abnormal) and non-positive speeds are skipped.
    const official = officialFor?.(id);
    const compare = (speeds) => {
      const result = { minutes: 0, exact: 0, withinOne: 0, bothCongested: 0, vdCongested: 0, officialCongested: 0, speedAbsDiffSum: 0 };
      for (const [minuteOfDay, speed] of speeds) {
        const reference = official.get(minuteOfDay);
        if (!reference || !(reference.level >= 1) || !(reference.speed > 0)) continue;
        const level = congestionLevel(speed, levels);
        if (level == null) continue;
        const vdCongested = CONGESTED_LEVELS.includes(level), officialCongested = CONGESTED_LEVELS.includes(reference.level);
        result.minutes++;
        if (level === reference.level) result.exact++;
        if (Math.abs(level - reference.level) <= 1) result.withinOne++;
        if (vdCongested && officialCongested) result.bothCongested++;
        if (vdCongested) result.vdCongested++;
        if (officialCongested) result.officialCongested++;
        result.speedAbsDiffSum += Math.abs(speed - reference.speed);
      }
      return result;
    };
    // The single-minute comparison is kept as evidence for choosing the five-minute window; both cover the same minutes when vehicles passed.
    const officialComparison = official && levels ? compare(rolling) : undefined;
    const singleMinuteComparison = official && levels ? compare([...minutes].filter(([, minute]) => minute.valid && minute.speed != null).map(([minuteOfDay, minute]) => [minuteOfDay, minute.speed])) : undefined;
    return { id, date, receivedMinutes: minutes.size, validMinutes: accepted.length, volume: accepted.length ? accepted.reduce((sum, minute) => sum + minute.volume, 0) : null, speedMinutes: rolling.size, speedSum: [...rolling.values()].reduce((sum, speed) => sum + speed, 0), noFlowMinutes: accepted.length - rolling.size, ...(levels ? { levelMinutes, congestionProfile } : {}), ...(officialComparison ? { officialComparison, singleMinuteComparison } : {}), reasonCounts, ...(example ? { example: { timestamp: example.example.timestamp, volume: example.volume, speed: example.speed, laneVolumes: example.laneVolumes, raw: example.example.record } } : {}) };
  });
}

/** Select representatives before checking quality so volume/availability cannot pick a favorable VD. */
export function representativeDirections(directions, options = {}) {
  const candidates = options.includeExcluded ? directions : directions.filter((direction) => direction.scope?.included === true);
  const links = new Map();
  for (const direction of [...candidates].sort((a, b) => (a.representativePriority ?? Infinity) - (b.representativePriority ?? Infinity) || String(a.vdId).localeCompare(String(b.vdId)))) {
    const previous = links.get(direction.linkId);
    if (!previous || (direction.representative === true && previous.representative !== true)) links.set(direction.linkId, direction);
  }
  return [...links.values()];
}

/** Strict comparison: every ranked direction has complete measured data on every supplied date. */
export function buildRankings(directions, dates, options = {}) {
  const commonDays = [...new Set(dates)].sort();
  if (commonDays.length === 0) return [];
  const rankings = [];
  for (const direction of representativeDirections(directions, options)) {
    const days = commonDays.map((date) => (direction.days ?? []).find((day) => day.date === date));
    if (days.some((day) => !day || day.validMinutes !== EXPECTED_MINUTES || !Number.isSafeInteger(day.volume) || day.volume < 0)) continue;
    const totalVolume = days.reduce((sum, day) => sum + day.volume, 0);
    rankings.push({ ...direction, totalVolume, averageDailyVolume: totalVolume / commonDays.length, validDays: commonDays.length, commonDays, qualityPercentage: 100 });
  }
  rankings.sort((a, b) => b.totalVolume - a.totalVolume || a.id.localeCompare(b.id));
  return rankings.slice(0, options.limit ?? 10).map((direction, index) => ({ ...direction, rank: index + 1 }));
}

/** Observed-minute comparison: no filling, expansion, or claim of equal sampled timestamps. */
export function buildObservedRankings(directions, dates, options = {}) {
  const selectedDates = [...new Set(dates)].sort();
  if (selectedDates.length === 0) return [];
  const rankings = [];
  for (const direction of representativeDirections(directions, options)) {
    const observed = selectedDates.map((date) => (direction.days ?? []).find((day) => day.date === date))
      .filter((day) => day && Number.isInteger(day.validMinutes) && day.validMinutes > 0 && day.validMinutes <= EXPECTED_MINUTES && Number.isSafeInteger(day.volume) && day.volume >= 0);
    const validMinutes = observed.reduce((sum, day) => sum + day.validMinutes, 0);
    if (validMinutes === 0) continue;
    const totalObservedVolume = observed.reduce((sum, day) => sum + day.volume, 0);
    const expectedMinutes = selectedDates.length * EXPECTED_MINUTES;
    rankings.push({ ...direction, totalObservedVolume, averageMinuteVolume: totalObservedVolume / validMinutes, validMinutes, expectedMinutes, qualityPercentage: validMinutes / expectedMinutes * 100, observedDays: observed.length, selectedDates });
  }
  rankings.sort((a, b) => b.averageMinuteVolume - a.averageMinuteVolume || a.id.localeCompare(b.id));
  return rankings.slice(0, options.limit ?? 10).map((direction, index) => ({ ...direction, rank: index + 1 }));
}

/** Project definition: official Taipei levels 5 (E) and 6 (F) count as congested minutes; 6 alone is severe. */
export const CONGESTED_LEVELS = [5, 6];
export const SEVERE_LEVEL = 6;

/** Congestion comparison over minutes that have both valid counts and a measured speed; no filling. */
export function buildCongestionRankings(directions, dates, options = {}) {
  const selectedDates = [...new Set(dates)].sort();
  if (selectedDates.length === 0) return [];
  const rankings = [];
  for (const direction of representativeDirections(directions, options)) {
    const observed = selectedDates.map((date) => (direction.days ?? []).find((day) => day.date === date)).filter((day) => day && Number.isInteger(day.speedMinutes) && day.speedMinutes > 0 && day.levelMinutes);
    const speedMinutes = observed.reduce((sum, day) => sum + day.speedMinutes, 0);
    if (speedMinutes === 0) continue;
    const levelMinutes = {};
    for (const day of observed) for (const [level, count] of Object.entries(day.levelMinutes)) levelMinutes[level] = (levelMinutes[level] ?? 0) + count;
    const classified = Object.values(levelMinutes).reduce((sum, count) => sum + count, 0);
    const congestedMinutes = CONGESTED_LEVELS.reduce((sum, level) => sum + (levelMinutes[level] ?? 0), 0);
    const severeMinutes = levelMinutes[SEVERE_LEVEL] ?? 0;
    rankings.push({ ...direction, speedMinutes, classifiedMinutes: classified, levelMinutes, congestedMinutes, severeMinutes, congestedShare: classified ? congestedMinutes / classified * 100 : 0, severeShare: classified ? severeMinutes / classified * 100 : 0, averageSpeed: observed.reduce((sum, day) => sum + day.speedSum, 0) / speedMinutes, noFlowMinutes: observed.reduce((sum, day) => sum + (day.noFlowMinutes ?? 0), 0), observedDays: observed.length, selectedDates });
  }
  rankings.sort((a, b) => b.congestedShare - a.congestedShare || b.severeShare - a.severeShare || a.averageSpeed - b.averageSpeed || a.id.localeCompare(b.id));
  return rankings.slice(0, options.limit ?? 10).map((direction, index) => ({ ...direction, rank: index + 1 }));
}
