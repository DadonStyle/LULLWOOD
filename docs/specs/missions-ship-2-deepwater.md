# SPEC: Missions Ship 2 -- M2 Deepwater detour

**Ticket:** LUL-1258. **Tier: C** (touches `engine/forest-engine.js` detection/simulation and
win/lose-adjacent state -- new mission-complete condition, new predator-adjacent audio, economy
change).

**Citations below re-verified directly against `origin/release/next @ 60904fc`** (2026-09-06,
six commits ahead of this spec's original `e426f8a` base -- re-checked line-by-line rather than
assumed still valid; two had drifted and are corrected here: `hollowLogSound` is `:1880`, not
`:1853`, and `hearNoise` is `:1203`, not `:1214`, in both `e426f8a` and current head -- these were
wrong at the original citation, not a drift caused by the six intervening commits). Do not copy
them forward without re-checking (see `game/mechanics/ship1-wayfinding-stalled` for what happens
when a spec's citations drift). Confirmed unaffected by the six intervening commits: Ship 1
(LUL-1255, PR #356) merged as spec-only in that window -- `grep -rn "childCry\|hearCry"
engine/forest-engine.js` still returns zero hits on `60904fc`, so the dependency note below still
holds.

## Dependency status -- read before assigning the implementation ticket

**Ship 1 (LUL-1255) is spec-only, not yet implemented.** `docs/specs/lul-1255-wayfinding-ship1.md`
landed on `release/next` (PR #356, Tier A), but `grep -r "cry\|Cry" engine/forest-engine.js`
returns zero hits as of `e426f8a` -- `childCry()`, `hearCry()`, the raised `homeLight` distance,
and the landmark first-run caption do not exist in code yet. This spec is written so Ship 2's
own implementation does not require Ship 1's code to exist first (S1-S3 below stand alone), but
**S4 (the mission's navigation cue) is written to reuse Ship 1's panner/tempo pattern by
reference, not by calling Ship 1 code that isn't there yet** -- see S4's note. Implementer:
confirm at pickup time whether Ship 1 has landed; if it has, S4 should additionally reuse
whatever shared "procedural point-source audio" helper Ship 1's PR actually factored out,
instead of duplicating the pattern.

## Flagged risk -- possible duplicate mission-struct effort, not resolved by this spec

**`game/economy/secondary-objectives` / `decisions/secondary-objectives-accepted-2026-09-06`
(ticket LUL-1666, also assigned to Founding Engineer) names its own "M2 Deepwater" with a
different shape and different numbers** (`missionObjective.secondary = { kind: 'retrieval' |
'speedrun' }`, retrieval +15E / speedrun +18E) from the mission this ticket specs (one-active-
per-run detour to a fixed landmark, +12E flat, per `game/economy/mission-rewards` and
`decisions/missions-accepted-2026-09-01`). Both cite `LUL-1098` as their parent epic. This may
be two independent proposals that were never reconciled (the same root cause the CEO already
found and corrected once this week for LUL-1595/1670/1587 -- see
`decisions/secondary-objectives-approved-2026-09-06`), or it may be intentional -- e.g. the
`retrieval`/`speedrun` field could be meant to layer *onto* the M2 Deepwater mission this spec
defines, once it exists, rather than replace it. **I am not resolving this in this spec** -- it
is a sequencing/architecture question above my ticket's scope, not an implementation ambiguity
inside it. Filing **LUL-1667** for the VP R&D / CTO to reconcile before LUL-1259 (Ship 2
implementation) and LUL-1666 (secondary objectives implementation) both proceed, since if both
land independently they will likely collide on the same `missionObjective`-shaped state and
possibly double-pay the same completion.

## Why this exists

Ship 1 gives the player a diegetic way to be pulled *toward* something in the fog. M2 Deepwater
is the first payoff for that: an optional detour to a fixed, named landmark (the drowned car)
that trades progress toward home for Embers, with the same audio-navigation language Ship 1
establishes for the child. Per `decisions/missions-accepted-2026-09-01` §1, missions are a POOL
with one active per run; M2 is the first (and, per this ticket's scope, only) member implemented
today. The struct below is written so a later ticket can add M1/M3/M4/M5 by extending an array,
not by reshaping this one.

## Files

- `engine/forest-engine.js` -- mission state, zone/interact check, tick-loop hook, audio cue,
  mission-complete trigger wired through the existing interact path (S1-S5)
- `lib/game/mission.ts` (new) -- pure mission-state helpers, no Three.js, no engine imports
  (S1, S3)
- `lib/game/economy.ts` -- M2 Deepwater completion bonus, added to `computeWinPayout` only (S2)
- `lib/game/mission.test.ts` (new) -- unit coverage for the pure helpers (S1, S3)
- `docs/ELEMENTS.md` -- new "Missions" subsection (S6, same PR)

## S1 -- Mission struct and seeded selection (`lib/game/mission.ts`, new file)

Pure module, mirroring the style of `lib/game/outcome.ts` (no side effects, no Three.js):

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
  // Coordinates match LANDMARKS' drownedCar entry (engine/forest-engine.js:207) --
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
```

**Selection timing:** call `pickMission(rng)` once per run at the same point the run's seeded
map/predator RNG is otherwise consumed (find the `rng` instance already threaded through map
generation -- grep `pickHardBabyPosition(rng` at `engine/forest-engine.js:702` for the existing
call-site pattern -- and add the mission draw immediately after, so it consumes the same seeded
stream and stays deterministic for replay/testing). Store the result in a new top-level `let
mission = null;` alongside the other per-run state (near `baby` at `:893`), set on
run-start/restart, not at module load.

## S2 -- Economy: the completion bonus (`lib/game/economy.ts`)

Per `game/economy/mission-rewards` §2: M2 pays **+12 Embers as a completion bonus only**, and
it is **forfeited on death** exactly like `CARRIED`/`HOME` -- the detour's real value is already
paid through `depth` (reaching the drowned car raises `maxDistFromHome` to ~212 units, `depth`
53 vs. a median run's 19), which the existing `computeDeathPayout` already handles (and already
caps at the child's own max spawn distance, `engine/forest-engine.js` depth-cap logic already
shipped in `computeDeathPayout`'s `Math.min(computeDepth(maxDistFromHome),
computeDepth(objectiveDistFromHome))` at `lib/game/economy.ts` -- confirmed present, not a gap
this spec needs to fix). Making the +12 win-only, not death-payable, is what makes "complete the
mission, then die before reaching home" a real loss -- the greed/risk trade-off the ticket asks
for.

```ts
// LUL-1258: M2 Deepwater's completion bonus. Win-only, like CARRIED/HOME --
// forfeited on death, same as the rest of the "reached it but didn't make it
// home" case. The detour's real payout is `depth` (uncapped on win, capped on
// death already); this is a flat bonus on top, priced deliberately low per
// game/economy/mission-rewards §2 ("the greed comes from the depth").
export const MISSION_DEEPWATER_REWARD = 12;

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

`RunPayout`'s shape is unchanged (no new field) -- `missionBonus` folds into `total` the same
way `TIER_MULTIPLIERS` already does, since the mission-rewards page's own worked table (`Net if
completed + banked`) treats it as additive to the run total, not as a separately-displayed
number. At the call site (`arriveHome()`, `engine/forest-engine.js:2853`), pass
`mission?.status === 'complete' ? MISSION_DEEPWATER_REWARD : 0` as the fourth argument.
`computeDeathPayout` (`triggerDeath()` path) is **not modified** -- no argument added, per the
forfeiture design above.

## S3 -- Completion trigger, wired through the existing interact path

**Do not add a new key or a new `EngineActions` method.** Ticket scope says "no new actions
yet, mission-complete trigger via `EngineActions`" -- this means reuse the interact action that
already exists for pickup, not add a second one. Both `KeyE`'s handler (`:1676`) and
`triggerTouchInteract()` (`:3544-3546`) currently call `pickup()` unconditionally when the
module-level `canPickup` (camelCase -- not `canpickup`) is true; extend both to also check the
mission:

```js
// :1676, extended
if(e.code === 'KeyE' && playing && !paused){
  if(canPickup) pickup();
  else if(missionCanComplete) completeMissionSequence();
}
```
```js
// :3544-3546 (triggerTouchInteract), extended the same way
function triggerTouchInteract() {
  if(canPickup && playing && !paused) pickup();
  else if(missionCanComplete && playing && !paused) completeMissionSequence();
}
```

`missionCanComplete` is computed once per tick alongside `canPickup` at `:3354`, using S1's pure
helper:

```js
// alongside :3354's canPickup = canPickUp(...)
const distMission = mission ? distToMissionTarget(mission, player.x, player.z) : Infinity;
const missionCanComplete = mission ? canCompleteMission(mission, distMission) : false;
```

**Prompt text:** extend the objective-pill logic at `:3380-3383` with a mission-aware branch --
when `!carrying && mission?.status === 'active' && distMission < mission.target.zoneRadius`,
the pill should be able to show `'Press  E  at the drowned car'` once in interact range, same
shape as the existing `'Press  E  to lift the child'` line. When outside the zone but the
mission is active, the child-distance pill is unaffected (the mission does not replace the
existing objective text -- it is a detour, not a mode switch, and the child pill is the only
readout Ship 1 is changing).

**`completeMissionSequence()`** (new function, sibling to `finishPickup()` at `:2841`):

```js
// LUL-1258: M2 Deepwater's completion. No cinematic lock (unlike pickup's
// ~2.5s gather) -- this is a detour bonus, not the core objective, and
// stopping the player's clock here would undercut the risk this mission is
// supposed to cost.
function completeMissionSequence(){
  mission = completeMission(mission);
  pushState({ caption: 'the drowned car -- found it', captionId: ++captionSeq });
  // a short audio sting, reusing the same procedural building blocks as the
  // rest of the audio graph (e.g. hollowLogSound's noise-burst chain,
  // engine/forest-engine.js:1880) -- no new audio files, per the studio's
  // procedural-audio-only constraint.
  missionCompleteSting();
}
```

The caption fires **unconditionally** (not gated on `captionsOn`), matching S2 of Ship 1's spec
("landmarks... first-run caption... fire it unconditionally... a one-time nav tip, not a
repeating audio-cue caption") -- this is also a one-time event, not a repeating cue, so the same
reasoning applies. `missionCompleteSting()` follows the existing procedural-synthesis pattern;
exact envelope is an implementation detail for whoever builds this, not gated by this spec.

**Resume toward home:** no explicit code needed -- once `mission.status === 'complete'`, the
child-distance/carry-distance objective pill (`:3380-3383`) is already the player's only
readout, exactly as it is for every other run. The mission does not change the win path
(`canArriveHome`/`arriveHome()` at `:3283`/`:2853`) at all; it only adds `missionBonus` to the
payout computed there (S2).

## S4 -- Navigation cue: audio wayfinding, applied to the mission's waypoint

**This reuses Ship 1's *pattern*, not Ship 1's *code*** (Ship 1 hasn't landed -- see the
dependency note above). Add a sibling function to `engine/forest-engine.js`'s procedural-audio
set (same file, same building blocks Ship 1's `childCry` spec describes: oscillator + gain
envelope + `StereoPannerNode`, tempo shortening with proximity rather than pan depth, for the
same reason -- pan collapses to mono on a phone speaker, tempo does not):

```js
// LUL-1258: the mission waypoint's hum -- same tempo-carries-distance shape
// Ship 1 specs for the child's cry (docs/specs/lul-1255-wayfinding-ship1.md
// S3d), applied to the mission target instead of the baby. Deliberately NOT
// predator-audible (unlike the child's cry) -- this is a detour aid, not a
// second "wayfinding that makes the forest more dangerous" mechanic; scope
// per this ticket is the nav cue only, not a new detection surface.
function missionWaypointHum(mission, distToPlayer){
  if(!audio || !soundOn || !mission || mission.status !== 'active') return;
  // ...same oscillator/pan/gain shape as childCry, targeting mission.target.x/z
  // instead of baby.x/z. Implementer: if Ship 1 has landed by build time, prefer
  // whatever shared helper its PR factored childCry's pan/tempo math into, and
  // call that with mission.target.x/z, rather than re-deriving this function.
}
```

**Scheduling:** a `missionHumTimer` counted down in `tick()` alongside the player-movement
branch, active whenever `mission?.status === 'active' && !carrying` (silent once the child is
picked up, same "return leg is silent" rule the psychology ruling sets for the mission panel --
`decisions/missions-accepted-2026-09-01` §2, "nothing is offered while carrying"). Tempo curve:
reuse the same `near = 1 - dist/140` shape and `5.5 - near*3.5` interval Ship 1's spec uses for
`childCry`, substituting `distMission` for `cryDist` -- there is no reason for the two cues to
feel different, and matching them means one fewer thing to tune.

**Caption** (gated on `captionsOn`, consistent with every other repeating audio cue in the
game, unlike the one-time mission-complete caption above): `"something metal, underwater ·
<near|far> · <side>"`, same near/far+side computation the existing `hearNoise` caption
(`:1203`) uses.

## S5 -- Mission panel (minimal, per the accepted decision)

Per `decisions/missions-accepted-2026-09-01` §2: two collapsed lines, top-left, name + a
progress glyph, never occupying the play area, nothing shown while carrying. For Ship 2:

```
Deepwater  ○          (active, not yet in range)
Deepwater  ●          (complete)
```

No expand-on-hold interaction in this ship -- the ruling's "expanding to full text... same
interaction shape the veil already uses" would require either a new bound key or overloading
`KeyF` (currently the mist veil, `:324`) for an unrelated HUD reveal, and this ticket's own
constraint is "no new actions yet." **Declared simplification:** ship the two-line collapsed
form only; expand-on-hold is a follow-up (file a P3 ticket at implementation time, don't block
Ship 2 on it). Render only while `mission?.status !== undefined && !carrying`, same panel
container pattern `components/Hud.tsx` already uses for other top-left HUD elements -- exact
placement/hygiene check against `LUL-1092`'s mobile play-area gate (851x393) is the
implementer's job at build time, not something this spec can verify statically.

**Mobile:** the panel is read-only text, no touch target, so it needs no new
`EngineActions` entry -- `EngineHudState` (the state object `pushState` builds,
`engine/forest-engine.js:2145`-adjacent) gains two fields: `missionKind: MissionKind | null` and
`missionStatus: 'active' | 'complete' | null`, read by `Hud.tsx` the same way it already reads
`objectiveVisible`/`winVisible` etc. No unreachable action exists in this ship: the only new
player-facing action (mission-complete) rides the existing interact button/key (S3).

## S6 -- `docs/ELEMENTS.md`

Add a "Missions" subsection: the mission struct (verbs: none directly -- completion rides the
existing interact verb), the drowned car as a mission target (distinct from its existing
LANDMARKS entry, which stays purely decorative/navigational), the mission panel (visual only,
no interaction), and the completion bonus's forfeit-on-death economy rule. Follow the existing
subsection format (check the "Embers" or "Stamina" subsections, `docs/ELEMENTS.md:826`/`:878`,
for the exact heading/table shape).

## Design rules -- the greed vs. survival trade-off, made explicit

Answering the ticket's own question, "is the payout enough to make this a real choice?":

- **The payout is not the temptation -- the distance is.** `depth` alone moves from ~19
  (median) to 53 at the drowned car: **+34 Embers**, unconditional on completing anything,
  simply for having walked there. This is already ~1.8x a median run's entire depth term. The
  explicit +12 completion bonus is deliberately small (`game/economy/mission-rewards` calls it
  "a completion bonus... the greed comes from the depth, which is where it belongs") so the
  real decision the player faces is "do I walk 200 units from home," not "do I tag this
  waypoint." This spec does not change that ratio.
- **The choice is real because both halves are forfeitable.** Die anywhere after committing to
  the detour and before reaching home, and the run keeps only the *capped* depth (already
  shipped, `computeDeathPayout`'s `Math.min` against `objectiveDistFromHome`) and loses the
  mission's +12 entirely (S2). Complete the mission and still die on the way back: same
  forfeiture. This is what makes the mission a detour with real stakes rather than a free side
  quest -- consistent with the bank-or-lose principle every other Ember source in the game
  already follows.
- **No repeat-decay, by design, per `decisions/missions-accepted-2026-09-01` §5's veto on
  cross-run counters.** Anti-farming instead comes from the seeded, non-player-selected draw
  (S1) -- moot today since the pool has one member, but the struct is shaped so a later ticket
  adding four more missions doesn't have to revisit this file.

## Verification

- `node --test lib/game/mission.test.ts` -- clean; cover `pickMission` determinism (same seed
  -> same mission), `canCompleteMission`'s boundary (strict `<`, mirroring
  `outcome.test.ts`'s `canPickUp` boundary tests), and `completeMission`'s idempotence
- `npx tsc --noEmit` -- clean
- `npx next build` -- clean
- `npx eslint .` (the `lint` script)
- `node scripts/check-elements-citations.mjs --fix` then confirm clean
- `node scripts/check-duplicate-logic.mjs` -- clean (watch specifically for `mission`,
  `pickMission`, `completeMission` colliding with an unrelated top-level engine declaration --
  rename rather than allowlist if it collides)
- Manual/tester verification (engine correctness only asserted by the author, per role
  charter): waypoint hum audible and directional, silent while carrying, mission-complete
  caption and sting fire once at the drowned car and not elsewhere, HUD panel shows the two
  states and never overlaps `MobileControls.tsx` at 851x393, death after completing the
  mission but before reaching home does **not** add +12 to the death payout (this last one is
  the one behavior a headless test can assert deterministically against
  `computeWinPayout`/`computeDeathPayout` directly, no engine needed, and should get a
  `lib/game/economy.test.ts` case if the executor has room for one)

## e2e

**Backfilled LUL-2187 (2026-09-09).** This feature (spec'd here as LUL-1258, implemented under
LUL-1259) merged before the `## e2e` section requirement existed (LUL-2124) and shipped with
**zero** automated coverage -- confirmed via `grep -rln "mission\|[Dd]eepwater" e2e/`: no hits.
The pure mission-state helpers (`pickMission`, `canCompleteMission`, `completeMission`) are
unit-tested in `lib/game/mission.test.ts`, and the economy math (`MISSION_DEEPWATER_REWARD`
folding into `computeWinPayout`, forfeiture on death) is unit-tested in `lib/game/economy.test.ts`
-- this section proposes only the DOM/engine-integration surface those unit tests can't reach:
the real interact-key trigger, the HUD panel lifecycle, and the prompt text.

**Specs.** `e2e/mission-deepwater.spec.ts` -- new. Two tests:
1. `'pressing E at the drowned car completes the mission via the real interact path'` -- boots
   with `{ qaHooks: true }`, enters, calls the new `qaTeleportNearMission` hook to place the
   player at `interactRadius` distance from the mission target (same "skip unreliable procedural
   pathing, drive the real transition" rationale `qaTeleportNearBaby` uses,
   `engine/forest-engine.js:3033`), asserts `#missionPanel #missionGlyph` reads `○` and the
   objective pill reads `'Press  E  at the drowned car'` (`engine/forest-engine.js:4735`) before
   the key, presses `KeyE` (the real handler, `engine/forest-engine.js:2373-2377` -- not a
   synthesized bypass), then asserts the glyph flips to `●` and the one-time caption `'the
   drowned car -- found it'` (`engine/forest-engine.js:3997`) appears once.
2. `'#missionPanel is absent before a mission exists and while carrying the child'` -- asserts
   the `state.missionKind && state.missionStatus` gate (`components/Hud.tsx:687`): the panel is
   present once a mission is drawn (every run, per S1) but gone once `carrying` is true (reach
   that state via the existing `qaTeleportNearBaby` + pickup flow, matching `smoke.spec.ts`'s
   pickup pattern) -- covers the "nothing is offered while carrying" rule
   (`decisions/missions-accepted-2026-09-01` §2) S5's spec calls out.

No e2e coverage is proposed for the completion bonus's economy math (`MISSION_DEEPWATER_REWARD`
folding into `computeWinPayout`, forfeited on death) -- `lib/game/economy.test.ts`'s `'completing
M2 Deepwater and reaching home adds MISSION_DEEPWATER_REWARD...'` and `'the mission bonus is not
payable on death...'` cases already assert that directly against the pure functions; an e2e test
would only re-prove unit-tested math through a slower path (same reasoning
`docs/specs/lul-1724-wind-direction-awareness.md`'s backfill uses for `isMovingAgainstWind()`).

**Hooks.** Two new hooks -- neither existing hook exposes mission state or a deterministic way to
reach the mission target:
- `window.ForestEngine.qaTeleportNearMission(): void` -- new. Sets `player.x = mission.target.x +
  2, player.z = mission.target.z` (mirrors `qaTeleportNearBaby`, `engine/forest-engine.js:3033`,
  same `+2` standoff so the player lands inside `interactRadius` (4) without sitting exactly on
  the target). Install next to `qaTeleportNearBaby` inside the `?qaHooks=1` block
  (`engine/forest-engine.js:3032`); declare in `engine/forest-engine.d.ts` alongside
  `qaTeleportNearBaby`'s entry (`:34`).
- `window.ForestEngine.qaProbeMission(): { kind: string; status: string; x: number; z: number } |
  null` -- new. Returns `mission && { kind: mission.target.kind, status: mission.status, x:
  mission.target.x, z: mission.target.z }` (mirrors `qaProbeBaby`'s shape,
  `engine/forest-engine.js:3054`). Install alongside `qaProbePlayer` (`:3132`); declare in
  `engine/forest-engine.d.ts` next to `qaProbeBaby`'s entry (`:48`). Not directly exercised by the
  two tests above (both assert DOM/caption, not raw engine state) but cheap to add now next to
  its sibling hooks rather than as a second ticket the first time a future spec needs to assert
  `mission.status` directly.

**Tester scenario.** Not covered by an existing nightly check -- `shared/local-qa/QA_TESTER.md`'s
HUD-overlap sweep (§3, rule O1) lists other top-left/overlay elements by name but not
`#missionPanel`. Request file written alongside this spec:
`shared/local-qa/requests/lul-2187-mission-panel-overlap.md`, asking the nightly run to drive the
real completion path via `qaTeleportNearMission` and check `#missionPanel` for overlap at
desktop and one landscape-phone viewport. It is reported `NEEDS-HOOK qaTeleportNearMission` until
that hook lands (Game Engineer, routed with the e2e spec above) -- left in place per
`REQUESTING-A-TEST.md`'s rule, it activates automatically once the hook ships.

**Not covered.** The waypoint hum's audio itself (pitch, tempo-with-proximity, panning) -- no DOM
signal to assert against, stays manual/tester-only, same precedent every other procedural cue in
this game follows (`childCry`, `hollowLogSound`, etc.). The seeded mission draw's distribution
(`pickMission`'s RNG consumption) is unit-tested (`lib/game/mission.test.ts`), not an e2e concern.
Real-device audio panning (mono phone speaker collapsing pan to tempo-only) stays manual per the
spec's own S4 note.

## Constraints

- Determinism: `pickMission` consumes the run's existing seeded `rng`; no new unseeded
  randomness anywhere in this ship.
- Audio is 100% procedural -- no new audio files, matching the rest of the game.
- Captions required for the repeating waypoint hum (gated on `captionsOn`, matching every other
  repeating audio cue) and for the one-time completion event (unconditional, matching the
  one-time landmark caption's precedent).
- Mobile parity: no new `EngineActions` method, no new touch target -- the sole new
  player-facing action (mission completion) reuses the existing interact button.
- Do not modify `computeDeathPayout`'s signature or the depth-cap logic it already ships --
  this spec adds a fourth optional argument to `computeWinPayout` only.
- Do not implement Ship 1's `childCry`/`hearCry`/predator-audible mechanic as part of this
  ticket -- S4's hum is a new, separate, non-predator-audible cue. If Ship 1 lands first and
  factors out a shared pan/tempo helper, prefer reusing it (note in S4), but do not block this
  spec's implementation on Ship 1 landing.

## Out of scope

- Implementation (this is a spec; a separate ticket, LUL-1259, implements it once this spec is
  approved)
- M1 Veil, M3 Slack Water, M4 Ghost, M5 Cold Walk -- the other four pool members
- The mission-pool draw UI, mission list, or any player-facing selection -- there is no
  selection; the draw is seeded and silent
- Panel expand-on-hold (declared simplification, S5) -- follow-up ticket
- Reconciling this mission's struct against LUL-1666's `secondary`-variant struct -- flagged
  above, filed as LUL-1667, not resolved here
- Retuning the +12/`zoneRadius`/`interactRadius` constants after playtest -- follow-up ticket,
  don't reopen this spec for a constant tweak
