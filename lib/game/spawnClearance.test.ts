import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnClearanceScale, FULL_MAP_HALF, findClearSpot, CLEAR_SPOT_STEP } from './spawnClearance.ts';

test('spawnClearanceScale(240) is exactly 1 (full map)', () => {
  assert.equal(spawnClearanceScale(240), 1);
  assert.equal(spawnClearanceScale(FULL_MAP_HALF), 1);
});

test('spawnClearanceScale(480) still clamps to exactly 1 (larger than full map)', () => {
  assert.equal(spawnClearanceScale(480), 1);
});

test('spawnClearanceScale(48) is exactly 0.2 (qaWorld=micro, same ratio as applyQaWorldMicroPreset())', () => {
  assert.equal(spawnClearanceScale(48), 0.2);
});

test('spawnClearanceScale(120) is exactly 0.5 (intermediate half, proves linearity)', () => {
  assert.equal(spawnClearanceScale(120), 0.5);
});

test('full-map identity: scaled clearance constants are byte-identical to the pre-LUL-2725 constants (LUL-791/LUL-794 P1)', () => {
  const scale = spawnClearanceScale(240);
  assert.equal(2500 * scale * scale, 2500);
  assert.equal(34 * scale, 34);
});

test('findClearSpot returns the original spot when it is already free', () => {
  assert.deepEqual(findClearSpot(3, 4, () => true), { x: 3, z: 4 });
});

test('findClearSpot steps out of a blocking circle to the nearest free ring', () => {
  // a rock of radius 5 centred on the predator
  const spot = findClearSpot(0, 0, (x, z) => Math.hypot(x, z) > 5)!;
  assert.ok(spot);
  const d = Math.hypot(spot.x, spot.z);
  assert.ok(d > 5 && d <= 5 + CLEAR_SPOT_STEP, `landed ${d}u out`);
});

test('findClearSpot is deterministic for the same input', () => {
  const isFree = (x: number) => x > 7;
  assert.deepEqual(findClearSpot(0, 0, isFree), findClearSpot(0, 0, isFree));
});

test('findClearSpot returns null when nothing within range is free', () => {
  assert.equal(findClearSpot(0, 0, () => false), null);
});
