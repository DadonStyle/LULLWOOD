# SPEC: LUL-4960 M5 Cold Walk (outbound-leg walk-only constraint)

**Ticket:** LUL-4960 (PLAN), scoped by `decisions/m5-cold-walk-retarget-2026-09-24` (CEO
retarget ruling) · **Tier:** C — new module (`lib/game/coldWalk.ts`), a new engine action
threaded through `lib/engine-contract.ts`'s exhaustiveness check, and a `computeWinPayout()`
signature change touching the core win-payout path. `REVIEW: APPROVED` required before merge.

**Written against:** `release/next` @ `69cae4c` (2026-09-24). Re-derive every `file:line`
below if the branch has moved before implementation.

**Source.** `decisions/missions-accepted-2026-09-01` §4 (original acceptance: "costs one
boolean," "allowed at the gate as a single opt-in line the player can ignore — never
pre-selected, never a list") + `decisions/m5-cold-walk-retarget-2026-09-24` (CEO retarget:
trigger moves from the dead `carrying && !running` to `!running` sustained from run start
until pickup) + this ticket's own PLAN comment.

## Feature Checklist §0 — re-answered against the retargeted trigger

M5 has never been built (no PLAN/SPEC/code before this), so this answers the full section,
not just the re-answer subset the retarget ruling called out.

**Q1 (state → pixels).** Three new pieces of state, all engine-owned:
| state | engine field | HUD element | what the player reads |
|---|---|---|---|
| opted in this session | `coldWalkOptIn` | `#settingsPanel` checkbox (`components/SettingsPanel.tsx`, new "Run modifiers" `<fieldset>`) | checkbox checked/unchecked |
| constraint still live this run | `coldWalkActive` | `#coldWalkPanel` (new, sibling of `#rockClimbPanel`) | panel present/absent |
| constraint already failed this run | `coldWalkBroken` | `#coldWalkPanel` text | "Cold Walk — silent" vs "Cold Walk — broken" |

The reward itself (`COLD_WALK_REWARD`, below) has no separate readout — see the note under
Q2, mirroring `missionBonus`/`secondaryBonus`'s existing precedent.

**Q1.5 (live trigger reachability).** The substitute trigger is `running`, computed every
frame at `engine/forest-engine.js:6669` (`running = runMode === 'toggle' ? ... : (keys[...] ||
touchSprint)`), inside the still-live `if(playing && !hidden)` block at `:6668`. This is a
real-play assignment, not a `qa*` hook — confirmed live today (not the dead `carrying` flag
the original 2026-09-01 design used, which `decisions/lul-2281-pickup-is-the-win-2026-09-09`
already made unreachable).

**Q2 (values > 1).** None of this feature's own state is a count — `coldWalkOptIn`/`Active`/
`Broken` are all booleans. The reward (`COLD_WALK_REWARD`) is a quantity, but it folds into
`RunPayout.total` the same way `missionBonus`/`secondaryBonus` already do (`lib/game/
economy.ts:104`, "have no `RunPayout` field of their own... folded straight into total") —
not a new readout, following that existing precedent rather than inventing a fourth pattern.
The live `#coldWalkPanel` (Q1) is the readout that matters: it tells the player their bonus
is still earnable *before* the payout screen, the same job `#missionPanel`'s glyph does for
`missionBonus`.

**Q3 (visible with `adminMode` off).** `#coldWalkPanel` is a sibling of `#rockClimbPanel`/
`#veilOverloadPanel`/`#caveImmunePanel` — outside `#panel`, so `body[data-admin-mode="0"]
#panel { display: none !important; }` (`components/GameCanvas.tsx:328`) does not reach it.
The Settings checkbox lives in `#settingsPanel`, also outside `#panel`.

**Q4 (state that outlives the moment, with a positive "how much is left" tell).**
`coldWalkActive` is true from `enter()` until `pickup()` is accepted (not a countdown — a
binary "still in play" like `#missionPanel`'s glyph, not a timer like `#caveImmunePanel`'s
seconds). `coldWalkBroken` is sticky once true for the rest of the run and the panel text
says so immediately (see Q5).

**Q5 (silent refusal).** Not applicable — sprinting is never blocked. The player can always
sprint; opting into Cold Walk only makes sprinting cost the bonus. There is no input to
refuse. The positive tell for the *consequence* (not a refusal) is `coldWalkBrokenCue()`
(new, below) firing the instant `running` first goes true after opt-in — an audible +
caption tell in the same frame the bonus is lost, not a silent panel-text change the player
has to notice on their own.

**Q6 (copy staleness).** No existing copy names this mechanic (it has never shipped). The
gate screen's own flavor line ("Fire Tower tag... bonus Embers payout") is unrelated — that
line describes the deepwater mission's Fire Tower landmark bonus, not this feature; leaving
it untouched, out of scope for this ticket.

**Q7 (duplicate check).** Two `file:line` reads of `running` will now coexist for different
purposes: `engine/forest-engine.js:6673` (`maxSpd = (running ? walk*sprintSpeedMul(...) :
walk) * ...`) and `:6777` (`noiseRadius = ... (running ? NOISE_RADIUS_RUN : ...)`) already
consume `running` every frame it is true, for movement speed and scent-trail width — a
*per-frame effect* of sprinting. Cold Walk's read (new, `:6669`-adjacent) is a *sustained
history* check — "has this ever been true since run start" — not a duplicate of either
per-frame consumer; both continue to fire exactly as before regardless of Cold Walk opt-in.
No overlap: grepped `running` (`engine/forest-engine.js`) for every read between `:6667` and
`:6800`, the movement-speed and scent-trail consumers are the only two, and neither gates on
or is gated by `coldWalkOptIn`.

**Q8 (survivor coverage).** Not applicable — nothing is being replaced or removed.

**Q9 (prompt convention).** No new key prompt. `#coldWalkPanel` follows the established
*passive status panel* family (`#caveImmunePanel`, `#rockClimbPanel`, `#veilOverloadPanel` —
none of which live in `#actionSlot`, all of which are outside `#panel`, always-visible-while-
active, no player input associated with them) — not a duplicate of the `#actionSlot`
`<ActionPrompt>` convention, which is reserved for interactive-verb prompts ("press E to...").
Cold Walk has no verb of its own; it is a passive constraint on an existing verb (sprint).

**Q10 (unrendered engine field).** N/A — no pre-existing unrendered field being surfaced;
every field this SPEC adds gets a render site (Q1's table).

**Q11 (opposing system).** Not a stealth/predator mechanic — the "opposing system" here is
the player's own temptation to sprint under pressure (e.g., fleeing a predator), not an AI.
The e2e coverage below verifies the constraint against a *real* movement input path (actual
`Shift`/touch-sprint key state, not a forced flag), which is the applicable analogue of "stage
the antagonist" for a player-input-only mechanic.

**Q12 (runs on the QA rig).** Micro world, no `@fullmap` need — see `## e2e`.

**Q13 (local-qa request file).** Filed alongside this SPEC at
`shared/local-qa/requests/lul-4960-cold-walk.md` once the implementation PR is open (the
executor files it in the same PR per the standing local-qa rule, since the panel/checkbox are
new player-visible surfaces).

**Q14 (baseline).** Feature has no existing tests to be a baseline for; new tests only.

**Q15 (cue triple).** See `## Cues` below.

**Q16 (discoverability/accessibility).** New setting: `coldWalkOptIn`, added to
`PersistedSettings` (`components/SettingsPanel.tsx`) and restored in the existing
apply-on-ready effect, same as every other boolean setting there — persists across sessions,
defaults `false` (never pre-selected, satisfies the 2026-09-01 acceptance's own constraint).
Single checkbox, not a list (also satisfies that constraint literally). No new key binding,
no hold-to-act, no new audio bus (`coldWalkBrokenCue()` reuses the existing `audio`/`soundOn`
gate every other one-shot cue in the file uses). No borrowed beacon/interact vocabulary.

## Design call this SPEC makes

**Reward architecture: an independent bonus, not a `MISSION_REWARDS` entry.** The ticket's own
summary line floated hooking the reward through `MISSION_REWARDS`, but Cold Walk is not a
`MissionKind` (per the retarget ruling's own architecture note) and `MISSION_REWARDS` is a
`Record<MissionKind, number>` (`lib/game/economy.ts:80`) — there is no key to add it under
without inventing a fake `MissionKind`. `finishPickup()` already computes exactly this shape
of independent, additive-only bonus twice: `missionBonus` (`engine/forest-engine.js:5958`,
keyed off `MISSION_REWARDS`) and `secondaryBonus` (`:5964`, `FIREPOWER_RETRIEVAL_BONUS` /
`FIREPOWER_SPEEDRUN_BONUS`, **not** in `MISSION_REWARDS` either — plain constants in
`lib/game/economy.ts:91-92`). `computeWinPayout()` (`lib/game/economy.ts:107`) already takes
both as independent optional args and folds them into `total` identically. Cold Walk becomes
a third such arg, `coldWalkBonus`, following the `secondaryBonus` precedent exactly (a
constant in `economy.ts`, not a `Record`, no exhaustiveness machinery needed).

**Pricing is a placeholder, not final.** `decisions/m5-cold-walk-retarget-2026-09-24` says
explicitly: "The +22 Embers / second-highest price is not confirmed... Repricing is not
automatic; it needs the Economist's numbers." `game/economy/mission-rewards.md:115` still
shows the stale pre-retarget 22, priced for the *return* leg's darkness, a different tension
profile than the outbound leg this SPEC actually gates. This SPEC uses `COLD_WALK_REWARD = 8`
(`lib/game/economy.ts`, same scale as `MISSION_FIREPOWER_REWARD`/`FIREPOWER_RETRIEVAL_BONUS`,
both also 8) as a conservative placeholder so the mechanic is testable and shippable; do not
treat 8 as final. Filing a follow-up ticket to the Game Economist for the real number is part
of this SPEC's dispatch (see ticket).

**Opt-in surface: `SettingsPanel`, not a one-time `#gate` line.** The 2026-09-01 acceptance's
"opt-in line ... at the gate" was written before anyone checked `components/Hud.tsx`'s actual
`#gate` lifecycle: `#gate` (`:894`) only renders while `!state.entered`, and `entered` never
reverts to `false` again for the rest of the session — "restart() never re-shows #gate"
(`:622`'s own comment). A player is meant to use this "at run 50" (2026-09-01 acceptance's own
words), i.e. across many restarts within one session, so a choice that can only be made once,
before the very first run, cannot be what was intended. `setDifficulty()` already establishes
the real precedent for a per-run choice made through Settings that "always takes effect on the
next restart()" (`engine/forest-engine.js:6314`'s comment) — this SPEC follows that shape
exactly: `SettingsPanel.tsx`, persisted, applied at the next `enter()`/`restart()`. This still
satisfies "never pre-selected, never a list" (defaults off, one checkbox) — it relocates
*where* the one line lives, not what it is.

**Constraint window ends at `pickup()`, not `finishPickup()`.** Mirrors this same author's
`docs/specs/lul-4958-slack-water.md`'s identical reasoning for Slack Water's fog-tide check:
`pickup()` (`engine/forest-engine.js:5858`) is the acceptance instant; `finishPickup()`
(`:5927`) fires ~11.3s later when the cinematic ends. A player is not walking (they're mid
cinematic, camera-locked) during that gap, but there is no reason to make the constraint's
exact edge depend on cinematic timing rather than the input-accepted moment. Checking
`!pickingUp` (true from `pickup()` to `finishPickup()`) as the stop condition, rather than
`!won`, keeps this consistent and cheap to reason about.

## Files

- `lib/game/coldWalk.ts` — new. Pure predicate, unit-testable without the engine.
- `lib/game/economy.ts` — edited. New `COLD_WALK_REWARD` constant, `computeWinPayout()` gains
  a 6th optional param.
- `lib/game/economy.test.ts` — edited. New cases mirroring the existing `FIREPOWER_RETRIEVAL_
  BONUS` coverage (`:184-208`).
- `lib/game/coldWalk.test.ts` — new. Unit coverage for the pure predicate.
- `engine/forest-engine.js` — edited. New module state, `setColdWalkOptIn()` action, the
  per-frame check, `coldWalkBrokenCue()`, `finishPickup()`'s bonus computation, the per-frame
  `pushState` additions, the returned actions object.
- `lib/engine-contract.ts` — edited. `'setColdWalkOptIn'` added to `ENGINE_ACTION_KEYS`.
- `components/Hud.tsx` — edited. `EngineHudState`/`EngineActions`/`INITIAL_HUD_STATE`
  additions, new `#coldWalkPanel` JSX.
- `components/SettingsPanel.tsx` — edited. New `PersistedSettings` field, apply-on-ready read,
  persist write, new "Run modifiers" `<fieldset>` with the one checkbox.
- `docs/ELEMENTS.md` — edited. New panel + engine-owned state entry.
- `docs/CUES.md` — edited. New row for `coldWalkBrokenCue`.
- `e2e/cold-walk.spec.ts` — new.
- `shared/local-qa/requests/lul-4960-cold-walk.md` — new, filed with the implementation PR.

## The change

### `lib/game/coldWalk.ts` (new)

```ts
/**
 * True the frame the Cold Walk constraint (opted in, never sprinted since run start,
 * still before pickup) is first violated. Pure so it's testable without the engine --
 * mirrors lib/game/veilOverload.ts's isVeilOverloadActive() shape (one small predicate,
 * one file).
 */
export function coldWalkJustBroke(
  optedIn: boolean,
  alreadyBroken: boolean,
  pickingUp: boolean,
  running: boolean,
): boolean {
  return optedIn && !alreadyBroken && !pickingUp && running;
}
```

### `lib/game/economy.ts`

Add next to `FIREPOWER_RETRIEVAL_BONUS`/`FIREPOWER_SPEEDRUN_BONUS` (`:91-92`):

```ts
// LUL-4960: M5 Cold Walk's win-only bonus -- independent of MISSION_REWARDS (Cold Walk is
// not a MissionKind, decisions/m5-cold-walk-retarget-2026-09-24's architecture note), same
// additive-only shape as secondaryBonus below. NOT FINAL -- placeholder pending Game
// Economist repricing for the outbound-leg tension profile (see the SPEC's Design call).
export const COLD_WALK_REWARD = 8;
```

Change `computeWinPayout()` (`:107-119`) to accept and fold a 6th optional arg exactly like
`secondaryBonus`:

```ts
export function computeWinPayout(
  maxDistFromHome: number,
  survivedSeconds: number,
  tier: DifficultyTier = 'lantern',
  missionBonus = 0,
  secondaryBonus = 0,
  coldWalkBonus = 0,
): RunPayout {
  const mult = TIER_MULTIPLIERS[tier].win;
  const cappedDepth = Math.min(computeDepth(maxDistFromHome), 62);
  const depth = Math.round(cappedDepth * mult);
  const survival = Math.round(computeSurvival(survivedSeconds) * mult);
  const carried = Math.round(CARRIED * mult);
  const rescue = Math.round(RESCUE * mult);
  const total = depth + survival + carried + rescue
    + Math.round(missionBonus * mult) + Math.round(secondaryBonus * mult)
    + Math.round(coldWalkBonus * mult);
  return { depth, survival, carried, rescue, spent: 0, total };
}
```

`RunPayout`'s shape is unchanged (no new field) — `coldWalkBonus` folds into `total` exactly
like `missionBonus`/`secondaryBonus` already do (see Q2).

### `engine/forest-engine.js`

Import (next to the existing `FIREPOWER_RETRIEVAL_BONUS` import at `:136`):
```js
  COLD_WALK_REWARD,
```
And near the top import block (mirrors the `isVeilOverloadActive` import at `:118`):
```js
import { coldWalkJustBroke } from '@/lib/game/coldWalk';
```

Module state (near `let veilOverloadChargeT = 0, ...` at `:591`):
```js
let coldWalkOptIn = false, coldWalkBroken = false;
```

New action (near `setCaptions` at `:6329`, same file/shape as `setReducedMotion`/
`setCaptions`):
```js
function setColdWalkOptIn(v){ coldWalkOptIn = !!v; pushState({ coldWalkOptIn }); }
```

In `enter()` (`:3864`), reset the per-run flag next to the other fresh-run resets at `:3873`
(`veilReserve = false; embersSpent = 0;`):
```js
  coldWalkBroken = false;   // LUL-4960: fresh run, constraint not yet broken
```

In the movement block, immediately after `running` is assigned (`:6669`, still inside the
`if(playing && !hidden)` block opened at `:6668`):
```js
    if(coldWalkJustBroke(coldWalkOptIn, coldWalkBroken, pickingUp, running)){
      coldWalkBroken = true;
      coldWalkBrokenCue();
    }
```

New cue, placed near `windPulseCue()` (`:6176`) — a short falling tone (this is a "you just
lost something" tell, same register family as `rockClimbEndCue`'s falling triangle, but
paired with a caption since this is the first time the player learns the rule broke, not a
repeatable ambient effect):
```js
// LUL-4960: Cold Walk's one-shot "you just lost the bonus" tell -- fires exactly once per
// run, the frame `running` first goes true after opt-in (see coldWalkJustBroke()). Falling
// tone distinct in register from rockClimbEndCue (triangle, :6092) and veilOverloadEndCue
// (sawtooth, :6132) so all three "something just ended" cues stay distinguishable.
function coldWalkBrokenCue(){
  if(captionsOn) pushState({ caption: 'sprinted — the cold walk is broken', captionId: ++captionSeq });
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.42);
}
```

In `finishPickup()` (`:5927`), next to `missionBonus`/`secondaryBonus` (`:5958-5966`):
```js
  const coldWalkBonus = (coldWalkOptIn && !coldWalkBroken) ? COLD_WALK_REWARD : 0;
```
and change the `computeWinPayout()` call at `:5967` to pass it:
```js
  const payout = applySpend(computeWinPayout(maxDistFromHome, survivedSeconds, difficulty, missionBonus, secondaryBonus, coldWalkBonus), embersSpent);
```

Per-frame `pushState` (the `if(playing){ ... pushState({ ... }) } else { pushState({ ... }) }`
pair, `if` branch's `pushState({` opening at `:7104`, `else` branch at `:7144-7145`): add to
the `if(playing)` branch's object, next to `mountedOnRock` (`:7140`):
```js
      coldWalkActive: coldWalkOptIn && !pickingUp,
      coldWalkBroken,
```
and add `coldWalkActive: false,` to the `else` branch's reset object (`:7145`), matching how
`mountedOnRock`/`veilOverloadActive` are reset there. (`coldWalkBroken` does not need a reset
in the `else` branch — it is a per-run fact independent of `playing`, and the panel is hidden
by `coldWalkActive: false` regardless.)

Returned actions object (`:7573-7584`): add `setColdWalkOptIn` next to `setCaptions`:
```js
           setDifficulty, setRunMode, setSensitivity, setInvertY, setReducedMotion, setCaptions, setColdWalkOptIn,
```

### `lib/engine-contract.ts`

Add to `ENGINE_ACTION_KEYS` (`:22`), next to `setCaptions`:
```ts
  'setDifficulty', 'setRunMode', 'setSensitivity', 'setInvertY', 'setReducedMotion', 'setCaptions', 'setColdWalkOptIn',
```

### `components/Hud.tsx`

`EngineHudState` (`:32`): add near `veilOverloadActive`/`caveImmuneActive`-style trio
(after `:76-78`'s veil-overload block, or grouped near `difficulty` at `:97` since it's a
setting like `difficulty` — implementer's choice, pick one cluster):
```ts
  // LUL-4960: M5 Cold Walk -- coldWalkOptIn is the persisted setting; coldWalkActive/
  // coldWalkBroken drive #coldWalkPanel, same shape as caveImmuneActive/veilOverloadActive.
  coldWalkOptIn: boolean;
  coldWalkActive: boolean;
  coldWalkBroken: boolean;
```

`EngineActions` (`:184`): add next to `setCaptions` (`:215`):
```ts
  setColdWalkOptIn: (v: boolean) => void;
```

`INITIAL_HUD_STATE` (`:238`): add matching defaults near `:265`:
```ts
  coldWalkOptIn: false,
  coldWalkActive: false,
  coldWalkBroken: false,
```

New panel JSX, placed as a sibling of `#rockClimbPanel` (after its block, `:1004-1009`),
same always-visible-while-active shape:
```tsx
{/* LUL-4960: M5 Cold Walk -- sibling of #rockClimbPanel/#veilOverloadPanel, same
    always-visible-while-active treatment, OUTSIDE #panel so it stays visible with
    adminMode off (Q3). Text swap (not a countdown) is the only visual cue -- see
    the SPEC's ## Cues, "static text swap, no animation to reduce". */}
{state.coldWalkActive && (
  <div id="coldWalkPanel">
    Cold Walk — {state.coldWalkBroken ? 'broken' : 'silent'}
  </div>
)}
```

### `components/SettingsPanel.tsx`

`PersistedSettings` interface: add `coldWalkOptIn: boolean;` next to `captionsOn`.

Apply-on-ready effect (next to the `setCaptions` line):
```ts
    if (typeof s.coldWalkOptIn === 'boolean') actions.setColdWalkOptIn(s.coldWalkOptIn);
```

Persist effect: add `coldWalkOptIn: state.coldWalkOptIn,` to the `writeSettings({...})` call
and `state.coldWalkOptIn` to its dependency array.

New fieldset (placed after the existing "Accessibility" `<fieldset>`, before the panel's
closing `</div>`):
```tsx
<fieldset>
  <legend>Run modifiers</legend>
  <label className="radioRow">
    <input
      type="checkbox"
      checked={state.coldWalkOptIn}
      onChange={(e) => actions?.setColdWalkOptIn(e.target.checked)}
    />
    Cold Walk — never sprint before you find the child, for bonus Embers on a win
  </label>
</fieldset>
```

### `docs/ELEMENTS.md`

Add an entry for `#coldWalkPanel` in the engine-owned-DOM list (same section that documents
`#rockClimbPanel`/`#veilOverloadPanel`) and a short prose note describing the
`coldWalkOptIn`/`coldWalkActive`/`coldWalkBroken` state trio and `COLD_WALK_REWARD`. Re-run
`node scripts/check-elements-citations.mjs` after — this SPEC's own line numbers will have
shifted once real code lands around them; re-derive at implementation time (this file's own
header already says so).

### `docs/CUES.md`

Add a row for `coldWalkBrokenCue` — visual (panel text swap), audio (falling sine, described
above), caption ("sprinted — the cold walk is broken"), reduced motion (static, no animation
to reduce — the panel text change is not itself animated).

## Verification

- `npx tsc --noEmit` — clean. Load-bearing for `ENGINE_ACTION_KEYS`'s exhaustiveness check
  (`lib/engine-contract.ts`) — if `setColdWalkOptIn` is added to `EngineActions` but missing
  from the array (or vice versa), this fails.
- `npm test` (unit) — new `lib/game/coldWalk.test.ts` (the pure predicate: true only when
  opted in, not already broken, not mid-pickup, and running; false for every other
  combination) and new `lib/game/economy.test.ts` cases mirroring `:184-208`'s existing
  `FIREPOWER_RETRIEVAL_BONUS` shape for `coldWalkBonus`.
- `node scripts/check-elements-citations.mjs` — clean.
- `npx eslint .` (the `lint` script) — clean.
- `npm run build` — clean.
- New e2e spec passes locally against a real build (`npx playwright test e2e/cold-walk.spec.ts`).

## e2e

**Specs.** `e2e/cold-walk.spec.ts` — new:
- `'#coldWalkPanel is absent when not opted in'` — default localStorage (no `coldWalkOptIn`
  key), boot, enter, assert `#coldWalkPanel` stays hidden through a real sprint keypress.
- `'#coldWalkPanel shows silent, then broken, the instant the player sprints'` — seed
  `lullwood:settings` with `{ coldWalkOptIn: true }` (mirrors `e2e/minimap-setting.spec.ts`'s
  `seedSettings()` helper), boot, enter, assert `#coldWalkPanel` reads "silent", press and
  hold the real sprint key (`Shift` — not a QA hook, per Q1.5/Q11), assert the panel flips to
  "broken" within one frame and stays "broken" after releasing Shift and pressing it again
  (sticky for the rest of the run).
- `'sprinting after pickup does not break Cold Walk'` — opted in, `qaTeleportNearBaby`
  (existing hook), real `KeyE` press to accept pickup, then hold Shift during the cinematic;
  assert `#coldWalkPanel` still reads "silent" (the `!pickingUp` gate holds).
- `'a silent outbound leg pays COLD_WALK_REWARD on win, a broken one does not'` — two runs,
  same fixed seed, `qaTeleportNearBaby` for a deterministic short leg in both: (a) opted in,
  never sprints, real `KeyE` pickup, wait for `#winScreen`, read `.emberGain`'s total; (b)
  opted in, sprints once before pickup, same pickup/win path, read total; assert (a) − (b) ==
  `Math.round(COLD_WALK_REWARD * TIER_MULTIPLIERS[difficulty].win)` (the same tier-scaling
  `economy.test.ts:207-208` already asserts for `FIREPOWER_RETRIEVAL_BONUS`).

**World.** micro (`qaBuildScene` default — no new props needed, this is a player-input-only
mechanic with no world geometry dependency). Not `@fullmap`.

**Hooks.** No new `qaXxx` hook — opt-in goes through the real `SettingsPanel` → `localStorage`
→ apply-on-ready path (`e2e/minimap-setting.spec.ts`'s `seedSettings()` pattern), and the
constraint itself is driven by the real sprint key, not a forced flag (Q1.5/Q11). Existing
hooks reused: `qaTeleportNearBaby`.

**Tester scenario.** `shared/local-qa/requests/lul-4960-cold-walk.md`, filed by the
implementer in the same PR (per the standing local-qa rule — this ships a new player-visible
panel and Settings checkbox). Steps: opt in via Settings, walk to the child without sprinting,
confirm `#coldWalkPanel` reads "silent" throughout and the win-screen embers total reflects
the bonus (screenshot both).

**Not covered.** The `COLD_WALK_REWARD = 8` placeholder's game feel/balance (Game Economist's
territory — a follow-up ticket is filed alongside this SPEC's dispatch). Real-device audio
feel for `coldWalkBrokenCue()`.

## Cues

**Visual.** `#coldWalkPanel` appears the moment `enter()` fires with `coldWalkOptIn` true,
reading "Cold Walk — silent"; the instant the constraint breaks, the same element's text
swaps to "Cold Walk — broken" (`components/Hud.tsx`, new JSX above). No animation, no flash —
consistent with the `#rockClimbPanel`/`#veilOverloadPanel`/`#caveImmunePanel` family, all of
which are plain text swaps.
**Audio.** `coldWalkBrokenCue()` (`engine/forest-engine.js`, new, near `:6176`) — one-shot
falling sine (320Hz → 140Hz over 0.3s), gated by `soundOn`, fires exactly once per run the
frame the constraint first breaks.
**Explanation.** "sprinted — the cold walk is broken", pushed as a caption from the same cue
function, gated by `captionsOn`, fired the same frame as the audio.
**Reduced motion.** Static text swap — no animation to reduce (same as the panel family this
mirrors).

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- Tier C — `REVIEW: APPROVED` required before merge (engine simulation touch + core win-payout
  signature change).
- `coldWalkJustBroke()` (`lib/game/coldWalk.ts`) must stay pure — no engine state reads, no
  side effects — so it is testable in isolation per the codebase's established
  `lib/game/veilOverload.ts`/`lib/game/rockClimb.ts` convention.
- `computeWinPayout()`'s new 6th param must default to `0` — every existing call site (and
  every existing test) that doesn't pass it must keep behaving identically.
- `COLD_WALK_REWARD` is an explicit placeholder — do not treat it as final pricing; the
  follow-up Economist ticket owns the real number.
- Do not add a `MissionKind`/`MISSION_POOL` entry for this — the retarget ruling's
  architecture note and this SPEC's Design call both rule that out explicitly.

## Out of scope

- Repricing `COLD_WALK_REWARD` (Game Economist, follow-up ticket).
- Any change to `game/economy/mission-rewards.md`'s stale M5 table row — that document's
  M5 section describes the pre-retarget "carry home at a walk" design and needs its own
  correction pass; not duplicated here to keep this diff scoped to the mechanic itself.
- The pre-retarget carry-home-leg design in general — dead, per
  `decisions/lul-2281-pickup-is-the-win-2026-09-09`, not resurrected by this ticket.
- Any HINT_PRIORITY / first-encounter hint for Cold Walk — this is a player-chosen opt-in,
  not a discoverable-by-accident mechanic, so it needs no onboarding hint.
