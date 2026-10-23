/** Park scope geometry from official address ranges. Pure and browser-safe; no IO. */
const ROAD_ALIASES = { '內湖路ㄧ段': '內湖路一段', '粉寮街': '瑞湖街' };

/** Parse a geocoder address such as 台北市內湖區港墘里港墘路183號 or 陽光街321巷1號. */
export function parseAddress(text, roads) {
  const normalized = String(text ?? '').replace(/台/g, '臺').replace(/ㄧ/g, '一');
  for (const road of [...roads].sort((a, b) => b.length - a.length)) {
    const at = normalized.indexOf(road);
    if (at < 0) continue;
    const rest = normalized.slice(at + road.length);
    const match = rest.match(/^(?:(\d+)巷)?(?:(\d+)弄)?(\d+)(?:之\d+)?號/);
    if (!match) return { road, lane: null, number: null };
    return { road, lane: match[1] ? Number(match[1]) : null, number: Number(match[3]) };
  }
  return null;
}

const parityOk = (value, parity) => parity === 'all' || (parity === 'odd' ? value % 2 === 1 : value % 2 === 0);

/** Returns the official range an address falls in, or null. A lane address is placed by its lane number, so 陽光街321巷以後 covers 321巷 and later odd numbers. */
export function matchRange(parsed, ranges) {
  if (!parsed?.road || parsed.number == null) return null;
  for (const range of ranges) {
    if ((ROAD_ALIASES[range.road] ?? range.road) !== parsed.road) continue;
    const value = parsed.lane ?? parsed.number;
    if (range.laneFrom != null) {
      if (parityOk(value, range.parity) && value >= range.laneFrom) return range;
      continue;
    }
    if (!parityOk(value, range.parity)) continue;
    if (range.from != null && value < range.from) continue;
    if (range.to != null && value > range.to) continue;
    return range;
  }
  return null;
}

const METERS_PER_DEGREE_LAT = 111_320;
/** Distance in metres between [lon, lat] points (local equirectangular approximation, adequate within a district). */
export function distanceMeters([x1, y1], [x2, y2]) {
  const kx = METERS_PER_DEGREE_LAT * Math.cos((y1 + y2) / 2 * Math.PI / 180);
  return Math.hypot((x2 - x1) * kx, (y2 - y1) * METERS_PER_DEGREE_LAT);
}

/** Chain one direction's official links into polylines by joining each link end to the nearest following link start. */
export function chainLinks(links, joinMeters = 60) {
  const remaining = [...links];
  const chains = [];
  const isHead = (link) => !remaining.some((other) => other !== link && distanceMeters(other.end, link.start) <= joinMeters);
  while (remaining.length) {
    let current = remaining.find(isHead) ?? remaining[0];
    remaining.splice(remaining.indexOf(current), 1);
    const points = [...current.shape];
    for (;;) {
      const next = remaining.map((link) => ({ link, gap: distanceMeters(current.end, link.start) })).filter((item) => item.gap <= joinMeters).sort((a, b) => a.gap - b.gap)[0]?.link;
      if (!next) break;
      remaining.splice(remaining.indexOf(next), 1);
      points.push(...next.shape);
      current = next;
    }
    chains.push(points);
  }
  return chains;
}

/** Project a point onto a polyline: along-line distance s and perpendicular distance, in metres. */
export function project(point, line) {
  let along = 0, best = { s: 0, distance: Infinity };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const kx = METERS_PER_DEGREE_LAT * Math.cos(a[1] * Math.PI / 180);
    const bx = (b[0] - a[0]) * kx, by = (b[1] - a[1]) * METERS_PER_DEGREE_LAT, px = (point[0] - a[0]) * kx, py = (point[1] - a[1]) * METERS_PER_DEGREE_LAT;
    const length = Math.hypot(bx, by);
    const t = length ? Math.max(0, Math.min(1, (px * bx + py * by) / (length * length))) : 0;
    const distance = Math.hypot(px - t * bx, py - t * by);
    if (distance < best.distance) best = { s: along + t * length, distance };
    along += length;
  }
  return { ...best, length: along };
}

/**
 * Two-sided park stretches of each listed road. A range's stretch spans its geocoded addresses along the road;
 * an open-ended range (e.g. 183號以後) extends to the road end in the direction of increasing numbers, and 全部 covers the whole road.
 * The park interior is where both sides are in range: a 全部 range, or the overlap of the odd and the even stretch.
 */
export function parkStretches(roads, points, ranges, snapMeters = 60) {
  const stretches = [];
  for (const { road, links } of roads) {
    const roadRanges = ranges.filter((range) => (ROAD_ALIASES[range.road] ?? range.road) === road);
    for (const direction of [...new Set(links.map((link) => link.direction))]) {
      for (const line of chainLinks(links.filter((link) => link.direction === direction))) {
        const total = project(line[0], line).length;
        const interval = (range) => {
          if (range.from == null && range.to == null && range.laneFrom == null) return [0, total];
          const hits = points.filter((item) => item.range === range).map((item) => ({ ...project([item.lon, item.lat], line), number: item.number })).filter((hit) => hit.distance <= snapMeters);
          if (!hits.length) return null;
          let low = Math.min(...hits.map((hit) => hit.s)), high = Math.max(...hits.map((hit) => hit.s));
          if (range.to == null && hits.length > 1) {
            const lowest = hits.reduce((a, b) => (b.number < a.number ? b : a)), highest = hits.reduce((a, b) => (b.number > a.number ? b : a));
            if (highest.s >= lowest.s) high = total; else low = 0;
          }
          return [low, high];
        };
        const byParity = (parity) => roadRanges.filter((range) => range.parity === parity).map(interval).filter(Boolean);
        const intervals = [...byParity('all')];
        for (const odd of byParity('odd')) for (const even of byParity('even')) {
          const low = Math.max(odd[0], even[0]), high = Math.min(odd[1], even[1]);
          if (high > low) intervals.push([low, high]);
        }
        if (intervals.length) stretches.push({ road, direction, line, intervals });
      }
    }
  }
  return stretches;
}

/** The part of a polyline between along-line distances from and to (metres), for drawing park stretches. */
export function sliceLine(line, from, to) {
  const out = [];
  let along = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const length = distanceMeters(a, b);
    const at = (s) => { const t = length ? (s - along) / length : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    if (along + length >= from && along <= to) {
      if (!out.length) out.push(at(Math.max(from, along)));
      out.push(at(Math.min(to, along + length)));
    }
    along += length;
  }
  return out;
}

/** Distance in metres from a point to the nearest two-sided park stretch; positions beyond a stretch end count the overshoot. */
export function parkDistance(point, stretches) {
  let best = { distance: Infinity, road: null };
  for (const stretch of stretches) {
    const hit = project(point, stretch.line);
    for (const [low, high] of stretch.intervals) {
      const overshoot = hit.s < low ? low - hit.s : hit.s > high ? hit.s - high : 0;
      const distance = Math.hypot(hit.distance, overshoot);
      if (distance < best.distance) best = { distance, road: stretch.road };
    }
  }
  return best;
}

/** Official link versus the park interior: a link end is in the park when it lies within radius metres of a two-sided park stretch. */
export function classifyLink(start, end, stretches, radius) {
  const startIn = parkDistance(start, stretches).distance <= radius, endIn = parkDistance(end, stretches).distance <= radius;
  if (endIn) return startIn ? 'internal' : 'entering';
  return startIn ? 'leaving' : 'outside';
}
