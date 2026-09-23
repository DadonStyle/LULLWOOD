# SPEC: LUL-4790 Cover Degradation Full (difficulty-scaled rustle threshold + reposition-to-reset)

**Ticket:** LUL-4790 · **Tier:** B — pure multiplier addition to an existing shipped tick-loop
check, reuses `DIFFICULTY_PRESETS` (already imported), no new input, no new UI surface, no new
audio/chronicle event. Merges on green CI; no `REVIEW: APPROVED` gate required. (Compare
LUL-2856, the cheap slice this extends, which was Tier C for adding a new function, DOM
element, audio synth and chronicle event — this ticket adds none of those, only two number
lookups at an existing call site.)

**Written against:** `release/next` @ `81867ea` (2026-09-23). Re-derive every `file:line`
below if the branch has moved.

**Source.** LUL-4629 Feature Scout resolution comment (2026-09-22) + `decisions/
cover-degradation-full-accepted-2026-09-23` (CEO acceptance of the "Full" slice) +
`decisions/lul-2570-cover-degradation-accepted-2026-09-17` (original scope split) + this
SPEC's own live re-verification against `release/next`.

## Deviations found verifying the ticket's citations live (fix before implementing)

1. **`:6307` (cited by the ticket for "the game's real difficulty tiers") is
   `drawMinimapStatic()`, not a tiers table.** The real `difficulty`/`DIFFICULTY_PRESETS`
   surface is: the module-level `let difficulty = 'night';` (`engine/forest-engine.js:1969`),
   `DIFFICULTY_PRESETS` itself (`engine/tuning.js:303-307`, keys `lantern`/`night`/`blackout`
   confirmed), and `setDifficulty(d)` (`engine/forest-engine.js:6194-6196`, `difficulty = d`).
   The `['lantern','night','blackout']` literal also appears at `:6264` (`setProgression`), an
   independent confirmation of the three real tier keys.

2. **The tick site has drifted from the ticket's `:6530-6535`/`:6534-6535` to `:6487-6495`**
   (`hideTime = hidden ? hideTime + dt : 0;` at `:6487`, `coverRustleAccum` block at
   `:6491-6495`) — this is the exact block LUL-2856 landed, confirmed against
   `docs/specs/lul-2856-cover-degradation-cheap-slice.md`'s own diff (which cited `:6207` at
   spec-writing time, now `:6487` after further merges). Re-derive again if the branch has
   moved further; do not trust either of these line numbers as load-bearing beyond this PR.

3. **"Reposition-to-reset... needs a position-delta check" is not implementable as an
   independent check today — it would be dead code.** Verified by grep: every
   `player.x =` / `player.z =` write in `stepFrame()` during real play is nested inside
   `if(playing && !hidden){ ... }` (`engine/forest-engine.js:6581`) or is a QA teleport hook
   (`qaTeleportTo`/`qaTeleportNearBaby`/`qaTeleportHome`, none of which fire in real play). **A
   player's `player.x/z` cannot change while `hidden === true` anywhere in `release/next`
   today** — `if(hidden && (moveKey || hasTouchMove)) exitHide();` (`:6486`) forces an exit
   before any WASD/touch input is allowed to move the player. This is exactly the Q1.5 trap
   (`docs/FEATURE_CHECKLIST.md` §A.1.5, LUL-4662 precedent): a trigger condition with no live
   real-play `file:line` that sets it true is treated as unproven, not shipped.

   **The one real path that will exist is LUL-3066 (Hide Reposition / Wind-Gated Shuffle,
   issue `597a44f9`), currently `docs/specs/lul-3066-hide-reposition.md`, implementation
   dispatched as LUL-4786 (Game Engineer, `todo`, not yet merged as of this SPEC).** Its
   `shuffleHide()` (spec `## Files`, "on success sets `player.x/z`, `hideTime = 0`...") already
   resets `hideTime` to `0` unconditionally on every successful shuffle. Because
   `coverRustleAccum` is *itself* self-healing off `hideTime` (`:6491`: `coverRustleAccum =
   hideTime > threshold ? coverRustleAccum + dt : 0`), a shuffle's `hideTime = 0` already
   zeroes `coverRustleAccum` for free on the very next tick, with zero new code — this
   is the same "self-healing needs one line, not four" property the cheap slice's own SPEC
   already relies on (`lul-2856-cover-degradation-cheap-slice.md` §3). `SHUFFLE_OFFSET = 1.0`
   (`lib/game/cover.ts`, per the LUL-3066 spec) also exceeds this ticket's own `>0.5u`
   framing, and the shuffle resets unconditionally on success — not distance-gated — so it is
   a strictly *stronger* reset than the literal ask, not a weaker substitute.

   **Building an independent position-delta reset system in parallel would be a Q7/Q8
   duplicate** (`docs/FEATURE_CHECKLIST.md` §B): both systems would fire off the same
   "player's world position just changed while hidden" event, and the only thing that can ever
   produce that event today is `shuffleHide()` itself. **Decision: reposition-to-reset ships as
   composition, not new code** — see Part B below. This is an implementation-approach call
   inside my own remit (spec-writing/discovery), not a design ambiguity that needs to bounce to
   the CTO; the "what" (a reposition resets the rustle clock) is unchanged, only the "how" (via
   the already-planned shuffle, not a redundant tracker) is resolved here.

## Part A — Difficulty-scaled rustle threshold (ships in this PR, no dependency)

### Files

- `engine/tuning.js` — edited: two new per-tier multiplier fields on `DIFFICULTY_PRESETS`.
- `engine/forest-engine.js` — edited: the existing `coverRustleAccum` tick-loop check
  (`:6491-6495`) reads the two new fields instead of the bare constants.
- `lib/game/noise.ts` — edited: doc-comment update only, no new exports, no value change.
- `docs/ELEMENTS.md` — edited: one paragraph, see below.
- `e2e/cover-rustle.spec.ts` — edited: two new cases.

### The change

**1. `engine/tuning.js` — new per-tier multipliers on `DIFFICULTY_PRESETS` (`:303-307`)**

```js
// before:
export const DIFFICULTY_PRESETS = {
  lantern:  { activePerSpecies: 1, detectMul: 0.7, glowMul: 1.6, startHunting: false, minimap: true },
  night:    { activePerSpecies: 3, detectMul: 1,   glowMul: 1,   startHunting: false, minimap: true },
  blackout: { activePerSpecies: 3, detectMul: 0.7, glowMul: 1,   startHunting: true,  minimap: false },
};
// after:
export const DIFFICULTY_PRESETS = {
  // LUL-4790: rustleThresholdMul/rustleIntervalMul scale lib/game/noise.ts's
  // COVER_RUSTLE_THRESHOLD_S/COVER_RUSTLE_INTERVAL_S (12s/5s, the 'night' baseline) the same
  // multiplier-on-a-base-value shape detectMul already uses against p.spec.detect -- not a
  // second source of truth, night's 1/1 keeps this preset's long-standing "every multiplier
  // is a no-op" property (see the comment above this object). lantern gets more grace (longer
  // threshold, slower interval) to match its forgiving detectMul/activePerSpecies; blackout
  // gets less (shorter threshold, faster interval) to match its startHunting/full-roster
  // pressure -- same "thematically consistent, not just a balance knob" reasoning the
  // LUL-1440 detectMul comment above already uses for this object. Resulting absolute values:
  // lantern 16s/6s, night 12s/5s (unchanged), blackout 8s/4s.
  lantern:  { activePerSpecies: 1, detectMul: 0.7, glowMul: 1.6, startHunting: false, minimap: true,  rustleThresholdMul: 4/3, rustleIntervalMul: 6/5 },
  night:    { activePerSpecies: 3, detectMul: 1,   glowMul: 1,   startHunting: false, minimap: true,  rustleThresholdMul: 1,   rustleIntervalMul: 1   },
  blackout: { activePerSpecies: 3, detectMul: 0.7, glowMul: 1,   startHunting: true,  minimap: false, rustleThresholdMul: 2/3, rustleIntervalMul: 4/5 },
};
```

**2. `engine/forest-engine.js` — the tick-loop check reads the per-tier multiplier
(`:6491-6495`)**

```js
// before:
coverRustleAccum = hideTime > COVER_RUSTLE_THRESHOLD_S ? coverRustleAccum + dt : 0;
if(coverRustleAccum >= COVER_RUSTLE_INTERVAL_S){
  coverRustleAccum = 0;
  rollCoverRustle();
}
// after:
// LUL-4790: difficulty-scaled grace window/interval -- DIFFICULTY_PRESETS[difficulty] is
// already read live every tick two lines below in effectiveDetect()/canSee() (:2598,:2602),
// same "no restart needed, changes next tick" property applies here.
coverRustleAccum = hideTime > COVER_RUSTLE_THRESHOLD_S * DIFFICULTY_PRESETS[difficulty].rustleThresholdMul ? coverRustleAccum + dt : 0;
if(coverRustleAccum >= COVER_RUSTLE_INTERVAL_S * DIFFICULTY_PRESETS[difficulty].rustleIntervalMul){
  coverRustleAccum = 0;
  rollCoverRustle();
}
```

No import change needed — `DIFFICULTY_PRESETS` is already imported at `engine/forest-engine.js:205`.

**3. `lib/game/noise.ts` — doc-comment update only (no value/export change)**

The two existing comments (currently on `COVER_RUSTLE_THRESHOLD_S`/`COVER_RUSTLE_INTERVAL_S`,
around the constants confirmed live in this checkout) say "Cheap-slice default: fixed for all
difficulties" and "reusing HIDE_ALERT_RADIUS...". Update the first to:

```ts
/** LUL-2856/LUL-4790: past this many seconds continuously hidden in the same spot, the brush
 * itself starts periodically rustling -- turtling in one bramble stops being free. This is
 * the 'night'-tier (baseline) value; engine/tuning.js's DIFFICULTY_PRESETS[tier].rustleThresholdMul
 * scales it per difficulty (LUL-4790) -- this module stays framework-agnostic/unit-testable,
 * so the per-tier table lives in engine/tuning.js, not here (same layering
 * lib/game/cover.ts's STILL_RAMP already keeps: this module owns the base number, the engine
 * owns which multiplier applies). */
export const COVER_RUSTLE_THRESHOLD_S = 12;
```

(Interval constant's comment gets the equivalent one-clause addition naming
`rustleIntervalMul`.) The numeric values (`12`, `5`) are unchanged.

**4. `docs/ELEMENTS.md` — update the closing sentence (`:1442-1444`)**

```
// before:
Fixed threshold + fixed interval
only in this slice -- no difficulty/cover-density scaling and no reposition-to-reset action (both
deferred, see `decisions/lul-2570-cover-degradation-accepted-2026-09-17`).
// after:
LUL-4790 (Cover Degradation Full) scales both by difficulty tier --
`DIFFICULTY_PRESETS[tier].rustleThresholdMul`/`rustleIntervalMul` (`engine/tuning.js`) --
lantern 16s/6s, night 12s/5s (unchanged), blackout 8s/4s -- and adds reposition-to-reset via
LUL-3066's Shuffle action (see that ticket's own ELEMENTS.md entry): a successful shuffle's
`hideTime = 0` already zeroes `coverRustleAccum` through the self-healing tick check above, no
separate reset path. Cover-density scaling remains out of scope (Economist follow-up, not part
of the LUL-4629/CEO-accepted "Full" slice).
```

### Verification

- `npx tsc --noEmit` — clean (plain JS + `.d.ts`, no new type surface here).
- `npm run lint` — clean.
- `npx playwright test cover-rustle` — 7/7 (5 existing + 2 new, see `## e2e`).
- `node scripts/check-elements-citations.mjs` — 0 drift after the `docs/ELEMENTS.md` edit
  above.
- No unit test changes required — `DIFFICULTY_PRESETS` has no existing `.test.js` coverage
  (confirmed by grep) and the two new fields are plain object literals, not functions;
  `lib/game/noise.test.ts`'s existing `COVER_RUSTLE_*`-adjacent constants are unchanged in
  value, only in comment.

## Part B — Reposition-to-reset (composition, sequenced after LUL-4786)

**No new engine code.** Per Deviation 3 above, `coverRustleAccum` is already reset to `0` by
any successful `shuffleHide()` call, once LUL-3066/LUL-4786 lands — through the exact tick
check Part A edits (`hideTime = 0` from the shuffle → `coverRustleAccum`'s own self-healing
formula zeroes it the next tick). This PR's only obligation for Part B is a composition e2e
test proving the two features interact correctly, and it can only be written and run once
`shuffleHide()` exists in the checkout.

**Sequencing for the implementer:**
- Land Part A (difficulty scaling) in this PR regardless of LUL-4786's state — it has no
  dependency.
- Before opening the PR, `grep -n "function shuffleHide" engine/forest-engine.js` in your
  checkout. If it's there (LUL-4786 merged), add the one e2e case below to
  `e2e/cover-rustle.spec.ts` in the same PR. If it isn't yet, land Part A alone and leave a
  one-line PR-body note ("Part B composition test pending LUL-4786") — do not block Part A on
  it, and do not build a standalone position-tracker to route around the dependency (Deviation
  3's Q7/Q8 point stands regardless of merge order).
- If Part B's test ends up deferred, file it back on this ticket as a `todo` child blocked on
  LUL-4786, not left as a silent gap.

**The composition test** (added to `e2e/cover-rustle.spec.ts`'s `describe` block once
`shuffleHide()` exists):

```
"a successful shuffle resets coverRustleAccum -- the timer doesn't carry a near-threshold
hideTime across a reposition"
```
Reuse `stageHidden(page)` (existing helper, this file) to enter hide, `advanceChunked` to just
under `COVER_RUSTLE_THRESHOLD_S` (the existing `BEFORE_THRESHOLD_S = 11.4` constant), press
`KeyR` (the shuffle key per the LUL-3066 SPEC) with a movement key held so `shuffleHide()` has
a direction to resolve, then advance the *same* `BEFORE_THRESHOLD_S` window again. Assert no
`cover_rustle` chronicle entry exists yet (proves `hideTime`/`coverRustleAccum` restarted from
0 after the shuffle rather than continuing to accumulate toward the original threshold, which
would have fired partway through the second window if the reset hadn't happened).

## Cues

No new cue triple — Part A reuses `rollCoverRustle()`'s existing `#rustleFlash`/`rustleSting()`/
caption unchanged (only the timing that triggers it moves); Part B fires nothing new, it only
changes when the existing `hideTime`-driven caption *doesn't* fire (because the clock
restarted). No `docs/CUES.md` change needed.

## e2e

**Specs.** `e2e/cover-rustle.spec.ts` (existing file, LUL-2856), two new cases for Part A:

1. **"blackout's shorter grace window fires a rustle before night's baseline threshold at the
   same elapsed hide time"** — `stageHidden(page)` per the existing helper, but first select
   Blackout in Settings (mirrors `e2e/minimap-setting.spec.ts:53-55`'s exact click sequence —
   `menuToggle` → `#settingsBtn` → `page.getByLabel(/blackout/i)` — done *before* `stageHidden`
   so the menu is closed and the sim unpaused before staging; no `qaRegenerateMap` needed,
   unlike the minimap test, because `DIFFICULTY_PRESETS[difficulty]` is read live every tick
   the same way `detectMul` already is, not gated behind a restart). Advance 13s (past
   blackout's scaled 8s+4s=12s first roll, short of night's unscaled 17s). Assert
   `qaGetChronicle()` contains a `cover_rustle` entry.
2. **"lantern's longer grace window has not yet fired at night's baseline first-roll time"** —
   same shape, select Lantern, advance the existing `PAST_FIRST_ROLL_S` constant (17.4s — past
   night's 17s first roll, short of lantern's scaled 16s+6s=22s). Assert `qaGetChronicle()`
   contains **no** `cover_rustle` entry.

Both stage no predator (default parked wolf at `9999,9999`, same pattern
`stageHidden`/`"still flashes under reduced motion"` already use) — the assertion is purely
about *whether the roll fired at all* (via the chronicle event, which `rollCoverRustle()` logs
unconditionally per its own body), not about alerting, so no antagonist staging is needed for
these two; the antagonist proof for the roll mechanism itself is already covered by the
existing 3 cheap-slice tests in this file, unchanged by Part A.

Part B's one composition case is specified above under **Part B**, added only once its
dependency (`shuffleHide()`) exists.

**World.** micro (default), same as every existing case in this file. No `@fullmap`.

**Hooks.** All existing, no new hook: `qaSetFixedStep`/`qaAdvance` (via `advanceChunked`),
`qaBuildScene`, `qaTeleportToHideSpot`, `qaGetChronicle`. Difficulty selection goes through the
real Settings UI (`page.getByLabel`), not a QA hook — matching the established pattern
`e2e/minimap-setting.spec.ts` already uses for `setDifficulty`, since it's a React-mediated
`EngineActions` call, not a direct `window.ForestEngine` hook.

**Tester scenario.** Extend `shared/local-qa/requests/lul-2856-cover-rustle.md` (filed
alongside LUL-2856) with a Part A note: switch to Blackout in Settings, hide near a roam
predator, confirm the rustle flash/sting fires noticeably sooner than on Night. No new request
file — same feature area, same screenshot targets, only the timing changed.

**Not covered.** Part B's actual player-facing feel (does a shuffle-to-reset read as a
meaningful tactical choice in a real chase) — manual founder/QA-tester review once LUL-4786
ships, same "gameplay/visual/audio behavior stays unverified until a human confirms it" rule
every Founding Engineer handoff carries.

## Constraints

- **Do not add a standalone position-delta tracker for reposition-to-reset.** Deviation 3 above
  is binding: the only live trigger for "player position changes while hidden" is
  `shuffleHide()` (LUL-3066/LUL-4786); a parallel tracker is unreachable dead code today and a
  Q7/Q8 duplicate the day LUL-4786 ships.
- **`night`'s multipliers stay `1`/no-op.** Do not retune the baseline 12s/5s values themselves
  in this ticket — only lantern/blackout get new multipliers, matching the standing "`night` is
  the existing tuning verbatim" property `DIFFICULTY_PRESETS`'s own header comment documents.
- **Cover-density scaling stays out of scope** (Economist follow-up per the original
  LUL-2570 decision) — this ticket is difficulty-tier scaling only, per its own title.
- **Never widen `rollCoverRustle()`'s `p.state === 'roam'`-only gate.** Unchanged by this
  ticket; restated because both files it touches sit right next to that gate.
- Tier B: merges on green CI (`tsc`, lint, unit tests, `cover-rustle` Playwright suite,
  `check-elements-citations.mjs`); no Code Reviewer gate.

## Out of scope

- Cover-density-based scaling (denser brambles muffle longer) — separate Economist proposal,
  per the original wiki proposal's own "Full" vs never-scoped-here split.
- Any change to `STILL_RAMP`/`effectiveDetect` (`lib/game/cover.ts`) — unchanged, same
  boundary the cheap-slice SPEC already drew.
- LUL-3066/LUL-4786's own implementation (`shuffleHide()`, `KeyR`, touch Shuffle button) — that
  ticket's scope, not this one's. This SPEC only composes with it.
- A pacing/cheese check on whether Blackout's faster 4s interval plus a 2s shuffle cooldown
  (`SHUFFLE_COOLDOWN_S`, LUL-3066) lets a player out-cycle the rustle roll entirely — the
  LUL-3066 SPEC already flags this exact question as a companion ticket to the Game Economist;
  not duplicated here.
