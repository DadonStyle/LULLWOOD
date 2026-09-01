// Node built-in test runner. Run: node --test lib/dashboard/aggregate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFunnel, computeOutcomes, computeSessions, computeFeatureEngagement } from './aggregate.ts';
import type { RawEvent } from './events.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_TS = Date.UTC(2026, 7, 20, 12, 0, 0); // 2026-08-20 noon UTC

function ev(event: RawEvent['event'], ts: number, anon_id: string, extra: Record<string, unknown> = {}): RawEvent {
  return { event, ts, anon_id, ...extra };
}

test('computeFunnel: counts and conversion percentages', () => {
  const events: RawEvent[] = [
    ev('page_view', BASE_TS, 'a'),
    ev('page_view', BASE_TS, 'b'),
    ev('page_view', BASE_TS, 'c'),
    ev('page_view', BASE_TS, 'd'),
    ev('cta_start_clicked', BASE_TS, 'a'),
    ev('cta_start_clicked', BASE_TS, 'b'),
    ev('game_start', BASE_TS, 'a', { seed: 1 }),
    ev('win', BASE_TS, 'a', { time_survived_ms: 1000, seed: 1 }),
  ];
  const funnel = computeFunnel(events);
  assert.deepEqual(
    funnel.map((s) => s.count),
    [4, 2, 1, 1],
  );
  assert.equal(funnel[0].pctOfFirst, 100);
  assert.equal(funnel[1].pctOfFirst, 50);
  assert.equal(funnel[1].pctOfPrev, 50);
  assert.equal(funnel[0].pctOfPrev, null);
});

test('computeFunnel: empty input never divides by zero', () => {
  const funnel = computeFunnel([]);
  assert.deepEqual(
    funnel.map((s) => s.count),
    [0, 0, 0, 0],
  );
  assert.equal(funnel[0].pctOfFirst, 0);
  assert.equal(funnel[1].pctOfPrev, 0);
});

test('computeOutcomes: win rate, loss-by-predator, time survived percentiles', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { time_survived_ms: 100, seed: 1 }),
    ev('win', BASE_TS, 'b', { time_survived_ms: 300, seed: 1 }),
    ev('loss', BASE_TS, 'c', { predator_kind: 'wolf', time_survived_ms: 50, seed: 1 }),
    ev('loss', BASE_TS, 'd', { predator_kind: 'bear', time_survived_ms: 60, seed: 1 }),
    ev('loss', BASE_TS, 'e', { predator_kind: 'bear', time_survived_ms: 70, seed: 1 }),
  ];
  const outcomes = computeOutcomes(events);
  assert.equal(outcomes.winCount, 2);
  assert.equal(outcomes.lossCount, 3);
  assert.equal(outcomes.winRatePct, 40);
  assert.deepEqual(outcomes.lossByPredator, { wolf: 1, bear: 2, lion: 0 });
  assert.equal(outcomes.timeSurvivedMs.win.n, 2);
  assert.equal(outcomes.timeSurvivedMs.loss.n, 3);
});

test('computeOutcomes: no win/loss events -> null win rate, not NaN', () => {
  const outcomes = computeOutcomes([ev('page_view', BASE_TS, 'a')]);
  assert.equal(outcomes.winRatePct, null);
  assert.equal(outcomes.timeSurvivedMs.win.p50, null);
});

test('computeOutcomes: unknown predator_kind is ignored, not thrown', () => {
  const outcomes = computeOutcomes([ev('loss', BASE_TS, 'a', { predator_kind: 'dragon', time_survived_ms: 10 })]);
  assert.deepEqual(outcomes.lossByPredator, { wolf: 0, bear: 0, lion: 0 });
  assert.equal(outcomes.lossCount, 1);
});

test('computeSessions: duration percentiles and reached_gameplay rate', () => {
  const events: RawEvent[] = [
    ev('session_length', BASE_TS, 'a', { duration_ms: 1000, reached_gameplay: true }),
    ev('session_length', BASE_TS, 'b', { duration_ms: 2000, reached_gameplay: false }),
    ev('session_length', BASE_TS, 'c', { duration_ms: 3000, reached_gameplay: true }),
  ];
  const sessions = computeSessions(events);
  assert.equal(sessions.sessionCount, 3);
  assert.equal(sessions.reachedGameplayRatePct, (2 / 3) * 100);
  assert.equal(sessions.durationMs.p50, 2000);
});

test('computeSessions: D1 return counts an anon_id seen again exactly one day later', () => {
  const events: RawEvent[] = [
    ev('page_view', BASE_TS, 'returning-user'),
    ev('page_view', BASE_TS + DAY_MS, 'returning-user'),
    ev('page_view', BASE_TS, 'one-and-done'),
  ];
  const sessions = computeSessions(events);
  // one-and-done's day+1 (BASE_TS+DAY_MS) IS inside the window (maxDay), so
  // they are eligible and did not return -> 1 of 2 eligible anon_ids returned.
  assert.equal(sessions.d1ReturnPct, 50);
});

test('computeSessions: D1 return is null with no events', () => {
  const sessions = computeSessions([]);
  assert.equal(sessions.d1ReturnPct, null);
  assert.equal(sessions.reachedGameplayRatePct, null);
});

test('computeFeatureEngagement: groups by feature+action, sorted by count desc', () => {
  const events: RawEvent[] = [
    ev('feature_engagement', BASE_TS, 'a', { feature: 'hide', action: 'used' }),
    ev('feature_engagement', BASE_TS, 'b', { feature: 'hide', action: 'used' }),
    ev('feature_engagement', BASE_TS, 'c', { feature: 'options_menu', action: 'opened' }),
  ];
  const rows = computeFeatureEngagement(events);
  assert.deepEqual(rows, [
    { feature: 'hide', action: 'used', count: 2 },
    { feature: 'options_menu', action: 'opened', count: 1 },
  ]);
});

test('computeFeatureEngagement: ignores non-feature_engagement events', () => {
  const rows = computeFeatureEngagement([ev('page_view', BASE_TS, 'a')]);
  assert.deepEqual(rows, []);
});
