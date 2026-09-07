import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bearingOf,
  bearingPan,
  callVolumeMul,
  CALL_FULL_VOL_DIST,
  CALL_FALLOFF_DIST,
  CALL_MIN_VOL_MUL,
} from './bearing.ts';

// ---- bearingOf: quadrants, facing yaw=0 (fx,fz = 0,-1 ; rx,rz = 1,0) -------

test('bearingOf: source ahead of origin is "ahead"', () => {
  const b = bearingOf(0, -10, 0, 0, 0);
  assert.equal(b.side, 'ahead');
  assert.ok(b.fwd > 0);
});

test('bearingOf: source behind origin is "behind"', () => {
  const b = bearingOf(0, 10, 0, 0, 0);
  assert.equal(b.side, 'behind');
  assert.ok(b.fwd < 0);
});

test('bearingOf: source to origin\'s right is "right"', () => {
  const b = bearingOf(10, 0, 0, 0, 0);
  assert.equal(b.side, 'right');
  assert.ok(b.right > 0);
});

test('bearingOf: source to origin\'s left is "left"', () => {
  const b = bearingOf(-10, 0, 0, 0, 0);
  assert.equal(b.side, 'left');
  assert.ok(b.right < 0);
});

test('bearingOf: dist is the straight-line distance regardless of yaw', () => {
  const b = bearingOf(3, 4, 0, 0, 1.234);
  assert.ok(Math.abs(b.dist - 5) < 1e-9);
});

test('bearingOf: fwd/right decompose dist (Pythagorean, any yaw)', () => {
  const b = bearingOf(12, -7, 2, 3, 0.77);
  assert.ok(Math.abs(b.fwd * b.fwd + b.right * b.right - b.dist * b.dist) < 1e-6);
});

// ---- bearingPan --------------------------------------------------------

test('bearingPan: dead ahead or behind pans center', () => {
  assert.equal(bearingPan(bearingOf(0, -10, 0, 0, 0)), 0);
  assert.equal(bearingPan(bearingOf(0, 10, 0, 0, 0)), 0);
});

test('bearingPan: hard right is positive, hard left is negative', () => {
  assert.ok(bearingPan(bearingOf(10, 0, 0, 0, 0)) > 0);
  assert.ok(bearingPan(bearingOf(-10, 0, 0, 0, 0)) < 0);
});

test('bearingPan: always clamped to [-1, 1]', () => {
  const b = bearingOf(0.01, 0, 0, 0, 0); // dist << 1, right/max(1,dist) would blow up unclamped
  const pan = bearingPan(b);
  assert.ok(pan >= -1 && pan <= 1);
});

// ---- callVolumeMul ------------------------------------------------------

test('callVolumeMul: full volume at/inside CALL_FULL_VOL_DIST', () => {
  assert.equal(callVolumeMul(0), 1);
  assert.equal(callVolumeMul(CALL_FULL_VOL_DIST), 1);
});

test('callVolumeMul: floors at CALL_MIN_VOL_MUL far away, never goes silent', () => {
  assert.equal(callVolumeMul(CALL_FULL_VOL_DIST + CALL_FALLOFF_DIST), CALL_MIN_VOL_MUL);
  assert.equal(callVolumeMul(100000), CALL_MIN_VOL_MUL);
});

test('callVolumeMul: monotonically non-increasing with distance', () => {
  const a = callVolumeMul(25), b = callVolumeMul(50), c = callVolumeMul(75);
  assert.ok(a >= b && b >= c);
});

test('callVolumeMul: negative distance treated as 0', () => {
  assert.equal(callVolumeMul(-5), callVolumeMul(0));
});
