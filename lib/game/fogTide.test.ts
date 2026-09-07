import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOG_TIDE_CONFIG,
  FOG_TIDE_SITES,
  FOG_TIDE_DETECT_MUL,
  FOG_TIDE_GLOW_MUL,
  FOG_TIDE_GLOW_RANGE_MUL,
  FOG_TIDE_FOG_BOOST,
  FOG_TIDE_DRONE_GAIN_MUL,
  FOG_TIDE_WIND_DUCK,
  fogTidePhase,
  fogTideBuildAmount,
  fogTideActiveTarget,
  fogTideDetectMul,
  fogTideGlowMul,
  fogTideGlowRangeMul,
  fogTideFogBoost,
  fogTideDroneGainMul,
  fogTideWindGainMul,
  fogTideAmountAt,
  fogTideBuildAt,
} from './fogTide.ts';
import type { EventSite } from './eventSites.ts';

test('config matches the ticket spec: ~90s cycle, ~10s signpost lead', () => {
  assert.equal(FOG_TIDE_CONFIG.period, 90);
  assert.equal(FOG_TIDE_CONFIG.leadIn, 10);
});

test('phase/build/target delegate correctly at the signpost boundary', () => {
  const start = FOG_TIDE_CONFIG.period - FOG_TIDE_CONFIG.activeDuration;
  assert.equal(fogTidePhase(start - FOG_TIDE_CONFIG.leadIn - 1), 'calm');
  assert.equal(fogTidePhase(start - 1), 'signpost');
  assert.equal(fogTidePhase(start), 'active');
  assert.equal(fogTideBuildAmount(start - FOG_TIDE_CONFIG.leadIn), 0);
  assert.equal(fogTideBuildAmount(start), 1);
  assert.equal(fogTideActiveTarget(start - 1), 0);
  assert.equal(fogTideActiveTarget(start), 1);
});

test('detect multiplier is 1 (no cut) at tideAmount 0 and the -35% spec value at tideAmount 1', () => {
  assert.equal(fogTideDetectMul(0), 1);
  assert.ok(Math.abs(fogTideDetectMul(1) - FOG_TIDE_DETECT_MUL) < 1e-9);
  assert.ok(Math.abs(fogTideDetectMul(1) - 0.65) < 1e-9); // -35%
});

test('glow, glow-range and fog boost are identity at 0 and hit their spec constants at 1', () => {
  assert.equal(fogTideGlowMul(0), 1);
  assert.ok(Math.abs(fogTideGlowMul(1) - FOG_TIDE_GLOW_MUL) < 1e-9);
  assert.equal(fogTideGlowRangeMul(0), 1);
  assert.ok(Math.abs(fogTideGlowRangeMul(1) - FOG_TIDE_GLOW_RANGE_MUL) < 1e-9);
  assert.equal(fogTideFogBoost(0), 0);
  assert.ok(Math.abs(fogTideFogBoost(1) - FOG_TIDE_FOG_BOOST) < 1e-9);
});

test('drone gain multiplier rises with buildAmount, wind gain multiplier falls with tideAmount', () => {
  assert.equal(fogTideDroneGainMul(0), 1);
  assert.ok(Math.abs(fogTideDroneGainMul(1) - (1 + FOG_TIDE_DRONE_GAIN_MUL)) < 1e-9);
  assert.equal(fogTideWindGainMul(0), 1);
  assert.ok(Math.abs(fogTideWindGainMul(1) - (1 - FOG_TIDE_WIND_DUCK)) < 1e-9);
});

test('multipliers are monotonic between 0 and 1', () => {
  assert.ok(fogTideDetectMul(0.5) < fogTideDetectMul(0) && fogTideDetectMul(0.5) > fogTideDetectMul(1));
  assert.ok(fogTideGlowMul(0.5) > 1 && fogTideGlowMul(0.5) < FOG_TIDE_GLOW_MUL);
});

test('fogTideAmountAt is 0 far from every default site', () => {
  assert.equal(fogTideAmountAt(400, 400, 0.8), 0);
});

test('fogTideAmountAt equals tideAmount exactly at a default site center', () => {
  const site = FOG_TIDE_SITES[0];
  assert.equal(fogTideAmountAt(site.x, site.z, 0.8), 0.8);
});

test('fogTideAmountAt degenerate case: a single world-covering site reproduces old global behavior', () => {
  const worldSite: readonly EventSite[] = [{ x: 0, z: 0, radius: 100000, kind: 'fogTide' }];
  const tideAmount = 0.73;
  // radius (100000) dwarfs the real map bounds (+/-240), so the falloff term
  // (dist/radius, max ~339/100000 at the corners checked here) is negligible
  // but not exactly 0 in floating point -- a tight epsilon still proves this
  // reproduces the old whole-world constant, without requiring a literal
  // Infinity radius the real site list would never use.
  for (const [x, z] of [[0, 0], [240, 240], [-240, -240]] as const) {
    assert.ok(Math.abs(fogTideAmountAt(x, z, tideAmount, Infinity, Infinity, worldSite) - tideAmount) < 0.005);
  }
});

test('fogTideBuildAt is 0 far from every default site', () => {
  assert.equal(fogTideBuildAt(400, 400, 0.5), 0);
});

test('fogTideBuildAt equals buildAmount exactly at a default site center', () => {
  const site = FOG_TIDE_SITES[0];
  assert.equal(fogTideBuildAt(site.x, site.z, 0.5), 0.5);
});

test('fogTideBuildAt degenerate case: a single world-covering site reproduces old global behavior', () => {
  const worldSite: readonly EventSite[] = [{ x: 0, z: 0, radius: 100000, kind: 'fogTide' }];
  const buildAmount = 0.42;
  for (const [x, z] of [[0, 0], [240, 240], [-240, -240]] as const) {
    assert.ok(Math.abs(fogTideBuildAt(x, z, buildAmount, Infinity, Infinity, worldSite) - buildAmount) < 0.005);
  }
});
