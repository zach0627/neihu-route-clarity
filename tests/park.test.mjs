import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseAddress, matchRange, distanceMeters, project, parkStretches, parkDistance, classifyLink, sliceLine } from '../lib/park.mjs';

const boundary = JSON.parse(await readFile(new URL('../config/park-boundary.json', import.meta.url), 'utf8'));
const roads = [...new Set(boundary.ranges.map((range) => range.road))];
const inPark = (address) => Boolean(matchRange(parseAddress(address, roads), boundary.ranges));

test('official address ranges follow the 商業處 parity and number limits', () => {
  assert.equal(inPark('台北市內湖區港墘里港墘路183號'), true);
  assert.equal(inPark('台北市內湖區港墘里港墘路181號'), false, 'odd numbers before 183 are outside');
  assert.equal(inPark('台北市內湖區港墘里港墘路200號'), true);
  assert.equal(inPark('台北市內湖區西康里內湖路一段3號'), false, 'odd side of 內湖路一段 is outside');
  assert.equal(inPark('台北市內湖區內湖路一段520號'), true);
  assert.equal(inPark('台北市內湖區內湖路一段522號'), false);
  assert.equal(inPark('臺北市內湖區瑞光路2號'), true, 'all even numbers of 瑞光路');
  assert.equal(inPark('臺北市內湖區瑞光路319號'), false);
  assert.equal(inPark('臺北市內湖區陽光街321巷1號'), true, 'lane 321 and later on the odd side');
  assert.equal(inPark('臺北市內湖區陽光街319巷2號'), false);
  assert.equal(inPark('台北市內湖區湖元里陽光街387號'), true, 'odd house numbers after lane 321 are also after 321巷');
  assert.equal(inPark('臺北市內湖區陽光街319號'), false);
  assert.equal(inPark('台北市內湖區湖元里行忠路2號'), false, 'only odd numbers of 行忠路');
  assert.equal(inPark('臺北市內湖區民權東路六段46號'), true);
  assert.equal(inPark('臺北市內湖區民權東路六段48號'), false);
  assert.equal(inPark('臺北市內湖區堤頂大道二段100號'), false, 'only odd numbers of 堤頂大道二段');
  assert.equal(inPark('臺北市內湖區基湖路35之1號'), true);
  assert.equal(inPark('臺北市內湖區成功路四段1號'), false, 'roads not listed are never inside');
});

test('the official text is kept verbatim with every listed road represented in machine ranges', () => {
  for (const road of ['港墘路', '瑞光路', '基湖路', '堤頂大道二段', '舊宗路二段', '洲子街', '行忠路', '陽光街', '民權東路六段']) assert.ok(boundary.source.officialText.includes(road), road);
  assert.ok(boundary.source.officialText.includes('內湖路ㄧ段'), 'official text keeps its original character');
  assert.ok(roads.includes('內湖路一段') && roads.includes('瑞湖街'));
  for (const probe of boundary.probes) assert.ok(roads.some((road) => probe.startsWith(road)), `probe ${probe} targets a listed road`);
});

// A straight east–west test road along latitude 25.075; 0.001° of longitude is about 101 m here.
const road = (name, lon0, lon1) => ({ road: name, links: [{ LinkID: `${name}E`, direction: 'E', start: [lon0, 25.075], end: [lon1, 25.075], shape: [[lon0, 25.075], [lon1, 25.075]] }] });
const address = (range, lon, number) => ({ lon, lat: 25.0751, road: range.road, parity: range.parity, range, number });

test('distances and projection along an official road line', () => {
  assert.ok(Math.abs(distanceMeters([121.57, 25.07], [121.571, 25.07]) - 101) < 2);
  assert.ok(Math.abs(distanceMeters([121.57, 25.07], [121.57, 25.071]) - 111) < 2);
  const hit = project([121.571, 25.0751], [[121.57, 25.075], [121.58, 25.075]]);
  assert.ok(Math.abs(hit.s - 101) < 2 && Math.abs(hit.distance - 11) < 1 && Math.abs(hit.length - 1009) < 5);
  const half = sliceLine([[121.57, 25.075], [121.58, 25.075]], 0, 504.5);
  assert.ok(Math.abs(half.at(-1)[0] - 121.575) < 1e-4);
});

test('the park interior is where both sides of one road are in the official range', () => {
  const all = { road: '全部路', parity: 'all' };
  const odd = { road: '單雙路', parity: 'odd', from: 101 }, even = { road: '單雙路', parity: 'even' };
  const boundedOdd = { road: '區間路', parity: 'odd', from: 9, to: 27 }, boundedEven = { road: '區間路', parity: 'even', from: 10, to: 46 };
  const oneSided = { road: '邊界路', parity: 'even', from: 2, to: 520 };
  const ranges = [all, odd, even, boundedOdd, boundedEven, oneSided];
  const points = [
    address(all, 121.575, 1),
    // Odd numbers increase eastward from 101 at 121.574: open-ended, so the odd stretch runs to the east end.
    address(odd, 121.574, 101), address(odd, 121.576, 151), address(even, 121.572, 2),
    address(boundedOdd, 121.571, 9), address(boundedOdd, 121.575, 27), address(boundedEven, 121.573, 10), address(boundedEven, 121.579, 46),
    address(oneSided, 121.571, 2), address(oneSided, 121.579, 520),
  ];
  const stretches = parkStretches([road('全部路', 121.570, 121.580), road('單雙路', 121.570, 121.580), road('區間路', 121.570, 121.580), road('邊界路', 121.570, 121.580)], points, ranges);
  const byRoad = Object.fromEntries(stretches.map((stretch) => [stretch.road, stretch.intervals.map(([a, b]) => [Math.round(a), Math.round(b)])]));
  const total = Math.round(project([121.570, 25.075], [[121.570, 25.075], [121.580, 25.075]]).length);
  assert.deepEqual(byRoad['全部路'], [[0, total]], '全部 covers the whole road');
  assert.equal(byRoad['單雙路'][0][0], Math.round(project([121.574, 25.075], stretches.find((item) => item.road === '單雙路').line).s));
  assert.equal(byRoad['單雙路'][0][1], total, 'open-ended odd range extends toward higher numbers');
  const [low, high] = byRoad['區間路'][0];
  assert.ok(Math.abs(low - 303) < 3 && Math.abs(high - 504) < 3, 'overlap of odd 9–27 (101–504 m) and even 10–46 (303–908 m)');
  assert.equal(byRoad['邊界路'], undefined, 'a road with park addresses on one side only is a boundary, not the interior');
  const only = stretches.filter((item) => item.road === '區間路');
  assert.equal(classifyLink([121.565, 25.075], [121.574, 25.075], only, 60), 'entering');
  assert.equal(classifyLink([121.574, 25.075], [121.5745, 25.075], only, 60), 'internal');
  assert.equal(classifyLink([121.574, 25.075], [121.580, 25.075], only, 60), 'leaving');
  assert.equal(classifyLink([121.560, 25.075], [121.565, 25.075], only, 60), 'outside');
  assert.ok(Math.abs(parkDistance([121.5756, 25.075], only).distance - 61) < 3, 'beyond the stretch end the overshoot counts');
});
