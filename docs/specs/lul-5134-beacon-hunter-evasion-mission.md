# SPEC: LUL-5134 Beacon Hunter Evasion mission (Fire Tower/M1 variant)

**Ticket:** LUL-5134 (PLAN from LUL-5130/CTO, source LUL-5121 CEO-accepted +
`decisions/lul-5121-beacon-hunter-evasion-accepted-2026-09-25` + wiki
`game/mechanics/beacon-hunter-evasion-mission`, Section 0 answered by Feature Scout — not
re-derived here). **Tier: A** — one line: a `MissionKind`/`MISSION_POOL`/`MISSION_REWARDS`
addition (same shape as LUL-3010/LUL-4900, `Record`-exhaustive-checked by `tsc`, no new
render surface, no new predator behavior) plus a post-mission-draw predator reposition that
touches no existing mission's rng draw. No blocking Code Reviewer pass required; merges on
green CI + `local-qa: PASS`.

**Written against:** `release/next` @ `746b144` (2026-09-25). Re-derive every `file:line`
below if the branch has moved.

## Two corrections to the PLAN (read before implementing)

**1. Naming: use `'beaconEvasion'`, not the Economist's `'beaconHunterEvasion'`.**
`game/economy/beacon-hunter-evasion-repriced-2026-09-25.md` (Game Economist, LUL-5131,
today) independently names the kind `'beaconHunterEvasion'` and gives a resolved reward —
**not a placeholder**. The PLAN (LUL-5130), by contrast, cites `'beaconEvasion'` by exact
`file:line` in five separate places (union member, `MISSION_POOL` entry, the
`?qaMissionKind=` hook value, both `HINT_PRIORITY`-adjacent switch cases). This SPEC follows
the PLAN's naming throughout — one ticket's five internally-consistent citations beat a
second ticket's differently-named recommendation — but takes the Economist's **resolved
value**, not a placeholder: `MISSION_BEACON_HUNTER_EVASION_REWARD = 8` (LUL-5131 status:
"Repricing complete... CTO (LUL-5130) can implement"). Do not write a "placeholder pending
LUL-5131" comment; LUL-5131 is done.

**2. The PLAN's HINT_PRIORITY step is incomplete as written — it omits `HINT_TEXT`.**
Step 5 of the PLAN says add `'beaconEvasion'` to `HINT_PRIORITY` (`engine/forest-engine.js:1988`)
and steps 6–7 add the two switch cases. But the hint render call site
(`engine/forest-engine.js:7695` and `:7698`) reads `HINT_TEXT[key]` directly with no
fallback — a `HINT_PRIORITY` entry with no matching `HINT_TEXT` entry pushes
`hintText: undefined` into `EngineHudState`, rendering a blank/undefined caption the first
time this mission is drawn. This SPEC adds the `HINT_TEXT` entry the PLAN missed. (Separately,
note `'stoneMarker'`/`'radioMast'` — LUL-4900 — were never added to `HINT_PRIORITY` *or*
`HINT_TEXT` at all, so eligibility never mattered for them; that's a pre-existing gap in
LUL-4900's own scope, not something this ticket backfills.)

## Files

- `lib/game/mission.ts` — edited. `MissionKind` gains `'beaconEvasion'`. New `MISSION_POOL`
  entry.
- `lib/game/economy.ts` — edited. New `MISSION_BEACON_HUNTER_EVASION_REWARD` constant +
  `MISSION_REWARDS` entry.
- `lib/game/economy.test.ts` — edited. Exhaustive key-set assertion (~:164–168) gains
  `'beaconEvasion'`.
- `components/Hud.tsx` — edited. `MISSION_NAMES` gains a `beaconEvasion` entry.
- `engine/forest-engine.js` — edited. `HINT_PRIORITY` array, `HINT_TEXT` map, two
  `hintCandidate()`/`hintDismissedByEvent()` switch cases, one new function
  (`repositionBeaconHunterForMission()`) + its call site in `generateMap()`.
- `engine/forest-engine.d.ts` — edited. Fixes a pre-existing type-drift bug found while
  reading this code: `qaTeleportNearMission`, `qaTeleportAtMissionTarget`, and
  `qaProbeMission` all hardcode `kind: 'deepwater' | 'oakHollow'` (stale since LUL-3010;
  never updated for `slackWater`/`stoneMarker`/`radioMast` either). Import `MissionKind`
  from `lib/game/mission.ts` and use it in all three, instead of adding a fourth stale
  literal.
- `e2e/helpers.ts` — edited. `boot()`'s `qaMissionKind` param type union
  (~:103) gains `'beaconEvasion'`.
- `e2e/beacon-hunter-evasion-mission.spec.ts` — new.
- `docs/ELEMENTS.md` — edited. Missions section (~:1821–1895): sixth variant.
- `shared/local-qa/requests/lul-5130-beacon-hunter-evasion-mission.md` — new (per PLAN Q13,
  named for the PLAN ticket per its own instruction; adapts the wiki page's draft to the
  hooks actually named below).

## The change

### `lib/game/mission.ts`

```ts
export type MissionKind = 'deepwater' | 'oakHollow' | 'slackWater' | 'stoneMarker' | 'radioMast' | 'beaconEvasion';
```

New `MISSION_POOL` entry (append after the `radioMast` entry, ~:111). Reuses the same
`fireTower` landmark as `deepwater` — confirmed safe: `fireTower` is placed unconditionally
every round (`engine/tuning.js:64` `LANDMARKS`), independent of which mission is drawn, and
`syncMissionTargetToLandmark()` (`lib/game/mission.ts:183`) does a plain `find()` by
`landmarkKind`, so two pool entries sharing one `landmarkKind` is not a new case for it —
only one mission is ever active per run.

```ts
// LUL-5134: Beacon Hunter Evasion (M1) -- same fireTower target/timing as deepwater, but a
// Beacon Hunter wolf is repositioned ~50u from it after the mission draw (see
// repositionBeaconHunterForMission() in engine/forest-engine.js) instead of a new spatial
// shape here. timeLimitSeconds (non-null) already excludes this from eligibleMissionPool()
// pre-3-wins via the existing `timeLimitSeconds == null` filter (~:154) -- no gating change.
{ kind: 'beaconEvasion', x: -95, z: -95, zoneRadius: 20, interactRadius: 4, landmarkKind: 'fireTower', timeLimitSeconds: 60 },
```

### `lib/game/economy.ts`

Add after `MISSION_RADIO_MAST_REWARD` (~:92):

```ts
// LUL-5131 (Game Economist repricing, wiki game/economy/beacon-hunter-evasion-repriced-2026-09-25):
// priced level with MISSION_FIREPOWER_REWARD (8) despite the added threat -- "timed + threat +
// stamina pressure" against vanilla Fire Tower's "timed, no threat", conservative pending
// telemetry on a mechanic (Scent Veil) that shipped one day before this pricing.
export const MISSION_BEACON_HUNTER_EVASION_REWARD = 8;
```

`MISSION_REWARDS` (~:88) gains:

```ts
beaconEvasion: MISSION_BEACON_HUNTER_EVASION_REWARD,
```

### `lib/game/economy.test.ts`

The exhaustive key-set assertion (~:164–168) becomes:

```ts
assert.deepEqual(
  Object.keys(MISSION_REWARDS).sort(),
  ['beaconEvasion', 'deepwater', 'oakHollow', 'radioMast', 'slackWater', 'stoneMarker'],
);
assert.equal(MISSION_REWARDS.beaconEvasion, MISSION_BEACON_HUNTER_EVASION_REWARD);
```
(plus the existing five `assert.equal` lines, unchanged — import `MISSION_BEACON_HUNTER_EVASION_REWARD` alongside the other five constants at the top of the file.)

### `components/Hud.tsx`

`MISSION_NAMES` (~:345) gains:

```ts
beaconEvasion: 'Beacon Evasion',
```

(Deliberately distinct from `deepwater`'s `'Fire Tower'` display name — both target the same
landmark, and `#missionPanel` names the mission kind, not the landmark, so a duplicate label
would make the two missions indistinguishable on screen.)

### `engine/forest-engine.js`

**`HINT_PRIORITY`** (~:1988) — append after `'oakHollow'`:

```js
const HINT_PRIORITY = ['scent','landmark','deepwater','oakHollow','beaconEvasion',
  'wolf','bear','lion','beaconHunter','stamina','windAssist','windPulse','cover','caveImmune','rockClimb','veilOverload','throwable','veil'];
```

**`HINT_TEXT`** (~:2000, after the `oakHollow` line) — new entry (see "Two corrections" above
for why this is required, not optional):

```js
beaconEvasion: 'the fire tower — a Beacon Hunter patrols the approach. veil (F) breaks its lock if it catches your scent on the wind',
```

**`hintCandidate()`** switch (~:7588, immediately after the `'oakHollow'` case):

```js
case 'beaconEvasion': return [!!mission && mission.target.kind === 'beaconEvasion' && mission.status === 'active', null];
```

**`hintDismissedByEvent()`** switch (~:7625, immediately after the `'oakHollow'` case):

```js
case 'beaconEvasion': return missionCanComplete;
```

(`hintDismissBaselineFor()` needs no case — its `default: return 0` already covers
`deepwater`/`oakHollow` the same way, since dismissal here is driven by `missionCanComplete`,
not an event-count baseline.)

**New function** — place immediately after `relocateParkedHunter()` (ends `engine/forest-engine.js:1917` today), which is this function's own precedent for repositioning a live predator via a fresh `rng()` draw outside `placePredators()`:

```js
// LUL-5134: post-mission-draw-only repositioning for the Beacon Hunter Evasion mission.
// placePredators() (:1819) runs BEFORE the mission is drawn (see the LUL-1258 comment at
// generateMap()'s tail), so "spawn ~50u from the mission target" cannot be expressed as
// MISSION_POOL data -- it needs this second placement pass. Only ever called when
// mission.target.kind === 'beaconEvasion', so it can never perturb the tree/predator/mission
// rng stream any other seed depends on -- it is new, additive rng consumption gated on a kind
// that didn't exist before this ticket. Mirrors placePredators()'s own do/while shape
// (:1848-1850) for the position draw, and its post-draw reset field list (:1850-1854)
// verbatim, so this hunter starts this round exactly as "fresh" as it would from a normal
// placePredators() draw, not mid-chase from wherever it was first placed.
function repositionBeaconHunterForMission(mission){
  if(mission.target.kind !== 'beaconEvasion') return;
  const hunter = predators.find(p => p.variant === 'beaconHunter');
  if(!hunter) return;   // never expected: wolf.0 is a permanent beaconHunter (:1810), never inert (:1800-1803)
  let x, z, tries = 0;
  do {
    const ang = rng()*Math.PI*2;
    x = mission.target.x + Math.cos(ang)*50;
    z = mission.target.z + Math.sin(ang)*50;
    tries++;
  } while(blockedR(x, z, hunter.rad+0.5) && tries < 60);
  hunter.x = x; hunter.z = z; hunter.wpx = x; hunter.wpz = z; hunter.vx = 0; hunter.vz = 0; hunter.yaw = rng()*Math.PI*2;
  const [ccx, ccz] = chunkXZ(x, z), [pcx, pcz] = chunkXZ(player.x, player.z);
  hunter.parked = Math.max(Math.abs(ccx-pcx), Math.abs(ccz-pcz)) > STREAM_RADIUS_CHUNKS;
  hunter.g.visible = !hunter.parked;
  // Verbatim placePredators() reset list (:1850-1854) -- do not add fields beyond this list
  // (e.g. beaconHunterLocked/eye color need no reset here: :2443 already clears both on the
  // first tick whenever state !== 'chase', the same way a normal placePredators() restart
  // relies on, with no explicit reset there either).
  hunter.state='roam'; hunter.spotted=false; hunter.inv=''; hunter.sniffsLeft=0; hunter.sniffTimer=0; hunter.callTimer=0;
  hunter.stuckT=0; hunter.trail=[]; hunter.trailT=0; hunter.reroute=0; hunter.hunt=DIFFICULTY_PRESETS[difficulty].startHunting; hunter.alert=0; hunter.windPauseT=0; hunter.windPauseCooldownT=0; hunter.scentLock=0; hunter.scentCalls=0; hunter.scentVeilReady=false;
  hunter.packTimer=0; hunter.flankX=0; hunter.flankZ=0; hunter.sniffImmuneT=0; hunter.sightFlicker=0;
  hunter.lkpX=0; hunter.lkpZ=0; hunter.lkpSweeps=0;
  hunter.charge=null; hunter.chargeDirX=0; hunter.chargeDirZ=0; hunter.chargeCooldown=0; hunter.chargeRecoveryT=0;
  hunter.gaveUpAt=null;
  hunter.g.position.set(x, 0, z); hunter.g.rotation.set(0, hunter.yaw, 0);
}
```

**Call site** in `generateMap()`: insert right after the `buildGrid();` call that follows
`placeCave()` (today's exact lines):

```js
  placeCave();   // LUL-1904: new rng consumer -- must stay last, after mission
  buildGrid();   // landmarkData just changed (placeCave() may have pushed to it); same
                  // reasoning as the LUL-374 buildGrid() call above
  repositionBeaconHunterForMission(mission);   // LUL-5134: after placeCave(), not before --
                                                 // placeCave()'s own comment says it "must
                                                 // stay last, after mission"; this is a second,
                                                 // separate rng consumer gated on a kind that
                                                 // never existed before this ticket, so its
                                                 // exact position past that point cannot
                                                 // perturb any existing seed either way.
```

Do **not** insert before `placeCave()` — preserve its documented invariant exactly.
`blockedR()` here also correctly treats the placed cave as solid, since it runs after the
`buildGrid()` that already accounts for `placeCave()`'s own additions to `landmarkData`.

### `engine/forest-engine.d.ts`

Add near the top (alongside the existing `EngineActions`/`EngineHudState` import,
`engine/forest-engine.d.ts:7`):

```ts
import type { MissionKind } from '@/lib/game/mission';
```

Replace all three stale literal unions:

```ts
qaTeleportNearMission?: () => { kind: MissionKind; x: number; z: number; status: 'active' | 'complete' | 'expired' } | null;
qaTeleportAtMissionTarget?: () => { kind: MissionKind; x: number; z: number; status: 'active' | 'complete' | 'expired' } | null;
qaProbeMission?: () => { kind: MissionKind; status: 'active' | 'complete' | 'expired'; x: number; z: number } | null;
```

### `e2e/helpers.ts`

`boot()`'s `qaMissionKind` param type (~:103):

```ts
qaMissionKind?: 'deepwater' | 'oakHollow' | 'slackWater' | 'stoneMarker' | 'radioMast' | 'beaconEvasion' | null;
```

## Verification

- `npx tsc --noEmit` — clean (exercises both `Record<MissionKind, ...>` exhaustiveness
  checks and the `.d.ts` import).
- `npm run lint` (via `eslint`, per the founder's Next-16 note) — clean.
- `node --test lib/game/economy.test.ts` (or the project's full unit-test command) — the
  updated exhaustive key-set assertion passes.
- `npx playwright test e2e/beacon-hunter-evasion-mission.spec.ts e2e/beacon-hunter.spec.ts e2e/scent-veil.spec.ts e2e/mission-deepwater.spec.ts e2e/hints.spec.ts` — new spec passes; the
  four regression specs pass unchanged (deepwater still draws/completes correctly with a
  second `fireTower`-targeted pool entry present; hints' fresh-boot landmark test is
  unaffected since `beaconEvasion` is timed and therefore excluded from
  `eligibleMissionPool()` pre-3-wins, same mechanism as `deepwater`).
- `next build` — clean.
- Confirm green CI + `local-qa: PASS` on the PR before calling this done (per the ticket;
  not a Tier C block, just the founder's GitHub-queue rule that a PR isn't done until its
  checks say so).

## e2e

**Specs.**
- `e2e/beacon-hunter-evasion-mission.spec.ts` — **new**. "completes after a real Scent Veil
  break clears a real Beacon Hunter lock" — the opposing system is a live, wind-detecting
  Beacon Hunter (not a QA-hook force-set lock, per PLAN Q1.5 discipline): the test sprints the
  player against the wind into a staged `beaconHunter`-variant wolf (mirrors
  `e2e/beacon-hunter.spec.ts`'s own staging exactly), asserts a real lock (`state: 'chase'`,
  `beaconHunterLocked: true`, `scentLock > 0`), breaks it with a real `KeyG` press while moving
  against wind (mirrors `e2e/scent-veil.spec.ts`'s break sequence exactly, including its
  `scentVeilReady`/`veilPrompt` assertions), then teleports to the mission target via
  `qaTeleportAtMissionTarget()` and completes with a real `KeyE` press.
- `e2e/mission-deepwater.spec.ts`, `e2e/missions-fire-tower.spec.ts` — must pass unchanged
  (proves a second `fireTower`-targeted pool entry doesn't perturb `deepwater`'s own draw/
  completion/exposure behavior).
- `e2e/hints.spec.ts` — must pass unchanged (proves `beaconEvasion`'s timed exclusion from
  `eligibleMissionPool()` pre-3-wins keeps a fresh `boot()` drawing only `oakHollow`, same as
  today).

**World.** micro (`qaWorld: 'micro'`, the `boot()` default — no `@fullmap`; a Beacon Hunter
is a predator variant, not map geometry). Stage: `qaHook(page, 'qaBuildScene', { predators:
[{ kind: 'wolf', x: 0, z: -8, state: 'roam', variant: 'beaconHunter' }], props: [{ kind:
'bramble', x: 0, z: -4 }] })` — identical geometry to `e2e/beacon-hunter.spec.ts`'s own
staging, so the lock-on proof is load-bearing, not incidental. Force the mission via
`boot(page, { qaHooks: true, qaMissionKind: 'beaconEvasion' })` (existing, generic hook —
LUL-3010 built it for exactly this, no new hook needed once `e2e/helpers.ts`'s type union is
widened above).

**Hooks.** All existing, no new hooks:
- `qaBuildScene` — `engine/forest-engine.js:5833` (predator/prop staging).
- `qaSetWindDirection(x, z)` — used by both `e2e/beacon-hunter.spec.ts` and
  `e2e/scent-veil.spec.ts`.
- `qaSetFixedStep(dt)` / `qaAdvance(steps, holdKeys?)` — deterministic frame stepping.
- `qaPredatorState(idx|kind)` — reads `state`/`scentLock`/`beaconHunterLocked`/`variant`.
- `qaProbeMission()` — reads `{ kind, status, x, z }` (now correctly typed per the `.d.ts` fix
  above).
- `qaTeleportAtMissionTarget()` — `engine/forest-engine.js:5743` (generic, works for any
  `MissionKind` unchanged — verified above it does not switch on `kind`).

**Tester scenario.** `shared/local-qa/requests/lul-5130-beacon-hunter-evasion-mission.md`
(new, filed with this SPEC — adapts the wiki page's draft to the verb-grammar steps: sprint
into wind toward the Beacon Hunter, press `G` on lock, run to the Fire Tower, press `E`;
verdict checks the same four points the wiki draft lists).

**Not covered.** Feel of the escape-window pacing (is 50u the right spawn distance for a
satisfying chase-then-lose-it beat) — real-device/manual, same as every other mission's pacing
tuning. Eye-color glow visibility across lighting conditions — manual, `BEACON_HUNTER_EYE_COLOR`
(`engine/tuning.js:323`) is pre-existing, unchanged by this ticket.

## Cues

No new cues — this ticket composes two already-shipped cue triples, unchanged:

**Visual.** Beacon Hunter eye color swap to `BEACON_HUNTER_EYE_COLOR` (cold blue-teal,
`engine/tuning.js:323`) on lock (`engine/forest-engine.js:2183`, existing, LUL-4897).
`#veilPrompt` row in `#actionSlot` on scent-lock (existing, LUL-5004).
**Audio.** `scentVeilBreakCue()` / `scentVeilDeniedCue()` (`engine/forest-engine.js:2208-2210`,
existing, LUL-5004).
**Explanation.** New: the `HINT_TEXT.beaconEvasion` first-encounter caption above (first time
this mission kind is drawn, fires once per install per `HINT_PRIORITY`'s existing
once-ever-per-key behavior — same mechanism `deepwater`/`oakHollow` already use, no new gate).
**Reduced motion.** Unchanged from existing Beacon Hunter/Scent Veil behavior — the eye color
swap is a static color change, not an animation (`engine/forest-engine.js:2183`'s own
comment: "visible under reducedMotion since it's a static color, not an animation").

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- No change to `canCompleteMission()`, `syncMissionTargetToLandmark()`, `checkMissionExpiry()`,
  or `missionWaypointHum()`'s gating — all are already generic over `MissionKind`/`spatial`;
  this ticket's mission target uses their existing, unmodified paths (confirmed by reading
  each; none switches on `kind`).
- `repositionBeaconHunterForMission()` must only ever fire for `mission.target.kind ===
  'beaconEvasion'` — it is new rng consumption, and firing it for any other kind (including by
  accident, e.g. moving the guard) would perturb every other seed's predator layout from that
  point in the stream forward (LUL-1258/LUL-1904 invariant).
- Do not touch `SECONDARY_SUPPORTED_MISSIONS` (`lib/game/mission.ts:234`) — it already excludes
  `beaconEvasion` by omission (opt-in set, contains only `'deepwater'`), matching the wiki's
  "no secondary objectives" requirement with zero code change.

## Out of scope

- Backfilling `stoneMarker`/`radioMast` into `HINT_PRIORITY`/`HINT_TEXT` — a pre-existing
  LUL-4900 gap, not introduced or worsened by this ticket, and fixing it is a separate ticket's
  scope (different reward/tuning owner).
- Any new predator behavior, mobile-specific input, or HUD element — per the wiki's Cheap
  Slice, this reuses every mechanic verbatim (Beacon Hunter detection, Scent Veil break,
  generic mission panel/interact).
- Telemetry validation of the 8-Embers price — LUL-5131's own "Telemetry Monitor" section
  is a 2–4-week follow-up, not this ticket's.
