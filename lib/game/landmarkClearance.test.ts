import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findClearLandmarkSpot, isSpotClear, type ClearanceObstacle } from './landmarkClearance.ts';

test('returns the nominal spot unchanged when clear', () => {
  const [x, z] = findClearLandmarkSpot(-95, 46, 11, []);
  assert.equal(x, -95);
  assert.equal(z, 46);
});

test('finds a clear spot past a single blocking obstacle', () => {
  const clear = 2;
  const obstacles: ClearanceObstacle[] = [{ x: 0, z: 0, radius: 5 }];
  const [x, z] = findClearLandmarkSpot(0, 0, clear, obstacles);
  assert.ok(!(x === 0 && z === 0), 'must move off the blocked nominal spot');
  assert.ok(isSpotClear(x, z, clear, obstacles), 'returned spot must actually be clear');
});

test('forces the old 8-try budget to exhaust and proves the spiral still returns a clear spot', () => {
  // The old inline loop took 8 steps of length 3 from (0,0), so every
  // candidate it could ever reach sits within radius 8*3=24 of the nominal
  // point (triangle inequality on 8 unit-3 steps). A single obstacle disk of
  // radius > 24 centered on the nominal point blocks every point the old
  // loop could have tried, in any fixed-angle pattern, without replaying it.
  const clear = 0;
  const obstacles: ClearanceObstacle[] = [{ x: 0, z: 0, radius: 25 }];
  const [x, z] = findClearLandmarkSpot(0, 0, clear, obstacles);
  assert.ok(Math.hypot(x, z) > 24, 'must have searched past the old loop\'s reachable radius');
  assert.ok(isSpotClear(x, z, clear, obstacles), 'returned spot must actually be clear');
});

test('returns the nominal spot if every ring up to SPIRAL_MAX_RADIUS is blocked', () => {
  // SPIRAL_MAX_RADIUS is 60 and rings step by 3, so a disk obstacle with
  // radius 61 covers every ring the search will ever sample.
  const clear = 0;
  const obstacles: ClearanceObstacle[] = [{ x: 0, z: 0, radius: 61 }];
  const [x, z] = findClearLandmarkSpot(0, 0, clear, obstacles);
  assert.equal(x, 0);
  assert.equal(z, 0);
});
