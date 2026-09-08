import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSION_POOL,
  pickMission,
  distToMissionTarget,
  canCompleteMission,
  completeMission,
  canCompleteRetrieval,
  completeRetrieval,
  secondaryComplete,
  RETRIEVAL_ITEM,
  MISSION_DEEPWATER_SPEEDRUN_SECONDS,
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

// ---- LUL-1666: pickMission's secondaryChoice gating branch --------------
// MISSION_POOL currently has exactly one member (deepwater) and it is in
// SECONDARY_SUPPORTED_MISSIONS, so every draw below hits the "supported"
// branch when a choice is passed -- there is no pool member today that
// would exercise the "drawn mission doesn't support a secondary" half of
// the gate.

test('pickMission with no secondaryChoice leaves secondary null (default, unchanged from before LUL-1666)', () => {
  const m = pickMission(fixedRng(0));
  assert.equal(m.secondary, null);
});

test('pickMission with secondaryChoice "retrieval" attaches a fresh, unretrieved retrieval secondary', () => {
  const m = pickMission(fixedRng(0), 'retrieval');
  assert.deepEqual(m.secondary, { data: { kind: 'retrieval', retrieved: false } });
});

test('pickMission with secondaryChoice "speedrun" attaches a fresh speedrun secondary at the deepwater time limit', () => {
  const m = pickMission(fixedRng(0), 'speedrun');
  assert.deepEqual(m.secondary, { data: { kind: 'speedrun', timeLimitSeconds: MISSION_DEEPWATER_SPEEDRUN_SECONDS } });
});

test('pickMission is deterministic with a secondaryChoice too -- same rng and choice always produce the same state', () => {
  const a = pickMission(fixedRng(0), 'retrieval');
  const b = pickMission(fixedRng(0), 'retrieval');
  assert.deepEqual(a, b);
});

// ---- canCompleteRetrieval boundary (strict <, mirrors canCompleteMission) --

test('canCompleteRetrieval is false when the mission has no secondary', () => {
  const m: MissionState = { target: MISSION_POOL[0], status: 'active', secondary: null };
  assert.equal(canCompleteRetrieval(m, 0), false);
});

test('canCompleteRetrieval is false when the secondary is a speedrun, not a retrieval', () => {
  const m: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'speedrun', timeLimitSeconds: MISSION_DEEPWATER_SPEEDRUN_SECONDS } },
  };
  assert.equal(canCompleteRetrieval(m, 0), false);
});

test('canCompleteRetrieval is false at exactly RETRIEVAL_ITEM.interactRadius', () => {
  const m: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'retrieval', retrieved: false } },
  };
  assert.equal(canCompleteRetrieval(m, RETRIEVAL_ITEM.interactRadius), false);
});

test('canCompleteRetrieval is true just inside RETRIEVAL_ITEM.interactRadius', () => {
  const m: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'retrieval', retrieved: false } },
  };
  assert.equal(canCompleteRetrieval(m, RETRIEVAL_ITEM.interactRadius - 0.001), true);
});

test('canCompleteRetrieval is false once the item has already been retrieved', () => {
  const m: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'retrieval', retrieved: true } },
  };
  assert.equal(canCompleteRetrieval(m, 0), false);
});

// ---- completeRetrieval no-ops and idempotence ----------------------------

test('completeRetrieval flips an unretrieved retrieval secondary to retrieved', () => {
  const m: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'retrieval', retrieved: false } },
  };
  const next = completeRetrieval(m);
  assert.deepEqual(next.secondary, { data: { kind: 'retrieval', retrieved: true } });
  assert.equal(next.target, m.target);
});

test('completeRetrieval is idempotent -- calling it on an already-retrieved secondary returns the same value', () => {
  const m: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'retrieval', retrieved: true } },
  };
  const next = completeRetrieval(m);
  assert.equal(next, m); // same reference -- the no-op branch
});

test('completeRetrieval is a no-op when there is no secondary at all', () => {
  const m: MissionState = { target: MISSION_POOL[0], status: 'active', secondary: null };
  const next = completeRetrieval(m);
  assert.equal(next, m);
});

test('completeRetrieval is a no-op on a speedrun secondary -- callers do not need to pre-check kind', () => {
  const m: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'speedrun', timeLimitSeconds: MISSION_DEEPWATER_SPEEDRUN_SECONDS } },
  };
  const next = completeRetrieval(m);
  assert.equal(next, m);
});

// ---- secondaryComplete: pure evaluation at arrive-home time --------------

test('secondaryComplete is false when the mission has no secondary', () => {
  const m: MissionState = { target: MISSION_POOL[0], status: 'active', secondary: null };
  assert.equal(secondaryComplete(m, 9999), false);
});

test('secondaryComplete for retrieval is true only once the item was retrieved', () => {
  const notYet: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'retrieval', retrieved: false } },
  };
  const done: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'retrieval', retrieved: true } },
  };
  assert.equal(secondaryComplete(notYet, 0), false);
  assert.equal(secondaryComplete(done, 0), true);
});

test('secondaryComplete for retrieval ignores survivedSeconds entirely', () => {
  const done: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'retrieval', retrieved: true } },
  };
  assert.equal(secondaryComplete(done, 100000), true);
});

test('secondaryComplete for speedrun is true at or under the time limit (inclusive boundary)', () => {
  const m: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'speedrun', timeLimitSeconds: MISSION_DEEPWATER_SPEEDRUN_SECONDS } },
  };
  assert.equal(secondaryComplete(m, MISSION_DEEPWATER_SPEEDRUN_SECONDS), true);
  assert.equal(secondaryComplete(m, MISSION_DEEPWATER_SPEEDRUN_SECONDS - 1), true);
});

test('secondaryComplete for speedrun is false once survivedSeconds exceeds the time limit', () => {
  const m: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'speedrun', timeLimitSeconds: MISSION_DEEPWATER_SPEEDRUN_SECONDS } },
  };
  assert.equal(secondaryComplete(m, MISSION_DEEPWATER_SPEEDRUN_SECONDS + 1), false);
});
