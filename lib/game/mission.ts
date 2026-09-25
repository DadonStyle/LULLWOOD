// LUL-1258: the missions pool. One active per run, seeded from the run's own
// RNG stream (never player-selected) so the cheapest/safest mission can't be
// farmed -- see game/economy/mission-rewards §2, "anti-farming comes from the
// draw, not from decay". LUL-3010 widened the pool to two members (deepwater
// far/timed, oakHollow near/untimed); a later ticket adds M1/M3/M4/M5 by
// appending to MISSION_POOL, not by reshaping this.
import type { Progression } from './progression.ts';
import type { DifficultyTier } from './economy.ts';

export interface Point {
  x: number;
  z: number;
}

export interface Landmark extends Point {
  clear: number; // radius to keep clear of, in world units
}

// Floor for blackout-difficulty's hard baby-spawn draw below -- lantern's spawn annulus
// tops out at half*0.8=192u at half=240, so this never spawns closer than lantern's
// hardest draw. Moved from lib/game/bog.ts (LUL-4676): this was never a bog mechanic,
// only coupled to bog geometry via a route-crosses-the-patch condition that had no
// meaning once the patch stopped existing -- see docs/specs/lul-4676-delete-bog.md.
export const BLACKOUT_MIN_RADIUS = 192;

export function clearOfLandmarks(x: number, z: number, landmarks: readonly Landmark[], pad: number): boolean {
  return landmarks.every((l) => Math.hypot(x - l.x, z - l.z) >= l.clear + pad);
}

/**
 * Draws a point from `rng` at least BLACKOUT_MIN_RADIUS from home, at least `margin` units
 * in from the map edge on both axes, clear of every landmark by `pad`. Bounded by
 * `maxTries` so a landmark layout that happens to leave no candidate can't spin forever --
 * returns its last candidate rather than looping.
 */
export function pickHardBabyPosition(
  rng: () => number,
  half: number,
  landmarks: readonly Landmark[],
  pad = 6,
  margin = 20,
  maxTries = 200,
): Point {
  const lo = -Math.max(0, half - margin);
  const hi = Math.max(0, half - margin);
  let x = 0;
  let z = 0;
  for (let i = 0; i < maxTries; i++) {
    x = lo + rng() * (hi - lo);
    z = lo + rng() * (hi - lo);
    if (Math.hypot(x, z) >= BLACKOUT_MIN_RADIUS && clearOfLandmarks(x, z, landmarks, pad)) return { x, z };
  }
  return { x, z };
}

export type MissionKind =
  | 'deepwater'
  | 'oakHollow'
  | 'slackWater'
  | 'stoneMarker'
  | 'radioMast'
  | 'beaconEvasion'
  | 'flush';

export interface MissionTarget {
  kind: MissionKind;
  x: number;
  z: number;
  /** Radius at which the player is considered "in the zone" -- drives the nav-cue tempo curve, not completion. */
  zoneRadius: number;
  /** Radius at which the interact prompt appears and completion can trigger -- mirrors canPickUp's role for the child. */
  interactRadius: number;
  /** LUL-2740: engine/tuning.js LANDMARKS `kind` this mission's target is tied to, if any --
   * lets generateMap() sync x/z to the landmark's actual post-placement position instead of
   * this pool entry's nominal (pre-clearLandmarkSpot) constant. Undefined for a mission with
   * no fixed-landmark target. */
  landmarkKind?: string;
  /** LUL-3010: wall-clock seconds from run start after which the mission can no
   * longer be completed (see checkMissionExpiry). Undefined = untimed, the
   * `deepwater` mission's original behaviour, still true for the near variant. */
  timeLimitSeconds?: number;
  /** LUL-4958: false for a mission whose completion condition is not "stand within
   * interactRadius of x/z" at all (the field's absence -- true -- covers every existing
   * mission unchanged). Gates the per-frame mission-nav-cue hum in
   * engine/forest-engine.js's tick() -- a mission with no real target position
   * must not hum the player toward one. Does NOT need to gate canCompleteMission() itself:
   * a non-spatial mission's interactRadius is 0, which already makes that path's strict
   * `<` permanently false by construction. */
  spatial?: boolean;
  /** LUL-5116: which of the 5 fixed ROOSTS (engine/tuning.js:75) this run's flush mission
   * targets. Resolved once per generateMap(), in the new rng() draw right after placeCave()
   * (see engine/forest-engine.js's generateMap()) -- this module has no rng import, so it
   * cannot draw the index itself. Only meaningful when target.kind === 'flush'; undefined
   * for every other kind. The value on this MISSION_POOL entry (0) is an inert placeholder,
   * always overwritten before a flush mission can be read in real play. */
  roostIndex?: number;
}

export const MISSION_POOL: readonly MissionTarget[] = [
  // LUL-1483/LUL-2740: (x,z) here is the LANDMARKS `fireTower` entry's *nominal*
  // (pre-clearLandmarkSpot) position (engine/tuning.js:77) -- used only as the fallback
  // for CONFIG.missionScaleMul !== 1 (the micro QA world's intentionally-decoupled synthetic
  // target, docs/specs/lul-2578-mission-scale-micro-world.md) and as pickMission()'s return
  // value before generateMap() calls syncMissionTargetToLandmark(). On the full map
  // (missionScaleMul === 1) generateMap() always overwrites x/z with the landmark's real
  // post-placement position via `landmarkKind` below, so drift between this constant and
  // LANDMARKS can no longer produce an unreachable target -- see LUL-2740.
  { kind: 'deepwater', x: -95, z: -95, zoneRadius: 20, interactRadius: 4, landmarkKind: 'fireTower', timeLimitSeconds: 60 },
  // LUL-3010: near/untimed variant, keyed to the `oak` LANDMARKS entry (engine/tuning.js:80),
  // placed unconditionally every round like drownedCar and not referenced by any other
  // mission or mechanic.
  { kind: 'oakHollow', x: 22, z: 4, zoneRadius: 10, interactRadius: 4, landmarkKind: 'oak' },
  // LUL-4958: no real target position -- completion is "pickup() accepted while fog-tide is
  // active" (see canCompleteSlackWater below), checked at engine/forest-engine.js's pickup(),
  // not through canCompleteMission(). x/z/zoneRadius/interactRadius are inert placeholders;
  // interactRadius: 0 keeps the existing E-key/canCompleteMission() path permanently false
  // for this kind (0 < 0 is false), spatial: false keeps the nav-cue hum from firing at (0,0).
  { kind: 'slackWater', x: 0, z: 0, zoneRadius: 0, interactRadius: 0, spatial: false },
  // LUL-4900/LUL-4646: keyed to the `stoneMarker` LANDMARKS entry (engine/tuning.js:65) --
  // same fixed-landmark/timed shape as deepwater, just a shorter round trip.
  { kind: 'stoneMarker', x: 100, z: -75, zoneRadius: 10, interactRadius: 4, landmarkKind: 'stoneMarker', timeLimitSeconds: 90 },
  // LUL-4900/LUL-4646: keyed to the `radioMast` LANDMARKS entry (engine/tuning.js:68) --
  // reuses missionWaypointHum()'s existing bearing-pan/proximity-pitch cue for free
  // (engine/forest-engine.js:2482-2500), no new audio code.
  { kind: 'radioMast', x: 30, z: 175, zoneRadius: 8, interactRadius: 4, landmarkKind: 'radioMast', timeLimitSeconds: 45 },
  // LUL-5134: Beacon Hunter Evasion (M1) -- same fireTower target/timing as deepwater, but a
  // Beacon Hunter wolf is repositioned ~50u from it after the mission draw (see
  // repositionBeaconHunterForMission() in engine/forest-engine.js) instead of a new spatial
  // shape here. timeLimitSeconds (non-null) already excludes this from eligibleMissionPool()
  // pre-3-wins via the existing `timeLimitSeconds == null` filter (~:154) -- no gating change.
  { kind: 'beaconEvasion', x: -95, z: -95, zoneRadius: 20, interactRadius: 4, landmarkKind: 'fireTower', timeLimitSeconds: 60 },
  // LUL-5116: no real target position, same non-spatial shape as slackWater (:104) --
  // completion is "the roost at ROOSTS[roostIndex] just got flushed by a player throw"
  // (see canCompleteFlush below), checked at engine/forest-engine.js's throwThrowable(),
  // not through canCompleteMission(). interactRadius: 0 keeps the E-key path permanently
  // false for this kind, same reasoning as slackWater's own comment. roostIndex: 0 is a
  // placeholder immediately overwritten by generateMap()'s post-placeCave() rng draw (or
  // ?qaRoostIndex for e2e) -- never read from this pool entry directly.
  { kind: 'flush', x: 0, z: 0, zoneRadius: 0, interactRadius: 0, spatial: false, roostIndex: 0 },
];

export interface MissionState {
  target: MissionTarget;
  status: 'active' | 'complete' | 'expired';
  secondary: MissionSecondaryState | null;
}

/** Deterministic draw -- same signature shape as the rest of the run's seeded
 * picks. `secondaryChoice` is the player's pre-run menu selection (LUL-1666);
 * null when no secondary is chosen, or when the drawn mission doesn't support
 * one yet (see SECONDARY_SUPPORTED_MISSIONS below) -- callers don't need to
 * check support themselves. `pool` defaults to the full MISSION_POOL so
 * existing callers/tests are unaffected; LUL-3010 lets callers pass a
 * filtered pool (eligibility gate, QA override) instead. */
export function pickMission(
  rng: () => number,
  secondaryChoice: SecondaryKind | null = null,
  pool: readonly MissionTarget[] = MISSION_POOL,
): MissionState {
  const target = pool[Math.floor(rng() * pool.length)];
  const secondary = secondaryChoice && SECONDARY_SUPPORTED_MISSIONS.has(target.kind)
    ? freshSecondary(secondaryChoice)
    : null;
  return { target, status: 'active', secondary };
}

/** LUL-3010: wins on the *current* difficulty tier before the far/timed variant can be
 * drawn at all -- cheap gate, reuses progression.ts's existing per-tier win counter
 * (lib/game/progression.ts:10), no new persisted field. Below the threshold, only the
 * near/untimed variant is eligible; at/above it, pickMission() draws uniformly between
 * both (still via rng(), same as today) -- a returning player who already has wins
 * recorded keeps seeing deepwater immediately on this deploy; a fresh player starts on
 * the safe variant. Retune the threshold here only. */
export const MISSION_FAR_UNLOCK_WINS = 3;

export function eligibleMissionPool(progression: Progression, difficulty: DifficultyTier): readonly MissionTarget[] {
  if (progression[difficulty].wins >= MISSION_FAR_UNLOCK_WINS) return MISSION_POOL;
  // LUL-4958/LUL-5069: `timeLimitSeconds == null` was written as "the near/untimed variant"
  // back when oakHollow was the only untimed entry in MISSION_POOL -- it was never meant as
  // a general "safe for a fresh player" test. slackWater is also untimed but was not designed
  // to replace oakHollow as the guaranteed pre-3-wins draw: excluding it here restores the
  // LUL-3010 invariant this function's own comment states ("a fresh player starts on the safe
  // variant") and fixes the concrete regression it caused -- a fresh `boot()` drawing
  // slackWater instead of oakHollow ~50% of the time broke e2e/hints.spec.ts's landmark test
  // (no oakHollow/deepwater HINT_PRIORITY entry matches slackWater, so no hint ever took the
  // slot after 'landmark' expired) and shifted downstream charge-dodge timing via the changed
  // mission draw. slackWater stays reachable at/above the win threshold via the MISSION_POOL
  // branch above, same as deepwater. LUL-5116: flush shares the exact same untimed/no-
  // landmarkKind shape as slackWater and would reproduce the identical regression without
  // the same exclusion, so it is excluded here too.
  return MISSION_POOL.filter((m) => m.timeLimitSeconds == null && m.kind !== 'slackWater' && m.kind !== 'flush');
}

/** Mirrors completeMission's shape. No-ops (returns `mission` unchanged) once the mission
 * is already 'complete' or 'expired', or has no timeLimitSeconds (the near variant is never
 * expirable) -- callers don't need to pre-check. Flips 'active' -> 'expired' the instant
 * survivedSeconds reaches the limit; never un-expires. */
export function checkMissionExpiry(mission: MissionState, survivedSeconds: number): MissionState {
  if (mission.status !== 'active') return mission;
  const limit = mission.target.timeLimitSeconds;
  if (limit == null || survivedSeconds < limit) return mission;
  return { ...mission, status: 'expired' };
}

/** LUL-2740: overwrites `mission.target.x/z` with `landmark`'s position when the target is
 * tied to a LANDMARKS entry (`target.landmarkKind` set) and that landmark is present in
 * `landmarks` -- a plain read of already-placed coordinates, draws no rng(). No-op (returns
 * `mission` unchanged) if the target has no `landmarkKind`, or no landmark in the list
 * matches it (never expected in practice: LANDMARKS is placed unconditionally every round,
 * before this can run -- see call site in generateMap()). Never mutates `landmarks` or the
 * shared MISSION_POOL entry `mission.target` may still reference -- always rebuilds fresh
 * objects, same rule LUL-2578 already established for this exact field. */
export function syncMissionTargetToLandmark(
  mission: MissionState,
  landmarks: readonly { kind?: string; x: number; z: number }[],
): MissionState {
  const kind = mission.target.landmarkKind;
  if (!kind) return mission;
  const landmark = landmarks.find((l) => l.kind === kind);
  if (!landmark) return mission;
  return { ...mission, target: { ...mission.target, x: landmark.x, z: landmark.z } };
}

export function distToMissionTarget(mission: MissionState, x: number, z: number): number {
  return Math.hypot(x - mission.target.x, z - mission.target.z);
}

/** Mirrors canPickUp's shape (lib/game/outcome.ts:46) -- strict `<`, same boundary contract. */
export function canCompleteMission(mission: MissionState, distToTarget: number): boolean {
  return mission.status === 'active' && distToTarget < mission.target.interactRadius;
}

/** LUL-4958: the player accepted the pickup (beginPickup() transitioned, not just attempted
 * it) while Fog Tide's active phase was live. Caller passes the engine's own fogTideActive
 * boolean, read at the exact instant pickup() accepts -- not re-derived here, this module
 * has no fog-tide import and should not gain one just to duplicate a boolean the engine
 * already computes every frame (lib/game/fogTide.ts's fogTidePhase() is the source of truth
 * for that boolean; this function only decides what to do with it). */
export function canCompleteSlackWater(mission: MissionState, fogTideActive: boolean): boolean {
  return mission.status === 'active' && mission.target.kind === 'slackWater' && fogTideActive;
}

/** LUL-5116: the roost a player-thrown stone just flushed (throwThrowable()'s
 * nearestRoost, engine/forest-engine.js:6063) is the SAME roost this run's flush mission
 * named. Mirrors canCompleteSlackWater's shape exactly -- one pure predicate, checked at
 * the one real-play call site that can make it true. The ambient chase-proximity trigger
 * (updateRoosts(), engine/forest-engine.js:2964) never calls this function at all, so a
 * DIFFERENT (unmarked) roost being flushed by a wandering predator cannot complete this
 * mission by construction -- not by an extra guard here, by that call site never existing. */
export function canCompleteFlush(mission: MissionState, flushedRoostIndex: number): boolean {
  return mission.status === 'active' && mission.target.kind === 'flush' && mission.target.roostIndex === flushedRoostIndex;
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

// LUL-1666, retargeted per decisions/lul-1697-retrieval-landmark-radiomast-2026-09-08:
// reuses the radioMast landmark (engine/tuning.js LANDMARKS, kind:'radioMast',
// x:30 z:175), not stoneMarker -- LUL-2067 wired stoneMarker's E-key interact
// slot to canBuyVeilCharm/buyVeilCharm() after this spec's base commit, which
// would have collided with retrieval's own E-key completion at the same spot.
// radioMast is a permanent, always-rendered decorative mesh with its own pulse
// glow (engine/forest-engine.js buildRadioMast/radioMastBeaconGlow) and no
// other interact mechanic. interactRadius mirrors MISSION_POOL's deepwater
// entry (4).
export const RETRIEVAL_ITEM = { x: 30, z: 175, interactRadius: 4 } as const;

// LUL-1666: first-cut tuning value, not playtest-derived -- see spec S7 for
// rationale. Retune here only; nothing else references the raw number.
export const MISSION_FIREPOWER_SPEEDRUN_SECONDS = 240;

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
  return { data: { kind: 'speedrun', timeLimitSeconds: MISSION_FIREPOWER_SPEEDRUN_SECONDS } };
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
