import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSION_POOL,
  pickMission,
  syncMissionTargetToLandmark,
  distToMissionTarget,
  canCompleteMission,
  completeMission,
  canCompleteRetrieval,
  completeRetrieval,
  secondaryComplete,
  RETRIEVAL_ITEM,
  MISSION_FIREPOWER_SPEEDRUN_SECONDS,
  checkMissionExpiry,
  eligibleMissionPool,
  MISSION_FAR_UNLOCK_WINS,
  pickHardBabyPosition,
  BLACKOUT_MIN_RADIUS,
  type MissionState,
  type Landmark,
} from './mission.ts';
import { freshProgression } from './progression.ts';

function fixedRng(value: number): () => number {
  return () => value;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- pickHardBabyPosition (moved from lib/game/bog.ts, LUL-4676) ------

test('pickHardBabyPosition is deterministic for a given seed', () => {
  const a = pickHardBabyPosition(seeded(42), 240, []);
  const b = pickHardBabyPosition(seeded(42), 240, []);
  assert.deepEqual(a, b);
});

test('pickHardBabyPosition never lands closer than BLACKOUT_MIN_RADIUS', () => {
  for (const seed of [1, 2, 3, 42, 99]) {
    const p = pickHardBabyPosition(seeded(seed), 240, []);
    assert.ok(Math.hypot(p.x, p.z) >= BLACKOUT_MIN_RADIUS, `seed ${seed}: (${p.x},${p.z}) is inside the floor`);
  }
});

test('pickHardBabyPosition avoids a landmark covering its whole reachable area, still terminates', () => {
  const landmarks: Landmark[] = [{ x: 22, z: 4, clear: 300 }];
  const p = pickHardBabyPosition(seeded(7), 120, landmarks, 6, 20, 5);
  assert.equal(typeof p.x, 'number');
  assert.equal(typeof p.z, 'number');
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
});

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

// ---- syncMissionTargetToLandmark (LUL-2740) ------------------------------

test('syncMissionTargetToLandmark overwrites x/z when landmarkKind matches', () => {
  const m: MissionState = { target: MISSION_POOL[0], status: 'active', secondary: null };
  const landmarks = [{ kind: 'fireTower', x: -91.95, z: -94.03 }];
  const synced = syncMissionTargetToLandmark(m, landmarks);
  assert.equal(synced.target.x, -91.95);
  assert.equal(synced.target.z, -94.03);
});

test('syncMissionTargetToLandmark no-ops when landmarkKind is unset', () => {
  const target = { ...MISSION_POOL[0], landmarkKind: undefined };
  const m: MissionState = { target, status: 'active', secondary: null };
  const landmarks = [{ kind: 'fireTower', x: -91.95, z: -94.03 }];
  const synced = syncMissionTargetToLandmark(m, landmarks);
  assert.equal(synced, m);
});

test('syncMissionTargetToLandmark no-ops when no landmark in the list matches', () => {
  const m: MissionState = { target: MISSION_POOL[0], status: 'active', secondary: null };
  const landmarks = [{ kind: 'radioMast', x: 30, z: 175 }];
  const synced = syncMissionTargetToLandmark(m, landmarks);
  assert.equal(synced, m);
});

test('syncMissionTargetToLandmark never mutates the input mission or landmarks objects', () => {
  const m: MissionState = { target: MISSION_POOL[0], status: 'active', secondary: null };
  const landmarks = [{ kind: 'fireTower', x: -91.95, z: -94.03 }];
  syncMissionTargetToLandmark(m, landmarks);
  assert.equal(m.target, MISSION_POOL[0]);
  assert.equal(landmarks[0].x, -91.95);
  assert.equal(landmarks[0].z, -94.03);
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
  assert.deepEqual(m.secondary, { data: { kind: 'speedrun', timeLimitSeconds: MISSION_FIREPOWER_SPEEDRUN_SECONDS } });
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
    secondary: { data: { kind: 'speedrun', timeLimitSeconds: MISSION_FIREPOWER_SPEEDRUN_SECONDS } },
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
    secondary: { data: { kind: 'speedrun', timeLimitSeconds: MISSION_FIREPOWER_SPEEDRUN_SECONDS } },
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
    secondary: { data: { kind: 'speedrun', timeLimitSeconds: MISSION_FIREPOWER_SPEEDRUN_SECONDS } },
  };
  assert.equal(secondaryComplete(m, MISSION_FIREPOWER_SPEEDRUN_SECONDS), true);
  assert.equal(secondaryComplete(m, MISSION_FIREPOWER_SPEEDRUN_SECONDS - 1), true);
});

test('secondaryComplete for speedrun is false once survivedSeconds exceeds the time limit', () => {
  const m: MissionState = {
    target: MISSION_POOL[0],
    status: 'active',
    secondary: { data: { kind: 'speedrun', timeLimitSeconds: MISSION_FIREPOWER_SPEEDRUN_SECONDS } },
  };
  assert.equal(secondaryComplete(m, MISSION_FIREPOWER_SPEEDRUN_SECONDS + 1), false);
});

// ---- checkMissionExpiry (LUL-3010) --------------------------------------

test('checkMissionExpiry no-ops before the limit', () => {
  const deepwater = MISSION_POOL.find((t) => t.kind === 'deepwater')!;
  const m: MissionState = { target: deepwater, status: 'active', secondary: null };
  const next = checkMissionExpiry(m, deepwater.timeLimitSeconds! - 1);
  assert.equal(next, m); // same reference -- the no-op branch
});

test('checkMissionExpiry no-ops on an untimed target', () => {
  const oakHollow = MISSION_POOL.find((t) => t.kind === 'oakHollow')!;
  assert.equal(oakHollow.timeLimitSeconds, undefined);
  const m: MissionState = { target: oakHollow, status: 'active', secondary: null };
  const next = checkMissionExpiry(m, 999999);
  assert.equal(next, m);
});

test('checkMissionExpiry no-ops once the mission is already complete or expired', () => {
  const deepwater = MISSION_POOL.find((t) => t.kind === 'deepwater')!;
  const complete: MissionState = { target: deepwater, status: 'complete', secondary: null };
  const expired: MissionState = { target: deepwater, status: 'expired', secondary: null };
  assert.equal(checkMissionExpiry(complete, 999999), complete);
  assert.equal(checkMissionExpiry(expired, 999999), expired);
});

test('checkMissionExpiry flips active -> expired exactly at the limit', () => {
  const deepwater = MISSION_POOL.find((t) => t.kind === 'deepwater')!;
  const m: MissionState = { target: deepwater, status: 'active', secondary: null };
  const next = checkMissionExpiry(m, deepwater.timeLimitSeconds!);
  assert.equal(next.status, 'expired');
  assert.equal(next.target, m.target);
});

test('checkMissionExpiry never un-expires', () => {
  const deepwater = MISSION_POOL.find((t) => t.kind === 'deepwater')!;
  const m: MissionState = { target: deepwater, status: 'expired', secondary: null };
  const next = checkMissionExpiry(m, 0);
  assert.equal(next, m);
});

// ---- eligibleMissionPool (LUL-3010) --------------------------------------

test('eligibleMissionPool returns only untimed missions below MISSION_FAR_UNLOCK_WINS', () => {
  const progression = freshProgression();
  const pool = eligibleMissionPool(progression, 'lantern');
  assert.deepEqual(pool.map((m) => m.kind), ['oakHollow']);
});

test('eligibleMissionPool returns the full pool at MISSION_FAR_UNLOCK_WINS', () => {
  const progression = freshProgression();
  progression.lantern.wins = MISSION_FAR_UNLOCK_WINS;
  const pool = eligibleMissionPool(progression, 'lantern');
  assert.deepEqual(pool.map((m) => m.kind), MISSION_POOL.map((m) => m.kind));
});

test('eligibleMissionPool returns the full pool above MISSION_FAR_UNLOCK_WINS', () => {
  const progression = freshProgression();
  progression.lantern.wins = MISSION_FAR_UNLOCK_WINS + 5;
  const pool = eligibleMissionPool(progression, 'lantern');
  assert.deepEqual(pool.map((m) => m.kind), MISSION_POOL.map((m) => m.kind));
});

test('eligibleMissionPool checks only the given difficulty tier', () => {
  const progression = freshProgression();
  progression.night.wins = MISSION_FAR_UNLOCK_WINS;
  const pool = eligibleMissionPool(progression, 'lantern');
  assert.deepEqual(pool.map((m) => m.kind), ['oakHollow']);
});

// ---- pickMission with an explicit pool (LUL-3010) ------------------------

test('pickMission with an explicit 1-element pool always returns that entry', () => {
  const oakHollow = MISSION_POOL.find((t) => t.kind === 'oakHollow')!;
  const m = pickMission(fixedRng(0.5), null, [oakHollow]);
  assert.equal(m.target, oakHollow);
});
