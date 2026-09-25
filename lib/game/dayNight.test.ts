import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  timeOfRunDetectMul, TIME_OF_RUN_DETECT_MUL,
  duskLionDetectMul, DUSK_LION_SIGHT_START_S, DUSK_LION_SIGHT_END_S, DUSK_LION_SIGHT_MUL,
} from './dayNight.ts';

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

test('duskLionDetectMul is 1 (no change) at and below DUSK_LION_SIGHT_START_S', () => {
  assert.equal(duskLionDetectMul(0), 1);
  assert.equal(duskLionDetectMul(DUSK_LION_SIGHT_START_S), 1);
});

test('duskLionDetectMul is DUSK_LION_SIGHT_MUL at and beyond DUSK_LION_SIGHT_END_S', () => {
  assert.equal(duskLionDetectMul(DUSK_LION_SIGHT_END_S), DUSK_LION_SIGHT_MUL);
  assert.equal(duskLionDetectMul(DUSK_LION_SIGHT_END_S + 100), DUSK_LION_SIGHT_MUL);
});

test('duskLionDetectMul interpolates linearly between the two, floor 0.5', () => {
  const mid = (DUSK_LION_SIGHT_START_S + DUSK_LION_SIGHT_END_S) / 2;
  assert.ok(Math.abs(duskLionDetectMul(mid) - 0.75) < 1e-9);
});

test('duskLionDetectMul is monotonically decreasing between start and end', () => {
  assert.ok(duskLionDetectMul(100) < duskLionDetectMul(90));
  assert.ok(duskLionDetectMul(120) < duskLionDetectMul(100));
  assert.ok(duskLionDetectMul(150) < duskLionDetectMul(120));
});
