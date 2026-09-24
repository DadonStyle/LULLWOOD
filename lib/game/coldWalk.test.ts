import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coldWalkJustBroke } from './coldWalk.ts';

test('coldWalkJustBroke is true only when opted in, not already broken, not mid-pickup, and running', () => {
  assert.equal(coldWalkJustBroke(true, false, false, true), true);
});

test('coldWalkJustBroke is false when not opted in', () => {
  assert.equal(coldWalkJustBroke(false, false, false, true), false);
});

test('coldWalkJustBroke is false when already broken (sticky, no re-trigger)', () => {
  assert.equal(coldWalkJustBroke(true, true, false, true), false);
});

test('coldWalkJustBroke is false while picking up, even if running', () => {
  assert.equal(coldWalkJustBroke(true, false, true, true), false);
});

test('coldWalkJustBroke is false when not running', () => {
  assert.equal(coldWalkJustBroke(true, false, false, false), false);
});
