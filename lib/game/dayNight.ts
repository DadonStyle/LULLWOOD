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

// LUL-4889 (Dusk Stealth, lion-only): a *separate* curve keyed on runElapsed
// (real seconds, not the 0-1 timeOfRun fraction -- it keeps moving past
// TIME_OF_RUN_DURATION_S=120s while timeOfRun itself clamps at 1) that
// REPLACES timeOfRunDetectMul for the lion specifically. Stacking both on
// lion would fight the ambient +30% ramp with a -50% ramp in the same
// window, which reads as incoherent to the player and to QA -- see
// wiki/game/mechanics/dusk-stealth.md's Engineering Resolution. Wolf/bear
// are untouched and keep calling timeOfRunDetectMul as before.
export const DUSK_LION_SIGHT_START_S = 90;
export const DUSK_LION_SIGHT_END_S = 150;
export const DUSK_LION_SIGHT_MUL = 0.5;

/** 1.0 (no change) below DUSK_LION_SIGHT_START_S, linear ramp down to
 * DUSK_LION_SIGHT_MUL at DUSK_LION_SIGHT_END_S+, clamped -- same shape as
 * timeOfRunDetectMul above, just decreasing instead of increasing and keyed
 * on the raw elapsed-seconds clock instead of the 0-1 fraction. */
export function duskLionDetectMul(runElapsed: number): number {
  if (runElapsed <= DUSK_LION_SIGHT_START_S) return 1;
  if (runElapsed >= DUSK_LION_SIGHT_END_S) return DUSK_LION_SIGHT_MUL;
  const frac = (runElapsed - DUSK_LION_SIGHT_START_S) / (DUSK_LION_SIGHT_END_S - DUSK_LION_SIGHT_START_S);
  return 1 + frac * (DUSK_LION_SIGHT_MUL - 1);
}
