// LUL-1438 (rules LUL-1414 / wiki game/psychology/carry-detection-fairness):
// the child's glow is the only standing, always-readable statement of how
// conspicuous the player is while she's lying on the ground, outbound.

export const IDLE_GLOW_BASE = 1.0;
export const IDLE_GLOW_AMP = 0.25;
export const IDLE_GLOW_FREQ = 1.8;

export const IDLE_HALO_BASE = 0.11;
export const IDLE_HALO_AMP = 0.05;

/** Unscaled glow of the child lying on the ground, outbound. `t` is seconds. */
export function idleGlowIntensity(t: number): number {
  return IDLE_GLOW_BASE + Math.sin(t * IDLE_GLOW_FREQ) * IDLE_GLOW_AMP;
}

export function idleHaloOpacity(t: number): number {
  return IDLE_HALO_BASE + Math.sin(t * IDLE_GLOW_FREQ) * IDLE_HALO_AMP;
}
