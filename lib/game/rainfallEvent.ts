// LUL-5698 Rainfall Event -- cheap slice. Whole-map ambient event built on
// eventScheduler.ts's generic cycle, same shape as lib/game/fogTide.ts.
// No site-local scoping here (RAINFALL_SITES deferred to Full Feature).

import {
  eventCyclePhase,
  eventCycleBuildAmount,
  eventCycleActiveTarget,
  type EventCycleConfig,
  type EventCyclePhase,
} from './eventScheduler.ts';

export const RAINFALL_CONFIG: EventCycleConfig = {
  period: 80,
  activeDuration: 20,
  leadIn: 10,
};

export const RAINFALL_NOISE_MUL = 0.65; // -35% footstep/breathing noise radius at full rain, same magnitude as Fog Tide's FOG_TIDE_DETECT_MUL (lib/game/fogTide.ts:62)
export const RAINFALL_RAMP = 4;        // seconds -- world-effect ease, same rate as FOG_TIDE_RAMP (lib/game/fogTide.ts:65)
export const RAINFALL_AUDIO_RAMP = 2;  // seconds -- audio telegraph ease, same rate as FOG_TIDE_AUDIO_RAMP (lib/game/fogTide.ts:66)
export const RAINFALL_FOG_BOOST = 0.08; // additive scene.fog.density at full rain -- slightly less than FOG_TIDE_FOG_BOOST (0.1, lib/game/fogTide.ts:69) since rain's primary tell is audio/noise-radius, not visual

export function rainfallPhase(cycleT: number): EventCyclePhase {
  return eventCyclePhase(cycleT, RAINFALL_CONFIG);
}

export function rainfallBuildAmount(cycleT: number): number {
  return eventCycleBuildAmount(cycleT, RAINFALL_CONFIG);
}

export function rainfallActiveTarget(cycleT: number): 0 | 1 {
  return eventCycleActiveTarget(rainfallPhase(cycleT));
}

/** `rainAmount` is the caller's own eased 0..1 ramp toward the active target
 * (same relationship fogTideDetectMul has to tideAmount, lib/game/fogTide.ts:72-74). */
export function rainfallNoiseScalar(rainAmount: number): number {
  return 1 - rainAmount * (1 - RAINFALL_NOISE_MUL);
}

export function rainfallFogBoost(rainAmount: number): number {
  return rainAmount * RAINFALL_FOG_BOOST;
}
