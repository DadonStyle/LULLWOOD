import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  biomeAt,
  bogSpeedMultiplier,
  bogNoiseMultiplier,
  pickHardBabyPosition,
  BOG_SPEED_MULTIPLIER,
  BOG_NOISE_MULTIPLIER,
  BLACKOUT_MIN_RADIUS,
  type Landmark,
} from './bog.ts';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('biomeAt is deterministic for a given point', () => {
  assert.equal(biomeAt(30, 2), biomeAt(30, 2));
});

test('biomeAt stays within [0, 1] across the whole map square', () => {
  for (let x = -120; x <= 120; x += 5) {
    for (let z = -120; z <= 120; z += 5) {
      const b = biomeAt(x, z);
      assert.ok(b >= 0 && b <= 1, `biomeAt(${x},${z})=${b} out of range`);
    }
  }
});

test('biomeAt finds both boggy and dry ground within the map square', () => {
  let sawBoggy = false, sawDry = false;
  for (let x = -120; x <= 120; x += 5) {
    for (let z = -120; z <= 120; z += 5) {
      const b = biomeAt(x, z);
      if (b > 0.5) sawBoggy = true;
      if (b === 0) sawDry = true;
    }
  }
  assert.ok(sawBoggy, 'expected at least one strongly boggy sample point');
  assert.ok(sawDry, 'expected at least one dry sample point');
});

test('home/spawn is kept dry regardless of the noise field', () => {
  assert.equal(biomeAt(0, 0), 0);
  assert.equal(biomeAt(6.3, 0), 0); // inSpawn()'s own radius, engine/forest-engine.js (re-grep `inSpawn` for current line)
});

test('the relocated oak and drownedCar landmarks sit in a bog patch', () => {
  assert.ok(biomeAt(22, 4) > 0.5, 'oak landmark should be well inside a bog patch');
  assert.ok(biomeAt(-95, 46) > 0.5, 'drownedCar landmark should be well inside a bog patch');
});

test('the lake and the other two landmarks are not accidentally boggy', () => {
  assert.equal(biomeAt(34, -28), 0); // CONFIG.lake
  assert.equal(biomeAt(-95, -95), 0); // fireTower
  assert.equal(biomeAt(100, -75), 0); // stoneMarker
});

test('bogSpeedMultiplier/bogNoiseMultiplier hit their old boolean endpoints exactly', () => {
  assert.equal(bogSpeedMultiplier(1), BOG_SPEED_MULTIPLIER);
  assert.equal(bogSpeedMultiplier(0), 1);
  assert.equal(bogNoiseMultiplier(1), BOG_NOISE_MULTIPLIER);
  assert.equal(bogNoiseMultiplier(0), 1);
});

test('bogSpeedMultiplier/bogNoiseMultiplier are linear in bogginess', () => {
  assert.equal(bogSpeedMultiplier(0.5), 1 - 0.5 * (1 - BOG_SPEED_MULTIPLIER));
  assert.equal(bogNoiseMultiplier(0.5), 1 + 0.5 * (BOG_NOISE_MULTIPLIER - 1));
});

test('pickHardBabyPosition lands in a bog patch, clear of the map edge', () => {
  const p = pickHardBabyPosition(seeded(1), 240, []);
  assert.ok(biomeAt(p.x, p.z) > 0, `(${p.x},${p.z}) should be boggy`);
  assert.ok(Math.abs(p.x) <= 220 && Math.abs(p.z) <= 220, `p=${JSON.stringify(p)} out of margin`);
  assert.ok(Math.hypot(p.x, p.z) >= BLACKOUT_MIN_RADIUS, 'must clear the blackout distance floor');
});

test('pickHardBabyPosition is deterministic for a given seed', () => {
  const a = pickHardBabyPosition(seeded(42), 240, []);
  const b = pickHardBabyPosition(seeded(42), 240, []);
  assert.deepEqual(a, b);
});

test('pickHardBabyPosition never lands closer than BLACKOUT_MIN_RADIUS', () => {
  for (const seed of [1, 2, 3, 42, 99]) {
    const p = pickHardBabyPosition(seeded(seed), 240, []);
    assert.ok(Math.hypot(p.x, p.z) >= BLACKOUT_MIN_RADIUS, `seed ${seed}: (${p.x},${p.z}) is inside the floor`);
  }
});

test('pickHardBabyPosition avoids a landmark covering its whole reachable area, still terminates', () => {
  const landmarks: Landmark[] = [{ x: 22, z: 4, clear: 300 }]; // deliberately covers the whole square
  const p = pickHardBabyPosition(seeded(7), 120, landmarks, 6, 20, 5);
  assert.equal(typeof p.x, 'number');
  assert.equal(typeof p.z, 'number');
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
});
