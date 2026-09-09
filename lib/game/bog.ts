// LUL-25: pure helpers for the Bog biome -- how boggy a point is, what that
// costs to walk through, and where the child spawns when blackout mode wants
// it hidden beyond the deepest patch. No Three.js, no DOM (see wiki
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
//
// LUL-2225: LUL-1902's consolidated patch was still ~24.9% of the map and
// deliberately blended landmarks (oak, drownedCar) inside it -- the founder's
// review of what shipped (LUL-2084) rejected both: the patch must be ONE
// small area (2-5% of the map) with nothing else spawning inside it. Shrunk
// the radii and moved the center so no fixed object needs to move. See
// docs/specs/lul-2225-small-bog.md.

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
// LUL-2225: numbers below were chosen by numeric search against constraints
// that all had to hold simultaneously: BOG_OUTER_RADIUS + a landmark's own
// `clear` stays strictly less than that landmark's distance from BOG_CENTER,
// for every entry in LANDMARKS, CAVE and ROOSTS (engine/tuning.js) -- nothing
// else may spawn inside the patch; the area (pi*outer^2/mapSize^2) lands in
// [2%, 5%]; and pickHardBabyPosition's predicate (below) stays satisfiable
// without falling back. Do not "clean up" these values without re-running
// that check -- see docs/specs/lul-2225-small-bog.md for the verification.
export const BOG_CENTER: Point = { x: -40, z: 80 };
export const BOG_INNER_RADIUS = 25; // full bogginess (1.0) inside this distance from BOG_CENTER
export const BOG_OUTER_RADIUS = 45; // bogginess reaches 0 at this distance; smoothstep between inner and outer

// Home/spawn (CONFIG.home = {x:0,z:0}; generateMap() also sets player.x =
// player.z = 0) must never be boggy. Fully dry inside HOME_CLEAR_RADIUS,
// blends up to the unmodified bog value by HOME_FADE_RADIUS. If CONFIG.home
// ever moves off the origin, this must move with it. Kept even though the
// LUL-2225 center is 89 units from home (well outside the patch) so a future
// center move can't silently reintroduce boggy ground at spawn.
const HOME_CLEAR_RADIUS = 8;
const HOME_FADE_RADIUS = 16;

// LUL-2225: CONFIG.lake (engine/tuning.js, {x:34,z:-28}) is 131 units from
// the new BOG_CENTER -- outside BOG_OUTER_RADIUS entirely, so the LUL-1902
// carve-out that kept the lake dry is now unreachable dead code and was
// removed. biomeAt(34,-28) === 0 falls out of the radius check alone; a unit
// test still asserts it so a future center move can't silently re-flood it.

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Shared by the HOME carve-out above: 1 (no effect) past `fadeR`, 0 (fully
// cleared) inside `clearR`, smoothstepped between -- same shape used inline
// before this ticket.
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
  return raw * homeFade;
}

/**
 * LUL-2225: true if (x, z) is inside the bog patch plus `pad` units of
 * clearance -- the keep-clear test every other spawn system (landmarks,
 * cave, roosts, cover props, throwables, dense forest) must pass so nothing
 * else spawns inside or right at the edge of the patch. Pure radius test on
 * BOG_OUTER_RADIUS, not on biomeAt, so a `pad` of 0 still excludes the exact
 * boundary where bogginess is already 0.
 */
export function bogKeepClear(x: number, z: number, pad: number): boolean {
  return Math.hypot(x - BOG_CENTER.x, z - BOG_CENTER.z) < BOG_OUTER_RADIUS + pad;
}

/**
 * LUL-2225: true if the straight line from (ax,az) to (bx,bz) passes through
 * the bog's full-bogginess core (within BOG_INNER_RADIUS of BOG_CENTER).
 * Used by the blackout hard-spawn predicate below to mean "beyond the bog"
 * the way the engine's own intent comment (forest-engine.js, blackout ->
 * hard spawn) describes it: the direct route home has to cross the patch,
 * not merely land near it.
 */
export function routeCrossesBog(ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((BOG_CENTER.x - ax) * dx + (BOG_CENTER.z - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx;
  const pz = az + t * dz;
  return Math.hypot(BOG_CENTER.x - px, BOG_CENTER.z - pz) <= BOG_INNER_RADIUS;
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
 * LUL-2225: draws a point from `rng` ((0,1) or [0,1), caller's own
 * generator) at least BLACKOUT_MIN_RADIUS from home AND on the far side of
 * the bog's full-bogginess core from home (routeCrossesBog), at least
 * `margin` units in from the map edge on both axes, clear of every landmark
 * by `pad`. The old predicate additionally required `biomeAt(x,z) > 0`,
 * i.e. the child itself standing in the bog -- unsatisfiable once the patch
 * shrank (the farthest any bog point can be from home is far short of
 * BLACKOUT_MIN_RADIUS), which is exactly the silent-fallback failure this
 * ticket exists to fix. "Beyond the bog" now means the direct route home
 * has to cross the patch, not that the child stands in it.
 *
 * Bounded by `maxTries` so a seed/landmark layout that happens to leave no
 * candidate can't spin forever -- returns its last candidate rather than
 * looping. lib/game/bog.test.ts asserts this fallback is never actually hit
 * over >= 200 seeds at the current geometry.
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
    if (
      Math.hypot(x, z) >= BLACKOUT_MIN_RADIUS &&
      routeCrossesBog(0, 0, x, z) &&
      clearOfLandmarks(x, z, landmarks, pad)
    )
      return { x, z };
  }
  return { x, z };
}
