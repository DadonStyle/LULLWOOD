import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backOffPoint,
  canCatchInChase,
  CATCH_MARGIN,
  hasReachedSniffRange,
  isCaught,
  isSniffImmune,
  LKP_MAX_SWEEPS,
  LKP_RING_RADIUS,
  LKP_REPEAT_RADIUS,
  pickRoamWaypoint,
  predatorSeparationPush,
  rollSniffs,
  shouldGiveUpChase,
  shouldRevertInvestigateToChase,
  SNIFF_APPROACH_MARGIN,
  SNIFF_IMMUNITY_TIME,
  stepApproach,
  stepFlankHold,
  stepSniffLoop,
  tickTimers,
} from './predator.ts';
import { ROAM_STEP_FRAC } from '../../engine/tuning.js';

// ---- rollSniffs --------------------------------------------------------------

test('rollSniffs(rng, 4) is 1 at the bottom of the roll', () => {
  assert.equal(rollSniffs(() => 0, 4), 1);
});

test('rollSniffs(rng, 4) tops out at 4 just under rng() === 1', () => {
  assert.equal(rollSniffs(() => 0.9999999, 4), 4);
});

test('rollSniffs(rng, 3) tops out at 3, not 4 -- pinning the N=3 call sites separately from N=4', () => {
  assert.equal(rollSniffs(() => 0.9999999, 3), 3);
  assert.equal(rollSniffs(() => 0, 3), 1);
});

test('rollSniffs floors a mid-range roll rather than rounding', () => {
  // 0.7 * 4 = 2.8 -> floor 2, +1 = 3
  assert.equal(rollSniffs(() => 0.7, 4), 3);
});

// ---- isCaught -----------------------------------------------------------------

test('isCaught is false exactly at the catch margin (strict less-than)', () => {
  assert.equal(isCaught(1 + CATCH_MARGIN, 1), false);
});

test('isCaught is true a hair inside the catch margin', () => {
  assert.equal(isCaught(1 + CATCH_MARGIN - 0.001, 1), true);
});

test('isCaught is false well outside the margin', () => {
  assert.equal(isCaught(10, 1), false);
});

// ---- canCatchInChase (LUL-387) --------------------------------------------------

test('canCatchInChase is false at catch-range distance when there is no line of sight -- the through-cover regression', () => {
  // Well within isCaught's own margin (dist=1, rad+CATCH_MARGIN=2.3), but a
  // blind-scent chase (canSee=false, e.g. a bramble/log breaking sight) must
  // not still be able to kill through the cover it can't see through.
  assert.equal(canCatchInChase(false, 1, 1), false);
});

test('canCatchInChase is true at the same distance once there is a sightline', () => {
  assert.equal(canCatchInChase(true, 1, 1), true);
});

test('canCatchInChase is false without LOS no matter how close the distance (dist=0)', () => {
  assert.equal(canCatchInChase(false, 0, 1), false);
});

test('canCatchInChase defers to isCaught\'s own margin when LOS holds -- not caught a hair outside it', () => {
  assert.equal(canCatchInChase(true, 1 + CATCH_MARGIN, 1), false);
  assert.equal(canCatchInChase(true, 1 + CATCH_MARGIN - 0.001, 1), true);
});

// ---- hasReachedSniffRange ------------------------------------------------------

test('hasReachedSniffRange is false exactly at its margin (strict less-than)', () => {
  assert.equal(hasReachedSniffRange(1 + SNIFF_APPROACH_MARGIN, 1), false);
});

test('hasReachedSniffRange is true a hair inside its margin', () => {
  assert.equal(hasReachedSniffRange(1 + SNIFF_APPROACH_MARGIN - 0.001, 1), true);
});

test('hasReachedSniffRange and isCaught use different margins -- not the same threshold', () => {
  // rad+CATCH_MARGIN = 2.3, rad+SNIFF_APPROACH_MARGIN = 2.7: at dist=2.5 the
  // predator has reached sniff range but has not caught the player.
  const dist = 2.5, rad = 1;
  assert.equal(isCaught(dist, rad), false);
  assert.equal(hasReachedSniffRange(dist, rad), true);
});

// ---- shouldGiveUpChase ---------------------------------------------------------

test('shouldGiveUpChase is false while scentLock still holds, no matter the distance', () => {
  assert.equal(shouldGiveUpChase(0.001, 1000, 10), false);
});

test('shouldGiveUpChase treats scentLock === 0 as expired', () => {
  assert.equal(shouldGiveUpChase(0, 100, 10), true);
});

test('shouldGiveUpChase treats a negative scentLock as expired', () => {
  assert.equal(shouldGiveUpChase(-5, 100, 10), true);
});

test('shouldGiveUpChase distance leash is exclusive: exactly at 1.5x detect does not give up', () => {
  assert.equal(shouldGiveUpChase(0, 15, 10), false); // 15 === 10*1.5
});

test('shouldGiveUpChase gives up a hair past the leash', () => {
  assert.equal(shouldGiveUpChase(0, 15.001, 10), true);
});

test('shouldGiveUpChase is false when close, even with scentLock expired', () => {
  assert.equal(shouldGiveUpChase(0, 1, 10), false);
});

// ---- tickTimers -----------------------------------------------------------------

test('tickTimers decrements both timers by dt while positive', () => {
  const out = tickTimers({ scentLock: 5, chargeCooldown: 3 }, 1);
  assert.deepEqual(out, { scentLock: 4, chargeCooldown: 2 });
});

test('tickTimers does not decrement a timer that is already at or below zero', () => {
  const out = tickTimers({ scentLock: 0, chargeCooldown: -2 }, 1);
  assert.deepEqual(out, { scentLock: 0, chargeCooldown: -2 });
});

test('tickTimers can cross zero in a single call (no clamping to zero)', () => {
  const out = tickTimers({ scentLock: 0.5, chargeCooldown: 0.5 }, 1);
  assert.deepEqual(out, { scentLock: -0.5, chargeCooldown: -0.5 });
});

test('tickTimers has no state/mode input -- it decays the same way regardless of what state a predator is in, which is the load-bearing behaviour at forest-engine.js line 903 (a lock set during chase has already expired by the time roam re-checks it)', () => {
  let timers = { scentLock: 1, chargeCooldown: 0 };
  // Simulate several ticks across whatever states the engine visits in
  // between -- tickTimers itself is state-agnostic, so calling it
  // repeatedly with only dt is exactly what "ticks in every state" means.
  timers = tickTimers(timers, 0.6);
  timers = tickTimers(timers, 0.6);
  assert.equal(timers.scentLock < 0, true); // expired before a third check would even run
});

// ---- stepSniffLoop --------------------------------------------------------------

test('stepSniffLoop is not done while the timer is still positive', () => {
  assert.deepEqual(stepSniffLoop(0.1, 3), { done: false });
});

test('stepSniffLoop fires exactly at timer === 0 (boundary, not just negative)', () => {
  const out = stepSniffLoop(0, 3);
  assert.equal(out.done, true);
});

test('stepSniffLoop fires for a negative (overshot) timer too', () => {
  const out = stepSniffLoop(-0.2, 3);
  assert.equal(out.done, true);
});

test('stepSniffLoop with sniffsLeft=2 decrements to 1 and continues to back', () => {
  assert.deepEqual(stepSniffLoop(0, 2), { done: true, sniffsLeft: 1, next: 'back' });
});

test('stepSniffLoop with sniffsLeft=1 decrements to 0 and gives up to roam -- the exactly-0-vs-1 edge case', () => {
  assert.deepEqual(stepSniffLoop(0, 1), { done: true, sniffsLeft: 0, next: 'roam' });
});

test('stepSniffLoop with sniffsLeft already 0 decrements to -1 and still gives up to roam', () => {
  assert.deepEqual(stepSniffLoop(0, 0), { done: true, sniffsLeft: -1, next: 'roam' });
});

// ---- stepFlankHold --------------------------------------------------------------

test('stepFlankHold is not done while the timer is still positive', () => {
  assert.deepEqual(stepFlankHold(0.1, 3), { done: false });
});

test('stepFlankHold fires exactly at timer === 0', () => {
  const out = stepFlankHold(0, 3);
  assert.equal(out.done, true);
});

test('stepFlankHold with sniffsLeft=2 decrements to 1 and continues holding', () => {
  assert.deepEqual(stepFlankHold(0, 2), { done: true, sniffsLeft: 1, next: 'hold' });
});

test('stepFlankHold with sniffsLeft=1 decrements to 0 and gives up to roam -- the exactly-0-vs-1 edge case', () => {
  assert.deepEqual(stepFlankHold(0, 1), { done: true, sniffsLeft: 0, next: 'roam' });
});

test('stepFlankHold never returns next: "back" -- that transition belongs to stepSniffLoop only', () => {
  const out = stepFlankHold(0, 2);
  assert.notEqual((out as { next?: string }).next, 'back');
});

// ---- isSniffImmune (LUL-437) -----------------------------------------------------

test('isSniffImmune is true while the timer is positive and the player is hidden', () => {
  assert.equal(isSniffImmune(SNIFF_IMMUNITY_TIME, true), true);
});

test('isSniffImmune is false once the timer reaches zero, even hidden', () => {
  assert.equal(isSniffImmune(0, true), false);
});

test('isSniffImmune is false for a negative (overshot) timer', () => {
  assert.equal(isSniffImmune(-0.01, true), false);
});

test('isSniffImmune is false if the player is not hidden, no matter the timer -- moving cancels the grace immediately', () => {
  assert.equal(isSniffImmune(SNIFF_IMMUNITY_TIME, false), false);
});

test('isSniffImmune is false with neither condition met', () => {
  assert.equal(isSniffImmune(0, false), false);
});

// ---- shouldRevertInvestigateToChase (LUL-562) --------------------------------------

test('shouldRevertInvestigateToChase is false for a freshly-entered "approach" phase even when not hidden -- the livelock fix', () => {
  // This is the exact case that oscillated forever on main: every
  // chase->investigate transition sets p.inv='approach', and the old
  // unconditional `!hidden` gate flipped straight back to chase before
  // 'approach' ever got to run its own movement code.
  assert.equal(shouldRevertInvestigateToChase('approach', false), false);
});

test('shouldRevertInvestigateToChase is false for "approach" while hidden too', () => {
  assert.equal(shouldRevertInvestigateToChase('approach', true), false);
});

test('shouldRevertInvestigateToChase is true for "sniff" when not hidden -- the close-range case the original gate is for', () => {
  assert.equal(shouldRevertInvestigateToChase('sniff', false), true);
});

test('shouldRevertInvestigateToChase is true for "back" when not hidden', () => {
  assert.equal(shouldRevertInvestigateToChase('back', false), true);
});

test('shouldRevertInvestigateToChase is false for "sniff" while still hidden', () => {
  assert.equal(shouldRevertInvestigateToChase('sniff', true), false);
});

test('shouldRevertInvestigateToChase is false for "back" while still hidden', () => {
  assert.equal(shouldRevertInvestigateToChase('back', true), false);
});

// ---- stepApproach (LUL-658) -------------------------------------------------------

test('stepApproach reports movement toward the player when still outside sniff range', () => {
  const step = stepApproach(1, 0, 10, 100, 1);
  assert.equal(step.desx, 1);
  assert.equal(step.desz, 0);
  assert.equal(step.speed, 4.5); // 10 * 0.45
  assert.equal(step.enterSniff, false);
});

test('stepApproach still reports the same movement on the tick it also enters sniff range -- the point-blank livelock fix', () => {
  // On main, the engine's `if(hasReachedSniffRange){enter sniff} else {move}`
  // gating meant the exact tick that crossed the threshold applied zero
  // movement. Every chase<->investigate bounce re-enters 'approach' at that
  // same frozen distance and re-fires the same zero-movement transition,
  // forever, when the crossing tick lands short of the distance canSee
  // clears (LUL-658/LUL-659's traced bear stall). stepApproach must report
  // movement unconditionally, whether or not enterSniff also fires this tick.
  const dist = 1 + SNIFF_APPROACH_MARGIN - 0.001; // a hair inside sniff range
  const step = stepApproach(1, 0, 10, dist, 1);
  assert.equal(step.enterSniff, true);
  assert.equal(step.desx, 1);
  assert.equal(step.desz, 0);
  assert.equal(step.speed, 4.5);
});

test('stepApproach enterSniff is false exactly at the sniff-range boundary (strict less-than, matching hasReachedSniffRange)', () => {
  const step = stepApproach(1, 0, 10, 1 + SNIFF_APPROACH_MARGIN, 1);
  assert.equal(step.enterSniff, false);
});

test('stepApproach scales speed by the fixed 0.45 approach multiplier regardless of species speed', () => {
  assert.equal(stepApproach(0, 1, 6.8, 100, 1.5).speed, 3.06); // bear
  assert.equal(stepApproach(0, 1, 8.5, 100, 0.8).speed, 3.825); // wolf
});

// ---- backOffPoint ---------------------------------------------------------------

test('backOffPoint moves dist units opposite the predator-to-player direction', () => {
  const [x, z] = backOffPoint(0, 0, 1, 0, 8, 1000);
  assert.equal(x, -8);
  assert.equal(z, 0);
});

test('backOffPoint clamps to the map bound on the positive side', () => {
  const [x] = backOffPoint(0, 0, -1, 0, 100, 10); // -half+4..half-4 = -6..6
  assert.equal(x, 6);
});

test('backOffPoint clamps to the map bound on the negative side', () => {
  const [x] = backOffPoint(0, 0, 1, 0, 100, 10);
  assert.equal(x, -6);
});

test('backOffPoint with a zero-length direction vector (degenerate case) leaves the point where it started', () => {
  const [x, z] = backOffPoint(5, -3, 0, 0, 8, 1000);
  assert.equal(x, 5);
  assert.equal(z, -3);
});

test('backOffPoint with dist=0 (coincident points) leaves the point where it started', () => {
  const [x, z] = backOffPoint(5, -3, 1, 0, 0, 1000);
  assert.equal(x, 5);
  assert.equal(z, -3);
});

// ---- predatorSeparationPush (LUL-394) --------------------------------------

test('predatorSeparationPush: no push when circles do not overlap', () => {
  const [px, pz] = predatorSeparationPush(0, 0, 1, [{ x: 10, z: 0, rad: 1 }]);
  assert.equal(px, 0);
  assert.equal(pz, 0);
});

test('predatorSeparationPush: no push when circles are exactly touching (boundary, not overlapping)', () => {
  const [px, pz] = predatorSeparationPush(0, 0, 1, [{ x: 2, z: 0, rad: 1 }]);
  assert.equal(px, 0);
  assert.equal(pz, 0);
});

test('predatorSeparationPush: pushes away from an overlapping predator by half the overlap', () => {
  // rad 1 + rad 1 = minDist 2, actual dist 1 -> overlap 1 -> push 0.5 along -x (away from the other, at +x)
  const [px, pz] = predatorSeparationPush(0, 0, 1, [{ x: 1, z: 0, rad: 1 }]);
  assert.equal(px, -0.5);
  assert.ok(Math.abs(pz) < 1e-9);
});

test('predatorSeparationPush: symmetric -- the other predator gets the mirrored push', () => {
  const [px1] = predatorSeparationPush(0, 0, 1, [{ x: 1, z: 0, rad: 1 }]);
  const [px2] = predatorSeparationPush(1, 0, 1, [{ x: 0, z: 0, rad: 1 }]);
  assert.equal(px1, -px2);
});

test('predatorSeparationPush: exact-overlap fallback pushes along a fixed heading instead of returning zero', () => {
  const [px, pz] = predatorSeparationPush(3, 3, 1, [{ x: 3, z: 3, rad: 1 }]);
  assert.ok(px !== 0, 'coincident predators must still separate, not silently stay stacked');
  assert.equal(pz, 0);
});

test('predatorSeparationPush: sums pushes from multiple overlapping predators', () => {
  const [px, pz] = predatorSeparationPush(0, 0, 1, [
    { x: 1, z: 0, rad: 1 },
    { x: 0, z: 1, rad: 1 },
  ]);
  assert.equal(px, -0.5);
  assert.equal(pz, -0.5);
});

test('predatorSeparationPush: an empty others list is a no-op', () => {
  const [px, pz] = predatorSeparationPush(0, 0, 1, []);
  assert.equal(px, 0);
  assert.equal(pz, 0);
});

// ---- pickRoamWaypoint (LUL-1620) ------------------------------------------------

test('pickRoamWaypoint with no live memory (sweepsLeft=0) reproduces the LUL-1808 map-size-scaled uniform pick around the predator', () => {
  const calls = [0.25, 0.5];
  const rng = () => calls.shift()!;
  const half = 240;
  const pick = pickRoamWaypoint(rng, /*px*/10, /*pz*/20, /*lkpX*/0, /*lkpZ*/0, /*sweepsLeft*/0, /*dist*/999, half);
  const a = 0.25 * Math.PI * 2, r = half * (ROAM_STEP_FRAC.min + 0.5 * ROAM_STEP_FRAC.range);
  assert.equal(pick.x, 10 + Math.cos(a) * r);
  assert.equal(pick.z, 20 + Math.sin(a) * r);
  assert.equal(pick.sweepsLeft, 0);
});

test('pickRoamWaypoint with live memory centers the waypoint on the remembered point, not the predator', () => {
  const rng = () => 0;
  const pick = pickRoamWaypoint(rng, /*px*/500, /*pz*/500, /*lkpX*/10, /*lkpZ*/20, /*sweepsLeft*/2, /*dist*/0, /*half*/240);
  // a=0 -> cos=1, sin=0; r = LKP_RING_RADIUS + 0*LKP_RING_JITTER
  assert.equal(pick.x, 10 + LKP_RING_RADIUS);
  assert.equal(pick.z, 20);
});

test('pickRoamWaypoint decrements sweepsLeft while the player is still within the repeat radius', () => {
  const rng = () => 0;
  const pick = pickRoamWaypoint(rng, 0, 0, 0, 0, 2, LKP_REPEAT_RADIUS - 1, /*half*/240);
  assert.equal(pick.sweepsLeft, 1);
});

test('pickRoamWaypoint clears memory once the bounded sweep count is exhausted, even if the player is still close', () => {
  const rng = () => 0;
  const pick = pickRoamWaypoint(rng, 0, 0, 0, 0, 1, 0, /*half*/240);
  assert.equal(pick.sweepsLeft, 0);
});

test('pickRoamWaypoint clears memory early when the player has left the repeat radius, even with sweeps remaining', () => {
  const rng = () => 0;
  const pick = pickRoamWaypoint(rng, 0, 0, 0, 0, LKP_MAX_SWEEPS, LKP_REPEAT_RADIUS + 0.01, /*half*/240);
  assert.equal(pick.sweepsLeft, 0);
});

test('pickRoamWaypoint is inclusive at exactly the repeat radius boundary', () => {
  const rng = () => 0;
  const pick = pickRoamWaypoint(rng, 0, 0, 0, 0, 2, LKP_REPEAT_RADIUS, /*half*/240);
  assert.equal(pick.sweepsLeft, 1);
});
