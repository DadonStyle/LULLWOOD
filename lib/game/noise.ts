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

/** LUL-1857: a still, carrying player still emits this much noise from the child's
 * own rustling/fussing -- a floor under the footstep channel, not a replacement for
 * it (a *moving* carrier still uses NOISE_RADIUS_WALK/RUN normally). 0.4 *
 * NOISE_RADIUS_WALK, per LUL-1646 (Game Economist) / decisions/childs-cry-lul1674-
 * disposition-2026-09-07. Deliberately NOT fog-tide-scaled: game/psychology/
 * carried-cry-fairness §A3 shows floor*1.35 (fog-tide's own multiplier) reaches
 * 7.56u, inside the 8u sniff-backoff-distance bound (§A3) by only 0.44u -- too
 * little headroom to be safe under any future retune. Leaving this unscaled keeps
 * a full 2.4u of margin always. This value is checked deterministically against a
 * pulse event (see engine/forest-engine.js's carry-leg cry timer), not rolled
 * per-frame like isNoiseHeard() -- see carried-cry-fairness verdict mitigation 2. */
export const CARRIED_NOISE_FLOOR = 0.4 * NOISE_RADIUS_WALK; // 5.6

/** LUL-2547: hide-entry is a one-shot noise event, same "distance check, not a roll" shape as
 * checkThrowableNoise() -- ducking into cover isn't silent, it's a rustle a nearby predator can
 * notice. Default value; Game Economist owns retuning it once live `hide_alert` chronicle data
 * (the `alerted` count below) gives a signal to tune against. */
export const HIDE_ALERT_RADIUS = 20;

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
