import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coldWalkJustBroke } from './coldWalk.ts';

test('true only when opted in, not already broken, not mid-pickup, and running', () => {
  assert.equal(coldWalkJustBroke(true, false, false, true), true);
});

test('false when not opted in', () => {
  assert.equal(coldWalkJustBroke(false, false, false, true), false);
});

test('false when already broken -- stays false so the cue does not re-fire every frame', () => {
  assert.equal(coldWalkJustBroke(true, true, false, true), false);
});

test('false while mid-pickup -- sprinting during the pickup cinematic does not break it', () => {
  assert.equal(coldWalkJustBroke(true, false, true, true), false);
});

test('false when not running', () => {
  assert.equal(coldWalkJustBroke(true, false, false, false), false);
});

test('false when every disqualifying condition is true at once', () => {
  assert.equal(coldWalkJustBroke(false, true, true, false), false);
});
