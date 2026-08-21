import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isNoiseHeard,
  NOISE_RADIUS_WALK,
  NOISE_RADIUS_RUN,
  HEAR_CHANCE_PER_SEC,
} from './noise.ts';

// ---- constants (pin the current tuning) ------------------------------------

test('noise radius constants: run carries further than walk', () => {
  assert.ok(NOISE_RADIUS_RUN > NOISE_RADIUS_WALK);
  assert.equal(NOISE_RADIUS_WALK, 14);
  assert.equal(NOISE_RADIUS_RUN, 24);
});

// ---- isNoiseHeard: range gate ------------------------------------------------

test('isNoiseHeard is always false at/beyond the radius, regardless of the roll', () => {
  assert.equal(isNoiseHeard(NOISE_RADIUS_WALK, NOISE_RADIUS_WALK, 1, () => 0), false);
  assert.equal(isNoiseHeard(NOISE_RADIUS_WALK + 0.01, NOISE_RADIUS_WALK, 1, () => 0), false);
});

test('isNoiseHeard treats noiseRadius <= 0 as always a miss', () => {
  assert.equal(isNoiseHeard(0, 0, 1, () => 0), false);
  assert.equal(isNoiseHeard(-5, -1, 1, () => 0), false);
});

test('isNoiseHeard at dist=0 inside a positive radius still rolls normally', () => {
  assert.equal(isNoiseHeard(0, NOISE_RADIUS_WALK, 1, () => 0), true);
});

// ---- isNoiseHeard: dt-scaled roll -------------------------------------------

test('isNoiseHeard is a plain dt-scaled roll: rand() below the threshold hears, at/above does not', () => {
  const dist = NOISE_RADIUS_WALK / 2;
  assert.equal(isNoiseHeard(dist, NOISE_RADIUS_WALK, 1 / 60, () => 0), true);
  assert.equal(
    isNoiseHeard(dist, NOISE_RADIUS_WALK, 1 / 60, () => HEAR_CHANCE_PER_SEC * (1 / 60)),
    false,
  );
});

test('isNoiseHeard with dt=0 never hears, even well inside range', () => {
  assert.equal(isNoiseHeard(0, NOISE_RADIUS_WALK, 0, () => 0), false);
});

test('isNoiseHeard scales the hit chance linearly with dt', () => {
  const dist = NOISE_RADIUS_WALK / 2;
  // just under the threshold at dt=1s (HEAR_CHANCE_PER_SEC) hits
  assert.equal(isNoiseHeard(dist, NOISE_RADIUS_WALK, 1, () => HEAR_CHANCE_PER_SEC - 0.001), true);
  // the same roll at a tenth the dt is now well above the (tenth-sized) threshold
  assert.equal(isNoiseHeard(dist, NOISE_RADIUS_WALK, 0.1, () => HEAR_CHANCE_PER_SEC - 0.001), false);
});

test('isNoiseHeard defaults rand to Math.random (no crash, boolean result)', () => {
  const result = isNoiseHeard(1, NOISE_RADIUS_WALK, 1 / 60);
  assert.equal(typeof result, 'boolean');
});
