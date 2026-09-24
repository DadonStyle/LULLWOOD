# SPEC: LUL-1633 Win-reveal dead-window vignette (`winPending` cue)

**Ticket:** LUL-1633 · **Tier:** B — spans `engine/forest-engine.js` (new module-level ramp
variable + two call sites, no timer/threshold change), `components/GameCanvas.tsx` (new
engine-owned DOM element + CSS), `docs/ELEMENTS.md`, and one new e2e spec. No engine
simulation/timer logic changes (see Deviation below), so it does not cross into Tier C.
Merges on green, no `REVIEW: APPROVED` gate required.

**Written against:** `release/next` @ `e8b1595` (2026-09-24). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

## Background

CTO PLAN, posted on this ticket 2026-09-23T04:58Z (read it first, it is not repeated here).
Summary: after `fireBoom()` fires (`engine/forest-engine.js:6611`, cinematic `e>=9.3`) the
screen shows only the boom burst decaying with no win text until `finishPickup()` flips
`winVisible` (`:6624`, `e>=11.3`) — a fixed **2.0s dead window**. `winRevealed` itself adds no
extra lag (already fixed by LUL-1611). The CTO rejected re-timing the 9.3/11.3 cinematic
keyframes (tightly coupled to `playWinMusic()`/`boom()` sfx and a twice-retuned burst decay
curve) and decided on an **additive early visual cue** instead: a vignette that builds during
the dead window so the screen reads as "something is resolving," not "frozen."

## Deviation from the CTO plan (read before implementing)

The PLAN's implementation sketch said: add a `winPending: boolean` field to `EngineHudState`/
`INITIAL_HUD_STATE` and render the vignette in React, CSS-transitioned.

**This SPEC does not do that.** Every existing full-bleed edge cue in this codebase —
`#flash` (`components/GameCanvas.tsx:798`), `#rustleFlash` (`:787`, LUL-2856),
`#bearingPulse` (`:792`, LUL-1308), `#spotFlash` — is **engine-owned DOM**
(`document.getElementById`, mutated by a per-frame value in `tick()`), not React state. The
codebase's own ownership split says so explicitly: `docs/ELEMENTS.md:1067-1069` lists exactly
these elements as "Engine-owned DOM... mutated directly by the engine," separate from
"React-owned... driven one-directionally by `hudState`/`pushState()`." Going through
`EngineHudState` would mean pushing a new HUD patch every frame during the ramp for a value
React never needs to branch render logic on — the engine-owned pattern is what this exact
kind of cue already uses three times over. This SPEC follows the established pattern instead
of the plan's sketch; the player-visible result (a full-bleed vignette that builds over the
dead window, keyed off the same `fireBoom()` trigger, cleared on restart) is unchanged from
what the CTO asked for.

## Files

- `engine/forest-engine.js` — edited. New module-level state (`winPendingActive`,
  `winPendingT`), the DOM handle, the trigger at the existing `fireBoom()` call site, the
  per-frame ramp in `tick()`, and the reset in `restart()`.
- `components/GameCanvas.tsx` — edited. New `#winPendingCue` div in `overlayMarkup()` and its
  CSS rule.
- `docs/ELEMENTS.md` — edited. Add `#winPendingCue` to the engine-owned DOM list and one prose
  paragraph, same shape as the existing `#rustleFlash` entry.
- `e2e/win-pending-vignette.spec.ts` — created.

## The change

### 1. `engine/forest-engine.js`

**Module-level state.** Line 2019 currently reads:
```js
let sinceClose = 0, huntTime = 0, spotFlash = 0, rustleFlash = 0, pianoTimer = 0;   // threat timers, spot flash, cover-rustle flash (LUL-2856), approach-note timer
```
Add two names to this declaration (do not start a second `let` — keep the existing grouping
convention):
```js
let sinceClose = 0, huntTime = 0, spotFlash = 0, rustleFlash = 0, pianoTimer = 0,
    winPendingActive = false, winPendingT = 0;   // LUL-1633: win-reveal dead-window vignette ramp
```

**DOM handle.** Line 5758 declares `rustleFlashEl` next to the other engine-owned element
consts:
```js
const rustleFlashEl = document.getElementById('rustleFlash');   // LUL-2856
```
Add directly after it:
```js
const winPendingEl = document.getElementById('winPendingCue');   // LUL-1633
```

**Trigger.** Line 6611, the existing boom trigger inside the pickup cinematic:
```js
if(boomed && !pickBoomed){ pickBoomed = true; fireBoom(baby.x, ay, baby.z); }   // the child bursts into the sky -- the win moment's visual, finishPickup() below does the bookkeeping
```
Change to:
```js
if(boomed && !pickBoomed){ pickBoomed = true; fireBoom(baby.x, ay, baby.z); winPendingActive = true; }   // the child bursts into the sky -- the win moment's visual, finishPickup() below does the bookkeeping. LUL-1633: starts the dead-window vignette ramp
```

**Per-frame ramp.** Line 6754-6755 is `rustleFlash`'s own per-frame decay inside `tick()`:
```js
  rustleFlash = Math.max(0, rustleFlash - dt*1.6);
  rustleFlashEl.style.opacity = motionReduced() ? (rustleFlash > 0 ? '0.15' : '0') : (rustleFlash*0.4).toFixed(3);
```
Add immediately after (same `tick()` scope, `dt` already in scope here):
```js
  if(winPendingActive && winPendingT < 1){
    winPendingT = Math.min(1, winPendingT + dt/1.5);   // 1.5s build, same shape CTO plan asked for
    winPendingEl.style.opacity = motionReduced() ? '0.2' : (winPendingT*0.35).toFixed(3);
  }
```
Reduced motion gets a static presence (`0.2`, set once the ramp starts) instead of an animated
build — same clamp-not-remove shape `#rustleFlash` already uses one line above. Note the
`winPendingT < 1` guard: once the ramp completes it holds at peak opacity without further
writes, it does not need to be told to stop (there is nothing to decay toward — the vignette
is superseded visually when `#winScreen`'s `#winText` fades in on top at `winVisible`, and
zeroed for real at the next `restart()`, below).

**Reset.** Line 6094, inside `restart()`, is the existing reset for this exact family of
pickup-cinematic-scoped state:
```js
  pickBoomed = false; boomGroup.visible = false; boomStart = -1; if(flashEl) flashEl.style.opacity = '0';
```
Change to:
```js
  pickBoomed = false; boomGroup.visible = false; boomStart = -1; if(flashEl) flashEl.style.opacity = '0';
  winPendingActive = false; winPendingT = 0; if(winPendingEl) winPendingEl.style.opacity = '0';   // LUL-1633
```

### 2. `components/GameCanvas.tsx`

**CSS.** Line 798 is `#flash`'s rule inside the `<style jsx global>` block:
```css
  #flash { position: fixed; inset: 0; z-index: 23; pointer-events: none; opacity: 0; background: #fff; }
```
Add immediately before it (one z-index below `#flash` — the boom flash is the more immediate
signal and must read on top if both are visible the same frame, same ordering rationale
`#rustleFlash`/`#bearingPulse` already use relative to `#spotFlash`, `:783-784`):
```css
  /* LUL-1633: fills the ~2.0s dead window between fireBoom() and winVisible (the pickup
     cinematic's e=9.3->11.3 keyframes) with a continuously-building cue instead of a frozen
     screen. Engine-owned (winPendingEl in forest-engine.js), same ramp-then-hold shape as
     #rustleFlash. Sibling of #panel, NOT a descendant -- visible with adminMode off
     (Q3, GameCanvas.tsx:328's selector only matches #panel). */
  #winPendingCue { position: fixed; inset: 0; z-index: 22; pointer-events: none; opacity: 0;
    background: radial-gradient(circle at 50% 50%, rgba(255,225,160,0) 55%, rgba(255,225,160,0.4) 100%); }
```

**Markup.** Line 826, inside `overlayMarkup()`:
```html
<div id="flash"></div>
```
Add directly before it (grouped with the other engine-owned edge cues one line above, matches
the existing `<!-- LUL-2856 -->` convention):
```html
<div id="winPendingCue"></div><!-- LUL-1633 -->
<div id="flash"></div>
```

### 3. `docs/ELEMENTS.md`

Add `#winPendingCue` to the engine-owned DOM list (`:1067-1069`):
```
- **Engine-owned DOM** (`document.getElementById(...)`, created by
  `components/GameCanvas.tsx`, mutated directly by the engine): `#vignette`,
  `#spotFlash`, `#rustleFlash`, `#bearingPulse`, `#flash`, `#winPendingCue`, `#minimap` (canvas, drawn every frame by
  `drawMinimap()`/`drawMinimapStatic()`), `#hint`, `#pausePrompt`,
  `#deathVideo`.
```
Add one prose paragraph near the `#rustleFlash` entry (`:1362-1379`), same shape:
```
LUL-1633 adds `#winPendingCue`, a warm full-bleed vignette answering "the win is resolving" —
the ~2.0s gap between the pickup cinematic's `fireBoom()` keyframe (`e>=9.3`,
`engine/forest-engine.js:6611`) and `finishPickup()` flipping `winVisible` (`e>=11.3`, `:6624`)
during which the boom burst had already decayed but no win text was up yet (LUL-1633 triage).
Ramps from 0 to 0.35 opacity over 1.5s once `winPendingActive` is set at the `fireBoom()` call
site, holds at peak for the remaining ~0.5s, and is naturally superseded when `#winText` fades
in over it (`components/Hud.tsx:1172`, its own existing 0.5s transition). Reduced motion clamps
it to a static `0.2` instead of animating the build (same clamp-not-remove shape
`#rustleFlash` uses). Not a new interactive feature under `decisions/0015-cue-triple` — it is
an additive layer inside the existing win moment, which already carries its own audio
(`playWinMusic()`, fired at `pickStart` in `pickup()`) and explanation (`#winText`'s "YOU WON",
`components/Hud.tsx:1173`); seven Q&A entries down, see Cues below for why no new audio/caption
is added.
```

## Verification

- `node --check engine/forest-engine.js` — syntax clean.
- `npx tsc --noEmit` — clean (no `.d.ts` change needed; no new engine action, no `EngineHudState`
  field).
- `npx eslint components/GameCanvas.tsx engine/forest-engine.js` — clean.
- `npx playwright test e2e/win-pending-vignette.spec.ts` — new spec green.
- `npx playwright test e2e/win-burst-flash-decay.spec.ts e2e/win-persist.spec.ts` — must still
  pass unchanged (same cinematic keyframes, no timer touched).

## e2e

**Specs.** `e2e/win-pending-vignette.spec.ts` — new. One test: stage a pickup via
`qaTeleportNearBaby` + `qaSetFixedStep`, advance to `e=9.32` (just past the `fireBoom()`
trigger, same padding `win-burst-flash-decay.spec.ts:38` uses) and assert
`#winPendingCue`'s opacity is `>0` and `<0.35` (still ramping); advance to `e=10.9` and assert
opacity is `>=0.33` (ramp complete, holding at peak); advance to `e=11.32` (just past
`finishPickup()`) and assert `#winScreen` is visible while `#winPendingCue`'s opacity is still
`~0.35` (superseded visually by `#winText`'s own fade, not reset). A second, short test:
advance to `winRevealed`, click `.restartBtn` (same flow `win-persist.spec.ts:67` already
uses — `restart()` only ever runs from that button's `onClick`, there is no `qa*` hook for it)
and assert `#winPendingCue`'s opacity is back to `0`.

**World.** micro (default). No predator, no map geometry needed — same staging
`win-burst-flash-decay.spec.ts` already uses (`qaTeleportNearBaby`, no `qaBuildScene` props).

**Hooks.** None new. `qaSetFixedStep`/`qaAdvance` (existing, `win-burst-flash-decay.spec.ts`
pattern) drive determinism; the spec reads `#winPendingCue`'s `style.opacity` directly via
`page.locator('#winPendingCue').evaluate(el => el.style.opacity)`, the same direct-DOM-read
pattern `win-burst-flash-decay.spec.ts:27-28` already uses for `#flash` — no `qaProbe*` hook
needed for an engine-owned element whose only state is its own inline style.

**Tester scenario.** `shared/local-qa/requests/lul-1633-win-pending-vignette.md`, filed with
this spec (Q13) — see below. The mechanical ramp timing is covered by e2e above; the nightly
vision-model check is for whether the build reads as "something is happening" rather than a
distracting flash, which a headless assertion can't judge.

**Not covered.** Audio and post-processing look are judged manually via the local-qa
screenshot, not asserted in e2e.

## Cues

**Visual.** `#winPendingCue`, a warm radial vignette building from 0 to 0.35 opacity over 1.5s,
keyed off the existing `fireBoom()` call site (`engine/forest-engine.js:6611`).

**Audio.** None new. `playWinMusic()` already fires at `pickStart` (inside `pickup()`, before
the cinematic's `fireBoom()` keyframe) and covers the whole win moment including this window —
per `decisions/0015-cue-triple`'s own scope ("every interactive map feature... anything the
player can walk up to or trigger"), this is not a new interactive feature, it is an additive
presentation layer inside the win moment that already ships its own cue triple (visual: boom
burst + this vignette; audio: `playWinMusic()`; explanation: `#winText` "YOU WON"). Adding a
second, distinct sound specifically for the vignette's build would layer over `playWinMusic()`
already ramping in and was rejected by the CTO plan for exactly this reason (audio timing is
already tightly coupled to the cinematic keyframes).

**Explanation.** None new, same reasoning — `#winText`'s "YOU WON" (`components/Hud.tsx:1173`)
is the explanation for the whole win moment this vignette is part of, not a separate thing
requiring its own caption.

**Reduced motion.** Static `0.2` opacity set once the ramp starts (no animated build), same
clamp-not-remove shape `#rustleFlash` uses (`engine/forest-engine.js:6755`).

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- Do not touch the cinematic's `e>=9.3`/`e>=11.3` keyframes, `playWinMusic()`'s trigger, or
  `updateBoom()`'s existing flash/particle decay curve — all three are tuned and explicitly
  out of scope per the CTO plan.
- `#winPendingCue` must be a sibling of `#panel` in the DOM (inside `overlayMarkup()`, not
  nested under any `#panel`-scoped markup) so it stays visible with `adminMode` off (Q3).
- No new `EngineHudState` field, no new `pushState()` call — see Deviation above.

## Out of scope

- Re-timing the cinematic itself (CTO plan explicitly rejected this, option (a)).
- A second audio cue for the vignette specifically (see Cues — `playWinMusic()` already covers
  the window).
- The death-side equivalent (`revealLoss()`'s `CUT_END` poll) — not raised by this ticket, no
  reported "dead window" complaint on the loss path, left for a future ticket if one surfaces.
