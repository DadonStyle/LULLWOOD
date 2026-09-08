// LUL-25: pure helpers for the Bog biome -- how boggy a point is, what that
// costs to walk through, and where the child spawns when blackout mode wants
// it hidden in the deepest patch. No Three.js, no DOM (see wiki
// systems/unit-testing-standard). The engine owns the world-space constants
// (half, landmark positions) and calls these back in, same split as
// lib/game/scent.ts and lib/game/charge.ts.
//
// LUL-1902: the bog was a biome scattered by 2D noise over the whole square
// (~30-37% of the map, many separate patches) -- a mechanical side effect of
// squaring the world (LUL-1483), not a deliberate design call. Consolidated
// to one discoverable place: a single fixed center + radial falloff, same
// smoothstepped-edge softness as before so a patch edge still reads as
// terrain, not a wall.

export interface Point {
  x: number;
  z: number;
}

export interface Landmark extends Point {
  clear: number; // radius to keep clear of, in world units
}

// ---- Bog biome geometry ----------------------------------------------------
// Fixed geography, like CONFIG.lake/CONFIG.home/LANDMARKS -- a place you can
// actually learn, not something that reshuffles with the per-game rng seed.
//
// Numbers below were chosen by numeric search against three constraints that
// all had to hold simultaneously: both oak/drownedCar (engine/tuning.js
// LANDMARKS) land inside the zone without repositioning; fireTower/
// stoneMarker/radioMast/chapelSteeple stay outside it; and the zone reaches
// far enough from the origin that pickHardBabyPosition's existing
// biomeAt>0 && hypot>=BLACKOUT_MIN_RADIUS requirement stays satisfiable (it
// is NOT satisfiable at every center/radius pair -- verify BLACKOUT_MIN_RADIUS
// reachability before changing these). Do not "clean up" these values without
// re-running that check.
export const BOG_CENTER: Point = { x: -70, z: 44 };
export const BOG_INNER_RADIUS = 35; // full bogginess (1.0) inside this distance from BOG_CENTER
export const BOG_OUTER_RADIUS = 135; // bogginess reaches 0 at this distance; smoothstep between inner and outer

// Home/spawn (CONFIG.home = {x:0,z:0}; generateMap() also sets player.x =
// player.z = 0) must never be boggy. Fully dry inside HOME_CLEAR_RADIUS,
// blends up to the unmodified bog value by HOME_FADE_RADIUS. If CONFIG.home
// ever moves off the origin, this must move with it.
const HOME_CLEAR_RADIUS = 8;
const HOME_FADE_RADIUS = 16;

// LUL-1902: BOG_CENTER/BOG_OUTER_RADIUS put CONFIG.lake (engine/tuning.js,
// {x:34,z:-28}) ~119 units from BOG_CENTER -- inside BOG_OUTER_RADIUS, so
// without this carve-out the lake would go from always-dry to measurably
// boggy, breaking the existing invariant nothing in this ticket's decision
// asked to change. Mirrors HOME_* exactly, keyed off the lake's own
// position. If CONFIG.lake ever moves, this must move with it.
const LAKE_CENTER: Point = { x: 34, z: -28 };
const LAKE_CLEAR_RADIUS = 20;
const LAKE_FADE_RADIUS = 32;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Shared by both carve-outs above: 1 (no effect) past `fadeR`, 0 (fully
// cleared) inside `clearR`, smoothstepped between -- same shape either one
// used inline before this ticket.
function radialFade(x: number, z: number, center: Point, clearR: number, fadeR: number): number {
  const dist = Math.hypot(x - center.x, z - center.z);
  if (dist >= fadeR) return 1;
  if (dist <= clearR) return 0;
  return smoothstep((dist - clearR) / (fadeR - clearR));
}

/**
 * Bogginess at a world point, 0 (dry) to 1 (deepest bog) -- continuous, not
 * boolean, so the movement/noise multipliers below ease in across a patch
 * edge instead of stepping. Deterministic and pure: same (x, z) always
 * returns the same value, no rng, no dependency on the per-game seed.
 */
export function biomeAt(x: number, z: number): number {
  const dist = Math.hypot(x - BOG_CENTER.x, z - BOG_CENTER.z);
  const t = (BOG_OUTER_RADIUS - dist) / (BOG_OUTER_RADIUS - BOG_INNER_RADIUS);
  const raw = t <= 0 ? 0 : t >= 1 ? 1 : smoothstep(t);
  const homeFade = radialFade(x, z, { x: 0, z: 0 }, HOME_CLEAR_RADIUS, HOME_FADE_RADIUS);
  const lakeFade = radialFade(x, z, LAKE_CENTER, LAKE_CLEAR_RADIUS, LAKE_FADE_RADIUS);
  return raw * homeFade * lakeFade;
}

// LUL-1902: how long the wolf-scent-mask (see checkScent() in the engine)
// takes to fade to 0 after the player leaves the bog. Not an instant on/off
// at the patch edge -- decision doc calls for "decaying over a short window
// after leaving."
export const BOG_MASK_DECAY_TIME = 6; // seconds

/** Rises instantly to `currentBogginess` when it's higher than `prevMask`
 * (no lag entering the bog), decays linearly to 0 over `decayTime` seconds
 * once the player leaves (currentBogginess drops below prevMask). Pure,
 * called once per frame by the engine with its own persisted `prevMask`. */
export function bogMaskLevel(
  currentBogginess: number,
  prevMask: number,
  dt: number,
  decayTime: number = BOG_MASK_DECAY_TIME,
): number {
  if (currentBogginess >= prevMask) return currentBogginess;
  return Math.max(currentBogginess, prevMask - dt / decayTime);
}

export const BLACKOUT_MIN_RADIUS = 192; // lantern's spawn annulus tops out at half*0.8=192u at half=240 -- floor blackout at exactly that so it never spawns closer than lantern's hardest draw

export const BOG_SPEED_MULTIPLIER = 0.5; // "shallow water at half walk speed", at bogginess 1.0
export const BOG_NOISE_MULTIPLIER = 1.6; // splashing carries further than dry footsteps, at bogginess 1.0

// Linear in bogginess, deliberately not eased: bogValueNoise() already runs
// its lattice through smoothstep() once, so a patch edge is already
// spatially smooth in *where* the multiplier changes. Easing the *response
// curve* on top would compound that softening and decouple "how far into the
// patch you are" from "how much it costs" -- the one thing a player learns to
// read while crossing one. Endpoints unchanged from the old boolean version:
// 1 at bogginess 0, today's exact 0.5x/1.6x at bogginess 1.
export function bogSpeedMultiplier(bogginess: number): number {
  return 1 - bogginess * (1 - BOG_SPEED_MULTIPLIER);
}

export function bogNoiseMultiplier(bogginess: number): number {
  return 1 + bogginess * (BOG_NOISE_MULTIPLIER - 1);
}

export function clearOfLandmarks(x: number, z: number, landmarks: readonly Landmark[], pad: number): boolean {
  return landmarks.every((l) => Math.hypot(x - l.x, z - l.z) >= l.clear + pad);
}

/**
 * Draws a point from `rng` ((0,1) or [0,1), caller's own generator) inside a
 * bog patch (biomeAt > 0), at least `margin` units in from the map edge on
 * both axes, clear of every landmark by `pad`. Bounded by `maxTries` so a
 * seed/landmark layout that happens to leave no clear boggy point can't spin
 * forever -- returns its last candidate rather than looping, same contract
 * as before this ticket (a candidate close to a landmark, or on drier ground
 * than intended, is a cosmetic risk for blackout's spawn, not a correctness
 * one).
 */
export function pickHardBabyPosition(
  rng: () => number,
  half: number,
  landmarks: readonly Landmark[],
  pad = 6,
  margin = 20,
  maxTries = 200,
): Point {
  const lo = -Math.max(0, half - margin);
  const hi = Math.max(0, half - margin);
  let x = 0;
  let z = 0;
  for (let i = 0; i < maxTries; i++) {
    x = lo + rng() * (hi - lo);
    z = lo + rng() * (hi - lo);
    if (Math.hypot(x, z) >= BLACKOUT_MIN_RADIUS && biomeAt(x, z) > 0 && clearOfLandmarks(x, z, landmarks, pad)) return { x, z };
  }
  return { x, z };
}
