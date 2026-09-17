import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickCommittedAvoidDirection,
  findLocalPath,
  AVOID_COMMIT_TIME,
  LOCAL_SEARCH_STEP,
  LOCAL_SEARCH_ARRIVE_R,
} from './steer.ts';
import { CELL, gridKey } from './cover.ts';
import type { SpatialGrid, CircleCollider, CoverAABB } from './cover.ts';

function makeGrid<T extends { x: number; z: number }>(entries: T[]): SpatialGrid<T> {
  const grid: SpatialGrid<T> = new Map();
  for (const e of entries) {
    const k = gridKey(Math.floor(e.x / CELL), Math.floor(e.z / CELL));
    const arr = grid.get(k);
    if (arr) arr.push(e); else grid.set(k, [e]);
  }
  return grid;
}

const emptyGrid = makeGrid<CircleCollider>([]);
const emptyCoverGrid = makeGrid<CoverAABB>([]);

// ---- pickCommittedAvoidDirection --------------------------------------------

test('pickCommittedAvoidDirection steers direct when the path ahead is clear', () => {
  const r = pickCommittedAvoidDirection(null, 0, 1 / 30, 0, 0, 0.6, 0, 1, emptyGrid, emptyCoverGrid);
  assert.deepEqual(r.dir, [0, 1]);
  assert.equal(r.commitDir, null);
  assert.equal(r.commitT, 0);
});

test('pickCommittedAvoidDirection picks an avoid side and starts a commit window when blocked', () => {
  const trees = makeGrid<CircleCollider>([{ x: 0, z: 2, cr: 0.8 }]);
  const r = pickCommittedAvoidDirection(null, 0, 1 / 30, 0, 0, 0.6, 0, 1, trees, emptyCoverGrid);
  assert.notEqual(r.commitDir, null);
  assert.equal(r.commitT, AVOID_COMMIT_TIME);
  assert.deepEqual(r.dir, r.commitDir);
});

test('pickCommittedAvoidDirection holds the committed direction until the timer decays, ignoring a different live pick', () => {
  const trees = makeGrid<CircleCollider>([{ x: 0, z: 2, cr: 0.8 }]);
  const held: [number, number] = [1, 0];
  // Even with a full dt of remaining budget, a live commitT > 0 returns the
  // held direction unchanged rather than re-querying pickAvoidDirection().
  const r = pickCommittedAvoidDirection(held, 0.5, 0.2, 0, 0, 0.6, 0, 1, trees, emptyCoverGrid);
  assert.deepEqual(r.dir, held);
  assert.equal(r.commitDir, held);
  assert.ok(r.commitT > 0 && r.commitT < 0.5);
});

test('pickCommittedAvoidDirection releases the commitment once the timer hits 0 and the path is clear', () => {
  const r = pickCommittedAvoidDirection([1, 0], 0.05, 0.1, 0, 0, 0.6, 0, 1, emptyGrid, emptyCoverGrid);
  assert.deepEqual(r.dir, [0, 1]);
  assert.equal(r.commitDir, null);
  assert.equal(r.commitT, 0);
});

test('pickCommittedAvoidDirection re-commits to a fresh side once the timer hits 0 and the path is still blocked', () => {
  const trees = makeGrid<CircleCollider>([{ x: 0, z: 2, cr: 0.8 }]);
  const r = pickCommittedAvoidDirection([1, 0], 0.05, 0.1, 0, 0, 0.6, 0, 1, trees, emptyCoverGrid);
  assert.notEqual(r.commitDir, null);
  assert.equal(r.commitT, AVOID_COMMIT_TIME);
});

// ---- findLocalPath -----------------------------------------------------------

test('findLocalPath returns null when the start node is itself blocked', () => {
  const trees = makeGrid<CircleCollider>([{ x: 0, z: 0, cr: 5 }]);
  const path = findLocalPath(0, 0, 20, 0, 0.6, trees, emptyCoverGrid);
  assert.equal(path, null);
});

test('findLocalPath finds a direct route with no obstacles', () => {
  const path = findLocalPath(0, 0, 10, 0, 0.6, emptyGrid, emptyCoverGrid);
  assert.notEqual(path, null);
  assert.ok(path!.waypoints.length > 0 && path!.waypoints.length <= 3);
  // Nearest-first: the last returned waypoint should be closer to the target
  // than the first (or equal, for a 1-node result).
  const [fx, fz] = path!.waypoints[0];
  const [lx, lz] = path!.waypoints[path!.waypoints.length - 1];
  const distF = Math.hypot(10 - fx, 0 - fz);
  const distL = Math.hypot(10 - lx, 0 - lz);
  assert.ok(distL <= distF);
});

test('findLocalPath routes around a single obstacle placed directly on the line to target', () => {
  const trees = makeGrid<CircleCollider>([{ x: 6, z: 0, cr: 3 }]);
  const path = findLocalPath(0, 0, 12, 0, 0.6, trees, emptyCoverGrid);
  assert.notEqual(path, null);
  for (const [wx, wz] of path!.waypoints) {
    assert.ok(Math.hypot(wx - 6, wz - 0) > 3 + 0.6, 'every waypoint must clear the obstacle');
  }
});

test('findLocalPath returns null when no reachable node gets within budget of an unreachable target', () => {
  // A dense ring of obstacles well within LOCAL_SEARCH_RADIUS surrounding the
  // target keeps every approach blocked, so the bounded search exhausts its
  // budget without ever reaching within one LOCAL_SEARCH_STEP of the target.
  const ring: CircleCollider[] = [];
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    ring.push({ x: 20 + Math.cos(ang) * 3, z: Math.sin(ang) * 3, cr: 1.2 });
  }
  const trees = makeGrid<CircleCollider>(ring);
  const path = findLocalPath(0, 0, 20, 0, 0.6, trees, emptyCoverGrid);
  assert.equal(path, null);
});

test('LOCAL_SEARCH_STEP and LOCAL_SEARCH_ARRIVE_R keep the sensible relationship: arrive radius covers a diagonal step', () => {
  assert.ok(LOCAL_SEARCH_ARRIVE_R > LOCAL_SEARCH_STEP / 2);
});
