import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startSightLock,
  stepSightLock,
  SIGHT_TELL_TIME,
} from './sightLock.ts';
import { CHARGE_TELL_TIME } from './charge.ts';

test('startSightLock begins spotting at t=0', () => {
  assert.deepEqual(startSightLock(), { phase: 'spotting', t: 0 });
});

test('stepSightLock stays spotting before SIGHT_TELL_TIME elapses, while still visible', () => {
  const s = stepSightLock(startSightLock(), SIGHT_TELL_TIME - 0.01, true);
  assert.equal(s.phase, 'spotting');
});

test('stepSightLock resolves to locked exactly at SIGHT_TELL_TIME (boundary inclusive), while still visible', () => {
  const s = stepSightLock(startSightLock(), SIGHT_TELL_TIME, true);
  assert.equal(s.phase, 'locked');
});

test('stepSightLock cancels the instant visibility is lost, regardless of elapsed time', () => {
  const early = stepSightLock(startSightLock(), 0.01, false);
  assert.equal(early.phase, 'cancelled');

  const late = stepSightLock({ phase: 'spotting', t: SIGHT_TELL_TIME - 0.001 }, 0.0005, false);
  assert.equal(late.phase, 'cancelled');
});

test('stepSightLock is a no-op on terminal states', () => {
  const locked = { phase: 'locked' as const, t: 0 };
  assert.deepEqual(stepSightLock(locked, 5, true), locked);

  const cancelled = { phase: 'cancelled' as const, t: 0 };
  assert.deepEqual(stepSightLock(cancelled, 5, false), cancelled);
});

test('SIGHT_TELL_TIME matches CHARGE_TELL_TIME\'s value', () => {
  assert.equal(SIGHT_TELL_TIME, CHARGE_TELL_TIME);
});
