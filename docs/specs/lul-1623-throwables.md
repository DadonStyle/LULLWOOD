# SPEC — LUL-1623 Throwable distractions (stones/twigs)

Tier: **C** (`engine/forest-engine.js` simulation: new prop kind, new predator-noise
source, predator targeting change). Requires `REVIEW: APPROVED` before merge — do not
merge on green CI alone.

Written against `origin/release/next` @ `665920c` (LUL-1638, PR #346). All line numbers
below are verified against that commit; if the target file has moved on by the time this
is implemented, re-locate by the cited symbol name, not the raw number, and report a spec
bug if the symbol itself is gone.

Builds on the CTO PLAN document on LUL-1623 (decisions 1–9, read it first — this spec
does not repeat the reasoning, only the exact edits) and
`wiki:game/mechanics/lul1623-throwables-input-conflicts`. **One correction to that PLAN
is made explicitly in §5 below — read it, it changes predator behavior from what the PLAN
literally says.**

## Files touched

1. `lib/game/noise.ts` — new pure predicate + constant
2. `lib/game/outcome.ts` — new pure transition helpers (grab/throw), mirroring
   `beginPickup`/`completePickup`
3. `lib/game/noise.test.ts` — new tests for `checkThrowableNoise`
4. `lib/game/outcome.test.ts` — new tests for the grab/throw helpers
5. `engine/forest-engine.js` — prop spawn/mesh, state, input, throw physics, predator
   targeting override
6. `components/GameCanvas.tsx` — desktop throw binding (left-click) is already routed
   through the engine's existing `mousedown` handler; no new desktop input code needed
   outside the engine (see §4). Only a HUD affordance addition here.
7. `components/MobileControls.tsx` — mobile throw trigger button
8. `components/Hud.tsx` / `engine/forest-engine.d.ts` — `EngineActions` new member
9. `docs/ELEMENTS.md` — new element entry (required, same PR)

---

## §1. `lib/game/noise.ts`

Add after `NOISE_RADIUS_RUN` (currently line 18):

```ts
/** A thrown object's landing noise is a one-shot event, not a per-frame roll like
 * isNoiseHeard() — reuses NOISE_RADIUS_RUN's scale per the CTO plan (decision 5). */
export const THROWABLE_NOISE_RADIUS = NOISE_RADIUS_RUN;

/**
 * Whether a predator at `dist` from a throwable's landing point notices it. Pure
 * distance check, deliberately not probabilistic like isNoiseHeard() — a thrown
 * object either lands loud enough to notice or it doesn't; there is no "roll again
 * next frame" because the event fires once, on landing, not every tick.
 */
export function checkThrowableNoise(dist: number, radius: number = THROWABLE_NOISE_RADIUS): boolean {
  return dist < radius;
}
```

## §2. `lib/game/outcome.ts`

Add after `canTriggerDeath`/`triggerDeath` (end of file, after line 99). These do **not**
touch `RunState` — holding a throwable is an inventory flag orthogonal to the
win/death/pickup/carry state machine (same tier as the existing `KeyF` veil-hold, which
also isn't in `RunState`), so it is plain booleans/params, not a new `RunState` field.

```ts
/** Gate for both the HUD "pick up stone" prompt and the grab input itself. Mirrors
 * canPickUp()'s shape (proximity + one flag) but the flag is "already holding one",
 * not run-phase — you can grab a throwable in any playable state, including while
 * carrying the child (CTO plan decision 6: carry-leg is the intended beneficiary). */
export function canGrabThrowable(heldThrowable: boolean, distToThrowable: number, radius: number): boolean {
  return !heldThrowable && distToThrowable < radius;
}

/** Gate for the throw input: must actually be holding one. No other precondition —
 * throwing while carrying, while investigate/chase is active, etc. are all allowed. */
export function canThrowThrowable(heldThrowable: boolean): boolean {
  return heldThrowable;
}
```

## §3. Tests

`lib/game/noise.test.ts` — add, mirroring existing `isNoiseHeard` cases:
- `checkThrowableNoise(10, 24)` → `true`
- `checkThrowableNoise(24, 24)` → `false` (boundary, exclusive)
- `checkThrowableNoise(30, 24)` → `false`

`lib/game/outcome.test.ts` — add:
- `canGrabThrowable(false, 2, 3)` → `true`
- `canGrabThrowable(true, 2, 3)` → `false` (already holding)
- `canGrabThrowable(false, 5, 3)` → `false` (out of range)
- `canThrowThrowable(true)` → `true`; `canThrowThrowable(false)` → `false`

## §4. `engine/forest-engine.js`

### 4.1 Constants and state

Near `COVER_PROPS = 220` (line 432), add:

```js
const THROWABLE_COUNT = 10;             // Scout MVP number
const THROWABLE_PICKUP_RADIUS = 3;      // matches canPickUp's baby radius scale
const THROWABLE_THROW_DISTANCE = 18;    // landing point = player pos + facing * this
const THROWABLE_INVESTIGATE_TIME = [3, 5]; // rnd() range, seconds
```

Near the mesh group at line 447 (`coverMeshes`), add a **separate** instanced mesh —
throwables are not `coverData`/`HIDE_KINDS` per CTO plan decision 3 (no LOS block, no
collision):

```js
const throwableGeo = rockGeo; // reuse, scaled down at layout time — see 4.2
const throwableMat = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 1 });
const throwableMesh = new THREE.InstancedMesh(throwableGeo, throwableMat, THROWABLE_COUNT);
throwableMesh.frustumCulled = false;
scene.add(throwableMesh);
```

Near `let coverData = []` (line 483), add:

```js
let throwableData = [];   // {x,z,taken} — ambient pickup props, own spawn list, no LOS/collision role
```

Near the pickup/carry state locals (line 1609-1613, `let entered = false, ... canPickup = false, ...`),
add:

```js
let heldThrowable = false;
```

### 4.2 Spawn — `generateThrowables()`

New function, placed directly after `generateCover()` (which ends around line 665 based
on its `while(placed < COVER_PROPS...)` loop structure — find the function's closing
brace, insert after it, before `layoutCoverMeshes()`'s definition). Mirrors
`generateCover()`'s placement-loop shape (rng-seeded, rejection-sample against existing
obstacles) but simpler: no kind selection, no orientation, just placement.

```js
function generateThrowables(){
  throwableData = [];
  let placed = 0, tries = 0;
  while(placed < THROWABLE_COUNT && tries < THROWABLE_COUNT * 40){
    tries++;
    const x = (rng() - 0.5) * (half * 2 - 8);
    const z = (rng() - 0.5) * (half * 2 - 8);
    // reject too close to home/spawn or overlapping existing cover/tree geometry —
    // reuse the same rejection test generateCover() uses against tree trunks
    // (overlapsTreeTrunk()) plus a check against already-placed throwables so they
    // don't stack visually.
    if(overlapsTreeTrunk(x, z, 1.5)) continue;
    if(Math.hypot(x - CONFIG.home.x, z - CONFIG.home.z) < 12) continue;
    if(throwableData.some(t => Math.hypot(t.x - x, t.z - z) < 6)) continue;
    throwableData.push({ x, z, taken: false });
    placed++;
  }
}
```

Call it in `generateMap()` right after the existing `generateCover(); layoutCoverMeshes();`
line (line 726):

```js
generateCover(); layoutCoverMeshes();
generateThrowables(); layoutThrowableMeshes();
```

### 4.3 Layout — `layoutThrowableMeshes()`

New function, placed near `layoutCoverMeshes()` (line 589):

```js
const _throwMat4 = new THREE.Matrix4();
function layoutThrowableMeshes(){
  for(let i = 0; i < THROWABLE_COUNT; i++){
    const t = throwableData[i];
    if(!t || t.taken){
      // park hidden props off-map rather than resizing the InstancedMesh —
      // same "move it away" pattern used elsewhere for consumed/inactive instances.
      _throwMat4.compose(
        new THREE.Vector3(0, -50, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(0.001, 0.001, 0.001),
      );
    } else {
      _throwMat4.compose(
        new THREE.Vector3(t.x, 0.25, t.z),
        new THREE.Quaternion(),
        new THREE.Vector3(0.28, 0.28, 0.28), // small stone scale vs. full-size rock cover
      );
    }
    throwableMesh.setMatrixAt(i, _throwMat4);
  }
  throwableMesh.instanceMatrix.needsUpdate = true;
}
```

Call `layoutThrowableMeshes()` again at the end of `grabThrowable()` (below) to re-hide
the taken instance.

### 4.4 Grab — context-dispatch on the existing `E` / Interact path

**Do not rebind `KeyE`.** At line 1667:

```js
if(e.code === 'KeyE' && canPickup && playing && !paused) pickup();
```

Change to:

```js
if(e.code === 'KeyE' && playing && !paused){
  if(canPickup) pickup();
  else grabThrowable();
}
```

Mirror the same context-branch in `triggerTouchInteract()` (line 3511-3513):

```js
function triggerTouchInteract() {
  const playing = isPlaying(runState());
  if(!playing || paused) return;
  if(canPickup) pickup();
  else grabThrowable();
}
```

New function `grabThrowable()`, placed near `pickup()` (line 2797):

```js
function grabThrowable(){
  if(heldThrowable) return;
  let nearest = -1, nearestD = THROWABLE_PICKUP_RADIUS;
  for(let i = 0; i < throwableData.length; i++){
    const t = throwableData[i];
    if(t.taken) continue;
    const d = Math.hypot(t.x - player.x, t.z - player.z);
    if(canGrabThrowable(heldThrowable, d, THROWABLE_PICKUP_RADIUS) && d < nearestD){ nearest = i; nearestD = d; }
  }
  if(nearest < 0) return;
  throwableData[nearest].taken = true;
  heldThrowable = true;
  layoutThrowableMeshes();
}
```

`canGrabThrowable` imported alongside the existing `outcome.ts` imports at the top of the
file (same import line that already brings in `beginPickup`/`completePickup`/etc.).

**HUD gate for the prompt**: wherever the engine currently exposes `canPickup` to
`pushState()`/HUD (the objective-prompt plumbing), add an equivalent
`canGrabThrowable: !heldThrowable && <nearest-throwable-dist> < THROWABLE_PICKUP_RADIUS`
boolean computed once per frame in the same tick pass that already computes `canPickup`
(distance-to-baby check) — do not add a second full loop over `throwableData` elsewhere;
compute nearest-throwable-distance once per frame and reuse it for both the HUD flag and
`grabThrowable()`'s own re-check.

### 4.5 Throw — desktop left-click, NOT `Space`

Per CTO plan decision 9 — **explicit deviation from the approved ticket's literal text**,
which said "Space to throw." `Space` is `beginJump()` (line 1644), the charge-dodge
action; sharing it with throw risks eating a dodge input. Change the `mousedown` handler
(line 1712-1715):

```js
on(el, 'mousedown', () => {
  if(paused){ setPaused(false); requestLock(); return; }
  if(!locked){ dragging = true; el.style.cursor = 'grabbing'; return; }
  if(locked && heldThrowable && isPlaying(runState())) throwThrowable();
});
```

New function `throwThrowable()`, placed after `grabThrowable()`:

```js
function throwThrowable(){
  if(!canThrowThrowable(heldThrowable)) return;
  heldThrowable = false;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const landX = player.x + fx * THROWABLE_THROW_DISTANCE;
  const landZ = player.z + fz * THROWABLE_THROW_DISTANCE;
  leafRustle(false);   // landing thud reuses the existing percussive-hit primitive (CTO plan decision 7) — player-audible, same call already used by hearNoise()
  for(const p of predators){
    if(p.inert) continue;
    const dist = Math.hypot(p.x - landX, p.z - landZ);
    if(checkThrowableNoise(dist, THROWABLE_NOISE_RADIUS)) hearThrowableNoise(p, landX, landZ);
  }
}
```

`checkThrowableNoise` imported alongside the existing `isNoiseHeard`/`NOISE_RADIUS_*`
import at line 67.

### 4.6 Predator response — `hearThrowableNoise()` + targeting override

**§5 correction to the CTO PLAN, declare this explicitly in the PR body and the LUL-1623
comment — do not silently build the plan's literal version.** The PLAN says to reuse
`investigate`/`approach` "for 3-5s" by treating a throw exactly like `hearNoise()`. But
`hearNoise()`'s `approach` sub-phase does not path to a location at all — it recomputes a
unit vector toward the **live player** every tick (`ux, uz` from `updatePredators()`'s
per-predator loop, line 1299-1300, fed straight into `stepApproach()`). Wiring a throw
through `hearNoise()` unchanged would make the predator walk toward the real player, not
the landing spot — the opposite of "investigate the sound elsewhere," and it would not
give the escape window the whole ticket exists to create. This is a correctness bug in
the plan's chosen mechanism, not a scope change: same states (`investigate`/`approach`/
`sniff`/`back`), same `stepApproach()` function unchanged, same sniff-then-give-up loop —
only the movement **target** used during the `approach` sub-phase is overridden while a
decoy is active. No new `p.state` or `p.inv` value is introduced.

Add a new predator field. Wherever predator objects are constructed (the spawn loop that
sets `p.state`, `p.inv`, etc. — search `p.scentLock = 0` initializations near predator
creation), add `p.noiseTarget = null; p.noiseTargetT = 0;`.

New function, next to `hearNoise()` (line 1190):

```js
function hearThrowableNoise(p, tx, tz){
  p.state = 'investigate'; p.inv = 'approach'; p.sniffsLeft = rollSniffs(rng, 4);
  p.callTimer = rnd(2.6, 4.2);
  p.noiseTarget = { x: tx, z: tz };
  p.noiseTargetT = rnd(THROWABLE_INVESTIGATE_TIME[0], THROWABLE_INVESTIGATE_TIME[1]);
  if(captionsOn) pushState({ caption: `${p.kind} investigates a noise`, captionId: ++captionSeq });
}
```

In `updatePredators()`'s `approach` branch (line 1439-1445), override the target only
here:

```js
} else if(p.inv === 'approach'){
  facePlayer = true;
  let aux = ux, auz = uz, adist = dist;
  if(p.noiseTarget){
    const ndx = p.noiseTarget.x - p.x, ndz = p.noiseTarget.z - p.z;
    adist = Math.hypot(ndx, ndz) || 0.0001;
    aux = ndx / adist; auz = ndz / adist;
  }
  const step = stepApproach(aux, auz, p.spec.speed, adist, p.rad);
  desx = step.desx; desz = step.desz; speed = step.speed;
  if(step.enterSniff){ p.inv='sniff'; p.sniffTimer = rnd(1,5); sniff(); }
  if(p.noiseTarget){
    p.noiseTargetT -= dt;
    if(p.noiseTargetT <= 0 || step.enterSniff) p.noiseTarget = null;
  }
}
```

**Constraint: `ux, uz, dist` themselves (line 1299-1300) are untouched** — every other
consumer in the per-predator loop (`canSee(p, dist)`, `hunt`, `chase`, `roam`'s own
investigate-entry check) keeps using live-player distance/direction exactly as today.
Only the local `aux/auz/adist` inside the `approach` branch redirect to the decoy point,
and only while `p.noiseTarget` is set. The existing `shouldRevertInvestigateToChase(p.inv,
hidden)` re-escalation check (line 188 in `lib/game/predator.ts`) is untouched and already
gates only on `sniff`/`back` + `!hidden` — this is what makes the escape window real:
hide before the predator's sniff phase re-checks `hidden`, regardless of where the
predator physically is standing. Do not add any additional revert condition — that
behavior is inherited for free and is why hiding during the investigate window works
exactly like it already does for a normal noise-hear.

### 4.7 Carrying does not gate throwing

No code needed — `throwThrowable()`/`grabThrowable()` have no `carrying` check by design
(CTO plan decision 6). Verify no existing guard implicitly blocks input while `carrying`
(the `KeyE`/`triggerTouchInteract` context-dispatch in §4.4 only branches on `canPickup`,
which is already false while carrying per `pickupAllowed()` in `outcome.ts`, so it falls
through to `grabThrowable()` correctly with no new condition needed).

## §5. `components/GameCanvas.tsx`

Desktop needs no new input wiring (throw is the engine's own `mousedown`, §4.5). Add a
small HUD affordance: when `heldThrowable` is true (exposed via `pushState`/HUD state
the same way `pickingUp`/`carrying` already are), show a "holding a stone — click to
throw" prompt, styled like the existing pickup/interact prompt. Cite the existing
prompt's component for style — do not invent a new visual language.

## §6. `components/MobileControls.tsx` / `components/Hud.tsx` / `engine/forest-engine.d.ts`

Per the mandatory mobile-parity rule: mobile needs its own **throw** trigger — grab
already reuses the existing Interact button (§4.4, engine-side context dispatch, no
mobile-file change needed for grab). Per CTO plan decision 2, mobile throw reuses the
existing aim-then-tap shape (throw along `player.yaw`, already written every frame by the
look-stick) — **no new swipe-gesture math.**

Add to `EngineActions` (`components/Hud.tsx:87` interface block, alongside
`triggerTouchInteract` at line 99):

```ts
triggerTouchThrow: () => void;
```

Implement in `engine/forest-engine.js` next to `triggerTouchInteract()` (line 3511):

```js
function triggerTouchThrow() {
  const playing = isPlaying(runState());
  if(playing && !paused && heldThrowable) throwThrowable();
}
```

Add to the function's return object (line 3550, where `triggerTouchHide,
triggerTouchInteract` are listed): append `triggerTouchThrow`.

In `components/MobileControls.tsx`, add a new `ActionBtn` next to the existing Interact
button (line 309) — visible/enabled only when the mobile HUD state reports
`heldThrowable: true` (same conditional-render pattern the file already uses for other
state-gated buttons):

```tsx
{heldThrowable && <ActionBtn label="Throw" onTap={() => actions.triggerTouchThrow()} />}
```

`heldThrowable` must be threaded onto the pushed HUD state object the same way
`pickingUp`/`carrying` already are, so `MobileControls` (and `GameCanvas`'s desktop
prompt, §5) can read it without a new plumbing path.

## §7. `docs/ELEMENTS.md` (same PR, mandatory)

Add a new element row/entry for "Throwable (stone/twig)": verbs = pick up (`E`/Interact,
desktop+mobile), throw (left-click desktop / Throw button mobile); collision = none (not
`HIDE_KINDS`, not LOS-blocking, not a movement collider); interaction = triggers
`checkThrowableNoise()` against predators at the landing point, redirecting any predator
within `THROWABLE_NOISE_RADIUS` (24u) into `investigate`/`approach` targeting the landing
spot for 3–5s before reverting via the existing sniff/back/roam loop.

## Constraints (must not change)

- No new `p.state` or `p.inv` value.
- `stepApproach()` (`lib/game/predator.ts:225`) signature and body: unchanged.
- `shouldRevertInvestigateToChase()`: unchanged.
- `isNoiseHeard()`/`checkNoise()`/`hearNoise()`: unchanged — throwables are additive,
  parallel functions, per CTO plan decision 5.
- `coverData`/`HIDE_KINDS`: throwables never enter either.
- Desktop throw key is **left-click**, not `Space` — do not "fix" this back per the
  ticket's literal text; see §4.5.
- Carrying the child never gates grab or throw.
- Both platforms produce the same landing point / same noise check / same predator
  response — no divergent per-platform logic beyond the input trigger itself.

## Out of scope (explicit)

- Economy: cost, cooldown, currency, respawn (Economist, later).
- Procedural/randomized throwable placement — fixed rejection-sampled spawn for v1.
- Throw arc visuals / projectile animation — landing is instant/computed, not a simulated
  arc, for v1 (MVP per Scout proposal's "cheap version"; a visible arc is a follow-up if
  QA/Psychologist find the instant-landing unreadable).
- Feel/juice tuning of the landing-thud mix.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm test -- lib/game/noise.test.ts lib/game/outcome.test.ts` — new cases pass (§3).
3. `npm run lint` (`eslint`, not `next lint`) — clean.
4. `next build` — passes.
5. Manual/e2e (Tier C, blocking review — Game Tester or a throwaway Playwright repro per
   the development-first doc): pick up a throwable, throw it, confirm a predator within
   24u of the landing point abandons its current path and moves toward the landing point
   (not toward the live player) for several seconds, then gives up via the existing
   sniff/back/roam loop if the player stays hidden. Repeat on a mobile viewport using the
   new Throw button — same landing point (along current facing), same predator response.
6. No console errors on load.

## Routing

Founding Engineer (this spec) → Game Engineer implements off this file only, no
exploratory reads. Blocking Code Reviewer approval required before merge (Tier C).
