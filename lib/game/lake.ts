// LUL-791: pure helpers for the lake -- until this ticket the lake was pure
// render (water mesh + glow ring), never consulted by movement or spawn
// placement (docs/ELEMENTS.md UNDEFINED findings LUL-392/LUL-395). No
// Three.js, no DOM (see wiki systems/unit-testing-standard). The engine owns
// CONFIG.lake and calls these back in, same split as lib/game/bog.ts.
//
// `r` (visible water radius) and `clear` (spawn-clearance radius) are
// deliberately different circles, same shape as LANDMARKS' `cr`/`clear`
// split: `clear` is wider so nothing generates hugging the water's edge, `r`
// is where the water mesh actually is. Player wading uses `r` -- the slow
// should start at the water's edge, not 7 units of dry sand before it.
// Spawn rejection (trees/baby/cover already, predators as of this ticket)
// uses `clear`, matching the existing convention.

export interface LakeConfig {
  x: number;
  z: number;
  r: number;
  clear: number;
}

export function inLakeWater(x: number, z: number, lake: LakeConfig): boolean {
  const dx = x - lake.x;
  const dz = z - lake.z;
  return dx * dx + dz * dz < lake.r * lake.r;
}

export function inLakeClearance(x: number, z: number, lake: LakeConfig): boolean {
  const dx = x - lake.x;
  const dz = z - lake.z;
  return dx * dx + dz * dz < lake.clear * lake.clear;
}

// "wading, not a wall" -- LUL-791's founder note: a hard invisible wall in a
// fog-heavy horror game reads as a bug even when intentional, and a slow
// plays into the core hiding loop (risk the slow crossing, or go around).
// Matches BOG_SPEED_MULTIPLIER's value/shape (lib/game/bog.ts) rather than
// inventing a second number -- both read as "chest-deep water, half pace"
// and nothing in the ticket asks the lake to feel different from the bog.
export const LAKE_SPEED_MULTIPLIER = 0.5;

export function lakeSpeedMultiplier(inLake: boolean): number {
  return inLake ? LAKE_SPEED_MULTIPLIER : 1;
}

// Deterministic fallback for a spawn candidate that is still inside the
// lake's clearance ring after the caller's retry budget is exhausted --
// pushes the point radially outward from the lake's center to just past
// `clear`, along the same angle the candidate already had (or +x if the
// candidate landed exactly on the lake center, distance 0). Never loops:
// O(1), always terminates, and the result is provably outside the lake
// (distance from center is exactly `clear + margin`).
export function pushOutOfLakeClearance(
  x: number,
  z: number,
  lake: LakeConfig,
  margin = 0.5,
): { x: number; z: number } {
  const dx = x - lake.x;
  const dz = z - lake.z;
  const dist = Math.hypot(dx, dz);
  const targetDist = lake.clear + margin;
  if (dist === 0) return { x: lake.x + targetDist, z: lake.z };
  const scale = targetDist / dist;
  return { x: lake.x + dx * scale, z: lake.z + dz * scale };
}

// LUL-2735: pushOutOfLakeClearance() only guarantees the result clears the
// lake itself -- it walks the candidate straight out to lake.clear+margin
// along its own bearing with no awareness of anything else near the lake.
// engine/forest-engine.js's placePredators() retry loop already rejects
// candidates inside the origin/baby clearance circles *before* the lake
// push runs, but the push itself can walk a candidate that passed that
// check back into one of those circles (observed live: qaWorld=micro seed
// 43 pushed a bear to 6.786u of the baby, seed 141 a lion to 5.515u, against
// a scaled threshold of 6.8u). This wraps the existing push with a
// deterministic angular search around the *same* clearance-ring radius
// (never moves the point closer to or farther from the lake than the plain
// push already does -- only the angle changes, so "provably outside the
// lake" still holds), same "spiral outward, no rng(), give up and return
// the nominal result" shape as findClearLandmarkSpot() (LUL-2740,
// lib/game/landmarkClearance.ts) -- deliberately reused rather than
// reinvented. Callers on the shared LUL-791/LUL-794 rng() stream must not
// introduce an rng() call here; there is none.
const LAKE_CLEARANCE_RING_STEPS = 36; // 10-degree steps

export interface ClearanceCircle {
  x: number;
  z: number;
  r: number;
}

export function pushOutOfLakeClearanceAvoiding(
  x: number,
  z: number,
  lake: LakeConfig,
  avoid: readonly ClearanceCircle[],
  margin = 0.5,
): { x: number; z: number } {
  const pushed = pushOutOfLakeClearance(x, z, lake, margin);
  const clears = (px: number, pz: number) =>
    avoid.every((a) => Math.hypot(px - a.x, pz - a.z) >= a.r);
  if (clears(pushed.x, pushed.z)) return pushed;
  const targetDist = lake.clear + margin;
  const baseAngle = Math.atan2(pushed.z - lake.z, pushed.x - lake.x);
  for (let i = 1; i <= LAKE_CLEARANCE_RING_STEPS / 2; i++) {
    const step = (i / LAKE_CLEARANCE_RING_STEPS) * Math.PI * 2;
    for (const sign of [1, -1]) {
      const angle = baseAngle + sign * step;
      const px = lake.x + Math.cos(angle) * targetDist;
      const pz = lake.z + Math.sin(angle) * targetDist;
      if (clears(px, pz)) return { x: px, z: pz };
    }
  }
  return pushed; // every angle on the ring still fails -- return the plain push unchanged
}

// LUL-857: a roam/stuck-recovery waypoint that lands in the water reads
// identically to any other -- predators have no notion of "wet" -- so a
// wander target inside `inLakeWater()` (the visible water radius `r`, not
// the wider spawn-clearance `clear` LUL-395 uses) gets deflected to just
// past the shore instead. Reuses `pushOutOfLakeClearance()` against a
// `{...lake, clear: r}` view so "just past `clear`" means "just past the
// water's edge" here, same deterministic O(1) push LUL-791 already
// established for spawn candidates -- no new math, no retry loop.
export function keepWaypointOffLake(
  x: number,
  z: number,
  lake: LakeConfig,
): { x: number; z: number } {
  if (!inLakeWater(x, z, lake)) return { x, z };
  return pushOutOfLakeClearance(x, z, { ...lake, clear: lake.r }, 2);
}
