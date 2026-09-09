# SPEC: LUL-2248 landmark beacons + minimap home

**Ticket:** LUL-2248 (rollout step 4/6 of parent epic LUL-2223) · **Tier:** B — spans
`engine/tuning.js`, `engine/forest-engine.js` build functions, and the minimap draw
function; changes player-visible behaviour. Needs green CI + the e2e below before merge,
not a Tier C blocking review.

**Written against:** `release/next` @ `81fc1b9e` (2026-09-09). The ticket's own citations
were against `main` @ `4d7f1c9` and had drifted — re-derived every `file:line` below
directly from this SHA. Re-derive again if it has moved further by the time this is
implemented.

## Files

- `engine/tuning.js` — edit `RADIO_MAST_BEACON_GLOW`, add `LANDMARK_BEACONS`
- `engine/forest-engine.js` — edit five `buildX()` landmark functions, `drawMinimapStatic()`,
  the beacon pulse tick, add one `qaProbe*` hook
- `engine/forest-engine.d.ts` — declare the new hook
- `e2e/landmark-beacons.spec.ts` — new
- `e2e/minimap.spec.ts` — extended
- `e2e/mobile/minimap.spec.ts` — new (no existing mobile minimap spec today)

## The change

### 1. `engine/tuning.js:97-105` — generalise `RADIO_MAST_BEACON_GLOW` into `LANDMARK_BEACONS`

Current:
```js
export const RADIO_MAST_BEACON_GLOW = {
  color: 0xff2a2a,     // same hue as the existing PointLight beacon, forest-engine.js buildRadioMast()
  scale: 1.4,           // sprite width/height in world units (billboard quad)
  opacityBase: 0.4,     // dim -- must not read as a lit scene
  opacityAmp: 0.15,      // pulse amplitude around opacityBase
  pulseHz: 0.5,          // slow pulse (~12.6s period) so it reads as a beacon, not a rendering glitch
};
```
Replace with one entry per `LANDMARKS[].kind` (`engine/tuning.js:57-64`: `fireTower`,
`stoneMarker`, `oak`, `drownedCar`, `radioMast`, `chapelSteeple`), same shape, same
`scale`/`opacityBase`/`opacityAmp`/`pulseHz` for every entry (only `color` varies — this
must read as a bearing, not a lit scene, so don't invent per-kind intensity or scale) and
a **distinct hue** per kind so a beacon on the minimap or skyline maps unambiguously to a
landmark kind:

```js
export const LANDMARK_BEACONS = {
  fireTower:     { color: 0xff9a3a, scale: 1.4, opacityBase: 0.4, opacityAmp: 0.15, pulseHz: 0.5 },
  stoneMarker:   { color: 0x8fd1ff, scale: 1.4, opacityBase: 0.4, opacityAmp: 0.15, pulseHz: 0.5 },
  oak:           { color: 0x7ee08a, scale: 1.4, opacityBase: 0.4, opacityAmp: 0.15, pulseHz: 0.5 },
  drownedCar:    { color: 0xc9a6ff, scale: 1.4, opacityBase: 0.4, opacityAmp: 0.15, pulseHz: 0.5 },
  radioMast:     { color: 0xff2a2a, scale: 1.4, opacityBase: 0.4, opacityAmp: 0.15, pulseHz: 0.5 },
  chapelSteeple: { color: 0xffe066, scale: 1.4, opacityBase: 0.4, opacityAmp: 0.15, pulseHz: 0.5 },
};
```
`radioMast` keeps its exact existing hue (`0xff2a2a`) — that beacon already shipped
(LUL-1855) and is not changing. Keep the file's existing import/export list in
`forest-engine.js:184` in sync (swap `RADIO_MAST_BEACON_GLOW` for `LANDMARK_BEACONS`).

### 2. `engine/forest-engine.js:1233-1242` — `buildBeaconGlowTexture(hex)` is already generic, reuse as-is

No change needed here. It already takes a `hex` colour argument and returns a
`THREE.CanvasTexture` — confirmed by reading it; this is the one piece of the LUL-1855
idiom that was already written for reuse.

### 3. `engine/forest-engine.js:1175-1297` — attach a beacon sprite in each `buildX()`

`buildRadioMast()` (`:1244-1269`) is the exact idiom to copy into the other five
functions — `buildFireTower()` (`:1175`), `buildStoneMarker()` (`:1191`),
`buildDrownedCar()` (`:1201`), `buildSplitOak()` (`:1213`), `buildChapelSteeple()`
(`:1272`). For each: after the function's existing mesh/group construction, before its
`return g;`, add:

```js
const <kind>BeaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: buildBeaconGlowTexture(LANDMARK_BEACONS.<kind>.color),
  transparent: true, opacity: LANDMARK_BEACONS.<kind>.opacityBase,
  blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
}));
<kind>BeaconGlow.position.set(0, <silhouette top Y for that landmark>, 0);
<kind>BeaconGlow.scale.set(LANDMARK_BEACONS.<kind>.scale, LANDMARK_BEACONS.<kind>.scale, 1);
g.add(<kind>BeaconGlow);
```
Read each function's own geometry to pick `<silhouette top Y>` (e.g. `buildRadioMast`
uses `11.2`, matching its mast height) — do not reuse `radioMast`'s `11.2` for the other
four; each landmark has a different height. Declare each `<kind>BeaconGlow` the same way
`radioMastBeaconGlow` is declared today (`engine/forest-engine.js:1243`, a
module-scope `let` above the function, so the pulse tick below can reach it) — rename
that one variable's declaration alongside the other five for consistency, or keep an
object map (`landmarkBeaconGlows.radioMast`, etc.) — either is fine as long as the tick
step below can iterate all six without hardcoding six variable names.

### 4. `engine/forest-engine.js:5338-5339` — generalise the pulse tick

Current (inside the per-frame tick function):
```js
radioMastBeaconGlow.material.opacity = RADIO_MAST_BEACON_GLOW.opacityBase
  + Math.sin(t * RADIO_MAST_BEACON_GLOW.pulseHz) * RADIO_MAST_BEACON_GLOW.opacityAmp;
```
Replace with a loop over all six sprites (using whichever storage shape §3 picked) driving
each by its own `LANDMARK_BEACONS[kind]` entry. Same `t`, same formula, just six sprites
instead of one.

### 5. `engine/forest-engine.js:4697-4718` (`drawMinimapStatic()`) — colour landmarks by kind, draw home, cut tree stride

Current relevant lines:
```js
sx.fillStyle = 'rgba(120,150,120,0.5)';
for(let i=0;i<treeData.length;i+=4){ const [px,py] = w2m(treeData[i].x, treeData[i].z); sx.fillRect(px, py, 1.2, 1.2); }
...
for(const l of landmarkData){ const [px,py] = w2m(l.x, l.z); sx.fillRect(px-1.5, py-1.5, 3, 3); }
```
Three edits:
- Tree-dot stride: `i+=4` → `i+=12` (ticket's explicit number, for the 480u map —
  `landmarkData`'s own loop stride is unaffected, still every entry).
- `landmarkData` (`engine/forest-engine.js:544-545`) is currently `{x,z,cr}` — it has no
  `kind` field. Add `kind: l.kind` to the push in `placeLandmarks()`
  (`engine/forest-engine.js:1318-1325`: `landmarkData.push({ x, z, cr: l.cr })` →
  `landmarkData.push({ x, z, cr: l.cr, kind: l.kind })`, using the `l` from
  `for(const l of LANDMARKS)` which already carries `.kind`). Then in
  `drawMinimapStatic()`'s landmark loop, set `sx.fillStyle` per-entry from
  `LANDMARK_BEACONS[l.kind].color` (convert the numeric hex to a CSS colour string the
  same way `buildBeaconGlowTexture` does: `'#' + LANDMARK_BEACONS[l.kind].color.toString(16).padStart(6,'0')`)
  before each `fillRect` call, instead of inheriting the tree loop's leftover fill style.
- Add a home ring after the existing lake/bog circles: `CONFIG.home` is
  `{ x: 0, z: 0, r: 3.6, glow: 0xffd9b0 }` (`engine/tuning.js:40`). Draw a 4px ring (stroke,
  not fill, so it reads distinctly from the filled lake/bog discs) at
  `w2m(CONFIG.home.x, CONFIG.home.z)`, colour `'#' + CONFIG.home.glow.toString(16).padStart(6,'0')`,
  radius scaled the same way the lake circle is (`CONFIG.lake.r * mmS` — use a small fixed
  minimap radius like `4` since `CONFIG.home.r` is a gameplay proximity radius, not a
  visual size, and 3.6 world units would draw a near-invisible dot at minimap scale).
- Do **not** add the child or predators to the minimap — blackout
  (`engine/tuning.js:209`, `DIFFICULTY_PRESETS`) still hides the whole canvas at that
  preset, and the child's position is the puzzle. Out of scope for this ticket regardless
  of preset.

### 6. `engine/forest-engine.js:3314` (inside the `?qaHooks` block) — new hook

After the existing `qaProbeMinimapPoint` line, add:
```js
window.ForestEngine.qaProbeLandmarkBeacons = function(){
  return landmarkData.map(l => ({
    kind: l.kind, x: l.x, z: l.z,
    visible: landmarkGroups[l.kind].children.some(c => c.isSprite),
    fog: landmarkGroups[l.kind].children.find(c => c.isSprite)?.material.fog ?? null,
  }));
};
```
`landmarkGroups` (`engine/forest-engine.js:1293-1301`) is the existing kind→group map;
each group's beacon sprite is a `THREE.Sprite` child added in §3, so
`.children.some(c => c.isSprite)` is a real structural check, not a fake flag — matches
the runtime-boundary rule ("hooks must go through the real game path, never fake state").
Declare in `engine/forest-engine.d.ts` next to `qaProbeMinimapPoint` (`:70-72`):
```ts
/** LUL-2248: per-landmark beacon sprite presence + fog-exemption, one entry per
 * LANDMARKS kind, so a test can assert the sprite exists and reads past the fog line
 * without a screenshot. */
qaProbeLandmarkBeacons?: () => Array<{ kind: string; x: number; z: number; visible: boolean; fog: boolean | null }>;
```

## Verification

- `npx next typegen && npx tsc --noEmit` — no new errors.
- `npx next build` — succeeds.
- `npx eslint .` (the `lint` script) — clean.
- `node scripts/check-duplicate-logic.mjs && node scripts/check-elements-citations.mjs` —
  update any `docs/ELEMENTS.md` citations whose line numbers move (§3/§5 shift existing
  landmark-function and `drawMinimapStatic` line ranges).
- `npx playwright test e2e/landmark-beacons.spec.ts e2e/minimap.spec.ts e2e/mobile/minimap.spec.ts --project=chromium --project=mobile` locally — green. (Per founder rule
  2026-09-09: this local run is your own pre-PR sanity check, not the PR's verification —
  the local QA tester comments `local-qa: PASS|FAIL @<sha>` on the PR; don't treat your own
  run as sufficient and don't skip opening the PR because you ran it.)

## e2e

**Specs.**
- `e2e/landmark-beacons.spec.ts` (new) — `'all six landmark kinds have a fog:false beacon
  sprite visible after enter()'`: boot, call `qaProbeLandmarkBeacons()`, assert length 6,
  every entry `visible: true`, `fog: false`.
- `e2e/minimap.spec.ts` (extended) — `'home renders as a ring on the minimap static
  layer'`: boot, call `qaProbeMinimapPoint(CONFIG's home x/z)` (0, 0) to confirm the
  coordinate maps on-canvas (existing helper, no new hook needed for the position check);
  pixel-level ring-drawn assertion is out of scope for this spec (canvas isn't easily
  pixel-probed by Playwright without a screenshot diff — see Not covered).
- `e2e/mobile/minimap.spec.ts` (new) — mirrors the above two under the `mobile` Playwright
  project, since the minimap is HUD and mobile layout differs (per the mobile-parity
  checklist).

**Hooks.** `window.ForestEngine.qaProbeLandmarkBeacons(): Array<{kind,x,z,visible,fog}>` —
new, declared in `engine/forest-engine.d.ts`, installed inside the existing `?qaHooks`
block in `init()` (`engine/forest-engine.js:3314` area). `qaProbeMinimapPoint` — existing
(`engine/forest-engine.js:3314`), reused unchanged.

**Tester scenario.** Player-visible (beacons are a bearing aid, home ring is a minimap
change) — request a nightly QA scenario via
`shared/local-qa/requests/lul-2248-landmark-beacons.md` once this spec's PR lands, per
`shared/local-qa/REQUESTING-A-TEST.md`: boot, screenshot the skyline toward each landmark
(desktop) and the minimap (desktop + one landscape-phone viewport), confirm six distinct
beacon hues are visible and the minimap shows a warm home ring.

**Not covered.** Exact on-screen pixel colour/ring rendering (canvas draw calls aren't
Playwright-probable without a screenshot diff) — the local QA tester's screenshot pass is
the real check for "does this actually look like six different bearings," not this spec's
assertions, which only prove the sprites exist, are fog-exempt, and the hook data is
structurally correct.

## Constraints

Tier B — no blocking Code Reviewer review required, but CI must be green and the e2e
above must ship in the same PR (Code Reviewer blocks a Tier B/C PR whose spec has no
`## e2e` section — this one has one). Everything in the parent ticket's "Must NOT change"
list applies unchanged: win rule (`arriveHome()` in `lib/game/outcome.ts`), LUL-1081
end-screen persistence, seed determinism (no new `Math.random()`/`rng()` draws —
`clearLandmarkSpot`/`placeLandmarks` already draw no rng today and must stay that way),
`generateMap()` stream order (`engine/forest-engine.js:897-939` area), `wrapEnabled`,
`SNIFF_IMMUNITY_TIME`/`DIFFICULTY_PRESETS` semantics, fixed geography (`LANDMARKS`,
`ROOSTS`, `CAVE`, `CONFIG.lake`, `CONFIG.home`, `BOG_CENTER`/radii, 800×800 ground plane),
shared geometry/material objects never disposed.

## Out of scope

- Streaming/instancing landmarks — explicitly reserved for step 5 (LUL-2249); landmarks
  stay always-instantiated (only 6 groups, negligible cost).
- Adding the child or predators to the minimap at any difficulty preset.
- Any change to `LANDMARKS`' fixed x/z/clear/cr values, or to `CONFIG.home`'s
  x/z/r/glow — those are fixed geography per the parent epic's constraints.
- Re-tuning `radioMast`'s existing beacon hue/scale/pulse — it already shipped (LUL-1855)
  and this spec's job is to generalise the *mechanism*, not restyle what's already live.
