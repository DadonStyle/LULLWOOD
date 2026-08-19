// LUL-25: pure helpers for the Bog map band -- where it starts, what it costs
// to walk through, and where the child spawns beyond it on hard difficulty.
// No Three.js, no DOM (see wiki systems/unit-testing-standard). The engine
// owns the world-space constants (half, zMax, landmark positions) and calls
// these back in, same split as lib/game/scent.ts and lib/game/charge.ts.

export interface BogBounds {
  half: number; // forest x half-width, and the z coordinate where the bog begins
  zMax: number; // outer z edge of the bog band
}

/** True once the player has crossed the forest's far edge into the bog band.
 * Half-open at both ends: exactly on the forest/bog seam (`z === half`) still
 * reads as forest, and past `zMax` (outside the playable map entirely) is not
 * "bog" either -- callers clamp movement to `zMax` before this ever matters. */
export function isInBog(z: number, bounds: BogBounds): boolean {
  return z > bounds.half && z <= bounds.zMax;
}

export const BOG_SPEED_MULTIPLIER = 0.5; // "shallow water at half walk speed"
export const BOG_NOISE_MULTIPLIER = 1.6; // splashing carries further than dry footsteps

export function bogSpeedMultiplier(inBog: boolean): number {
  return inBog ? BOG_SPEED_MULTIPLIER : 1;
}

export function bogNoiseMultiplier(inBog: boolean): number {
  return inBog ? BOG_NOISE_MULTIPLIER : 1;
}

export interface Point {
  x: number;
  z: number;
}

export interface Landmark extends Point {
  clear: number; // radius to keep clear of, in world units
}

function clearOfLandmarks(x: number, z: number, landmarks: readonly Landmark[], pad: number): boolean {
  return landmarks.every((l) => Math.hypot(x - l.x, z - l.z) >= l.clear + pad);
}

/**
 * Draws a point from `rng` ((0,1) or [0,1), caller's own generator) at least
 * 20 units past the bog's near edge and 20 short of its far edge, clear of
 * every landmark by `pad`. Bounded by `maxTries` so a landmark layout that
 * happens to cover the whole band can't spin forever -- returns its last
 * candidate rather than looping, since "close to a landmark" is a cosmetic
 * risk, not a correctness one.
 */
export function pickHardBabyPosition(
  rng: () => number,
  bounds: BogBounds,
  halfWidth: number,
  landmarks: readonly Landmark[],
  pad = 6,
  maxTries = 200,
): Point {
  const zLo = bounds.half + 20;
  const zHi = Math.max(zLo, bounds.zMax - 20);
  let x = 0;
  let z = zLo;
  for (let i = 0; i < maxTries; i++) {
    x = (rng() * 2 - 1) * Math.max(0, halfWidth - 20);
    z = zLo + rng() * (zHi - zLo);
    if (clearOfLandmarks(x, z, landmarks, pad)) return { x, z };
  }
  return { x, z };
}
