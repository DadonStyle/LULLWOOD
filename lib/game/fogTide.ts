// LUL-27: Fog Tide -- the first event built on eventScheduler.ts's generic
// cycle. Spec (ticket LUL-27): a ~90s recurring cycle, predator detect radii
// drop ~35%, ambient audio falls to a low drone, the child's glow carries
// further, signposted ~10s ahead (the drone starts first) so waiting for the
// tide is a decision, not a surprise.
//
// Genre research (LUL-215, one search): Don't Starve's day/dusk/night cycle
// telegraphs its dangerous phase with a distinct warning phase (dusk) before
// the state actually changes, rather than an instant day->night cut. The
// idea taken from that: the same three-phase shape (calm/signpost/active,
// via eventCyclePhase below) so the tide's *transition* is itself legible
// feedback, not just a switch that flips.
//
// Deliberately NOT seeded, unlike the map (see resolveInitialSeed(),
// LUL-83): a fixed-period cycle keyed off the game clock is already fully
// deterministic run-to-run with no RNG draw at all -- the same input
// timeline always produces the same cycle position. Adding a seed-derived
// phase offset here would be a second seed source for no reproducibility
// gain. Declared explicitly (wiki game/lul27-fog-tide) as a deliberate
// divergence from a literal reading of the dispatch comment's "seeded off
// the same seed path as the map," not an oversight.

import {
  eventCyclePhase,
  eventCycleBuildAmount,
  eventCycleActiveTarget,
  type EventCycleConfig,
  type EventCyclePhase,
} from './eventScheduler.ts';

export const FOG_TIDE_CONFIG: EventCycleConfig = {
  period: 90,
  activeDuration: 20,
  leadIn: 10,
};

// World-effect ease rates -- separate from the raw 0..1 build signal above,
// same "reacts fast / billows in behind it" split LUL-382's VEIL_RAMP
// already established for the veil (vignette ~0.5s, mist VEIL_RAMP 1.6s).
export const FOG_TIDE_RAMP = 4; // seconds -- detect/glow/fog ease ("fog thickens", deliberately slow)
export const FOG_TIDE_AUDIO_RAMP = 2; // seconds -- drone/wind ease, faster so the telegraph feels responsive

export const FOG_TIDE_DETECT_MUL = 0.65; // -35% detect radius at full tide
export const FOG_TIDE_GLOW_MUL = 1.5; // baby glow intensity multiplier at full tide
export const FOG_TIDE_GLOW_RANGE_MUL = 1.35; // baby light .distance multiplier -- "carries further" is range, not just brightness
export const FOG_TIDE_FOG_BOOST = 0.1; // additive scene.fog.density at full tide, layered on whatever base/veil density already set
export const FOG_TIDE_DRONE_GAIN_MUL = 1.6; // drone gain *= 1 + build * this, peaks at build === 1
export const FOG_TIDE_WIND_DUCK = 0.7; // wind gain cut at full tide -- ambient "falls to a low drone"

export function fogTidePhase(cycleT: number): EventCyclePhase {
  return eventCyclePhase(cycleT, FOG_TIDE_CONFIG);
}

export function fogTideBuildAmount(cycleT: number): number {
  return eventCycleBuildAmount(cycleT, FOG_TIDE_CONFIG);
}

export function fogTideActiveTarget(cycleT: number): 0 | 1 {
  return eventCycleActiveTarget(fogTidePhase(cycleT));
}

/** `tideAmount` is the caller's own eased 0..1 ramp toward fogTideActiveTarget (same relationship veilDetectMul has to veilAmount). */
export function fogTideDetectMul(tideAmount: number): number {
  return 1 - tideAmount * (1 - FOG_TIDE_DETECT_MUL);
}

export function fogTideGlowMul(tideAmount: number): number {
  return 1 + tideAmount * (FOG_TIDE_GLOW_MUL - 1);
}

export function fogTideGlowRangeMul(tideAmount: number): number {
  return 1 + tideAmount * (FOG_TIDE_GLOW_RANGE_MUL - 1);
}

export function fogTideFogBoost(tideAmount: number): number {
  return tideAmount * FOG_TIDE_FOG_BOOST;
}

/** `buildAmount` is the raw telegraph signal (eventCycleBuildAmount), eased by the caller for audio inertia. */
export function fogTideDroneGainMul(buildAmount: number): number {
  return 1 + buildAmount * FOG_TIDE_DRONE_GAIN_MUL;
}

export function fogTideWindGainMul(tideAmount: number): number {
  return 1 - tideAmount * FOG_TIDE_WIND_DUCK;
}
