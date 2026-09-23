import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshRunState,
  isPlaying,
  canPickUp,
  beginPickup,
  completePickup,
  canTriggerDeath,
  triggerDeath,
  canRegenMap,
  canGrabThrowable,
  canThrowThrowable,
  type RunState,
} from './outcome.ts';

const RADIUS = 3.6; // matches the pickup-interaction distance in forest-engine.js

function state(overrides: Partial<RunState> = {}): RunState {
  return { ...freshRunState(), entered: true, ...overrides };
}

// ---- freshRunState / isPlaying ---------------------------------------------

test('freshRunState clears every flag, including babyTaken', () => {
  const s = freshRunState();
  assert.deepEqual(s, {
    entered: false, won: false, dead: false, pickingUp: false, babyTaken: false,
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

test('isPlaying does not look at babyTaken', () => {
  assert.equal(isPlaying(state({ babyTaken: true })), true);
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
});

test('a second beginPickup in the same frame is rejected (pickingUp already true)', () => {
  const first = beginPickup(state());
  const second = beginPickup(first);
  assert.deepEqual(second, first);
});

test('pickupAllowed (via canPickUp) rejects a fresh not-yet-taken-back child the same as always', () => {
  assert.equal(canPickUp(state(), 1, RADIUS), true);
});

test('canPickUp rejects an already-taken child', () => {
  const s = state({ babyTaken: true });
  assert.equal(canPickUp(s, 1, RADIUS), false);
});

test('completePickup hands off pickingUp -> won (LUL-2281: reverts LUL-1307 -- no carry-home leg)', () => {
  const picked = beginPickup(state());
  const next = completePickup(picked);
  assert.equal(next.pickingUp, false);
  assert.equal(next.won, true);
  assert.equal(next.babyTaken, true);
});

test('completePickup is a no-op when not currently pickingUp', () => {
  const s = state();
  assert.deepEqual(completePickup(s), s);
});

test('LUL-2281 golden path: beginPickup -> completePickup wins in one pass', () => {
  const next = completePickup(beginPickup(state()));
  assert.equal(next.won, true);
  assert.equal(next.pickingUp, false);
  assert.equal(next.babyTaken, true);
});

// ---- death --------------------------------------------------------------------

test('canTriggerDeath / triggerDeath allow death on a clean playing state', () => {
  const s = state({ babyTaken: true });
  assert.equal(canTriggerDeath(s), true);
  const next = triggerDeath(s);
  assert.equal(next.dead, true);
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

test('triggerDeath on a clean state only sets dead, leaves won untouched', () => {
  const next = triggerDeath(state());
  assert.equal(next.dead, true);
  assert.equal(next.won, false);
});

// ---- regenMap (LUL-1585) -------------------------------------------------------

test('canRegenMap allows a fresh map on a clean, in-progress run', () => {
  assert.equal(canRegenMap(state()), true);
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
