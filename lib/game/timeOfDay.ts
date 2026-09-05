// LUL-1644: real-world time-of-day -> in-game sky/lighting/audio state. Pure
// data + a pure hour->state function, no wall-clock read in this file (the
// engine reads new Date().getHours() at its own single call site so this
// module stays trivially unit-testable, same split as veil.ts/fogTide.ts).
//
// Snapshot, not a live clock: computed once per session at engine init (see
// engine/forest-engine.js), not re-evaluated during play. Sessions run
// minutes, not hours, so a mid-session transition would never actually be
// seen -- see docs/specs/time-of-day.md for the full reasoning.

export type TimeOfDayState =
  | 'night'
  | 'early-morning'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening';

interface Boundary { state: TimeOfDayState; startHour: number; }

// Ascending startHour; the LAST boundary whose startHour <= hour wins, so
// 'night' (startHour 0) is the fallback for the pre-dawn tail (0-3) and is
// re-entered at 20 for the post-dusk half of the day -- one state, two
// disjoint hour ranges, which is why it appears twice here.
const BOUNDARIES: Boundary[] = [
  { state: 'night', startHour: 0 },
  { state: 'early-morning', startHour: 4 },
  { state: 'morning', startHour: 6 },
  { state: 'noon', startHour: 11 },
  { state: 'afternoon', startHour: 14 },
  { state: 'evening', startHour: 17 },
  { state: 'night', startHour: 20 },
];

/** `hour` is 0-23 (or any real number; fractional/out-of-range values wrap). */
export function timeOfDayFromHour(hour: number): TimeOfDayState {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  let result: TimeOfDayState = 'night';
  for (const b of BOUNDARIES) if (h >= b.startHour) result = b.state;
  return result;
}

export interface TimeOfDaySkyConfig {
  /** 3-stop vertical gradient, top/mid/bottom, CSS hex strings (canvas 2D fillStyle). */
  skyTop: string; skyMid: string; skyBottom: string;
  fogColor: number;             // THREE.Color hex, scene.fog
  hemisphereSky: number; hemisphereGround: number; hemisphereIntensity: number;
  rimColor: number; rimIntensity: number;
  sunMoonColor: number;         // DirectionalLight + disc core color
  sunMoonHaloColor: number;     // disc halo (outer additive circle) color
  sunMoonIntensity: number;     // DirectionalLight intensity (pre LEGACY_LIGHT_SCALE)
  sunMoonHaloOpacity: number;   // halo circle material.opacity -- bigger/brighter reads as "sun" vs "moon"
  starOpacity: number;          // stars Points material.opacity, 0 in full daylight
}

export const TIME_OF_DAY_VISUALS: Record<TimeOfDayState, TimeOfDaySkyConfig> = {
  night: {
    skyTop: '#05070d', skyMid: '#080e18', skyBottom: '#0b1220',
    fogColor: 0x0b1220,
    hemisphereSky: 0x8fa8c8, hemisphereGround: 0x0a0d12, hemisphereIntensity: 0.55,
    rimColor: 0x24344f, rimIntensity: 0.4,
    sunMoonColor: 0xbcd0ff, sunMoonHaloColor: 0x9fb6ff, sunMoonIntensity: 0.5,
    sunMoonHaloOpacity: 0.30, starOpacity: 0.85,
  },
  'early-morning': {
    skyTop: '#0d1526', skyMid: '#3a2f42', skyBottom: '#c98a6b',
    fogColor: 0x2a2436,
    hemisphereSky: 0xffb37a, hemisphereGround: 0x1a1220, hemisphereIntensity: 0.5,
    rimColor: 0x5a3a2a, rimIntensity: 0.3,
    sunMoonColor: 0xffd9a0, sunMoonHaloColor: 0xffb066, sunMoonIntensity: 0.55,
    sunMoonHaloOpacity: 0.40, starOpacity: 0.25,
  },
  morning: {
    skyTop: '#3a6ea8', skyMid: '#a9c9e8', skyBottom: '#eef1d8',
    fogColor: 0xcdd7e0,
    hemisphereSky: 0xbcd4ff, hemisphereGround: 0x3a4a30, hemisphereIntensity: 0.85,
    rimColor: 0x7a8fae, rimIntensity: 0.35,
    sunMoonColor: 0xfff2c0, sunMoonHaloColor: 0xffe28a, sunMoonIntensity: 0.9,
    sunMoonHaloOpacity: 0.45, starOpacity: 0,
  },
  noon: {
    skyTop: '#2f6fd6', skyMid: '#7fb0f0', skyBottom: '#dff0ff',
    fogColor: 0xdfeaf5,
    hemisphereSky: 0xd8ecff, hemisphereGround: 0x445533, hemisphereIntensity: 1.0,
    rimColor: 0x9fc0e0, rimIntensity: 0.3,
    sunMoonColor: 0xffffff, sunMoonHaloColor: 0xfff6d8, sunMoonIntensity: 1.1,
    sunMoonHaloOpacity: 0.50, starOpacity: 0,
  },
  afternoon: {
    skyTop: '#3f6fae', skyMid: '#a9c3d8', skyBottom: '#f2d9a0',
    fogColor: 0xe8dcc0,
    hemisphereSky: 0xffe0b0, hemisphereGround: 0x3a3020, hemisphereIntensity: 0.85,
    rimColor: 0x8a6a44, rimIntensity: 0.35,
    sunMoonColor: 0xffdca0, sunMoonHaloColor: 0xffb060, sunMoonIntensity: 0.85,
    sunMoonHaloOpacity: 0.45, starOpacity: 0,
  },
  evening: {
    skyTop: '#182140', skyMid: '#5a3a52', skyBottom: '#e8815a',
    fogColor: 0x3a2a3a,
    hemisphereSky: 0xff9a6a, hemisphereGround: 0x140f1e, hemisphereIntensity: 0.6,
    rimColor: 0x4a2a3a, rimIntensity: 0.3,
    sunMoonColor: 0xffb37a, sunMoonHaloColor: 0xff7a4a, sunMoonIntensity: 0.6,
    sunMoonHaloOpacity: 0.40, starOpacity: 0.15,
  },
};

export interface TimeOfDayAudioConfig {
  windGainMul: number;     // multiplies startAudio()'s wind-bed gain (wg, base 0.06)
  droneGainMul: number;    // multiplies startAudio()'s ominous-drone gain (dg, base 0.05)
  birdsGain: number;       // 0 = no bird-chirp layer; else target chirp burst gain
  birdsChirpHz: number;    // average chirps/second when birdsGain > 0
  insectsGain: number;     // cicada/cricket bed gain, 0 = no layer
}

// night: every multiplier is 1 and every new-layer gain is 0 -- this state must
// be bit-for-bit identical to today's audio (the game's default/majority mood),
// zero regression risk for the common case.
export const TIME_OF_DAY_AUDIO: Record<TimeOfDayState, TimeOfDayAudioConfig> = {
  night:           { windGainMul: 1.0, droneGainMul: 1.0, birdsGain: 0,     birdsChirpHz: 0,    insectsGain: 0 },
  'early-morning': { windGainMul: 0.8, droneGainMul: 0.3,  birdsGain: 0.05, birdsChirpHz: 0.8,  insectsGain: 0.01 },
  morning:         { windGainMul: 0.7, droneGainMul: 0.15, birdsGain: 0.04, birdsChirpHz: 0.5,  insectsGain: 0.02 },
  noon:            { windGainMul: 0.6, droneGainMul: 0.08, birdsGain: 0.015,birdsChirpHz: 0.15, insectsGain: 0.03 },
  afternoon:       { windGainMul: 0.7, droneGainMul: 0.12, birdsGain: 0.02, birdsChirpHz: 0.25, insectsGain: 0.03 },
  evening:         { windGainMul: 0.9, droneGainMul: 0.5,  birdsGain: 0.015,birdsChirpHz: 0.15, insectsGain: 0.025 },
};
