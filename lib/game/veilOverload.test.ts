import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVeilOverloadActive, VEIL_OVERLOAD_DURATION } from './veilOverload.ts';

test('isVeilOverloadActive is false at exactly 0', () => {
  assert.equal(isVeilOverloadActive(0), false);
});

test('isVeilOverloadActive is true for any positive remainder', () => {
  assert.equal(isVeilOverloadActive(0.001), true);
  assert.equal(isVeilOverloadActive(VEIL_OVERLOAD_DURATION), true);
});

test('isVeilOverloadActive is false for a negative remainder (decremented past 0)', () => {
  assert.equal(isVeilOverloadActive(-0.01), false);
});
