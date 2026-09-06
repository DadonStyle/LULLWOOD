// LUL-25: pure helpers for the Bog biome -- how boggy a point is, what that
// costs to walk through, and where the child spawns when blackout mode wants
// it hidden in the deepest patch. No Three.js, no DOM (see wiki
// systems/unit-testing-standard). The engine owns the world-space constants
// (half, landmark positions) and calls these back in, same split as
// lib/game/scent.ts and lib/game/charge.ts.
//
// LUL-1483: the world used to be a rectangle (x in [-half,half], z in
// [-half, half+bogDepth]) with the bog a strip past the forest's +z edge --
// isInBog(z, bounds) tested z alone. Re-centring z to match x makes "the far
// strip of +z" meaningless on a square, so the bog is now a biome distributed
// by 2D noise over the whole square instead of a directional band. biomeAt()
// replaces isInBog(): same role (what does this patch of ground cost to
// cross), continuous instead of boolean so a patch edge feels like terrain,
// not a wall the player's speed instantly steps through.

export interface Point {
  x: number;
  z: number;
}

export interface Landmark extends Point {
  clear: number; // radius to keep clear of, in world units
}

// ---- Bog biome noise -------------------------------------------------------
// Fixed geography, like CONFIG.lake/CONFIG.home/LANDMARKS -- a place you can
// actually learn, not something that reshuffles with the per-game rng seed
// (mulberry32(CONFIG.seed) in the engine, resolveInitialSeed()/generateMap()).
// BOG_NOISE_SEED is its own constant, untouched by either: every player's bog
// patches sit in the same places: only the trees/predators/cover scattered
// around them vary per seed.
const BOG_NOISE_SEED = 20260906;
// World units per noise lattice cell -- big enough that a patch reads as a
// biome you walk across for several seconds, not a speckle underfoot.
const BOG_NOISE_CELL = 48;
// Raw noise below this reads as dry land (bogginess 0). ~30% of the 240x240
// square is boggy at this cutoff (checked by direct sampling of the formula
// below at 2-unit resolution) -- a substantial biome, not a rare pocket.
const BOG_THRESHOLD = 0.55;
// Home/spawn (CONFIG.home = {x:0,z:0}; generateMap() also sets player.x =
// player.z = 0) must never be boggy -- see this spec's "design gap" note.
// Fully dry inside HOME_CLEAR_RADIUS, blends up to the unmodified noise value
// by HOME_FADE_RADIUS. If CONFIG.home ever moves off the origin, this must
// move with it.
const HOME_CLEAR_RADIUS = 8;
const HOME_FADE_RADIUS = 16;

// Deterministic hash of an integer lattice point -> [0, 1). Integer-only
// multiply/xor/shift, same shape as the engine's own mulberry32 (LUL-153) --
// no floating point drift, same output on every platform.
function bogLatticeHash(ix: number, iz: number): number {
  let h =
    (Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(BOG_NOISE_SEED, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Bilinear-interpolated value noise: smooth, O(1) per call (four hash
// lookups + two lerps), no precomputed grid/array -- cheap enough to call
// once per predator per frame (updatePredators()) as well as at map-gen time.
function bogValueNoise(x: number, z: number): number {
  const gx = x / BOG_NOISE_CELL, gz = z / BOG_NOISE_CELL;
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = smoothstep(gx - ix), fz = smoothstep(gz - iz);
  const h00 = bogLatticeHash(ix, iz);
  const h10 = bogLatticeHash(ix + 1, iz);
  const h01 = bogLatticeHash(ix, iz + 1);
  const h11 = bogLatticeHash(ix + 1, iz + 1);
  const a = h00 + (h10 - h00) * fx;
  const b = h01 + (h11 - h01) * fx;
  return a + (b - a) * fz;
}

/**
 * Replaces isInBog(z, bounds) (LUL-1483). Bogginess at a world point, 0
 * (dry) to 1 (deepest bog) -- continuous, not boolean, so the movement/noise
 * multipliers below ease in across a patch edge instead of stepping. Takes
 * `x` (isInBog never did) because a patch is a 2D region, not a z-band.
 * Deterministic and pure: same (x, z) always returns the same value, no rng,
 * no dependency on the per-game seed.
 */
export function biomeAt(x: number, z: number): number {
  const n = bogValueNoise(x, z);
  const t = (n - BOG_THRESHOLD) / (1 - BOG_THRESHOLD);
  const raw = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const distFromHome = Math.hypot(x, z);
  if (distFromHome >= HOME_FADE_RADIUS) return raw;
  const fade =
    distFromHome <= HOME_CLEAR_RADIUS
      ? 0
      : smoothstep((distFromHome - HOME_CLEAR_RADIUS) / (HOME_FADE_RADIUS - HOME_CLEAR_RADIUS));
  return raw * fade;
}

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
    if (biomeAt(x, z) > 0 && clearOfLandmarks(x, z, landmarks, pad)) return { x, z };
  }
  return { x, z };
}
