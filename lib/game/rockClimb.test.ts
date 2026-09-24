import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRockClimbActive, canMountRock, rockClimbDetectMul, ROCK_CLIMB_DETECT_MUL, ROCK_MOUNT_RADIUS } from './rockClimb.ts';

test('isRockClimbActive is false at exactly 0', () => {
  assert.equal(isRockClimbActive(0), false);
});

test('isRockClimbActive is true for any positive remainder', () => {
  assert.equal(isRockClimbActive(0.001), true);
  assert.equal(isRockClimbActive(2), true);
});

test('isRockClimbActive is false for a negative remainder (decremented past 0)', () => {
  assert.equal(isRockClimbActive(-0.01), false);
});

test('canMountRock requires all three conditions at once', () => {
  assert.equal(canMountRock(false, false, 1, ROCK_MOUNT_RADIUS), true);
  assert.equal(canMountRock(true, false, 1, ROCK_MOUNT_RADIUS), false, 'hidden blocks it');
  assert.equal(canMountRock(false, true, 1, ROCK_MOUNT_RADIUS), false, 'already mounted blocks it');
  assert.equal(canMountRock(false, false, ROCK_MOUNT_RADIUS, ROCK_MOUNT_RADIUS), false, 'distance must be strictly less than radius');
  assert.equal(canMountRock(false, false, ROCK_MOUNT_RADIUS + 1, ROCK_MOUNT_RADIUS), false, 'too far');
});

test('rockClimbDetectMul is 1 (no-op) when not mounted', () => {
  assert.equal(rockClimbDetectMul(false), 1);
});

test('rockClimbDetectMul is exactly ROCK_CLIMB_DETECT_MUL when mounted', () => {
  assert.equal(rockClimbDetectMul(true), ROCK_CLIMB_DETECT_MUL);
});
