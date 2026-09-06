# SPEC: LUL-1093 — minimap can't draw the bog

Tier: **C** (touches `engine/forest-engine.js`; per the LUL-1093 ticket and confirmed by
the E2-E6 spec's interaction note, which calls this "Tier C but tightly scoped"). Requires
`REVIEW: APPROVED` before merge. No Game Tester play verdict required (QA currently
paused per founder directive 2026-09-05) — but flag for a play pass if QA resumes, since
this changes what's drawn on an admin-only overlay.

Blocks: LUL-1483 (E2, the bigger-wrapping-world chain) — land this first, it is orthogonal
to E2's square-world fix and E2's own spec says so explicitly.

**Citations below are verified against `origin/release/next` at `049fcd6`
(2026-09-06). The ticket's own line numbers (`w2m` at `:2777`, `drawMinimapStatic` at
`:2778-2786`, `generateMap` call at `:690`) have drifted — probably from later commits
shifting the file. Use the numbers in this spec, not the ticket's.**

## Context — read before implementing, do not treat as blocking

Checked live: the minimap is currently **not player-visible by default regardless of this
bug**. `body[data-admin-mode="0"] #minimap { display: none !important; }`
(`components/GameCanvas.tsx:212`) hides it unless the admin-mode checkbox in
`SettingsPanel.tsx` is on (off by default), and separately `DIFFICULTY_PRESETS.blackout.minimap`
is `false` (`engine/tuning.js:117`) — `blackout` is the only preset whose child can spawn in
the bog (`babySpawnDifficulty === 'hard'`, `pickHardBabyPosition`), and that preset turns the
minimap off entirely (`mm.style.display = preset.minimap ? '' : 'none'`,
`engine/forest-engine.js:1089`). Feature Scout recorded this as a negative result in the wiki
(`game/mechanics/scout-cycle-2026-09-02b`, 2026-09-02).

**This does not make the ticket void.** It's still a real latent bug (defense in depth if
admin-mode or the blackout minimap flag ever change), it unblocks E2 per that spec's explicit
ordering note, and it costs nothing to fix now. State this nuance in the PR body so the
reviewer doesn't have to rediscover it — don't claim a player-facing fix you can't verify.

## Files

- `engine/forest-engine.js` — the fix
- `engine/forest-engine.d.ts` — type declaration for the new QA hook
- `e2e/minimap.spec.ts` — new file, the regression test

## The change

### 1. Clamp `w2m()` so bog coordinates pin to the canvas edge instead of vanishing

Current, `engine/forest-engine.js:3061-3064`:

```js
const mm = document.getElementById('minimap'), mmx = mm.getContext('2d'), MM = mm.width, mmS = MM/CONFIG.mapSize;
const mmStatic = document.createElement('canvas'); mmStatic.width = MM; mmStatic.height = MM;
const sx = mmStatic.getContext('2d');
function w2m(x,z){ return [ (x+half)*mmS, (z+half)*mmS ]; }
```

Replace the `w2m` line only (leave the `mm`/`mmStatic`/`sx` lines untouched):

```js
// LUL-1093: clamped so a bog coordinate (z up to zMax=240, engine/tuning.js
// CONFIG.bogDepth) pins to the canvas edge instead of being drawn off it and
// vanishing. mmS is still one scalar for both axes -- splitting into mmSx/mmSz
// is E2's job once the world stops being a 240x360 rectangle (see LUL-1483's
// spec, specs/bigger-wrapping-world-e2-e6 in the wiki). This clamp is defence
// in depth only, not a geometry fix.
function w2m(x,z){
  return [ Math.max(0, Math.min(MM, (x+half)*mmS)), Math.max(0, Math.min(MM, (z+half)*mmS)) ];
}
```

### 2. Draw `bogTreeData` and `landmarkData` in the static layer

Current, `engine/forest-engine.js:3065-3073`:

```js
function drawMinimapStatic(){
  sx.clearRect(0,0,MM,MM);
  sx.fillStyle = 'rgba(10,14,21,0.5)'; sx.fillRect(0,0,MM,MM);
  sx.strokeStyle = 'rgba(150,175,215,0.25)'; sx.lineWidth = 1; sx.strokeRect(1,1,MM-2,MM-2);
  sx.fillStyle = 'rgba(120,150,120,0.5)';
  for(let i=0;i<treeData.length;i+=4){ const [px,py] = w2m(treeData[i].x, treeData[i].z); sx.fillRect(px, py, 1.2, 1.2); }
  const [lx,ly] = w2m(CONFIG.lake.x, CONFIG.lake.z);
  sx.beginPath(); sx.arc(lx, ly, CONFIG.lake.r*mmS, 0, Math.PI*2); sx.fillStyle = 'rgba(134,184,255,0.55)'; sx.fill();
}
```

Insert two loops after the existing `treeData` loop, before the lake circle (keep
everything else byte-identical):

```js
function drawMinimapStatic(){
  sx.clearRect(0,0,MM,MM);
  sx.fillStyle = 'rgba(10,14,21,0.5)'; sx.fillRect(0,0,MM,MM);
  sx.strokeStyle = 'rgba(150,175,215,0.25)'; sx.lineWidth = 1; sx.strokeRect(1,1,MM-2,MM-2);
  sx.fillStyle = 'rgba(120,150,120,0.5)';
  for(let i=0;i<treeData.length;i+=4){ const [px,py] = w2m(treeData[i].x, treeData[i].z); sx.fillRect(px, py, 1.2, 1.2); }
  // LUL-1093: bogTreeData/landmarkData were never drawn here -- both are
  // populated by generateBogTrees()/placeLandmarks(), which used to run AFTER
  // this function was called from generateMap() (see the generateMap() edit
  // below), so both arrays were always empty at this point. Same subsample
  // stride and fill style as the forest-tree loop above; landmarks get a
  // bigger square (3x3 vs 1.2x1.2) so they read as distinct points -- this is
  // a minimal legibility choice for a bugfix, not a final art pass.
  for(let i=0;i<bogTreeData.length;i+=4){ const [px,py] = w2m(bogTreeData[i].x, bogTreeData[i].z); sx.fillRect(px, py, 1.2, 1.2); }
  for(const l of landmarkData){ const [px,py] = w2m(l.x, l.z); sx.fillRect(px-1.5, py-1.5, 3, 3); }
  const [lx,ly] = w2m(CONFIG.lake.x, CONFIG.lake.z);
  sx.beginPath(); sx.arc(lx, ly, CONFIG.lake.r*mmS, 0, Math.PI*2); sx.fillStyle = 'rgba(134,184,255,0.55)'; sx.fill();
}
```

`bogTreeData` (`engine/forest-engine.js:471`) and `landmarkData` (`:473`) are both
already-declared module-scope arrays (`{x,z,s,cr,crCanopy}` and `{x,z,cr}` respectively) —
no new state, just reading what already exists.

### 3. Move the `drawMinimapStatic()` call to the end of `generateMap()`

Current, `engine/forest-engine.js:692-738` (`generateMap`, full function — only the two
marked lines change):

```js
function generateMap(seed){
  currentSeed = seed >>> 0;
  rng = mulberry32(seed >>> 0);
  scentPoints = [];   // LUL-23: no trail survives a fresh map/restart
  ...
  layoutTreePool(parts, treeData, CONFIG.trees);
  buildGrid();
  drawMinimapStatic();                              // <-- DELETE this line
  player.x = 0; player.z = 0; player.yaw = 0; player.pitch = -0.02;
  placePredators();
  generateCover(); layoutCoverMeshes();
  generateWind();
  generateBogTrees();
  generateReeds(); layoutCoverMeshes();
  buildGrid();
  placeLandmarks();
  buildGrid();
  applyHardBabySpawn();
  bwisps.visible = true;
  mission = pickMission(rng);
  missionHumTimer = 2;                              // <-- ADD the call after this line
}
```

Change: delete the `drawMinimapStatic();` call at `:719` (right after the first
`buildGrid()`, before `player.x = 0`), and add it back as the last statement in the
function body, after `missionHumTimer = 2;` and before the closing `}`:

```js
  mission = pickMission(rng);
  missionHumTimer = 2;
  // LUL-1093: moved from right after the tree-pool buildGrid() above.
  // bogTreeData/landmarkData don't exist until generateBogTrees()/
  // placeLandmarks() run, both below the old call site -- drawing from them
  // there always rendered empty arrays. This draws from data only and
  // consumes no rng, so it cannot perturb the seeded stream (LUL-25's
  // ordering comment above generateBogTrees() explains what does).
  drawMinimapStatic();
}
```

Do not reorder anything else in `generateMap()` — this is a pure move of one call, per the
ticket: "THIS IS A PURE RENDER-ORDER MOVE."

### 4. Add a QA hook for the regression test

`window.ForestEngine.qaProbeBaby` already exists as a pattern to copy. Add a new hook in
the same `?qaHooks=1`-gated block, `engine/forest-engine.js:2302` (right after the
`qaProbeBaby` line):

```js
  window.ForestEngine.qaProbeBaby = function(){ return { x: baby.x, z: baby.z, inBog: inBog(baby.x, baby.z) }; };
  // LUL-1093: exposes w2m()'s clamped output directly so a test can assert
  // "this world point stays on-canvas" for both the player arrow (which calls
  // w2m(player.x, player.z) in drawMinimap()) and the objective marker (which
  // calls w2m(baby.x, baby.z)) without needing to actually move either --
  // both draw calls go through this same function.
  window.ForestEngine.qaProbeMinimapPoint = function(x, z){ const [px, py] = w2m(x, z); return { px, py, mm: MM }; };
```

In `engine/forest-engine.d.ts`, add the matching type right after the existing
`qaProbeBaby?` entry (`:41`):

```ts
      /** LUL-1093: w2m(x,z)'s clamped pixel output plus the minimap canvas size (mm),
       * so a test can assert an arbitrary world point stays on-canvas. */
      qaProbeMinimapPoint?: (x: number, z: number) => { px: number; py: number; mm: number };
```

### 5. Regression test — `e2e/minimap.spec.ts` (new file)

```ts
// LUL-1093: w2m() mapped bog coordinates (z > 120, up to zMax=240) off the
// 160x160 minimap canvas with no clamp, so the player arrow and the pulsing
// objective marker both silently vanished once either point crossed z=120.
// Pins the fix: any point up to the bog's outer edge stays on-canvas.
import { test, expect } from '@playwright/test';
import { boot } from './helpers';

test.describe('minimap w2m stays on-canvas past the forest/bog seam', () => {
  test('a player-arrow point at z=200 (deep bog) is clamped on-canvas', async ({ page }) => {
    await boot(page, { qaHooks: true });
    const p = await page.evaluate(() => window.ForestEngine!.qaProbeMinimapPoint!(0, 200));
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThanOrEqual(p.mm);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThanOrEqual(p.mm);
  });

  test('an objective-marker point at z=150 (past the z=120 seam) is clamped on-canvas', async ({ page }) => {
    await boot(page, { qaHooks: true });
    const p = await page.evaluate(() => window.ForestEngine!.qaProbeMinimapPoint!(40, 150));
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThanOrEqual(p.mm);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThanOrEqual(p.mm);
  });
});
```

## Verification

- `npx tsc --noEmit` clean.
- `npx eslint .` clean.
- `npx playwright test e2e/minimap.spec.ts` — both new tests green.
- `npm test` green (no `lib/game/**` logic touched by this spec, so no unit-test
  changes expected — if any fail, stop and report, don't reconcile).
- No `rng()` call added or removed anywhere in this diff — confirm by inspection, since
  that's what keeps this from perturbing `QA_PINNED_SEED` (`e2e/helpers.ts`). **Do not
  re-pin the seed for this change** — unlike E2, this diff must not need it.
- Manual sanity (optional, no browser required to trust the above): the four `LANDMARKS`
  entries and up to 90 `bogTreeData` entries now iterate inside `drawMinimapStatic()`,
  which previously only ever drew `treeData` (1300 entries) and the lake circle.

## Constraints — what must not change

- Do not touch `mmS` (single scalar) — splitting it into `mmSx`/`mmSz` is explicitly out
  of scope, reserved for E2/LUL-1483 once the world is square (240×240) instead of
  240×360. Doing it here would conflict with that ticket's own math.
- Do not reorder any `rng()`-consuming call in `generateMap()`. The only reordering in
  this diff is `drawMinimapStatic()`, which reads `treeData`/`bogTreeData`/`landmarkData`/
  `CONFIG.lake` and calls no `rng()` — verify this by inspection before merging.
- Do not change `drawMinimap()` (the per-frame draw, `engine/forest-engine.js:3074-3082`)
  or the objective-marker draw block (`:3556-3560`) — both already call the (now-clamped)
  `w2m()` and need no changes themselves.
- Do not add a generic "teleport player to arbitrary x,z" QA hook — `qaProbeMinimapPoint`
  tests the shared `w2m()` function directly, which is sufficient and matches this file's
  existing pattern of narrow, single-purpose QA probes.

## Out of scope

- Splitting `mmS` into per-axis scalars (E2/LUL-1483).
- Any visual/art pass on how bog trees or landmarks render on the minimap beyond making
  them visible and distinguishable (fill style/size choices above are a minimal legibility
  choice, not final).
- Re-enabling the minimap on `blackout` or changing admin-mode gating — both are
  deliberate existing behavior, untouched, unrelated to this bug.
- Anything in `lib/game/**` — this spec touches only `engine/forest-engine.js`,
  `engine/forest-engine.d.ts`, and the new `e2e/minimap.spec.ts`.
- `docs/ELEMENTS.md` — **not touched, deliberately.** This diff changes no element's
  verbs, collision, or interactions; the minimap is a render overlay, not a gameplay
  element the registry tracks. Don't add an entry for it.

## PR body must state

1. `Tier: C — engine/forest-engine.js` (state it, don't imply it).
2. "Pure render-order move + clamp, consumes no rng, cannot perturb the seeded stream" —
   the reviewer will reasonably check this, per the ticket's own note.
3. The player-visibility nuance from the Context section above: this is currently not
   player-facing (admin-only minimap, blackout preset turns it off), so it's a latent
   fix / defense-in-depth, not a live regression fix — don't overclaim.
4. Mobile: no separate mobile work needed and say so. `w2m()`/`drawMinimapStatic()`/
   `drawMinimap()` are input-mode-agnostic — the same canvas, the same draw calls, on
   both platforms; there is no touch action, key binding, or mobile-only UI involved.
   This is not the "desktop only, mobile follow-up" case that needs sign-off — it's
   "one fix, applies identically to both," which needs none.
