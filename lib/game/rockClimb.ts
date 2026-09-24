// Tunable constants for Rock -- Vantage Climb (LUL-4528, LUL-3254 cheap slice, sightline
// only -- no directional ping, CEO decision 2026-09-22). Economist's parallel ticket tunes
// these values directly; no engine change needed to retune.
export const ROCK_MOUNT_RADIUS = 3;        // interact radius, matches THROWABLE_PICKUP_RADIUS
                                            // scale (engine/forest-engine.js:546)
export const ROCK_MOUNT_DURATION = 2;      // seconds -- fixed mount window (tap-trigger, not
                                            // held -- see Trigger section below)
export const ROCK_MOUNT_HEIGHT = 1.4;      // added to CONFIG.eye while mounted -- fixed
                                            // constant, not a per-rock mesh-height lookup
                                            // (rocks vary per-rock, lib/game/cover.ts:786) --
                                            // visual-fidelity cut, flag for a screenshot check
export const ROCK_CLIMB_DETECT_MUL = 1.6;  // placeholder exposure multiplier while mounted

/** true from the frame mounting happens until the countdown reaches 0. Same shape as
 * isCaveImmune()/isVeilOverloadActive() (lib/game/cave.ts, lib/game/veilOverload.ts). */
export function isRockClimbActive(rockClimbT: number): boolean {
  return rockClimbT > 0;
}

/** Gate for the KeyC / touch-climb trigger: not already hidden, not already mounted,
 * a rock is in range. Mutually exclusive with hiding by construction (mirrors
 * canGrabThrowable's shape, lib/game/outcome.ts:89). */
export function canMountRock(hidden: boolean, mountedOnRock: boolean, distToRock: number, radius: number): boolean {
  return !hidden && !mountedOnRock && distToRock < radius;
}

/** Multiplicative exposure add-on to the effectiveDetect()/canSee() chain -- sight only,
 * same shape as veilDetectMul()/fogTideDetectMul()/timeOfRunDetectMul(). */
export function rockClimbDetectMul(mountedOnRock: boolean): number {
  return mountedOnRock ? ROCK_CLIMB_DETECT_MUL : 1;
}
