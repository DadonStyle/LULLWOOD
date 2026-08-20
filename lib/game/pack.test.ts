import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectPackLeaderIndex,
  flankTarget,
  FLANK_ANGLE,
  FLANK_DIST_MUL,
  type Point,
} from './pack.ts';

// ---- selectPackLeaderIndex --------------------------------------------------

test('selectPackLeaderIndex returns -1 for an empty pack', () => {
  assert.equal(selectPackLeaderIndex([], 0, 0), -1);
});

test('selectPackLeaderIndex returns the only chaser for a single-element list', () => {
  const chasers: Point[] = [{ x: 5, z: 0 }];
  assert.equal(selectPackLeaderIndex(chasers, 0, 0), 0);
});

test('selectPackLeaderIndex picks whichever chaser is actually closest to the player', () => {
  const chasers: Point[] = [
    { x: 20, z: 0 }, // far
    { x: 3, z: 0 }, // closest
    { x: 10, z: 0 }, // mid
  ];
  assert.equal(selectPackLeaderIndex(chasers, 0, 0), 1);
});

test('selectPackLeaderIndex breaks a distance tie in favor of the first entry', () => {
  const chasers: Point[] = [
    { x: 5, z: 0 },
    { x: -5, z: 0 }, // same distance from origin
  ];
  assert.equal(selectPackLeaderIndex(chasers, 0, 0), 0);
});

test('selectPackLeaderIndex works with the player not at the origin', () => {
  const chasers: Point[] = [
    { x: 100, z: 100 },
    { x: 12, z: 8 },
  ];
  assert.equal(selectPackLeaderIndex(chasers, 10, 10), 1);
});

// ---- flankTarget -------------------------------------------------------------

const BOUNDS = { half: 100, zMax: 100 };

test('flankTarget with an eastward escape heading rotates +60deg for side=1', () => {
  // escaping along +x, wolf sitting 10 units east of the player
  const [fx, fz] = flankTarget(0, 0, 1, 0, 1, 10, 0, BOUNDS);
  const dist = 10 * FLANK_DIST_MUL;
  assert.ok(Math.abs(fx - Math.cos(FLANK_ANGLE) * dist) < 1e-9);
  assert.ok(Math.abs(fz - Math.sin(FLANK_ANGLE) * dist) < 1e-9);
});

test('flankTarget with side=-1 rotates the opposite way (mirrors side=1 in z)', () => {
  const [, fzPos] = flankTarget(0, 0, 1, 0, 1, 10, 0, BOUNDS);
  const [, fzNeg] = flankTarget(0, 0, 1, 0, -1, 10, 0, BOUNDS);
  assert.ok(Math.abs(fzPos + fzNeg) < 1e-9); // mirrored across the heading
});

test('flankTarget scales with the flanker\'s own distance from the player, not the leader\'s', () => {
  const [nearX] = flankTarget(0, 0, 1, 0, 1, 5, 0, BOUNDS);
  const [farX] = flankTarget(0, 0, 1, 0, 1, 20, 0, BOUNDS);
  assert.ok(farX > nearX);
});

test('flankTarget clamps into the map bounds with the same 4-unit margin as backOffPoint', () => {
  // player near the edge, escape heading pointing straight out of bounds
  const [fx, fz] = flankTarget(95, 95, 1, 1, 1, 200, 200, { half: 100, zMax: 100 });
  assert.ok(fx <= 100 - 4);
  assert.ok(fz <= 100 - 4);
});

test('flankTarget clamps the z axis to the asymmetric zMax bound (bog band), not half', () => {
  const bounds = { half: 100, zMax: 400 }; // rectangular map, LUL-25 bog band
  const [, fz] = flankTarget(0, 380, 0, 1, 1, 0, 500, bounds);
  assert.ok(fz <= 400 - 4);
  assert.ok(fz > 100 - 4); // proves zMax, not half, governs the upper clamp
});

test('flankTarget at zero distance from the player returns the player position, unclamped case', () => {
  const [fx, fz] = flankTarget(0, 0, 1, 0, 1, 0, 0, BOUNDS);
  assert.equal(fx, 0);
  assert.equal(fz, 0);
});
