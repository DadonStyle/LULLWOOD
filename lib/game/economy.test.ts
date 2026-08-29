import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  depthEmbers,
  survivalEmbers,
  winPayout,
  deathPayout,
  CARRIED_EMBERS,
  HOME_EMBERS,
  DEEPER_LUNGS_COSTS,
  DEEPER_LUNGS_MAX_TIER,
  deeperLungsCost,
  canBuyDeeperLungs,
} from './economy.ts';

// ---- depth / survival terms -------------------------------------------------

test('depthEmbers floors distance/4 and clamps negative input to 0', () => {
  assert.equal(depthEmbers(78), 19);
  assert.equal(depthEmbers(0), 0);
  assert.equal(depthEmbers(-5), 0);
});

test('survivalEmbers floors seconds/20 and caps at 6 -- the cap is the point', () => {
  assert.equal(survivalEmbers(0), 0);
  assert.equal(survivalEmbers(19), 0);
  assert.equal(survivalEmbers(20), 1);
  assert.equal(survivalEmbers(110), 5);
  assert.equal(survivalEmbers(120), 6);
  // Ten minutes stalling in a bush must not outpay a clean two-minute
  // crossing -- both hit the same cap.
  assert.equal(survivalEmbers(600), 6);
});

// ---- win / death payout ------------------------------------------------------

test('winPayout adds the fixed carried+home terms to depth+survival', () => {
  // median run from the design doc: maxDist 78, 110s survived
  const p = winPayout(78, 110);
  assert.equal(p.depth, 19);
  assert.equal(p.survival, 5);
  assert.equal(p.carried, CARRIED_EMBERS);
  assert.equal(p.home, HOME_EMBERS);
  assert.equal(p.total, 60 + 25 + 19 + 5);
});

test('deathPayout never includes carried or home', () => {
  // typical outbound death from the design doc: maxDist 55, 50s survived
  const p = deathPayout(55, 50);
  assert.equal(p.carried, 0);
  assert.equal(p.home, 0);
  assert.equal(p.depth, 13);
  assert.equal(p.survival, 2);
  assert.equal(p.total, 15);
});

test('deathPayout is never negative even at the very start of a run', () => {
  const p = deathPayout(0, 0);
  assert.equal(p.total, 0);
});

test('dying on the doorstep with the child costs exactly carried+home (85) vs. winning from the same spot', () => {
  // Same maxDistFromHome/survivedSeconds at the moment of arrival -- the only
  // difference between winning and dying right there is the fixed bonus.
  const win = winPayout(78, 90);
  const deathAtSameSpot = deathPayout(78, 90);
  assert.equal(win.total - deathAtSameSpot.total, CARRIED_EMBERS + HOME_EMBERS);
  assert.equal(CARRIED_EMBERS + HOME_EMBERS, 85);
});

test('a deep death pays more than a timid one that never left the treeline', () => {
  const timid = deathPayout(40, 30);
  const deep = deathPayout(78, 90);
  assert.ok(deep.total > timid.total, 'cowardice must not be the best-paying strategy');
});

// ---- Deeper Lungs sink -------------------------------------------------------

test('deeperLungsCost walks the three tiers then returns null', () => {
  assert.equal(deeperLungsCost(0), DEEPER_LUNGS_COSTS[0]);
  assert.equal(deeperLungsCost(1), DEEPER_LUNGS_COSTS[1]);
  assert.equal(deeperLungsCost(2), DEEPER_LUNGS_COSTS[2]);
  assert.equal(deeperLungsCost(DEEPER_LUNGS_MAX_TIER), null);
});

test('canBuyDeeperLungs checks balance against the next tier only', () => {
  assert.equal(canBuyDeeperLungs(119, 0), false);
  assert.equal(canBuyDeeperLungs(120, 0), true);
  assert.equal(canBuyDeeperLungs(1000, DEEPER_LUNGS_MAX_TIER), false);
});
