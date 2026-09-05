import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDepth,
  computeSurvival,
  computeWinPayout,
  computeDeathPayout,
  applyPayout,
  freshEmbersState,
  veilMaxHoldForTier,
  nextDeeperLungsCost,
  purchaseDeeperLungs,
  DEEPER_LUNGS_HOLD_SECONDS,
  DEEPER_LUNGS_COSTS,
  DEEPER_LUNGS_MAX_TIER,
  type EmbersState,
} from './economy.ts';

// ---- computeDepth -----------------------------------------------------

test('computeDepth floors maxDistFromHome / 4', () => {
  assert.equal(computeDepth(0), 0);
  assert.equal(computeDepth(3), 0);
  assert.equal(computeDepth(4), 1);
  assert.equal(computeDepth(78), 19); // the design page's median-run example
  assert.equal(computeDepth(96), 24);
});

// ---- computeSurvival: the cap is the point -----------------------------

test('computeSurvival is floor(seconds/20) below the cap', () => {
  assert.equal(computeSurvival(0), 0);
  assert.equal(computeSurvival(19), 0);
  assert.equal(computeSurvival(20), 1);
  assert.equal(computeSurvival(99), 4);
});

test('computeSurvival caps at 6 exactly at 120s', () => {
  assert.equal(computeSurvival(120), 6);
});

test('computeSurvival never exceeds the cap no matter how long you stall', () => {
  // ten minutes in a bush pays the same as a clean two-minute crossing --
  // the cap that supersedes the deleted best-time score.
  assert.equal(computeSurvival(600), 6);
  assert.equal(computeSurvival(100000), 6);
});

// ---- computeWinPayout / computeDeathPayout -----------------------------

test('a win pays carried + home + depth + survival', () => {
  const p = computeWinPayout(78, 110);
  assert.equal(p.depth, 19);
  assert.equal(p.survival, 5);
  assert.equal(p.carried, 60);
  assert.equal(p.home, 25);
  assert.equal(p.total, 60 + 25 + 19 + 5);
});

test('a death pays only depth + survival -- carried and home are zero', () => {
  const p = computeDeathPayout(78, 110, 78);
  assert.equal(p.depth, 19);
  assert.equal(p.survival, 5);
  assert.equal(p.carried, 0);
  assert.equal(p.home, 0);
  assert.equal(p.total, 19 + 5);
});

test('death is never zero once any ground was covered or any time survived', () => {
  const p = computeDeathPayout(40, 30, 40);
  assert.ok(p.total > 0);
});

test('a death that got deep pays more than a death that never left the treeline', () => {
  const timid = computeDeathPayout(40, 30, 40);
  const deep = computeDeathPayout(78, 90, 78);
  assert.ok(deep.total > timid.total, 'cowardice must not be the best-paying strategy');
});

test('dying on the doorstep (carrying, at the win-median depth/survival) costs exactly carried+home vs. the equivalent win', () => {
  const win = computeWinPayout(78, 110);
  const death = computeDeathPayout(78, 110, 78);
  assert.equal(win.total - death.total, 60 + 25);
});

test('a win at zero distance and zero seconds still pays the flat carried+home', () => {
  const p = computeWinPayout(0, 0);
  assert.equal(p.total, 60 + 25);
});

// LUL-1192: depth cap on death at objective distance (farm exploit fix)

test('death depth is capped at the objective distance: drowned-car farm (212m far, 78m objective) pays depth 19 not 53', () => {
  const p = computeDeathPayout(212, 50, 78);
  assert.equal(p.depth, 19);
  assert.equal(p.survival, 2);
  assert.equal(p.total, 21);
});

test('death depth below the cap is unchanged: 55m distance, 78m objective (well below cap)', () => {
  const p = computeDeathPayout(55, 50, 78);
  assert.equal(p.depth, 13);
  assert.equal(computeDepth(55), 13, 'baseline unchanged');
});

test('blackout regression test: bogward death at 200m far, child at 220m objective pays depth 50 not 24', () => {
  // blackout child spawns at 140-241.6m; a flat 96 cap would underpay this
  const p = computeDeathPayout(200, 60, 220);
  assert.equal(p.depth, 50);
  assert.equal(computeDepth(220), 55, 'objective at 220m = depth 55');
  assert.equal(computeDepth(200), 50, 'but player only reached 200m = depth 50, so that is the cap');
});

test('win depth is uncapped even at far distances: M2 Deepwater at 212m maxDist keeps depth 53', () => {
  const p = computeWinPayout(212, 50);
  assert.equal(p.depth, 53, 'win depth is never capped by objective distance');
  assert.equal(p.carried, 60);
  assert.equal(p.home, 25);
});

// ---- Tier multipliers (LUL-1412) ----------------------------------------
// Corrected table: CEO ruling 2026-09-03 (wiki game/economy/tier-reward-multipliers §11)
//   lantern: ×1.00 win / ×1.00 loss
//   night:   ×1.75 win / ×1.35 loss
//   blackout: ×2.00 win / ×1.25 loss

// Win at d=96 (lantern band top, t=100s): base = depth(24)+survival(5)+carried(60)+home(25)=114
test('computeWinPayout tier multipliers pin the three win amounts', () => {
  const lw = computeWinPayout(96, 100, 'lantern');
  const nw = computeWinPayout(96, 100, 'night');
  const bw = computeWinPayout(96, 100, 'blackout');
  assert.equal(lw.total, 114);                        // ×1.00
  assert.equal(nw.total, Math.round(114 * 1.75));     // 200
  assert.equal(bw.total, Math.round(114 * 2.00));     // 228
});

// Death at d=44, t=0: base = depth(11)+survival(0)=11; objective>=44 so cap doesn't bind
test('computeDeathPayout tier multipliers pin the three death amounts', () => {
  const ld = computeDeathPayout(44, 0, 44, 'lantern');
  const nd = computeDeathPayout(44, 0, 44, 'night');
  const bd = computeDeathPayout(44, 0, 44, 'blackout');
  assert.equal(ld.total, 11);                         // ×1.00
  assert.equal(nd.total, Math.round(11 * 1.35));      // 15
  assert.equal(bd.total, Math.round(11 * 1.25));      // 14
});

// Regression: night > lantern for identical inputs — this is the structural defect fixed.
// Night and lantern share the same child-spawn distribution; night has 6.1× the effective
// hazard. The payout must be strictly higher for any non-zero run.
test('night win payout strictly exceeds lantern for identical non-zero inputs (fixes domination)', () => {
  const lanternWin = computeWinPayout(78, 120, 'lantern');
  const nightWin = computeWinPayout(78, 120, 'night');
  assert.ok(nightWin.total > lanternWin.total, `night ${nightWin.total} must exceed lantern ${lanternWin.total}`);
});

test('night death payout strictly exceeds lantern for identical non-zero inputs', () => {
  const lanternDeath = computeDeathPayout(78, 120, 78, 'lantern');
  const nightDeath = computeDeathPayout(78, 120, 78, 'night');
  assert.ok(nightDeath.total > lanternDeath.total, `night ${nightDeath.total} must exceed lantern ${lanternDeath.total}`);
});

test('computeWinPayout and computeDeathPayout default to lantern when tier is omitted', () => {
  assert.equal(computeWinPayout(96, 100).total, computeWinPayout(96, 100, 'lantern').total);
  assert.equal(computeDeathPayout(44, 0, 44).total, computeDeathPayout(44, 0, 44, 'lantern').total);
});

// ---- applyPayout --------------------------------------------------------

test('applyPayout adds the payout total to the balance and leaves tiers untouched', () => {
  const s0: EmbersState = { balance: 40, tiers: { deeperLungs: 1 } };
  const s1 = applyPayout(s0, computeWinPayout(60, 40));
  assert.equal(s1.balance, 40 + computeWinPayout(60, 40).total);
  assert.equal(s1.tiers.deeperLungs, 1);
});

// ---- Deeper Lungs tiers --------------------------------------------------

test('veilMaxHoldForTier steps 5 -> 6 -> 7 -> 8 across the three tiers', () => {
  assert.equal(veilMaxHoldForTier(0), 5);
  assert.equal(veilMaxHoldForTier(1), 6);
  assert.equal(veilMaxHoldForTier(2), 7);
  assert.equal(veilMaxHoldForTier(3), 8);
});

test('veilMaxHoldForTier clamps past the max tier instead of going out of range', () => {
  assert.equal(veilMaxHoldForTier(4), 8);
  assert.equal(veilMaxHoldForTier(-1), 5);
});

test('nextDeeperLungsCost is 120/300/600 for tiers 0/1/2, then null once maxed', () => {
  assert.equal(nextDeeperLungsCost(0), 120);
  assert.equal(nextDeeperLungsCost(1), 300);
  assert.equal(nextDeeperLungsCost(2), 600);
  assert.equal(nextDeeperLungsCost(3), null);
  assert.equal(DEEPER_LUNGS_MAX_TIER, 3);
  assert.deepEqual(DEEPER_LUNGS_COSTS, [120, 300, 600]);
  assert.deepEqual(DEEPER_LUNGS_HOLD_SECONDS, [5, 6, 7, 8]);
});

test('purchaseDeeperLungs deducts the cost and bumps the tier when affordable', () => {
  const s0: EmbersState = { balance: 150, tiers: { deeperLungs: 0 } };
  const s1 = purchaseDeeperLungs(s0);
  assert.equal(s1.balance, 30);
  assert.equal(s1.tiers.deeperLungs, 1);
});

test('purchaseDeeperLungs is a no-op when the balance can\'t cover the next tier', () => {
  const s0: EmbersState = { balance: 50, tiers: { deeperLungs: 0 } };
  const s1 = purchaseDeeperLungs(s0);
  assert.deepEqual(s1, s0);
});

test('purchaseDeeperLungs is a no-op once fully upgraded, even with plenty of balance', () => {
  const s0: EmbersState = { balance: 99999, tiers: { deeperLungs: 3 } };
  const s1 = purchaseDeeperLungs(s0);
  assert.deepEqual(s1, s0);
});

test('purchasing all three tiers in sequence costs exactly 120+300+600 and lands at tier 3', () => {
  let s: EmbersState = { balance: 120 + 300 + 600, tiers: { deeperLungs: 0 } };
  s = purchaseDeeperLungs(s);
  s = purchaseDeeperLungs(s);
  s = purchaseDeeperLungs(s);
  assert.equal(s.tiers.deeperLungs, 3);
  assert.equal(s.balance, 0);
});

test('freshEmbersState starts at zero balance, zero tiers', () => {
  const s = freshEmbersState();
  assert.equal(s.balance, 0);
  assert.equal(s.tiers.deeperLungs, 0);
});
