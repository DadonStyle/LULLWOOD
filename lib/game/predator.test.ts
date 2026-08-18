import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backOffPoint,
  CATCH_MARGIN,
  hasReachedSniffRange,
  isCaught,
  rollSniffs,
  shouldGiveUpChase,
  SNIFF_APPROACH_MARGIN,
  stepFlankHold,
  stepSniffLoop,
  tickTimers,
} from './predator.ts';

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
