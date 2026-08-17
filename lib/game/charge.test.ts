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
  assert.deepEqual(s, { phase: 'telegraph', t: 0, distance: 12 });
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

test('overshoot resolves to cleared after CHARGE_RUN_TIME and not a moment before', () => {
  let s: ChargeState = { phase: 'overshoot', t: 0, distance: 10 };
  s = stepCharge(s, CHARGE_RUN_TIME - 0.01, false);
  assert.equal(s.phase, 'overshoot');
  s = stepCharge(s, 0.01, false);
  assert.equal(s.phase, 'cleared');
});

test('stepCharge is a no-op once terminal (caught)', () => {
  const caught = { phase: 'caught' as const, t: 0, distance: 10 };
  const next = stepCharge(caught, 5, true);
  assert.deepEqual(next, caught);
});

test('stepCharge is a no-op once terminal (cleared)', () => {
  const cleared = { phase: 'cleared' as const, t: 0, distance: 10 };
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
