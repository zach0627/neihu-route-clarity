import test from 'node:test';
import assert from 'node:assert/strict';
import { liveDisplayState } from '../lib/live.mjs';

const now = Date.parse('2026-10-23T08:00:00+08:00');
const observation = (overrides = {}) => ({
  date: '2026-10-23', generatedAt: '2026-10-23T07:58:00+08:00',
  from: '07:43', to: '07:57', inWindow: true, polls: 15,
  segments: [{ id: 'full', minutes: 15, jammed15: true, share15: 0.8 }],
  ...overrides,
});

test('a fresh full observation during the Taipei morning window permits current advice', () => {
  const state = liveDisplayState(observation(), now);
  assert.equal(state.status, 'current');
  assert.equal(state.isCurrent, true);
  assert.equal(state.label, '目前早尖峰觀測');
  assert.deepEqual(state.jammedSegments.map(segment => segment.id), ['full']);
  assert.equal(state.date, '2026-10-23');
  assert.equal(state.period, '07:43–07:57');
});

test('current and historical dates follow Taipei rather than the UTC calendar day', () => {
  const early = liveDisplayState(observation({ generatedAt: '2026-10-22T23:28:00Z' }), Date.parse('2026-10-22T23:30:00Z'));
  assert.equal(early.isCurrent, true, '23:30 UTC is 07:30 on the next Taipei day');
  const previousDay = liveDisplayState(observation({ generatedAt: '2026-10-23T23:08:00Z' }), Date.parse('2026-10-23T23:10:00Z'));
  assert.equal(previousDay.status, 'historical');
  assert.equal(previousDay.isCurrent, false);
  assert.match(previousDay.label, /歷史/);
  assert.ok(!previousDay.label.includes('今日'));
});

test('observations older than 30 minutes are recent records rather than current advice', () => {
  assert.equal(liveDisplayState(observation({ generatedAt: '2026-10-23T07:30:00+08:00' }), now).isCurrent, true);
  const stale = liveDisplayState(observation({ generatedAt: '2026-10-23T07:29:59.999+08:00' }), now);
  assert.equal(stale.status, 'recent');
  assert.equal(stale.isCurrent, false);
  assert.match(stale.label, /最近觀測/);
  assert.ok(!stale.label.includes('今日'));
});

test('current morning status includes 07:00 and excludes 09:30', () => {
  for (const [time, expected] of [['06:59:59', false], ['07:00:00', true], ['09:29:59', true], ['09:30:00', false], ['10:00:00', false]]) {
    const stamp = `2026-10-23T${time}+08:00`;
    const state = liveDisplayState(observation({ generatedAt: stamp }), Date.parse(stamp));
    assert.equal(state.isCurrent, expected, time);
    if (!expected) assert.match(state.label, /最近觀測/);
  }
});

test('two polls are visibly a short verification and cannot supply 15-minute congestion conclusions', () => {
  const state = liveDisplayState(observation({ polls: 2, segments: [{ id: 'partial', minutes: 2, jammed15: true, share15: 1 }] }), now);
  assert.equal(state.status, 'partial');
  assert.equal(state.isCurrent, false);
  assert.equal(state.hasFullPolls, false);
  assert.match(state.observationsLabel, /短期驗證.*2次觀測／未滿15分鐘/);
  assert.deepEqual(state.jammedSegments, []);
  assert.equal(state.observedSegments[0].minutes, 2, 'valid observed minutes remain available');
  const historical = liveDisplayState(observation({ date: '2026-10-22', polls: 2 }), now);
  assert.equal(historical.status, 'historical');
  assert.match(historical.observationsLabel, /短期驗證/);
});

test('incomplete directions do not count as full 15-minute congestion even after 15 polls', () => {
  const state = liveDisplayState(observation({ segments: [
    { id: 'partial', minutes: 2, jammed15: true, share15: 1 },
    { id: 'full', minutes: 15, jammed15: true, share15: 0.8 },
  ] }), now);
  assert.deepEqual(state.jammedSegments.map(segment => segment.id), ['full']);
  assert.deepEqual(state.completeSegments.map(segment => segment.id), ['full']);
  assert.equal(state.observedSegments.length, 2);
  const incomplete = liveDisplayState(observation({ segments: [{ id: 'partial', minutes: 2, jammed15: true, share15: 1 }] }), now);
  assert.equal(incomplete.status, 'partial');
  assert.equal(incomplete.isCurrent, false);
});

test('missing or unclassified data cannot be presented as a current clear road', () => {
  for (const live of [null, observation({ segments: [] }), observation({ segments: [{ id: 'empty', minutes: 0 }] })]) {
    const state = liveDisplayState(live, now);
    assert.equal(state.status, 'missing');
    assert.equal(state.isCurrent, false);
    assert.deepEqual(state.jammedSegments, []);
  }
});

test('invalid or future generation times, unconfirmed windows and invalid polls prevent current advice', () => {
  for (const overrides of [
    { generatedAt: 'invalid' }, { generatedAt: '2026-10-23T08:00:00.001+08:00' },
    { date: 'invalid' }, { inWindow: false }, { inWindow: 'true' },
    { polls: undefined }, { polls: -1 }, { polls: NaN },
  ]) assert.equal(liveDisplayState(observation(overrides), now).isCurrent, false);
});

test('when available the source timestamp must be fresh when generated and remain within the viewer freshness window', () => {
  assert.equal(liveDisplayState(observation({ sourceTo: '2026-10-23T07:53:00+08:00' }), now).isCurrent, true);
  assert.equal(liveDisplayState(observation({ generatedAt: '2026-10-23T07:50:00+08:00', sourceTo: '2026-10-23T07:48:00+08:00' }), now).isCurrent, true, 'the published observation remains usable between 15-minute updates');
  for (const sourceTo of ['2026-10-23T07:52:59.999+08:00', '2026-10-22T07:59:00+08:00', '2026-10-23T07:58:00.001+08:00', 'invalid']) {
    const state = liveDisplayState(observation({ sourceTo }), now);
    assert.equal(state.isCurrent, false, sourceTo);
    assert.equal(state.status, 'recent');
  }
  assert.equal(liveDisplayState(observation({ generatedAt: '2026-10-23T07:30:00+08:00', sourceTo: '2026-10-23T07:25:00+08:00' }), now).isCurrent, false);
});
