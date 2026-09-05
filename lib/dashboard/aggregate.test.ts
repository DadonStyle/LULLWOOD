// Node built-in test runner. Run: node --test lib/dashboard/aggregate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFunnel, computeOutcomes, computeSessions, computeFeatureEngagement, computeEconomy } from './aggregate.ts';
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

test('computeEconomy: payout percentiles and failure band', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000 }),
    ev('win', BASE_TS, 'b', { payout: 120, balance: 220, time_survived_ms: 90000 }),
    ev('loss', BASE_TS, 'c', { payout: 15, balance: 15, time_survived_ms: 30000, predator_kind: 'wolf' }),
    ev('loss', BASE_TS, 'd', { payout: 25, balance: 25, time_survived_ms: 30000, predator_kind: 'bear' }),
  ];
  const economy = computeEconomy(events);
  assert.equal(economy.winPayout.n, 2);
  assert.equal(economy.winPayout.p50, 100);
  assert.equal(economy.lossPayout.n, 2);
  assert.equal(economy.lossPayout.p50, 15);
  assert.equal(economy.failureBandPct, 15);
});

test('computeEconomy: empty input never divides by zero', () => {
  const economy = computeEconomy([]);
  assert.equal(economy.winPayout.p50, null);
  assert.equal(economy.failureBandPct, null);
  assert.equal(economy.lossDepth.pctAbove24, null);
  assert.equal(economy.purchase.crossed120Count, 0);
  assert.equal(economy.purchase.purchasedWithin3RunsPct, null);
});

test('computeEconomy: loss depth derives survival term from time_survived_ms, capped at 6', () => {
  const events: RawEvent[] = [
    // survivalTerm = min(6, floor(150000/20000)) = min(6,7) = 6; depth = 30 - 6 = 24
    ev('loss', BASE_TS, 'a', { payout: 30, time_survived_ms: 150000, predator_kind: 'wolf' }),
    // survivalTerm = min(6, floor(10000/20000)) = 0; depth = 40 - 0 = 40 (> 24)
    ev('loss', BASE_TS, 'b', { payout: 40, time_survived_ms: 10000, predator_kind: 'lion' }),
  ];
  const economy = computeEconomy(events);
  assert.equal(economy.lossDepth.n, 2);
  assert.equal(economy.lossDepth.p50, 24);
  assert.equal(economy.lossDepth.pctAbove24, 50);
});

test('computeEconomy: purchase is a balance decrease within 3 runs of crossing 120', () => {
  const events: RawEvent[] = [
    // anon 'a': crosses 120 on run 2, decreases on run 3 (within window) -> purchased
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000 }),
    ev('win', BASE_TS + 1, 'a', { payout: 30, balance: 130, time_survived_ms: 90000 }),
    ev('loss', BASE_TS + 2, 'a', { payout: 15, balance: 45, time_survived_ms: 30000, predator_kind: 'wolf' }),
    // anon 'b': crosses 120 on run 1, never decreases -> not purchased
    ev('win', BASE_TS, 'b', { payout: 150, balance: 150, time_survived_ms: 90000 }),
    ev('win', BASE_TS + 1, 'b', { payout: 20, balance: 170, time_survived_ms: 90000 }),
    // anon 'c': never crosses 120 -> excluded entirely
    ev('loss', BASE_TS, 'c', { payout: 15, balance: 15, time_survived_ms: 30000, predator_kind: 'bear' }),
  ];
  const economy = computeEconomy(events);
  assert.equal(economy.purchase.crossed120Count, 2);
  assert.equal(economy.purchase.purchasedWithin3RunsCount, 1);
  assert.equal(economy.purchase.purchasedWithin3RunsPct, 50);
});
