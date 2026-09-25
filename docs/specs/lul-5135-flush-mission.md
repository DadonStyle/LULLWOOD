# SPEC: LUL-5135 M6 Flush mission (roost-targeted, cheap slice)

**Ticket:** LUL-5135 (SPEC), split from LUL-5132 (CTO PLAN, done) · **Tier:** B — a new
non-spatial mission kind reusing the Slack Water pattern (`MISSION_POOL`/`MISSION_REWARDS`/
`MISSION_NAMES` `Record`-exhaustiveness-checked additions), a new rng() consumer in
`generateMap()`, and one new branch inside `throwThrowable()` — a real interaction path, but
not the core pickup/win transition Slack Water's Tier C hung off. Merges on green per
AGENTS.md's Tier A/B rule; review lands after, not before.

**Written against:** `release/next` @ `746b144` (2026-09-25). Re-derive every `file:line`
below if the branch has moved.

**Source.** CEO acceptance `decisions/lul-5116-m6-flush-accepted-2026-09-25`, wiki
`game/mechanics/roost-decoy-mission` (Feature Checklist §0 fully answered there by Feature
Scout — not repeated here), CTO PLAN LUL-5132 (this ticket's own description). All citations
below re-derived live against `release/next@746b144`, not copied from the wiki draft (which
was written against an earlier sha and has since drifted — see corrections in the Design
call section).

## Design call this SPEC makes

The CTO PLAN's own description is accurate for four of its five files, but two details it
didn't resolve needed a real decision:

1. **`eligibleMissionPool()`'s existing `slackWater` exclusion must also cover `flush`.**
   `lib/game/mission.ts:149` gates the pre-`MISSION_FAR_UNLOCK_WINS` pool to
   `m.timeLimitSeconds == null && m.kind !== 'slackWater'` — and that exclusion's own
   comment (`:151-159`) explains it was added *after* a real regression: a fresh player
   drawing `slackWater` (untimed, no `landmarkKind`) broke `e2e/hints.spec.ts`'s landmark
   hint test, because `HINT_PRIORITY` (`:1988`) has no entry for a kind with nothing to
   hum/hint toward. `flush` has the exact same shape — untimed, no `landmarkKind` — so
   without the same exclusion it silently joins the guaranteed pre-3-wins draw pool and
   reproduces the identical regression. This SPEC extends the filter to
   `m.kind !== 'slackWater' && m.kind !== 'flush'`.
2. **The roost-index rng draw's exact insertion point.** The ticket says "after `placeCave()`
   (`:1179`)... as a NEW `rng()` consumer appended last." Confirmed live: `placeCave()`
   (`:1179`) is still the last `rng()` consumer in `generateMap()` today — everything after it
   (`buildGrid()`, chunk streaming, `drawMinimapStatic()`) is commented as consuming no rng
   (`:1206-1209`, `:1173`). The new draw goes in the 3 lines between `placeCave();` (`:1179`)
   and the following `buildGrid();` (`:1180`), making it the new last consumer — satisfies
   LUL-1904's "must stay last" rule by construction, same as `placeCave()` itself did before
   it.
3. **`qaProbeMission()`'s return type is already stale independent of this ticket.**
   `engine/forest-engine.d.ts:579` types `kind` as `'deepwater' | 'oakHollow'` only, even
   though the implementation (`engine/forest-engine.js:4243`) returns `mission.target.kind`
   unnarrowed — `slackWater`/`stoneMarker`/`radioMast` already widened the real return value
   without this declaration being updated (LUL-4958/LUL-4900 both missed it; harmless because
   nothing has type-checked against the narrower union yet). Since this SPEC edits this exact
   line to add `roostIndex`, fixing the `kind` union to the real `MissionKind` type costs
   nothing extra and prevents `flush` compounding a drift already three kinds wide.
4. **The opposing-system test (Q11) needs a predator actually in `'chase'` state near a
   roost**, not just positioned near one. `updateRoosts()` (`engine/forest-engine.js:2964`)
   only fires the ambient trigger for `p.state === 'chase'` (`:2970`). The existing
   `qaStagePredatorNearPlayer(kind, dx, dz)` (`:5619`) explicitly sets `p.state = 'roam'`
   (`:5623`) — by design, eight existing specs (`e2e/hide-alert.spec.ts`,
   `e2e/cover-rustle.spec.ts`, `e2e/hints.spec.ts`, etc.) depend on that roam behavior, so
   this SPEC does not repurpose it. Instead it adds one small new hook,
   `qaSetPredatorChasing(kind)`, that only flips state (no repositioning) — composes with
   `qaStagePredatorNearPlayer`'s existing positioning, same "directly set a real engine
   state field" pattern `qaStageRockClimb` (`:4714`, `p.state = 'chase'; p.hunt = false;`)
   already uses.

## Files

- `lib/game/mission.ts` — edited. `MissionKind` gains `'flush'`. `MissionTarget` gains
  optional `roostIndex?: number`. New `MISSION_POOL` entry. New pure function
  `canCompleteFlush()`. `eligibleMissionPool()`'s filter extended (Design call §1).
- `lib/game/economy.ts` — edited. New `MISSION_FLUSH_REWARD` constant (placeholder) +
  `MISSION_REWARDS` entry.
- `engine/forest-engine.js` — edited. Import, `generateMap()`'s post-`placeCave()`
  roost-index draw, `throwThrowable()`'s completion check, `qaProbeMission`'s `roostIndex`
  field, new `qaSetPredatorChasing` QA hook, new `?qaRoostIndex=` boot param.
- `engine/forest-engine.d.ts` — edited. `qaProbeMission`'s `kind`/`roostIndex` fields
  corrected and widened, `qaSetPredatorChasing` declaration.
- `components/Hud.tsx` — edited. `MISSION_NAMES` gains a `flush` entry (`Record<MissionKind,
  string>` is exhaustive-checked — `tsc` fails without it, not new UI work).
- `docs/ELEMENTS.md` — edited. Mission section's kind list/count and reward table gain
  `flush`.
- `e2e/helpers.ts` — edited. `boot()`'s `qaMissionKind` param type widens to include
  `'flush'` (same one-line type-union touch LUL-4900 made for `stoneMarker`/`radioMast`,
  `e2e/helpers.ts`'s `boot()` signature).
- `e2e/mission-flush.spec.ts` — new.

## The change

### `lib/game/mission.ts`

```ts
export type MissionKind = 'deepwater' | 'oakHollow' | 'slackWater' | 'stoneMarker' | 'radioMast' | 'flush';

export interface MissionTarget {
  kind: MissionKind;
  x: number;
  z: number;
  zoneRadius: number;
  interactRadius: number;
  landmarkKind?: string;
  timeLimitSeconds?: number;
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
  { kind: 'deepwater', /* ...unchanged... */ },
  { kind: 'oakHollow', /* ...unchanged... */ },
  { kind: 'slackWater', /* ...unchanged... */ },
  { kind: 'stoneMarker', /* ...unchanged... */ },
  { kind: 'radioMast', /* ...unchanged... */ },
  // LUL-5116: no real target position, same non-spatial shape as slackWater (:104) --
  // completion is "the roost at ROOSTS[roostIndex] just got flushed by a player throw"
  // (see canCompleteFlush below), checked at engine/forest-engine.js's throwThrowable(),
  // not through canCompleteMission(). interactRadius: 0 keeps the E-key path permanently
  // false for this kind, same reasoning as slackWater's own comment. roostIndex: 0 is a
  // placeholder immediately overwritten by generateMap()'s post-placeCave() rng draw (or
  // ?qaRoostIndex for e2e) -- never read from this pool entry directly.
  { kind: 'flush', x: 0, z: 0, zoneRadius: 0, interactRadius: 0, spatial: false, roostIndex: 0 },
];
```

`eligibleMissionPool()` (`:149-161`), filter line only:
```ts
  return MISSION_POOL.filter((m) => m.timeLimitSeconds == null && m.kind !== 'slackWater' && m.kind !== 'flush');
```
(Design call §1 — comment above this line should be extended, not replaced: append one
sentence noting `flush` shares the same untimed/no-`landmarkKind` shape as `slackWater` and
would reproduce the identical `e2e/hints.spec.ts` regression without this.)

New pure function, next to `canCompleteSlackWater` (`:209-211`):
```ts
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
```

### `lib/game/economy.ts`

Next to `MISSION_RADIO_MAST_REWARD` (`:96`):
```ts
// LUL-5116: Flush -- placeholder pending the Game Economist's number (same placeholder
// convention MISSION_STONE_MARKER_REWARD (:92) already uses -- "confirm/adjust" is the
// Economist's call, not re-derived here). Priced provisionally at 9, between
// deepwater(8)/slackWater(10) and oakHollow(6)/stoneMarker(7): flush costs a throwable
// (opportunity cost, unlike a plain walk) plus aim-and-timing, closer in effort to the
// former pair per the wiki proposal's own Scope section (game/mechanics/roost-decoy-mission,
// "closer in effort to Oak Hollow than to Slack Water" -- flagged there as an observation,
// not a proposed number).
export const MISSION_FLUSH_REWARD = 9;

export const MISSION_REWARDS: Record<MissionKind, number> = {
  deepwater: MISSION_FIREPOWER_REWARD,
  oakHollow: MISSION_OAKHOLLOW_REWARD,
  slackWater: MISSION_SLACKWATER_REWARD,
  stoneMarker: MISSION_STONE_MARKER_REWARD,
  radioMast: MISSION_RADIO_MAST_REWARD,
  flush: MISSION_FLUSH_REWARD,
};
```

### `engine/forest-engine.js`

**Import** — add `canCompleteFlush` to the existing `from '@/lib/game/mission'` import block
(`:201` area, alongside `canCompleteSlackWater`).

**`?qaRoostIndex=` param** — next to `qaForcedMissionKind` (`:342`):
```js
// LUL-5116: ?qaRoostIndex=<0-4> forces generateMap()'s flush-mission roost draw to a known
// index, same read-once-at-module-init shape as qaMissionKind above -- for a test that needs
// a specific roost deterministically instead of fighting the rng draw. Only takes effect
// when the drawn mission is 'flush'; ignored (parsed but unused) otherwise, same as
// qaMissionKind has no effect when a test doesn't also force that kind.
const qaForcedRoostIndex = qaParams ? qaParams.get('qaRoostIndex') : null;
```

**Roost-index draw** — in `generateMap()`, between `placeCave();` (`:1179`) and the
following `buildGrid();` (`:1180`):
```js
  placeCave();   // LUL-1904: new rng consumer -- must stay last, after mission
  // LUL-5116: draws which of the 5 ROOSTS this run's flush mission targets -- the new last
  // rng() consumer, appended after placeCave() per LUL-1904's stream-ordering rule (this
  // SPEC's Design call §2). No-op for every other mission kind. Respects ?qaRoostIndex for
  // deterministic e2e staging, falling back to the real draw when absent/out of range.
  if(mission.target.kind === 'flush'){
    const forced = qaForcedRoostIndex !== null ? parseInt(qaForcedRoostIndex, 10) : NaN;
    const idx = (forced >= 0 && forced < ROOSTS.length) ? forced : Math.floor(rng() * ROOSTS.length);
    mission = { ...mission, target: { ...mission.target, roostIndex: idx } };
  }
  buildGrid();   // landmarkData just changed (placeCave() may have pushed to it); same
```

**Completion check** — in `throwThrowable()`'s existing roost branch (`:6063-6069`), inside
the `flushRoost(nearestRoost)` block:
```js
  if(nearestRoost >= 0 && roostCooldown[nearestRoost] <= 0){
    flushRoost(nearestRoost);
    roostCooldown[nearestRoost] = ROOST_COOLDOWN;
    // LUL-5116: nearestRoost is the roost THIS throw just flushed -- the only call site
    // that can make canCompleteFlush true, per this mission's Q1.5 answer.
    if(mission && canCompleteFlush(mission, nearestRoost)) mission = completeMission(mission);
    if(!hintSeen('roostThrowCue')){
      markHintSeen('roostThrowCue');
      if(captionsOn) pushState({ caption: 'throw a stone at a roost to startle it', captionId: ++captionSeq });
    }
  }
```

**`qaProbeMission` field** — add `roostIndex` (`:4243`):
```js
  window.ForestEngine.qaProbeMission = function(){
    return mission && { kind: mission.target.kind, status: mission.status, x: mission.target.x, z: mission.target.z, roostIndex: mission.target.roostIndex };
  };
```

**New QA hook** — inside the `?qaHooks` block, next to `qaStagePredatorNearPlayer` (`:5619`):
```js
// [QA-HOOK] LUL-5116: flips predators[kind]'s FIRST live entry into 'chase' state without
// repositioning it -- composes with qaStagePredatorNearPlayer's existing dx/dz placement
// (call that first, then this) instead of duplicating its positioning logic. Needed because
// qaStagePredatorNearPlayer deliberately stages 'roam' (:5623, eight existing specs depend
// on that), and updateRoosts()'s ambient roost trigger (:2970) only fires for 'chase'.
// Mirrors qaStageRockClimb's existing "set p.state directly" pattern (:4714).
window.ForestEngine.qaSetPredatorChasing = function(kind){
  const idx = predators.findIndex(p => p.kind === kind);
  if(idx < 0) return null;
  const p = predators[idx];
  p.state = 'chase'; p.hunt = false;
  return { idx };
};
```

### `engine/forest-engine.d.ts`

`qaProbeMission` (`:579`), corrected and widened (Design call §3):
```ts
qaProbeMission?: () => { kind: MissionKind; status: 'active' | 'complete' | 'expired'; x: number; z: number; roostIndex?: number } | null;
```
(Import `MissionKind` from `@/lib/game/mission` at the top of the `.d.ts` if not already
imported — check before assuming a new import is needed.)

New, next to `qaStagePredatorNearPlayer`'s declaration (`:511`):
```ts
qaSetPredatorChasing?: (kind: 'wolf' | 'bear' | 'lion') => { idx: number } | null;
```

### `components/Hud.tsx`

`MISSION_NAMES` (`:345-351`):
```ts
const MISSION_NAMES: Record<MissionKind, string> = {
  deepwater: 'Fire Tower',
  oakHollow: 'Oak Hollow',
  slackWater: 'Slack Water',
  stoneMarker: 'Stone Marker',
  radioMast: 'Radio Mast',
  flush: 'Flush',
};
```

### `docs/ELEMENTS.md`

`### Missions (detour objectives)` section (`:1821+`):
- "Five members" → "Six members" (`:1824`), add `flush` to the member list sentence
  (`:1824-1832`): `— and `flush` (LUL-5116) — no world target, completes when a player-thrown
  stone flushes one specific roost of the 5 fixed `ROOSTS` (`engine/tuning.js:75`), named at
  mission-draw time.`
- "**Five variants (LUL-3010, LUL-4958, LUL-4900)**" (`:1837`) → "**Six variants (LUL-3010,
  LUL-4958, LUL-4900, LUL-5116)**", add a `flush` bullet mirroring the `slackWater` bullet's
  shape (`:1856-1866`): no world target, `spatial: false`, completes on the player-thrown
  roost-flush branch of `throwThrowable()` (not the ambient `updateRoosts()` path — name that
  distinction explicitly, it's the whole point of `canCompleteFlush`'s `roostIndex` check),
  `MISSION_FLUSH_REWARD` = 9 Embers (placeholder), no secondary support, produces no
  mission-nav hum (same `spatial: false` gate), renders in the existing generic
  `#missionPanel`.
- Reward list sentence (`:1881-1884`) gains `flush: MISSION_FLUSH_REWARD = 9` (placeholder).

Re-run `node scripts/check-elements-citations.mjs` after — re-derive every line number this
SPEC cites against whatever the branch has moved to before landing them, per this doc's own
citation-guard script.

## Verification

- `npx tsc --noEmit` — clean (baseline `layout.tsx` error only). Load-bearing for
  `MISSION_REWARDS`/`MISSION_NAMES`'s `Record<MissionKind, ...>` exhaustiveness and for
  `qaProbeMission`'s corrected `MissionKind` return type.
- `npm test` (unit) — existing mission-test coverage stays green; add unit cases for
  `canCompleteFlush()` (true only for status active + kind flush + matching roostIndex; false
  for every other combination, including a *different* valid roostIndex) mirroring
  `canCompleteSlackWater`'s existing test shape. Add a case to `eligibleMissionPool()`'s
  existing test confirming `flush` is excluded below `MISSION_FAR_UNLOCK_WINS`.
- `node scripts/check-elements-citations.mjs` — clean.
- `npx eslint .` (`lint` script) — clean.
- `npm run build` — clean.
- New e2e spec passes locally against a real build.

## e2e

**Specs.** `e2e/mission-flush.spec.ts` — new:
- `'completes Flush when the marked roost is flushed by a player throw'` — boot
  `{qaHooks: true, qaMissionKind: 'flush', qaRoostIndex: N}` (pick any fixed `N`, e.g. 0),
  `enter`, grab a stone (`qaTeleportNearThrowable` + `KeyE`, same `grabAThrowable` pattern
  `e2e/roost.spec.ts:18` already uses), `qaTeleportNearRoost(N)` (existing hook,
  `e2e/roost.spec.ts:85`'s precedent for passing an explicit index — no new teleport hook),
  throw at the locked target (`throwAtLockedTarget`, `e2e/roost.spec.ts:24`'s pattern),
  assert `qaProbeMission()` returns `{status: 'complete', roostIndex: N}` immediately after
  the throw. Also assert `#missionPanel` shows "Flush" before the throw (mirrors
  `e2e/mission-slack-water.spec.ts`'s panel-text assertion, LUL-5056's required remedy for
  every non-spatial mission kind).
- `'does NOT complete when an unrelated roost is flushed by the ambient chase-proximity
  trigger'` (the opposing-system test, Q11) — boot the same way with `qaRoostIndex: 0`,
  `qaTeleportNearRoost(1)` (a *different*, unmarked roost), `qaSetPredatorChasing('wolf')`
  (new hook) to put a live wolf in `'chase'` state, `qaStagePredatorNearPlayer('wolf', 5, 0)`
  to place it inside roost 1's radius relative to the player's current (roost-1-adjacent)
  position, advance a few real ticks (`qaSetFixedStep`/`advanceChunked`, `e2e/roost.spec.ts`'s
  own convention) so `updateRoosts()` (`:7156`) can fire, assert
  `qaProbeRoostState(1).burstActive === true` (proves the ambient path genuinely fired — the
  opposing system is real, not just staged-and-ignored), then assert
  `qaProbeMission().status` is still `'active'` (the wrong roost being flushed does not
  complete the mission). Then `qaTeleportNearRoost(0)`, grab a stone, throw, assert
  `qaProbeMission().status === 'complete'` (the marked roost still completes normally in the
  same run, proving the guard is roost-specific, not a general "any flush" block).
- `'does not complete when a different (unmarked) roost is flushed by a player throw'` — same
  boot, `qaRoostIndex: 0`, grab a stone, `qaTeleportNearRoost(1)`, throw at roost 1, assert
  `qaProbeRoostState(1).burstActive === true` (the throw-flush path fired normally) but
  `qaProbeMission().status` stays `'active'` (roost 1 isn't the marked roost) — the
  player-thrown-path sibling of the ambient-path test above, cheap to add since it reuses the
  same setup.

**World.** micro (default — `qaWorld: 'micro'`, no explicit staging call needed beyond the QA
hooks above; `applyQaWorldMicroPreset()` doesn't scale `ROOSTS`, engine/forest-engine.js's
`qaTeleportNearRoost` comment (`:5654-5661`) confirms roosts keep full-map positions in the
micro world, same as `e2e/roost.spec.ts` already relies on with no `@fullmap` tag). Not
`@fullmap` — nothing here needs the procedural map.

**Hooks.** `qaSetPredatorChasing(kind): {idx}|null` — new (declared above), composes with
existing `qaStagePredatorNearPlayer`. Existing hooks reused: `qaTeleportNearThrowable`,
`qaTeleportNearRoost(i)`, `qaProbeMission()` (extended with `roostIndex`), `qaProbeRoostState(i)`,
`qaStagePredatorNearPlayer`, `qaSetFixedStep`/`advanceChunked`.

**Tester scenario.** `shared/local-qa/requests/lul-5116-flush-mission.md` — written with this
SPEC (see file below). `#missionPanel` shows "Flush" with the generic ○/● glyph, same
screenshot-driven pattern as `lul-4958-slack-water.md`.

**Not covered.** `MISSION_FLUSH_REWARD`'s placeholder pricing (Game Economist's territory).
The bird-burst/chirp cue triple's own feel (Roost Scare's territory, unchanged by this
ticket — this SPEC adds zero new cues, see Cues below).

## Cues

**Visual.** None *new* — the existing 10-point bird-burst particle rise (`triggerRoostBurst`,
`engine/forest-engine.js:1631`) fires unconditionally on flush, unchanged.
**Audio.** None new — the existing chirp bursts (`roostFlushSound`, `:1666`).
**Explanation.** None new — the existing one-shot `roostThrowCue` caption
(`throwThrowable()`, inside the roost branch this SPEC edits) already covers the throw-at-a-
roost interaction; the mission panel adds only a name, not a new first-encounter surface.
**Reduced motion.** N/A — no new visual cue introduced (Roost Scare's own burst is a particle
rise, not a flash, so it was never motion-sensitive in the way a screen-flash would be).

This ticket adds no *new* player-facing cue (it reuses Roost Scare's shipped cue triple
verbatim, per the CEO acceptance's own "zero new cues" framing), so this section is
deliberately empty of new work — `decisions/0015-cue-triple` covers cues for *new*
affordances, not every diff.

## Constraints

- `MISSION_POOL` stays a flat array — the new roost-index draw is a `generateMap()`-level
  mutation of the already-drawn `mission` variable, not a `pickMission()`/`MISSION_POOL`
  change, so it doesn't touch the LUL-1904 stream-ordering rule beyond becoming its new last
  consumer (Design call §2).
- `deepwater`/`oakHollow`/`slackWater`/`stoneMarker`/`radioMast` get zero behavior change.
- `canCompleteFlush` must be a no-op read (no side effect, no mutation) — the only mutation is
  the single `mission = completeMission(mission)` assignment already gated by it in
  `throwThrowable()`, same shape as `canCompleteSlackWater`'s guarantee in `pickup()`.
- The `MISSION_REWARDS`/`MISSION_NAMES` `Record<MissionKind, ...>` exhaustiveness checks are
  the `tsc`-enforced guarantee this addition can't ship half-wired — do not use `Partial<>` or
  a type-cast to work around a missing entry.
- `qaSetPredatorChasing` must not reposition the predator — positioning stays
  `qaStagePredatorNearPlayer`'s job, composing the two is the test's responsibility, not this
  hook's.

## Out of scope

- The real `MISSION_FLUSH_REWARD` number — Game Economist's call, placeholder ships per this
  ticket's own explicit permission ("land with a placeholder... or coordinate merge order --
  your call").
- Adding predator-attraction to the roost sound (the "lure a predator away" framing the
  original ticket hinted at) — the wiki proposal's Why Now section already found and declined
  this (`decisions/lul-5116-m6-flush-accepted-2026-09-25`'s "Declined" line); not reopened
  here.
- Correcting `game/mechanics/roost-scare.md`'s stale "alerts nearby predators" claim — flagged
  by the Scout as a separate Q6 defect, not part of this diff.
- A secondary-objective variant for `flush` (`SECONDARY_SUPPORTED_MISSIONS` untouched).
- Any change to the four other mission kinds' existing behavior.
