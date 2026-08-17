import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldTriggerCharge,
  startCharge,
  stepCharge,
  chargeSpeed,
  CHARGE_TRIGGER_MIN,
  CHARGE_TRIGGER_MAX,
  CHARGE_WINDOW,
  CHARGE_TELL_TIME,
  CHARGE_RUN_TIME,
  type ChargeState,
} from './charge.ts';

// ---- shouldTriggerCharge ---------------------------------------------------

test('shouldTriggerCharge never fires outside the trigger band', () => {
  assert.equal(shouldTriggerCharge(CHARGE_TRIGGER_MIN - 0.01, 1, () => 0), false);
  assert.equal(shouldTriggerCharge(CHARGE_TRIGGER_MAX + 0.01, 1, () => 0), false);
});

test('shouldTriggerCharge is inclusive of the band edges', () => {
  assert.equal(shouldTriggerCharge(CHARGE_TRIGGER_MIN, 1, () => 0), true);
  assert.equal(shouldTriggerCharge(CHARGE_TRIGGER_MAX, 1, () => 0), true);
});

test('shouldTriggerCharge with dt=0 never fires, even inside the band', () => {
  const mid = (CHARGE_TRIGGER_MIN + CHARGE_TRIGGER_MAX) / 2;
  assert.equal(shouldTriggerCharge(mid, 0, () => 0), false);
});

test('shouldTriggerCharge is a plain dt-scaled roll: rand() below the threshold fires, at/above does not', () => {
  const mid = (CHARGE_TRIGGER_MIN + CHARGE_TRIGGER_MAX) / 2;
  assert.equal(shouldTriggerCharge(mid, 1 / 60, () => 0), true);
  assert.equal(shouldTriggerCharge(mid, 1 / 60, () => 0.999), false);
});

// ---- startCharge / stepCharge ---------------------------------------------

test('startCharge begins in telegraph at t=0 with the captured distance', () => {
  const s = startCharge(12);
  assert.deepEqual(s, { phase: 'telegraph', t: 0, distance: 12, overshootDuration: 0 });
});

test('stepCharge stays in telegraph before CHARGE_TELL_TIME elapses', () => {
  let s = startCharge(10);
  s = stepCharge(s, CHARGE_TELL_TIME - 0.01, false);
  assert.equal(s.phase, 'telegraph');
});

test('stepCharge flips telegraph -> charging exactly at CHARGE_TELL_TIME (boundary inclusive)', () => {
  let s = startCharge(10);
  s = stepCharge(s, CHARGE_TELL_TIME, false);
  assert.equal(s.phase, 'charging');
});

test('stepCharge resolves to caught once the window fully elapses without a jump', () => {
  let s = startCharge(10);
  s = stepCharge(s, CHARGE_WINDOW, false);
  assert.equal(s.phase, 'caught');
});

test('a jump on the very last frame still counts as a dodge (checked before the window-expiry check)', () => {
  let s = startCharge(10);
  s = stepCharge(s, CHARGE_WINDOW, true);
  assert.equal(s.phase, 'overshoot');
});

test('stepCharge dodges into overshoot from telegraph too, not just charging', () => {
  let s = startCharge(10);
  s = stepCharge(s, 0.05, true);
  assert.equal(s.phase, 'overshoot');
  assert.equal(s.t, 0);
});

test('overshoot resolves to cleared after its own overshootDuration and not a moment before', () => {
  let s: ChargeState = { phase: 'overshoot', t: 0, distance: 10, overshootDuration: CHARGE_RUN_TIME };
  s = stepCharge(s, CHARGE_RUN_TIME - 0.01, false);
  assert.equal(s.phase, 'overshoot');
  s = stepCharge(s, 0.01, false);
  assert.equal(s.phase, 'cleared');
});

// ---- LUL-323: overshoot must repeat only the distance actually closed, not
// the full original trigger distance, or an early (correctly-timed!) dodge
// overshoots straight back onto the player. ---------------------------------

test('dodging during the stationary telegraph closes zero distance, so overshoot is instant (0 duration)', () => {
  let s = startCharge(10);
  s = stepCharge(s, 0.1, true); // still inside telegraph (< CHARGE_TELL_TIME), no movement yet
  assert.equal(s.phase, 'overshoot');
  assert.equal(s.overshootDuration, 0);
  // Any further step, however small, is already past overshootDuration=0.
  s = stepCharge(s, 0.001, false);
  assert.equal(s.phase, 'cleared');
});

test('dodging just after charging starts overshoots for only the sliver of time actually spent charging', () => {
  let s = startCharge(10);
  s = stepCharge(s, CHARGE_TELL_TIME + 0.02, true); // 0.02s into the moving sub-phase
  assert.equal(s.phase, 'overshoot');
  assert.ok(Math.abs(s.overshootDuration - 0.02) < 1e-9);
});

test('dodging right at the window edge (after nearly the whole charging run) overshoots for nearly the full CHARGE_RUN_TIME', () => {
  let s = startCharge(10);
  s = stepCharge(s, CHARGE_WINDOW - 0.001, true); // almost the entire charging run elapsed
  assert.equal(s.phase, 'overshoot');
  assert.ok(Math.abs(s.overshootDuration - (CHARGE_RUN_TIME - 0.001)) < 1e-9);
});

test('overshootDuration is never negative and never exceeds CHARGE_RUN_TIME regardless of dodge timing', () => {
  for (const dodgeAt of [0, 0.1, CHARGE_TELL_TIME, CHARGE_TELL_TIME + 0.01, CHARGE_WINDOW - 0.001, CHARGE_WINDOW]) {
    let s = startCharge(10);
    s = stepCharge(s, dodgeAt, true);
    assert.ok(s.overshootDuration >= 0, `dodgeAt=${dodgeAt}`);
    assert.ok(s.overshootDuration <= CHARGE_RUN_TIME + 1e-9, `dodgeAt=${dodgeAt}`);
  }
});

test('an early dodge lands the predator far short of the player (regression for LUL-323): total distance traveled after resolution is small, not the full trigger distance', () => {
  let s = startCharge(10);
  s = stepCharge(s, CHARGE_TELL_TIME + 0.01, true); // dodge right as movement starts
  const speed = chargeSpeed(s.distance);
  const distanceCoveredByOvershoot = speed * s.overshootDuration;
  // Barely moved before the dodge (0.01s of the 0.65s run) -> barely
  // overshoots either. Old, buggy behavior always traveled the full 10 units
  // here, which is what put the predator back on top of the player.
  assert.ok(distanceCoveredByOvershoot < 1, `expected a small overshoot, got ${distanceCoveredByOvershoot}`);
});

test('stepCharge is a no-op once terminal (caught)', () => {
  const caught = { phase: 'caught' as const, t: 0, distance: 10, overshootDuration: 0 };
  const next = stepCharge(caught, 5, true);
  assert.deepEqual(next, caught);
});

test('stepCharge is a no-op once terminal (cleared)', () => {
  const cleared = { phase: 'cleared' as const, t: 0, distance: 10, overshootDuration: 0 };
  const next = stepCharge(cleared, 5, false);
  assert.deepEqual(next, cleared);
});

test('zero-distance charge still runs the clock, not a degenerate instant resolve', () => {
  let s = startCharge(0);
  s = stepCharge(s, CHARGE_TELL_TIME, false);
  assert.equal(s.phase, 'charging');
  assert.equal(chargeSpeed(0), 0);
});

// ---- chargeSpeed ------------------------------------------------------------

test('chargeSpeed times CHARGE_RUN_TIME reproduces the original distance', () => {
  const distance = 13.4;
  const speed = chargeSpeed(distance);
  assert.ok(Math.abs(speed * CHARGE_RUN_TIME - distance) < 1e-9);
});
