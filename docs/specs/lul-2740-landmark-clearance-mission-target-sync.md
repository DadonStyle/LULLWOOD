# SPEC: LUL-2740 harden landmark clearance + sync mission target to placement

**Ticket:** LUL-2740 · **Tier:** C — edits `engine/forest-engine.js` (engine simulation) +
`lib/game/mission.ts` (mission generation), unconditional Tier C per `scripts/pr-tier.mjs`.
Needs `REVIEW: APPROVED` from the Code Reviewer before merge.

**Written against:** `release/next` @ `fadaa045ce7a3e626a56b5efda27654bfd56ff63` (2026-09-16).
Re-derive every `file:line` below from the branch you actually implement on if it has moved.

## Background

FE's live repro (LUL-2740 comment, 2026-09-16T09:27:49Z, `release/next@fadaa04`, seed 20260718
full map) found a real player-facing bug, not a QA-harness one. Two facts collide:

1. `lib/game/mission.ts:27` hardcodes `{ kind: 'deepwater', x: -95, z: 46, ... }` for
   `MISSION_POOL`'s only entry. Its own comment (`:19-26`, LUL-1483) says these coordinates
   are supposed to *match* `LANDMARKS`' `drownedCar` entry (`engine/tuning.js:81`, also
   `x:-95, z:46`) — a hand-copy, never enforced.
2. `placeLandmarks()` (`engine/forest-engine.js:1573-1581`) calls `clearLandmarkSpot()`
   (`:1561-1572`) to nudge each landmark off its nominal spot if a tree/cover prop generated
   too close. That nudge is a **bounded 8-try loop that silently returns a still-colliding
   position if all 8 tries fail** (`:1572`, `return [x, z]` with no clearance guarantee).

At seed 20260718 the retry exhausts: `drownedCar` ends up placed (and rendered/collidable) at
`(-91.95, 46.03)` — 3.05 units from `mission.target`'s stale `(-95, 46)`. Every consumer of
`mission.target` (`distToMissionTarget`/`canCompleteMission`, `lib/game/mission.ts:49-56`;
`qaTeleportNearMission()`, `engine/forest-engine.js:5183-5186`) computes against the stale
constant, not the landmark's real position. FE's sweep of `blocked()` along `z=46` found a
continuous 7-unit-wide collision wall (car's own `cr:2.3` circle plus an overlapping tree
canopy) directly between any straight-line approach and the stale target — no walk-in at any
hold duration crosses it. A real player on this or any other seed where the retry exhausts
would see the same thing: the car sitting partly inside/behind a tree, and the mission
distance math disagreeing with what's on screen.

**CTO fix-direction call (issue comment, 2026-09-16T09:29:05Z): ship both, in this order.**

1. **Harden `clearLandmarkSpot()` first** so it never returns a still-colliding position —
   this fixes it for every `landmarkData` consumer, not just missions.
2. **Then sync `mission.target.x/z`** to the landmark's actual post-placement position, read
   after placement completes with no new `rng()` draw (`pickMission(rng)` stays the run's last
   draw per the LUL-1258 comment, `engine/forest-engine.js:1322-1323` — this is a read of
   already-placed coordinates, not a generation-order change).

Do (1) before (2) so the sync in (2) is safe by construction, not dependent on a
"still-borderline-blocked by canopy" caveat re-checked by hand.

**Interaction with LUL-2578 (`docs/specs/lul-2578-mission-scale-micro-world.md`, already
shipped).** `CONFIG.missionScaleMul` (default `1`, `0.2` in the micro QA world) already
rewrites `mission.target.x/z` after `pickMission()` (`engine/forest-engine.js:1325-1327`) to a
synthetic scaled-down position that intentionally does **not** correspond to `drownedCar`'s
real (unscaled) rendered position — `LANDMARKS`/`CAVE` are deliberately left unscaled in the
micro world (`engine/tuning.js:207-209` comment). That divergence is correct and must not
change: the micro world's mission target existing only to stay inside the shrunk movement
clamp, decoupled from the landmark's actual visual position. **The new sync in this spec
applies only when `CONFIG.missionScaleMul === 1` (full map)** — the two code paths are
mutually exclusive today (`missionScaleMul` is never anything but `1` or `0.2`), so this is an
`if`/`else`, not a new interaction to reason about.

## Files

- `lib/game/landmarkClearance.ts` — new. Pure, unit-testable extraction of the clearance
  search `clearLandmarkSpot()` currently does inline against module-scope arrays.
- `lib/game/landmarkClearance.test.ts` — new. Forces the retry-exhaustion path
  deterministically (not a seed re-run — CTO's explicit ask).
- `lib/game/mission.ts` — add `landmarkKind` to `MissionTarget`, set it on the `deepwater`
  entry, add `syncMissionTargetToLandmark()`.
- `lib/game/mission.test.ts` — unit tests for the new function.
- `engine/forest-engine.js` — `clearLandmarkSpot()` delegates to the new pure function;
  `generateMap()` calls the sync on the full-map path.
- `e2e/mission-landmark-sync.spec.ts` — new, `@fullmap` (allowlisted below). Promotes
  `shared/local-qa/requests/lul-2187-mission-panel-overlap.md`'s manual scenario (the one that
  has been timing out) into real, always-running CI coverage.
- `lib/e2e-policy/world-policy.test.ts` — add the new spec file to `FULLMAP_ALLOWLIST`.

## The change

### 1. `lib/game/landmarkClearance.ts` (new file)

```ts
// LUL-2740: clearLandmarkSpot()'s nudge search, lifted out of
// engine/forest-engine.js so it is unit-testable without a Three.js scene
// (same extraction pattern as lib/game/cover.ts, LUL-450). Pure geometry, no
// rng() -- callers must not introduce one; the seeded stream ordering
// depends on this staying a pure function of its inputs.

export interface ClearanceObstacle {
  x: number;
  z: number;
  /** Effective collision radius against this obstacle (tree cr, cover's max(hx,hz), etc). */
  radius: number;
}

const SPIRAL_STEP = 3;
// LUL-2740: generous enough that no shipped LANDMARKS entry (engine/tuning.js)
// has ever needed more than a handful of rings in practice, but capped so a
// pathological obstacle field can't spiral forever -- "can't run away" per
// the CTO's fix-direction call.
const SPIRAL_MAX_RADIUS = 60;

export function isSpotClear(x: number, z: number, clear: number, obstacles: readonly ClearanceObstacle[]): boolean {
  for (const o of obstacles) {
    if (Math.hypot(x - o.x, z - o.z) < clear + o.radius) return false;
  }
  return true;
}

/** Deterministic outward spiral from (x,z): ring radius grows by SPIRAL_STEP
 * each lap, samples-per-ring grows with the ring's circumference so the
 * arc-length between sampled points never exceeds SPIRAL_STEP (no gap wide
 * enough for a clear pocket to hide from the search). Returns the first
 * clear point found; if SPIRAL_MAX_RADIUS is exhausted with no clear point
 * anywhere in the search, returns the original (x,z) unchanged -- same
 * "give up and use the nominal spot" fallback shape the old 8-try loop had,
 * except now it only fires past a much larger, deliberately-generous search
 * instead of after 8 tries. Callers must not assume the returned point is
 * clear without checking (isSpotClear) if they need to distinguish the two
 * cases. */
export function findClearLandmarkSpot(
  x: number,
  z: number,
  clear: number,
  obstacles: readonly ClearanceObstacle[],
): [number, number] {
  if (isSpotClear(x, z, clear, obstacles)) return [x, z];
  for (let r = SPIRAL_STEP; r <= SPIRAL_MAX_RADIUS; r += SPIRAL_STEP) {
    const samples = Math.max(8, Math.ceil((2 * Math.PI * r) / SPIRAL_STEP));
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (isSpotClear(px, pz, clear, obstacles)) return [px, pz];
    }
  }
  return [x, z];
}
```

Note the last line: on total exhaustion it returns the **original nominal** `(x, z)`, not the
last spiral candidate — same fallback shape as today's function (predictable, and every
shipped `LANDMARKS`/`CAVE` entry's surrounding density is nowhere near dense enough to hit
`SPIRAL_MAX_RADIUS`; the unit test below proves the search itself is correct well before that
cap, not that the cap is reachable in practice).

### 2. `engine/forest-engine.js` — `clearLandmarkSpot()` becomes a thin wrapper

Add the import next to the existing `lib/game/cover` import block style — new import
statement near the top import group (after the `@/lib/game/mission` import, `:161`):

```js
import { findClearLandmarkSpot } from '@/lib/game/landmarkClearance';
```

Replace `clearLandmarkSpot()` (`:1561-1572`) with:

```js
// Nudges (x,z) away from any tree/cover prop this seed actually generated
// nearby -- pure geometry, no rng, so it can't shift the seeded stream.
// LUL-2740: delegates to lib/game/landmarkClearance's unit-tested spiral
// search (previously an inline 8-try loop that could silently return a
// still-colliding position -- see that ticket for the bug this caused).
function clearLandmarkSpot(x, z, clear){
  const obstacles = [
    ...treeData.map(t => ({ x: t.x, z: t.z, radius: t.cr })),
    ...bogTreeData.map(t => ({ x: t.x, z: t.z, radius: t.cr })),
    ...coverData.map(c => ({ x: c.x, z: c.z, radius: Math.max(c.hx, c.hz) })),
  ];
  return findClearLandmarkSpot(x, z, clear, obstacles);
}
```

`placeLandmarks()` (`:1573-1581`) and `placeCave()`'s call to `clearLandmarkSpot()`
(`:1594`, inside `placeCave()` at `:1589-1602`) are both unchanged — same signature, same
call sites, only the body's search strategy changed.

### 3. `lib/game/mission.ts` — tag the landmark-tied mission, add the sync function

`MissionTarget` (`:8-16`): add one optional field.

```ts
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
}
```

`MISSION_POOL`'s `deepwater` entry (`:27`) gets the new field, and the existing LUL-1483
comment (`:19-26`) is replaced — the hand-copy problem it flagged is now enforced by
`syncMissionTargetToLandmark`, not just documented as a risk:

```ts
export const MISSION_POOL: readonly MissionTarget[] = [
  // LUL-1483/LUL-2740: (x,z) here is the LANDMARKS `drownedCar` entry's *nominal*
  // (pre-clearLandmarkSpot) position (engine/tuning.js:81) -- used only as the fallback
  // for CONFIG.missionScaleMul !== 1 (the micro QA world's intentionally-decoupled synthetic
  // target, docs/specs/lul-2578-mission-scale-micro-world.md) and as pickMission()'s return
  // value before generateMap() calls syncMissionTargetToLandmark(). On the full map
  // (missionScaleMul === 1) generateMap() always overwrites x/z with the landmark's real
  // post-placement position via `landmarkKind` below, so drift between this constant and
  // LANDMARKS can no longer produce an unreachable target -- see LUL-2740.
  { kind: 'deepwater', x: -95, z: 46, zoneRadius: 20, interactRadius: 4, landmarkKind: 'drownedCar' },
];
```

New function, placed after `pickMission()` (`:41-47`):

```ts
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
```

### 4. `engine/forest-engine.js` — call the sync in `generateMap()`

Import `syncMissionTargetToLandmark` alongside the existing `pickMission` import
(`:154-161`):

```js
import {
  pickMission,
  syncMissionTargetToLandmark,
  distToMissionTarget,
  canCompleteMission,
  completeMission,
  canCompleteRetrieval,
  completeRetrieval,
  secondaryComplete,
  RETRIEVAL_ITEM,
} from '@/lib/game/mission';
```

Replace the `missionScaleMul` block (`:1324-1328`) with an `if`/`else` — same insertion point,
same "no rng() between `pickMission()` and `placeCave()`" ordering constraint LUL-2578 already
established:

```js
  mission = pickMission(rng, secondaryChoice);
  if(CONFIG.missionScaleMul !== 1){
    mission = { ...mission, target: { ...mission.target, x: mission.target.x * CONFIG.missionScaleMul, z: mission.target.z * CONFIG.missionScaleMul } };
  } else {
    // LUL-2740: full map only -- sync the target to wherever placeLandmarks() (already run,
    // :1317) actually put its landmark, instead of trusting MISSION_POOL's nominal constant.
    mission = syncMissionTargetToLandmark(mission, landmarkData);
  }
  missionHumTimer = 2;
```

`landmarkData` is already in scope at this point in `generateMap()` (module-scope, populated
by `placeLandmarks()` at `:1317`, before `pickMission()` runs at `:1324`) — no new plumbing.

## Verification

- `npx tsx --test lib/game/landmarkClearance.test.ts` — new unit tests pass, including the
  forced retry-exhaustion case.
- `npx tsx --test lib/game/mission.test.ts` — new `syncMissionTargetToLandmark` tests pass.
- `npx tsc --noEmit` — `MissionTarget.landmarkKind` is optional, so every existing
  `MISSION_POOL`-shaped literal without it still type-checks; no signature break.
- `npx eslint .` — clean.
- Full-map behavior for every OTHER seed: `clearLandmarkSpot()`'s new search may place a
  landmark at a different (still-clear) coordinate than the old 8-try loop would have on a
  seed where the old loop already succeeded within 8 tries — this is expected and harmless
  (both are "some clear spot near the nominal", never asserted to be a specific coordinate by
  any existing test; confirm no test pins an exact non-nominal landmark position before
  merging — grep `landmarkData`/`qaTeleportNearStoneMarker` assertions in `e2e/`).

## e2e

**Specs.**
- `lib/game/landmarkClearance.test.ts` — new. "returns the nominal spot unchanged when
  clear", "finds a clear spot past a single blocking obstacle", "**forces the old 8-try
  budget to exhaust and proves the spiral still returns a clear spot**" (ring several
  obstacles around the nominal point at radii spanning past `8 * 3 = 24` units in the
  fixed-angle pattern the old loop used, i.e. exactly the shape of collision field LUL-2740's
  live repro hit at seed 20260718 — construct it from the *rule*, not by replaying the seed),
  "returns the nominal spot if every ring up to `SPIRAL_MAX_RADIUS` is blocked" (obstacle
  field with no gap at all, proves the cap is real and the fallback is the documented one).
- `lib/game/mission.test.ts` — new. "syncMissionTargetToLandmark overwrites x/z when
  `landmarkKind` matches", "no-ops when `landmarkKind` is unset", "no-ops when no landmark in
  the list matches", "never mutates the input `mission` or `landmarks` objects" (reuses the
  `assert.equal(m.target, MISSION_POOL[0])`-style reference check already in this file, LUL-2578
  precedent).
- `e2e/mission-landmark-sync.spec.ts` — new, one test: **"@fullmap walking straight at the
  synced mission target from qaTeleportNearMission() completes the deepwater mission"**.
  Boots `qaWorld: 'full'` (default `QA_PINNED_SEED` 20260718 from `e2e/helpers.ts:35` — the
  exact seed LUL-2740 was filed against, kept pinned for CI determinism, not because the fix
  is seed-specific: post-fix, `mission.target` always equals the landmark's real placed
  position by construction, so this passes for any seed). Sequence: `boot(page, { qaHooks:
  true, qaWorld: 'full' })` -> `enter(page)` -> `qaHook(page, 'qaTeleportNearMission')` ->
  `qaHook(page, 'qaSetLookYaw', Math.PI / 2)` (`qaTeleportNearMission()`,
  `engine/forest-engine.js:5183-5186`, always spawns the player at
  `target.x + interactRadius + 1, target.z` — a fixed `+x` offset from the target regardless
  of seed, so the yaw needed to face the target back along `-x` is always `Math.PI/2`; derived
  the same way `e2e/throwable-mission-hud.spec.ts:81` computes it dynamically, but this offset
  never changes so a constant is exact, matching the already-written
  `shared/local-qa/requests/lul-2187-mission-panel-overlap.md`'s own `qaSetLookYaw(1.5708)`
  step) -> `page.keyboard.down('KeyW')`, wait 700ms, `page.keyboard.up('KeyW')` (matches the
  request file's hold duration: interactRadius+1=5 units to close at ~6u/s walk speed) ->
  assert `#objective` contains `'drowned car'` (mirrors
  `e2e/throwable-mission-hud.spec.ts:106`'s `missionCanComplete` proof) -> `KeyE` -> assert
  `qaProbeMission().status === 'complete'`. Also asserts `page.locator('#missionPanel
  #missionGlyph')` reaches `'●'`, closing the local-qa request file's own `wait_for` condition
  directly. `trackConsoleErrors`/`expectNoConsoleErrors` (`e2e/helpers.ts`, same convention as
  every other spec in this directory).
  **fullmap-reason:** the bug is specifically that the full-map mission target must sync to
  `clearLandmarkSpot()`'s real (unscaled) placement — the micro world's mission target is a
  different, intentionally-decoupled synthetic position (LUL-2578) that never exercises this
  code path at all, so no micro-world staging can express this case.
- `e2e/throwable-mission-hud.spec.ts` — "teleporting near the mission target shows
  #missionPanel and enables completion" (existing, micro world, must pass unchanged — exercises
  the untouched `missionScaleMul !== 1` branch, proves this change doesn't regress it).

**World.** `lib/e2e-policy/world-policy.test.ts`'s `FULLMAP_ALLOWLIST` needs one new entry:
```ts
  'e2e/mission-landmark-sync.spec.ts': 'full-map-only mission/landmark sync path -- the micro world\'s mission target is a different, intentionally-decoupled synthetic position (LUL-2578)',
```
Every other new/changed spec here stays on the micro-world default; the QA rig itself never
runs the new `@fullmap` spec (LUL-2377) but it does run in CI's `fullmap`/`fullmap-mobile`
Playwright projects on every PR (`playwright.config.ts:118-150`).

**Hooks.** No new hooks. `qaTeleportNearMission()` (`engine/forest-engine.js:5183`),
`qaProbeMission()` (`:4097`), and `qaSetLookYaw()` (`:5200`) already exist and are exactly
what change — this spec fixes what `mission.target` holds by the time they read it.

**Tester scenario.** `shared/local-qa/requests/lul-2187-mission-panel-overlap.md` is the
tracking request file (title says LUL-2187, tracked live under LUL-2740/LUL-2602/LUL-2731) —
once this spec lands and `e2e/mission-landmark-sync.spec.ts` is green in CI, re-verify that
request file's own `wait_for` against the next nightly run; it should stop timing out. No new
request file needed — this spec's new e2e test supersedes it as the durable, always-running
regression check the request file could never be (per LUL-2377, request-file scenarios only
run nightly and only on the micro-incompatible full map when explicitly asked; the e2e spec
runs on every PR).

**Not covered.** Feel/timing of the walk-in (whether 700ms "feels right") stays manual — this
spec only proves the walk-in mechanically succeeds. Real-device touch input for the mobile
equivalent of this exact scenario is out of scope (no existing mobile analog of
`qaTeleportNearMission`'s desktop-only describe block in `e2e/mobile/throwable-mission-hud.spec.ts`
needs new coverage here — it exercises the micro-world scaled path, untouched by this fix).

## Cues

No new player-visible cue. This fixes existing collision/placement math so the drowned car
sits fully clear of trees and the mission target always matches where it's rendered — no new
HUD state, sound, or caption. The landmark's exact on-screen position may shift by a few units
on seeds where the old 8-try loop used to exhaust (previously silently broken on those seeds
anyway); no seed shows a different result for a reachable player-facing state than "the mission
target now matches the car."

## Constraints

- `lib/game/landmarkClearance.ts` functions stay pure: no `rng()` call, no read of engine
  module-scope state — everything comes through parameters. This is what makes the
  retry-exhaustion path unit-testable without a live seed.
- `MISSION_POOL` (`lib/game/mission.ts:18-...`) must never be mutated in place — same rule
  LUL-2578 established; `syncMissionTargetToLandmark` always rebuilds fresh objects.
- No `rng()` call may be introduced between `pickMission()` (`:1324`) and `placeCave()`
  (`:1329`) — same ordering constraint LUL-2578 already documented; `syncMissionTargetToLandmark`
  draws no rng, same as the `missionScaleMul` branch it sits beside.
- The `missionScaleMul !== 1` (micro-world) branch is untouched byte-for-byte — this spec adds
  an `else`, not a rewrite of that branch.
- `clearLandmarkSpot()`'s exported signature (`(x, z, clear) => [x, z]`) is unchanged — only
  its body changes, so `placeLandmarks()`/`placeCave()` call sites need no edits.

## Out of scope

- Landmark-to-landmark collision (two `LANDMARKS` entries ending up close to each other) —
  `clearLandmarkSpot()` only ever checked trees/bog-trees/cover, never other landmarks, and
  this spec doesn't change that scope.
- Any mission besides `deepwater` — `landmarkKind` is opt-in per `MissionTarget`; a future
  mission with no fixed-landmark target simply never sets it, and `syncMissionTargetToLandmark`
  no-ops.
- Re-tuning `SPIRAL_MAX_RADIUS`/`SPIRAL_STEP` for feel or performance — chosen generously
  enough that no shipped `LANDMARKS`/`CAVE` entry should ever approach the cap; if a future
  ticket finds one that does, that is level-design data to fix, not a reason to raise the cap.
- The QA-only path-aware-teleport idea from FE's original three candidate fixes — CTO
  explicitly rejected it as insufficient on its own (issue comment, 2026-09-16T09:29:05Z):
  it would have left the real player-facing bug live.
