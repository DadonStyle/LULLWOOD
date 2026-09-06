// LUL-1258: the missions pool. One active per run, seeded from the run's own
// RNG stream (never player-selected) so the cheapest/safest mission can't be
// farmed -- see game/economy/mission-rewards §2, "anti-farming comes from the
// draw, not from decay". Today the pool has exactly one member; a later
// ticket adds M1/M3/M4/M5 by appending to MISSION_POOL, not by reshaping this.
export type MissionKind = 'deepwater';

export interface MissionTarget {
  kind: MissionKind;
  x: number;
  z: number;
  /** Radius at which the player is considered "in the zone" -- drives the nav-cue tempo curve, not completion. */
  zoneRadius: number;
  /** Radius at which the interact prompt appears and completion can trigger -- mirrors canPickUp's role for the child. */
  interactRadius: number;
}

export const MISSION_POOL: readonly MissionTarget[] = [
  // Coordinates match LANDMARKS' drownedCar entry (engine/tuning.ts) --
  // do not hand-copy the numbers again if that entry ever moves; import LANDMARKS
  // in the engine call site instead (see S3).
  { kind: 'deepwater', x: 55, z: 205, zoneRadius: 20, interactRadius: 4 },
];

export interface MissionState {
  target: MissionTarget;
  status: 'active' | 'complete';
}

/** Deterministic draw -- same signature shape as the rest of the run's seeded picks. */
export function pickMission(rng: () => number): MissionState {
  const target = MISSION_POOL[Math.floor(rng() * MISSION_POOL.length)];
  return { target, status: 'active' };
}

export function distToMissionTarget(mission: MissionState, x: number, z: number): number {
  return Math.hypot(x - mission.target.x, z - mission.target.z);
}

/** Mirrors canPickUp's shape (lib/game/outcome.ts:46) -- strict `<`, same boundary contract. */
export function canCompleteMission(mission: MissionState, distToTarget: number): boolean {
  return mission.status === 'active' && distToTarget < mission.target.interactRadius;
}

export function completeMission(mission: MissionState): MissionState {
  if (mission.status === 'complete') return mission;
  return { ...mission, status: 'complete' };
}
