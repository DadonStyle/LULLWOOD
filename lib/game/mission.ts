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
  secondary: MissionSecondaryState | null;
}

/** Deterministic draw -- same signature shape as the rest of the run's seeded
 * picks. `secondaryChoice` is the player's pre-run menu selection (LUL-1666);
 * null when no secondary is chosen, or when the drawn mission doesn't support
 * one yet (see SECONDARY_SUPPORTED_MISSIONS below) -- callers don't need to
 * check support themselves. */
export function pickMission(rng: () => number, secondaryChoice: SecondaryKind | null = null): MissionState {
  const target = MISSION_POOL[Math.floor(rng() * MISSION_POOL.length)];
  const secondary = secondaryChoice && SECONDARY_SUPPORTED_MISSIONS.has(target.kind)
    ? freshSecondary(secondaryChoice)
    : null;
  return { target, status: 'active', secondary };
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

// ---- LUL-1666: secondary objectives (Phase 1, deepwater only) ------------
//
// Guardrail (non-negotiable, both source proposals): a variant must not be
// selectable in the pre-run menu until the player has completed that
// mission's baseline once. That unlock is cross-session state the engine
// owns and Hud.tsx persists to localStorage, exactly like Embers -- see
// components/Hud.tsx's useEmbers()/useMissionUnlocks() and
// engine/forest-engine.js's setEmbers()/setMissionUnlocks(). This module only
// deals with the per-run secondary state once a choice has already been made;
// it holds no unlock/persistence logic itself.

export type SecondaryKind = 'retrieval' | 'speedrun';

/** Which missions currently support a secondary -- a Set, not `kind === 'deepwater'`
 * inline, so a future mission that ships its own reward-table row (M1/M4/M5,
 * deferred per the CTO scope ruling) is added here, not by touching pickMission. */
export const SECONDARY_SUPPORTED_MISSIONS: ReadonlySet<MissionKind> = new Set(['deepwater']);

// LUL-1666: reuses the stoneMarker landmark (engine/tuning.js LANDMARKS,
// kind:'stoneMarker', x:100 z:-75) -- a permanent, always-rendered decorative
// mesh with its own glow light (engine/forest-engine.js buildStoneMarker) that
// existed before this ticket and is unchanged by it. interactRadius mirrors
// MISSION_POOL's deepwater entry (4).
export const RETRIEVAL_ITEM = { x: 100, z: -75, interactRadius: 4 } as const;

// LUL-1666: first-cut tuning value, not playtest-derived -- see spec S7 for
// rationale. Retune here only; nothing else references the raw number.
export const MISSION_DEEPWATER_SPEEDRUN_SECONDS = 240;

export interface RetrievalSecondaryData {
  kind: 'retrieval';
  retrieved: boolean;
}

export interface SpeedrunSecondaryData {
  kind: 'speedrun';
  timeLimitSeconds: number;
}

export interface MissionSecondaryState {
  data: RetrievalSecondaryData | SpeedrunSecondaryData;
}

function freshSecondary(kind: SecondaryKind): MissionSecondaryState {
  if (kind === 'retrieval') return { data: { kind: 'retrieval', retrieved: false } };
  return { data: { kind: 'speedrun', timeLimitSeconds: MISSION_DEEPWATER_SPEEDRUN_SECONDS } };
}

/** Mirrors canCompleteMission's shape/boundary contract exactly (strict `<`). */
export function canCompleteRetrieval(mission: MissionState, distToItem: number): boolean {
  return mission.secondary?.data.kind === 'retrieval'
    && !mission.secondary.data.retrieved
    && distToItem < RETRIEVAL_ITEM.interactRadius;
}

/** No-ops (returns `mission` unchanged) if the secondary isn't an
 * unretrieved retrieval -- callers don't need to pre-check kind. */
export function completeRetrieval(mission: MissionState): MissionState {
  if (mission.secondary?.data.kind !== 'retrieval' || mission.secondary.data.retrieved) return mission;
  return { ...mission, secondary: { data: { kind: 'retrieval', retrieved: true } } };
}

/** Pure evaluation at the moment of arriving home -- true only when a
 * secondary is set AND its condition is met. Callers (arriveHome()) use this
 * to decide the payout bonus; it never gates whether arriving home succeeds. */
export function secondaryComplete(mission: MissionState, survivedSeconds: number): boolean {
  if (!mission.secondary) return false;
  const d = mission.secondary.data;
  if (d.kind === 'retrieval') return d.retrieved;
  return survivedSeconds <= d.timeLimitSeconds;
}
