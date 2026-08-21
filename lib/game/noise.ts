// LUL-593 (wave 4 of LUL-277): pure hearing math lifted out of checkNoise()
// (engine/forest-engine.js), unit tested without a Three.js scene or a
// running render loop (see wiki systems/unit-testing-standard). LUL-39
// added footstep noise as the third detection channel alongside sight
// (cover.ts's canSee/hasLOS) and scent (scent.ts) -- those two are already
// extracted and unit-tested; this closes the gap for hearing.
//
// The engine still owns noiseRadius's derivation from player pace/bog state
// (tick()'s movement block: `(running ? NOISE_RADIUS_RUN : NOISE_RADIUS_WALK)
// * bogNoiseMultiplier(playerInBog)`, the same ternary shape scent.ts's own
// SCENT_RADIUS_WALK/RUN split leaves inline) and every side effect
// (hearNoise() commits the predator to the investigate loop) -- this module
// only owns the "was this in-range roll a hit" predicate.

/** Footstep audibility (units) at a walking pace. */
export const NOISE_RADIUS_WALK = 14;
/** Shift is louder -- same louder-but-riskier trade SCENT_RADIUS_RUN charges. */
export const NOISE_RADIUS_RUN = 24;
/** dt-scaled roll: being in radius is a chance to notice per second, not an instant catch. */
export const HEAR_CHANCE_PER_SEC = 0.5;

export type RNG = () => number;

/**
 * Whether a roaming predator hears the player this frame. `dist` and
 * `noiseRadius` are both in world units; `noiseRadius <= 0` (e.g. the player
 * standing still, where the engine never enters the moving branch that
 * computes a radius at all) or being outside it is always a miss regardless
 * of the roll. `rand` defaults to Math.random, matching every other
 * per-frame predator roll in this codebase (see predator.ts's own
 * determinism note) -- injectable here purely for deterministic tests.
 */
export function isNoiseHeard(
  dist: number,
  noiseRadius: number,
  dt: number,
  rand: RNG = Math.random,
): boolean {
  if (noiseRadius <= 0 || dist >= noiseRadius) return false;
  return rand() < HEAR_CHANCE_PER_SEC * dt;
}
