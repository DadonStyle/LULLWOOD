// LUL-279 (wave 1 of LUL-277): pure scent decay/wind/expiry math and the
// frame `dt` clamp, lifted out of engine/forest-engine.js so they can be
// unit tested without a Three.js scene or a running render loop (see wiki
// systems/unit-testing-standard). The engine (depositScent(), checkScent(),
// the qaSeedScentPoint/qaProbeScentOnOldest QA hooks, and the render loop's
// `dt` line) still owns all state -- the live `scentPoints` array, `player`,
// `clock` -- this module only owns the math: given an age/position/wind, is
// a point expired, where has it drifted to, and how big is its pickup
// radius. Time is always a parameter here, never a wall-clock read.

export interface ScentPoint {
  x: number;
  z: number;
  t0: number;
  radius: number;
}

// Named constants so tuning is a one-line change (decay rate and wind
// strength, per the ticket) -- values unchanged from forest-engine.js.
export const SCENT_DEPOSIT_INTERVAL = 0.3; // seconds between trail points while moving
export const SCENT_LIFETIME = 14; // seconds until a point is fully decayed -- the difficulty dial
export const SCENT_RADIUS_WALK = 2.2; // sniff-pickup radius (units), fresh, at a walking pace
export const SCENT_RADIUS_RUN = 3.6; // Shift leaves a louder trail -- the cost that finally balances it
export const WIND_STRENGTH = 3.2; // units/second a point's effective position drifts downwind
export const WIND_DRIFT_CAP = 9; // drift never carries a point more than this many units total
export const SCENT_TRACK_TIME = 8; // seconds a scent-triggered chase ignores the detect*1.5 leash

// The render loop's frame-time ceiling (wiki systems/dt-clamp-vs-walltime):
// stops a tab-out or GC pause from teleporting predators through walls.
export const DT_CLAMP_CEILING = 0.05;

/** Clamps a raw frame delta to the ceiling every timer in the game
 * accumulates against. `rawDt` is `clock.getDelta()` -- real elapsed
 * wall-clock seconds since the last frame, which this never reads itself. */
export function clampDt(rawDt: number, ceiling: number = DT_CLAMP_CEILING): number {
  return Math.min(rawDt, ceiling);
}

/** A point stops being detectable once its age reaches `lifetime` --
 * `checkScent()`'s per-point skip. Boundary is inclusive: age === lifetime
 * is already expired. */
export function isScentExpired(age: number, lifetime: number = SCENT_LIFETIME): boolean {
  return age >= lifetime;
}

/** `depositScent()`'s array-pruning cutoff is a *stricter* threshold than
 * `isScentExpired`: it only drops points once their age exceeds the
 * lifetime, not at the instant they reach it. That means for one instant
 * (age exactly `lifetime`) a point is already undetectable but not yet
 * pruned from the array -- preserved exactly from the original
 * `s.t0 < cutoff` comparison, not a bug to "fix" here. */
export function isScentPastPruneCutoff(age: number, lifetime: number = SCENT_LIFETIME): boolean {
  return age > lifetime;
}

/** How far downwind (units) a point's effective position has drifted at
 * `age` seconds old. Capped so an ancient point can't drift arbitrarily far. */
export function scentDriftDistance(
  age: number,
  windStrength: number = WIND_STRENGTH,
  driftCap: number = WIND_DRIFT_CAP,
): number {
  return Math.min(driftCap, windStrength * age);
}

/** A point's effective (drifted) position at `age` seconds old, given the
 * wind unit vector (`windX`, `windZ`). */
export function driftedScentPosition(
  point: Pick<ScentPoint, 'x' | 'z'>,
  age: number,
  windX: number,
  windZ: number,
): { x: number; z: number } {
  const drift = scentDriftDistance(age);
  return { x: point.x + windX * drift, z: point.z + windZ * drift };
}

/** A point's live pickup radius at `age` seconds old: shrinks linearly to 0
 * at `lifetime`, scaled by the sniffing predator's `noseMultiplier`
 * (`p.spec.nose` in the engine). */
export function scentPickupRadius(
  baseRadius: number,
  age: number,
  lifetime: number = SCENT_LIFETIME,
  noseMultiplier: number = 1,
): number {
  return baseRadius * (1 - age / lifetime) * noseMultiplier;
}

/** `checkScent()`'s per-point test: is `(queryX, queryZ)` inside this
 * point's live, wind-drifted pickup radius at `age` seconds old? Mirrors the
 * original `dx*dx + dz*dz < r*r` compare exactly, including that a query
 * sitting exactly on the drifted center (zero distance) is a hit whenever
 * the radius is still positive. */
export function isScentDetected(
  point: ScentPoint,
  age: number,
  queryX: number,
  queryZ: number,
  windX: number,
  windZ: number,
  noseMultiplier: number,
  lifetime: number = SCENT_LIFETIME,
): boolean {
  if (isScentExpired(age, lifetime)) return false;
  const { x: dx0, z: dz0 } = driftedScentPosition(point, age, windX, windZ);
  const dx = queryX - dx0;
  const dz = queryZ - dz0;
  const r = scentPickupRadius(point.radius, age, lifetime, noseMultiplier);
  return dx * dx + dz * dz < r * r;
}
