// LUL-1308: bearing math lifted out of announceCaption()'s inline duplicate
// (engine/forest-engine.js) so hearNoise()'s near-identical copy and the new
// approach-cue panner/edge-glow can all share one implementation. Pure and
// unit-tested without a Three.js scene or a running render loop, same
// convention as noise.ts/cover.ts (see wiki systems/unit-testing-standard).

export type BearingSide = 'ahead' | 'behind' | 'left' | 'right';

export interface Bearing {
  /** Coarse quadrant, in the origin's own reference frame. 'ahead' means the
   *  origin's own view already covers it — callers that skip 'ahead' rely on this. */
  side: BearingSide;
  /** Lateral offset (world units) in the origin's right-handed frame; positive = origin's right. */
  right: number;
  /** Forward offset (world units) in the origin's frame; positive = in front of origin. */
  fwd: number;
  /** Straight-line distance (world units) between source and origin. */
  dist: number;
}

/**
 * Where `(sourceX, sourceZ)` sits relative to `(originX, originZ)` facing `originYaw`.
 * Extracted verbatim from announceCaption()'s inline math (forest-engine.js:2121-2126
 * @ 8b99b9f) — same fx/fz/rx/rz basis, same 0.6 ahead/behind-vs-side threshold.
 */
export function bearingOf(
  sourceX: number,
  sourceZ: number,
  originX: number,
  originZ: number,
  originYaw: number,
): Bearing {
  const dx = sourceX - originX, dz = sourceZ - originZ;
  const dist = Math.hypot(dx, dz);
  const fx = -Math.sin(originYaw), fz = -Math.cos(originYaw);
  const rx = Math.cos(originYaw), rz = -Math.sin(originYaw);
  const fwd = dx * fx + dz * fz, right = dx * rx + dz * rz;
  const side: BearingSide =
    Math.abs(right) < Math.abs(fwd) * 0.6 ? (fwd >= 0 ? 'ahead' : 'behind') : (right > 0 ? 'right' : 'left');
  return { side, right, fwd, dist };
}

/**
 * Stereo pan value in [-1, 1] for a bearing. Same formula already shipped for
 * the mission waypoint hum (missionWaypointHum(), forest-engine.js:1251 @ 8b99b9f:
 * `right / Math.max(1, hypot(right, fwd))`, clamped) — reused here for
 * consistency across the audio graph rather than inventing a second curve.
 * `Math.max(1, dist)` avoids a divide-by-zero/spike when dist is near 0.
 */
export function bearingPan(bearing: Pick<Bearing, 'right' | 'dist'>): number {
  return Math.max(-1, Math.min(1, bearing.right / Math.max(1, bearing.dist)));
}

// ---- LUL-1282 (folded in per CEO addendum on threat-bearing-pulse, same PR,
// same audio graph): predatorCall()'s volume was a binary big?1.0:0.6 with no
// distance falloff -- a wolf at 60 units and one at 8 units sounded identical.

/** Full volume at/inside this distance (world units). */
export const CALL_FULL_VOL_DIST = 20;
/** Volume ramps to CALL_MIN_VOL_MUL over this many additional units past CALL_FULL_VOL_DIST. */
export const CALL_FALLOFF_DIST = 70;
/** Floor multiplier -- a call is never fully inaudible past the falloff, just quiet. */
export const CALL_MIN_VOL_MUL = 0.35;

/** Distance-based volume multiplier for a predator call. `dist < 0` is treated as 0. */
export function callVolumeMul(dist: number): number {
  const d = Math.max(0, dist);
  return Math.max(CALL_MIN_VOL_MUL, Math.min(1, 1 - (d - CALL_FULL_VOL_DIST) / CALL_FALLOFF_DIST));
}
