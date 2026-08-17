import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampDt,
  DT_CLAMP_CEILING,
  driftedScentPosition,
  isScentDetected,
  isScentExpired,
  isScentPastPruneCutoff,
  scentDriftDistance,
  scentPickupRadius,
  SCENT_LIFETIME,
  WIND_DRIFT_CAP,
  WIND_STRENGTH,
  type ScentPoint,
} from './scent.ts';

// ---- clampDt ---------------------------------------------------------------

test('clampDt passes a normal frame time through unchanged', () => {
  assert.equal(clampDt(0.016), 0.016);
});

test('clampDt caps a spike well past the ceiling (tab-out / GC pause)', () => {
  assert.equal(clampDt(2.5), DT_CLAMP_CEILING);
});

test('clampDt is a no-op right at the ceiling', () => {
  assert.equal(clampDt(DT_CLAMP_CEILING), DT_CLAMP_CEILING);
});

test('clampDt(0) stays 0, not the ceiling', () => {
  assert.equal(clampDt(0), 0);
});

// ---- expiry / prune boundary ------------------------------------------------

test('isScentExpired is false just under the lifetime, true exactly at it', () => {
  assert.equal(isScentExpired(SCENT_LIFETIME - 0.001), false);
  assert.equal(isScentExpired(SCENT_LIFETIME), true);
});

test('isScentExpired is true past the lifetime', () => {
  assert.equal(isScentExpired(SCENT_LIFETIME + 5), true);
});

test('isScentPastPruneCutoff is strictly greater-than, so age === lifetime is expired but not yet pruned', () => {
  assert.equal(isScentExpired(SCENT_LIFETIME), true);
  assert.equal(isScentPastPruneCutoff(SCENT_LIFETIME), false);
  assert.equal(isScentPastPruneCutoff(SCENT_LIFETIME + 0.001), true);
});

test('negative age (clock skew / out-of-range) is neither expired nor prune-eligible', () => {
  assert.equal(isScentExpired(-1), false);
  assert.equal(isScentPastPruneCutoff(-1), false);
});

// ---- wind drift --------------------------------------------------------------

test('scentDriftDistance grows linearly with age below the cap', () => {
  assert.equal(scentDriftDistance(1), WIND_STRENGTH);
  assert.equal(scentDriftDistance(2), WIND_STRENGTH * 2);
});

test('scentDriftDistance is capped for an old point', () => {
  const age = (WIND_DRIFT_CAP / WIND_STRENGTH) * 10; // far past the cap
  assert.equal(scentDriftDistance(age), WIND_DRIFT_CAP);
});

test('scentDriftDistance is 0 at age 0', () => {
  assert.equal(scentDriftDistance(0), 0);
});

test('driftedScentPosition with zero wind leaves the point in place', () => {
  const point = { x: 10, z: -5 };
  const drifted = driftedScentPosition(point, 4, 0, 0);
  assert.deepEqual(drifted, { x: 10, z: -5 });
});

test('driftedScentPosition moves along the wind vector by the drift distance', () => {
  const point = { x: 0, z: 0 };
  const drifted = driftedScentPosition(point, 1, 1, 0);
  assert.equal(drifted.x, WIND_STRENGTH);
  assert.equal(drifted.z, 0);
});

// ---- pickup radius -------------------------------------------------------------

test('scentPickupRadius is the full base radius at age 0', () => {
  assert.equal(scentPickupRadius(2.2, 0, SCENT_LIFETIME, 1), 2.2);
});

test('scentPickupRadius decays to 0 exactly at the lifetime', () => {
  assert.equal(scentPickupRadius(2.2, SCENT_LIFETIME, SCENT_LIFETIME, 1), 0);
});

test('scentPickupRadius scales with the nose multiplier', () => {
  assert.equal(scentPickupRadius(2.2, 0, SCENT_LIFETIME, 1.4), 2.2 * 1.4);
});

// ---- isScentDetected (checkScent()'s per-point test) ---------------------------

function point(overrides: Partial<ScentPoint> = {}): ScentPoint {
  return { x: 0, z: 0, t0: 0, radius: 2.2, ...overrides };
}

test('isScentDetected is true for a query at the point exact position (zero distance), fresh, no wind', () => {
  assert.equal(isScentDetected(point(), 0, 0, 0, 0, 0, 1), true);
});

test('isScentDetected is false once the point has expired, even at zero distance', () => {
  assert.equal(isScentDetected(point(), SCENT_LIFETIME, 0, 0, 0, 0, 1), false);
});

test('isScentDetected is false just outside the shrunk radius near expiry', () => {
  // At age = lifetime - 0.001 the radius is a hair above 0; a query 1 unit
  // away is well outside it.
  assert.equal(isScentDetected(point(), SCENT_LIFETIME - 0.001, 1, 0, 0, 0, 1), false);
});

test('isScentDetected with zero wind: query must be within the undrifted radius', () => {
  assert.equal(isScentDetected(point(), 0, 2, 0, 0, 0, 1), true); // 2 < 2.2
  assert.equal(isScentDetected(point(), 0, 3, 0, 0, 0, 1), false); // 3 > 2.2
});

test('isScentDetected: wind exactly opposing the query direction moves the hot zone away', () => {
  // Point at origin, age 0.5 (radius shrinks to ~2.12, drift is 1.6). Query
  // sits 2 units downwind (+x) -- a hit under zero wind. Wind blowing in -x
  // (opposite the query) pushes the drifted center further away, turning
  // the same query into a miss.
  const age = 0.5;
  const withNoWind = isScentDetected(point(), age, 2, 0, 0, 0, 1);
  const withOpposingWind = isScentDetected(point(), age, 2, 0, -1, 0, 1);
  assert.equal(withNoWind, true);
  assert.equal(withOpposingWind, false);
});

test('isScentDetected: wind blowing toward the query can pick up a point the undrifted radius would miss', () => {
  const age = 0.5; // 1.6 units of drift toward the query
  const withNoWind = isScentDetected(point(), age, 3, 0, 0, 0, 1);
  const withHelpingWind = isScentDetected(point(), age, 3, 0, 1, 0, 1);
  assert.equal(withNoWind, false);
  assert.equal(withHelpingWind, true);
});

test('isScentDetected: negative age is treated as unexpired (not clamped away) and uses age as given', () => {
  // Negative age isn't produced by the engine, but the function must not
  // special-case it silently -- it should behave the same as any other
  // sub-lifetime age for the radius/drift math.
  assert.equal(isScentDetected(point(), -1, 0, 0, 0, 0, 1), true);
});

test('isScentDetected: out-of-range age far past lifetime is expired', () => {
  assert.equal(isScentDetected(point(), SCENT_LIFETIME * 100, 0, 0, 0, 0, 1), false);
});
