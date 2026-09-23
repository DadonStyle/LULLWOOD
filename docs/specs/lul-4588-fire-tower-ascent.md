# SPEC: LUL-4588 Fire Tower Ascent mission (replaces Deepwater)

**Ticket:** LUL-4588 · **Tier:** B — content/constant swap across mission target, reward
pricing, and flavor text; no new engine state machine, no new `EngineActions` key, no HUD
readout added. Touches more files than the ticket's original 0.8d estimate assumed (see
"Deviations from ticket" below) but every touch is a rename or a string swap, not new logic.
No `REVIEW: APPROVED` gate required before merge (Tier B); Code Reviewer still reviews.

**Written against:** `release/next` @ `50d1755aba29675ca37fe07026b16dadc811bbf8` (2026-09-23).
Re-derive every `file:line` below if it has moved.

## Deviations from ticket / wiki

1. **No landmark to add.** `fireTower` already exists in `LANDMARKS`
   (`engine/tuning.js:77`, `{ kind: 'fireTower', x: -95, z: -95, clear: 12, cr: 1.6 }`) with
   its own mesh (`buildFireTower()`) and beacon glow, per the CTO's 2026-09-23 correction on
   wiki `game/mechanics/mission-tower-ascent`. Ticket step 1 and the wiki page's `x:-112,z:48`
   position are stale — there is no `lib/game/landmarks.ts` file in this repo at all; landmark
   registration lives in `engine/tuning.js`'s `LANDMARKS` array. **Do not create any landmark
   file or entry.** The mission target is `(x:-95, z:-95)`, not `(x:-112, z:48)`.
2. **MissionKind stays `'deepwater'`.** The Game Economist's decision doc
   (`decisions/lul-4674-firepower-reward-pricing-2026-09-23`) suggests renaming the
   `MISSION_POOL` entry's `kind` from `'deepwater'` to `'firepower'`. This spec does **not**
   do that. `'deepwater'` as a `MissionKind` is an internal identifier, never shown to a
   player (player-visible text is `MISSION_NAMES[kind]` and the flavor strings below, both
   changed by this spec). Renaming the literal would touch `components/Hud.tsx:132/212/`
   `287/435/447/456` — `missionUnlocks: { deepwater: boolean }`, a shape persisted to
   `localStorage` (`readMissionUnlocks`/`writeMissionUnlocks`) — silently orphaning a
   returning player's earned unlock flag (the exact LUL-1697 failure class the founder
   flagged 2026-09-09: a shape drift between engine and persisted client state). It would
   also touch `engine/forest-engine.js`'s `HINT_PRIORITY` array (`:2245`), two `switch` cases
   (`:7145`, `:7172`), and 8 e2e spec files that filter on `'deepwater'`
   (`e2e/hints.spec.ts`, `e2e/mobile/hints.spec.ts`, `e2e/mission-progression.spec.ts`,
   `e2e/mission-landmark-sync.spec.ts`, `lib/game/mission.test.ts`,
   `lib/game/economy.test.ts`) for zero player-visible benefit. Reward **constant names**
   are renamed per LUL-4674 below (those are source-only identifiers with no persisted
   shape); the `MissionKind` value is not. `MISSION_REWARDS`'s key stays `deepwater:`,
   pointing at the renamed constant.
3. **Distance/pricing rationale is now stale, values are not.** LUL-4674's pricing doc
   computed Fire Tower's depth-earning distance from the wiki's superseded `(x:-112,z:48)`
   position (~60u from home, ~15E depth). The real `fireTower` landmark at `(-95,-95)` is
   `hypot(95,95) ≈ 134.4u` from home (assuming home ≈ origin per `engine/tuning.js`'s
   `LANDMARKS` convention — same origin every other landmark distance in that doc is
   measured from), ~3× the assumed distance. This does not block implementation — LUL-4588's
   ticket text explicitly says the three reward numbers are final or resolve the
   discrepancy with the Economist directly. This spec ships the numbers as given
   (`MISSION_FIREPOWER_REWARD=8`, `FIREPOWER_RETRIEVAL_BONUS=8`, `FIREPOWER_SPEEDRUN_BONUS=10`)
   and files a follow-up note to the Economist (see "Out of scope").

## Files

- `lib/game/mission.ts` — edited: retarget `MISSION_POOL[0]` at the real `fireTower`
  landmark; rename the speedrun-timer constant.
- `lib/game/mission.test.ts` — edited: follow the constant rename.
- `lib/game/economy.ts` — edited: rename the three reward constants, final values.
- `lib/game/economy.test.ts` — edited: follow the constant rename (imports + usages +
  the two test titles that name the old constant).
- `engine/forest-engine.js` — edited: follow the constant rename (import + 1 usage site);
  swap three flavor-text strings (hint text, completion caption, objective prompt).
- `components/Hud.tsx` — edited: `MISSION_NAMES.deepwater` display string; two duplicate
  help-panel caption lines (desktop/mobile) naming "Deepwater".
- `e2e/mission-landmark-sync.spec.ts` — edited: the one `#objective` text assertion that
  names "drowned car" (this spec is `@fullmap`-tagged, doesn't run on the QA rig per
  LUL-2377, but ships correct or not at all).
- `e2e/missions-fire-tower.spec.ts` — created: new spec, Q11/Q12.
- `shared/local-qa/requests/lul-4525-fire-tower-ascent.md` — created: Q13 request file
  (note: lives outside the game repo, under `/home/noam/.paperclip/shared/local-qa/`).

## The change

### `lib/game/mission.ts`

Line 40, `MISSION_POOL[0]` — retarget from `drownedCar` to the real `fireTower` landmark
position (both fields change together; the nominal `x/z` here is what a micro-world boot
actually uses, per `CONFIG.missionScaleMul !== 1` at `engine/forest-engine.js:1366-1368` —
only a full-map boot overwrites it via `syncMissionTargetToLandmark`, so leaving the nominal
stale would mean the QA rig — which only ever boots the micro world, LUL-2377 — tests the old
drowned-car coordinates forever):

```ts
{ kind: 'deepwater', x: -95, z: -95, zoneRadius: 20, interactRadius: 4, landmarkKind: 'fireTower', timeLimitSeconds: 60 },
```

`zoneRadius`/`interactRadius`/`timeLimitSeconds` unchanged — not tuned for the new
geometry, inherited from Deepwater; flag for the Economist/CTO if a playtest says the
20u zone or 60s timer reads wrong for a vertical climb.

Lines 161/179 — rename the speedrun secondary's timer constant (not one of LUL-4674's three
priced constants, but it sits right next to them and "DEEPWATER" reads as a defect once its
siblings are renamed — Q6):

```ts
export const MISSION_FIREPOWER_SPEEDRUN_SECONDS = 240;   // was MISSION_DEEPWATER_SPEEDRUN_SECONDS
```
and its one use at `:179`.

### `lib/game/mission.test.ts`

Rename every `MISSION_DEEPWATER_SPEEDRUN_SECONDS` reference (import at `:14`; usages at
`:141`, `:161`, `:226`, `:267`, `:269`, `:270`, `:277`, `:279`) to
`MISSION_FIREPOWER_SPEEDRUN_SECONDS`. Leave the `'deepwater'` string-literal kind filters at
`:285`, `:300`, `:308`, `:316` untouched (per "MissionKind stays `'deepwater'`" above).

### `lib/game/economy.ts`

```ts
// :73
export const MISSION_FIREPOWER_REWARD = 8;   // was MISSION_DEEPWATER_REWARD = 12
```
Update the `:75` comment (references `MISSION_DEEPWATER_REWARD (12)`) to name the new
constant and value.
```ts
// :80-83, MISSION_REWARDS — key unchanged, value points at the renamed constant
export const MISSION_REWARDS: Record<MissionKind, number> = {
  deepwater: MISSION_FIREPOWER_REWARD,
  oakHollow: MISSION_OAKHOLLOW_REWARD,
};
```
```ts
// :91-92
export const FIREPOWER_RETRIEVAL_BONUS = 8;    // was DEEPWATER_RETRIEVAL_BONUS = 15
export const FIREPOWER_SPEEDRUN_BONUS = 10;    // was DEEPWATER_SPEEDRUN_BONUS = 18
```
Update the `:86` comment referencing `MISSION_DEEPWATER_REWARD` to the new name.

### `lib/game/economy.test.ts`

Rename the import block (`:14`, `:17-18`) and every usage (`:156-157`, `:164`, `:186-187`,
`:192-193`, `:198-199`, `:203-204`, `:207-208`) from `MISSION_DEEPWATER_REWARD` /
`DEEPWATER_RETRIEVAL_BONUS` / `DEEPWATER_SPEEDRUN_BONUS` to the three new names. Update the
two test titles that name the old constant (`:154`, `:184`, `:190`) to match. Leave
`:163`'s `Object.keys(MISSION_REWARDS).sort()` assertion (`['deepwater', 'oakHollow']`)
unchanged — the record's keys are `MissionKind` values, not renamed.

### `engine/forest-engine.js`

Import block, `:139/141/142` — rename to match economy.ts:
```ts
  MISSION_FIREPOWER_REWARD,
  MISSION_REWARDS,
  FIREPOWER_RETRIEVAL_BONUS,
  FIREPOWER_SPEEDRUN_BONUS,
```
Usage at `:5928` — rename the two identifiers in place (logic unchanged):
```ts
    ? (mission.secondary.data.kind === 'retrieval' ? FIREPOWER_RETRIEVAL_BONUS : FIREPOWER_SPEEDRUN_BONUS)
```

Three flavor strings (all currently unconditional/kind-agnostic — same string fires
regardless of which `MissionKind` is active, a pre-existing minor inconsistency with
`oakHollow` that is not this ticket's to fix, out of scope, flag separately if it matters):

```ts
// :2260, HINT_TEXT.deepwater
deepwater:  'the fire tower — a bonus payout, but only if you reach it within the time limit',
```
```ts
// :6095, completeMissionSequence()
pushState({ caption: "the warden's logbook -- found it", captionId: ++captionSeq });
```
```ts
// :6949, objectiveText ternary
(missionCanComplete ? 'Press  E  at the fire tower' : 'Find the lost child  ·  ' + Math.round(distBaby) + 'm')),
```

Not touched: `HINT_PRIORITY` (`:2245`), the two `case 'deepwater':` switch arms (`:7145`,
`:7172`), `missionUnlocks` initializers (`:1720`, `:3865`) and its read/write at `:5935-5936`
— all keyed on the unchanged `MissionKind` literal.

### `components/Hud.tsx`

```ts
// :306
deepwater: 'Fire Tower',   // was 'Deepwater'
```
Two help-panel lines (`:905` desktop, `:920` mobile) — same copy in both, swap the bold tag
only, keep the rest identical (low-risk minimal edit):
```tsx
<b>Fire Tower</b> tag, top-left &nbsp;·&nbsp; reach the marked zone for a bonus Embers payout on a successful run
```
(and the mobile duplicate at `:920` with its own `&nbsp;`/plain-space formatting, unchanged
otherwise).

### `e2e/mission-landmark-sync.spec.ts`

`:46` — the reachability assertion names the old flavor text; update to match the new
`objectiveText` string above:
```ts
await expect(page.locator('#objective'), '...').toContainText('fire tower', { timeout: 3_000 });
```
Header comment (`:1-14`) and the inline comment at `:22-23` reference "drownedCar landmark"
sync specifically — reword to "fireTower landmark" (same regression, new landmark). Verify
at `QA_PINNED_SEED` that `clearLandmarkSpot()` still nudges `fireTower` off its nominal spot
the way it used to nudge `drownedCar` (the whole point of this regression test is that the
target must survive a same-round nudge) — if it doesn't, note that as a coverage gap in the
PR body rather than silently keeping a test that no longer exercises the nudge case. This
spec is `@fullmap`-tagged and does not run on the QA rig (LUL-2377), so this is a
correctness note, not a merge blocker.

## Verification

- `npm test -- lib/game/mission.test.ts lib/game/economy.test.ts` (or the repo's actual unit
  test runner invocation) — all renamed-constant assertions pass.
- `npx tsc --noEmit` — no orphaned references to the old constant names anywhere in the tree.
- `npx eslint .` — clean.
- `next build` — clean.

## e2e

**Specs.** `e2e/missions-fire-tower.spec.ts` — "player is detected by a lion while at the
exposed fire tower" (new). `e2e/mission-landmark-sync.spec.ts` — existing `@fullmap` test,
text updated, must still pass under `E2E_FULLMAP=1` (not run on the rig by default).
Untouched but must keep passing unchanged: `e2e/mission-deepwater.spec.ts`,
`e2e/throwable-mission-hud.spec.ts` (+ mobile variant), `e2e/mission-progression.spec.ts`,
`e2e/hints.spec.ts` (+ mobile variant), `e2e/wind-assisted-evasion.spec.ts`,
`e2e/returning-player.spec.ts` (+ mobile variant) — none of these assert the renamed display
string or flavor text, only the unchanged `MissionKind` literal / generic mission plumbing.

**World.** Micro (default, LUL-2377) — no `@fullmap` needed. Boot with
`{ qaHooks: true, qaWorld: 'micro', qaMissionKind: 'deepwater' }` (the boot param that forces
`MISSION_POOL` down to a single kind, `engine/forest-engine.js:1358-1365` — meaningful under
`?qaHooks=1`, existing).

**Hooks.** All existing, no new hook, no `.d.ts` change:
- `qaTeleportNearMission(): {kind,x,z,status}|null` — `engine/forest-engine.d.ts:498`,
  impl `engine/forest-engine.js:5599`. Spawns the player at
  `(target.x + interactRadius + 1, target.z)` (confirmed by
  `e2e/mission-landmark-sync.spec.ts:31-36`'s comment).
- `qaBuildScene({predators:[...]})` — `engine/forest-engine.d.ts:567`,
  impl `engine/forest-engine.js:5698`. Seeds one lion; exact starting x/z don't matter, see
  next hook.
- `qaLurePredatorKind('lion'): 'lion'|null` — `engine/forest-engine.d.ts:134`,
  impl `engine/forest-engine.js:4383`. Relocates the nearest lion to 6u from the player with
  `hunt=true` and isolates every other predator — the exact idiom
  `e2e/positional-hiding.spec.ts:263-286` already uses to prove a predator catches the player
  at an exposed, un-hidden position; reused here unmodified rather than inventing a new
  detection probe.

**Test body** (mirrors `e2e/positional-hiding.spec.ts`'s proven pattern):
```
boot({qaHooks:true, qaWorld:'micro', qaMissionKind:'deepwater'}); enter();
target = qaHook('qaTeleportNearMission');  // assert not null, target.kind === 'deepwater'
qaHook('qaBuildScene', {predators:[{kind:'lion', x:0, z:0}]});
qaHook('qaLurePredatorKind', 'lion');      // assert !== null -- a lion exists
// deliberately never press KeyH -- the tower is exposed, no cover, per the feature's
// own narrative ("no cover, visible from long range")
await expect('#deathScreen').toBeVisible({timeout: 20_000});
await expect('#deathKind').toHaveText('lion');
```
This proves the tower position is a live detection zone, not a silent one — matching Q11's
exact wording. It is real coverage: the lion is a real opposing system staged via the same
hook every other predator-catch regression in this suite uses, not a HUD-only assertion with
nothing hunting the player.

**Tester scenario.** `shared/local-qa/requests/lul-4525-fire-tower-ascent.md` (created with
this spec, see below) — the human/visual half: does the tower render distinctly (visibly
taller than trees), does the mission pill read "Fire Tower", does the objective prompt read
"Press E at the fire tower" at close range.

**Not covered.** Audio (footstep clang under the noise model, mission-start hum, retrieval
chime) — none of that exists yet; this ticket's cheap slice ships text + target only, per
the wiki page's own "Full Scope (Deferred)" section (audio pass is deferred). 3D art
(distinct tower model detail) — deferred, same section. Real-device feel — manual, per the
local-qa request.

## Cues

**Visual.** `#missionPanel` (`components/Hud.tsx:941-949`) shows "Fire Tower" text
(`MISSION_NAMES.deepwater`, `:306`) plus the existing glyph/timer sub-elements, unchanged
markup. The `fireTower` landmark's own mesh/beacon glow (`engine/tuning.js:77/121`,
`buildFireTower()`) already renders in the world — no new visual code, this spec only points
the mission's completion/objective logic at that existing landmark.

**Audio.** None added — deferred per the wiki's Full Scope section. `missionCompleteSting()`
(`engine/forest-engine.js`, called from `completeMissionSequence()` at `:6096`) already fires
unconditionally on completion, gated by the existing `soundOn` master toggle; unchanged.

**Explanation.** First-encounter hint caption text is `HINT_TEXT.deepwater`
(`engine/forest-engine.js:2260`), gated by the existing `?qaHooks`-independent hint/caption
system (`captionsOn`, LUL-2307's once-per-install registry) — unchanged mechanism, new
string only: "the fire tower — a bonus payout, but only if you reach it within the time
limit."

**Reduced motion.** No animation on the mission panel or landmark glow to reduce (same as
Deepwater before it) — static text and an existing ambient pulse glow
(`engine/tuning.js:121`, `pulseHz: 0.5`) that this spec does not add or change.

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- Do not rename the `MissionKind` literal `'deepwater'` (see "Deviations" #2). Any future
  ticket that does must include a `missionUnlocks` persisted-shape migration and update the
  8 e2e spec files/2 unit test files enumerated above.
- Do not touch `engine/tuning.js`'s `LANDMARKS`/`LANDMARK_VISUALS` entries for `fireTower` or
  `drownedCar` — both are pre-existing and out of scope (see "Out of scope").
- Reward values (`8`/`8`/`10`) are final per LUL-4674 — do not adjust them as part of this
  ticket even though the distance rationale behind them is stale (see "Deviations" #3);
  that's a separate Economist follow-up.

## Out of scope

- **`drownedCar` landmark becomes orphaned** (`engine/tuning.js:80/124`,
  `buildDrownedCar()` at `engine/forest-engine.js:1603`) — no mission targets it once this
  ships, but it still renders unconditionally every round as generic map decoration
  (`LANDMARKS` is placed regardless of mission target, per `lib/game/mission.ts:41-43`'s own
  comment on `oak`). Deleting or repurposing it is LUL-3256's broader water-removal scope,
  not this stage-2a mission-slot ticket. Flagged, not touched.
- **Economist distance rationale re-check.** LUL-4674's pricing math used the stale
  `(x:-112,z:48)`/~60u position; the real `fireTower` landmark is ~134u from home. This spec
  ships the given final numbers unchanged (see "Deviations" #3) and files a low-priority
  follow-up comment to the Game Economist so they can decide whether the reward still reads
  right against the real distance — not a blocker for this ticket.
- **oakHollow's shared, kind-agnostic objective-prompt text** (`engine/forest-engine.js:6949`
  always says "Press E at the fire tower" regardless of which mission is actually active,
  a pre-existing bug predating this ticket, LUL-3010 never made that string kind-aware) —
  noted in "The change" above, not fixed here.
- Full Scope items from the wiki page (3D art pass, footstep/hum/chime audio, fog-of-war
  landmark visibility tuning, second tower mission variant) — explicitly deferred by the
  accepted decision.
