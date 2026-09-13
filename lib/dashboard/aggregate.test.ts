// Node built-in test runner. Run: node --test lib/dashboard/aggregate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFunnel,
  computeOutcomes,
  computeSessions,
  computeFeatureEngagement,
  computeEconomy,
  computeOutcomesByTier,
  computeChaseGapByTier,
} from './aggregate.ts';
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

test('computeFunnel: one player with three wins is one player at the win step', () => {
  const events: RawEvent[] = [
    ev('page_view', BASE_TS, 'a'),
    ev('win', BASE_TS, 'a', { time_survived_ms: 100, seed: 1 }),
    ev('win', BASE_TS, 'a', { time_survived_ms: 200, seed: 2 }),
    ev('win', BASE_TS, 'a', { time_survived_ms: 300, seed: 3 }),
  ];
  const funnel = computeFunnel(events);
  const winStep = funnel[funnel.length - 1];
  assert.equal(winStep.event, 'win');
  assert.equal(winStep.count, 1);
  assert.ok(winStep.pctOfPrev !== null && winStep.pctOfPrev <= 100);
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

test('computeSessions: one session that tabbed away twice is one session, at its longest duration', () => {
  const events: RawEvent[] = [
    ev('session_length', BASE_TS, 'a', { duration_ms: 1000, reached_gameplay: false, session_id: 's1' }),
    ev('session_length', BASE_TS, 'a', { duration_ms: 5000, reached_gameplay: false, session_id: 's1' }),
    ev('session_length', BASE_TS, 'a', { duration_ms: 20000, reached_gameplay: true, session_id: 's1' }),
  ];
  const sessions = computeSessions(events);
  assert.equal(sessions.sessionCount, 1);
  assert.equal(sessions.durationMs.p50, 20000);
  assert.equal(sessions.reachedGameplayRatePct, 100);
});

test('computeSessions: rows with no session_id still count individually', () => {
  // Same anon_id, distinct ts (two separate historical page loads, pre-LUL-1430) --
  // the legacy key is anon_id+ts, so same anon_id at the same ts would collide;
  // distinct ts is what makes this guard the backfill path for real.
  const events: RawEvent[] = [
    ev('session_length', BASE_TS, 'a', { duration_ms: 1000, reached_gameplay: true }),
    ev('session_length', BASE_TS + DAY_MS, 'a', { duration_ms: 2000, reached_gameplay: false }),
  ];
  const sessions = computeSessions(events);
  assert.equal(sessions.sessionCount, 2);
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

test('computeEconomy: byDifficulty buckets events by difficulty field', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000, difficulty: 'lantern' }),
    ev('loss', BASE_TS, 'b', { payout: 15, balance: 15, time_survived_ms: 30000, predator_kind: 'wolf', difficulty: 'night' }),
    ev('win', BASE_TS, 'c', { payout: 130, balance: 130, time_survived_ms: 90000, difficulty: 'blackout' }),
    ev('loss', BASE_TS, 'd', { payout: 40, balance: 40, time_survived_ms: 10000, predator_kind: 'bear', difficulty: 'blackout' }),
  ];
  const economy = computeEconomy(events);
  assert.equal(economy.byDifficulty.lantern.winPayout.n, 1);
  assert.equal(economy.byDifficulty.night.lossPayout.n, 1);
  assert.equal(economy.byDifficulty.blackout.winPayout.n, 1);
  assert.equal(economy.byDifficulty.blackout.lossPayout.n, 1);
  assert.equal(economy.byDifficulty.unattributed.winPayout.n, 0);
  // tier ns + unattributed must sum to pooled n
  const totalWins = economy.byDifficulty.lantern.winPayout.n + economy.byDifficulty.night.winPayout.n +
    economy.byDifficulty.blackout.winPayout.n + economy.byDifficulty.unattributed.winPayout.n;
  assert.equal(totalWins, economy.winPayout.n);
});

test('computeEconomy: events without difficulty go to unattributed, pooled numbers unchanged', () => {
  const noAttr: RawEvent[] = [
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000 }),
    ev('loss', BASE_TS, 'b', { payout: 15, balance: 15, time_survived_ms: 30000, predator_kind: 'wolf' }),
  ];
  const withAttr: RawEvent[] = [
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000, difficulty: undefined }),
    ev('loss', BASE_TS, 'b', { payout: 15, balance: 15, time_survived_ms: 30000, predator_kind: 'wolf', difficulty: undefined }),
  ];
  const e1 = computeEconomy(noAttr);
  const e2 = computeEconomy(withAttr);
  assert.equal(e2.byDifficulty.unattributed.winPayout.n, 1);
  assert.equal(e2.byDifficulty.unattributed.lossPayout.n, 1);
  assert.equal(e1.winPayout.p50, e2.winPayout.p50);
  assert.equal(e1.lossPayout.p50, e2.lossPayout.p50);
  assert.equal(e1.failureBandPct, e2.failureBandPct);
});

test('computeEconomy: unknown difficulty string goes to unattributed', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000, difficulty: 'nonsense' }),
  ];
  const economy = computeEconomy(events);
  assert.equal(economy.byDifficulty.unattributed.winPayout.n, 1);
  assert.equal(economy.byDifficulty.lantern.winPayout.n, 0);
  assert.equal(economy.byDifficulty.blackout.winPayout.n, 0);
});

test('computeEconomy: tier with zero events returns nulls not NaN', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000, difficulty: 'lantern' }),
  ];
  const economy = computeEconomy(events);
  assert.equal(economy.byDifficulty.blackout.winPayout.p50, null);
  assert.equal(economy.byDifficulty.blackout.lossPayout.p50, null);
  assert.equal(economy.byDifficulty.blackout.failureBandPct, null);
  assert.equal(economy.byDifficulty.blackout.lossDepth.pctAbove24, null);
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

test('computeEconomy: byDifficulty buckets events per tier and sums to the pooled n', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000, difficulty: 'lantern' }),
    ev('loss', BASE_TS, 'b', { payout: 15, balance: 15, time_survived_ms: 30000, predator_kind: 'wolf', difficulty: 'lantern' }),
    ev('win', BASE_TS, 'c', { payout: 110, balance: 110, time_survived_ms: 90000, difficulty: 'night' }),
    ev('win', BASE_TS, 'd', { payout: 130, balance: 130, time_survived_ms: 90000, difficulty: 'blackout' }),
    ev('loss', BASE_TS, 'e', { payout: 40, balance: 40, time_survived_ms: 30000, predator_kind: 'bear', difficulty: 'blackout' }),
  ];
  const economy = computeEconomy(events);
  assert.equal(economy.byDifficulty.lantern.winPayout.n + economy.byDifficulty.lantern.lossPayout.n, 2);
  assert.equal(economy.byDifficulty.night.winPayout.n + economy.byDifficulty.night.lossPayout.n, 1);
  assert.equal(economy.byDifficulty.blackout.winPayout.n + economy.byDifficulty.blackout.lossPayout.n, 2);
  assert.equal(economy.byDifficulty.unattributed.winPayout.n + economy.byDifficulty.unattributed.lossPayout.n, 0);
  const tierTotal =
    economy.byDifficulty.lantern.winPayout.n +
    economy.byDifficulty.lantern.lossPayout.n +
    economy.byDifficulty.night.winPayout.n +
    economy.byDifficulty.night.lossPayout.n +
    economy.byDifficulty.blackout.winPayout.n +
    economy.byDifficulty.blackout.lossPayout.n +
    economy.byDifficulty.unattributed.winPayout.n +
    economy.byDifficulty.unattributed.lossPayout.n;
  assert.equal(tierTotal, economy.winPayout.n + economy.lossPayout.n);
});

test('computeEconomy: events with no difficulty field land in unattributed, pooled numbers unchanged', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000 }),
    ev('win', BASE_TS, 'b', { payout: 120, balance: 220, time_survived_ms: 90000 }),
    ev('loss', BASE_TS, 'c', { payout: 15, balance: 15, time_survived_ms: 30000, predator_kind: 'wolf' }),
    ev('loss', BASE_TS, 'd', { payout: 25, balance: 25, time_survived_ms: 30000, predator_kind: 'bear' }),
  ];
  const economy = computeEconomy(events);
  // Byte-identical to the pre-LUL-1450 pooled assertions above.
  assert.equal(economy.winPayout.n, 2);
  assert.equal(economy.winPayout.p50, 100);
  assert.equal(economy.lossPayout.n, 2);
  assert.equal(economy.lossPayout.p50, 15);
  assert.equal(economy.failureBandPct, 15);
  assert.equal(economy.byDifficulty.unattributed.winPayout.n, 2);
  assert.equal(economy.byDifficulty.unattributed.lossPayout.n, 2);
  assert.equal(economy.byDifficulty.lantern.winPayout.n, 0);
  assert.equal(economy.byDifficulty.night.winPayout.n, 0);
  assert.equal(economy.byDifficulty.blackout.winPayout.n, 0);
});

test('computeEconomy: an unrecognized difficulty string lands in unattributed, not a fourth bucket', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000, difficulty: 'nonsense' }),
  ];
  const economy = computeEconomy(events);
  assert.equal(economy.byDifficulty.unattributed.winPayout.n, 1);
  assert.equal(economy.byDifficulty.lantern.winPayout.n, 0);
  assert.equal(economy.byDifficulty.night.winPayout.n, 0);
  assert.equal(economy.byDifficulty.blackout.winPayout.n, 0);
});

test('computeEconomy: a tier with zero events yields nulls, not NaN', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000, difficulty: 'lantern' }),
  ];
  const economy = computeEconomy(events);
  assert.equal(economy.byDifficulty.blackout.winPayout.p50, null);
  assert.equal(economy.byDifficulty.blackout.winPayout.n, 0);
  assert.equal(economy.byDifficulty.blackout.failureBandPct, null);
  assert.equal(economy.byDifficulty.blackout.lossDepth.pctAbove24, null);
  assert.equal(Number.isNaN(economy.byDifficulty.blackout.winPayout.p50), false);
});

test('computeOutcomesByTier: win rate, run length and death distance, split per tier', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { time_survived_ms: 100000, difficulty: 'blackout' }),
    ev('loss', BASE_TS, 'b', { time_survived_ms: 40000, distance_from_home_m: 20, predator_kind: 'wolf', difficulty: 'blackout' }),
    ev('loss', BASE_TS, 'c', { time_survived_ms: 60000, distance_from_home_m: 40, predator_kind: 'bear', difficulty: 'blackout' }),
    ev('win', BASE_TS, 'd', { time_survived_ms: 90000, difficulty: 'lantern' }),
    ev('win', BASE_TS, 'e', { time_survived_ms: 95000, difficulty: 'lantern' }),
  ];
  const byTier = computeOutcomesByTier(events);
  assert.equal(byTier.blackout.winCount, 1);
  assert.equal(byTier.blackout.lossCount, 2);
  assert.equal(byTier.blackout.winRatePct, (1 / 3) * 100);
  assert.equal(byTier.blackout.runLengthMs.win.p50, 100000);
  assert.equal(byTier.blackout.runLengthMs.loss.p50, 40000);
  assert.equal(byTier.blackout.distanceFromHomeAtDeathM.p50, 20);
  assert.equal(byTier.blackout.distanceFromHomeAtDeathM.n, 2);
  assert.equal(byTier.lantern.winRatePct, 100);
  assert.equal(byTier.lantern.distanceFromHomeAtDeathM.n, 0);
  assert.equal(byTier.night.winCount, 0);
  assert.equal(byTier.night.winRatePct, null);
});

test('computeOutcomesByTier: events without difficulty land in unattributed, tier ns sum to pooled', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { time_survived_ms: 100000 }),
    ev('loss', BASE_TS, 'b', { time_survived_ms: 40000, predator_kind: 'wolf' }),
    ev('win', BASE_TS, 'c', { time_survived_ms: 90000, difficulty: 'nonsense' }),
  ];
  const byTier = computeOutcomesByTier(events);
  assert.equal(byTier.unattributed.winCount, 2);
  assert.equal(byTier.unattributed.lossCount, 1);
  assert.equal(byTier.lantern.winCount, 0);
  assert.equal(byTier.night.winCount, 0);
  assert.equal(byTier.blackout.winCount, 0);
});

test('computeOutcomesByTier: a tier with zero events yields nulls, not NaN', () => {
  const events: RawEvent[] = [ev('win', BASE_TS, 'a', { time_survived_ms: 100000, difficulty: 'lantern' })];
  const byTier = computeOutcomesByTier(events);
  assert.equal(byTier.blackout.winRatePct, null);
  assert.equal(byTier.blackout.runLengthMs.win.p50, null);
  assert.equal(byTier.blackout.distanceFromHomeAtDeathM.p50, null);
  assert.equal(Number.isNaN(byTier.blackout.runLengthMs.win.p50), false);
});

test('computeChaseGapByTier: median and p25 gap, split per tier', () => {
  const events: RawEvent[] = [
    ev('chase_gap', BASE_TS, 'a', { duration_ms: 4000, difficulty: 'blackout' }),
    ev('chase_gap', BASE_TS, 'b', { duration_ms: 8000, difficulty: 'blackout' }),
    ev('chase_gap', BASE_TS, 'c', { duration_ms: 12000, difficulty: 'blackout' }),
    ev('chase_gap', BASE_TS, 'd', { duration_ms: 16000, difficulty: 'blackout' }),
    ev('chase_gap', BASE_TS, 'e', { duration_ms: 20000, difficulty: 'lantern' }),
    ev('chase_gap', BASE_TS, 'f', { duration_ms: 30000, difficulty: 'lantern' }),
  ];
  const byTier = computeChaseGapByTier(events);
  assert.equal(byTier.blackout.gapMs.n, 4);
  assert.equal(byTier.blackout.gapMs.p50, 8000);
  assert.equal(byTier.blackout.gapMs.p25, 4000);
  assert.equal(byTier.lantern.gapMs.n, 2);
  assert.equal(byTier.lantern.gapMs.p50, 20000);
  assert.equal(byTier.night.gapMs.n, 0);
  assert.equal(byTier.night.gapMs.p50, null);
});

test('computeChaseGapByTier: other event types and missing duration_ms are ignored', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { time_survived_ms: 1000, difficulty: 'blackout' }),
    ev('chase_gap', BASE_TS, 'b', { difficulty: 'blackout' }),
  ];
  const byTier = computeChaseGapByTier(events);
  assert.equal(byTier.blackout.gapMs.n, 0);
});
