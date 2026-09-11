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
  DEEPER_LUNGS_HOLD_SECONDS,
  DEEPER_LUNGS_COSTS,
  DEEPER_LUNGS_MAX_TIER,
  MISSION_DEEPWATER_REWARD,
  DEEPWATER_RETRIEVAL_BONUS,
  DEEPWATER_SPEEDRUN_BONUS,
  purchase,
  nextCost,
  tierOf,
  SHOP_CATALOG,
  effectiveScentLifetime,
  QUIET_STEP_COSTS,
  POCKET_STONES_COSTS,
  POCKET_STONES_RESERVE,
  type EmbersState,
} from './economy.ts';
import { SCENT_LIFETIME } from './scent.ts';

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

test('a win pays carried + rescue + depth + survival', () => {
  const p = computeWinPayout(78, 110);
  assert.equal(p.depth, 19);
  assert.equal(p.survival, 5);
  assert.equal(p.carried, 120);
  assert.equal(p.rescue, 50);
  assert.equal(p.total, 120 + 50 + 19 + 5);
});

test('a death pays only depth + survival -- carried and rescue are zero', () => {
  const p = computeDeathPayout(78, 110, 78);
  assert.equal(p.depth, 19);
  assert.equal(p.survival, 5);
  assert.equal(p.carried, 0);
  assert.equal(p.rescue, 0);
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

test('dying on the doorstep (carrying, at the win-median depth/survival) costs exactly carried+rescue vs. the equivalent win', () => {
  const win = computeWinPayout(78, 110);
  const death = computeDeathPayout(78, 110, 78);
  assert.equal(win.total - death.total, 120 + 50);
});

test('a win at zero distance and zero seconds still pays the flat carried+rescue', () => {
  const p = computeWinPayout(0, 0);
  assert.equal(p.total, 120 + 50);
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

test('win depth is unaffected by objective distance below the depth-62 ceiling: M2 Deepwater at 212m maxDist keeps depth 53', () => {
  const p = computeWinPayout(212, 50);
  assert.equal(p.depth, 53, 'win depth is never capped by objective distance');
  assert.equal(p.carried, 120);
  assert.equal(p.rescue, 50);
});

test('win depth caps at 62 past that distance -- this is the blackout farm fix (LUL-1792)', () => {
  const p = computeWinPayout(1000, 50);
  assert.equal(p.depth, 62, 'depth must not scale past the cap');
  assert.equal(computeDepth(1000), 250, 'uncapped depth would have been 250');
});

test('blackout win at the depth cap pays exactly 476E (depth 62 + survival 6 + carried 120 + rescue 50, x2.00 blackout, fields pre-scaled per LUL-1640)', () => {
  const p = computeWinPayout(1000, 120, 'blackout');
  assert.equal(p.depth, 124, 'depth field is already scaled by the tier multiplier (LUL-1640)');
  assert.equal(p.survival, 12, 'survival field is already scaled by the tier multiplier (LUL-1640)');
  assert.equal(p.total, 476);
  assert.equal(p.depth + p.survival + p.carried + p.rescue, p.total, 'fields must sum to total by construction');
});

// ---- LUL-1258: M2 Deepwater's mission bonus ------------------------------

test('computeWinPayout defaults missionBonus to zero -- an unrelated win pays nothing extra', () => {
  const withBonus = computeWinPayout(212, 50);
  assert.equal(withBonus.total, computeWinPayout(212, 50, 'lantern', 0).total);
});

test('completing M2 Deepwater and reaching home adds MISSION_DEEPWATER_REWARD on top of the win total', () => {
  const base = computeWinPayout(212, 50);
  const withMission = computeWinPayout(212, 50, 'lantern', MISSION_DEEPWATER_REWARD);
  assert.equal(withMission.total, base.total + MISSION_DEEPWATER_REWARD);
});

test('the mission bonus is not payable on death -- computeDeathPayout has no missionBonus argument', () => {
  // completing the mission then dying before reaching home forfeits the +12
  // entirely: computeDeathPayout's signature has no fourth argument to pass
  // it through, by design (S2's forfeiture rule).
  const p = computeDeathPayout(212, 50, 78);
  assert.equal(p.carried, 0);
  assert.equal(p.rescue, 0);
});

// ---- LUL-1666: secondary-objective bonus (retrieval/speedrun) -----------

test('computeWinPayout defaults secondaryBonus to zero -- a win with no secondary pays nothing extra', () => {
  const withBonus = computeWinPayout(212, 50);
  assert.equal(withBonus.total, computeWinPayout(212, 50, 'lantern', 0, 0).total);
});

test('completing the retrieval secondary adds DEEPWATER_RETRIEVAL_BONUS on top of the win total', () => {
  const base = computeWinPayout(212, 50);
  const withSecondary = computeWinPayout(212, 50, 'lantern', 0, DEEPWATER_RETRIEVAL_BONUS);
  assert.equal(withSecondary.total, base.total + DEEPWATER_RETRIEVAL_BONUS);
});

test('completing the speedrun secondary adds DEEPWATER_SPEEDRUN_BONUS on top of the win total', () => {
  const base = computeWinPayout(212, 50);
  const withSecondary = computeWinPayout(212, 50, 'lantern', 0, DEEPWATER_SPEEDRUN_BONUS);
  assert.equal(withSecondary.total, base.total + DEEPWATER_SPEEDRUN_BONUS);
});

test('missionBonus and secondaryBonus stack additively -- deepwater + retrieval both complete', () => {
  const base = computeWinPayout(212, 50);
  const both = computeWinPayout(212, 50, 'lantern', MISSION_DEEPWATER_REWARD, DEEPWATER_RETRIEVAL_BONUS);
  assert.equal(both.total, base.total + MISSION_DEEPWATER_REWARD + DEEPWATER_RETRIEVAL_BONUS);
});

test('secondaryBonus is scaled by the tier multiplier, same as missionBonus (LUL-1412)', () => {
  const lantern = computeWinPayout(212, 50, 'lantern', 0, DEEPWATER_RETRIEVAL_BONUS);
  const night = computeWinPayout(212, 50, 'night', 0, DEEPWATER_RETRIEVAL_BONUS);
  const base = computeWinPayout(212, 50, 'lantern');
  const baseNight = computeWinPayout(212, 50, 'night');
  assert.equal(lantern.total - base.total, Math.round(DEEPWATER_RETRIEVAL_BONUS * 1.0));
  assert.equal(night.total - baseNight.total, Math.round(DEEPWATER_RETRIEVAL_BONUS * 1.75));
});

test('the secondary bonus is not payable on death -- computeDeathPayout has no secondaryBonus argument', () => {
  // dying before reaching home forfeits the secondary bonus entirely, same
  // rule and same mechanism as the mission bonus above (S2's forfeiture rule
  // extended to secondaries by LUL-1666).
  const p = computeDeathPayout(212, 50, 78);
  assert.equal(p.carried, 0);
  assert.equal(p.rescue, 0);
});

// ---- Tier multipliers (LUL-1412) ----------------------------------------
// Corrected table: CEO ruling 2026-09-03 (wiki game/economy/tier-reward-multipliers §11)
//   lantern: ×1.00 win / ×1.00 loss
//   night:   ×1.75 win / ×1.35 loss
//   blackout: ×2.00 win / ×1.25 loss

// Win at d=96 (lantern band top, t=100s): base = depth(24)+survival(5)+carried(120)+rescue(50)=199
// LUL-1640: total is the sum of each field scaled+rounded individually, not a
// single round(sum*mult) -- night's 349 (not round(199*1.75)=348) is the
// visible effect: rescue(50*1.75=87.5) rounds up to 88 on its own, one more
// than round(199*1.75) would credit. This is intentional: it is what makes
// depth+survival+carried+rescue reconcile with total (see the reconciliation
// tests below), which round(sum*mult) cannot guarantee in general.
test('computeWinPayout tier multipliers pin the three win amounts', () => {
  const lw = computeWinPayout(96, 100, 'lantern');
  const nw = computeWinPayout(96, 100, 'night');
  const bw = computeWinPayout(96, 100, 'blackout');
  assert.equal(lw.total, 199);  // ×1.00
  assert.equal(nw.total, 349);  // 24*1.75 + round(5*1.75) + 120*1.75 + round(50*1.75) = 42+9+210+88
  assert.equal(bw.total, 398);  // ×2.00 has no fractional component, matches round(199*2.00)
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

// LUL-1640: RunRecap (components/Hud.tsx) renders
// `+depth · +survival · +carried · +rescue = total` and implies that sum --
// true before LUL-1412 by coincidence (no multiplier existed), broken after
// it because only `total` was scaled. Every tier must reconcile, not just lantern.
test('win payout breakdown reconciles with total on all three tiers (LUL-1640)', () => {
  for (const tier of ['lantern', 'night', 'blackout'] as const) {
    const p = computeWinPayout(96, 100, tier);
    assert.equal(p.depth + p.survival + p.carried + p.rescue, p.total, `${tier} win breakdown must sum to total`);
  }
});

test('death payout breakdown reconciles with total on all three tiers (LUL-1640)', () => {
  for (const tier of ['lantern', 'night', 'blackout'] as const) {
    const p = computeDeathPayout(44, 0, 44, tier);
    assert.equal(p.depth + p.survival + p.carried + p.rescue, p.total, `${tier} death breakdown must sum to total`);
  }
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

test('freshEmbersState starts at zero balance, empty tiers', () => {
  const s = freshEmbersState();
  assert.equal(s.balance, 0);
  assert.deepEqual(s.tiers, {});
});

// ---- Generic catalog spend ------------------------------------------------

test('SHOP_CATALOG has the three accepted items, 1,500 total across all tiers', () => {
  const total = SHOP_CATALOG.reduce((sum, item) => sum + item.costs.reduce((a, b) => a + b, 0), 0);
  assert.equal(total, 1500);
});

test('nextCost is 120/300/600 for deeperLungs tiers 0/1/2, then null once maxed', () => {
  assert.equal(nextCost('deeperLungs', 0), 120);
  assert.equal(nextCost('deeperLungs', 1), 300);
  assert.equal(nextCost('deeperLungs', 2), 600);
  assert.equal(nextCost('deeperLungs', 3), null);
  assert.equal(DEEPER_LUNGS_MAX_TIER, 3);
  assert.deepEqual(DEEPER_LUNGS_COSTS, [120, 300, 600]);
  assert.deepEqual(DEEPER_LUNGS_HOLD_SECONDS, [5, 6, 7, 8]);
});

test('nextCost is null for an unknown id', () => {
  assert.equal(nextCost('nope', 0), null);
});

test('tierOf is 0 for an id with no key yet', () => {
  const s: EmbersState = { balance: 0, tiers: {} };
  assert.equal(tierOf(s, 'quietStep'), 0);
});

test('purchase deducts cost and bumps the tier when affordable', () => {
  const s0: EmbersState = { balance: 150, tiers: {} };
  const s1 = purchase(s0, 'deeperLungs');
  assert.equal(s1.balance, 30);
  assert.equal(tierOf(s1, 'deeperLungs'), 1);
});

test('purchase is a no-op (same reference) when unaffordable', () => {
  const s0: EmbersState = { balance: 50, tiers: {} };
  const s1 = purchase(s0, 'deeperLungs');
  assert.equal(s1, s0);
});

test('purchase is a no-op once maxed, even with plenty of balance', () => {
  const s0: EmbersState = { balance: 99999, tiers: { pocketStones: 1 } };
  const s1 = purchase(s0, 'pocketStones');
  assert.equal(s1, s0);
});

test('purchase is a no-op for an unknown id', () => {
  const s0: EmbersState = { balance: 99999, tiers: {} };
  assert.equal(purchase(s0, 'nope'), s0);
});

test('purchasing quietStep twice in sequence costs 150+250 and lands at tier 2', () => {
  let s: EmbersState = { balance: 400, tiers: {} };
  s = purchase(s, 'quietStep');
  s = purchase(s, 'quietStep');
  assert.equal(tierOf(s, 'quietStep'), 2);
  assert.equal(s.balance, 0);
});

test('POCKET_STONES_COSTS/RESERVE are the accepted single-tier price and grant', () => {
  assert.deepEqual(QUIET_STEP_COSTS, [150, 250]);
  assert.deepEqual(POCKET_STONES_COSTS, [80]);
  assert.equal(POCKET_STONES_RESERVE, 2);
});

// ---- effectiveScentLifetime ------------------------------------------------

test('effectiveScentLifetime compounds 20% faster decay per Quiet Step tier', () => {
  assert.equal(effectiveScentLifetime(0), SCENT_LIFETIME);
  assert.equal(effectiveScentLifetime(1), SCENT_LIFETIME * 0.8);
  assert.equal(effectiveScentLifetime(2), SCENT_LIFETIME * 0.8 * 0.8);
  assert.equal(effectiveScentLifetime(9), effectiveScentLifetime(2)); // clamps at max tier
});
