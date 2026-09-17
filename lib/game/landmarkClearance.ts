// LUL-2740: clearLandmarkSpot()'s nudge search, lifted out of
// engine/forest-engine.js so it is unit-testable without a Three.js scene
// (same extraction pattern as lib/game/cover.ts, LUL-450). Pure geometry, no
// rng() -- callers must not introduce one; the seeded stream ordering
// depends on this staying a pure function of its inputs.

export interface ClearanceObstacle {
  x: number;
  z: number;
  /** Effective collision radius against this obstacle (tree cr, cover's max(hx,hz), etc). */
  radius: number;
}

const SPIRAL_STEP = 3;
// LUL-2740: generous enough that no shipped LANDMARKS entry (engine/tuning.js)
// has ever needed more than a handful of rings in practice, but capped so a
// pathological obstacle field can't spiral forever -- "can't run away" per
// the CTO's fix-direction call.
const SPIRAL_MAX_RADIUS = 60;

export function isSpotClear(x: number, z: number, clear: number, obstacles: readonly ClearanceObstacle[]): boolean {
  for (const o of obstacles) {
    if (Math.hypot(x - o.x, z - o.z) < clear + o.radius) return false;
  }
  return true;
}

/** Deterministic outward spiral from (x,z): ring radius grows by SPIRAL_STEP
 * each lap, samples-per-ring grows with the ring's circumference so the
 * arc-length between sampled points never exceeds SPIRAL_STEP (no gap wide
 * enough for a clear pocket to hide from the search). Returns the first
 * clear point found; if SPIRAL_MAX_RADIUS is exhausted with no clear point
 * anywhere in the search, returns the original (x,z) unchanged -- same
 * "give up and use the nominal spot" fallback shape the old 8-try loop had,
 * except now it only fires past a much larger, deliberately-generous search
 * instead of after 8 tries. Callers must not assume the returned point is
 * clear without checking (isSpotClear) if they need to distinguish the two
 * cases. */
export function findClearLandmarkSpot(
  x: number,
  z: number,
  clear: number,
  obstacles: readonly ClearanceObstacle[],
): [number, number] {
  if (isSpotClear(x, z, clear, obstacles)) return [x, z];
  for (let r = SPIRAL_STEP; r <= SPIRAL_MAX_RADIUS; r += SPIRAL_STEP) {
    const samples = Math.max(8, Math.ceil((2 * Math.PI * r) / SPIRAL_STEP));
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (isSpotClear(px, pz, clear, obstacles)) return [px, pz];
    }
  }
  return [x, z];
}
