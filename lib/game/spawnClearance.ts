// LUL-2725: placePredators()'s spawn-clearance retry loop
// (engine/forest-engine.js, LUL-791/LUL-794 P1 comment) used the same fixed
// 50u-from-origin / 34u-from-baby constants at every CONFIG.mapSize. At
// qaWorld=micro's half=48 (engine/tuning.js applyQaWorldMicroPreset(),
// CONFIG.mapSize=96) the 50u exclusion radius covers nearly the entire
// usable square, so the loop's 60-try budget occasionally exhausts and
// falls through with a candidate close to the origin -- observed live at
// 5.0u in 1/40 trials. This scales the constants by the same 96/480 ratio
// applyQaWorldMicroPreset() already uses for detectScaleMul/speedScaleMul/
// missionScaleMul (tuning.js:216-222), extracted to a pure function so the
// full-map identity (scale===1, hence 2500*1*1===2500 and 34*1===34 --
// byte-identical rng() accept/reject outcome and draw count to today) is a
// permanent unit test, not a one-time manual diff.
export const FULL_MAP_HALF = 240;

/** Linear scale for the spawn-clearance constants, keyed off the map's
 * half-width. Exactly 1 for any half>=FULL_MAP_HALF (every real map),
 * shrinking proportionally below that. */
export function spawnClearanceScale(half: number): number {
  return Math.min(1, half / FULL_MAP_HALF);
}
