import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSION_POOL,
  pickMission,
  distToMissionTarget,
  canCompleteMission,
  completeMission,
  type MissionState,
} from './mission.ts';

function fixedRng(value: number): () => number {
  return () => value;
}

// ---- pickMission ------------------------------------------------------

test('pickMission draws exactly one rng() call and returns an active mission', () => {
  let calls = 0;
  const rng = () => { calls++; return 0; };
  const m = pickMission(rng);
  assert.equal(calls, 1);
  assert.equal(m.status, 'active');
  assert.equal(m.target, MISSION_POOL[0]);
});

test('pickMission is deterministic -- the same rng draw always picks the same mission', () => {
  const a = pickMission(fixedRng(0));
  const b = pickMission(fixedRng(0));
  assert.deepEqual(a, b);
});

test('pickMission clamps a near-1 rng draw to the last pool member, not past it', () => {
  const m = pickMission(fixedRng(0.999999));
  assert.equal(m.target, MISSION_POOL[MISSION_POOL.length - 1]);
});

// ---- distToMissionTarget ------------------------------------------------

test('distToMissionTarget is the straight-line distance to the target', () => {
  const m: MissionState = { target: MISSION_POOL[0], status: 'active', secondary: null };
  const d = distToMissionTarget(m, m.target.x, m.target.z + 5);
  assert.equal(d, 5);
});

// ---- canCompleteMission boundary (strict <, mirrors canPickUp) ---------

test('canCompleteMission is false at exactly interactRadius', () => {
  const m: MissionState = { target: MISSION_POOL[0], status: 'active', secondary: null };
  assert.equal(canCompleteMission(m, m.target.interactRadius), false);
});

test('canCompleteMission is true just inside interactRadius', () => {
  const m: MissionState = { target: MISSION_POOL[0], status: 'active', secondary: null };
  assert.equal(canCompleteMission(m, m.target.interactRadius - 0.001), true);
});

test('canCompleteMission is false once the mission is already complete', () => {
  const m: MissionState = { target: MISSION_POOL[0], status: 'complete', secondary: null };
  assert.equal(canCompleteMission(m, 0), false);
});

// ---- completeMission idempotence ----------------------------------------

test('completeMission flips an active mission to complete', () => {
  const m: MissionState = { target: MISSION_POOL[0], status: 'active', secondary: null };
  const next = completeMission(m);
  assert.equal(next.status, 'complete');
  assert.equal(next.target, m.target);
});

test('completeMission is idempotent -- calling it on an already-complete mission returns the same value', () => {
  const m: MissionState = { target: MISSION_POOL[0], status: 'complete', secondary: null };
  const next = completeMission(m);
  assert.equal(next, m); // same reference -- the no-op branch, not just an equal-shaped copy
});
