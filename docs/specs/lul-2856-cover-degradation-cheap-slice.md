# SPEC: LUL-2856 Cover degradation — cheap slice (periodic rustle noise while hidden)

**Ticket:** LUL-2856 · **Tier:** C — touches `engine/forest-engine.js` simulation logic
(detection/noise system) plus `lib/game/noise.ts` and `components/GameCanvas.tsx`; needs
`REVIEW: APPROVED` before merge.

**Written against:** `release/next` @ `1b4737b8122ecbd9c2f19cd506f300f1c978d92d` (2026-09-17).
Re-derive every `file:line` below from the branch you actually implement on if it has moved.

Design source: wiki `game/mechanics/cover-degradation` (proposal + FEATURE_CHECKLIST.md
section 0 Q&A, closed by CTO comment on LUL-2856, 2026-09-17T07:27:38Z) and
`decisions/lul-2570-cover-degradation-accepted-2026-09-17`. This spec turns that PLAN into
exact diffs; it does not re-derive the design.

## Files

- `lib/game/noise.ts` — edited: two new exported constants.
- `engine/forest-engine.js` — edited: one new accumulator var, one new flash var + its DOM
  handle, one new function (`rollCoverRustle`), one new function (`rustleSting`), one new
  tick-loop check, one new decay/render line, one import addition.
- `components/GameCanvas.tsx` — edited: one new CSS rule, one new `<div>`.
- `e2e/cover-rustle.spec.ts` — created.

## The change

### 1. `lib/game/noise.ts` — new constants

Add directly below `HIDE_ALERT_RADIUS` (currently `lib/game/noise.ts:47`):

```ts
/** LUL-2856: past this many seconds continuously hidden in the same spot, the brush
 * itself starts periodically rustling -- turtling in one bramble stops being free.
 * Cheap-slice default: fixed for all difficulties (Economist owns a difficulty/cover-
 * density retune as a separate follow-up proposal, per the wiki decision). */
export const COVER_RUSTLE_THRESHOLD_S = 12;

/** LUL-2856: once past COVER_RUSTLE_THRESHOLD_S, a rustle-noise roll fires every this
 * many seconds, reusing HIDE_ALERT_RADIUS/checkThrowableNoise the same way enterHide()'s
 * one-shot entry noise already does. */
export const COVER_RUSTLE_INTERVAL_S = 5;
```

### 2. `engine/forest-engine.js` — import

Extend the existing `lib/game/noise` import (`engine/forest-engine.js:88`):

```js
import { isNoiseHeard, NOISE_RADIUS_WALK, NOISE_RADIUS_RUN, checkThrowableNoise, THROWABLE_NOISE_RADIUS, CRY_NOISE_RADIUS, CARRIED_NOISE_FLOOR, HIDE_ALERT_RADIUS, COVER_RUSTLE_THRESHOLD_S, COVER_RUSTLE_INTERVAL_S } from '@/lib/game/noise';
```

### 3. `engine/forest-engine.js` — new accumulator

At the existing `lastHideSpot`/`coverProbeAccum` declaration (`engine/forest-engine.js:432`):

```js
// before:
let lastHideSpot = null, coverProbeAccum = 0;
// after:
let lastHideSpot = null, coverProbeAccum = 0, coverRustleAccum = 0;   // LUL-2856
```

No separate reset is needed anywhere `hideTime` is explicitly reset (`enterHide()`, `restart()`,
etc.) — see step 6: `coverRustleAccum` derives itself off `hideTime` every tick the same
self-healing way `hideTime` itself derives off `hidden`, so it needs exactly one line, not four.

### 4. `engine/forest-engine.js` — new flash var + DOM handle

At the `spotFlash` declaration (`engine/forest-engine.js:1966`):

```js
// before:
let sinceClose = 0, huntTime = 0, spotFlash = 0, pianoTimer = 0;   // threat timers, spot flash, approach-note timer
// after:
let sinceClose = 0, huntTime = 0, spotFlash = 0, rustleFlash = 0, pianoTimer = 0;   // threat timers, spot flash, cover-rustle flash (LUL-2856), approach-note timer
```

At the threat-timer reset block (`engine/forest-engine.js:2021`):

```js
// before:
sinceClose = 0; huntTime = 0; spotFlash = 0; bearingPulseT = 0; bearingPulseSide = null;
// after:
sinceClose = 0; huntTime = 0; spotFlash = 0; rustleFlash = 0; bearingPulseT = 0; bearingPulseSide = null;
```

At the `spotFlashEl` DOM lookup (`engine/forest-engine.js:5558`):

```js
// before:
const spotFlashEl = document.getElementById('spotFlash');
// after:
const spotFlashEl = document.getElementById('spotFlash');
const rustleFlashEl = document.getElementById('rustleFlash');   // LUL-2856
```

### 5. `engine/forest-engine.js` — `rollCoverRustle()` and `rustleSting()`

Add immediately after `exitHide()` (`engine/forest-engine.js:3499-3500`), same file region as
`enterHide()`'s own alerted-predator loop it reuses:

```js
// LUL-2856: cover-degradation cheap slice. Fires every COVER_RUSTLE_INTERVAL_S once hideTime
// clears COVER_RUSTLE_THRESHOLD_S (driven by the tick()-loop check added in step 6, not called
// from anywhere else). Same alerted-predator loop as enterHide()'s one-shot entry noise
// (:3490-3492 in the pre-change file) -- only newly-alerts roam-state predators, never
// downgrades an already-chasing/hunting one, for the same reason enterHide() doesn't.
function rollCoverRustle(){
  let alerted = 0;
  for(const p of predators){
    if(p.inert || p.state !== 'roam') continue;
    if(checkThrowableNoise(Math.hypot(p.x - player.x, p.z - player.z), HIDE_ALERT_RADIUS)){ hearNoise(p); alerted++; }
  }
  logChronicle('cover_rustle', { alerted });
  rustleFlash = 1;
  rustleSting();
  if(!hintSeen('coverRustle')){
    markHintSeen('coverRustle');
    if(captionsOn) pushState({ caption: 'Sitting still too long stirs the brush — a lingering hide risks a fresh noise burst. Move on before something notices.', captionId: ++captionSeq });
  }
}
```

Add immediately after `spotSting()` (`engine/forest-engine.js:3681-3688`):

```js
// short escalating rustle/twig-snap sting for the cover-rustle roll (LUL-2856) -- distinct
// from the continuous leafRustle(true) ambience already looping while hidden (:3422), and
// from spotSting()'s sharper full "you were just spotted" stinger above. Same noise-burst
// shape as leafRustle() (buffer noise through a bandpass), but the bandpass frequency rises
// across the 3 bursts instead of leafRustle's flat/random band -- that rising pitch is the
// "escalating" cue the proposal specifies.
function rustleSting(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  for(let i=0; i<3; i++){
    const d = i*0.09;
    const src = ctx.createBufferSource(); src.buffer = noise(ctx, 0.1, false);
    const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value = 1400 + i*700; bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t+d);
    g.gain.exponentialRampToValueAtTime(0.16 + i*0.03, t+d+0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t+d+0.09);
    src.connect(bp); bp.connect(g); g.connect(master); g.connect(conv);
    src.start(t+d); src.stop(t+d+0.12);
  }
}
```

### 6. `engine/forest-engine.js` — the tick-loop check

Immediately after the existing `hideTime` line (`engine/forest-engine.js:6207`):

```js
// before:
hideTime = hidden ? hideTime + dt : 0;
// after:
hideTime = hidden ? hideTime + dt : 0;
// LUL-2856: self-healing off hideTime the same way hideTime is self-healing off `hidden` --
// zero the instant hideTime drops below threshold (covers exitHide, movement-break, death,
// pickup, restart -- every path that already zeroes hideTime -- with no extra reset call site).
coverRustleAccum = hideTime > COVER_RUSTLE_THRESHOLD_S ? coverRustleAccum + dt : 0;
if(coverRustleAccum >= COVER_RUSTLE_INTERVAL_S){
  coverRustleAccum = 0;
  rollCoverRustle();
}
```

### 7. `engine/forest-engine.js` — flash decay/render

Immediately after the existing `spotFlash` decay lines (`engine/forest-engine.js:6553-6554`):

```js
// before:
spotFlash = Math.max(0, spotFlash - dt*1.6);
spotFlashEl.style.opacity = (spotFlash*0.55).toFixed(3);
// after:
spotFlash = Math.max(0, spotFlash - dt*1.6);
spotFlashEl.style.opacity = (spotFlash*0.55).toFixed(3);
// LUL-2856: subtler peak (0.4 vs spotFlash's 0.55) -- "you were just spotted" is more urgent
// than "the brush just rustled". Reduced motion clamps to a fixed low bump instead of the
// animated decay ramp (same clamp-not-remove shape stoneMarkerPulseT already uses, :6744),
// so the vignette still fires as a positive tell without the motion.
rustleFlash = Math.max(0, rustleFlash - dt*1.6);
rustleFlashEl.style.opacity = motionReduced() ? (rustleFlash > 0 ? '0.15' : '0') : (rustleFlash*0.4).toFixed(3);
```

### 8. `components/GameCanvas.tsx` — DOM + CSS

CSS, immediately after the existing `#spotFlash` rule (`components/GameCanvas.tsx:714-715`):

```css
/* before: */
#spotFlash { position: fixed; inset: 0; z-index: 12; pointer-events: none; opacity: 0;
  background: radial-gradient(circle at 50% 45%, rgba(255,20,20,0) 40%, rgba(200,0,0,0.5) 100%); }
/* after (add this new rule directly below): */
/* LUL-2856: cover-rustle vignette. Same edge-vignette shape as #spotFlash, brush-green tint
   instead of alert-red, z-index one below spotFlash (a real spot event is the more urgent
   signal and must read on top if both are ever active the same frame -- same ordering
   rationale #bearingPulse already uses relative to #spotFlash, :716-718). Sibling of #panel,
   NOT a descendant -- visible with adminMode off (Q3, GameCanvas.tsx:324's selector only
   matches #panel). */
#rustleFlash { position: fixed; inset: 0; z-index: 11; pointer-events: none; opacity: 0;
  background: radial-gradient(circle at 50% 45%, rgba(120,140,40,0) 40%, rgba(90,110,30,0.5) 100%); }
```

DOM, immediately after the existing `<div id="spotFlash">` (`components/GameCanvas.tsx:751`):

```tsx
<div id="spotFlash"></div>
<div id="rustleFlash"></div>{/* LUL-2856 */}
<div id="bearingPulse"></div>
```

## Verification

- `npm test` — all unit tests pass, including the new `lib/game/noise.ts` constants being
  finite positive numbers (add to the existing `noise.test.ts` describe block if one covers
  `HIDE_ALERT_RADIUS`; a bare export needs no dedicated test if none of its siblings have one
  — check the file before adding one).
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- `npx playwright test cover-rustle` — 5/5 new tests pass (see `## e2e` below).
- `node scripts/check-elements-citations.mjs` — 0 drift (this spec adds no `docs/ELEMENTS.md`
  entry: the feature has no dedicated pixels-and-numbers section the way an item/creature
  does; if the reviewer disagrees, that's a one-line addendum, not a spec revision).

## e2e

**Specs.** `e2e/cover-rustle.spec.ts` (new), modeled directly on `e2e/hide-alert.spec.ts`'s
structure (own file — `e2e/hide.spec.ts` is explicitly predator-free per its own header
comment, `cover-feedback.spec.ts` covers the unrelated LOS-covered signal):
- `"a roaming predator within HIDE_ALERT_RADIUS is alerted by a rustle roll past the hideTime threshold"` — new
- `"stays unaware outside the radius"` — new
- `"does not roll before the threshold"` — new (the antagonist proof: the wolf that would
  otherwise catch the player is staged and would win if the roll fired early or didn't fire
  at all)
- `"fires the one-time hint caption with captions enabled"` — new
- `"still flashes under reduced motion, at the fixed-opacity clamp"` — new

**World.** micro (default). `qaBuildScene({ props: [{ kind: 'bramble', x: 10, z: 0 }],
predators: [{ kind: 'wolf', x: 9999, z: 9999, state: 'roam' }] })` — same shape as
`hide-alert.spec.ts`'s `HIDE_SCENE` (`e2e/hide-alert.spec.ts:12-15`), then
`qaTeleportToHideSpot()` places the wolf at a known offset for the in/out-of-radius variants
(mirror `stageHideSceneAtSpot`, `:16-22`). No `@fullmap` needed.

**Hooks.** All existing, no new hook:
- `qaBuildScene(scene)` — stage bramble + wolf (`engine/forest-engine.d.ts:514`)
- `qaTeleportToHideSpot(kind?)` — enter the hiding spot (`:180`)
- `qaSetFixedStep(dtSeconds)` / `qaAdvance(steps)` — deterministic time-skip past
  `COVER_RUSTLE_THRESHOLD_S + COVER_RUSTLE_INTERVAL_S` (`:403`, `:407`); drive via
  `advanceChunked(page, steps)` (`e2e/helpers.ts:170`), not a bare `qaAdvance` call, per the
  LUL-2734/LUL-2802 rig-contention precedent `force-hunt-closes.spec.ts` already documents.
- `qaGetChronicle()` — assert the new `cover_rustle` entry and its `alerted` count (`:501`)
- `qaPredatorState(idx)` — assert `state === 'investigate'` after a successful roll (`:219`)

**Tester scenario.** New request file `shared/local-qa/requests/lul-2856-cover-rustle.md`
(written alongside this spec, see below) — every hook above already exists, so it reports
PASS/FAIL, never NEEDS-HOOK.

**Not covered.** The rustle sting's actual timbre/audibility (Web Audio output is not
observable by Playwright) and whether the vignette tint reads as "brush" rather than "alert"
at a glance — both stay manual founder/QA-tester screenshot review, same as every other audio
cue in this codebase (`spotSting()`, `leafRustle()` have no audio-content assertions either,
only `soundOn`-gated call-site assertions).

## Cues

**Visual.** `#rustleFlash` vignette pulse, sibling of `#panel` (not gated by adminMode),
rendered by the tick-loop line in step 7 above; DOM/CSS in step 8
(`components/GameCanvas.tsx:751` new div, `:715` new CSS rule).
**Audio.** New `rustleSting()` (`engine/forest-engine.js`, added after `spotSting()`,
currently `:3681-3688`), gated `soundOn` (first line of the function).
**Explanation.** *"Sitting still too long stirs the brush — a lingering hide risks a fresh
noise burst. Move on before something notices."* — once per install, via
`hintSeen`/`markHintSeen('coverRustle')`, direct `pushState({ caption, captionId })` call
inside `rollCoverRustle()` (step 5), gated `captionsOn` — rendered by the existing
`#captionToast` `<ActionPrompt>` (`components/Hud.tsx:851-859`).
**Reduced motion.** Pulse opacity clamps to a fixed `0.15` while `rustleFlash > 0` instead of
animating the `rustleFlash*0.4` decay ramp (step 7) — same clamp-not-remove shape
`stoneMarkerPulseT`'s reduced-motion branch already uses (`engine/forest-engine.js:6744`).

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- **Fixed threshold + fixed interval only** — no difficulty or cover-density scaling in this
  slice (Economist follow-up, separate proposal). Do not read `DIFFICULTY_PRESETS` here.
- **No reposition-to-reset action** — deferred per the wiki decision; do not add a new player
  input in this PR.
- **Never downgrade an already-chasing/hunting predator** — `rollCoverRustle()`'s loop gates
  on `p.state === 'roam'` exactly like `enterHide()`'s own loop; do not widen this gate.
- **No `EngineHudState`/`pushState` field for the timer itself** — the countdown is
  deliberately silent (wiki Q4). The only `pushState` call this feature makes is the one-time
  caption, identical in shape to the existing `hideAlert` caption.
- Tier C: this PR needs `REVIEW: APPROVED` from the Code Reviewer before merge.

## Out of scope

- Difficulty/cover-density tuning of the threshold/interval — Economist, separate ticket.
- The "shuffle/reposition" action that resets the timer without exiting hidden — deferred,
  separate ticket, per the wiki decision.
- Any change to `STILL_RAMP`/`effectiveDetect` (`lib/game/cover.ts`) — this feature adds a
  noise cost on top of stillness's existing detection benefit; it does not touch the benefit
  itself.
- `docs/ELEMENTS.md` — no new item/creature entry; if the reviewer wants a line added for the
  new chronicle event or constants, that's a small addendum in the implementation PR, not a
  blocker on this spec.
