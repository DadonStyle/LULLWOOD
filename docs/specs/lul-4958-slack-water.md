# SPEC: LUL-4958 M3 Slack Water mission

**Ticket:** LUL-4958 (split from LUL-1274) · **Tier:** C — new mission-completion shape hung
off the core pickup/win path (`lib/game/outcome.ts`'s `beginPickup()`), plus a
`MissionKind`/`MISSION_REWARDS` addition that is `Record`-exhaustive-checked by `tsc`.
`REVIEW: APPROVED` required before merge, per the CTO's PLAN comment on this ticket.

**Written against:** `release/next` @ `5c54576` (2026-09-24). Re-derive every `file:line`
below if the branch has moved.

**Source.** `decisions/missions-accepted-2026-09-01` (CEO acceptance) + `game/economy/mission-rewards`
(+10 Embers pricing, "the smallest in the set") + the CTO's PLAN comment on this ticket
(2026-09-24). Feature Checklist §0 already answered at proposal time per the ticket; this
SPEC only needs `## e2e`.

## Design call this SPEC makes (per the ticket's own "Founding Engineer's call" note)

M3 Slack Water's completion condition — lift the child while fog-tide is active — is **not**
the standard `MissionTarget`/`canCompleteMission()` shape at all, and the ticket's own citation
of `pickup()` needs one further correction beyond what it already flagged:

1. **`pickup()` (`engine/forest-engine.js:5732`) only *starts* the ~11.3s pickup cinematic.**
   The actual win transition — and the `mission?.status === 'complete'` read that decides the
   Embers bonus — happens in `finishPickup()` (`:5801`, reads `mission` at `:5832`), which
   fires when the cinematic ends, not when it starts. Fog Tide's active window is 20s; the
   cinematic is ~11.3s. If the fog-tide check ran at `finishPickup()` time instead of at the
   moment the player actually initiated the lift, a player who lifted the child in the last
   ~11.3s of the active window would be checked *after* the window had already closed —
   wrong by construction. **The check must snapshot `fogTideActive` at `pickup()`'s
   acceptance instant, not at `finishPickup()`'s.**
2. **This is also why M3 needs no expiry/reset logic at all** (matching the ticket's own Fail
   condition note): `lib/game/outcome.ts`'s `beginPickup()` is a one-shot transition
   (`decisions/lul-2281-pickup-is-the-win-2026-09-09` — the carry-home leg is gone,
   `completePickup()` wins outright). There is exactly one pickup event per run. If it happens
   outside the active window, `mission.status` simply never reaches `'complete'` for the rest
   of the run — nothing to expire, nothing to reset, matches "no explicit reset needed."
3. **`MissionTarget`'s existing shape (`x/z/zoneRadius/interactRadius`) has no field for
   this.** Rather than inventing a parallel non-`MISSION_POOL` mission type, this SPEC adds
   one optional field, `spatial?: boolean` (default true, so `deepwater`/`oakHollow` need no
   changes), and gives `slackWater` an all-zero, permanently-inert spatial footprint
   (`interactRadius: 0` makes `canCompleteMission()`'s strict `<` never true — the existing
   E-key completion path is a structural no-op for this mission, not a special case). A
   completely separate pure predicate, `canCompleteSlackWater()`, gates the real completion
   at `pickup()`'s call site. This keeps `MISSION_POOL` a single flat array (`pickMission()`
   untouched, no new rng consumer, satisfies the ticket's own LUL-1904 stream-ordering note by
   construction) while making the non-spatial case impossible to trigger through the spatial
   path by accident.
4. **The per-frame mission nav-cue hum must not point at `(0,0)`.** `tick()`
   (`engine/forest-engine.js:6892-6899`) unconditionally fires `missionWaypointHum(mission,
   distMission)` for any `active` mission — for `slackWater` this would hum the player toward
   the map origin, a real UX defect (a cue pointing at nothing), not an omission covered by
   "mission panel wiring is LUL-1098's territory." This SPEC gates that block on
   `mission.target.spatial !== false` so it simply never fires for `slackWater`, rather than
   firing at a meaningless location.

## Files

- `lib/game/mission.ts` — edited. `MissionKind` gains `'slackWater'`. `MissionTarget` gains
  optional `spatial?: boolean`. New `MISSION_POOL` entry. New pure function
  `canCompleteSlackWater()`.
- `lib/game/economy.ts` — edited. New `MISSION_SLACKWATER_REWARD` constant + `MISSION_REWARDS`
  entry (`Record<MissionKind, number>` is exhaustive-checked — `tsc` fails without this).
- `engine/forest-engine.js` — edited. Import, `pickup()`'s completion check, the
  `missionWaypointHum` gate, new `qaSetFogTideClock` QA hook.
- `engine/forest-engine.d.ts` — edited. `qaSetFogTideClock` hook declaration.
- `components/Hud.tsx` — edited. `MISSION_NAMES` gains a `slackWater` entry
  (`Record<MissionKind, string>` is exhaustive-checked — `tsc` fails without this; this is the
  one required-by-the-type-system touch, not new UI work, per the ticket's HUD-safe scope).
- `docs/ELEMENTS.md` — edited. Mission section's kind table gets a `slackWater` row.
- `e2e/mission-slack-water.spec.ts` — new.

## The change

### `lib/game/mission.ts`

```ts
export type MissionKind = 'deepwater' | 'oakHollow' | 'slackWater';

export interface MissionTarget {
  kind: MissionKind;
  x: number;
  z: number;
  zoneRadius: number;
  interactRadius: number;
  landmarkKind?: string;
  timeLimitSeconds?: number;
  /** LUL-4958: false for a mission whose completion condition is not "stand within
   * interactRadius of x/z" at all (the field's absence — true — covers every existing
   * mission unchanged). Gates the per-frame mission-nav-cue hum in
   * engine/forest-engine.js's tick() (:6892) — a mission with no real target position
   * must not hum the player toward one. Does NOT need to gate canCompleteMission() itself:
   * a non-spatial mission's interactRadius is 0, which already makes that path's strict
   * `<` permanently false by construction. */
  spatial?: boolean;
}

export const MISSION_POOL: readonly MissionTarget[] = [
  { kind: 'deepwater', x: -95, z: -95, zoneRadius: 20, interactRadius: 4, landmarkKind: 'fireTower', timeLimitSeconds: 60 },
  { kind: 'oakHollow', x: 22, z: 4, zoneRadius: 10, interactRadius: 4, landmarkKind: 'oak' },
  // LUL-4958: no real target position -- completion is "pickup() accepted while fog-tide is
  // active" (see canCompleteSlackWater below), checked at engine/forest-engine.js's pickup(),
  // not through canCompleteMission(). x/z/zoneRadius/interactRadius are inert placeholders;
  // interactRadius: 0 keeps the existing E-key/canCompleteMission() path permanently false
  // for this kind (0 < 0 is false), spatial: false keeps the nav-cue hum from firing at (0,0).
  { kind: 'slackWater', x: 0, z: 0, zoneRadius: 0, interactRadius: 0, spatial: false },
];
```

New pure function, next to `canCompleteMission` (`:163-165`):
```ts
/** LUL-4958: the player accepted the pickup (beginPickup() transitioned, not just attempted
 * it) while Fog Tide's active phase was live. Caller passes the engine's own fogTideActive
 * boolean, read at the exact instant pickup() accepts -- not re-derived here, this module
 * has no fog-tide import and should not gain one just to duplicate a boolean the engine
 * already computes every frame (lib/game/fogTide.ts's fogTidePhase() is the source of truth
 * for that boolean; this function only decides what to do with it). */
export function canCompleteSlackWater(mission: MissionState, fogTideActive: boolean): boolean {
  return mission.status === 'active' && mission.target.kind === 'slackWater' && fogTideActive;
}
```

### `lib/game/economy.ts`

Next to `MISSION_OAKHOLLOW_REWARD` (`:78`):
```ts
// LUL-4958: Slack Water -- +10 Embers, the smallest reward in the full M1-M5 mission set
// (M4 Ghost 18, M2 Deepwater 12, M5 Cold Walk 22, M3 Slack Water 10 -- wiki
// game/economy/mission-rewards:135-139). Deliberate floor price: this is the only mission
// that pays the player to stand still, which SURVIVAL_CAP is designed to discourage: "it
// pays once, for one 20-second window, and waiting past 120s still earns nothing" -- not an
// exploit, but priced at the floor as a watch-item per that doc.
export const MISSION_SLACKWATER_REWARD = 10;

export const MISSION_REWARDS: Record<MissionKind, number> = {
  deepwater: MISSION_FIREPOWER_REWARD,
  oakHollow: MISSION_OAKHOLLOW_REWARD,
  slackWater: MISSION_SLACKWATER_REWARD,
};
```

### `engine/forest-engine.js`

**Import** — add `canCompleteSlackWater` to the existing `from '@/lib/game/mission'` import
block (`:161`).

**Completion check** — in `pickup()` (`:5732`), right after the accept-check:
```js
function pickup(){
  const next = beginPickup(runState());
  if(next.pickingUp === pickingUp) return;   // rejected -- see pickupAllowed() in lib/game/outcome.ts
  // LUL-4958: snapshot fog-tide state at the instant the lift is ACCEPTED, not at
  // finishPickup() ~11.3s later -- see this SPEC's Design-call §1 for why the timing matters.
  if(mission && canCompleteSlackWater(mission, fogTideActive)) mission = completeMission(mission);
  baby.taken = next.babyTaken; pickingUp = next.pickingUp;
  ...
```
`fogTideActive` is the existing module-level boolean (`:448`, flipped every tick at `:6484-6489`
from `fogTidePhase(fogTideClock)`) — read directly, no new state.

**Nav-cue hum gate** — in `tick()`'s mission-hum block (`:6892-6899`):
```js
if(mission?.status === 'active' && mission.target.spatial !== false){
  missionHumTimer -= dt;
  if(missionHumTimer <= 0){
    missionWaypointHum(mission, distMission);
    const near = Math.max(0, Math.min(1, 1 - distMission / 140));
    missionHumTimer = 5.5 - near * 3.5;
  }
}
```
(single added clause, `&& mission.target.spatial !== false` — everything else in the block is
unchanged).

**QA hook** — new, inside the `?qaHooks` block next to `qaProbeMission` (`:4130`):
```js
// [QA-HOOK] LUL-4958: directly sets the fog-tide cycle accumulator for deterministic e2e
// staging -- the real cycle is a 90s wall/game-clock loop (lib/game/fogTide.ts
// FOG_TIDE_CONFIG), too slow to drive through qaAdvance() one real dt-step at a time for a
// per-test setup. Takes effect on the next tick's fogTidePhase() re-evaluation (:6484), same
// as a real elapsed-time crossing would -- not a force-set of fogTideActive itself, so the
// existing phase-transition tracking (chronicle/track() calls at :6485-6489) still fires
// correctly off this value, unlike a hook that set the derived boolean directly would.
window.ForestEngine.qaSetFogTideClock = function(seconds){
  fogTideClock = Math.max(0, seconds % FOG_TIDE_CONFIG.period);
};
```

### `engine/forest-engine.d.ts`

Add next to `qaProbeMission`'s declaration:
```ts
qaSetFogTideClock?: (seconds: number) => void;
```

### `components/Hud.tsx`

`MISSION_NAMES` (`:306`):
```ts
const MISSION_NAMES: Record<MissionKind, string> = {
  deepwater: 'Fire Tower',
  oakHollow: 'Oak Hollow',
  slackWater: 'Slack Water',
};
```

### `docs/ELEMENTS.md`

`### Missions (detour objectives)` section (`:1742+`) has no table, it's prose with a
"Two variants (LUL-3010)" subsection (`:1753`) — add a third bullet there:

```
- `slackWater` — no world target (`spatial: false`, `lib/game/mission.ts`); completes when
  the player accepts the child pickup (`pickup()`, `engine/forest-engine.js`) while Fog Tide
  (LUL-27) is in its `'active'` phase, `MISSION_SLACKWATER_REWARD` = 10 Embers. Checked once,
  at the instant `pickup()` is accepted, not re-checked or expirable afterward -- there is
  only one pickup per run (`decisions/lul-2281-pickup-is-the-win-2026-09-09`). No secondary
  support (`SECONDARY_SUPPORTED_MISSIONS` unchanged). Produces no mission-nav hum (the
  `spatial: false` gate on `missionWaypointHum`'s call site) and no new HUD surface (LUL-1098's
  territory).
```

Update the section header sentence "Two members" -> "Three members" and the intro list if it
enumerates them by name. Re-run `node scripts/check-elements-citations.mjs` after — this is a
small prose addition unlikely to shift other citations, but verify.

## Verification

- `npx tsc --noEmit` — clean (baseline `layout.tsx` error only). This is the load-bearing
  check for `MISSION_REWARDS`/`MISSION_NAMES`'s `Record<MissionKind, ...>` exhaustiveness —
  if either is missing the new key, this fails.
- `npm test` (unit) — existing `mission.test.ts`/equivalent unit coverage stays green; add
  unit cases for `canCompleteSlackWater()` (true only when status active + kind slackWater +
  fogTideActive; false for every other combination) mirroring `canCompleteMission`'s existing
  test shape.
- `node scripts/check-elements-citations.mjs` — clean.
- `npx eslint .` (`lint` script — `next lint` was removed in Next 16) — clean.
- `npm run build` — clean.
- New e2e spec passes locally against a real build.

## e2e

**Specs.** `e2e/mission-slack-water.spec.ts` — new:
- `'picking up the child while fog-tide is active completes Slack Water and pays the bonus'`
  — boot with `?qaMissionKind=slackWater&qaHooks=1`, enter, `qaHook(page, 'qaSetFogTideClock',
  75)` (75s into the 90s cycle — `activeStart = period - activeDuration = 70`, so 75 is well
  inside the active window), `qaTeleportNearBaby`, real `KeyE` press (matches
  `e2e/mission-deepwater.spec.ts`'s convention — real input path, not a force-hook, per Q1.5),
  assert `qaProbeMission()` returns `status: 'complete'` immediately (synchronous with the
  KeyE press, before the ~11.3s cinematic even finishes — proves the check fires at
  acceptance, not at `finishPickup()`), then wait for `#winScreen` and assert the payout
  included the +10 bonus (mirrors how `e2e/missions-fire-tower.spec.ts` or
  `e2e/mission-deepwater.spec.ts` already assert `lastPayout`, if either does — otherwise
  assert `embersBalance` delta against a pre-run baseline).
- `'picking up the child outside the active window does not complete Slack Water'` — same
  setup but `qaSetFogTideClock(0)` (calm phase) instead, same real KeyE pickup, assert
  `qaProbeMission().status` stays `'active'` through to the win screen and no bonus is paid.
- `'Slack Water produces no mission-nav hum'` — with `slackWater` drawn, advance a few real
  ticks (`qaSetFixedStep`/`qaAdvance`, matching this file's existing time-skip convention) and
  assert `missionWaypointHum` never fires — either via a QA hook that counts hum calls if one
  already exists for `missionWaypointHum`'s bearing/pan tests, or by asserting no console
  error/exception and no audio-graph node created for it if no counter hook exists (state
  which one you used).

**World.** micro (`qaBuildScene` default, `?qaMissionKind=slackWater` forces the pool draw —
existing mechanism, `engine/forest-engine.js:334`, no new world-staging code needed since this
mission has no spatial footprint to place). Not `@fullmap` — nothing here needs the
procedural map.

**Hooks.** `qaSetFogTideClock(seconds): void` — new (declared above). Existing hooks reused:
`qaTeleportNearBaby`, `qaProbeMission()`, `qaSetFixedStep`/`qaAdvance` (for the third test).

**Tester scenario.** "None: not player-visible in a way distinguishable from any other
mission's win-screen payout line — `#missionPanel`'s deepwater/oakHollow objective-text
convention does not apply here (no HUD wiring shipped this ticket, per scope), so there is no
new on-screen surface for the nightly tester to screenshot." If LUL-1098 later wires
`#missionPanel` copy for `slackWater`, that ticket files the request.

**Not covered.** The +10 Embers pricing's game feel (Economist's territory, already decided in
`game/economy/mission-rewards`). Fog Tide's own visual/audio telegraph (LUL-27, unchanged by
this ticket).

## Cues

**Visual.** None new — this ticket adds no HUD surface (out of scope, LUL-1098's territory).
The existing win-screen payout line already renders whatever `lastPayout.total` is
(`components/Hud.tsx`, pre-existing), which will include the +10 bonus with no code change on
that side.
**Audio.** None new.
**Explanation.** None new — no first-encounter caption, since there is no new interaction
surface for the player to encounter (the trigger is "however you already pick up the child,"
not a new input).
**Reduced motion.** N/A — no visual cue introduced.

This ticket is a pure event/reward-logic addition with no new player-facing surface, so the
cue triple is deliberately empty; `decisions/0015-cue-triple` covers cues for *new* affordances,
not every diff.

## Constraints

- Tier C: touches the core `pickup()` win path every run goes through. `canCompleteSlackWater`
  must be a no-op read (no side effect, no mutation) — the only mutation is the single
  `mission = completeMission(mission)` assignment already gated by it in `pickup()`.
- `MISSION_POOL` stays a flat array — no new `pickMission()` rng consumer, no change to the
  LUL-1904 stream-ordering rule (`generateMap()`'s `mission = pickMission(rng, ...)` at
  `:1140` still must run before `placeCave()`'s own rng draw at `:1149` — unchanged, not
  touched by this ticket, `slackWater` draws through the exact same `pickMission()` call
  every other kind does).
- `deepwater`/`oakHollow` get zero behavior change — `spatial` defaulting to `undefined`
  (truthy-equivalent via `!== false`) must be verified not to alter their nav-hum firing.
- The `MISSION_REWARDS`/`MISSION_NAMES` `Record<MissionKind, ...>` exhaustiveness checks are
  the tsc-enforced guarantee that this addition can't ship half-wired — do not use `Partial<>`
  or a type-cast to work around a missing entry.

## Out of scope

- `#missionPanel` objective-text / HUD copy for `slackWater` — LUL-1098's territory per the
  parent ticket's own scope carve-out. `MISSION_NAMES`'s new entry exists only to satisfy
  `tsc`'s exhaustiveness check, not to wire a new visible display.
- A secondary-objective variant (`SECONDARY_SUPPORTED_MISSIONS` is untouched — `slackWater` is
  not in the set, same as `oakHollow` today).
- Fog Tide's own mechanic (LUL-27, unchanged).
- Any change to `deepwater`/`oakHollow`'s existing behavior.
