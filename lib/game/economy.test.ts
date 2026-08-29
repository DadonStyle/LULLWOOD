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
  const p = computeDeathPayout(78, 110);
  assert.equal(p.depth, 19);
  assert.equal(p.survival, 5);
  assert.equal(p.carried, 0);
  assert.equal(p.home, 0);
  assert.equal(p.total, 19 + 5);
});

test('death is never zero once any ground was covered or any time survived', () => {
  const p = computeDeathPayout(40, 30);
  assert.ok(p.total > 0);
});

test('a death that got deep pays more than a death that never left the treeline', () => {
  const timid = computeDeathPayout(40, 30);
  const deep = computeDeathPayout(78, 90);
  assert.ok(deep.total > timid.total, 'cowardice must not be the best-paying strategy');
});

test('dying on the doorstep (carrying, at the win-median depth/survival) costs exactly carried+home vs. the equivalent win', () => {
  const win = computeWinPayout(78, 110);
  const death = computeDeathPayout(78, 110);
  assert.equal(win.total - death.total, 60 + 25);
});

test('a win at zero distance and zero seconds still pays the flat carried+home', () => {
  const p = computeWinPayout(0, 0);
  assert.equal(p.total, 60 + 25);
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
