# SPEC — LUL-1904: cave landmark (50%-round spawn, timed detection-immunity)

Tier: **C** — touches `engine/forest-engine.js` simulation (spawn conditioning,
`effectiveDetect()`/`checkScent()` detection formula, charge state). Requires
`REVIEW: APPROVED` before merge. No `[ship]` marker.

Source: PLAN document on this issue (CTO, revision 1) + direct reading of
`engine/forest-engine.js`/`engine/tuning.js` on `release/next` at commit
`2dbaa02`. **Several of the plan's `file:line` citations do not match the
current file** (the plan was written against a stale read — e.g. it cites
`effectiveDetect()` at `forest-engine.js:1410` and an "existing per-predator
charge clear at `arriveHome()` `:3217`" that does not exist). Every citation
below was re-verified directly; where the plan and the live file disagree,
this spec follows the live file. The plan's decisions (duration, coordinate,
sight+scent-only scope, charge-cancel-in-scope) are unchanged and carried
forward as-is.

## Decisions (carried from the plan, restated so this file is self-contained)

1. **Duration: 25s**, named `CAVE_IMMUNITY_TIME`.
2. **One fixed candidate slot**, not a drawn-from-list — same treatment as
   every existing `LANDMARKS` entry.
3. **Sight + scent only.** `checkNoise()` (`engine/forest-engine.js:1398`)
   stays untouched — deliberate scope line, not an oversight. Note this
   explicitly so review doesn't flag it as a missed channel.
4. **Charge-cancel on activation is in scope.** A predator's committed charge
   resolves purely positionally (§4 below) and does not re-check detection —
   without an explicit clear, a player who ducks into cave immunity
   mid-telegraph can still die with the immunity HUD showing active.

## Coordinate re-check (plan §2's open item)

Live `LANDMARKS` (`engine/tuning.js:57-64`, LUL-1782 already merged):
```
fireTower     -95, -95      stoneMarker   100, -75
oak            22,   4      drownedCar    -95,  46
radioMast      30, 175      chapelSteeple  20, -178
```
Candidate `x:-70, z:130`: distance to `drownedCar` ≈ 87.6, to `radioMast` ≈
109.7 — both comfortably clear of every existing landmark's `clear` radius
(max 12) and of `CONFIG.lake`/`CONFIG.home`. Radius from center ≈ 147.6, inside
the child's 120–192 spawn band. No collision. Use this coordinate as-is.

## 1. `engine/tuning.js` — new fixed-slot constant

Add after the `LANDMARKS` array (after the closing `];` at line 64, before the
`// LUL-1808: roam waypoint step` comment at line 66):

```js
// LUL-1904: the cave -- spawns in ~50% of rounds (coin-flip drawn in
// generateMap(), see forest-engine.js), a fixed candidate slot like every
// LANDMARKS entry above, but NOT pushed into LANDMARKS itself -- that array
// is placed unconditionally every round (placeLandmarks(), forest-engine.js:1061-1069).
// `interactR` is the walk-in trigger radius (distinct from `cr`, the movement
// collider) -- deliberately larger, matching the scale of the other entries'
// `clear`.
export const CAVE = { kind: 'cave', x: -70, z: 130, clear: 12, cr: 1.6, interactR: 6 };
```

Do not add `cave` to the `LANDMARKS` array.

## 2. New `lib/game/cave.ts` (pure, unit-tested)

Mirrors `lib/game/veil.ts`'s shape: pure constants + a pure predicate, no
engine coupling.

```ts
export const CAVE_IMMUNITY_TIME = 25;   // seconds -- founder's 20-30s window, middle value

/** true from the frame activation happens until the countdown reaches 0. */
export function isCaveImmune(caveImmuneT: number): boolean {
  return caveImmuneT > 0;
}
```

## 3. New `lib/game/cave.test.ts`

Same style as `lib/game/predator.test.ts`'s `isCaught` boundary tests —
`node --test`, no engine/DOM/timer/rng imports.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCaveImmune, CAVE_IMMUNITY_TIME } from './cave';

test('isCaveImmune is false at exactly 0', () => {
  assert.equal(isCaveImmune(0), false);
});

test('isCaveImmune is true for any positive remainder', () => {
  assert.equal(isCaveImmune(0.001), true);
  assert.equal(isCaveImmune(CAVE_IMMUNITY_TIME), true);
});

test('isCaveImmune is false for a negative remainder (decremented past 0)', () => {
  assert.equal(isCaveImmune(-0.01), false);
});
```

## 4. `engine/forest-engine.js` edits

### 4.1 Imports

In the `@/engine/tuning` import block (`engine/forest-engine.js:157-163`), add
`CAVE` to the named list (after `CHARGE_COOLDOWN`):

```js
  CAVE, CHARGE_COOLDOWN, SENS, SCALE, PLAYER_FOV_COS, CUT_END,
```

Add a new import line after the `@/lib/game/veil` import (`engine/forest-engine.js:104`):

```js
import { CAVE_IMMUNITY_TIME, isCaveImmune } from '@/lib/game/cave';
```

### 4.2 Module-scope state

Alongside `let landmarkData = [];` (`engine/forest-engine.js:520`), add:

```js
// LUL-1904: cave landmark -- caveSpawned/caveData decided once per round in
// generateMap() (rng-gated, see placeCave()); caveConsumed is the single-use
// gate; caveImmuneT is the live countdown (0 = inactive), decremented in
// tick() alongside the other per-frame timers.
let caveSpawned = false, caveData = null, caveConsumed = false, caveImmuneT = 0;
```

### 4.3 `buildCave()` mesh + registration

Add a new builder function after `buildChapelSteeple()` (after line 1037, before
`const landmarkGroups = {` at line 1038). Same "static group + a point light"
recipe as the other six (comment block at `engine/forest-engine.js:952-959`
already documents this recipe):

```js
function buildCave(){
  const g = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x27241f, roughness: 1 });
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 6, 0, Math.PI*2, 0, Math.PI*0.55), rockMat);
  mouth.rotation.x = Math.PI; mouth.position.y = 1.4; g.add(mouth);
  const glow = new THREE.PointLight(0x6fd6c4, 0.6 * LEGACY_LIGHT_SCALE, 14, 2);
  glow.position.set(0, 1.2, 1.6); g.add(glow);
  g.visible = false;   // LUL-1904: the first landmark whose visibility is conditional
                        // per-round, not always-on -- see placeCave().
  return g;
}
```

Register it in `landmarkGroups` (`engine/forest-engine.js:1038-1045`):

```js
const landmarkGroups = {
  fireTower: buildFireTower(),
  stoneMarker: buildStoneMarker(),
  drownedCar: buildDrownedCar(),
  oak: buildSplitOak(),
  radioMast: buildRadioMast(),
  chapelSteeple: buildChapelSteeple(),
  cave: buildCave(),
};
```

No other consumer of `landmarkGroups` needs a change — `Object.values(landmarkGroups).forEach(g => scene.add(g))` (line 1046) already adds it to the scene once, at `.visible = false`.

### 4.4 `placeCave()` — spawn coin-flip + placement

Add a new function after `placeLandmarks()` (after line 1069):

```js
// LUL-1904: the cave's own spawn coin-flip is a NEW rng() consumer and must
// run strictly after generateMap()'s last existing draw (mission =
// pickMission(rng), forest-engine.js:917 -- see the LUL-1258 comment there:
// "draw this run's mission last... so it never shifts the stream any
// existing seed/replay depends on"). Placement itself (clearLandmarkSpot)
// draws no rng, same as placeLandmarks() -- it can run conditionally with no
// determinism concern either way.
function placeCave(){
  caveSpawned = rng() < 0.5;
  caveConsumed = false;
  caveImmuneT = 0;
  if(caveSpawned){
    const [x, z] = clearLandmarkSpot(CAVE.x, CAVE.z, CAVE.clear);
    caveData = { x, z };
    landmarkGroups.cave.position.set(x, 0, z);
    landmarkGroups.cave.visible = true;
    landmarkData.push({ x, z, cr: CAVE.cr });
  } else {
    caveData = null;
    landmarkGroups.cave.visible = false;
  }
}
```

### 4.5 Wire into `generateMap()`

In `generateMap()` (`engine/forest-engine.js:872-926`), insert the call
strictly after the `mission = pickMission(rng);` line (917) and its two
follow-up lines, replacing the current tail:

```js
  mission = pickMission(rng);
  missionHumTimer = 2;
  placeCave();   // LUL-1904: new rng consumer -- must stay last, after mission
  buildGrid();   // landmarkData just changed (placeCave() may have pushed to it); same
                  // reasoning as the LUL-374 comment at line 909's buildGrid() call
  // LUL-1093: moved from right after the tree-pool buildGrid() above.
  ...
  drawMinimapStatic();
}
```

i.e. `placeCave()` + one extra `buildGrid()` call go between `missionHumTimer = 2;`
and the existing `// LUL-1093` comment / `drawMinimapStatic()` call. Nothing
else in `generateMap()` changes. `buildGrid()`'s existing body (line 544)
already handles an empty or populated `landmarkData` generically via
`addAllToGrid(landmarkData)` (line 551) — no change needed there.

### 4.6 Detection hook — `effectiveDetect()` / `checkScent()`

Both are engine-local wrappers, not the pure `lib/game/cover.ts` functions —
edit only the wrappers, once each, so every call site is covered with no
per-branch duplication.

`effectiveDetect()` (`engine/forest-engine.js:1500-1502`):
```js
function effectiveDetect(p){
  if(isCaveImmune(caveImmuneT)) return 0;
  return geoEffectiveDetect(p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmountAt(p.x, p.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)) * timeOfRunDetectMul(timeOfRun), { hidden, hideTime, carrying });
}
```
`canSee(p, dist)` (line 1503-1505) is unchanged — it does not call
`effectiveDetect()`, it independently threads the same multiplier chain
through `geoCanSee()`. It needs its own guard:
```js
function canSee(p, dist){
  if(isCaveImmune(caveImmuneT)) return false;
  return geoCanSee(dist, p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmountAt(p.x, p.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)) * timeOfRunDetectMul(timeOfRun), { hidden, hideTime, carrying }, p.x, p.z, player.x, player.z, coverGrid, CELL, WRAP_SPAN);
}
```
**Correction to the plan**: the plan assumed `canSee()` calls `effectiveDetect()`
internally (so one edit would cover both) — it does not; they're two
independent call-throughs to `lib/game/cover.ts`. Both need the guard. Every
sight path in `updatePredators()` — `sightLock` line 1627, `hunt` line 1643,
`roam` line 1660, `chase` lines 1690/1698/1712, `flank` line 1779 (all
verified directly against `engine/forest-engine.js` on `release/next` commit
`2dbaa02`) — calls `canSee(p, dist)` directly, so this one edit covers all of
them. Re-`grep -n "canSee("` if these have drifted by implementation time.

`checkScent(p)` (`engine/forest-engine.js:1358-1364`):
```js
function checkScent(p){
  if(isCaveImmune(caveImmuneT)) return false;
  for(let i = scentPoints.length - 1; i >= 0; i--){
    const s = scentPoints[i], age = clock.elapsedTime - s.t0;
    if(isScentDetected(s, age, p.x, p.z, windX, windZ, p.spec.nose, SCENT_LIFETIME, WRAP_SPAN)) return true;
  }
  return false;
}
```

`checkNoise()` (line 1398) is **not** touched — sight + scent only (decision 3).

### 4.7 `activateCavePower()` — trigger + charge-cancel + cue

Add a new function near `checkScent`/detection helpers (immediately after
`checkScent()`, e.g. after line 1364):

```js
// LUL-1904: walk-in trigger, no keybind -- mirrors arriveHome()'s own shape
// (a plain per-frame distance check in tick(), not the keypress-gated
// pickup()/grabThrowable() pattern), so touch parity is free: it reads
// player.x/z only, already unified across desktop-key and mobile-joystick
// input before this point in tick(). No new entry in components/MobileControls.tsx
// or EngineActions is needed.
function activateCavePower(){
  caveConsumed = true;
  caveImmuneT = CAVE_IMMUNITY_TIME;
  // A committed charge (p.charge, resolved by stepCharge()) is caught-or-dodged
  // purely positionally -- it does not re-check canSee()/effectiveDetect()
  // before resolving (engine/forest-engine.js:1579-1606). Without this, a
  // player ducking into immunity mid-telegraph can still die with the
  // immunity HUD active. There is no existing "clear every predator's charge"
  // helper to reuse -- placePredators() (line 1301-1311) and the QA hook at
  // line 3193-3218 each clear exactly one predator's charge inline; this is
  // a new all-predators loop.
  for(const p of predators){
    if(p.charge){ p.charge = null; p.chargeCooldown = CHARGE_COOLDOWN; }
  }
  activeCharges = 0;
  pushState({ chargeVisible: false, caveImmuneActive: true, caveImmuneTimeLeft: CAVE_IMMUNITY_TIME });
  caveImmuneStartCue();
}
```

### 4.8 Per-tick countdown, trigger check, and end cue

In `tick()`'s `if(playing){ ... }` block (`engine/forest-engine.js:3968-4016`),
which already computes `distBaby`/`distHome`/etc. once per frame and is the
correct gate (only runs while actually playing): add the cave check right
before the `pushState({...})` call at line 4002, and add the two new fields
to that same `pushState` call:

```js
    // LUL-1904: walk-in trigger -- single-use per round, sight+scent only.
    if(caveSpawned && !caveConsumed && caveData){
      const distCave = Math.hypot(player.x - caveData.x, player.z - caveData.z);
      if(distCave < CAVE.interactR) activateCavePower();
    }
    // Countdown decrements unconditionally while playing, same shape as the
    // existing per-predator sniffImmuneT/chargeCooldown decrements
    // (engine/forest-engine.js:1568/1573) -- "never lapse silently": the
    // >0 -> 0 edge fires a distinct end cue, mirrored into the HUD in the
    // same pushState below.
    let caveImmuneJustEnded = false;
    if(caveImmuneT > 0){
      caveImmuneT = Math.max(0, caveImmuneT - dt);
      if(caveImmuneT === 0) caveImmuneJustEnded = true;
    }
    if(caveImmuneJustEnded) caveImmuneEndCue();

    pushState({
      objectiveVisible: true, objectiveReady: canPickup,
      objectiveText: carrying
        ? 'Carry the child home  ·  ' + Math.round(distHome) + 'm'
        : (canPickup ? 'Press  E  to lift the child'
           : (missionCanComplete ? 'Press  E  at the drowned car' : 'Find the lost child  ·  ' + Math.round(distBaby) + 'm')),
      statusVisible, statusText,
      coverPromptVisible, coverPromptUrgent, coverPromptKind,
      veilPromptVisible, veilPromptUrgent,
      heldThrowable, canGrabThrowable: canGrabThrowable(heldThrowable, nearestThrowableD, THROWABLE_PICKUP_RADIUS),
      missionKind: mission && !carrying ? mission.target.kind : null,
      missionStatus: mission && !carrying ? mission.status : null,
      caveImmuneActive: caveImmuneT > 0,
      caveImmuneTimeLeft: caveImmuneT,
    });
  } else {
    pushState({ objectiveVisible: false, statusVisible: false, coverPromptVisible: false, coverPromptUrgent: false, coverPromptKind: null, veilPromptVisible: false, veilPromptUrgent: false, heldThrowable, canGrabThrowable: false, missionKind: null, missionStatus: null, caveImmuneActive: false });
  }
```

(The `else` branch is the existing not-playing reset at line 4018 — add
`caveImmuneActive: false` to it; `caveImmuneTimeLeft` doesn't need resetting
there since the HUD only reads it while `caveImmuneActive` is true.)

### 4.9 Audio/visual cues

Add two new functions near `missionCompleteSting()` (`engine/forest-engine.js:3356-3369`),
following its exact Web Audio oscillator style. Must sound distinct from
`missionCompleteSting()` (mission ding) and the veil's own cues (no dedicated
veil start/end sound exists to collide with — veil is silent, dim + vignette
only). A distinct register/timbre is enough; exact values are Game Engineer's
call within this shape:

```js
function caveImmuneStartCue(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(660, t + 0.35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.24, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.55);
}
function caveImmuneEndCue(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.6);
}
```

### 4.10 `hudState` initial object

Add two fields to `hudState` (`engine/forest-engine.js:2517-2552`), near
`chargeVisible`/`chargeToken`:

```js
  caveImmuneActive: false, caveImmuneTimeLeft: 0,
```

## 5. `components/Hud.tsx`

### 5.1 `HudState` interface

Add near the `veilCharge`/`veilLocked` fields (around line 60):
```ts
  caveImmuneActive:   boolean;
  caveImmuneTimeLeft: number;
```

### 5.2 Default state object

Add near `veilCharge: 1` (around line 177):
```ts
  caveImmuneActive: false,
  caveImmuneTimeLeft: 0,
```

### 5.3 Render — a running countdown, not a momentary prompt

Add a new always-visible panel, modeled on `#missionPanel`
(`components/Hud.tsx:582-587`) rather than `#actionPrompt`
(`components/Hud.tsx:612-634`) — the brief requires "never lapse silently",
i.e. a readable running clock for the full 25s, not a one-shot toast. Insert
after the `missionPanel` block:

```tsx
{/* LUL-1904: cave detection-immunity countdown -- always visible while
    active so the player can never be surprised by a silent lapse. Raw
    seconds from the engine, formatted here (same "engine emits data, React
    renders" rule as fogDisplay/timeOfRunClock). */}
{state.caveImmuneActive && (
  <div id="caveImmunePanel">
    Immune · {Math.ceil(state.caveImmuneTimeLeft)}s
  </div>
)}
```

No touch-specific markup needed — this is a passive readout, not a control.

## 6. `components/GameCanvas.tsx` — CSS

Add a new rule near `#missionPanel` (`components/GameCanvas.tsx:268-279`),
same fixed/pill-badge treatment, positioned so it doesn't collide with
`#missionPanel` (top-left) or `#windIndicator` (top-right) — top-center, below
`#objective`:

```css
/* LUL-1904: cave detection-immunity countdown -- always visible while active,
   top-center below #objective so it never overlaps the mission panel or the
   wind indicator. */
#caveImmunePanel { position: fixed; top: 56px; left: 50%; transform: translateX(-50%); z-index: 12;
  padding: 6px 14px; border-radius: 999px; pointer-events: none;
  background: rgba(20,40,36,0.6); border: 1px solid rgba(111,214,196,0.4);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  font-size: 13px; letter-spacing: 0.04em; color: #a8f0e0;
  text-shadow: 0 1px 6px rgba(0,0,0,0.7); }
```

## 7. `docs/ELEMENTS.md`

Update the landmarks paragraph (`docs/ELEMENTS.md:1425-1434` on this branch,
re-check the live line number at implementation time — LUL-1782 already
merged and may have shifted it further) to read "seven fixed `Landmark`
groups" and add a sentence: `cave` (LUL-1904) is the first landmark whose
spawn and visibility are conditional per-round (~50% via a seeded coin-flip in
`generateMap()`, drawn last in the rng stream) rather than always-present;
walking into its `interactR` grants a one-shot 25s sight+scent detection
immunity (`CAVE_IMMUNITY_TIME`, `lib/game/cave.ts`), hooked into
`effectiveDetect()`/`canSee()`/`checkScent()`.

## Constraints (must not change)

- `checkNoise()` / the noise detection channel — untouched.
- rng draw order in `generateMap()` — `placeCave()`'s coin-flip must be the
  **last** rng consumer, strictly after `mission = pickMission(rng)`. Getting
  this wrong reorders the stream and silently changes every existing seed's
  tree/predator/cover layout, breaking `CONFIG.seed` (`engine/tuning.js:17`)
  and any seed-keyed regression fixture.
- `LANDMARKS` array — do not push `cave`/`CAVE` into it; it is placed
  unconditionally every round.
- `lib/game/cover.ts`'s pure `geoEffectiveDetect`/`geoCanSee` — do not touch;
  guard only the engine-local wrappers.
- No new touch/mobile wiring — the walk-in trigger reads `player.x/z`, already
  unified across input modes before this point in `tick()`.

## Out of scope (unchanged from the founder brief)

Multiple power types, a cave interior/second space, recharging/stacking/more
than one cave per round, any economy interaction.

## Verification

- `node --test lib/game/cave.test.ts` — new pure-logic tests pass (boundary at
  0, positive, negative-after-decrement).
- `npx tsc --noEmit` — clean.
- `npm run lint` (or the configured `lint` script — `next lint` is removed in
  Next.js 16) — clean.
- `npm test` — full suite green, including
  `scripts/check-elements-citations.mjs` and
  `scripts/check-duplicate-logic.mjs` (run under the same `unit tests` CI
  check; see AGENTS.md's note on these two guards before treating a red run
  as a real regression — re-run `node scripts/check-elements-citations.mjs --fix`
  first if `docs/ELEMENTS.md` line-number citations shifted).
- `next build` passes.
- No console errors on load (tester-confirmed, gameplay unverified — Founding
  Engineer/Game Engineer assert code correctness only, not gameplay feel).
- Manual/QA-hook spot check once implemented: force `caveSpawned = true` and
  `rng() < 0.5` deterministically (e.g. via a fixed seed known to draw true at
  that point, or a temporary local override while testing) and confirm: cave
  mesh visible + solid collider, walking into `interactR` fires the start cue
  and HUD panel, predators can't detect the player by sight or scent for 25s,
  a charge in flight at the moment of activation is cancelled (not lethal),
  the HUD counts down and fires an end cue at 0, and a second walk-in after
  consumption does nothing.
