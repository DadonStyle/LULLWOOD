import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jumpOffset, JUMP_DURATION, JUMP_HEIGHT } from './jump.ts';

test('jumpOffset is 0 at the start and end of the arc', () => {
  assert.equal(jumpOffset(0), 0);
  assert.equal(jumpOffset(JUMP_DURATION), 0);
});

test('jumpOffset peaks at JUMP_HEIGHT at the midpoint', () => {
  assert.equal(jumpOffset(JUMP_DURATION / 2), JUMP_HEIGHT);
});

test('jumpOffset is symmetric around the midpoint', () => {
  const a = jumpOffset(JUMP_DURATION * 0.2);
  const b = jumpOffset(JUMP_DURATION * 0.8);
  assert.ok(Math.abs(a - b) < 1e-9, `expected symmetric heights, got ${a} vs ${b}`);
});

test('jumpOffset treats negative and past-duration time as grounded, not extrapolated', () => {
  assert.equal(jumpOffset(-0.1), 0);
  assert.equal(jumpOffset(JUMP_DURATION + 5), 0);
});

test('jumpOffset never exceeds JUMP_HEIGHT across the arc', () => {
  for (let t = 0; t <= JUMP_DURATION; t += JUMP_DURATION / 50) {
    assert.ok(jumpOffset(t) <= JUMP_HEIGHT + 1e-9);
  }
});
