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

/** A thrown object's landing noise is a one-shot event, not a per-frame roll like
 * isNoiseHeard() -- reuses NOISE_RADIUS_RUN's scale per the CTO plan (decision 5). */
export const THROWABLE_NOISE_RADIUS = NOISE_RADIUS_RUN;

/** The child's cry (LUL-1255 Ship 1 wayfinding) is audible further than any footstep --
 * a sustained beacon, not an incidental sound. */
export const CRY_NOISE_RADIUS = 32;

/** LUL-1857 (Ship 1 wayfinding S4): a carrying player can never be perfectly silent --
 * the child cries even while you hide and hold still. 0.4 * NOISE_RADIUS_WALK, per the
 * Game Economist's LUL-1646 answer (game/economy/wayfinding-cry-numbers). Deliberately
 * fixed, NOT scaled by fog-tide -- LUL-1686 decision (decisions/lul-1686-carried-noise-
 * floor-no-fog-tide): scaling would put it at 5.6*1.35=7.56u, inside the 8u sniff-backoff
 * distance (predator.ts's backOffPoint() retreats 8-16u), which would let the terminal
 * give-up's retreat land back inside earshot and re-hook the very loop LUL-1647's
 * mitigation 3 exists to terminate. If CARRIED_NOISE_FLOOR or the backoff range ever
 * change, re-check this constraint before shipping either. */
export const CARRIED_NOISE_FLOOR = 0.4 * NOISE_RADIUS_WALK;

/**
 * Whether a predator at `dist` from a throwable's landing point notices it. Pure
 * distance check, deliberately not probabilistic like isNoiseHeard() -- a thrown
 * object either lands loud enough to notice or it doesn't; there is no "roll again
 * next frame" because the event fires once, on landing, not every tick.
 */
export function checkThrowableNoise(dist: number, radius: number = THROWABLE_NOISE_RADIUS): boolean {
  return dist < radius;
}

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
