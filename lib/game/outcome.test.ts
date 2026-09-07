import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshRunState,
  isPlaying,
  canPickUp,
  beginPickup,
  completePickup,
  canArriveHome,
  arriveHome,
  canTriggerDeath,
  triggerDeath,
  canRegenMap,
  canGrabThrowable,
  canThrowThrowable,
  canSetDown,
  beginSetDown,
  type RunState,
} from './outcome.ts';

const RADIUS = 3.6; // matches CONFIG.home.r and the pickup-interaction distance in forest-engine.js

function state(overrides: Partial<RunState> = {}): RunState {
  return { ...freshRunState(), entered: true, ...overrides };
}

// ---- freshRunState / isPlaying ---------------------------------------------

test('freshRunState clears every flag, including babyTaken', () => {
  const s = freshRunState();
  assert.deepEqual(s, {
    entered: false, won: false, dead: false, pickingUp: false, carrying: false, setDown: false, babyTaken: false,
  });
});

test('isPlaying is true only when entered and none of won/dead/pickingUp are set', () => {
  assert.equal(isPlaying(state()), true);
});

test('isPlaying is false when not entered', () => {
  assert.equal(isPlaying(state({ entered: false })), false);
});

test('isPlaying is false while won', () => {
  assert.equal(isPlaying(state({ won: true })), false);
});

test('isPlaying is false while dead', () => {
  assert.equal(isPlaying(state({ dead: true })), false);
});

test('isPlaying is false while pickingUp', () => {
  assert.equal(isPlaying(state({ pickingUp: true })), false);
});

test('isPlaying does not look at carrying or babyTaken', () => {
  assert.equal(isPlaying(state({ carrying: true, babyTaken: true })), true);
});

// ---- pickup -----------------------------------------------------------------

test('canPickUp is true in range with no flags set', () => {
  assert.equal(canPickUp(state(), 1, RADIUS), true);
});

test('canPickUp boundary: distBaby === radius is not in range (strict <)', () => {
  assert.equal(canPickUp(state(), RADIUS, RADIUS), false);
});

test('canPickUp boundary: distBaby just under radius is in range', () => {
  assert.equal(canPickUp(state(), RADIUS - 0.001, RADIUS), true);
});

test('canPickUp / beginPickup reject while already carrying, made explicit (not just via babyTaken)', () => {
  const s = state({ carrying: true, babyTaken: true });
  assert.equal(canPickUp(s, 1, RADIUS), false);
  const next = beginPickup(s);
  assert.deepEqual(next, s);
});

test('beginPickup rejects while dead', () => {
  const s = state({ dead: true });
  assert.deepEqual(beginPickup(s), s);
});

test('beginPickup rejects while won', () => {
  const s = state({ won: true });
  assert.deepEqual(beginPickup(s), s);
});

test('beginPickup sets babyTaken and pickingUp on a clean state', () => {
  const next = beginPickup(state());
  assert.equal(next.babyTaken, true);
  assert.equal(next.pickingUp, true);
  assert.equal(next.carrying, false);
});

test('a second beginPickup in the same frame is rejected (pickingUp already true)', () => {
  const first = beginPickup(state());
  const second = beginPickup(first);
  assert.deepEqual(second, first);
});

test('pickupAllowed (via canPickUp) rejects a fresh not-yet-taken-back child the same as always', () => {
  assert.equal(canPickUp(state(), 1, RADIUS), true);
});

test('canPickUp allows re-pickup of a set-down child even though babyTaken is still true', () => {
  const s = state({ babyTaken: true, setDown: true });
  assert.equal(canPickUp(s, 1, RADIUS), true);
});

test('canPickUp still rejects a taken, not-set-down child (ordinary carrying-not-yet-set-down case)', () => {
  const s = state({ babyTaken: true, setDown: false });
  assert.equal(canPickUp(s, 1, RADIUS), false);
});

test('beginPickup on a set-down child clears setDown and re-enters pickingUp', () => {
  const s = state({ babyTaken: true, setDown: true });
  const next = beginPickup(s);
  assert.deepEqual(next, { ...s, babyTaken: true, pickingUp: true, setDown: false });
});

test('canSetDown is true only while carrying', () => {
  assert.equal(canSetDown(state({ carrying: true })), true);
  assert.equal(canSetDown(state({ carrying: false })), false);
});

test('canSetDown rejects while dead or won even if carrying is (inconsistently) still true', () => {
  assert.equal(canSetDown(state({ carrying: true, dead: true })), false);
  assert.equal(canSetDown(state({ carrying: true, won: true })), false);
});

test('beginSetDown clears carrying and sets setDown on a legitimate call', () => {
  const s = state({ carrying: true, babyTaken: true });
  const next = beginSetDown(s);
  assert.deepEqual(next, { ...s, carrying: false, setDown: true });
});

test('beginSetDown is a no-op when not carrying', () => {
  const s = state({ carrying: false });
  assert.deepEqual(beginSetDown(s), s);
});

test('a second beginSetDown in the same frame is rejected (carrying already false)', () => {
  const first = beginSetDown(state({ carrying: true }));
  const second = beginSetDown(first);
  assert.deepEqual(second, first);
});

test('completePickup hands off pickingUp -> carrying', () => {
  const picked = beginPickup(state());
  const next = completePickup(picked);
  assert.equal(next.pickingUp, false);
  assert.equal(next.carrying, true);
  assert.equal(next.babyTaken, true);
});

test('completePickup is a no-op when not currently pickingUp', () => {
  const s = state();
  assert.deepEqual(completePickup(s), s);
});

// ---- arrive home --------------------------------------------------------------

test('canArriveHome requires carrying', () => {
  assert.equal(canArriveHome(state(), 0, RADIUS), false);
});

test('canArriveHome boundary: dh === radius is not arrived (strict <)', () => {
  assert.equal(canArriveHome(state({ carrying: true }), RADIUS, RADIUS), false);
});

test('canArriveHome boundary: dh just under radius is arrived', () => {
  assert.equal(canArriveHome(state({ carrying: true }), RADIUS - 0.001, RADIUS), true);
});

test('a dead-while-carrying state cannot win -- canArriveHome and arriveHome both reject it', () => {
  // LUL-596: this is the behaviour that had no guard of its own before this
  // extraction, safe only by the position of its one call site. Pin it hard.
  const s = state({ carrying: true, dead: true });
  assert.equal(canArriveHome(s, 0, RADIUS), false);
  assert.deepEqual(arriveHome(s), s);
});

test('a won-while-carrying (already won) state does not re-win', () => {
  const s = state({ carrying: true, won: true });
  assert.equal(canArriveHome(s, 0, RADIUS), false);
  assert.deepEqual(arriveHome(s), s);
});

test('arriveHome sets won and clears carrying on a legitimate arrival', () => {
  const next = arriveHome(state({ carrying: true }));
  assert.equal(next.won, true);
  assert.equal(next.carrying, false);
});

// ---- death --------------------------------------------------------------------

test('canTriggerDeath / triggerDeath allow death while carrying -- you can be caught carrying the child', () => {
  const s = state({ carrying: true, babyTaken: true });
  assert.equal(canTriggerDeath(s), true);
  const next = triggerDeath(s);
  assert.equal(next.dead, true);
  assert.equal(next.carrying, true); // triggerDeath does not itself clear carrying
});

test('death during the pickup cinematic is ignored on purpose -- a deliberate invulnerability window, do not "fix"', () => {
  const s = state({ pickingUp: true, babyTaken: true });
  assert.equal(canTriggerDeath(s), false);
  assert.deepEqual(triggerDeath(s), s);
});

test('canTriggerDeath / triggerDeath reject once already won', () => {
  const s = state({ won: true });
  assert.equal(canTriggerDeath(s), false);
  assert.deepEqual(triggerDeath(s), s);
});

test('triggerDeath while already dead is idempotent -- a caller gating a track() call on a real transition fires it once', () => {
  const first = triggerDeath(state());
  const second = triggerDeath(first);
  assert.deepEqual(second, first);
});

test('triggerDeath on a clean state only sets dead, leaves won/carrying untouched', () => {
  const next = triggerDeath(state());
  assert.equal(next.dead, true);
  assert.equal(next.won, false);
  assert.equal(next.carrying, false);
});

// ---- regenMap (LUL-1585) -------------------------------------------------------

test('canRegenMap allows a fresh map on a clean, in-progress run', () => {
  assert.equal(canRegenMap(state()), true);
});

test('canRegenMap allows regenerating while carrying -- a dev-tool footgun, not a state-machine violation', () => {
  assert.equal(canRegenMap(state({ carrying: true })), true);
});

test('canRegenMap rejects once won', () => {
  assert.equal(canRegenMap(state({ won: true })), false);
});

test('canRegenMap rejects once dead', () => {
  assert.equal(canRegenMap(state({ dead: true })), false);
});

test('canGrabThrowable: in range and empty-handed can grab', () => {
  assert.equal(canGrabThrowable(false, 2, 3), true);
});

test('canGrabThrowable: already holding one cannot grab another', () => {
  assert.equal(canGrabThrowable(true, 2, 3), false);
});

test('canGrabThrowable: out of range cannot grab', () => {
  assert.equal(canGrabThrowable(false, 5, 3), false);
});

test('canThrowThrowable: only true while holding one', () => {
  assert.equal(canThrowThrowable(true), true);
  assert.equal(canThrowThrowable(false), false);
});
