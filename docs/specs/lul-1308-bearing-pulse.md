# SPEC: LUL-1308 — The Bearing Pulse (stereo pan + screen-edge glow)

Written by Founding Engineer. Ruled 2026-09-02 (`decisions/scout-queue-2026-09-02`,
accepting LUL-1283/Feature Scout). Design doc: wiki `game/mechanics/threat-bearing-pulse`.
Requirement source: wiki `game/psychology/threat-bearing`.

**Tier B** — feedback layer only. Does not touch `effectiveDetect()`, `canSee()`, or any
predator state machine. Merge on green CI; review lands after, per the current
development-first rules.

**Line numbers below are re-derived from `origin/release/next` @ `8b99b9f`
(2026-09-07), NOT copied from the ticket body.** The ticket cites `:1909-1922` and
`:3165-3173` — those are stale (the file has grown since). Do not trust them; the
citations in this document are current as of the commit above. If your checkout is
past that commit and a citation doesn't match, stop and report — don't guess.

## Files

1. `lib/game/bearing.ts` — new
2. `lib/game/bearing.test.ts` — new
3. `engine/forest-engine.js` — edited (4 sites, listed below)
4. `components/GameCanvas.tsx` — edited (1 markup line + 1 CSS block)
5. `docs/ELEMENTS.md` — edited (1 new paragraph)

## 1. New file: `lib/game/bearing.ts`

Pure functions, no THREE, no engine globals — same convention as `lib/game/noise.ts`.
Takes primitives (`sourceX/sourceZ/originX/originZ/originYaw`), not a predator object —
this is a deliberate, in-scope call on file boundary (the proposal explicitly leaves this
to the implementing engineer). Output values are bit-for-bit identical to the inline math
it replaces.

```ts
// LUL-1308: bearing math lifted out of announceCaption()'s inline duplicate
// (engine/forest-engine.js) so hearNoise()'s near-identical copy and the new
// approach-cue panner/edge-glow can all share one implementation. Pure and
// unit-tested without a Three.js scene or a running render loop, same
// convention as noise.ts/cover.ts (see wiki systems/unit-testing-standard).

export type BearingSide = 'ahead' | 'behind' | 'left' | 'right';

export interface Bearing {
  /** Coarse quadrant, in the origin's own reference frame. 'ahead' means the
   *  origin's own view already covers it — callers that skip 'ahead' rely on this. */
  side: BearingSide;
  /** Lateral offset (world units) in the origin's right-handed frame; positive = origin's right. */
  right: number;
  /** Forward offset (world units) in the origin's frame; positive = in front of origin. */
  fwd: number;
  /** Straight-line distance (world units) between source and origin. */
  dist: number;
}

/**
 * Where `(sourceX, sourceZ)` sits relative to `(originX, originZ)` facing `originYaw`.
 * Extracted verbatim from announceCaption()'s inline math (forest-engine.js:2121-2126
 * @ 8b99b9f) — same fx/fz/rx/rz basis, same 0.6 ahead/behind-vs-side threshold.
 */
export function bearingOf(
  sourceX: number,
  sourceZ: number,
  originX: number,
  originZ: number,
  originYaw: number,
): Bearing {
  const dx = sourceX - originX, dz = sourceZ - originZ;
  const dist = Math.hypot(dx, dz);
  const fx = -Math.sin(originYaw), fz = -Math.cos(originYaw);
  const rx = Math.cos(originYaw), rz = -Math.sin(originYaw);
  const fwd = dx * fx + dz * fz, right = dx * rx + dz * rz;
  const side: BearingSide =
    Math.abs(right) < Math.abs(fwd) * 0.6 ? (fwd >= 0 ? 'ahead' : 'behind') : (right > 0 ? 'right' : 'left');
  return { side, right, fwd, dist };
}

/**
 * Stereo pan value in [-1, 1] for a bearing. Same formula already shipped for
 * the mission waypoint hum (missionWaypointHum(), forest-engine.js:1251 @ 8b99b9f:
 * `right / Math.max(1, hypot(right, fwd))`, clamped) — reused here for
 * consistency across the audio graph rather than inventing a second curve.
 * `Math.max(1, dist)` avoids a divide-by-zero/spike when dist is near 0.
 */
export function bearingPan(bearing: Pick<Bearing, 'right' | 'dist'>): number {
  return Math.max(-1, Math.min(1, bearing.right / Math.max(1, bearing.dist)));
}

// ---- LUL-1282 (folded in per CEO addendum on threat-bearing-pulse, same PR,
// same audio graph): predatorCall()'s volume was a binary big?1.0:0.6 with no
// distance falloff -- a wolf at 60 units and one at 8 units sounded identical.

/** Full volume at/inside this distance (world units). */
export const CALL_FULL_VOL_DIST = 20;
/** Volume ramps to CALL_MIN_VOL_MUL over this many additional units past CALL_FULL_VOL_DIST. */
export const CALL_FALLOFF_DIST = 70;
/** Floor multiplier -- a call is never fully inaudible past the falloff, just quiet. */
export const CALL_MIN_VOL_MUL = 0.35;

/** Distance-based volume multiplier for a predator call. `dist < 0` is treated as 0. */
export function callVolumeMul(dist: number): number {
  const d = Math.max(0, dist);
  return Math.max(CALL_MIN_VOL_MUL, Math.min(1, 1 - (d - CALL_FULL_VOL_DIST) / CALL_FALLOFF_DIST));
}
```

## 2. New file: `lib/game/bearing.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bearingOf,
  bearingPan,
  callVolumeMul,
  CALL_FULL_VOL_DIST,
  CALL_FALLOFF_DIST,
  CALL_MIN_VOL_MUL,
} from './bearing.ts';

// ---- bearingOf: quadrants, facing yaw=0 (fx,fz = 0,-1 ; rx,rz = 1,0) -------

test('bearingOf: source ahead of origin is "ahead"', () => {
  const b = bearingOf(0, -10, 0, 0, 0);
  assert.equal(b.side, 'ahead');
  assert.ok(b.fwd > 0);
});

test('bearingOf: source behind origin is "behind"', () => {
  const b = bearingOf(0, 10, 0, 0, 0);
  assert.equal(b.side, 'behind');
  assert.ok(b.fwd < 0);
});

test('bearingOf: source to origin\'s right is "right"', () => {
  const b = bearingOf(10, 0, 0, 0, 0);
  assert.equal(b.side, 'right');
  assert.ok(b.right > 0);
});

test('bearingOf: source to origin\'s left is "left"', () => {
  const b = bearingOf(-10, 0, 0, 0, 0);
  assert.equal(b.side, 'left');
  assert.ok(b.right < 0);
});

test('bearingOf: dist is the straight-line distance regardless of yaw', () => {
  const b = bearingOf(3, 4, 0, 0, 1.234);
  assert.ok(Math.abs(b.dist - 5) < 1e-9);
});

test('bearingOf: fwd/right decompose dist (Pythagorean, any yaw)', () => {
  const b = bearingOf(12, -7, 2, 3, 0.77);
  assert.ok(Math.abs(b.fwd * b.fwd + b.right * b.right - b.dist * b.dist) < 1e-6);
});

// ---- bearingPan --------------------------------------------------------

test('bearingPan: dead ahead or behind pans center', () => {
  assert.equal(bearingPan(bearingOf(0, -10, 0, 0, 0)), 0);
  assert.equal(bearingPan(bearingOf(0, 10, 0, 0, 0)), 0);
});

test('bearingPan: hard right is positive, hard left is negative', () => {
  assert.ok(bearingPan(bearingOf(10, 0, 0, 0, 0)) > 0);
  assert.ok(bearingPan(bearingOf(-10, 0, 0, 0, 0)) < 0);
});

test('bearingPan: always clamped to [-1, 1]', () => {
  const b = bearingOf(0.01, 0, 0, 0, 0); // dist << 1, right/max(1,dist) would blow up unclamped
  const pan = bearingPan(b);
  assert.ok(pan >= -1 && pan <= 1);
});

// ---- callVolumeMul ------------------------------------------------------

test('callVolumeMul: full volume at/inside CALL_FULL_VOL_DIST', () => {
  assert.equal(callVolumeMul(0), 1);
  assert.equal(callVolumeMul(CALL_FULL_VOL_DIST), 1);
});

test('callVolumeMul: floors at CALL_MIN_VOL_MUL far away, never goes silent', () => {
  assert.equal(callVolumeMul(CALL_FULL_VOL_DIST + CALL_FALLOFF_DIST), CALL_MIN_VOL_MUL);
  assert.equal(callVolumeMul(100000), CALL_MIN_VOL_MUL);
});

test('callVolumeMul: monotonically non-increasing with distance', () => {
  const a = callVolumeMul(25), b = callVolumeMul(50), c = callVolumeMul(75);
  assert.ok(a >= b && b >= c);
});

test('callVolumeMul: negative distance treated as 0', () => {
  assert.equal(callVolumeMul(-5), callVolumeMul(0));
});
```

Run: `node --test lib/game/bearing.test.ts` (or the full `npm test`). Passing = every
`test(...)` block above reports ok, process exits 0.

## 3. `engine/forest-engine.js` edits

### 3a. Import (add near the other `lib/game` imports, e.g. after the `noise` import at line 71)

```js
import { bearingOf, bearingPan, callVolumeMul } from '@/lib/game/bearing';
```

This import is load-bearing for `scripts/check-duplicate-logic.mjs` — it only recognizes
an engine top-level declaration as "not a duplicate" when the exact exported name is
imported by that name. Do not import as a namespace (`import * as bearing`) or rename
(`as bearingOfX`) or the CI `unit tests` check fails on an unrelated-looking diff.

### 3b. `announceCaption()` — replace inline math, no behavior change

Current (`:2116-2130`):

```js
function announceCaption(kind, big, p){
  const verb = kind === 'wolf' ? 'howl' : 'roar';
  let where;
  if(!p){ where = 'right on you'; }
  else {
    const dx = p.x - player.x, dz = p.z - player.z, dist = Math.hypot(dx, dz);
    const near = dist < 30 ? 'near' : 'far';
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const rx =  Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    const fwd = dx*fx + dz*fz, right = dx*rx + dz*rz;
    const side = Math.abs(right) < Math.abs(fwd)*0.6 ? (fwd >= 0 ? 'ahead' : 'behind') : (right > 0 ? 'right' : 'left');
    where = `${near} · ${side}`;
  }
  pushState({ caption: `${kind} ${verb}${big ? ' (close)' : ''} · ${where}`, captionId: ++captionSeq });
}
```

Replace with:

```js
function announceCaption(kind, big, p){
  const verb = kind === 'wolf' ? 'howl' : 'roar';
  let where;
  if(!p){ where = 'right on you'; }
  else {
    const b = bearingOf(p.x, p.z, player.x, player.z, player.yaw);
    const near = b.dist < 30 ? 'near' : 'far';
    where = `${near} · ${b.side}`;
  }
  pushState({ caption: `${kind} ${verb}${big ? ' (close)' : ''} · ${where}`, captionId: ++captionSeq });
}
```

### 3c. `hearNoise()` — same extraction, same no-behavior-change rule

Current (`:1221-1234`):

```js
function hearNoise(p){
  p.state = 'investigate'; p.inv = 'approach'; p.sniffsLeft = rollSniffs(rng, 4);
  p.callTimer = rnd(2.6, 4.2);   // LUL-1610: callTimer was 0 on first noise-catch, causing instant roar on chase entry
  leafRustle(false);              // distinct from sight sting (spotSting) -- quieter rustle, not the big roar
  if(captionsOn){
    const dx = p.x - player.x, dz = p.z - player.z, dist = Math.hypot(dx, dz);
    const near = dist < 30 ? 'near' : 'far';
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const rx =  Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    const fwd = dx*fx + dz*fz, right = dx*rx + dz*rz;
    const side = Math.abs(right) < Math.abs(fwd)*0.6 ? (fwd >= 0 ? 'ahead' : 'behind') : (right > 0 ? 'right' : 'left');
    pushState({ caption: `${p.kind} heard you · ${near} · ${side}`, captionId: ++captionSeq });
  }
}
```

Replace the `if(captionsOn)` block with:

```js
  if(captionsOn){
    const b = bearingOf(p.x, p.z, player.x, player.z, player.yaw);
    const near = b.dist < 30 ? 'near' : 'far';
    pushState({ caption: `${p.kind} heard you · ${near} · ${b.side}`, captionId: ++captionSeq });
  }
```

(Leave the three lines above the `if` — `p.state=...`, `p.callTimer=...`, `leafRustle(false)` — untouched.)

### 3d. `predatorCall()` — fold in LUL-1282's distance falloff

Current (`:2131-2134`):

```js
function predatorCall(kind, big, p){
  if(captionsOn) announceCaption(kind, big, p);
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime, vol = big ? 1.0 : 0.6;
```

Replace the `vol` line with a distance-scaled version. `p` is `undefined` only from
`deathAudio()`'s unconditional call (`:2199`), where the source is adjacent by
construction (see that call site's own comment) — skip falloff in that case, don't
divide by a distance that was never computed:

```js
function predatorCall(kind, big, p){
  if(captionsOn) announceCaption(kind, big, p);
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime;
  const baseVol = big ? 1.0 : 0.6;
  const vol = p ? baseVol * callVolumeMul(Math.hypot(p.x - player.x, p.z - player.z)) : baseVol;
```

Nothing else in the function changes — every existing `vol` reference downstream
(the wolf/bear/lion synthesis branches) keeps using the same local `vol` name.

### 3e. Approach-cue block — new panner + bearing pulse trigger

Current (`:3539-3548`):

```js
    // approach piano note: quicker + higher the nearer it is
    if(approaching && nearDist < 46 && !hidden){
      pianoTimer -= dt;
      if(pianoTimer <= 0){
        const near01 = clamp(1 - nearDist/46, 0, 1);           // 0 far … 1 close
        pianoTimer = 1.3 - near01*0.95;                        // interval shortens as it nears
        const steps = [0,3,5,7,10,12][Math.min(5, Math.floor(near01*6))];
        pianoNote(98 * Math.pow(2, steps/12), 0.5 + near01*0.6);   // low, scary; rises as it closes
      }
    } else pianoTimer = 0;
```

Replace with:

```js
    // approach piano note: quicker + higher the nearer it is
    if(approaching && nearDist < 46 && !hidden){
      pianoTimer -= dt;
      if(pianoTimer <= 0){
        const near01 = clamp(1 - nearDist/46, 0, 1);           // 0 far … 1 close
        pianoTimer = 1.3 - near01*0.95;                        // interval shortens as it nears
        const steps = [0,3,5,7,10,12][Math.min(5, Math.floor(near01*6))];
        // LUL-1308: bearing drives both the note's stereo pan and the screen-edge
        // glow. 'ahead' is skipped for the glow -- the player's own view already
        // covers it, see lib/game/bearing.ts's Bearing.side doc.
        const bearing = bearingOf(nearP.x, nearP.z, player.x, player.z, player.yaw);
        pianoNote(98 * Math.pow(2, steps/12), 0.5 + near01*0.6, bearingPan(bearing));
        if(bearing.side !== 'ahead'){ bearingPulseSide = bearing.side; bearingPulseT = 1; }
      }
    } else pianoTimer = 0;
```

Declare the two new state variables next to the existing threat timers (`:1089`):

Current:

```js
let sinceClose = 0, huntTime = 0, spotFlash = 0, pianoTimer = 0;   // threat timers, spot flash, approach-note timer
```

Replace with:

```js
let sinceClose = 0, huntTime = 0, spotFlash = 0, pianoTimer = 0;   // threat timers, spot flash, approach-note timer
let bearingPulseT = 0, bearingPulseSide = null;   // LUL-1308: screen-edge glow for off-screen predator bearing
```

Reset them at the same restart site spotFlash resets (`:1128`):

Current:

```js
  sinceClose = 0; huntTime = 0; spotFlash = 0;
```

Replace with:

```js
  sinceClose = 0; huntTime = 0; spotFlash = 0; bearingPulseT = 0; bearingPulseSide = null;
```

### 3f. `pianoNote()` — add the panner (one node per call, per the design doc's cost budget)

Current (`:2220-2230`):

```js
// a dissonant piano note; caller raises pitch/volume as the animal gets nearer
function pianoNote(freq, vol){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime;
  const parts = [[1,1],[2,0.5],[3,0.25],[4,0.12]];
  const play = (f, amp) => parts.forEach(([h,ha]) => { const o=ctx.createOscillator(); o.type='sine';
    o.frequency.value = f*h*(1+0.0007*h*h);
    const g=ctx.createGain(); const a=amp*ha*vol; g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(a, t+0.005); g.gain.exponentialRampToValueAtTime(0.0001, t+1.6);
    o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t+1.65); });
  play(freq, 0.12); play(freq*1.414, 0.05);   // + tritone shadow for dread
}
```

Replace with:

```js
// a dissonant piano note; caller raises pitch/volume as the animal gets nearer
// LUL-1308: `pan` (defaults to 0, center) feeds a single shared StereoPannerNode --
// one node total for the whole note, not one per oscillator/harmonic, per the
// design doc's "costs one node" budget. Only the dry path (`master`) is panned;
// the reverb send (`conv`) stays unpanned, same as before -- a convolution
// reverb's own diffuse character does the work there, panning it too would just
// smear the direct cue's localization.
function pianoNote(freq, vol, pan = 0){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime;
  const panner = ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(master);
  const parts = [[1,1],[2,0.5],[3,0.25],[4,0.12]];
  const play = (f, amp) => parts.forEach(([h,ha]) => { const o=ctx.createOscillator(); o.type='sine';
    o.frequency.value = f*h*(1+0.0007*h*h);
    const g=ctx.createGain(); const a=amp*ha*vol; g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(a, t+0.005); g.gain.exponentialRampToValueAtTime(0.0001, t+1.6);
    o.connect(g); g.connect(panner); g.connect(conv); o.start(t); o.stop(t+1.65); });
  play(freq, 0.12); play(freq*1.414, 0.05);   // + tritone shadow for dread
}
```

The one other call site, `deathAudio()`'s indirect path — actually `pianoNote` has only
the one call site in the whole file (`:3546`, rewritten in 3e above). Confirm this with
`grep -n "pianoNote(" engine/forest-engine.js` before editing; if a second call site
exists that this spec didn't account for, stop and report rather than guessing its pan.

### 3g. Drive `#bearingPulse`'s opacity — same frame, next to `spotFlash`'s own decay

Current (`:2976`, element lookup) and (`:3566-3567`, decay + DOM write):

```js
const spotFlashEl = document.getElementById('spotFlash');
```

```js
  spotFlash = Math.max(0, spotFlash - dt*1.6);
  spotFlashEl.style.opacity = (spotFlash*0.55).toFixed(3);
```

Replace the element lookup line with:

```js
const spotFlashEl = document.getElementById('spotFlash');
const bearingPulseEl = document.getElementById('bearingPulse');
```

Replace the decay block with:

```js
  spotFlash = Math.max(0, spotFlash - dt*1.6);
  spotFlashEl.style.opacity = (spotFlash*0.55).toFixed(3);
  // LUL-1308: decays slower than spotFlash (1.6) -- spotFlash is a one-shot
  // "you were just spotted" event; this is a repeating ambient cue and should
  // linger a beat between piano notes rather than fully blink out.
  bearingPulseT = Math.max(0, bearingPulseT - dt*1.1);
  if(bearingPulseSide) bearingPulseEl.className = bearingPulseSide;
  bearingPulseEl.style.opacity = (bearingPulseT*0.5).toFixed(3);
```

Verify the exact line numbers for 3g with `grep -n "spotFlashEl\|spotFlash = Math.max" engine/forest-engine.js` before editing — this spec's line numbers can drift by the time earlier edits in this same list land above them in the file.

## 4. `components/GameCanvas.tsx`

### 4a. Markup — add `#bearingPulse` as a sibling of `#spotFlash`

Current (`:400`, inside `overlayMarkup()`):

```html
<div id="spotFlash"></div>
```

Replace with:

```html
<div id="spotFlash"></div>
<div id="bearingPulse"></div>
```

### 4b. CSS — sibling rule to `#spotFlash`'s

Current (`:375-376`):

```css
  #spotFlash { position: fixed; inset: 0; z-index: 12; pointer-events: none; opacity: 0;
    background: radial-gradient(circle at 50% 45%, rgba(255,20,20,0) 40%, rgba(200,0,0,0.5) 100%); }
```

Add immediately after it:

```css
  /* LUL-1308: off-screen predator bearing. z-index one below spotFlash so a
     real spot event (the more urgent, full-screen signal) reads on top if both
     are active at once. Class name ('left'/'right'/'behind') set by the engine
     off bearingOf(nearP,...).side; opacity is the only per-frame mutation. */
  #bearingPulse { position: fixed; inset: 0; z-index: 11; pointer-events: none; opacity: 0; }
  #bearingPulse.left { background: linear-gradient(to right, rgba(255,60,40,0.55) 0%, rgba(255,60,40,0) 22%); }
  #bearingPulse.right { background: linear-gradient(to left, rgba(255,60,40,0.55) 0%, rgba(255,60,40,0) 22%); }
  #bearingPulse.behind { background:
    linear-gradient(to right, rgba(255,60,40,0.5) 0%, rgba(255,60,40,0) 18%),
    linear-gradient(to left, rgba(255,60,40,0.5) 0%, rgba(255,60,40,0) 18%); }
```

No React state, no prop, no `EngineHudState` field — this is engine-owned DOM exactly
like `#spotFlash`/`#vignette`, per the existing LUL-34/LUL-35 ownership split documented
in `docs/ELEMENTS.md`'s "HUD / UI surfaces" section.

## 5. `docs/ELEMENTS.md`

In the "HUD / UI surfaces" section, the "Engine-owned DOM" bullet currently reads
(`:818-822`):

```
- **Engine-owned DOM** (`document.getElementById(...)`, created by
  `components/GameCanvas.tsx`, mutated directly by the engine): `#vignette`,
  `#spotFlash`, `#flash`, `#minimap` (canvas, drawn every frame by
  `drawMinimap()`/`drawMinimapStatic()`), `#hint`, `#pausePrompt`,
  `#deathVideo`.
```

Replace with:

```
- **Engine-owned DOM** (`document.getElementById(...)`, created by
  `components/GameCanvas.tsx`, mutated directly by the engine): `#vignette`,
  `#spotFlash`, `#bearingPulse`, `#flash`, `#minimap` (canvas, drawn every frame by
  `drawMinimap()`/`drawMinimapStatic()`), `#hint`, `#pausePrompt`,
  `#deathVideo`.
```

Then, after the existing paragraph that ends "...pushed once per map generation (not
per-frame) — the only HUD element driven by map-constant rather than per-frame or
per-event engine state." (currently ending around `:842`), add a new paragraph:

```
LUL-1308 adds `#bearingPulse`, a screen-edge glow answering "which side is the nearest
approaching predator on" for players who can't rely on the caption toggle (LUL-26) or
the direction-free `#spotFlash`. Driven off the same `pianoTimer`-gated approach-cue
block that fires `pianoNote()` (`updatePredators`'s threat-metrics scan): every note,
`bearingOf(nearP, player, ...)` (`lib/game/bearing.ts`) resolves a side, and unless it's
`'ahead'` (the player's own view already covers that case) the engine sets
`bearingPulseSide`/`bearingPulseT` and the element's class/opacity follow. The same
`bearingOf()` call also feeds `pianoNote()`'s new `pan` argument (a single
`StereoPannerNode` per note, `lib/game/bearing.ts`'s `bearingPan()`), and
`predatorCall()`'s volume now falls off with distance (`callVolumeMul()`, same module,
folded in per the CEO's LUL-1282 addendum) instead of the old binary `big ? 1.0 : 0.6`.
Not present: any compass, minimap dot, or degrees readout — deliberately rejected in the
design doc as turning horror into radar.
```

## Verification

1. `node --test lib/game/bearing.test.ts` — every test passes, exit 0.
2. `npx tsc --noEmit` — clean (no new `any`, `bearing.ts` fully typed).
3. `npx eslint engine/forest-engine.js components/GameCanvas.tsx lib/game/bearing.ts lib/game/bearing.test.ts` — clean.
4. `node scripts/check-duplicate-logic.mjs` — clean (this is why the import in 3a must
   use the exact exported names, not a namespace import).
5. `node scripts/check-elements-citations.mjs --fix` then re-check clean — the line-shift
   this diff causes in `engine/forest-engine.js` may need this.
6. `npm run build` (`next build`) — passes.
7. No browser in this environment — gameplay/audio/visual correctness is **unverified**.
   Say so explicitly in the PR body per the studio's "you assert code correctness only"
   rule; this is a Tier B feedback-layer change, not gated on a play verdict, but the PR
   body must not imply it's been seen working.

## e2e

**Backfilled LUL-2185 (2026-09-09).** This feature merged (`8b99b9f`, per the header above)
before the `## e2e` section requirement existed (LUL-2124) and shipped with **zero**
automated coverage — confirmed via `grep -rln "bearing" e2e/` (three false-positive hits,
all the unrelated English word "load-bearing" in comments). Filling that gap.

**Specs.** `e2e/bearing-pulse.spec.ts` — new. One test: `'luring a predator drives
#bearingPulse's class + opacity from the real bearing'`. Full content below — small enough
to hand an executor verbatim rather than just naming it.

```ts
// LUL-2185: e2e coverage for LUL-1308's bearing pulse (#bearingPulse) -- zero coverage
// since the feature merged before the '## e2e' section was required. No new QA hooks:
// qaLurePredatorKind + qaPlayerState + qaSetFixedStep/qaAdvance (all existing) are enough
// to trigger the approach-cue branch deterministically and read the resulting DOM state,
// same convention as e2e/action-prompt.spec.ts's direct #actionPrompt/#actionKey reads.
import { test, expect } from '@playwright/test';
import { boot, enter, trackConsoleErrors, expectNoConsoleErrors, qaHook } from './helpers';
import { bearingOf } from '../lib/game/bearing';

test.describe("#bearingPulse -- off-screen predator bearing cue (LUL-1308)", () => {
  test("luring a predator drives #bearingPulse's class + opacity from the real bearing", async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    await enter(page);

    const before = await qaHook(page, 'qaPlayerState');
    expect(before).not.toBeNull();

    const kind = await qaHook(page, 'qaLurePredatorKind', 'wolf');
    expect(kind, 'qaLurePredatorKind returned null -- no wolf at this seed').toBe('wolf');

    // qaLurePredatorKind places the predator at (player.x+6, player.z) in world frame --
    // dx=6, dz=0 regardless of yaw. Compute the expected side from the same bearingOf()
    // the engine uses (lib/game/bearing.ts), instead of hardcoding one.
    const expected = bearingOf(before.x + 6, before.z, before.x, before.z, before.yaw);

    // pianoTimer starts at 0, so the very next tick after luring fires the approach-cue
    // branch (engine/forest-engine.js:4596-4609) deterministically -- no timing race.
    await qaHook(page, 'qaSetFixedStep', 1 / 60);
    await qaHook(page, 'qaAdvance', 1);

    const pulse = await page.evaluate(() => {
      const el = document.getElementById('bearingPulse');
      return el ? { className: el.className, opacity: el.style.opacity } : null;
    });
    expect(pulse, '#bearingPulse missing from DOM').not.toBeNull();

    if (expected.side === 'ahead') {
      expect(Number(pulse!.opacity || 0)).toBe(0);
    } else {
      expect(pulse!.className).toBe(expected.side);
      expect(Number(pulse!.opacity)).toBeGreaterThan(0);
    }

    expectNoConsoleErrors(errs);
  });
});
```

**Hooks.** No new hooks needed — all three already exist and are already declared in
`engine/forest-engine.d.ts`:
- `qaLurePredatorKind(kind): string|null` — existing (`engine/forest-engine.js:3226`).
- `qaPlayerState(): {x,z,yaw,...}` — existing (`engine/forest-engine.js:3552`).
- `qaSetFixedStep(dt)` / `qaAdvance(steps)` — existing (`engine/forest-engine.js:3080` /
  `:3084`).

**Tester scenario.** None dedicated. `#bearingPulse` is engine-owned overlay DOM
(`docs/ELEMENTS.md`'s "Engine-owned DOM" bullet, updated by this PR) and is already swept
by the nightly's general hard rule 2 ("no HUD element may overlap another visible
element") in `shared/local-qa/QA_TESTER.md` — it isn't in the named LOSE/WIN checklist
because it never gates end-screen state, so no dedicated request file
(`shared/local-qa/REQUESTING-A-TEST.md`) is warranted for this backfill.

**Not covered.** Stereo pan (`pianoNote`'s new `pan` argument, real Web Audio panning) and
the distance-based call-volume falloff (`callVolumeMul`) stay manual/unverified: the
nightly rig runs `--mute-audio` (QA_TESTER.md rule 14) and this environment has no browser
at all. The underlying math for both is already covered by `lib/game/bearing.test.ts`'s
`bearingPan`/`callVolumeMul` unit tests (§2 above) — whether the panned/falloff audio
*feels* right is a judgment call, not a Playwright assertion. `#bearingPulse`'s gradient
legibility against the fog is likewise feel, not asserted beyond class-name + opacity
wiring.

## Constraints

- No change to `effectiveDetect()`, `canSee()`, `hearNoise()`'s state transitions, any
  predator's `state`/`inv`/`hunt` field, or any win/lose condition. This is output only.
- `announceCaption()` and `hearNoise()`'s extraction must be behavior-identical — same
  caption text for the same inputs, before and after. If a test or manual read shows a
  different caption string post-refactor, that's a bug in the extraction, not an
  intentional change.
- `bearingOf()`/`bearingPan()`/`callVolumeMul()` are pure functions: no `Math.random()`,
  no reads of engine globals, no side effects. Keep them that way — that's what makes
  them unit-testable without a scene.
- Mobile: this ticket is pure output (screen + audio), no new input, no new touch
  target — nothing to add for mobile parity. State this explicitly in the PR body per
  the mobile-parity mandate rather than leaving it silent.
- Do not pan `predatorCall()`'s howls/roars themselves. Explicitly deferred (separate
  ticket) — this PR only pans the approach piano note and applies the volume falloff.
- Do not touch `missionWaypointHum()` (`:1242-1257`). It already has its own
  `StereoPannerNode` using the same `right/max(1,dist)` pan formula this spec reuses —
  that's precedent to match, not a call site to refactor in this PR.

## Out of scope

- Panning predator howls/roars (follow-up ticket, per the design doc).
- A compass, minimap dot, or any degrees-based readout — explicitly rejected in the
  design doc.
- Any change to `missionWaypointHum()`.
- Any new `EngineHudState` field or React state — `#bearingPulse` is engine-owned DOM,
  same pattern as `#spotFlash`.
- Captions (`captionsOn`, the caption text) — untouched; this is a parallel default-on
  channel, not a replacement for the accessibility one.

## Sequencing note (for the PR body, not a blocker)

LUL-1255 (the child's-cry panner ticket the original ticket flagged as a sequencing risk)
is `done` as a **spec** ticket but has no `StereoPannerNode` in the live engine as of
`8b99b9f` — confirmed by grep, not assumed. The only existing panner in the audio graph
is `missionWaypointHum()`'s (a friendly nav aid, not a threat cue), so the "panned sound
= safe" mis-teaching risk the design doc flagged has not materialized. This PR is what
closes the "predators are the one thing still mono" gap; no coordination block exists at
merge time. Worth a one-line note in the PR body so the next person doesn't have to
re-derive this.
