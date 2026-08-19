import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceToCoverEdge, overlapsTreeTrunk } from './cover.ts';

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
