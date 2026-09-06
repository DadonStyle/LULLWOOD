// LUL-1438 (rules LUL-1414 / wiki game/psychology/carry-detection-fairness):
// the child's glow is the only standing, always-readable statement of how
// conspicuous the player is. On the carry leg CARRY_DETECT_MUL (lib/game/cover.ts:418)
// raises predator sight-detect by 35% -- before this change every VISIBLE channel moved
// the other way at that exact frame (cinematic flared to 3.2, then carry settled to 1.2,
// barely above the 1.0 idle; the beacon wisps switched off). The rule went up while the
// light went down.
//
// Two invariants, both asserted in childGlow.test.ts. Do not change a constant here
// without re-reading them:
//   1. min(carry) >= max(pickup cinematic) >= max(idle)  -- the brightness never dips
//      across the pickup transition, and carry is permanently above idle.
//   2. CARRY_GLOW_FREQ != IDLE_GLOW_FREQ -- see the Fog Tide note below.
//
// Fog Tide note (wiki game/psychology/carry-detection-fairness section 10a): raw
// brightness is ALREADY a spoken channel in this game and it currently says "you are
// SAFE" -- fogTideGlowMul is 1.5 at exactly the moment fogTideDetectMul drops predator
// sight to 0.65. So the carry state cannot be distinguished by lumens alone. It is
// distinguished by PULSE RATE: the tide and the difficulty presets are multipliers, so
// they can make the child brighter but they can never make her pulse faster. The faster
// heartbeat is carry-only and unspoofable.

export const IDLE_GLOW_BASE = 1.0;
export const IDLE_GLOW_AMP = 0.25;
export const IDLE_GLOW_FREQ = 1.8;

export const CARRY_GLOW_BASE = 2.6;
export const CARRY_GLOW_AMP = 0.5;
export const CARRY_GLOW_FREQ = 3.2;

/** Where the ~2.5s pickup cinematic ends. Must equal CARRY_GLOW_BASE - CARRY_GLOW_AMP
 *  so the cinematic hands off to the carry pulse with no discontinuity. */
export const PICKUP_GLOW_PEAK = CARRY_GLOW_BASE - CARRY_GLOW_AMP;

export const IDLE_HALO_BASE = 0.11;
export const IDLE_HALO_AMP = 0.05;
export const CARRY_HALO_BASE = 0.34;
export const CARRY_HALO_AMP = 0.08;

/** Unscaled glow of the child lying on the ground, outbound. `t` is seconds. */
export function idleGlowIntensity(t: number): number {
  return IDLE_GLOW_BASE + Math.sin(t * IDLE_GLOW_FREQ) * IDLE_GLOW_AMP;
}

/** Unscaled glow of the child in the player's arms. Strictly above idleGlowIntensity()
 *  at every t, and faster. */
export function carryGlowIntensity(t: number): number {
  return CARRY_GLOW_BASE + Math.sin(t * CARRY_GLOW_FREQ) * CARRY_GLOW_AMP;
}

export function idleHaloOpacity(t: number): number {
  return IDLE_HALO_BASE + Math.sin(t * IDLE_GLOW_FREQ) * IDLE_HALO_AMP;
}

export function carryHaloOpacity(t: number): number {
  return CARRY_HALO_BASE + Math.sin(t * CARRY_GLOW_FREQ) * CARRY_HALO_AMP;
}
