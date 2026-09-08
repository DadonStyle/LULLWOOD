# SPEC: fold the bog in as a biome, re-centre z to a square world, and give predators the terrain multiplier

**Ticket:** LUL-1483 (E2 of the bigger-wrapping-world sequence, wiki `specs/bigger-wrapping-world-e2-e6`,
parent LUL-1094). **Tier: C** — `engine/forest-engine.js` + `engine/tuning.js` simulation/config
+ `lib/game/bog.ts` + `lib/game/mission.ts`. Blocking review required before merge
(`REVIEW: APPROVED`). Game Tester play-verdict requirement is **currently suspended**
company-wide (QA paused as of 2026-09-04/09-05) — do not block merge on it; note the gap
explicitly in the PR body per that directive.

**Written against:** `origin/release/next` @ `6af26a5` (2026-09-06, after LUL-1093 merged).
**This supersedes an earlier draft of this same spec** that was written against a stale
branch (`lul-1443-gamemenu-newmap-fix`, predates LUL-1093 and the tuning-extraction PR
#274) and left sitting uncommitted in the shared tree. Every `file:line` and file-location
claim below was re-read from `6af26a5` directly. **Re-derive again from the branch you
actually implement on if it has moved further.**

## Drift found vs. the earlier draft — read before you start

Two things changed in the codebase since the earlier draft was written, neither anticipated
by the wiki ticket (which predates both):

1. **`LANDMARKS` and `CONFIG` (including `bogDepth`) no longer live in
   `engine/forest-engine.js`.** The tuning-extraction ticket (LUL-1065/1491, PR #274) moved
   them to `engine/tuning.js`, which `forest-engine.js` now imports (`:139-144`). **Edit
   `engine/tuning.js`, not `forest-engine.js`, for the `LANDMARKS` array and the `bogDepth`
   line** — see file list below.

2. **A new consumer, `lib/game/mission.ts` (LUL-1258, ships after the wiki ticket was
   written), hardcodes a mission target at the exact coordinates of the `drownedCar`
   landmark** (`x: 55, z: 205` — `MISSION_POOL[0]`, `lib/game/mission.ts:18-22`). Its own
   comment already flags the risk: *"do not hand-copy the numbers again if that entry ever
   moves"* — but nothing currently enforces that; the engine draws `mission = pickMission(rng)`
   straight from `MISSION_POOL` with no re-derivation from `LANDMARKS` at the call site
   (`engine/forest-engine.js:736`). **If `drownedCar` moves and `MISSION_POOL` isn't updated
   in the same commit, the deepwater mission's target sits at `z=205`, which is outside the
   new `[-120,120]` square entirely — a permanently uncompletable mission, not a cosmetic
   miss.** Fixed below by updating `MISSION_POOL[0]` in the same commit.

Neither drift changes the ticket's intent (fold the bog in, re-centre z, add the predator
terrain multiplier). Both are declared here per "if a citation has drifted, say so" rather
than silently worked around, and per LUL-1483's own instruction to confirm signatures before
handoff.

## A design gap the wiki ticket didn't anticipate: bog-over-home

In the current (pre-this-ticket) world the bog is a disjoint z-band that can never coincide
with the origin. Once the bog is 2D noise over the whole square, a naive noise field can —
and, checked by direct computation with the exact constants below, does — put
`CONFIG.home`/spawn (`0,0`) at bogginess ≈0.99. Player would spawn already half-speed and
1.6× louder, which nothing in the ticket asked for and no playtester would read as
intentional. Fixed below with an explicit dry clearance around the origin (`HOME_CLEAR_RADIUS`/
`HOME_FADE_RADIUS`, baked into the constants given — no need to re-derive, the unit tests in
§ Verification confirm it).

---

## Files

- **Rewrite:** `lib/game/bog.ts` (full replacement — given below)
- **Rewrite:** `lib/game/bog.test.ts` (full replacement — given below)
- **Edit:** `engine/tuning.js` (drop `bogDepth`, relocate two `LANDMARKS` entries)
- **Edit:** `engine/forest-engine.js` (edits below, all re-verified against `6af26a5`)
- **Edit:** `lib/game/mission.ts` (one coordinate pair, `MISSION_POOL[0]`)
- **Edit:** `docs/ELEMENTS.md` (the "Pending: the Bog" section only — see § ELEMENTS.md)

No other files change. Do not touch `lib/game/pack.ts`, `lib/game/predator.ts`, or their
tests — see "What must NOT change" below for why their `zMax`-shaped bounds parameters
don't need editing. Do not touch `lib/game/mission.test.ts` — it has no coordinate-specific
assertions (verified: no `55`/`205` literals in that file).

---

## `lib/game/bog.ts` — full replacement content

```ts
// LUL-25: pure helpers for the Bog biome -- how boggy a point is, what that
// costs to walk through, and where the child spawns when blackout mode wants
// it hidden in the deepest patch. No Three.js, no DOM (see wiki
// systems/unit-testing-standard). The engine owns the world-space constants
// (half, landmark positions) and calls these back in, same split as
// lib/game/scent.ts and lib/game/charge.ts.
//
// LUL-1483: the world used to be a rectangle (x in [-half,half], z in
// [-half, half+bogDepth]) with the bog a strip past the forest's +z edge --
// isInBog(z, bounds) tested z alone. Re-centring z to match x makes "the far
// strip of +z" meaningless on a square, so the bog is now a biome distributed
// by 2D noise over the whole square instead of a directional band. biomeAt()
// replaces isInBog(): same role (what does this patch of ground cost to
// cross), continuous instead of boolean so a patch edge feels like terrain,
// not a wall the player's speed instantly steps through.

export interface Point {
  x: number;
  z: number;
}

export interface Landmark extends Point {
  clear: number; // radius to keep clear of, in world units
}

// ---- Bog biome noise -------------------------------------------------------
// Fixed geography, like CONFIG.lake/CONFIG.home/LANDMARKS -- a place you can
// actually learn, not something that reshuffles with the per-game rng seed
// (mulberry32(CONFIG.seed) in the engine, resolveInitialSeed()/generateMap()).
// BOG_NOISE_SEED is its own constant, untouched by either: every player's bog
// patches sit in the same places: only the trees/predators/cover scattered
// around them vary per seed.
const BOG_NOISE_SEED = 20260906;
// World units per noise lattice cell -- big enough that a patch reads as a
// biome you walk across for several seconds, not a speckle underfoot.
const BOG_NOISE_CELL = 48;
// Raw noise below this reads as dry land (bogginess 0). ~30% of the 240x240
// square is boggy at this cutoff (checked by direct sampling of the formula
// below at 2-unit resolution) -- a substantial biome, not a rare pocket.
const BOG_THRESHOLD = 0.55;
// Home/spawn (CONFIG.home = {x:0,z:0}; generateMap() also sets player.x =
// player.z = 0) must never be boggy -- see this spec's "design gap" note.
// Fully dry inside HOME_CLEAR_RADIUS, blends up to the unmodified noise value
// by HOME_FADE_RADIUS. If CONFIG.home ever moves off the origin, this must
// move with it.
const HOME_CLEAR_RADIUS = 8;
const HOME_FADE_RADIUS = 16;

// Deterministic hash of an integer lattice point -> [0, 1). Integer-only
// multiply/xor/shift, same shape as the engine's own mulberry32 (LUL-153) --
// no floating point drift, same output on every platform.
function bogLatticeHash(ix: number, iz: number): number {
  let h =
    (Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(BOG_NOISE_SEED, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Bilinear-interpolated value noise: smooth, O(1) per call (four hash
// lookups + two lerps), no precomputed grid/array -- cheap enough to call
// once per predator per frame (updatePredators()) as well as at map-gen time.
function bogValueNoise(x: number, z: number): number {
  const gx = x / BOG_NOISE_CELL, gz = z / BOG_NOISE_CELL;
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = smoothstep(gx - ix), fz = smoothstep(gz - iz);
  const h00 = bogLatticeHash(ix, iz);
  const h10 = bogLatticeHash(ix + 1, iz);
  const h01 = bogLatticeHash(ix, iz + 1);
  const h11 = bogLatticeHash(ix + 1, iz + 1);
  const a = h00 + (h10 - h00) * fx;
  const b = h01 + (h11 - h01) * fx;
  return a + (b - a) * fz;
}

/**
 * Replaces isInBog(z, bounds) (LUL-1483). Bogginess at a world point, 0
 * (dry) to 1 (deepest bog) -- continuous, not boolean, so the movement/noise
 * multipliers below ease in across a patch edge instead of stepping. Takes
 * `x` (isInBog never did) because a patch is a 2D region, not a z-band.
 * Deterministic and pure: same (x, z) always returns the same value, no rng,
 * no dependency on the per-game seed.
 */
export function biomeAt(x: number, z: number): number {
  const n = bogValueNoise(x, z);
  const t = (n - BOG_THRESHOLD) / (1 - BOG_THRESHOLD);
  const raw = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const distFromHome = Math.hypot(x, z);
  if (distFromHome >= HOME_FADE_RADIUS) return raw;
  const fade =
    distFromHome <= HOME_CLEAR_RADIUS
      ? 0
      : smoothstep((distFromHome - HOME_CLEAR_RADIUS) / (HOME_FADE_RADIUS - HOME_CLEAR_RADIUS));
  return raw * fade;
}

export const BOG_SPEED_MULTIPLIER = 0.5; // "shallow water at half walk speed", at bogginess 1.0
export const BOG_NOISE_MULTIPLIER = 1.6; // splashing carries further than dry footsteps, at bogginess 1.0

// Linear in bogginess, deliberately not eased: bogValueNoise() already runs
// its lattice through smoothstep() once, so a patch edge is already
// spatially smooth in *where* the multiplier changes. Easing the *response
// curve* on top would compound that softening and decouple "how far into the
// patch you are" from "how much it costs" -- the one thing a player learns to
// read while crossing one. Endpoints unchanged from the old boolean version:
// 1 at bogginess 0, today's exact 0.5x/1.6x at bogginess 1.
export function bogSpeedMultiplier(bogginess: number): number {
  return 1 - bogginess * (1 - BOG_SPEED_MULTIPLIER);
}

export function bogNoiseMultiplier(bogginess: number): number {
  return 1 + bogginess * (BOG_NOISE_MULTIPLIER - 1);
}

export function clearOfLandmarks(x: number, z: number, landmarks: readonly Landmark[], pad: number): boolean {
  return landmarks.every((l) => Math.hypot(x - l.x, z - l.z) >= l.clear + pad);
}

/**
 * Draws a point from `rng` ((0,1) or [0,1), caller's own generator) inside a
 * bog patch (biomeAt > 0), at least `margin` units in from the map edge on
 * both axes, clear of every landmark by `pad`. Bounded by `maxTries` so a
 * seed/landmark layout that happens to leave no clear boggy point can't spin
 * forever -- returns its last candidate rather than looping, same contract
 * as before this ticket (a candidate close to a landmark, or on drier ground
 * than intended, is a cosmetic risk for blackout's spawn, not a correctness
 * one).
 */
export function pickHardBabyPosition(
  rng: () => number,
  half: number,
  landmarks: readonly Landmark[],
  pad = 6,
  margin = 20,
  maxTries = 200,
): Point {
  const lo = -Math.max(0, half - margin);
  const hi = Math.max(0, half - margin);
  let x = 0;
  let z = 0;
  for (let i = 0; i < maxTries; i++) {
    x = lo + rng() * (hi - lo);
    z = lo + rng() * (hi - lo);
    if (biomeAt(x, z) > 0 && clearOfLandmarks(x, z, landmarks, pad)) return { x, z };
  }
  return { x, z };
}
```

Deleted from the old file: `BogBounds` interface, `isInBog()`. Confirmed no other consumer
(`grep -rn "BogBounds\|isInBog" --include='*.ts' --include='*.js' .` outside `bog.ts`/
`bog.test.ts`/`engine/forest-engine.js` returns nothing).

**Signature change from the current file:** `pickHardBabyPosition`'s current signature is
`(rng, bounds: BogBounds, halfWidth, landmarks, pad=6, maxTries=200)` — 6 params, a bounds
object. The new signature above drops the bounds object (there's only one `half` now, no
separate `zMax`) and adds a named `margin` param before `maxTries`. Update both call sites
(engine `applyHardBabySpawn()` below) and the test file to match.

---

## `lib/game/bog.test.ts` — full replacement content

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  biomeAt,
  bogSpeedMultiplier,
  bogNoiseMultiplier,
  pickHardBabyPosition,
  BOG_SPEED_MULTIPLIER,
  BOG_NOISE_MULTIPLIER,
  type Landmark,
} from './bog.ts';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('biomeAt is deterministic for a given point', () => {
  assert.equal(biomeAt(30, 2), biomeAt(30, 2));
});

test('biomeAt stays within [0, 1] across the whole map square', () => {
  for (let x = -120; x <= 120; x += 5) {
    for (let z = -120; z <= 120; z += 5) {
      const b = biomeAt(x, z);
      assert.ok(b >= 0 && b <= 1, `biomeAt(${x},${z})=${b} out of range`);
    }
  }
});

test('biomeAt finds both boggy and dry ground within the map square', () => {
  let sawBoggy = false, sawDry = false;
  for (let x = -120; x <= 120; x += 5) {
    for (let z = -120; z <= 120; z += 5) {
      const b = biomeAt(x, z);
      if (b > 0.5) sawBoggy = true;
      if (b === 0) sawDry = true;
    }
  }
  assert.ok(sawBoggy, 'expected at least one strongly boggy sample point');
  assert.ok(sawDry, 'expected at least one dry sample point');
});

test('home/spawn is kept dry regardless of the noise field', () => {
  assert.equal(biomeAt(0, 0), 0);
  assert.equal(biomeAt(6.3, 0), 0); // inSpawn()'s own radius, engine/forest-engine.js (re-grep `inSpawn` for current line)
});

test('the relocated oak and drownedCar landmarks sit in a bog patch', () => {
  assert.ok(biomeAt(22, 4) > 0.5, 'oak landmark should be well inside a bog patch');
  assert.ok(biomeAt(-95, 46) > 0.5, 'drownedCar landmark should be well inside a bog patch');
});

test('the lake and the other two landmarks are not accidentally boggy', () => {
  assert.equal(biomeAt(34, -28), 0); // CONFIG.lake
  assert.equal(biomeAt(-95, -95), 0); // fireTower
  assert.equal(biomeAt(100, -75), 0); // stoneMarker
});

test('bogSpeedMultiplier/bogNoiseMultiplier hit their old boolean endpoints exactly', () => {
  assert.equal(bogSpeedMultiplier(1), BOG_SPEED_MULTIPLIER);
  assert.equal(bogSpeedMultiplier(0), 1);
  assert.equal(bogNoiseMultiplier(1), BOG_NOISE_MULTIPLIER);
  assert.equal(bogNoiseMultiplier(0), 1);
});

test('bogSpeedMultiplier/bogNoiseMultiplier are linear in bogginess', () => {
  assert.equal(bogSpeedMultiplier(0.5), 1 - 0.5 * (1 - BOG_SPEED_MULTIPLIER));
  assert.equal(bogNoiseMultiplier(0.5), 1 + 0.5 * (BOG_NOISE_MULTIPLIER - 1));
});

test('pickHardBabyPosition lands in a bog patch, clear of the map edge', () => {
  const p = pickHardBabyPosition(seeded(1), 120, []);
  assert.ok(biomeAt(p.x, p.z) > 0, `(${p.x},${p.z}) should be boggy`);
  assert.ok(Math.abs(p.x) <= 100 && Math.abs(p.z) <= 100, `p=${JSON.stringify(p)} out of margin`);
});

test('pickHardBabyPosition is deterministic for a given seed', () => {
  const a = pickHardBabyPosition(seeded(42), 120, []);
  const b = pickHardBabyPosition(seeded(42), 120, []);
  assert.deepEqual(a, b);
});

test('pickHardBabyPosition avoids a landmark covering its whole reachable area, still terminates', () => {
  const landmarks: Landmark[] = [{ x: 22, z: 4, clear: 300 }]; // deliberately covers the whole square
  const p = pickHardBabyPosition(seeded(7), 120, landmarks, 6, 20, 5);
  assert.equal(typeof p.x, 'number');
  assert.equal(typeof p.z, 'number');
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
});
```

All numeric expectations above (`biomeAt(22,4) > 0.5`, `biomeAt(-95,46) > 0.5`, the dry
points) were computed by running this exact algorithm standalone before writing this spec
— they are not estimates. If your implementation doesn't match these constants exactly
(seed, cell, threshold, fade radii all as given above), the numbers will differ and these
tests are the signal, not the landmark coordinates below.

---

## `engine/tuning.js` — exact edits

### 1. Drop `bogDepth` (`:19` as of `6af26a5`)

Before: `  bogDepth: 120,         // LUL-25: the bog band appended past the forest's +z edge`

After: delete this line entirely.

### 2. Relocate two `LANDMARKS` entries (`:40-45` as of `6af26a5`)

Before:
```js
export const LANDMARKS = [
  { kind: 'fireTower',   x: -95, z: -95, clear: 12, cr: 1.6 },
  { kind: 'stoneMarker', x: 100, z: -75, clear: 9,  cr: 1.1 },
  { kind: 'oak',         x: -65, z: 135, clear: 10, cr: 1.3 },
  { kind: 'drownedCar',  x: 55,  z: 205, clear: 11, cr: 2.3 },
];
```
After (only `oak`/`drownedCar` coordinates change):
```js
export const LANDMARKS = [
  { kind: 'fireTower',   x: -95, z: -95, clear: 12, cr: 1.6 },
  { kind: 'stoneMarker', x: 100, z: -75, clear: 9,  cr: 1.1 },
  { kind: 'oak',         x: 22,  z: 4,   clear: 10, cr: 1.3 },
  { kind: 'drownedCar',  x: -95, z: 46,  clear: 11, cr: 2.3 },
];
```
`buildSplitOak()`/`buildDrownedCar()` and their `PointLight`s in `engine/forest-engine.js`
(`placeLandmarks()` positions the groups from this imported array at runtime) are untouched
— relocating the array entry is the entire fix; each light is a child of its group and moves
with it. Re-grep `function buildSplitOak\|function buildDrownedCar\|function placeLandmarks`
if you need the exact current lines; none of their bodies change.

---

## `lib/game/mission.ts` — exact edit (new, not in the earlier draft)

### `MISSION_POOL[0]` (`:18-22` as of `6af26a5`)

Before:
```ts
export const MISSION_POOL: readonly MissionTarget[] = [
  // Coordinates match LANDMARKS' drownedCar entry (engine/tuning.ts) --
  // do not hand-copy the numbers again if that entry ever moves; import LANDMARKS
  // in the engine call site instead (see S3).
  { kind: 'deepwater', x: 55, z: 205, zoneRadius: 20, interactRadius: 4 },
];
```
After:
```ts
export const MISSION_POOL: readonly MissionTarget[] = [
  // LUL-1483: coordinates match LANDMARKS' relocated drownedCar entry
  // (engine/tuning.ts) -- the old (55, 205) sat outside the new
  // [-120,120] square. Still a hand-copy, not an import (see the
  // pre-existing TODO above this line) -- fixing that structurally is out
  // of scope for this ticket; if it drifts again, the "lake and other
  // landmarks are not accidentally boggy" style test in bog.test.ts is not
  // where you'd catch it. Consider a follow-up ticket to make mission.ts
  // import LANDMARKS directly instead of re-stating its coordinates.
  { kind: 'deepwater', x: -95, z: 46, zoneRadius: 20, interactRadius: 4 },
];
```
No test in `lib/game/mission.test.ts` hardcodes `55`/`205` (verified) — no test changes needed
for this file.

---

## `engine/forest-engine.js` — exact edits

### 1. Import (`:69-75` as of `6af26a5`)

Before:
```js
import {
  isInBog,
  bogSpeedMultiplier,
  bogNoiseMultiplier,
  pickHardBabyPosition,
  clearOfLandmarks,
} from '@/lib/game/bog';
```
After:
```js
import {
  biomeAt,
  bogSpeedMultiplier,
  bogNoiseMultiplier,
  pickHardBabyPosition,
  clearOfLandmarks,
} from '@/lib/game/bog';
```
(`biomeAt` imported by its original export name keeps `scripts/check-duplicate-logic.mjs`
green under the existing wrapper-pattern rule — same as `hasLOS`/`findHideSpot`. No
allowlist entry needed.)

### 2. `zMax`/`inBog` block (`:186-190` as of `6af26a5`)

Before:
```js
// LUL-25: the world is a rectangle now, not a square -- `half` still bounds
// x symmetrically (and is the z coordinate the forest ends at), `zMax` is the
// new outer z edge, out past the bog. Every place that used to clamp z the
// same way it clamps x now clamps to [-half, zMax] instead of [-half, half].
const zMax = half + CONFIG.bogDepth;
function inBog(x, z){ return isInBog(z, { half, zMax }); }
```
After:
```js
// LUL-1483: the world is a square again -- x and z both bound to
// [-half, half]. `zMax` is kept, equal to `half`, purely so every existing
// `[-half+n, zMax-n]`-shaped clamp elsewhere in this file (backOffPoint,
// roam/reroute waypoints, the predator/player position clamps in
// updatePredators()/tick()) keeps compiling and behaving correctly without a
// site-by-site rename -- it is not a second world boundary, just an alias.
// inBog()/isInBog() are gone; biomeAt(x, z) (lib/game/bog.ts) replaces both.
const zMax = half;
```
Do **not** touch any of the other `zMax` occurrences in this file — re-grep `\bzMax\b` to get
the current list; they all become correct automatically once `zMax === half`.

### 3. `generateBogTrees()` (`:639-649` as of `6af26a5`)

Before:
```js
function generateBogTrees(){
  bogTreeData = [];
  let tries = 0;
  while(bogTreeData.length < BOG_TREES && tries < BOG_TREES*25){
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(half+margin, zMax-margin);
    if(nearLandmarks(x, z, 2)) continue;
    const s = 0.6 + rng()*1.3;   // thinner cover -- same scatter shape, smaller sizes than the forest
    bogTreeData.push({ x, z, s, cr: 0.35*s, crCanopy: canopyRadiusAtEye(s, CONFIG.eye, CANOPY_GEO) });
  }
  layoutTreePool(bogParts, bogTreeData, BOG_TREES);
}
```
After:
```js
function generateBogTrees(){
  bogTreeData = [];
  let tries = 0;
  // LUL-1483: was a direct scatter into the z-band (100% acceptance minus
  // nearLandmarks) -- now also rejects on biomeAt (~30% of the square is
  // boggy), so the try budget is raised to keep hitting BOG_TREES reliably.
  while(bogTreeData.length < BOG_TREES && tries < BOG_TREES*200){
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(-half+margin, half-margin);
    if(biomeAt(x, z) <= 0) continue;
    if(nearLandmarks(x, z, 2)) continue;
    const s = 0.6 + rng()*1.3;   // thinner cover -- same scatter shape, smaller sizes than the forest
    bogTreeData.push({ x, z, s, cr: 0.35*s, crCanopy: canopyRadiusAtEye(s, CONFIG.eye, CANOPY_GEO) });
  }
  layoutTreePool(bogParts, bogTreeData, BOG_TREES);
}
```

### 4. `generateReeds()` (`:655-665` as of `6af26a5`)

Before:
```js
function generateReeds(){
  let tries = 0, placed = 0;
  while(placed < COVER_PROPS && tries < COVER_PROPS*25){
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(half+4, zMax-4);
    if(nearLandmarks(x, z, 3)) continue;
    const r = 0.5 + rng()*0.4, h = 1.3 + rng()*0.9;
    coverData.push({ x, z, hx: r, hz: r, y: h*0.5, kind: 'reed', ry: rng()*Math.PI*2 });
    placed++;
  }
  buildCoverGrid();
}
```
After:
```js
function generateReeds(){
  let tries = 0, placed = 0;
  while(placed < COVER_PROPS && tries < COVER_PROPS*200){   // LUL-1483: same acceptance-rate drop as generateBogTrees()
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(-half+margin, half-margin);
    if(biomeAt(x, z) <= 0) continue;
    if(nearLandmarks(x, z, 3)) continue;
    const r = 0.5 + rng()*0.4, h = 1.3 + rng()*0.9;
    coverData.push({ x, z, hx: r, hz: r, y: h*0.5, kind: 'reed', ry: rng()*Math.PI*2 });
    placed++;
  }
  buildCoverGrid();
}
```

### 5. `applyHardBabySpawn()` (`:684-690` as of `6af26a5`)

Before:
```js
function applyHardBabySpawn(){
  const pos = babySpawnDifficulty === 'hard'
    ? pickHardBabyPosition(rng, { half, zMax }, half, LANDMARKS)
    : babyNormalSpawn;
  baby.x = pos.x; baby.z = pos.z;
  babyGroup.position.set(baby.x, 0, baby.z);
  placeBabyWisps();
}
```
After:
```js
function applyHardBabySpawn(){
  const pos = babySpawnDifficulty === 'hard'
    ? pickHardBabyPosition(rng, half, LANDMARKS)
    : babyNormalSpawn;
  baby.x = pos.x; baby.z = pos.z;
  babyGroup.position.set(baby.x, 0, baby.z);
  placeBabyWisps();
}
```

### 6. `qaProbeBaby` (`:2309` as of `6af26a5`)

Before:
```js
  window.ForestEngine.qaProbeBaby = function(){ return { x: baby.x, z: baby.z, inBog: inBog(baby.x, baby.z) }; };
```
After:
```js
  window.ForestEngine.qaProbeBaby = function(){ return { x: baby.x, z: baby.z, inBog: biomeAt(baby.x, baby.z) > 0 }; };
```
(No e2e spec reads this field today — `grep -rn "qaProbeBaby" e2e/` is empty — kept
boolean-shaped anyway for whatever future QA hook consumes it, minimal surprise.)

### 7. Player movement block (`:3289, :3304, :3332, :3563` as of `6af26a5`) — four sites, not three

The earlier draft only found three call sites. There is a fourth, further down in the same
function, gating footstep vs. splash SFX.

Before (`:3289`):
```js
  const playerInBog = inBog(player.x, player.z);   // LUL-25: shallow water -- half speed, louder splash
```
After:
```js
  const playerBogginess = biomeAt(player.x, player.z);   // LUL-1483: continuous 0..1, was a boolean z-band test
```

Before (`:3304` — note this line also calls `sprintSpeedMul(staminaCharge)`, added by a
different ticket after the earlier draft was written; only the bog term changes here):
```js
    const maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) * (carrying ? CONFIG.carryPaceMul : 1) * bogSpeedMultiplier(playerInBog) * lakeSpeedMultiplier(playerInLake);
```
After:
```js
    const maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) * (carrying ? CONFIG.carryPaceMul : 1) * bogSpeedMultiplier(playerBogginess) * lakeSpeedMultiplier(playerInLake);
```

Before (`:3332`):
```js
      noiseRadius = (running ? NOISE_RADIUS_RUN : NOISE_RADIUS_WALK) * bogNoiseMultiplier(playerInBog);
```
After:
```js
      noiseRadius = (running ? NOISE_RADIUS_RUN : NOISE_RADIUS_WALK) * bogNoiseMultiplier(playerBogginess);
```

Before (`:3563` — the fourth site, footstep/splash SFX selection):
```js
      if(playerInBog) splash(0.3); else footstep(0.12);   // LUL-25: same cadence, louder/wetter in the bog
```
After:
```js
      if(playerBogginess > 0) splash(0.3); else footstep(0.12);   // LUL-1483: continuous field, splash whenever standing in any bog
```

### 8. The predator terrain multiplier (`:1521`, inside `updatePredators()`)

This is the balance-critical part of the ticket. Every state branch (hunt/chase/
investigate-approach/investigate-back/flank-hold/flank-approach/reroute/charge/roam) funnels
into one shared `speed` variable that gets read exactly once, right here, to build velocity.
One edit at this single site covers all of them — including charge, which the wiki ticket's
old citations didn't separately call out but which should get the same treatment (an animal
mid-charge is still standing in the same mud).

Before:
```js
    if(speed > 0 && (desx || desz)) [desx, desz] = avoidDir(p, desx, desz);

    // smooth velocity + collide with trees (axis-separated slide)
    const dvx = desx*speed, dvz = desz*speed, accel = speed > 0 ? 3.6 : 6;
```
After:
```js
    if(speed > 0 && (desx || desz)) [desx, desz] = avoidDir(p, desx, desz);

    // LUL-1483: wading, same as the player -- applied once here rather than
    // at each state branch above, since every one of them (hunt/chase/
    // investigate/flank/reroute/charge) already funnels into this one
    // `speed` read. Was previously player-only (bogSpeedMultiplier at
    // player-movement's maxSpd, above); predators waded at full land speed.
    speed *= bogSpeedMultiplier(biomeAt(p.x, p.z));

    // smooth velocity + collide with trees (axis-separated slide)
    const dvx = desx*speed, dvz = desz*speed, accel = speed > 0 ? 3.6 : 6;
```

---

## What must NOT change

- **Do not grow the map.** `CONFIG.mapSize` stays `240`. Size-neutral, deliberately (E3's job).
- **Do not touch camera `far` or the star shell** (`stars.position.copy(camera.position)`,
  re-centres every frame) — both are player-relative, not world-size limits. "Fixing" them
  is a regression. Re-grep if you need exact current lines; neither changes in this ticket.
- **Do not add wrap math** (`wrapCoord`/`wrapDelta` etc.) — that is E4.
- **Do not add a band-wide bog visual treatment** (fog/ground/lighting keyed to entering a
  patch) beyond what falls out for free from the relocated landmarks and `reedMat`
  (untouched). That's its own ticket.
- **Do not touch `lib/game/pack.ts` (`flankTarget`, `FlankBounds`) or `lib/game/predator.ts`
  (`backOffPoint`)**. Both still take a `{half, zMax}`-shaped bounds object or `(half,
  zMax)` positionally; feeding them `zMax === half` (item 2 above) is sufficient and keeps
  this diff, and its review surface, to the files that actually need to change.
- **Do not rename `zMax`** to `half` at its call sites. It's now numerically identical to
  `half`; leaving the name alone is a smaller, lower-risk diff for a Tier C change and the
  comment at item 2 explains why the alias exists.
- **Do not touch the minimap (`w2m()`, `drawMinimapStatic()`)** — LUL-1093's clamp fix
  already makes it correct for a square world (`mmS = MM/CONFIG.mapSize` applies identically
  to both axes once z also spans `[-half,half]`); no further change needed or wanted here.
- **Do not restructure `lib/game/mission.ts`'s hand-copied-coordinate pattern** beyond fixing
  the one coordinate pair. The pre-existing TODO about importing `LANDMARKS` directly instead
  is real tech debt but out of scope for this ticket — flag it as a follow-up ticket in the
  PR body, don't fix it here.
- **Do not solve prop-vs-prop overlap** between bog trees/reeds and the pre-existing regular
  forest trees/cover. Before this ticket the two were spatially disjoint (different z ranges)
  so this collision class didn't exist; after folding the bog into the same square, a bog
  tree or reed can in principle land near/inside a regular tree's collision circle, since
  `generateCover()` (runs before `generateBogTrees()`) has no knowledge of where bog props
  will land afterward. This is a real gap the wiki ticket didn't anticipate — but it's a
  *cosmetic* risk (rare overlapping trunks, `blockedR()` handles the combined obstacle fine),
  not a P0/P1. File a P2 follow-up ticket if the relocated bog area reads as visually
  cluttered; do not expand this ticket's diff to pre-empt it.

## ELEMENTS.md

`docs/ELEMENTS.md`'s own scope note (top of file) already says the whole document is
several weeks stale in general — do not attempt a full re-audit, that's out of scope.
Touch only the **"Pending: the Bog (LUL-25, PR #58 — not yet on `main`)"** section (`:1166`
as of `6af26a5`): it describes `isInBog()`/the z-band, and its premise (PR #58 still open) is
itself already wrong independent of this ticket (`isInBog` is imported and live in
`engine/forest-engine.js` today). Replace that section's bog-mechanics description with
`biomeAt()`/the square-world semantics this ticket ships, and drop the "not yet on main"
framing for the bog mechanic specifically (leave the rest of the file's staleness alone —
not this ticket's job).

## Determinism

This reorders/changes the `mulberry32` draw count in `generateMap()`'s bog-tree, reed, and
hard-baby-spawn steps (all draw more candidates per accepted prop now that acceptance is
gated on `biomeAt` instead of "any point in the old bog rectangle"). **This is intentional
— declare it in the PR body**, same treatment as the LUL-491 precedent.

`grep -rln "QA_PINNED_SEED" e2e/*.spec.ts` returns only `e2e/map-seed.spec.ts`, and its three
assertions are about relative reproducibility ("same seed twice → same layout", "different
seed → different layout"), not hardcoded coordinates. There is nothing to re-pin. Run the
full suite; if any *other* spec turns out to hardcode a position or count tied to the old
draw order, fix that spec in the same PR (Tier A, ships on green, no extra review) rather
than treating it as a blocker.

## Mobile

No new input surface, no new player-facing control. The terrain multiplier and biome
placement are simulation-level and apply identically regardless of control scheme —
nothing to add for mobile parity on this ticket.

## Verification

- `node --test lib/game/bog.test.ts` (or `npm test`, which runs it) green, all cases above passing.
- `node scripts/check-duplicate-logic.mjs` clean (should be automatic — `biomeAt` is
  imported by its original name).
- `npx tsc --noEmit` clean.
- `npm run build` (or `next build`) passes.
- `npx eslint .` (the `lint` script) clean.
- Full Playwright suite green; investigate and fix (don't just re-run) any failure per the
  CI-guard caveat in `AGENTS.md` ("two guards that can fail 'unit tests' for reasons
  unrelated to your diff") and the Determinism section above.
- Manual/QA-hook sanity once built: `?seed=20260718&qaHooks=1`, then in console
  `ForestEngine.qaProbeBaby()` with `qaSetDifficulty('blackout')` set beforehand — `inBog`
  should read `true` and the reported `(x,z)` should be inside `[-120,120]` on both axes.
- **No Game Tester play verdict required this cycle** (QA suspended) — say so explicitly
  in the PR body per the founder's 2026-09-05 directive, don't imply it was tested.
  Founding Engineer/Game Engineer may assert code correctness only; gameplay feel
  (does crossing bog read as terrain, do predators still close distance in it) is
  unverified until QA is reactivated.

## Out of scope (explicitly, not just by omission)

- Map growth (E3, LUL-1484) — depends on this ticket, not the other way around.
- Wrap math (E4) — must not be started until E3 lands, per the wiki ticket's ordering.
- Fog Tide per-predator sampling (E5's D2) — unrelated to this ticket's biome work.
- A band-wide bog visual treatment (fog/ground/lighting) — its own future ticket.
- Prop-vs-prop overlap avoidance between bog and regular forest props (see "What must NOT
  change" above) — follow-up ticket if Game Tester (once reactivated) flags it as visually
  bad, not a blocker here.
- Making `lib/game/mission.ts` import `LANDMARKS` directly instead of hand-copying
  coordinates — real tech debt, flagged in the PR body as a follow-up, not fixed here.
- Any change to `lib/game/pack.ts`, `lib/game/predator.ts`, or their tests.
