# SPEC: LUL-2971 win-burst reads as a white wash, not a visible sky burst

**Ticket:** LUL-2971 · **Tier:** C — edits engine simulation visuals (`engine/forest-engine.js`
material/opacity constants inside `tick()`'s render path). Needs `REVIEW: APPROVED` before merge.

**Written against:** `release/next` @ `69e325c60e13c361f8ec45f8949c6f49e0a99dba` (2026-09-17).
Re-derive every `file:line` below from the branch you actually implement on if it has moved.

## Background

CTO's root-cause comment on LUL-2971 (2026-09-17T12:23Z) confirmed this is a real recurrence
of the vision-QA "no bright burst visible" finding, not a stale build or a duplicate of
LUL-2953/LUL-2959 (whose `BOOM_FOV_SCALE` mesh-*size* fix, PR #718, is present in the build
that reproduced this). The burst mesh materials are near-white/cream
(`boomFlash` `0xfff4d6`, `boomRing` `0xffe0a0`, `bspPts` `0xffe6b0`,
`engine/forest-engine.js:1737,1739,1744`) and are composited *underneath* the DOM `#flash`
overlay — a full-viewport `background:#fff` div (`components/GameCanvas.tsx:734`) that
`fireBoom()` sets to `opacity:'0.9'` (`engine/forest-engine.js:1776`) at the same instant the
mesh burst starts, and holds at that plateau through `e<=1.5` game-seconds
(`updateBoom()`, `engine/forest-engine.js:1796`, LUL-2605).

**Why scaling the mesh bigger (LUL-2953) didn't fix this:** standard CSS opacity compositing
means the visible pixel at the burst's screen position is
`0.9 * white + 0.1 * meshColor` regardless of the mesh's on-screen size. At `0.1` weight, even
a fully saturated color barely tints pure white — e.g. `0xff8c1a` orange at 10% weight composites
to `rgb(255,224,178)`, a pale cream indistinguishable from the current `0xfff4d6`. A same-hue
mesh made bigger under a 90%-white overlay is still a same-hue wash, just a bigger one. This
matches the LUL-2971 screenshot (`/home/noam/.paperclip/shared/local-qa/state/runs/2026-09-17-1405/scenario/mobile-pixel5-landscape--win-burst.png`):
a uniform pale wash with only a barely-visible faint ring.

**Why the fix must touch `#flash`'s peak opacity, not just mesh color:** the 10%-weight ceiling
caps *any* hue choice's visible contribution. The only way to give the mesh's color a chance to
read through is to raise the scene's compositing weight, i.e. lower `#flash`'s peak below 0.9.
The floor on how low it can go is fixed by the vision-QA harness's own detection contract cited
in the ticket's repro step 8 (`poll #flash opacity >= 0.5`) and pinned by
`e2e/win-burst-flash-decay.spec.ts` (LUL-2605/LUL-2520): captures have landed as late as 1.36s
after `fireBoom()` fires, so the plateau must stay `>= 0.5` for the full `e<=1.5` window or the
harness stops detecting the event at all — a worse regression than a washed-out burst. This
spec picks `0.65` as the new peak: enough margin above the `0.5` floor to survive the same
measured capture delays, while roughly halving the white overlay's dominance (90%→65% weight,
scene weight 10%→35%).

This picks candidate (a)+(b) from the CTO's three options: recolor the burst materials to a
clearly saturated warm hue *and* lower `#flash`'s peak opacity. Candidate (c) (retime the mesh
to ramp in after `#flash` starts fading) was rejected: this ticket's own capture landed at
`e≈0.43s` (`gameSinceE=9.73` in the evidence block minus the `e>=9.3` trigger keyframe,
`engine/forest-engine.js:6425`) — well before `#flash` begins decaying at `e=1.5` — so a fix
that only becomes visible late in the plateau would still fail on an early capture like this
one. Contrast has to hold across the *whole* `[0, 1.5]` window, which only a peak-opacity
change achieves uniformly.

## Files

- `engine/forest-engine.js` — recolor `boomFlash`/`boomRing`/`bspPts` materials; replace the
  `0.9` flash-opacity literal with a named constant `FLASH_PEAK_OPACITY = 0.65`, used in both
  `fireBoom()` and `updateBoom()`.
- `e2e/win-burst-flash-decay.spec.ts` — update the two assertions pinned to the old `0.9`
  literal to `0.65`.
- `e2e/win-burst-contrast.spec.ts` — new. The pixel/luminance-contrast assertion CTO's comment
  required (a scale-math-only probe already failed to catch this once).
- `engine/forest-engine.d.ts` — declare the new `qaProbeBoomPixel` hook.
- `docs/ELEMENTS.md` — extend the existing LUL-2953 boom bullet (`docs/ELEMENTS.md:222-225`)
  with this fix; re-run the citation checker since one line is added above it.

## The change

### 1. `engine/forest-engine.js` — saturate the burst materials

At `:1735` (immediately before `const boomGroup = ...`), add:

```js
// LUL-2971: #flash (components/GameCanvas.tsx:734) is a full-viewport
// background:#fff DOM overlay composited on TOP of this WebGL canvas via
// plain CSS opacity -- the visible pixel is `flashOpacity*white +
// (1-flashOpacity)*meshColor`. At the old 0.9 peak (10% scene weight), no
// hue choice reads through; see this spec's Background section for the
// arithmetic. FLASH_PEAK_OPACITY replaces the two `0.9` literals below and
// in updateBoom() so the two stay in lockstep.
const FLASH_PEAK_OPACITY = 0.65;
```

At `:1737-1744`, change the three material colors (size/blending/transparent flags unchanged):

```js
const boomFlash = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
const boomRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 44),
  new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
boomRing.rotation.x = Math.PI/2;
const bspArr = new Float32Array(BSP*3), bspVel = [];
const bspPts = new THREE.Points(new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: 0xffa940, size: 0.7 * BOOM_FOV_SCALE, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
```

(Only the `color:` hex on each of the three materials changes — `0xfff4d6`→`0xffb020`,
`0xffe0a0`→`0xff8c1a`, `0xffe6b0`→`0xffa940`. Every other field is unchanged.)

### 2. `engine/forest-engine.js` — lower and rename the flash peak

At `:1776` (`fireBoom()`), change:
```js
  if(flashEl) flashEl.style.opacity = '0.9';
```
to:
```js
  if(flashEl) flashEl.style.opacity = String(FLASH_PEAK_OPACITY);
```

At `:1796` (`updateBoom()`), change:
```js
  if(flashEl) flashEl.style.opacity = String(e <= 1.5 ? 0.9 : Math.max(0, 0.9 - (e - 1.5)*3));
```
to:
```js
  // LUL-2971: decay rate recomputed so the fade still lands on exactly 0 at
  // e=1.8 (unchanged, in sync with boomGroup's own e>1.8 retirement below) --
  // FLASH_PEAK_OPACITY / 0.3, the same 0.3s fade window LUL-2605 used at 0.9.
  if(flashEl) flashEl.style.opacity = String(e <= 1.5 ? FLASH_PEAK_OPACITY : Math.max(0, FLASH_PEAK_OPACITY - (e - 1.5)*(FLASH_PEAK_OPACITY/0.3)));
```

Do not touch the `e<=1.5` / `e>1.8` timing constants themselves — those are LUL-2605's
capture-delay tolerance and this fix does not change the detection contract, only the
magnitude of the plateau.

### 3. `engine/forest-engine.js` — new hook for the contrast assertion

In the `?qaHooks` block inside `init()`, next to `qaProbeBoom` (`:5237`), add:

```js
  window.ForestEngine.qaProbeBoomPixel = function(){
    // Force a render so the WebGL back buffer reflects the exact simulated
    // instant this is called at, independent of the rAF/fixed-step loop's
    // own timing -- readPixels with no preserveDrawingBuffer is only
    // reliable read-immediately-after-render.
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const w = renderer.domElement.width, h = renderer.domElement.height;
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(w/2), Math.floor(h/2) - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { r: px[0], g: px[1], b: px[2] };
  };
```

(`Math.floor(h/2) - 1`: WebGL's `readPixels` origin is bottom-left, so this samples one row
below the geometric vertical center in top-left screen terms — close enough to "screen center"
for a burst that fills a large fraction of the frame; do not over-fit this to dead-center.)

Declare in `engine/forest-engine.d.ts` next to the existing `qaProbeBoom` entry (`:357`):
```ts
      qaProbeBoomPixel?: () => { r: number; g: number; b: number };
```

## Verification

- `npx tsc --noEmit` — clean (new hook typed).
- `npx eslint .` — clean.
- `npx playwright test win-burst` — `win-burst-flash-decay.spec.ts` (updated literals) and the
  new `win-burst-contrast.spec.ts` pass on both `chromium` and `mobile` projects.
- `node scripts/check-elements-citations.mjs` — 0 drift after the `docs/ELEMENTS.md` edit below
  (the new `FLASH_PEAK_OPACITY` line shifts every citation below `:1735` by one line — re-derive
  them with `--fix` or by hand, don't guess).

## e2e

**Specs.**
- `e2e/win-burst-flash-decay.spec.ts` — existing test, extended: replace the two
  `toBeCloseTo(0.9, 1)`-shaped assertions with `toBeCloseTo(0.65, 1)` (the peak value itself
  changed; the `>=0.5` and final `toBe(0)` assertions are unchanged since the detection
  contract they pin didn't move).
- `e2e/win-burst-contrast.spec.ts` — new. Title:
  `'sky burst composites with visible color contrast against the #flash overlay at every point
  in its lifetime, not just a white wash'`. Runs on `chromium` (desktop) and `mobile`
  (`viewport: 851x393`, same `enterMobile()` pattern as
  `e2e/mobile/win-burst-fov-scale.spec.ts`) — this bug reproduced on mobile specifically, so
  mobile coverage is not optional here.

  Steps: `boot`/`enter` (or `enterMobile`) → `qaTeleportNearBaby` → `qaSetFixedStep(0.02)` →
  `KeyE` → `qaAdvance` to three points in the burst's lifetime: `e≈0.43s` post-trigger (this
  ticket's actual measured capture offset — `gameSinceE=9.73` minus the `e>=9.3` keyframe,
  `engine/forest-engine.js:6425`), `e≈0.9s` (mid-plateau), and `e≈1.36s` (LUL-2605's worst-case
  measured delay). At each point: read `qaProbeBoomPixel()` for the rendered mesh-only RGB,
  read `#flash`'s live `style.opacity` via `page.locator('#flash').evaluate(el => el.style.opacity)`,
  compute the composited pixel analytically
  (`composited = flashOpacity*255 + (1-flashOpacity)*meshChannel` per channel, using `#fff` as
  the flash's own color per `components/GameCanvas.tsx:734`), and assert the composited color's
  distance from pure white exceeds a fixed threshold — e.g.
  `Math.max(255 - composited.g, 255 - composited.b) > 20` (a warm hue shows as a G/B deficit
  relative to R at pure white's baseline). This is the literal "sample canvas color vs
  `#flash`-only baseline" check CTO's comment asked for, done analytically instead of a
  DOM/canvas screenshot decode (no new dependency, deterministic).
- `e2e/mobile/win-burst-fov-scale.spec.ts` — must still pass unchanged (mesh *scale* math is
  untouched by this fix).

**World.** micro (`qaTeleportNearBaby` + `qaSetFixedStep`/`qaAdvance`, same fixture the two
existing win-burst specs already use — no map features involved).

**Hooks.** `window.ForestEngine.qaProbeBoomPixel(): {r,g,b}` — new, forces a render and reads
back the WebGL canvas's center pixel (declare per §3 above). `qaProbeBoom`, `qaTeleportNearBaby`,
`qaSetFixedStep`, `qaAdvance` — existing, unchanged.

**Tester scenario.** This is exactly the nightly `vision-win-burst` scenario already in
`shared/local-qa/QA_TESTER.md` (the one that filed LUL-2971, LUL-2959, LUL-2953). No new
request file needed — the existing scenario re-runs against this fix on the next nightly and
is the real-world confirmation the new e2e spec above cannot fully substitute for (a headless
Playwright RGB read and a CPU vision model's judgement of a screenshot are not the same
measurement). Flag on this ticket for the human/tester to re-verify post-merge.

**Not covered.** Whether the new gold/orange hue *feels* right in the actual game (subjective,
gameplay-feel — needs the nightly vision check and eventually a human to confirm the recolor
reads as "celebratory sky burst" and not something else); real-device GPU rendering (this fix
targets the software-WebGL rig this bug was found on, but confirm on real mobile hardware too
since additive blending can render differently across GPUs).

## Cues

**Visual.** The sky-burst flash/ring/sparkles at the end of the pickup cinematic change color
from near-white/cream to saturated gold/orange (`fireBoom()`/`updateBoom()`,
`engine/forest-engine.js:1771-1798`); the `#flash` DOM overlay's peak brightness drops from 0.9
to 0.65 opacity for the same ~1.5s window it already held (`components/GameCanvas.tsx:734`,
`engine/forest-engine.js:1796`). No new visual element — recolor/re-tune of an existing one.
**Audio.** Unchanged — `boom()` (`engine/forest-engine.js:1777`) still fires once, gated by
`soundOn`, at the same instant.
**Explanation.** None — this cinematic has no caption/copy tied to the burst's appearance.
**Reduced motion.** Unchanged — `motionReduced()` is not consulted anywhere in `fireBoom()`/
`updateBoom()` today (confirmed via grep — no hits in those two functions) and this fix doesn't
add a new animated property, so there is nothing new to degrade.

## Constraints

- Do not change the `e<=1.5` / `e>1.8` timing constants in `updateBoom()` — those are the
  LUL-2605 capture-delay tolerance (harness detection contract), untouched by this fix.
- `#flash`'s peak must stay `>= 0.5` with real margin — do not tune `FLASH_PEAK_OPACITY` below
  ~0.55 without re-measuring against the LUL-2605/LUL-2520 capture-delay history first.
- `BOOM_FOV_SCALE` (`:1735` pre-existing) and its mesh-scale math (LUL-2953/LUL-2959) are out
  of scope — do not touch.
- Tier C: needs `REVIEW: APPROVED` before merge.

## Out of scope

- Redesigning the win cinematic's pacing/curves (`key3()` keyframes in `tick()`'s `pickingUp`
  branch) — this fix only touches burst material color and `#flash` peak magnitude.
- A DOM/canvas full-screenshot-based pixel check — the analytical composite in
  `win-burst-contrast.spec.ts` is deliberately simpler and dependency-free; if a future finding
  shows the analytical model doesn't match what the vision QA actually sees (e.g. HUD elements
  overlapping the sample point, anti-aliasing, gamma), that upgrade is a separate ticket.
- Any change to `#winScreen` itself (named as `Element:` in the finding) — the finding's actual
  defect is the burst that plays *before* `#winScreen` appears, per the CTO's root-cause
  comment; `#winScreen` markup is untouched.
