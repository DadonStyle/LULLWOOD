# SPEC: LUL-3066 Hide Reposition / Wind-Gated Shuffle

**Ticket:** LUL-3066 (issue `597a44f9`) · **Tier:** C — engine simulation, stealth/detection
core loop, new keybinding. `REVIEW: APPROVED` required before merge, per the CTO's PLAN
comment on this ticket.

**Written against:** `release/next` @ `9ef0f60` (2026-09-23). Re-derive every `file:line`
below if the branch has moved.

**Source.** CEO decision 2026-09-18 (LUL-3066 revival, all 16 Section-0 questions answered
via `suggest_tasks`) + the CTO's PLAN comment on this ticket (2026-09-18) + this SPEC's own
live re-verification.

## Deviations found verifying the PLAN's citations live (fix before implementing)

1. **Every `forest-engine.js` line number in the PLAN has drifted** (the file has taken ~15
   merged PRs since 2026-09-18). Corrected anchors used throughout this SPEC:
   `enterHide()` `:3554` (not `:3497`), `exitHide()` `:3576` (not `:3518`), the keydown
   listener's `KeyH` handler `:3343` inside the block starting `:3305` (not `:3258`), the
   `if(playing && !hidden)` movement block `:6581` (not `:6416`), the `fx/fz/rx/rz`
   transform `:6591-6592` (not `:6431-6432`), `isMovingAgainstWind(mvx, mvz, ...)` call
   `:6604` (not `:6457`).

2. **"`enterHide(spot)` only retains `spot.kind`, not the full `CoverAABB`"** — true today
   (`:3554`: `hidden = true; hideTime = 0; hideKind = spot.kind; ...`), but `spot` (the full
   `CoverAABB`, already resolved by `findHideSpot()` in `toggleHidden()` `:3596-3599`) is
   already a parameter of `enterHide()`. No new lookup or retrieval is needed — storing
   `hideSpot = spot;` in the existing function body is a one-line add, not a design problem.

3. **`hideSpot` reset call sites** — the PLAN's `:5690, :5959, :6013` no longer point at
   hide-state resets. The real full set of places `hidden`/`hideKind`/`lastHideSpot` are
   force-reset outside `exitHide()` (new `hideSpot = null;` goes in all of them, alongside
   the existing `lastHideSpot = null`):
   - `:3202-3206` — module-level `let` init (add `hideSpot = null,` to the list).
   - `:3576` — `exitHide()` itself.
   - `:5842` — pickup-path reset (`hidden = false; lastHideSpot = null; ...`).
   - `:6110` — `arriveHome()`-family reset (`hidden = false; lastHideSpot = null; ...`).
   - `:6162` — `triggerDeath()`-family reset (`hidden = false; hideKind = null; lastHideSpot
     = null; ...`).

4. **The caption mechanism the PLAN describes conflates two different HUD elements.**
   `statusText`/`statusVisible` (`components/Hud.tsx:1164,1166`) drive the persistent
   `#actionSlot` "Hidden · Xs" `<ActionPrompt>` row; the engine's tick loop recomputes and
   overwrites `statusText` **every frame** while `hidden` (`engine/forest-engine.js:6886-
   6887`: `statusText = ... 'Hidden · ' + hideTime.toFixed(1) + 's   (moving breaks
   cover)'`). `caption`/`captionId` is a **separate** one-shot toast overlay
   (`useCaptionToast`, `components/Hud.tsx:524-547`, rendered `:869-874`), independent of
   the status row. A `pushState({ caption: ..., captionId: ++captionSeq })` call does not
   "overwrite the ActionPrompt row for one beat" — it fires a toast *alongside* the row,
   which keeps showing "Hidden · Xs" on its own every tick regardless, exactly like the
   existing `hideAlert` (`:3571-3574`) and `coverRustle` (`:3591-3593`) one-shot captions
   already do from inside `enterHide()`/`rollCoverRustle()`. `shuffleHide()` follows that
   same pattern — fire a toast, do not touch `statusText`/`statusVisible`.

5. **"Red corner flash (downwind only)" has no matching severity-appropriate primitive.**
   The only red full-screen vignette is `#spotFlash` (`components/GameCanvas.tsx:778-779`,
   `rgba(200,0,0,0.5)`), driven by `spotFlash`/`spotSting()` (`:3194`) fired exclusively on
   a **real detection** ("you were just spotted" — `spotSting()`'s own comment,
   `:3752`). A newly-alerted **roam→investigate** predator (what a downwind shuffle causes)
   is a strictly lower-severity event than a spot, and the codebase already has the correct-
   severity primitive for exactly this class of event: `rustleFlash`/`rustleSting()`
   (`:3589`, green-tinted vignette `rgba(90,110,30,0.5)`, `components/GameCanvas.tsx:786-
   787`), used by `rollCoverRustle()` for the same "a roam predator got newly alerted by
   noise" case. Using `spotFlash` here would misrepresent the event as a full detection.
   **Correction:** both the "always" and "downwind" visual pulses reuse
   `rustleFlash = 1; rustleSting();` — the downwind case is not visually distinct from the
   upwind case beyond the predator-alert side effect itself (which the player already
   perceives via the predator's own behavior change). Drop the "red" framing from the PLAN.

Everything else in the PLAN's citations checked out exactly or within a line or two
(`lib/game/scent.ts:121` `isMovingAgainstWind`, `lib/game/cover.ts:631` `HIDE_RADIUS`,
`lib/game/cover.ts:644` `findHideSpot`, `lib/game/noise.ts:46/51`
`COVER_RUSTLE_THRESHOLD_S`/`COVER_RUSTLE_INTERVAL_S`, `leafRustle()` `:3525`,
`checkThrowableNoise`/`hearNoise`/`HIDE_ALERT_RADIUS` usage in `enterHide()`, `HINT_PRIORITY`
`:2245-2246`, `markHintSeen`/`hintSeen` `:2288/2300`). **The `qaSetWindDirection(x, z)` hook
the PLAN says needs filing as a companion ticket already exists** (`:5544-5548`, landed via
an earlier LUL-3009 companion ticket) — the e2e plan below uses it directly, no new hook
ticket needed.

## Files

- `engine/forest-engine.js`:
  - State: add `hideSpot = null` to the `let` block at `:3202-3206`; add
    `let shuffleCooldownAccum = 0;` nearby.
  - `enterHide(spot)` `:3554`: add `hideSpot = spot;` in the assignment line.
  - `exitHide()` `:3576`, and the three force-reset sites (`:5842`, `:6110`, `:6162`): add
    `hideSpot = null;` alongside the existing `lastHideSpot = null;`.
  - Keydown listener, next to the `KeyH` line `:3343`: `if(e.code === 'KeyR' && playing &&
    !paused && hidden && shuffleCooldownAccum <= 0) shuffleHide();`
  - New `function shuffleHide()`, placed after `exitHide()`/`rollCoverRustle()` (near
    `:3600`): computes direction (held `keys['KeyW'/'KeyS'/'KeyA'/'KeyD']` + `touchMove`,
    same `ix/iz` → `fx/fz/rx/rz` transform as `:6591-6598`, using `player.yaw`; falls back to
    facing direction if `ix===0 && iz===0`), calls `isMovingAgainstWind(mvx, mvz, windX,
    windZ)`, computes candidate `player.x/z + mvx/mvz * SHUFFLE_OFFSET`, validates against
    `hideSpot` via `insideHideFootprint()`/`blocked()` (clamp along the cover edge — never a
    silent no-op, `hideSpot`'s footprint is finite so a clamped candidate always exists while
    still inside it), on success sets `player.x/z`, `hideTime = 0`, fires `leafRustle`-style
    footstep (muffled/full variant flag), fires the alert roll (reuse the exact
    `enterHide()` `:3560-3566` loop, gated `movingAgainstWind` for silent-vs-alerting),
    `rustleFlash = 1; rustleSting();` unconditionally, transient caption via `pushState({
    caption, captionId: ++captionSeq })` ("Shifted position" / "Shifted position — noisy"),
    resets `shuffleCooldownAccum = SHUFFLE_COOLDOWN_S`.
  - Tick loop: decrement `shuffleCooldownAccum` by `dt` each frame (floored at 0), anywhere
    dt-driven timers already decay (e.g. near `rustleFlash`'s decay `:6836`).
  - `HINT_PRIORITY` `:2245-2246`: insert `'hideReposition'` after `'cover'`. First-use hint
    fired from inside `shuffleHide()` via the existing `hintSeen`/`markHintSeen` pattern:
    "Press R to shift position within cover — silent upwind, noisy downwind."
- `lib/game/cover.ts`: `export const SHUFFLE_OFFSET = 1.0;` next to `HIDE_RADIUS` (`:631`).
- `lib/game/noise.ts`: `export const SHUFFLE_COOLDOWN_S = 2.0;` next to
  `COVER_RUSTLE_THRESHOLD_S`/`COVER_RUSTLE_INTERVAL_S` (`:46-51`) — flagged for the Game
  Economist's standing pacing-check duty (does this let a player cheese the 12s/5s rustle
  clock? — non-blocking companion ticket, filed below).
- `components/Hud.tsx`: no structural change. Caption text flows through the existing
  `caption`/`captionId` plumbing (`:98-99`); `statusText` continues to be driven purely by
  the tick loop's own "Hidden · Xs" computation, untouched by this feature.
- **Touch affordance (mobile-parity, corrects the PLAN's silence on it — see below):** new
  `function triggerTouchShuffle()` next to `triggerTouchHide()` (`:7336-7339`), same guard
  shape (`isPlaying(runState()) && !paused`) plus `hidden && shuffleCooldownAccum <= 0`,
  calling the same `shuffleHide()` the `KeyR` handler calls. Per the LUL-1697 engine/React
  contract rule, all five parts land in this PR: (1) `triggerTouchShuffle` exists in the
  engine: `:7336-7339` region; (2) added to `init()`'s `return { ... }` at `:7395-7396`
  alongside `triggerTouchHide`; (3) added to `EngineActions` in `components/Hud.tsx:190`
  region; (4) added to `ENGINE_ACTION_KEYS` in `lib/engine-contract.ts:16` alongside
  `'triggerTouchHide'`; (5) a Playwright spec exercises the React call site on desktop
  (`KeyR`) AND mobile (the new button) — see `## e2e` below.
- `components/MobileControls.tsx`: new `<ActionBtn label="Shuffle" testId="touchShuffle"
  onTap={() => actions.triggerTouchShuffle()} />` in the same `row` as the existing Hide
  button (`:387`), inside the `{entered && (<div style={row}>...` block `:386-390`.
- `e2e/hide.spec.ts`: 3 new cases (see `## e2e`), including one on the mobile viewport.
- `docs/CUES.md`: new row for the shuffle's cue triple.
- `shared/local-qa/requests/lul-3066-hide-reposition.md`: new request file (filed alongside
  this SPEC).

## Cue triple (`decisions/0015-cue-triple`)

- **Visual:** `rustleFlash`/`rustleSting()`'s existing green vignette pulse, always, on
  every successful shuffle (not just downwind — see Deviation 5).
- **Audio:** `leafRustle()`-shaped footstep, muffled variant upwind / full variant downwind
  (respects `soundOn`).
- **One-line:** transient `caption` toast ("Shifted position" / "Shifted position — noisy"),
  gated `captionsOn`, every use; plus the one-time `HINT_PRIORITY` hint on first use, gated
  `captionsOn` + `hintSeen('hideReposition')`.

## e2e

Per Q11/Q12: an opposing system must be staged for the downwind case; per Q13, a request
file ships alongside; per QA-world rule (LUL-2377), everything below runs on the micro
world, no `@fullmap` case exists for this feature.

New cases in `e2e/hide.spec.ts`, reusing the existing `qaBuildScene`/`qaTeleportToHideSpot`
scaffolding (`:36+`) and `qaSetWindDirection(x, z)` (already landed, `engine/forest-
engine.js:5544-5548`):

1. **Upwind shuffle is silent.** Build a bramble, `qaTeleportToHideSpot`, `KeyH`,
   `qaSetWindDirection` to a vector the held `KeyW` heading is moving *against the wind's
   opposite* (i.e. not against-wind — same "known heading vs. forced wind vector" setup
   `e2e/wind-assisted-evasion.spec.ts` already uses, `:1-20`), hold `KeyW`, press `KeyR`.
   Assert: no predator alert (stage one inert roam-state predator via
   `qaStagePredatorNearPlayer` within `HIDE_ALERT_RADIUS`, assert its `qaProbePredatorState`
   stays `'roam'`), `hideTime` resets to `0`, player position moves within the `hideSpot`
   footprint (read via a new-or-existing position probe hook).
2. **Downwind shuffle alerts a staged roamer.** Same setup, `qaSetWindDirection` so the held
   heading is provably *against* the wind (the `movingAgainstWind` case), `KeyR`. Assert the
   staged roam predator's `qaProbePredatorState` transitions to `'investigate'` — same
   assertion shape `e2e/hide.spec.ts`'s existing `hideAlert` test already uses.
3. **Cooldown.** Two `KeyR` presses inside `SHUFFLE_COOLDOWN_S`: assert the second is a
   no-op (position and `hideTime` unchanged from immediately after the first).
4. **Mobile: the touch Shuffle button drives the same effect as `KeyR`.** Boot with
   `mobile: true` (same pattern the existing `touchHide`/`touchVeil` tests use elsewhere in
   the suite), tap `[data-testid="touchShuffle"]` in place of `KeyR` in the upwind case
   above, assert the identical outcome. This is the mandatory desktop+mobile call-site
   coverage the LUL-1697 rule requires for the new `EngineActions` member.

Pre-seed `HINTS_AHEAD_OF_WIND_ASSIST`-style hint keys (same pattern as
`e2e/wind-assisted-evasion.spec.ts:17-23`, extended through `'hideReposition'`) so the new
first-use hint can't preempt or be preempted by an unrelated hint mid-test.

## Local QA request (Q13)

`shared/local-qa/requests/lul-3066-hide-reposition.md` (filed alongside this SPEC): stage a
bramble + a roam predator downwind, press `KeyR` (desktop) and tap the Shuffle button
(mobile), screenshot the rustle-flash pulse and the "Shifted position — noisy" toast on
desktop + one mobile viewport.

## Mobile parity (corrects a PLAN gap)

The PLAN specified `KeyR` with no touch-input affordance and explicitly waived the
`EngineActions`/LUL-1697 contract on the (correct, for the keyboard-only path) reasoning
that `KeyH` needs none. But `KeyH` has a *second*, React-mediated path the PLAN didn't
account for: the existing touch Hide button (`components/MobileControls.tsx:387`) goes
through `triggerTouchHide()` in `EngineActions`/`ENGINE_ACTION_KEYS`
(`lib/engine-contract.ts:16`) precisely because touch has no keyboard. The shuffle needs
the same second path — see **Files** above (`triggerTouchShuffle`) and **e2e** case 4. This
is decided in this SPEC per the standing hard rule ("nothing you ship is desktop-only,
every feature lands with its touch affordance") — not bounced to the CTO, since the fix is
a direct application of the existing `KeyH`/`triggerTouchHide` pattern, not a new design
call.

## Companion tickets (dispatched separately, non-blocking)

- Wiki mechanics page `game/mechanics/hide-reposition-wind-gated-shuffle` → Feature Scout
  (standing LUL-3024 duty).
- Pacing check: does `SHUFFLE_COOLDOWN_S` (2.0s) let a player cheese
  `COVER_RUSTLE_THRESHOLD_S`/`COVER_RUSTLE_INTERVAL_S` (12s/5s)? → Game Economist (standing
  LUL-3024 duty).
