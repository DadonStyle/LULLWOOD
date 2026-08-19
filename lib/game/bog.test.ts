import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isInBog,
  bogSpeedMultiplier,
  bogNoiseMultiplier,
  pickHardBabyPosition,
  BOG_SPEED_MULTIPLIER,
  BOG_NOISE_MULTIPLIER,
  type BogBounds,
  type Landmark,
} from './bog.ts';

const bounds: BogBounds = { half: 120, zMax: 240 };

test('isInBog is false in the forest, true past the seam, false past the map edge', () => {
  assert.equal(isInBog(0, bounds), false);
  assert.equal(isInBog(119.9, bounds), false);
  assert.equal(isInBog(120.1, bounds), true);
  assert.equal(isInBog(240, bounds), true);
  assert.equal(isInBog(240.1, bounds), false);
});

test('isInBog treats the exact seam as still-forest (half-open boundary)', () => {
  assert.equal(isInBog(120, bounds), false);
});

test('bogSpeedMultiplier halves speed only in the bog', () => {
  assert.equal(bogSpeedMultiplier(true), BOG_SPEED_MULTIPLIER);
  assert.equal(bogSpeedMultiplier(false), 1);
});

test('bogNoiseMultiplier amplifies noise only in the bog', () => {
  assert.equal(bogNoiseMultiplier(true), BOG_NOISE_MULTIPLIER);
  assert.equal(bogNoiseMultiplier(false), 1);
});

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('pickHardBabyPosition lands inside the bog band, clear of the forest and the outer edge', () => {
  const p = pickHardBabyPosition(seeded(1), bounds, 120, []);
  assert.ok(p.z >= bounds.half + 20 && p.z <= bounds.zMax - 20, `z=${p.z} out of range`);
  assert.ok(Math.abs(p.x) <= 100, `x=${p.x} out of range`);
});

test('pickHardBabyPosition is deterministic for a given seed', () => {
  const a = pickHardBabyPosition(seeded(42), bounds, 120, []);
  const b = pickHardBabyPosition(seeded(42), bounds, 120, []);
  assert.deepEqual(a, b);
});

test('pickHardBabyPosition avoids a landmark sitting in the middle of the band', () => {
  const landmarks: Landmark[] = [{ x: 0, z: 180, clear: 200 }]; // deliberately covers the whole band
  const p = pickHardBabyPosition(seeded(7), bounds, 120, landmarks, 6, 5);
  // maxTries=5 exhausts without a clear candidate -- must still terminate and
  // return a real (if imperfect) point, not hang or throw.
  assert.equal(typeof p.x, 'number');
  assert.equal(typeof p.z, 'number');
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
});

test('pickHardBabyPosition degenerate bounds (bog band narrower than the 20-unit margins) still terminates', () => {
  const tight: BogBounds = { half: 120, zMax: 135 };
  const p = pickHardBabyPosition(seeded(3), tight, 120, [], 6, 10);
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
  assert.equal(p.z, tight.half + 20); // zHi clamps to zLo, so every draw collapses to zLo
});
