import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mudSpeedMultiplier,
  mudNoiseMultiplier,
  isInMudZone,
  MUD_SPEED_MUL,
  MUD_NOISE_MUL,
} from './mud.ts';

test('mudSpeedMultiplier: on/off', () => {
  assert.equal(mudSpeedMultiplier(true), MUD_SPEED_MUL);
  assert.equal(mudSpeedMultiplier(false), 1);
});

test('mudNoiseMultiplier: on/off', () => {
  assert.equal(mudNoiseMultiplier(true), MUD_NOISE_MUL);
  assert.equal(mudNoiseMultiplier(false), 1);
});

test('isInMudZone: inside/outside/boundary', () => {
  const zones = [{ x: 10, z: 10, r: 5 }];
  assert.equal(isInMudZone(10, 10, zones), true, 'center is inside');
  assert.equal(isInMudZone(12, 10, zones), true, 'well inside the radius');
  assert.equal(isInMudZone(100, 100, zones), false, 'far outside');
  // strict `<` in isInMudZone -- exactly on the boundary counts as outside
  assert.equal(isInMudZone(15, 10, zones), false, 'exactly on the boundary');
});

test('isInMudZone: no zones', () => {
  assert.equal(isInMudZone(0, 0, []), false);
});
