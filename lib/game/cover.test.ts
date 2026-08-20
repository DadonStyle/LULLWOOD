import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coverKindBlocksPlayerMovement,
  distanceToCoverEdge,
  overlapsTreeCanopy,
  overlapsTreeTrunk,
  CELL,
  gridKey,
  blockedR,
  coverBlockedR,
  canopyBlockedR,
  blocked,
  segRayVsAABB,
  hasLOS,
  findHideSpot,
  HIDE_KINDS,
  HIDE_RADIUS,
  effectiveDetect,
  canSee,
  canopyRadiusAtEye,
  rollCoverPropShape,
  STILL_RAMP,
  STILL_DETECT_CUT,
  DIM_DETECT_MUL,
  PLAYER_COLLISION_RADIUS,
} from './cover.ts';
import type { SpatialGrid, CircleCollider, CoverAABB, DetectionState } from './cover.ts';

// Builds a spatial grid the same way the engine's buildGrid()/buildCoverGrid()
// do: bucket every entry by floor(x/CELL),floor(z/CELL).
function makeGrid<T extends { x: number; z: number }>(entries: T[]): SpatialGrid<T> {
  const grid: SpatialGrid<T> = new Map();
  for (const e of entries) {
    const k = gridKey(Math.floor(e.x / CELL), Math.floor(e.z / CELL));
    const arr = grid.get(k);
    if (arr) arr.push(e); else grid.set(k, [e]);
  }
  return grid;
}

// ---- distanceToCoverEdge (LUL-405/LUL-430) ---------------------------------

test('distanceToCoverEdge is 0 for a point at the prop center', () => {
  assert.equal(distanceToCoverEdge(0, 0, 2.4, 0.35), 0);
});

test('distanceToCoverEdge is 0 anywhere inside the rect, including near a corner', () => {
  assert.equal(distanceToCoverEdge(2.3, 0.3, 2.4, 0.35), 0);
});

test('distanceToCoverEdge on the long axis matches the simple 1-D gap', () => {
  // hx=2.4 half-length; a point 3.4 units out on the long axis is 1.0 past the edge.
  assert.equal(distanceToCoverEdge(3.4, 0, 2.4, 0.35), 1.0);
});

test('distanceToCoverEdge on the thin axis matches the simple 1-D gap, not the old circle radius', () => {
  // The regression this whole fix is about: findHideSpot() used to treat the
  // thin side as if it were exactly as far away as the long side
  // (Math.max(hx,hz) = 2.4), so a point 4 units out on the *thin* axis
  // (hz=0.35) read as only 1.6 units from the "edge" -- inside HIDE_RADIUS
  // (2.2) -- even though the real object there is only 0.35 units thick.
  // The correct distance is 4 - 0.35 = 3.65, well outside HIDE_RADIUS.
  const d = distanceToCoverEdge(0, 4, 2.4, 0.35);
  assert.equal(d, 3.65);
  const HIDE_RADIUS = 2.2;
  assert.ok(d > HIDE_RADIUS, 'thin-side point 4 units out must not read as huggable');
  // What the old buggy formula produced, for contrast -- must NOT match the fix:
  const oldBuggyDistance = Math.hypot(0, 4) - Math.max(2.4, 0.35);
  assert.notEqual(d, oldBuggyDistance);
  assert.ok(oldBuggyDistance < HIDE_RADIUS, 'sanity: the old formula really did falsely allow this');
});

test('distanceToCoverEdge off a corner uses true 2-D (Pythagorean) distance, not either half-extent alone', () => {
  // 1 unit past the long-axis edge AND 1 unit past the thin-axis edge.
  const d = distanceToCoverEdge(3.4, 1.35, 2.4, 0.35);
  assert.equal(d, Math.hypot(1.0, 1.0));
});

test('distanceToCoverEdge is symmetric under sign flips (all four quadrants)', () => {
  const d = distanceToCoverEdge(-3.4, 0, 2.4, 0.35);
  assert.equal(d, 1.0);
});

test('distanceToCoverEdge combined with the rotation transform matches at ry = 0 and both non-axis-aligned signs', () => {
  // Same world->local rotation convention as coverBlockedR()/hasLOS()
  // (lx = dx*co - dz*si, lz = dx*si + dz*co), exercised the way findHideSpot()
  // now calls this function -- the LUL-91/LUL-268 bug class always showed up
  // exactly at a non-zero rotation, so this is the required edge case, not
  // an optional extra (per wiki systems/unit-testing-standard, LUL-425 scope).
  const hx = 2.4, hz = 0.35;
  const toLocal = (dx: number, dz: number, ry: number) => {
    const co = Math.cos(ry), si = Math.sin(ry);
    return [dx * co - dz * si, dx * si + dz * co] as const;
  };

  // ry = 0: world axes match local axes exactly.
  {
    const [lx, lz] = toLocal(0, 4, 0);
    assert.equal(distanceToCoverEdge(lx, lz, hx, hz), 3.65);
  }

  // ry = +PI/4: a world-space point straight along the log's own long axis
  // (post-rotation) must still read as "inside" (distance 0), even though it
  // is nowhere near axis-aligned in world space. toLocal(dx,dz,ry) is
  // R(ry)(dx,dz) (a genuine rotation, verified self-consistent: applying
  // R(-ry) undoes it), so the world point that maps to local (2,0) is
  // R(-ry)(2,0) = (2*cos(ry), -2*sin(ry)).
  {
    const ry = Math.PI / 4;
    const co = Math.cos(ry), si = Math.sin(ry);
    const worldDx = 2.0 * co, worldDz = -2.0 * si;
    const [lx, lz] = toLocal(worldDx, worldDz, ry);
    assert.ok(Math.abs(lx - 2.0) < 1e-9 && Math.abs(lz) < 1e-9, 'sanity: local coords recovered');
    assert.equal(distanceToCoverEdge(lx, lz, hx, hz), 0);
  }

  // ry = -PI/4: opposite sign, same contract -- catches the sin() sign flip
  // that LUL-91/LUL-268 actually shipped.
  {
    const ry = -Math.PI / 4;
    const co = Math.cos(ry), si = Math.sin(ry);
    const worldDx = 2.0 * co, worldDz = -2.0 * si;
    const [lx, lz] = toLocal(worldDx, worldDz, ry);
    assert.ok(Math.abs(lx - 2.0) < 1e-9 && Math.abs(lz) < 1e-9, 'sanity: local coords recovered');
    assert.equal(distanceToCoverEdge(lx, lz, hx, hz), 0);
  }
});

// ---- overlapsTreeTrunk (LUL-396) -------------------------------------------

test('overlapsTreeTrunk is false with no trees nearby', () => {
  assert.equal(overlapsTreeTrunk(0, 0, 1.5, []), false);
});

test('overlapsTreeTrunk is false when every tree is well clear', () => {
  const trees = [{ x: 20, z: 20, cr: 0.5 }, { x: -30, z: 5, cr: 0.8 }];
  assert.equal(overlapsTreeTrunk(0, 0, 1.5, trees), false);
});

test('overlapsTreeTrunk is true when a candidate\'s own footprint circle overlaps a trunk circle', () => {
  const trees = [{ x: 1.9, z: 0, cr: 0.5 }];
  // propRadius 1.5 + trunk cr 0.5 = 2.0 combined radius; centers are 1.9 apart -> inside.
  assert.equal(overlapsTreeTrunk(0, 0, 1.5, trees), true);
});

test('overlapsTreeTrunk is false exactly at the combined-radius boundary (strict less-than)', () => {
  const trees = [{ x: 2, z: 0, cr: 0.5 }];
  assert.equal(overlapsTreeTrunk(0, 0, 1.5, trees), false);
  // now push centers exactly to the combined radius (2.0) apart
  const exact = [{ x: 2.0, z: 0, cr: 0.5 }];
  assert.equal(overlapsTreeTrunk(0, 0, 1.5, exact), false);
});

test('overlapsTreeTrunk finds a match anywhere in a multi-tree list, not just the first entry', () => {
  const trees = [
    { x: 50, z: 50, cr: 0.4 },
    { x: -50, z: -50, cr: 0.4 },
    { x: 0.5, z: 0, cr: 0.3 },
  ];
  assert.equal(overlapsTreeTrunk(0, 0, 0.8, trees), true);
});

// ---- overlapsTreeCanopy (LUL-384/LUL-491) ----------------------------------

test('overlapsTreeCanopy is false with no trees nearby', () => {
  assert.equal(overlapsTreeCanopy(0, 0, 1.5, []), false);
});

test('overlapsTreeCanopy is false when every canopy is well clear', () => {
  const trees = [{ x: 20, z: 20, crCanopy: 1.5 }, { x: -30, z: 5, crCanopy: 2.0 }];
  assert.equal(overlapsTreeCanopy(0, 0, 1.5, trees), false);
});

test('overlapsTreeCanopy is true when a candidate\'s own footprint circle overlaps a canopy circle', () => {
  const trees = [{ x: 1.9, z: 0, crCanopy: 0.5 }];
  // propRadius 1.5 + canopy 0.5 = 2.0 combined radius; centers are 1.9 apart -> inside.
  assert.equal(overlapsTreeCanopy(0, 0, 1.5, trees), true);
});

test('overlapsTreeCanopy catches a canopy-only overlap that overlapsTreeTrunk would miss', () => {
  // This is the exact LUL-491 finding: a log's footprint can clear a tree's
  // trunk radius (t.cr) but still fall inside its much wider canopy radius
  // (t.crCanopy, ~3.3x the trunk per LUL-267) -- canopyBlockedR() blocks the
  // player there regardless of what cover prop, if any, sits on the ground.
  const tree = { x: 3, z: 0, cr: 0.5, crCanopy: 1.8 };
  const propRadius = 1.5;
  assert.equal(overlapsTreeTrunk(0, 0, propRadius, [tree]), false, 'sanity: trunk-only check misses this');
  assert.equal(overlapsTreeCanopy(0, 0, propRadius, [tree]), true, 'canopy check must catch it');
});

test('overlapsTreeCanopy is false exactly at the combined-radius boundary (strict less-than)', () => {
  const exact = [{ x: 2.0, z: 0, crCanopy: 0.5 }];
  assert.equal(overlapsTreeCanopy(0, 0, 1.5, exact), false);
});

test('overlapsTreeCanopy finds a match anywhere in a multi-tree list, not just the first entry', () => {
  const trees = [
    { x: 50, z: 50, crCanopy: 0.4 },
    { x: -50, z: -50, crCanopy: 0.4 },
    { x: 0.5, z: 0, crCanopy: 0.3 },
  ];
  assert.equal(overlapsTreeCanopy(0, 0, 0.8, trees), true);
});

// ---- coverKindBlocksPlayerMovement (LUL-384) -------------------------------

test('coverKindBlocksPlayerMovement is false for tree (own circle-grid collision handles it)', () => {
  assert.equal(coverKindBlocksPlayerMovement('tree'), false);
});

test('coverKindBlocksPlayerMovement is false for log -- walkable, run/jump over it naturally', () => {
  assert.equal(coverKindBlocksPlayerMovement('log'), false);
});

test('coverKindBlocksPlayerMovement is true for rock -- unchanged, still solid', () => {
  assert.equal(coverKindBlocksPlayerMovement('rock'), true);
});

test('coverKindBlocksPlayerMovement is true for bramble -- unchanged, still solid', () => {
  assert.equal(coverKindBlocksPlayerMovement('bramble'), true);
});

test('coverKindBlocksPlayerMovement is true for reed -- unchanged, still solid', () => {
  assert.equal(coverKindBlocksPlayerMovement('reed'), true);
});

// ============================================================================
// LUL-425 (wave 3 of LUL-277): cover/LOS geometry + hiding.

// ---- segRayVsAABB (slab test) -----------------------------------------------

test('segRayVsAABB: a segment that clearly crosses the box hits', () => {
  assert.equal(segRayVsAABB(-5, -5, 5, 5, 0, 0, 2, 2), true);
});

test('segRayVsAABB: a segment that clearly misses the box does not hit', () => {
  assert.equal(segRayVsAABB(-5, 10, 5, 10, 0, 0, 2, 2), false);
});

test('segRayVsAABB: degenerate dx (vertical ray) exactly on the box face hits (inclusive)', () => {
  // box is cx=0,cz=0,hx=2,hz=1 -> maxX=2. A vertical ray at x=2 (the face
  // itself) crossing the box's full z-range must count as a hit -- the
  // degenerate branch's `x0 > maxX` is strict, so touching the face is not
  // rejected.
  assert.equal(segRayVsAABB(2, -5, 2, 5, 0, 0, 2, 1), true);
});

test('segRayVsAABB: degenerate dx (vertical ray) just past the box face misses', () => {
  assert.equal(segRayVsAABB(2.0001, -5, 2.0001, 5, 0, 0, 2, 1), false);
});

test('segRayVsAABB: degenerate dz (horizontal ray) exactly on the box face hits (inclusive)', () => {
  assert.equal(segRayVsAABB(-5, 1, 5, 1, 0, 0, 2, 1), true);
});

test('segRayVsAABB: degenerate dz (horizontal ray) just past the box face misses', () => {
  assert.equal(segRayVsAABB(-5, 1.0001, 5, 1.0001, 0, 0, 2, 1), false);
});

test('segRayVsAABB: zero-length segment inside the box hits (both dx and dz degenerate)', () => {
  assert.equal(segRayVsAABB(0, 0, 0, 0, 0, 0, 2, 1), true);
});

test('segRayVsAABB: zero-length segment outside the box misses', () => {
  assert.equal(segRayVsAABB(10, 10, 10, 10, 0, 0, 2, 1), false);
});

// ---- rotation convention: world<->local for building fixtures -------------
// Same convention hasLOS()/coverBlockedR()/findHideSpot() all share:
// lx = dx*cos(ry) - dz*sin(ry), lz = dx*sin(ry) + dz*cos(ry). To place a
// *local* point back into world space (for constructing a test world point
// whose local coordinates are known), apply the transpose/inverse:
// wx = a*cos(ry) + b*sin(ry), wz = -a*sin(ry) + b*cos(ry).
function localToWorld(a: number, b: number, ry: number): [number, number] {
  const co = Math.cos(ry), si = Math.sin(ry);
  return [a * co + b * si, -a * si + b * co];
}
function worldToLocal(dx: number, dz: number, ry: number): [number, number] {
  const co = Math.cos(ry), si = Math.sin(ry);
  return [dx * co - dz * si, dx * si + dz * co];
}

for (const ry of [Math.PI / 4, -Math.PI / 4]) {
  test(`coverBlockedR: a point deep on a 7:1 rock's long axis (ry=${ry.toFixed(4)}) blocks even though it is far outside the prop's naive unrotated z-band -- LUL-91/LUL-268 regression class`, () => {
    const hx = 2.4, hz = 0.35;
    const [wx, wz] = localToWorld(2.0, 0, ry);
    // sanity: this world point sits well outside the naive (unrotated)
    // envelope [-hz,hz] on z -- a naive axis-aligned test would say "clear".
    assert.ok(Math.abs(wz) > hz, 'sanity: point must be outside the naive unrotated envelope');
    const [lx, lz] = worldToLocal(wx, wz, ry);
    assert.ok(Math.abs(lx - 2.0) < 1e-9 && Math.abs(lz) < 1e-9, 'sanity: local coords recovered');

    // kind 'rock' (not 'log'): LUL-384 made 'log' walkable/non-blocking in
    // coverBlockedR (coverKindBlocksPlayerMovement), so a blocking fixture
    // for this rotation test needs a kind that still blocks -- see the
    // dedicated log-skip test below for that behaviour.
    const correctGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx, hz, kind: 'rock', ry }]);
    assert.equal(coverBlockedR(wx, wz, 0, correctGrid), true, 'inside the true rotated footprint must block');

    // wrong sign (the actual LUL-91/LUL-268 bug): must NOT also call this a
    // hit, or the test isn't actually pinning the sign.
    const wrongSignGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx, hz, kind: 'rock', ry: -ry }]);
    assert.equal(coverBlockedR(wx, wz, 0, wrongSignGrid), false, 'the opposite rotation sign must not also block here');

    // naive axis-aligned (no rotation at all) must also miss -- this is the
    // literal "axis-aligned test against a rotated prop" failure mode.
    const unrotatedGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx, hz, kind: 'rock', ry: 0 }]);
    assert.equal(coverBlockedR(wx, wz, 0, unrotatedGrid), false, 'an axis-aligned box must not block a point only the rotated prop covers');
  });

  test(`coverBlockedR: the converse -- a point inside the naive world-AABB is NOT inside the true rotated footprint (ry=${ry.toFixed(4)})`, () => {
    const hx = 2.4, hz = 0.35;
    // sign chosen so the point lands off the rotated prop's long axis for
    // either rotation direction -- see worldToLocal: dx*si is what carries
    // the sign of ry into lz, so dz must carry the opposite sign to add
    // rather than cancel.
    const wx = 0.3, wz = 0.3 * Math.sign(ry);
    // sanity: inside the naive unrotated envelope on both axes.
    assert.ok(Math.abs(wx) < hx && Math.abs(wz) < hz, 'sanity: point must be inside the naive unrotated envelope');
    const [, lz] = worldToLocal(wx, wz, ry);
    assert.ok(Math.abs(lz) > hz, 'sanity: point must be outside the true rotated footprint');

    const correctGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx, hz, kind: 'rock', ry }]);
    assert.equal(coverBlockedR(wx, wz, 0, correctGrid), false, 'outside the true rotated footprint must not block');

    const unrotatedGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx, hz, kind: 'rock', ry: 0 }]);
    assert.equal(coverBlockedR(wx, wz, 0, unrotatedGrid), true, 'sanity: the naive axis-aligned box really does falsely allow this');
  });
}

test('coverBlockedR: skips kind === "tree" entries entirely, regardless of rotation', () => {
  const coverGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx: 5, hz: 5, kind: 'tree', ry: Math.PI / 4 }]);
  assert.equal(coverBlockedR(0, 0, 0, coverGrid), false);
});

// LUL-384 (release/next, merged in under LUL-582): 'log' is walkable, so
// coverBlockedR routes its skip through coverKindBlocksPlayerMovement()
// rather than a literal kind === 'tree' check -- pin that a log no longer
// blocks the player's own movement, even dead center, even though it is
// still real LOS-blocking cover (see the hasLOS asymmetry test below) and
// still a valid hiding spot (HIDE_KINDS).
test('coverBlockedR: skips kind === "log" entirely (LUL-384, walkable) even dead center', () => {
  const coverGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx: 2, hz: 1, kind: 'log', ry: 0 }]);
  assert.equal(coverBlockedR(0, 0, 0, coverGrid), false);
});

test('coverBlockedR: exactly on the face is not blocked (strict <, not <=)', () => {
  const coverGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx: 2, hz: 1, kind: 'rock', ry: 0 }]);
  assert.equal(coverBlockedR(2, 0, 0, coverGrid), false);   // exactly hx+pr away
  assert.equal(coverBlockedR(1.999, 0, 0, coverGrid), true); // just inside
});

// ---- hasLOS (LUL-91) --------------------------------------------------------

for (const ry of [Math.PI / 4, -Math.PI / 4]) {
  test(`hasLOS: a sightline through a 7:1 log's long axis (ry=${ry.toFixed(4)}) is blocked, even though it misses the log's naive unrotated z-band`, () => {
    const hx = 2.4, hz = 0.35;
    // Centered well inside a single CELL (not at a cell boundary/origin):
    // hasLOS looks up only the exact cell each sampled step point falls in
    // (no 3x3 neighbourhood, unlike coverBlockedR/blockedR/canopyBlockedR),
    // so the segment and the prop's own registered cell must agree -- same
    // constraint the real engine's CELL=8 bucketing has to satisfy for any
    // prop the LOS walk is meant to actually find.
    const cx = 4, cz = 4;
    const [dx0, dz0] = localToWorld(1.9, 0, ry);
    const [dx1, dz1] = localToWorld(2.1, 0, ry);
    const wx0 = cx + dx0, wz0 = cz + dz0, wx1 = cx + dx1, wz1 = cz + dz1;
    const coverGrid = makeGrid<CoverAABB>([{ x: cx, z: cz, hx, hz, kind: 'log', ry }]);
    assert.equal(hasLOS(wx0, wz0, wx1, wz1, coverGrid), false);

    const wrongSignGrid = makeGrid<CoverAABB>([{ x: cx, z: cz, hx, hz, kind: 'log', ry: -ry }]);
    assert.equal(hasLOS(wx0, wz0, wx1, wz1, wrongSignGrid), true, 'the opposite rotation sign must not also block this sightline');
  });
}

test('hasLOS: kind === "tree" DOES block sight (unlike coverBlockedR) -- deliberate asymmetry', () => {
  const coverGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx: 1.5, hz: 1.5, kind: 'tree' }]);   // no `ry` -- tagged trees are axis-aligned
  // coverBlockedR skips this same entry entirely:
  assert.equal(coverBlockedR(0, 0, 0, coverGrid), false);
  // hasLOS does not:
  assert.equal(hasLOS(-5, 0, 5, 0, coverGrid), false);
});

test('hasLOS: zero-length segment inside cover reports blocked', () => {
  const coverGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx: 1, hz: 1, kind: 'rock', ry: 0 }]);
  assert.equal(hasLOS(0, 0, 0, 0, coverGrid), false);
});

test('hasLOS: zero-length segment in open ground reports clear', () => {
  const coverGrid = makeGrid<CoverAABB>([{ x: 50, z: 50, hx: 1, hz: 1, kind: 'rock', ry: 0 }]);
  assert.equal(hasLOS(0, 0, 0, 0, coverGrid), true);
});

test('hasLOS: a clear line with no cover in any swept cell is unobstructed', () => {
  const coverGrid = makeGrid<CoverAABB>([]);
  assert.equal(hasLOS(-20, -20, 20, 20, coverGrid), true);
});

test('hasLOS: cover far off the segment\'s path does not block it', () => {
  const coverGrid = makeGrid<CoverAABB>([{ x: 100, z: 100, hx: 2, hz: 2, kind: 'rock', ry: 0 }]);
  assert.equal(hasLOS(-10, 0, 10, 0, coverGrid), true);
});

// ---- blockedR / canopyBlockedR / blocked (movement collision) -------------

test('blockedR: true within the combined tree+player radius, scanning the 3x3 cell neighbourhood', () => {
  // CELL=8; place the tree in the cell adjacent to the query point's cell so
  // the neighbourhood scan (not a same-cell hit) is what's exercised.
  const grid = makeGrid<CircleCollider>([{ x: 9, z: 0, cr: 1 }]);
  assert.equal(blockedR(9.5, 0, 0.6, grid), true);
});

test('blockedR: false when nothing is within range anywhere in the neighbourhood', () => {
  const grid = makeGrid<CircleCollider>([{ x: 9, z: 0, cr: 1 }]);
  assert.equal(blockedR(-9, 0, 0.6, grid), false);
});

test('blockedR: exactly at the combined radius is not blocked (strict <)', () => {
  const grid = makeGrid<CircleCollider>([{ x: 3, z: 0, cr: 1 }]);
  assert.equal(blockedR(0, 0, 2, grid), false);   // dist 3 === cr(1)+pr(2)
  assert.equal(blockedR(0.001, 0, 2, grid), true); // just inside
});

test('canopyBlockedR: true inside a tree\'s canopy radius', () => {
  const grid = makeGrid<CircleCollider>([{ x: 0, z: 0, cr: 0.3, crCanopy: 2 }]);
  assert.equal(canopyBlockedR(1, 0, grid), true);
});

test('canopyBlockedR: an entry with no crCanopy (e.g. a landmark) never blocks -- not an explicit skip, the same NaN-comparison no-op as `main`', () => {
  const grid = makeGrid<CircleCollider>([{ x: 0, z: 0, cr: 5 }]);   // huge cr, no crCanopy
  assert.equal(canopyBlockedR(0, 0, grid), false);
});

test('blocked: true from the tree-circle check alone', () => {
  const grid = makeGrid<CircleCollider>([{ x: 0, z: 0, cr: 1 }]);
  const coverGrid = makeGrid<CoverAABB>([]);
  assert.equal(blocked(0.5, 0, grid, coverGrid), true);
});

test('blocked: true from the cover-AABB check alone', () => {
  const grid = makeGrid<CircleCollider>([]);
  const coverGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx: 1, hz: 1, kind: 'rock', ry: 0 }]);
  assert.equal(blocked(0, 0, grid, coverGrid), true);
});

test('blocked: false from the cover-AABB check for a walkable log (LUL-384), even dead center', () => {
  const grid = makeGrid<CircleCollider>([]);
  const coverGrid = makeGrid<CoverAABB>([{ x: 0, z: 0, hx: 1, hz: 1, kind: 'log', ry: 0 }]);
  assert.equal(blocked(0, 0, grid, coverGrid), false);
});

test('blocked: true from the canopy check alone', () => {
  const grid = makeGrid<CircleCollider>([{ x: 0, z: 0, cr: 0.1, crCanopy: 3 }]);
  const coverGrid = makeGrid<CoverAABB>([]);
  assert.equal(blocked(1, 0, grid, coverGrid), true);
});

test('blocked: false when none of the three checks fire', () => {
  const grid = makeGrid<CircleCollider>([{ x: 50, z: 50, cr: 1, crCanopy: 1.5 }]);
  const coverGrid = makeGrid<CoverAABB>([{ x: -50, z: -50, hx: 1, hz: 1, kind: 'log', ry: 0 }]);
  assert.equal(blocked(0, 0, grid, coverGrid), false);
});

test('blocked uses PLAYER_COLLISION_RADIUS for the tree/cover checks (matches the exported constant, not a private literal)', () => {
  assert.equal(PLAYER_COLLISION_RADIUS, 0.6);
  const grid = makeGrid<CircleCollider>([{ x: 1.5, z: 0, cr: 1 }]);   // dist 1.5, needs pr > 0.5 to block
  const coverGrid = makeGrid<CoverAABB>([]);
  assert.equal(blocked(0, 0, grid, coverGrid), true);
});

// ---- findHideSpot (LUL-212, LUL-405/LUL-430) -------------------------------

test('findHideSpot: finds a qualifying prop (log) within HIDE_RADIUS', () => {
  const coverGrid = makeGrid<CoverAABB>([{ x: 1, z: 0, hx: 0.3, hz: 0.3, kind: 'log', ry: 0 }]);
  const spot = findHideSpot(0, 0, coverGrid);
  assert.ok(spot);
  assert.equal(spot!.kind, 'log');
});

test('findHideSpot: ignores a non-HIDE_KINDS prop (rock) even well within range', () => {
  const coverGrid = makeGrid<CoverAABB>([{ x: 0.5, z: 0, hx: 0.3, hz: 0.3, kind: 'rock', ry: 0 }]);
  assert.equal(findHideSpot(0, 0, coverGrid), null);
});

test('findHideSpot: HIDE_KINDS is exactly {bramble, log}', () => {
  assert.deepEqual(HIDE_KINDS, { bramble: true, log: true });
  assert.equal(HIDE_RADIUS, 2.2);
});

test('findHideSpot: exactly at HIDE_RADIUS is excluded (strict <)', () => {
  const hx = 0.3;
  const coverGrid = makeGrid<CoverAABB>([{ x: hx + HIDE_RADIUS, z: 0, hx, hz: 0.3, kind: 'log', ry: 0 }]);
  assert.equal(findHideSpot(0, 0, coverGrid), null);
});

test('findHideSpot: just inside HIDE_RADIUS is found', () => {
  const hx = 0.3;
  const coverGrid = makeGrid<CoverAABB>([{ x: hx + HIDE_RADIUS - 0.001, z: 0, hx, hz: 0.3, kind: 'log', ry: 0 }]);
  assert.ok(findHideSpot(0, 0, coverGrid));
});

test('findHideSpot: on an exact-distance tie, the first-encountered candidate in the grid scan wins (d < bestD is strict)', () => {
  // Both candidates land in the same CELL bucket as the query point (cell
  // "0,0") and both have distanceToCoverEdge === 2.0 from (0,0) -- array
  // order is push order into that bucket, matching buildCoverGrid()'s own
  // coverData-iteration order in the engine.
  const a: CoverAABB = { x: 2.5, z: 0, hx: 0.5, hz: 0.5, kind: 'log', ry: 0 };
  const b: CoverAABB = { x: 0, z: 2.5, hx: 0.5, hz: 0.5, kind: 'bramble', ry: 0 };
  const coverGrid: SpatialGrid<CoverAABB> = new Map([[gridKey(0, 0), [a, b]]]);
  const spot = findHideSpot(0, 0, coverGrid);
  assert.equal(spot, a, 'first-pushed candidate must win the tie');
});

// ---- effectiveDetect (LUL-43, LUL-291) -------------------------------------

test('effectiveDetect: not hidden -> stillness contributes nothing, regardless of hideTime', () => {
  const state: DetectionState = { hidden: false, hideTime: 999, lightDimmed: false };
  assert.equal(effectiveDetect(10, 1, state), 10);
});

test('effectiveDetect: hidden with hideTime=0 -> stillness is 0 (matches not-hidden)', () => {
  const state: DetectionState = { hidden: true, hideTime: 0, lightDimmed: false };
  assert.equal(effectiveDetect(10, 1, state), 10);
});

test('effectiveDetect: hidden with hideTime exactly at STILL_RAMP -> full stillness cut applied', () => {
  const state: DetectionState = { hidden: true, hideTime: STILL_RAMP, lightDimmed: false };
  assert.equal(effectiveDetect(10, 1, state), 10 * (1 - STILL_DETECT_CUT));
});

test('effectiveDetect: hidden well past STILL_RAMP clamps at the same full cut, does not keep shrinking', () => {
  const atRamp: DetectionState = { hidden: true, hideTime: STILL_RAMP, lightDimmed: false };
  const wayPast: DetectionState = { hidden: true, hideTime: STILL_RAMP * 50, lightDimmed: false };
  assert.equal(effectiveDetect(10, 1, wayPast), effectiveDetect(10, 1, atRamp));
});

test('effectiveDetect: lightDimmed multiplies on top of stillness, and applies even when not hidden', () => {
  const state: DetectionState = { hidden: false, hideTime: 0, lightDimmed: true };
  assert.equal(effectiveDetect(10, 1, state), 10 * DIM_DETECT_MUL);
});

test('effectiveDetect: difficulty detectMul scales the base detect range', () => {
  const state: DetectionState = { hidden: false, hideTime: 0, lightDimmed: false };
  assert.equal(effectiveDetect(10, 0.7, state), 7);
});

// ---- canSee (composition) ---------------------------------------------------

test('canSee: false once dist reaches effectiveDetect, even with a clear line (>= is exclusive of "seen")', () => {
  const state: DetectionState = { hidden: false, hideTime: 0, lightDimmed: false };
  const coverGrid = makeGrid<CoverAABB>([]);
  assert.equal(canSee(10, 10, 1, state, 0, 0, 10, 0, coverGrid), false);
});

test('canSee: in range but LOS blocked -> false', () => {
  const state: DetectionState = { hidden: false, hideTime: 0, lightDimmed: false };
  const coverGrid = makeGrid<CoverAABB>([{ x: 5, z: 0, hx: 1, hz: 1, kind: 'rock', ry: 0 }]);
  assert.equal(canSee(9, 10, 1, state, 0, 0, 10, 0, coverGrid), false);
});

test('canSee: in range and LOS clear -> true', () => {
  const state: DetectionState = { hidden: false, hideTime: 0, lightDimmed: false };
  const coverGrid = makeGrid<CoverAABB>([]);
  assert.equal(canSee(9, 10, 1, state, 0, 0, 10, 0, coverGrid), true);
});

// ---- canopyRadiusAtEye (LUL-267) -------------------------------------------

test('canopyRadiusAtEye: matches the plain formula for a mid-size tree', () => {
  const geo = { canopyR: 1.15, cone1Height: 2.5, apexY: 3.35 };
  const eye = 2.2;
  const s = 1;
  assert.equal(canopyRadiusAtEye(s, eye, geo), Math.max(0, (geo.canopyR / geo.cone1Height) * (geo.apexY * s - eye)));
  assert.ok(canopyRadiusAtEye(s, eye, geo) > 0);
});

test('canopyRadiusAtEye: clamps to 0 for a small tree whose apex at eye height is below the camera', () => {
  const geo = { canopyR: 1.15, cone1Height: 2.5, apexY: 3.35 };
  const eye = 2.2;
  assert.equal(canopyRadiusAtEye(0.1, eye, geo), 0);
});

// ---- rollCoverPropShape (LUL-43) -------------------------------------------

function seq(values: number[]) {
  let i = 0;
  return () => values[i++];
}

test('rollCoverPropShape: roll < 0.4 is a log, hx=long/hz=thin branch (swap roll < 0.5)', () => {
  const rng = seq([0.5, 0.2, 0.1]);   // long, thin, then the hx/hz swap roll (< 0.5 -> long/thin)
  const shape = rollCoverPropShape(0.1, rng);
  assert.deepEqual(shape, { kind: 'log', hx: 1.3 + 0.5 * 1.1, hz: 0.35 + 0.2 * 0.25, y: 0.3 });
});

test('rollCoverPropShape: roll < 0.4 is a log, hx=thin/hz=long branch (swap roll >= 0.5)', () => {
  const rng = seq([0.5, 0.2, 0.9]);
  const shape = rollCoverPropShape(0.1, rng);
  assert.deepEqual(shape, { kind: 'log', hx: 0.35 + 0.2 * 0.25, hz: 1.3 + 0.5 * 1.1, y: 0.3 });
});

test('rollCoverPropShape: roll exactly 0.4 is NOT a log (strict <) -- falls into the rock branch', () => {
  const rng = seq([0.5, 0.4]);
  const shape = rollCoverPropShape(0.4, rng);
  assert.equal(shape.kind, 'rock');
});

test('rollCoverPropShape: roll in [0.4, 0.75) is a rock', () => {
  const rng = seq([0.5, 0.4]);
  const shape = rollCoverPropShape(0.5, rng);
  const r = 0.9 + 0.5 * 0.9;
  assert.deepEqual(shape, { kind: 'rock', hx: r, hz: r * (0.7 + 0.4 * 0.5), y: r * 0.55 });
});

test('rollCoverPropShape: roll exactly 0.75 is NOT a rock (strict <) -- falls into the bramble branch', () => {
  const rng = seq([0.5]);
  const shape = rollCoverPropShape(0.75, rng);
  assert.equal(shape.kind, 'bramble');
});

test('rollCoverPropShape: roll >= 0.75 is a bramble', () => {
  const rng = seq([0.5]);
  const shape = rollCoverPropShape(0.9, rng);
  const r = 0.8 + 0.5 * 0.7;
  assert.deepEqual(shape, { kind: 'bramble', hx: r, hz: r, y: r * 0.6 });
});

test('rollCoverPropShape: draws exactly 3 rng() calls for a log, 2 for a rock, 1 for a bramble -- the seeded-stream draw count must not drift', () => {
  let calls = 0;
  const counting = () => { calls++; return 0.5; };
  calls = 0; rollCoverPropShape(0.1, counting); assert.equal(calls, 3);
  calls = 0; rollCoverPropShape(0.5, counting); assert.equal(calls, 2);
  calls = 0; rollCoverPropShape(0.9, counting); assert.equal(calls, 1);
});
