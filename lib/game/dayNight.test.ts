import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeOfRunDetectMul, TIME_OF_RUN_DETECT_MUL } from './dayNight.ts';

test('timeOfRunDetectMul is 1 (no change) at timeOfRun=0', () => {
  assert.equal(timeOfRunDetectMul(0), 1);
});

test('timeOfRunDetectMul is TIME_OF_RUN_DETECT_MUL at timeOfRun=1 (full night)', () => {
  assert.ok(Math.abs(timeOfRunDetectMul(1) - TIME_OF_RUN_DETECT_MUL) < 1e-9);
});

test('timeOfRunDetectMul is exactly the +30% spec value at timeOfRun=1', () => {
  assert.ok(Math.abs(timeOfRunDetectMul(1) - 1.3) < 1e-9);
});

test('timeOfRunDetectMul interpolates linearly between the two', () => {
  const half = timeOfRunDetectMul(0.5);
  assert.ok(Math.abs(half - (1 + 0.5 * (TIME_OF_RUN_DETECT_MUL - 1))) < 1e-9);
});

test('timeOfRunDetectMul is monotonically increasing between 0 and 1', () => {
  assert.ok(timeOfRunDetectMul(0.25) < timeOfRunDetectMul(0.5));
  assert.ok(timeOfRunDetectMul(0.5) < timeOfRunDetectMul(0.75));
  assert.ok(timeOfRunDetectMul(0) < timeOfRunDetectMul(1));
});
