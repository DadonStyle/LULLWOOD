# SPEC — LUL-1782: two outer-ring landmarks (the cheap version)

Tier: **B** (`engine/tuning.js` tuning-constant data + `engine/forest-engine.js`
geometry/silhouette builders — no simulation/movement/collision/AI/scent/hiding/
detection/win-lose logic touched). Merge on green; open the Code Reviewer child
issue after merge, per the Tier B path. `[ship]` is allowed once CI is green,
same-branch, since this diff also touches `engine/`.

Source: Feature Scout proposal, wiki `game/mechanics/outer-ring-landmarks`; CEO
acceptance comment on this issue (LUL-1782, 2026-09-06) approving the cheap
version — two new landmark kinds, no `landmarkGroups` refactor. Do not build the
floor version, the full version, or the refactor; those are named alternatives
the CEO did not pick.

## The problem, in one line

LUL-1484/PR #395 grew the map 240→480 and scaled every populated *density*
constant ×4, but never touched `LANDMARKS` (`engine/tuning.js:39-44`) or the
child's spawn radius math. The child now spawns at radius 120–192
(`engine/forest-engine.js:730`), at or beyond the outermost existing landmark
(`fireTower` at radius 134), so the entire carry-home leg has zero fixed
orientation geography.

## Design decision: option (a), new `buildX()` silhouettes — not option (b)

The proposal's "Scope honesty" section flagged a real structural question:
`placeLandmarks()` (`engine/forest-engine.js:884-891`) does
`landmarkGroups[l.kind].position.x = x` — one Three.js group **per `kind`**, so
two `LANDMARKS` entries sharing a `kind` would move the same mesh twice instead
of drawing two.

That is not a problem here, and does not require the `landmarkGroups`-per-entry
refactor (option (b)): this ticket adds two landmarks with two **new, unique**
`kind` strings (`radioMast`, `chapelSteeple`). The existing kind-keyed dict
already handles any number of entries as long as each has a distinct `kind` —
confirmed by reading `placeLandmarks()`, `landmarkData`/`landmarkGroups`, and
every consumer of `LANDMARKS` (`nearLandmarks()` at `:632-633`,
`clearOfLandmarks()` in `lib/game/bog.ts:119-121`, `pickHardBabyPosition()` in
`lib/game/bog.ts:133-150`, `drawMinimapStatic()` at `:3199`): all of them
iterate the `LANDMARKS`/`landmarkData` **array** generically by value, none of
them special-case a specific `kind` or assume there are exactly four. So this
ships as option (a) with **zero changes** to `placeLandmarks()`,
`clearLandmarkSpot()`, `landmarkData`, `nearLandmarks()`, `w2m()`, or
`drawMinimapStatic()` — every one of those already works correctly the moment
two new rows exist in `LANDMARKS` and two new groups exist in `landmarkGroups`.

Do not implement option (b) (per-entry `landmarkGroups`) in this ticket. It adds
complexity this ticket does not need and was the CEO's explicitly-not-picked
alternative.

## Files

- `engine/tuning.js` — add two rows to `LANDMARKS`, update one comment
- `engine/forest-engine.js` — add two `buildX()` functions, two `landmarkGroups`
  entries, update one comment
- `docs/ELEMENTS.md` — update the landmark count/list in the Bog section

No other file changes. No new npm dependency.

## The change

### 1. `engine/tuning.js:39-44` — two new `LANDMARKS` rows

Current (`:32-44`):
```js
// LUL-25: four fixed navigational landmarks, "visible over the fog line" so
// the player can orient without the minimap (which stays scaled to the
// original 240x240 forest -- see w2m()/drawMinimap() in forest-engine.js).
// Fixed constants, not an rng draw, same treatment as CONFIG.lake/CONFIG.home.
// `cr` is the movement-collision radius (LUL-374) -- deliberately much
// smaller than `clear` (which only keeps trees/cover from generating too
// close to the landmark's nudge target).
export const LANDMARKS = [
  { kind: 'fireTower',   x: -95, z: -95, clear: 12, cr: 1.6 },
  { kind: 'stoneMarker', x: 100, z: -75, clear: 9,  cr: 1.1 },
  { kind: 'oak',         x: 22,  z: 4,   clear: 10, cr: 1.3 },
  { kind: 'drownedCar',  x: -95, z: 46,  clear: 11, cr: 2.3 },
];
```
Change to:
```js
// LUL-25: six fixed navigational landmarks, "visible over the fog line" so
// the player can orient without the minimap (which stays scaled to the
// original 240x240 forest -- see w2m()/drawMinimap() in forest-engine.js).
// Fixed constants, not an rng draw, same treatment as CONFIG.lake/CONFIG.home.
// `cr` is the movement-collision radius (LUL-374) -- deliberately much
// smaller than `clear` (which only keeps trees/cover from generating too
// close to the landmark's nudge target).
// LUL-1782: radioMast/chapelSteeple added when the map grew to 480x480
// (LUL-1484) left everything past radius ~134 without a landmark, and the
// child now spawns at radius 120-192 -- beyond the original four entirely.
// Placed at radius ~178-179, in the two widest angular gaps between the
// original four (the empty arc through `oak` at ~10 deg, and the empty arc
// between `fireTower` at 225 deg and `stoneMarker` at 323 deg).
export const LANDMARKS = [
  { kind: 'fireTower',     x: -95, z: -95, clear: 12, cr: 1.6 },
  { kind: 'stoneMarker',   x: 100, z: -75, clear: 9,  cr: 1.1 },
  { kind: 'oak',           x: 22,  z: 4,   clear: 10, cr: 1.3 },
  { kind: 'drownedCar',    x: -95, z: 46,  clear: 11, cr: 2.3 },
  { kind: 'radioMast',     x: 30,  z: 175, clear: 10, cr: 1.0 },
  { kind: 'chapelSteeple', x: 20,  z: -178, clear: 11, cr: 1.8 },
];
```
Do not change the four existing rows' values, order, or the object shape (`kind`/
`x`/`z`/`clear`/`cr`) — only append the two new rows and touch the comment above.

### 2. `engine/forest-engine.js:198-205` — update the sibling comment's count

This is a second, independent comment block (not the one in `tuning.js`) that
also states the count. Current opening line:
```js
// LUL-25: four fixed navigational landmarks, "visible over the fog line" so
```
Change only this line to:
```js
// LUL-25: six fixed navigational landmarks (two added by LUL-1782), "visible
// over the fog line" so
```
Leave the rest of that comment block (`:199-205`, the "two sit in the forest,
two mark the bog" sentence and everything after) untouched — it describes the
original four's forest/bog split, which this ticket does not change or extend;
rewriting it further is out of scope.

### 3. `engine/forest-engine.js:848` — insert two new builder functions after `buildSplitOak()`

`buildSplitOak()` currently ends at `:862` (its closing `}`), immediately before
the `const landmarkGroups = {` block at `:863`. Insert these two new functions
between them, following the exact same recipe as the existing four (a
`THREE.Group`, low-poly `THREE.Mesh` children, one `THREE.PointLight` sized with
`LEGACY_LIGHT_SCALE`, `return g`) — both already in scope in this file, no new
import needed:

```js
function buildRadioMast(){
  const g = new THREE.Group();
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.8, metalness: 0.4 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 11, 5), mastMat);
  mast.position.y = 5.5; g.add(mast);
  for(const y of [3, 6, 9]){
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 4), mastMat);
    brace.position.y = y; brace.rotation.z = Math.PI/2; g.add(brace);
  }
  const beacon = new THREE.PointLight(0xff2a2a, 0.5 * LEGACY_LIGHT_SCALE, 18, 2);
  beacon.position.set(0, 11.2, 0); g.add(beacon);
  g.rotation.z = 0.05;   // slight lean
  return g;
}
function buildChapelSteeple(){
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3d3831, roughness: 0.95 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.4, 2.4), stoneMat);
  base.position.y = 1.7; g.add(base);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 3.2, 4), stoneMat);
  roof.position.y = 5.0; roof.rotation.y = Math.PI/4; g.add(roof);
  const glow = new THREE.PointLight(0xd8c9a0, 0.45 * LEGACY_LIGHT_SCALE, 15, 2);
  glow.position.set(0, 3.2, 0); g.add(glow);
  return g;
}
```
Silhouettes are deliberately distinct from all four existing ones (thin
vertical lattice vs. `fireTower`'s boxy four-leg platform, `stoneMarker`'s
single obelisk, `oak`'s forked trunk, `drownedCar`'s low boxy hull) — this is
the whole point of picking option (a): distinguishable at silhouette distance,
per the proposal's prior-art citation.

### 4. `engine/forest-engine.js:863-869` — two new `landmarkGroups` entries

Current:
```js
const landmarkGroups = {
  fireTower: buildFireTower(),
  stoneMarker: buildStoneMarker(),
  drownedCar: buildDrownedCar(),
  oak: buildSplitOak(),
};
Object.values(landmarkGroups).forEach(g => scene.add(g));
```
Change to:
```js
const landmarkGroups = {
  fireTower: buildFireTower(),
  stoneMarker: buildStoneMarker(),
  drownedCar: buildDrownedCar(),
  oak: buildSplitOak(),
  radioMast: buildRadioMast(),
  chapelSteeple: buildChapelSteeple(),
};
Object.values(landmarkGroups).forEach(g => scene.add(g));
```
Key order does not matter (nothing iterates this object relying on order — the
one iteration, `Object.values(...).forEach`, only adds each group to the
scene). Do not touch `placeLandmarks()` (`:884-892`) — it already loops
`LANDMARKS` generically and needs no edit once these two keys exist.

### 5. `docs/ELEMENTS.md` — update the landmark count in the Bog section

Find this sentence (currently reads, across two lines):
```
but **not** in `HIDE_KINDS` — not a hiding spot), four fixed `Landmark`
groups (fire tower, stone marker, drowned car, lightning-split oak — static,
```
Change to:
```
but **not** in `HIDE_KINDS` — not a hiding spot), six fixed `Landmark`
groups (fire tower, stone marker, drowned car, lightning-split oak, radio
mast, chapel steeple — static,
```
And immediately after the existing `...to sit inside an actual bog patch now
that the bog is no longer a fixed band)` clause (still the same paragraph),
add one sentence:
```
`radioMast` and `chapelSteeple` (LUL-1782) sit in the outer ring, radius
~178-179, restoring fixed orientation geography on the leg past the original
four that LUL-1484's map growth left featureless.
```
Do not touch anything else in this paragraph or section — in particular, do
not attempt to fix the pre-existing stale `drownedCar` coordinate citation at
`docs/ELEMENTS.md:971` (`x: 55, z: 205`, which does not match the real
`x: -95, z: 46` in either the current or the pre-this-ticket `tuning.js`). That
citation was already wrong before this ticket touched the file — it is
existing debt covered by the citation-checker's baseline
(`scripts/elements-citations-baseline.json`), not something this diff
introduces or is responsible for. If you want it fixed, file a P3 ticket; do
not fix it in this diff.

## Mobile parity

Pure world geometry, no new input, verb, or HUD element — nothing to route
through `EngineActions`/`Hud.tsx`. The two new landmarks render at the same
distance and through the same fog/lighting path as the existing four on both
desktop and mobile viewports; there is no separate mobile surface for this
ticket. State this explicitly in the PR body (per the standing mobile-parity
rule) rather than leaving it unsaid.

## Determinism

`placeLandmarks()` and `clearLandmarkSpot()` never call `rng()` (confirmed by
reading both — the only randomness-adjacent thing either does is nudge a fixed
`(x,z)` a few units away from that seed's already-placed trees/cover, which is
pure geometry over already-drawn arrays). Appending two static rows to
`LANDMARKS` cannot add, remove, or reorder any `rng()` draw anywhere in
`generateMap()`. No reseed, no `QA_PINNED_SEED` change, no `e2e/map-seed.spec.ts`
update needed or expected.

## Constraints — must not change

- The four existing `LANDMARKS` rows' values, order, or shape.
- `placeLandmarks()`, `clearLandmarkSpot()`, `landmarkData`'s shape (`{x,z,cr}`),
  `nearLandmarks()`, `clearOfLandmarks()`, `pickHardBabyPosition()`, `w2m()`,
  `drawMinimapStatic()` — all already generic over `LANDMARKS`/`landmarkData`,
  none need an edit.
- No change to `CONFIG.trees`/`BOG_TREES`/`COVER_PROPS` or any other density
  constant — this ticket is geography only, per the proposal's own "What I am
  NOT proposing" section.
- No change to the child's spawn radius math (`engine/forest-engine.js:730`).
- `landmarkGroups` stays kind-keyed (option (a), not option (b)/the refactor).

## Out of scope

- The `landmarkGroups`-per-entry refactor (option (b)).
- The floor version (one landmark opposite the fire tower) — superseded by
  shipping the cheap version instead.
- The full version (4-6 landmarks + refactor) — not what the CEO accepted.
- Any Game Economist discovery/pay mechanic for these landmarks.
- Waypoint encounters (LUL-1622) — separate, already-approved mechanic these
  landmarks are geography for, not encounters themselves.
- Fixing the pre-existing stale citation at `docs/ELEMENTS.md:971` (see §5
  above).

## Verification

- `npx tsc --noEmit` clean.
- `npx eslint .` clean.
- `node scripts/check-elements-citations.mjs` clean (no new `L<n>` citation
  introduced by this diff — the one `docs/ELEMENTS.md` sentence touched here
  has no line-number citation in it, so this should be unaffected either way).
- `node scripts/check-duplicate-logic.mjs` clean — `buildRadioMast`/
  `buildChapelSteeple` are new top-level `engine/forest-engine.js` declarations;
  confirm neither name collides with any `lib/game/*.ts` export (a quick
  `grep -rn "buildRadioMast\|buildChapelSteeple" lib/game` should return
  nothing).
- `npm test` green — no `lib/game/**` file touched by this spec, so no unit
  test change expected; if any fail, stop and report rather than reconcile.
- `next build` passes.
- No console errors on load (tester-confirmed separately — gameplay/visual
  verification is out of scope for this spec's author; state "builds clean,
  gameplay unverified" in the PR body per the standing rule).
- Manual/optional sanity if a browser is available: walk toward
  `(30, 175)` or `(20, -178)` on a fresh map and confirm a new silhouette
  becomes visible before the minimap would otherwise be the only cue, and that
  both new dots appear on the minimap (`drawMinimapStatic()` already iterates
  `landmarkData` generically, so this should need no code change to work).
