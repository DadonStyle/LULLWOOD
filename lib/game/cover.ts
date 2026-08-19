// LUL-450 (resumes LUL-383b/LUL-387): geometry helpers for the hiding-
// collision bug class, lifted out of engine/forest-engine.js so they are
// unit-testable without a Three.js scene (see wiki systems/unit-testing-
// standard). This is a narrow slice of the LUL-425/wave-3 extraction scope
// (findHideSpot's edge math + generateCover's tree-clearance predicate
// only) -- hasLOS/coverBlockedR/blockedR/canopyBlockedR/effectiveDetect/
// canSee stay in the engine for now; see wiki game/lul450-status for why
// wave 3 itself wasn't picked up here.

// ---- hide-trigger edge distance (LUL-405/LUL-430) --------------------------
// findHideSpot() previously approximated a cover prop's edge as a circle of
// radius Math.max(hx, hz) -- the *longer* half-extent, applied uniformly in
// every direction. For a 7:1 log (hx up to 2.4, hz down to 0.35) this
// balloons the eligible hide-trigger region on the log's thin side to a
// ~4.6-unit-radius disc, several times the object's actual ~0.35-0.6-unit
// thickness there -- a player 4+ units off to the side, not touching or
// visually near the log, could press H and succeed.
//
// This computes the real (rotation-aware) distance from a point to the
// prop's rectangular footprint instead: 0 if the point is inside the rect,
// the straight-line distance to the nearest edge/corner otherwise.
// `lx`/`lz` are the point's coordinates in the prop's own local (unrotated)
// frame -- same world->local convention coverBlockedR()/hasLOS() already use
// (systems/los-rotated-aabb-sign-bug): the point delta rotated by
// (cos(ry), sin(ry)) applied as lx = dx*co - dz*si, lz = dx*si + dz*co.
export function distanceToCoverEdge(lx: number, lz: number, hx: number, hz: number): number {
  const dx = Math.max(Math.abs(lx) - hx, 0);
  const dz = Math.max(Math.abs(lz) - hz, 0);
  return Math.hypot(dx, dz);
}

// ---- cover-vs-tree spawn clearance (LUL-396) --------------------------------
// generateCover() placed rock/log/bramble props checking inLake()/inSpawn()/
// inBaby() only -- it never checked tree positions, so a prop could spawn
// overlapping a tree trunk's own movement-collision circle (t.cr). Worst
// case for a HIDE_KINDS prop (bramble/log): an unreachable or broken hide
// spot, since the player's own tree collision (blockedR) would keep them
// from ever standing where findHideSpot() would trigger.
//
// Circle-vs-circle overlap test against the trunk's *movement* radius, not
// the much larger, player-only canopy radius (LUL-267) -- deliberately the
// same radius blockedR() itself collides the player and predators against.
export interface TreeTrunk {
  x: number;
  z: number;
  cr: number;
}

export function overlapsTreeTrunk(x: number, z: number, propRadius: number, trees: readonly TreeTrunk[]): boolean {
  for (const t of trees) {
    const dx = x - t.x, dz = z - t.z, rr = propRadius + t.cr;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}
