// LUL-1709/LUL-1714: pure day/night pacing math, lifted out so it can be unit
// tested without a Three.js scene (see wiki systems/unit-testing-standard).
// The engine (engine/forest-engine.js) owns the live `timeOfRun` clock itself
// (runElapsed accumulator, pausable exactly like fogTideClock) -- this module
// only owns the multiplier derived from it, same split as veilDetectMul
// (lib/game/veil.ts) and fogTideDetectMul (lib/game/fogTide.ts).

// +30% predator detect range at full night (timeOfRun=1) -- unlike the veil
// and fog-tide multipliers, which cut detect range, this one raises it: the
// approaching night makes predators more dangerous, not less.
export const TIME_OF_RUN_DETECT_MUL = 1.3;

/** `timeOfRun` is the engine's own live pacing clock, 0 (dawn) to 1 (full
 * night). Linear ramp from 1 (no change) to TIME_OF_RUN_DETECT_MUL, same
 * shape as veilDetectMul/fogTideDetectMul. Stacks multiplicatively with both
 * at the two effectiveDetect()/canSee() call sites in forest-engine.js. */
export function timeOfRunDetectMul(timeOfRun: number): number {
  return 1 + timeOfRun * (TIME_OF_RUN_DETECT_MUL - 1);
}
