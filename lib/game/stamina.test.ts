import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepStamina, sprintSpeedMul, STAMINA_DRAIN_TIME, STAMINA_REGEN_MUL, STAMINA_SPRINT_MUL } from './stamina.ts';

test('stamina drains charge when sprinting', () => {
  const dt = 1; // 1 second
  const initial = { charge: 1 };
  const result = stepStamina(initial, true, dt);
  const expectedDrain = dt / STAMINA_DRAIN_TIME;
  assert.equal(result.charge, 1 - expectedDrain);
});

test('stamina clamps charge at 0 during over-drain', () => {
  const initial = { charge: 1 };
  const result = stepStamina(initial, true, STAMINA_DRAIN_TIME * 2);
  assert.equal(result.charge, 0);
});

test('stamina regenerates charge when not sprinting', () => {
  const dt = 1; // 1 second
  const initial = { charge: 0 };
  const result = stepStamina(initial, false, dt);
  const expectedRegen = (dt / STAMINA_DRAIN_TIME) * STAMINA_REGEN_MUL;
  assert.equal(result.charge, expectedRegen);
});

test('stamina clamps charge at 1 during over-regen', () => {
  const initial = { charge: 0 };
  const result = stepStamina(initial, false, STAMINA_DRAIN_TIME / STAMINA_REGEN_MUL * 2);
  assert.equal(result.charge, 1);
});

test('sprintSpeedMul returns STAMINA_SPRINT_MUL at full charge', () => {
  assert.equal(sprintSpeedMul(1), STAMINA_SPRINT_MUL);
});

test('sprintSpeedMul returns 1 at zero charge', () => {
  assert.equal(sprintSpeedMul(0), 1);
});

test('sprintSpeedMul is linear midpoint at 0.5 charge', () => {
  const result = sprintSpeedMul(0.5);
  const expected = 1 + (STAMINA_SPRINT_MUL - 1) * 0.5;
  assert.equal(result, expected);
});
