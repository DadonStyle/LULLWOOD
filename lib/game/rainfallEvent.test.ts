import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RAINFALL_CONFIG,
  RAINFALL_NOISE_MUL,
  RAINFALL_FOG_BOOST,
  rainfallPhase,
  rainfallBuildAmount,
  rainfallActiveTarget,
  rainfallNoiseScalar,
  rainfallFogBoost,
} from './rainfallEvent.ts';

test('config matches the spec: 80s cycle, 20s active, 10s signpost lead', () => {
  assert.equal(RAINFALL_CONFIG.period, 80);
  assert.equal(RAINFALL_CONFIG.activeDuration, 20);
  assert.equal(RAINFALL_CONFIG.leadIn, 10);
});

test('phase/build/target delegate correctly at the signpost boundary', () => {
  const start = RAINFALL_CONFIG.period - RAINFALL_CONFIG.activeDuration;
  assert.equal(rainfallPhase(start - RAINFALL_CONFIG.leadIn - 1), 'calm');
  assert.equal(rainfallPhase(start - 1), 'signpost');
  assert.equal(rainfallPhase(start), 'active');
  assert.equal(rainfallBuildAmount(start - RAINFALL_CONFIG.leadIn), 0);
  assert.equal(rainfallBuildAmount(start), 1);
  assert.equal(rainfallActiveTarget(start - 1), 0);
  assert.equal(rainfallActiveTarget(start), 1);
});

test('noise scalar is 1 (no cut) at rainAmount 0 and the -35% spec value at rainAmount 1', () => {
  assert.equal(rainfallNoiseScalar(0), 1);
  assert.ok(Math.abs(rainfallNoiseScalar(1) - RAINFALL_NOISE_MUL) < 1e-9);
  assert.ok(Math.abs(rainfallNoiseScalar(1) - 0.65) < 1e-9);
});

test('fog boost is 0 at rainAmount 0 and hits the spec constant at rainAmount 1', () => {
  assert.equal(rainfallFogBoost(0), 0);
  assert.ok(Math.abs(rainfallFogBoost(1) - RAINFALL_FOG_BOOST) < 1e-9);
});

test('noise scalar is monotonically decreasing between 0 and 1', () => {
  assert.ok(rainfallNoiseScalar(0.5) < rainfallNoiseScalar(0) && rainfallNoiseScalar(0.5) > rainfallNoiseScalar(1));
});
