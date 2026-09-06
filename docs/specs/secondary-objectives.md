# SPEC: Secondary objectives Phase 1 — retrieval + speedrun on `deepwater`

LUL-1666 (Tier C — touches win-payout logic in `engine/forest-engine.js`).
Source: [[decisions/secondary-objectives-accepted-2026-09-06]],
[[decisions/lul-1666-scope-deepwater-only-2026-09-06]] (CTO scope ruling — Phase 1
targets `deepwater` only; M1/M4/M5 rows in the original reward table are deferred
until those missions ship their own `MISSION_POOL` entries, not built here).

Executor: read only this file and the exact files/lines it cites. Do not grep the
repo for context beyond what's named here — if something's missing, that's a spec
bug, stop and report it (per Spec architecture, "Context discipline").

## Design decisions this spec makes (read before coding)

1. **The baseline win is never gated by the secondary.** The ticket's own text is
   explicit: "Failing the secondary never fails the baseline — base payout still
   applies, only the bonus is forfeited." That means `lib/game/outcome.ts`
   (`canArriveHome`/`arriveHome`) needs **zero changes** — arrival home always
   succeeds under the exact same conditions it does today. The secondary only
   changes what bonus gets added to the payout at the moment of arrival. Do not
   touch `lib/game/outcome.ts`.
2. **Retrieval item reuses the existing `stoneMarker` landmark**, not a new mesh.
   `stoneMarker` (`engine/tuning.js:41`, `x:100, z:-75`) is already a permanent,
   always-rendered decorative landmark with its own glow light
   (`engine/forest-engine.js:788-797`, `buildStoneMarker`) — this literally is the
   "Stone Marker" the Feature Scout's proposal names as its retrieval example. No
   new geometry, no new light. When retrieval is not the chosen secondary, nothing
   about the landmark changes at all — zero visual regression risk.
3. **Retrieval completion is a one-time flag, not "must still be holding it at the
   moment you arrive home."** The Scout's proposal appendix says `checkWin()`
   checks `carrying === 'marker'`, which would require new object-carry state
   (position tracking, drop-on-death, etc.) that does not exist for any object in
   this codebase today. Declared simplification, matching exactly how the
   existing `deepwater` baseline objective already works (`mission.status`
   flips to `'complete'` permanently at `completeMissionSequence()`,
   `engine/forest-engine.js:2915-2920`, and stays that way regardless of where
   the player physically is when they later arrive home — see
   `arriveHome()`'s `mission?.status === 'complete'` check at line 2940). Retrieval
   uses the identical pattern: reach the marker, press E, flag flips, stays
   flipped. State this in the PR body as a declared deviation from the Scout's
   literal wording, citing this paragraph — it is not a deviation from any
   `decisions/*` page, since neither decision page pins down carry semantics.
4. **Speedrun needs no new state at all.** It's a comparison at the existing
   `arriveHome()` call site: `survivedSeconds <= timeLimitSeconds`. The HUD
   countdown is derived every tick from `clock.elapsedTime - enteredAt` (already
   computed at `engine/forest-engine.js:2929` at win time — for the live countdown
   during play, reuse the same expression per-tick, see S3 below).
5. **No mission-selection screen exists** (`lib/game/mission.ts:1-5`: the pool is
   drawn from the run's own RNG, "never player-selected"). The player picks a
   secondary variant (or none) as a **pre-run choice in the existing game menu**,
   the same place difficulty is chosen (`components/GameMenu.tsx:115-137`), gated
   on `!state.entered` exactly like the difficulty control. This is a variant
   *choice*, not a *mission* choice — `deepwater` is still drawn the same way it
   always was; the player is only choosing which bonus (if any) to attempt against
   whichever mission gets drawn. Since only `deepwater` exists, in practice every
   run's mission is `deepwater`, but the code must not hard-assume that — gate
   secondary attachment on `mission.target.kind === 'deepwater'` so a future
   mission added to `MISSION_POOL` doesn't silently inherit an unrelated bonus.
6. **Unlock persistence mirrors the existing Embers pattern exactly**
   (`components/Hud.tsx:193-245`, `useEmbers`/`readEmbers`/`writeEmbers`): the
   engine is the source of truth for "is `deepwater`'s secondary unlocked",
   Hud.tsx persists it to `localStorage` under a new key and re-seeds the engine
   via a new action on mount. Same two-effect shape, same `typeof window`/`try`
   guards.
7. **Speedrun time limit:** new tunable constant, `MISSION_DEEPWATER_SPEEDRUN_SECONDS
   = 240` (4 minutes) in `lib/game/mission.ts`. Rationale: `deepwater`'s target
   sits at `(55, 205)` (`engine/tuning.js:44`), ~213 units from home at walk speed
   6 units/s — roughly 35s one-way at a dead sprint pace with no detours, plus
   finding the child first, plus the return leg. 240s gives a real but non-trivial
   window. This is a first-cut tuning value, not derived from playtest data —
   flag it in the PR body so the Game Economist can retune without a new spec if
   data says otherwise (it's a single named constant, not a scattered literal).

## Files

### 1. `lib/game/mission.ts` — full replacement

Replace the entire file with:

```ts
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
```

Diff summary against the current file: `MissionState` gains `secondary: MissionSecondaryState | null`; `pickMission` gains a second parameter; everything else in the original file (`MISSION_POOL`, `distToMissionTarget`, `canCompleteMission`, `completeMission`) is byte-identical. Everything below `completeMission` is new.

### 2. `lib/game/economy.ts` — one signature change, no behavior change when unused

At `lib/game/economy.ts:70-80`, change:

```ts
export function computeWinPayout(
  maxDistFromHome: number,
  survivedSeconds: number,
  tier: DifficultyTier = 'lantern',
  missionBonus = 0,
): RunPayout {
  const depth = computeDepth(maxDistFromHome);
  const survival = computeSurvival(survivedSeconds);
  const total = Math.round((depth + survival + CARRIED + HOME + missionBonus) * TIER_MULTIPLIERS[tier].win);
  return { depth, survival, carried: CARRIED, home: HOME, total };
}
```

to:

```ts
export function computeWinPayout(
  maxDistFromHome: number,
  survivedSeconds: number,
  tier: DifficultyTier = 'lantern',
  missionBonus = 0,
  secondaryBonus = 0,
): RunPayout {
  const depth = computeDepth(maxDistFromHome);
  const survival = computeSurvival(survivedSeconds);
  const total = Math.round((depth + survival + CARRIED + HOME + missionBonus + secondaryBonus) * TIER_MULTIPLIERS[tier].win);
  return { depth, survival, carried: CARRIED, home: HOME, total };
}
```

New 5th parameter, defaulted to 0 — every existing call site (there is exactly one, `engine/forest-engine.js:2941`, updated in S3 below) already passes 4 args today; with the default, omitting the 5th arg anywhere else would be a silent no-op change, not a break, but there are no other call sites to worry about. `computeDeathPayout` is untouched — secondary bonuses are win-only, same rule as `missionBonus` (`arriveHome()`'s existing comment at forest-engine.js:2938-2939).

Also add, near `MISSION_DEEPWATER_REWARD` (`lib/game/economy.ts:63-68`):

```ts
// LUL-1666: secondary-objective bonuses for deepwater, additive on top of
// MISSION_DEEPWATER_REWARD (never a replacement) -- CEO-accepted reward
// schedule, decisions/secondary-objectives-accepted-2026-09-06. M1/M4/M5 rows
// from the same table are deferred until those missions ship (CTO scope
// ruling, decisions/lul-1666-scope-deepwater-only-2026-09-06) -- do not add
// them here without a MISSION_POOL entry to key them off.
export const DEEPWATER_RETRIEVAL_BONUS = 15;
export const DEEPWATER_SPEEDRUN_BONUS = 18;
```

### 3. `engine/forest-engine.js` — mission draw, unlock tracking, interact handling, payout

All line numbers below are against `release/next @ 049fcd6`.

**3a. Imports (lines 104-111).** Change:

```js
import {
  pickMission,
  distToMissionTarget,
  canCompleteMission,
  completeMission,
} from '@/lib/game/mission';
```

to:

```js
import {
  pickMission,
  distToMissionTarget,
  canCompleteMission,
  completeMission,
  canCompleteRetrieval,
  completeRetrieval,
  secondaryComplete,
  RETRIEVAL_ITEM,
} from '@/lib/game/mission';
```

And in the existing economy import block (around line 96-102, alongside `computeWinPayout`, `MISSION_DEEPWATER_REWARD`), add `DEEPWATER_RETRIEVAL_BONUS, DEEPWATER_SPEEDRUN_BONUS`.

**3b. Per-run locals.** Near `missionCanComplete = false;` at line 1638, add a sibling local:

```js
    missionCanComplete = false,   // LUL-1258: recomputed every tick alongside canPickup, below
    secondaryCanComplete = false;   // LUL-1666: same shape, for the retrieval item
```

Near the module-level `let mission = null; let missionHumTimer = 2;` (lines 885-886), add:

```js
// LUL-1666: cross-session record of which missions have had their secondary
// unlocked (completed baseline once). Engine-owned, synced from
// components/Hud.tsx's localStorage read via setMissionUnlocks(), same split
// as `embers` (line ~1646). Keyed by MissionKind for forward-compatibility
// with M1/M4/M5 once they ship, even though only 'deepwater' is reachable today.
let missionUnlocks = { deepwater: false };
// LUL-1666: the player's pre-run menu choice for the *next* draw -- 'none' by
// default. Read once at pickMission() time in generateMap(), not re-read mid-run.
let secondaryChoice = null;
```

**3c. Mission draw (`generateMap()`, line 736).** Change:

```js
  mission = pickMission(rng);
```

to:

```js
  mission = pickMission(rng, secondaryChoice);
```

`secondaryChoice` stays whatever the player last set via the menu (see 3g); it is intentionally not reset by `generateMap()` so restarting keeps the player's last choice, mirroring how `difficulty` persists across restarts today.

**3d. E-key interact handler (lines 1688-1691).** Change:

```js
  if(e.code === 'KeyE' && playing && !paused){
    if(canPickup) pickup();
    else if(missionCanComplete) completeMissionSequence();
  }
```

to:

```js
  if(e.code === 'KeyE' && playing && !paused){
    if(canPickup) pickup();
    else if(missionCanComplete) completeMissionSequence();
    else if(secondaryCanComplete) completeSecondarySequence();
  }
```

Mirror the identical addition at the touch-interact handler, `triggerTouchInteract()` (line 3635-3638): same `else if(secondaryCanComplete && playing && !paused) completeSecondarySequence();` appended after the existing `missionCanComplete` branch. This is the mobile parity — no new touch control, reuses the existing interact button exactly like `missionCanComplete` already does.

**3e. New `completeSecondarySequence()` function**, placed directly after `completeMissionSequence()` (after line 2920):

```js
// LUL-1666: retrieval's completion -- mirrors completeMissionSequence()'s
// shape exactly (guard, pure-fn update, caption, sting), no cinematic lock,
// same rationale ("a detour bonus, not the core objective").
function completeSecondarySequence(){
  if(mission.secondary?.data.kind !== 'retrieval' || mission.secondary.data.retrieved) return;
  mission = completeRetrieval(mission);
  pushState({ caption: 'the stone marker -- retrieved', captionId: ++captionSeq });
  missionCompleteSting();
}
```

**3f. `arriveHome()` payout (lines 2921-2946).** Change the payout computation block:

```js
  const missionBonus = mission?.status === 'complete' ? MISSION_DEEPWATER_REWARD : 0;
  const payout = computeWinPayout(maxDistFromHome, survivedSeconds, difficulty, missionBonus);
```

to:

```js
  const missionBonus = mission?.status === 'complete' ? MISSION_DEEPWATER_REWARD : 0;
  // LUL-1666: secondary bonus is independent of missionBonus -- a player can
  // win the secondary without ever completing the deepwater baseline this
  // run (already unlocked from a prior run), or complete the baseline and
  // still miss the secondary. Never gates arriveHome() itself (see spec S1).
  const secondaryWon = mission ? secondaryComplete(mission, survivedSeconds) : false;
  const secondaryBonus = secondaryWon
    ? (mission.secondary.data.kind === 'retrieval' ? DEEPWATER_RETRIEVAL_BONUS : DEEPWATER_SPEEDRUN_BONUS)
    : 0;
  const payout = computeWinPayout(maxDistFromHome, survivedSeconds, difficulty, missionBonus, secondaryBonus);
  // LUL-1666: unlock is keyed on the *baseline* completing, independent of
  // whether a secondary was even attempted this run -- guardrail is "complete
  // the mission once", not "complete a secondary once". Persisted by
  // components/Hud.tsx same as embersBalance below.
  if(mission?.status === 'complete' && !missionUnlocks[mission.target.kind]){
    missionUnlocks = { ...missionUnlocks, [mission.target.kind]: true };
    pushState({ missionUnlocks: { ...missionUnlocks } });
  }
```

Note `mission.secondary.data.kind` is safe to read unguarded inside the `secondaryWon ? ... : 0` branch — `secondaryWon` is only ever true when `mission.secondary` is non-null (see `secondaryComplete`'s own guard).

**3g. New actions**, placed directly after `setEmbers()`/`purchaseDeeperLungs()` (after line 3049):

```js
// LUL-1666: sync from components/Hud.tsx's localStorage read, once on mount
// -- identical split to setEmbers() above (engine owns the state, React
// persists it). `unlocks` may be a partial/stale-shaped object (schema
// could predate a future mission); only known keys are trusted.
function setMissionUnlocks(unlocks){
  missionUnlocks = { deepwater: !!(unlocks && unlocks.deepwater) };
  pushState({ missionUnlocks: { ...missionUnlocks } });
}
// LUL-1666: player's pre-run menu pick for the *next* draw. No-ops outside
// the pre-run menu the same way setDifficulty tolerates a bad value -- an
// unrecognized kind is treated as 'none'. Deliberately does not re-roll the
// current mission's secondary mid-run; per GameMenu.tsx (S4/S5), the control
// itself is only rendered while `!state.entered`.
function setSecondaryChoice(kind){
  secondaryChoice = (kind === 'retrieval' || kind === 'speedrun') ? kind : null;
  pushState({ secondaryChoice });
}
```

**3h. `hudState` defaults (lines 2190-2199).** Add alongside the existing `missionKind: null, missionStatus: null,`:

```js
  // LUL-1666: secondary objectives (deepwater only, Phase 1). `missionUnlocks`
  // is cross-session like embersBalance above (Hud.tsx persists it).
  // `secondaryChoice` is the player's pre-run pick, reset only by
  // setSecondaryChoice() itself (i.e. it persists across restarts, matching
  // difficulty's own persistence). `secondaryKind`/`secondaryStatus`/
  // `secondaryProgress` describe the *active run's* secondary and are always
  // null/null/null when no secondary is attached to the current mission.
  missionUnlocks: { deepwater: false },
  secondaryChoice: null,
  secondaryKind: null, secondaryStatus: null, secondaryProgress: null,
```

**3i. `tick()` — recompute `secondaryCanComplete` and push secondary HUD fields.**
Immediately after line 3430 (`missionCanComplete = mission ? canCompleteMission(mission, distMission) : false;`), add:

```js
  const distSecondaryItem = (mission?.secondary?.data.kind === 'retrieval')
    ? Math.hypot(player.x - RETRIEVAL_ITEM.x, player.z - RETRIEVAL_ITEM.z)
    : Infinity;
  secondaryCanComplete = mission ? canCompleteRetrieval(mission, distSecondaryItem) : false;
```

In the same `pushState(...)` call that currently sends `missionKind`/`missionStatus` (lines 3474-3479), add (still inside the `!carrying` branch, same rule the mission panel already follows — "the panel never renders on the return leg"):

```js
    secondaryKind: mission && !carrying && mission.secondary ? mission.secondary.data.kind : null,
    secondaryStatus: mission && !carrying && mission.secondary
      ? (secondaryComplete(mission, clock.elapsedTime - enteredAt) ? 'complete' : 'active')
      : null,
    // LUL-1666: retrieval -> whole meters/distance for the Hud's progress
    // indicator; speedrun -> seconds remaining for its countdown. One field,
    // shape keyed by kind, mirrors lastPayout's discriminated-by-caller shape.
    secondaryProgress: mission && !carrying && mission.secondary
      ? (mission.secondary.data.kind === 'retrieval'
          ? { kind: 'retrieval', retrieved: mission.secondary.data.retrieved, distance: Math.round(distSecondaryItem) }
          : { kind: 'speedrun', remainingSeconds: Math.max(0, Math.round(mission.secondary.data.timeLimitSeconds - (clock.elapsedTime - enteredAt))) })
      : null,
```

And in the `else` branch at line 3480 (the one that already zeroes `missionKind: null, missionStatus: null` when `!entered`), add `secondaryKind: null, secondaryStatus: null, secondaryProgress: null` to the same object literal.

**3j. `restart()` (line 2981).** No change needed — `mission` is fully rebuilt by the next `generateMap()` call, which already re-reads `secondaryChoice` (3c); nothing about the secondary needs manual reset in `restart()` itself, mirroring how `mission = null` isn't reset there today either.

### 4. `engine/forest-engine.d.ts` — action type additions

Add to the exported actions interface (whatever its declared shape mirrors `EngineActions` in Hud.tsx — add in both places together):

```ts
setMissionUnlocks: (unlocks: { deepwater: boolean }) => void;
setSecondaryChoice: (kind: 'retrieval' | 'speedrun' | null) => void;
```

### 5. `components/Hud.tsx`

**5a. Import**, alongside the existing `import type { MissionKind } from '@/lib/game/mission';` (line ~15):

```ts
import type { MissionKind, SecondaryKind } from '@/lib/game/mission';
```

**5b. `EngineHudState`** — add after `missionStatus: 'active' | 'complete' | null;` (line 90):

```ts
  // LUL-1666: secondary objectives (deepwater only, Phase 1). See
  // engine/forest-engine.js's hudState defaults for field semantics.
  missionUnlocks: { deepwater: boolean };
  secondaryChoice: SecondaryKind | null;
  secondaryKind: SecondaryKind | null;
  secondaryStatus: 'active' | 'complete' | null;
  secondaryProgress:
    | { kind: 'retrieval'; retrieved: boolean; distance: number }
    | { kind: 'speedrun'; remainingSeconds: number }
    | null;
```

**5c. `EngineActions`** — add after `purchaseDeeperLungs: () => void;` (line 122):

```ts
  // LUL-1666
  setMissionUnlocks: (unlocks: { deepwater: boolean }) => void;
  setSecondaryChoice: (kind: SecondaryKind | null) => void;
```

**5d. `INITIAL_HUD_STATE`** — add after `missionStatus: null,` (line 171):

```ts
  missionUnlocks: { deepwater: false },
  secondaryChoice: null,
  secondaryKind: null, secondaryStatus: null, secondaryProgress: null,
```

**5e. Persistence hook** — directly after `useEmbers` (after line 245), add a new hook following the identical two-effect shape:

```ts
// LUL-1666: cross-session unlock record -- same split as useEmbers() above
// (engine owns state, this hook only seeds it once on mount and persists
// on change). Key deliberately distinct from EMBERS_KEY.
const MISSION_UNLOCKS_KEY = 'lullwood:mission-unlocks';

function readMissionUnlocks(): { deepwater: boolean } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MISSION_UNLOCKS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ deepwater: boolean }>;
    return { deepwater: !!parsed.deepwater };
  } catch {
    return null;
  }
}

function writeMissionUnlocks(unlocks: { deepwater: boolean }) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MISSION_UNLOCKS_KEY, JSON.stringify(unlocks));
  } catch {
    // private mode / quota exceeded -- unlock still applies this session, just won't persist
  }
}

function useMissionUnlocks(actions: EngineActions | null, unlocks: { deepwater: boolean }) {
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!actions) return;
    appliedRef.current = true;
    const stored = readMissionUnlocks();
    if (stored) actions.setMissionUnlocks(stored);
  }, [actions]);

  useEffect(() => {
    if (!appliedRef.current) return;
    writeMissionUnlocks(unlocks);
  }, [unlocks]);
}
```

Call it once alongside the existing `useEmbers(actions, ...)` call (line ~354): `useMissionUnlocks(actions, state.missionUnlocks);`

**5f. Secondary HUD panel** — directly after the existing mission panel block (lines 495-503), add:

```tsx
{/* LUL-1666: secondary objective panel -- progress indicator (retrieval) or
    countdown (speedrun). Same collapsed, top-left, non-blocking treatment as
    #missionPanel above (decisions/missions-accepted-2026-09-01 §2's rule
    extends naturally here -- it's the same panel family). Desktop+mobile
    parity is rendering-only: no new input, this is read-only like
    #missionPanel already is. */}
{state.secondaryKind && state.secondaryProgress && (
  <div id="secondaryPanel" className={state.secondaryStatus === 'complete' ? 'complete' : undefined}>
    {state.secondaryKind === 'retrieval' ? (
      <>
        Retrieve the Stone Marker
        <span id="secondaryGlyph">
          {state.secondaryProgress.kind === 'retrieval' && state.secondaryProgress.retrieved
            ? '●'
            : `${(state.secondaryProgress.kind === 'retrieval' && state.secondaryProgress.distance) ?? 0}m`}
        </span>
      </>
    ) : (
      <>
        Speedrun
        <span id="secondaryGlyph">
          {state.secondaryProgress.kind === 'speedrun' ? formatDuration(state.secondaryProgress.remainingSeconds) : ''}
        </span>
      </>
    )}
  </div>
)}
```

Uses the existing `formatDuration` helper (already defined in this file, line ~184) — no new formatting logic. This is a plain `<div>`, safe-area/touch concerns don't apply (it's display-only, like `#missionPanel`, which already coexists with the mobile HUD without special handling).

### 6. `components/GameMenu.tsx` — pre-run secondary picker

Directly after the existing `{!state.entered && ( <div className="menuRow menuDifficulty"> ... )}` block (the difficulty segmented control, lines ~115-137), add a second `!state.entered`-gated block:

```tsx
{!state.entered && state.missionUnlocks.deepwater && (
  <div className="menuRow menuSecondary">
    <label>Secondary objective</label>
    <div className="segmentedControl">
      {([null, 'retrieval', 'speedrun'] as const).map((k) => {
        const label = k === null ? 'None' : k === 'retrieval' ? 'Retrieval' : 'Speedrun';
        return (
          <button
            key={label}
            data-testid={`menuSecondary${label}`}
            className={`segment ${state.secondaryChoice === k ? 'active' : ''}`}
            onClick={() => {
              actions?.setSecondaryChoice(k);
              setOpen(false);
            }}
            title={k === null ? 'No bonus' : k === 'retrieval' ? 'Find the Stone Marker for a bonus' : 'Reach home within the time limit for a bonus'}
          >
            {label}
          </button>
        );
      })}
    </div>
  </div>
)}
```

Entire block only renders once `state.missionUnlocks.deepwater` is true — satisfies the non-negotiable guardrail: nothing about a secondary is visible or selectable until the baseline has been completed once. Uses the exact same `segmentedControl`/`segment`/`active` CSS classes as the difficulty control immediately above it — no new CSS needed.

### 7. `docs/ELEMENTS.md`

Add a row/entry for the `stoneMarker` landmark's new interactive verb (retrieval pickup) and for the mission struct's `secondary` field, following whatever format the existing `deepwater`/mission entries use in that file today. Executor: read `docs/ELEMENTS.md`'s current `deepwater`/mission-related entries first and match their exact format — this spec does not prescribe the row's literal text, only that it must exist in the same PR (per the Founding Engineer "Definition of done" standing rule). If `stoneMarker` has no existing row (it may not, since it was purely decorative before this ticket), add one.

## Verification

```bash
npx tsc --noEmit
npx eslint lib/game/mission.ts lib/game/economy.ts components/Hud.tsx components/GameMenu.tsx engine/forest-engine.d.ts
npx next build
node scripts/check-elements-citations.mjs --fix
node scripts/check-duplicate-logic.mjs
```

All five must pass clean. `next build` passing plus `tsc --noEmit` clean covers the JS engine file transitively (the engine imports the now-changed `lib/game/mission.ts`/`lib/game/economy.ts` exports, so a signature mismatch fails the build). No new unit test file is required by this spec (Phase 1 scope is additive with defaults that reduce to today's behavior when no secondary is chosen) — the Game Engineer may add one if convenient, but its absence is not a spec-completion blocker; see `docs/specs/*` convention that a verification command with no dedicated test suite still counts as "verified" when it's `tsc`+`build`+lint clean, per this repo's existing precedent for structurally-similar mission/economy diffs (LUL-1258's own PR history).

Manual/tester note (Founding Engineer cannot verify gameplay, no browser in this environment): once merged, the Game Tester (when reactivated) or the founder should confirm: (1) the secondary menu row stays hidden on a fresh profile with no `localStorage`, (2) it appears after one `deepwater` win, (3) choosing "Retrieval" and reaching the Stone Marker (visible at all times, glow already present) shows the panel flip to retrieved and the win screen shows a `+15` line, (4) choosing "Speedrun" shows a live countdown and a `+18` line on a win under 240s, (5) missing either secondary still shows a normal win with the ordinary `MISSION_DEEPWATER_REWARD` bonus only, no secondary bonus, no failure/red state.

## Constraints

- **Do not touch `lib/game/outcome.ts`.** `canArriveHome`/`arriveHome`'s existing guards are untouched — the secondary never gates arrival home (see design decision 1).
- **Do not alter predator behavior, map geometry, or difficulty multipliers.** `TIER_MULTIPLIERS` in `lib/game/economy.ts` is untouched; the secondary bonus is added to the payout total *before* the tier multiplier is applied (same position as `missionBonus` — see the `computeWinPayout` diff), so it scales with difficulty exactly like every other earn term already does, not as a flat post-multiplier add.
- **Do not add a new mesh, light, or asset.** Retrieval reuses the existing `stoneMarker` landmark unchanged.
- **Do not build placeholder M1/M4/M5 missions.** Out of scope per the CTO's scope ruling — `SECONDARY_SUPPORTED_MISSIONS` exists specifically so those can be added later as a one-line change, not a reason to build them now.
- **`computeDeathPayout` is untouched.** Secondary bonuses are win-only.
- **No new keybinding.** Retrieval reuses the existing `KeyE`/touch-interact channel exactly like the baseline mission objective already does.
- **`pickMission`'s new second parameter must default such that omitting it reproduces today's exact behavior** (`secondaryChoice: SecondaryKind | null = null` → `mission.secondary === null` → every downstream branch treats the run exactly as it does on `release/next` today). This is what makes the diff safe to land before the HUD/menu pieces are fully wired if the two need to be split across PRs.

## Out of scope

- Any secondary variant kind beyond `retrieval` and `speedrun` (no `visit-landmark`, mentioned in the Scout's proposal type union but not in the CEO-accepted scope or the reward table).
- M1 Veil, M4 Landmark, M5 Shipwreck secondary support — deferred until those missions ship their own `MISSION_POOL` entries (CTO ruling).
- Any change to how `deepwater`'s own baseline mission is drawn, completed, or paid — `MISSION_DEEPWATER_REWARD`, `pickMission`'s existing draw logic, and `completeMissionSequence()` are unchanged except for the one added `else if` branch (3d).
- A dedicated automated test (`e2e/` or unit) for the new logic — Tier A/e2e work, may be added separately without blocking this Tier C diff; not required for this spec's verification to pass (see Verification section).
- Any visual embellishment on the Stone Marker beyond what already exists (no new particle/glow-intensity change) — the existing always-on glow (`buildStoneMarker`) is sufficient signal once the HUD panel names it as the active objective.
