import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCaveImmune, CAVE_IMMUNITY_TIME } from './cave.ts';

test('isCaveImmune is false at exactly 0', () => {
  assert.equal(isCaveImmune(0), false);
});

test('isCaveImmune is true for any positive remainder', () => {
  assert.equal(isCaveImmune(0.001), true);
  assert.equal(isCaveImmune(CAVE_IMMUNITY_TIME), true);
});

test('isCaveImmune is false for a negative remainder (decremented past 0)', () => {
  assert.equal(isCaveImmune(-0.01), false);
});
