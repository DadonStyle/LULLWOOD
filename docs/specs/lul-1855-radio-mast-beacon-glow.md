# SPEC — LUL-1855: fog-exempt beacon glow on the radio mast (cheap slice of LUL-1842)

Tier: **B** (`engine/forest-engine.js` render geometry/material + one
`engine/tuning.js` constant — no simulation/movement/collision/AI/scent/
hiding/detection/win-lose logic touched; `effectiveDetect()`, `canSee()`,
predator state, and economy are all untouched). Merge on green; open the Code
Reviewer child issue after merge, per the Tier B path.

Source: Feature Scout proposal, wiki `game/mechanics/landmarks-below-the-fog-line`
(LUL-1842) §7 "The cheap version"; CEO ruling `decisions/landmarks-below-fog-line-2026-09-07`
accepting **one landmark, one beacon** — the radio mast's red light only, not
all six. LUL-1856 (Player Psychologist, parallel, non-blocking) judges the
dread/orientation trade against what this ticket actually ships; it does not
gate this merge.

## The problem, in one line

`buildRadioMast()` (`engine/forest-engine.js:929-941`) lights its beacon with
a `THREE.PointLight(0xff2a2a, 0.5 * LEGACY_LIGHT_SCALE, 18, 2)` — an 18-unit
falloff cutoff — but `scene.fog` is `FogExp2` at `CONFIG.fog = 0.04`
(`engine/tuning.js:21`), which erases 95% of anything past ~43 units
regardless of how bright it is lit, because fog occlusion here is pure camera
distance, not light intensity. The radio mast sits at radius ~178
(`LANDMARKS`, `engine/tuning.js:60`) in a 480-unit map (`CONFIG.mapSize`,
`engine/tuning.js:18`) — a `PointLight` can never be seen from outside its own
cutoff in three.js (it has no visible source geometry), so today the beacon is
invisible from everywhere it would need to be visible from to matter.

## Design decision: a separate fog-exempt sprite, not `fog: false` on existing meshes

Do not add `fog: false` to `mastMat` or the existing `beacon` `PointLight`.
`mastMat` is shared by every mast/brace mesh — turning its fog off would
render the whole lattice at full unfogged brightness at 240 units, which is
exactly the "naive `fog:false`... crisp fully-lit mast floating in soup" the
proposal explicitly rules out (§2, §6). A `PointLight` has no `fog` property
at all (fog only ever affects rendered fragments of meshes/points/sprites) so
there is nothing to flip there either.

Instead, add one new, separate, unlit object at the same position as the
existing beacon light: a `THREE.Sprite` with an additive, radially-gradiented
texture, `fog: false`, low opacity, slow pulse. This is the same idiom
already used three times in this file for exactly this purpose — stars
(`:318`, `fog: false`), the moon disc/halo (`:323-325`, `fog: false`), and the
win burst (`:1061-1067`, `fog: false`, `AdditiveBlending`, `depthWrite:
false`) — extended to a fourth case. It does not touch, resize, recolor, or
add `fog:false` to the mast geometry or the existing `PointLight`, which stay
exactly as they render today up close.

A `Sprite` (not a `Mesh`) is used because it always faces the camera
(billboards), so the glow reads as a consistent round point from every
approach angle rather than a flat disc that vanishes edge-on.

## Files

- `engine/tuning.js` — add one new constant, `RADIO_MAST_BEACON_GLOW`
- `engine/forest-engine.js` — one new texture-builder function, edits inside
  `buildRadioMast()`, one new module-level binding, one new line in `tick()`
- `docs/ELEMENTS.md` — one sentence added to the existing landmark paragraph
  in the Bog section

No other file changes. No new npm dependency. No new HUD element, input
binding, or `EngineActions` entry (see Mobile parity below).

## The change

### 1. `engine/tuning.js:62` — new constant, inserted immediately after `LANDMARKS`

Current (`:55-63`):
```js
export const LANDMARKS = [
  { kind: 'fireTower',     x: -95, z: -95, clear: 12, cr: 1.6 },
  { kind: 'stoneMarker',   x: 100, z: -75, clear: 9,  cr: 1.1 },
  { kind: 'oak',           x: 22,  z: 4,   clear: 10, cr: 1.3 },
  { kind: 'drownedCar',    x: -95, z: 46,  clear: 11, cr: 2.3 },
  { kind: 'radioMast',     x: 30,  z: 175, clear: 10, cr: 1.0 },
  { kind: 'chapelSteeple', x: 20,  z: -178, clear: 11, cr: 1.8 },
];

// LUL-1808: roam waypoint step, ...
```
Insert between the closing `];` and the `LUL-1808` comment:
```js

// LUL-1855: fog-exempt beacon glow on the radio mast -- a small additive
// sprite, separate from the mast's existing PointLight (which FogExp2 erases
// by ~43 units at default density regardless of intensity -- see wiki
// game/mechanics/landmarks-below-the-fog-line). Deliberately dim: a bearing,
// not a light source -- the CEO-accepted cheap slice covers this one
// landmark only, not all six.
export const RADIO_MAST_BEACON_GLOW = {
  color: 0xff2a2a,     // same hue as the existing PointLight beacon, forest-engine.js buildRadioMast()
  scale: 1.4,           // sprite width/height in world units (billboard quad)
  opacityBase: 0.4,     // dim -- must not read as a lit scene
  opacityAmp: 0.15,      // pulse amplitude around opacityBase
  pulseHz: 0.5,          // slow pulse (~12.6s period) so it reads as a beacon, not a rendering glitch
};
```

### 2. `engine/forest-engine.js:148-154` — import the new constant

Current:
```js
import {
  CONFIG, LANDMARKS, LEGACY_LIGHT_SCALE, LIGHT_NORMAL, LIGHT_DIMMED, VEIL_RAMP,
  MIST_VEIL_FOG, VIGNETTE_NORMAL, VIGNETTE_DIMMED, CANOPY_R, CONE1_HEIGHT, CONE1_Y,
  STAR, LW, DUST, BW, BSP, BOG_TREES, COVER_PROPS, DUST_WIND_SPEED, WARM,
  BABY_LIGHT_DISTANCE, PSPEC as PSPEC_BASE, CHASE_GAP, DIFFICULTY_PRESETS,
  CHARGE_COOLDOWN, SENS, SCALE, PLAYER_FOV_COS, CUT_END,
} from '@/engine/tuning';
```
Add `RADIO_MAST_BEACON_GLOW` to the list (any line in the block; appending to
the last line keeps the diff smallest):
```js
  CHARGE_COOLDOWN, SENS, SCALE, PLAYER_FOV_COS, CUT_END, RADIO_MAST_BEACON_GLOW,
```

### 3. `engine/forest-engine.js:929` — insert a texture-builder function immediately before `buildRadioMast()`

```js
// LUL-1855: soft radial-gradient canvas texture for the radio mast's
// fog-exempt beacon glow (see buildRadioMast() below) -- same canvas-texture
// idiom already used for the sky gradient above (:306-312), applied to a
// small square instead, so the sprite reads as a soft point of light rather
// than a hard-edged disc.
function buildBeaconGlowTexture(hex){
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const col = '#' + hex.toString(16).padStart(6, '0');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, col); grd.addColorStop(0.4, col); grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
```

### 4. `engine/forest-engine.js:929-941` — edit `buildRadioMast()` and add a module-level binding

Current:
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
```
Change to:
```js
let radioMastBeaconGlow = null;   // LUL-1855: sprite ref for tick()'s pulse, set once below
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
  // LUL-1855: fog-exempt beacon glow -- the PointLight above only lights
  // surfaces within its 18-unit cutoff, which FogExp2 erases by ~43 units
  // anyway (wiki game/mechanics/landmarks-below-the-fog-line). This sprite is
  // a separate, unlit, fog:false marker so the beacon stays visible past the
  // fog line as a bearing, not a lit scene -- same idiom as stars/moon
  // (:318, :323-325) and the win burst (:1061-1067).
  radioMastBeaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: buildBeaconGlowTexture(RADIO_MAST_BEACON_GLOW.color),
    transparent: true, opacity: RADIO_MAST_BEACON_GLOW.opacityBase,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  radioMastBeaconGlow.position.set(0, 11.2, 0);
  radioMastBeaconGlow.scale.set(RADIO_MAST_BEACON_GLOW.scale, RADIO_MAST_BEACON_GLOW.scale, 1);
  g.add(radioMastBeaconGlow);
  g.rotation.z = 0.05;   // slight lean
  return g;
}
```
`radioMastBeaconGlow` is declared once at module scope (same pattern as
`ring`/`homeRing` at `:849`/`:863`, which `tick()` already mutates directly by
name) and assigned the one time `buildRadioMast()` runs — it is called exactly
once, at module load, to build `landmarkGroups.radioMast`
(`engine/forest-engine.js:954-961`); it is not called again per map
regeneration.

### 5. `engine/forest-engine.js:3922-3923` — pulse it in `tick()`

Current:
```js
  // home landmark breathes, gently (LUL-38)
  homeRing.material.opacity = 0.16 + Math.sin(t*0.9)*0.06;
```
Insert immediately after that line (before the blank line that precedes "pool
breathes"):
```js

  // LUL-1855: radio mast beacon glow pulses slowly, reads as a beacon not a glitch
  radioMastBeaconGlow.material.opacity = RADIO_MAST_BEACON_GLOW.opacityBase
    + Math.sin(t * RADIO_MAST_BEACON_GLOW.pulseHz) * RADIO_MAST_BEACON_GLOW.opacityAmp;
```
`t` (`clock.elapsedTime`) is already destructured at the top of `tick()`
(`:3546`) and used by the adjacent `homeRing`/`ring` lines the same way — no
new variable needed.

### 6. `docs/ELEMENTS.md` — landmark paragraph in the Bog section

Find this sentence (the one `LUL-1782` added, currently reads):
```
`radioMast` and `chapelSteeple` (LUL-1782) sit in the outer ring, radius
~178-179, restoring fixed orientation geography on the leg past the original
four that LUL-1484's map growth left featureless.
```
Add one sentence immediately after it, same paragraph:
```
As of LUL-1855, `radioMast` additionally carries a small fog-exempt additive
sprite on its beacon (`RADIO_MAST_BEACON_GLOW`, `engine/tuning.js`) so it
stays visible as a dim, slowly-pulsing point past the fog line that erases
the other five -- a bearing, not a lit scene; the other five landmarks are
unchanged and still fog-occluded at the same distances documented above.
```
Do not touch anything else in this paragraph or the Fog section (`:702` in
this checkout) — this ticket does not change `CONFIG.fog`, the mist slider,
or `TIME_OF_RUN_FOG_DELTA`, so neither section's existing density/range
numbers need editing. Re-derive the exact current line number before editing
(this file shifts often); do not assume `:702`/`:1340` still hold without
checking, per `scripts/check-elements-citations.mjs`'s own citation contract.

## Mobile parity

Pure world geometry — no new input, verb, or HUD element, nothing to route
through `EngineActions`/`Hud.tsx`. The sprite renders through the same
Three.js scene graph on both desktop and mobile viewports, at the same
world position, with no separate mobile code path. State this explicitly in
the PR body per the standing mobile-parity rule.

## Determinism

`buildRadioMast()` draws no `rng()` — this diff adds a `Sprite`/`CanvasTexture`
construction and one constant read, neither of which touches the map's seeded
rng stream. No reseed, no `QA_PINNED_SEED` change, no `e2e/map-seed.spec.ts`
update needed or expected.

## Constraints — must not change

- `mastMat`, the mast/brace meshes, or the existing `beacon` `PointLight` —
  none get `fog: false` or any other edit. Up-close appearance of the radio
  mast must be pixel-identical to today.
- The other five `build*()` functions (`buildFireTower`, `buildStoneMarker`,
  `buildDrownedCar`, `buildSplitOak`, `buildChapelSteeple`) — untouched. This
  is the one-object cheap slice; do not extend the treatment to any other
  landmark in this diff.
- `CONFIG.fog`, `MIST_VEIL_FOG`, `TIME_OF_RUN_FOG_DELTA`, the mist slider
  range, `FOG_TIDE_CONFIG` — none of these change.
- `LANDMARKS`, `placeLandmarks()`, `clearLandmarkSpot()`, `landmarkData`'s
  shape — untouched; this diff adds a render-only sprite parented inside the
  existing `radioMast` group, not a new landmark entry.
- `effectiveDetect()`, `canSee()`, predator state, scent, economy — none
  referenced or touched by this diff; confirm with a post-diff grep for
  `radioMastBeaconGlow`/`RADIO_MAST_BEACON_GLOW` outside `tuning.js` and the
  two `forest-engine.js` sites named above (should return nothing else).

## Out of scope

- The other five landmarks getting the same treatment — gated on LUL-1856
  (Player Psychologist dread-cost read of this ticket's actual shipped
  result), not part of this ticket.
- Any change to fog density, the mist slider, or the Fog Tide.
- A minimap change — the minimap already draws `radioMast` from
  `landmarkData` unchanged; this ticket doesn't touch minimap rendering.
- Tuning the exact `scale`/`opacityBase`/`pulseHz` numbers beyond a
  defensible starting point — see Verification below; these are named as a
  single exported object specifically so a follow-up feel pass (or LUL-1856's
  verdict) can retune them without another spec.

## Verification

- `npx tsc --noEmit` clean.
- `npx eslint .` clean.
- `node scripts/check-elements-citations.mjs` — run this and read its output;
  if it flags the one `docs/ELEMENTS.md` sentence touched here (or any other
  citation whose line number this diff shifted), run
  `node scripts/check-elements-citations.mjs --fix` first, then hand-fix
  anything it refuses (single-line citations with no length proof) before
  treating a red run as a real regression — see the CI-guards note in
  `AGENTS.md`.
- `node scripts/check-duplicate-logic.mjs` clean — `buildBeaconGlowTexture` is
  a new top-level `engine/forest-engine.js` declaration; confirm with
  `grep -rn "buildBeaconGlowTexture\|radioMastBeaconGlow" lib/game` that
  neither name collides with any `lib/game/*.ts` export (expected: no output).
- `npm test` green — no `lib/game/**` file touched by this spec, so no unit
  test change expected; if any fail, stop and report rather than reconcile.
- `next build` passes.
- No console errors on load (tester-confirmed separately — gameplay/visual
  verification is out of scope for this spec's author; state "builds clean,
  gameplay unverified" in the PR body per the standing rule).
- **Visual verification (requires a browser; do it if one is available, state
  plainly in the PR body if it is not):**
  1. Run the dev server, load the game, start a run (default fog density,
     `CONFIG.fog = 0.04`).
  2. Open the browser devtools console and run
     `ForestEngine.qaTeleportForRadioMastView` if you add it (see note below)
     — or simply walk/run toward bearing `(30, 175)` from spawn `(0, 0)` for
     ~20-30 seconds (sprint covers ~200 units in well under a minute at
     `CONFIG.walk * STAMINA_SPRINT_MUL`).
  3. From at least 200 units out (well past the ~43-unit 95%-fog point at
     default density), confirm: a small, dim, slowly-pulsing red point is
     visible over the treeline at the mast's bearing; it does not resolve
     into mast structure, brace detail, or illuminate any surrounding
     geometry (no safety/detail information leaks through — only a bearing).
  4. Walk up to the mast and confirm the up-close appearance (lattice, braces,
     `PointLight` glow on nearby ground/trees) is unchanged from before this
     diff.
  5. If the sprite reads as too bright/too large/not beacon-like, retune
     `RADIO_MAST_BEACON_GLOW` in `engine/tuning.js` only — do not touch the
     texture-builder or sprite-construction code to compensate for a numbers
     problem.
  - Optional, not required to ship: a `qaTeleportForRadioMastView(dist)` QA
    hook (same pattern as the existing `qaTeleportNearBaby`/`qaTeleportHome`
    at `engine/forest-engine.js:2529`/`:2535`) would make step 2 scriptable
    for whoever does this visual pass next; add it only if convenient, it is
    not part of this ticket's required diff.
