import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inLakeWater,
  inLakeClearance,
  lakeSpeedMultiplier,
  pushOutOfLakeClearance,
  pushOutOfLakeClearanceAvoiding,
  keepWaypointOffLake,
  LAKE_SPEED_MULTIPLIER,
  type LakeConfig,
} from './lake.ts';

const lake: LakeConfig = { x: 34, z: -28, r: 15, clear: 22 };

test('inLakeWater is true inside the visible water radius, false at and past its edge', () => {
  assert.equal(inLakeWater(lake.x, lake.z, lake), true);
  assert.equal(inLakeWater(lake.x + 14.9, lake.z, lake), true);
  assert.equal(inLakeWater(lake.x + 15, lake.z, lake), false);
  assert.equal(inLakeWater(lake.x + 20, lake.z, lake), false);
});

test('inLakeClearance is wider than inLakeWater -- a point can be in the clearance ring but not the water', () => {
  const x = lake.x + 18, z = lake.z; // between r=15 and clear=22
  assert.equal(inLakeWater(x, z, lake), false);
  assert.equal(inLakeClearance(x, z, lake), true);
});

test('lakeSpeedMultiplier halves speed only in the water', () => {
  assert.equal(lakeSpeedMultiplier(true), LAKE_SPEED_MULTIPLIER);
  assert.equal(lakeSpeedMultiplier(false), 1);
});

test('pushOutOfLakeClearance moves a candidate inside the lake to just past the clearance ring, same bearing', () => {
  const candidate = { x: lake.x + 5, z: lake.z }; // dead center-ish, well inside clear=22
  const pushed = pushOutOfLakeClearance(candidate.x, candidate.z, lake);
  assert.equal(inLakeClearance(pushed.x, pushed.z, lake), false);
  const dist = Math.hypot(pushed.x - lake.x, pushed.z - lake.z);
  assert.ok(Math.abs(dist - (lake.clear + 0.5)) < 1e-9, `dist=${dist}`);
  // same direction as the original candidate (+x from center)
  assert.ok(pushed.x > lake.x);
  assert.ok(Math.abs(pushed.z - lake.z) < 1e-9);
});

test('pushOutOfLakeClearance is deterministic and a no-op-direction on the exact center (distance 0)', () => {
  const pushed = pushOutOfLakeClearance(lake.x, lake.z, lake);
  assert.equal(inLakeClearance(pushed.x, pushed.z, lake), false);
  assert.ok(Math.abs(Math.hypot(pushed.x - lake.x, pushed.z - lake.z) - (lake.clear + 0.5)) < 1e-9);
});

test('pushOutOfLakeClearance leaves an already-clear point untouched in direction (still terminates, no loop)', () => {
  const outside = { x: lake.x + 30, z: lake.z };
  const pushed = pushOutOfLakeClearance(outside.x, outside.z, lake);
  // function is unconditional (no early return needed -- see comment in lake.ts):
  // still lands outside clearance, still deterministic, still O(1).
  assert.equal(inLakeClearance(pushed.x, pushed.z, lake), false);
});

// ---- the actual regression this ticket exists for: spawn rejection --------
// Mirrors placePredators()'s do-while shape (engine/forest-engine.js): reject
// while a candidate is inLakeClearance(), bounded retries, deterministic
// fallback on exhaustion. Before this ticket `placePredators()`'s reject
// predicate never called inLake() at all (LUL-395: it checked spawn-clearing,
// baby-distance and `blockedR()`, but not the lake) -- a candidate this test
// engineers to always land in the water would have been accepted as-is on
// try 1, and this assertion would fail. It passes only because
// `inLakeClearance` is now in the loop's own reject condition.
test('a spawn draw that always lands in the lake exhausts its retry budget, and the fallback lands outside the lake, deterministically', () => {
  const alwaysInLake = () => ({ x: lake.x + 1, z: lake.z + 1 });

  let x = 0, z = 0, tries = 0;
  const maxTries = 60;
  do {
    ({ x, z } = alwaysInLake());
    tries++;
  } while (inLakeClearance(x, z, lake) && tries < maxTries);

  assert.equal(tries, maxTries, 'retry budget must be bounded, not infinite');
  assert.equal(inLakeClearance(x, z, lake), true, 'candidate is still in the lake after exhausting retries');

  const fallback = pushOutOfLakeClearance(x, z, lake);
  assert.equal(inLakeClearance(fallback.x, fallback.z, lake), false, 'fallback must not silently place in the lake');
  assert.deepEqual(fallback, pushOutOfLakeClearance(x, z, lake), 'fallback must be deterministic');
});

test('a spawn draw outside the lake is accepted on the first try, unaffected by the lake check', () => {
  const clearCandidate = { x: -100, z: -100 };
  assert.equal(inLakeClearance(clearCandidate.x, clearCandidate.z, lake), false);
});

// ---- LUL-2735: pushOutOfLakeClearanceAvoiding() -----------------------------

test('pushOutOfLakeClearanceAvoiding is a no-op when the plain push already clears the avoid list', () => {
  const candidate = { x: lake.x + 5, z: lake.z };
  const avoid = [{ x: lake.x - 100, z: lake.z - 100, r: 5 }]; // far away, no conflict
  const plain = pushOutOfLakeClearance(candidate.x, candidate.z, lake);
  const avoiding = pushOutOfLakeClearanceAvoiding(candidate.x, candidate.z, lake, avoid);
  assert.deepEqual(avoiding, plain);
});

test('pushOutOfLakeClearanceAvoiding searches the clearance ring for an angle that also clears a conflicting avoid circle', () => {
  const candidate = { x: lake.x + 5, z: lake.z };
  const plain = pushOutOfLakeClearance(candidate.x, candidate.z, lake);
  // avoid circle centered exactly on the plain push's landing spot, forcing a conflict
  const avoid = [{ x: plain.x, z: plain.z, r: 3 }];
  const pushed = pushOutOfLakeClearanceAvoiding(candidate.x, candidate.z, lake, avoid);
  const dist = Math.hypot(pushed.x - lake.x, pushed.z - lake.z);
  assert.ok(Math.abs(dist - (lake.clear + 0.5)) < 1e-9, `dist=${dist}, must stay on the same ring`);
  const clearsAvoid = Math.hypot(pushed.x - avoid[0].x, pushed.z - avoid[0].z) >= avoid[0].r;
  assert.ok(clearsAvoid, 'result must clear the avoid circle');
});

test('pushOutOfLakeClearanceAvoiding falls back to the plain push when the entire ring is blocked', () => {
  const candidate = { x: lake.x + 5, z: lake.z };
  const plain = pushOutOfLakeClearance(candidate.x, candidate.z, lake);
  // avoid circle centered on the lake, radius covering the whole ring
  const avoid = [{ x: lake.x, z: lake.z, r: lake.clear + 0.5 + 1 }];
  const pushed = pushOutOfLakeClearanceAvoiding(candidate.x, candidate.z, lake, avoid);
  assert.deepEqual(pushed, plain, 'every angle fails -- must fall back to the plain push result unchanged');
});

test('pushOutOfLakeClearanceAvoiding is deterministic', () => {
  const candidate = { x: lake.x + 5, z: lake.z };
  const plain = pushOutOfLakeClearance(candidate.x, candidate.z, lake);
  const avoid = [{ x: plain.x, z: plain.z, r: 3 }];
  const a = pushOutOfLakeClearanceAvoiding(candidate.x, candidate.z, lake, avoid);
  const b = pushOutOfLakeClearanceAvoiding(candidate.x, candidate.z, lake, avoid);
  assert.deepEqual(a, b);
});

// ---- LUL-873: keepWaypointOffLake(), extracted from engine/forest-engine.js -----

test('keepWaypointOffLake pushes a candidate inside the water to just past the water edge (r, not clear)', () => {
  const candidate = { x: lake.x + 5, z: lake.z }; // inside r=15
  const kept = keepWaypointOffLake(candidate.x, candidate.z, lake);
  assert.equal(inLakeWater(kept.x, kept.z, lake), false);
  const dist = Math.hypot(kept.x - lake.x, kept.z - lake.z);
  assert.ok(Math.abs(dist - (lake.r + 2)) < 1e-9, `dist=${dist}`);
  // same bearing as the original candidate (+x from center)
  assert.ok(kept.x > lake.x);
  assert.ok(Math.abs(kept.z - lake.z) < 1e-9);
});

test('keepWaypointOffLake is a no-op for a candidate already outside the water, even inside the wider clearance ring', () => {
  const candidate = { x: lake.x + 18, z: lake.z }; // between r=15 and clear=22
  assert.equal(inLakeWater(candidate.x, candidate.z, lake), false);
  const kept = keepWaypointOffLake(candidate.x, candidate.z, lake);
  assert.deepEqual(kept, candidate);
});
