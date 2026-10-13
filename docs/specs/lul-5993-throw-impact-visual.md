# SPEC: LUL-5993 Throw-stone impact visual (landing VFX)

**Ticket:** LUL-5993 · **Tier:** B — `engine/forest-engine.js`, `e2e/throwables.spec.ts`. Merges
on green; review child issue opens after.

**Written against:** `release/next` @ `e944de1` (2026-10-13). Re-derive every `file:line` below
from the branch you actually implement on if it has moved — this plan's own citations had
already drifted a few lines from the CTO PLAN comment's numbers (e.g. `triggerRoostBurst` is
`:2121` here, `:2051` in the plan comment); re-check before trusting either.

Research: wiki `game/mechanics/throw-impact-visual` (Feature Checklist §0, already answered).
Decision: wiki `decisions/lul-5992-throw-impact-visual-accepted-2026-10-13` (scope ruling — do
not expand beyond it; see **Out of scope** below).

## Architecture (confirmed, no open call left)

Single shared instance, modeled on `fireBoom`/`updateBoom`/`boomGroup`/`boomStart`
(`:2081`/`:2090`/`:2027`/`:2038`) — **not** `triggerRoostBurst`'s per-site array
(`:2121`-`:2150`), which exists only because roosts are N *fixed* sites that can each flush
independently. A thrown stone has no fixed site and no throw cooldown (`canThrowThrowable`,
`:39`, only checks `heldThrowable`), so a second throw before the first visual decays simply
relocates the one shared instance to the new landing point — exactly what `fireBoom` already
does for overlapping booms. Do not build a parallel-array version.

**Call-site check (resolves the one ambiguity in the originating PLAN comment):**
`updateRoostBursts(dt)` (`:3657`, inside `updateRoosts()`) and `updateBoom(dt)` (`:9317`) are
*both* called from the same function, `stepFrame(dt, t, skipRender)` (`:8168`-`:9319`) — `:8601`
(`if(playing) updateRoosts(dt, running);`) and `:9317` are two call sites inside one function,
not two different tick loops. There is no fixed-step-vs-render distinction to resolve. Add
`updateThrowImpact(dt);` immediately next to `updateBoom(dt);` at `:9317` (same single-shared-
instance visual family), not next to `updateRoostBursts(dt)`.

## Files

- `engine/forest-engine.js` — add scene objects, `triggerThrowImpact()`, `updateThrowImpact()`,
  one call site in `stepFrame()`, one call site in `throwThrowable()`, one reset line in
  `restart()`, one new QA hook.
- `engine/forest-engine.d.ts` — declare `qaProbeThrowImpact`.
- `e2e/throwables.spec.ts` — extend (no `@fullmap`).
- `shared/local-qa/requests/lul-5992-throw-impact-visual.md` — new, in this repo (verified live:
  this directory is tracked and committed alongside its spec/e2e PR in every precedent checked —
  e.g. `8a1ede5` LUL-5565, `07f6a35` LUL-5627 — not a host-only path; do not confuse with the
  separate, older `/home/noam/.paperclip/shared/local-qa/requests/` host directory).

## The change

### 1. Scene objects (`engine/forest-engine.js`, next to `boomGroup`'s setup, after the
`roostGroups` block ends at `:2063` and before `fireBoom` at `:2081`)

```js
const throwImpactGroup = new THREE.Group(); throwImpactGroup.visible = false; scene.add(throwImpactGroup);
const throwImpactStoneMesh = new THREE.Mesh(throwableGeo, throwableMat);
throwImpactStoneMesh.scale.setScalar(0.28);   // matches layoutThrowableMeshes()'s stone scale, :1133
const THROW_IMPACT_PTS = 8;   // dust, not an explosion -- same "keep small" precedent as ROOST_BURST_PTS (:2043)
const tipArr = new Float32Array(THROW_IMPACT_PTS * 3), tipVel = [];
const throwImpactPts = new THREE.Points(new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: 0x8a7a5c, size: 0.3, transparent: true, opacity: 1,
    depthWrite: false, fog: false }));   // dust color, not ROOST_BURST's bird-silhouette dark
throwImpactPts.geometry.setAttribute('position', new THREE.BufferAttribute(tipArr, 3));
throwImpactGroup.add(throwImpactStoneMesh, throwImpactPts);
let throwImpactStart = -1;
let throwImpactReducedMotion = false;   // decided once per trigger, not re-checked every tick (see triggerThrowImpact)
```

`throwableGeo`/`throwableMat` are the existing module-level constants at `:767`-`:768` — reused
directly (read-only geometry/material reuse, same pattern `layoutThrowableMeshes()` already uses
for the `InstancedMesh`), not duplicated. A single `THREE.Mesh`, not another `InstancedMesh`: only
one landing is ever shown at a time.

### 2. `triggerThrowImpact(x, z)` — new function, placed immediately after `updateBoom()` ends
(after `:2117`'s closing brace, before the `:2119`-`:2120` roost-burst comment)

```js
function triggerThrowImpact(x, z){
  throwImpactGroup.position.set(x, 0.25, z);   // ground height, matches layoutThrowableMeshes() :1131
  throwImpactGroup.visible = true;
  throwImpactStart = 0;
  throwImpactReducedMotion = motionReduced();   // decided once here, not re-polled in updateThrowImpact
  throwImpactStoneMesh.material.opacity = 1;
  if(throwImpactReducedMotion){
    // LUL-5993: static full-opacity stone, no particle motion -- models the stoneMarkerPulseT
    // opacity-branch SHAPE at :8973-8974 (motionReduced() ? flat value : animated ramp), not its
    // exact numbers. Deliberately NOT modeled on triggerRoostBurst, which has no reducedMotion
    // gate at all (:2121-:2134) -- a pre-existing gap this ticket does not copy forward.
    throwImpactPts.material.opacity = 0;
  } else {
    tipVel.length = 0;
    for(let k=0;k<THROW_IMPACT_PTS;k++){
      const a = Math.random()*Math.PI*2;
      tipVel.push([Math.cos(a)*0.8, 1.5 + Math.random()*1.5, Math.sin(a)*0.8]);
      tipArr[k*3] = tipArr[k*3+1] = tipArr[k*3+2] = 0;
    }
    throwImpactPts.geometry.attributes.position.needsUpdate = true;
    throwImpactPts.material.opacity = 1;
  }
}
```

### 3. `updateThrowImpact(dt)` — new function, immediately after `triggerThrowImpact`

```js
function updateThrowImpact(dt){
  if(throwImpactStart < 0) return;
  throwImpactStart += dt; const e = throwImpactStart;
  if(!throwImpactReducedMotion){
    const arr = throwImpactPts.geometry.attributes.position.array;
    for(let k=0;k<THROW_IMPACT_PTS;k++){
      arr[k*3]   += tipVel[k][0]*dt;
      arr[k*3+1] += tipVel[k][1]*dt - 4*dt*e;
      arr[k*3+2] += tipVel[k][2]*dt;
    }
    throwImpactPts.geometry.attributes.position.needsUpdate = true;
    throwImpactPts.material.opacity = Math.max(0, 1 - e/1.3);
  }
  if(e > 1.3){ throwImpactGroup.visible = false; throwImpactStart = -1; }
}
```

Window is 1.3s (within the 1.2-1.5s range the PLAN gave) — stone mesh stays visible the whole
window at full opacity (no fade on the mesh itself, only the dust fades), matching `fireBoom`'s
plateau-then-cutoff shape rather than a continuous fade.

### 4. Call sites

- `stepFrame()`, immediately next to `updateBoom(dt);` at `:9317`:
  ```js
  updateBoom(dt);
  updateThrowImpact(dt);
  ```
- `throwThrowable()` (`:7225`-`:7271`), immediately after the `leafRustle(false);` line at
  `:7234` (landing thud — `landX`/`landZ` are already computed at `:7232`-`:7233`):
  ```js
  leafRustle(false);
  triggerThrowImpact(landX, landZ);
  ```
  Do **not** touch `canThrowThrowable`'s guard (`:39`) or add any delay — landing stays instant
  per the decision's explicit scope boundary.
- `restart()`, next to the existing `boomGroup` reset at `:7794`:
  ```js
  pickBoomed = false; boomGroup.visible = false; boomStart = -1; if(flashEl) flashEl.style.opacity = '0';
  throwImpactGroup.visible = false; throwImpactStart = -1;
  ```

### 5. QA hook (`engine/forest-engine.js`, same `?qaHooks` block, next to `qaProbeEmbersPurchase`
at `:6760`)

```js
// [QA-HOOK] LUL-5993: exposes the throw-impact visual's transient state so a spec can assert
// it activates on throw and decays within the expected window, mirroring
// qaProbeEmbersPurchase's plain-state-readout shape.
window.ForestEngine.qaProbeThrowImpact = function(){
  return { active: throwImpactStart >= 0, elapsedS: throwImpactStart };
};
```

`engine/forest-engine.d.ts`, next to `qaProbeEmbersPurchase` at `:630`:

```ts
/** LUL-5993: the throw-impact landing visual's transient state (active + elapsed seconds since
 * trigger, -1 while idle) -- lets a test assert it activates on throw and decays on schedule. */
qaProbeThrowImpact?: () => { active: boolean; elapsedS: number };
```

## Verification

- `npx tsc --noEmit` — no new errors (pre-existing unrelated `app/layout.tsx` `LayoutProps`
  error is known, see LUL-5948 precedent; confirm nothing else changed).
- `node scripts/check-elements-citations.mjs` — clean (no `docs/ELEMENTS.md` citation this spec
  invalidates; if the implementer touches `ELEMENTS.md` for this feature, re-run after).
- `npx eslint engine/forest-engine.js engine/forest-engine.d.ts e2e/throwables.spec.ts` — clean.
- `npx playwright test e2e/throwables.spec.ts` — all four tests (two existing, two new/extended
  per below) pass locally.
- `next build` — clean.

## e2e

**Specs.** `e2e/throwables.spec.ts` inside the existing `describe('throwables (LUL-1623)', ...)`
block (today 120 lines, `:33`-`:119`):

1. **New test** — `'throwing shows the landing visual and it decays'`:
   `qaTeleportNearThrowable()` → `KeyE` → confirm `document.pointerLockElement !== null` (same
   pattern as the existing `'throwing clears heldThrowable...'` test, `:55`-`:74`) → `page.mouse
   .click(VIEW_X, VIEW_Y)` → `qaHook(page, 'qaProbeThrowImpact')` and assert `active: true,
   elapsedS` small (< 0.1) → `qaHook(page, 'qaSetFixedStep', FIXED_DT)` (set **before** the throw,
   same as the third existing test does at `:80`, so the decay window advances deterministically)
   → `qaHook(page, 'qaAdvance', stepsFor(1.5))` → assert `qaProbeThrowImpact().active === false`.
2. **Extended test** — `'a thrown rock lures a nearby roaming predator into investigate'`
   (`:76`-`:119`, existing): add a regression guard. Capture the step count `advanceUntil` took to
   reach `investigate` (`:108`-`:112`) on this branch and compare it isn't larger than before this
   change (there is no "before" branch to diff against in the same run, so the guard is: add a
   comment at the `reachedInvestigate` assertion citing `decisions/lul-1869` and the instant-
   landing scope boundary, plus assert `qaProbeThrowImpact().active === true` immediately after
   the click and before `advanceUntil` starts polling — proves the new visual fires in the same
   frame as the existing noise-redirect logic, not staggered behind it, i.e. the new call does
   not introduce a frame of delay before `checkThrowableNoise()`/`hearThrowableNoise()` run (both
   already execute synchronously in `throwThrowable()` before `triggerThrowImpact()` is even
   reached per the call-site ordering in **The change** §4, so this assertion should hold trivially
   — its value is catching a *future* edit that reorders the calls, not catching anything in this
   PR).
3. Both tests stay in the micro world (`boot(page, { qaHooks: true })`, no `qaBuildScene` needed)
   — reuses the existing throwable-spawn machinery already present in the micro world, same as
   every other test in this file.

**World.** micro (default, no `@fullmap`).

**Hooks.** `window.ForestEngine.qaProbeThrowImpact(): { active: boolean; elapsedS: number }` —
new, declared in `engine/forest-engine.d.ts` (`:630` area), installed in the `?qaHooks` block in
`init()` (`:6760` area). All other hooks used (`qaTeleportNearThrowable`, `qaSetFixedStep`,
`qaAdvance`, `qaStagePredatorNearThrowLanding`, `qaProbePredatorState`) already exist and are
unchanged.

**Tester scenario.** `shared/local-qa/requests/lul-5992-throw-impact-visual.md` (new, filed with
this spec — kept under the LUL-5992 filename per the research page's own naming choice, not
LUL-5993). Desktop (`desktop-1280x720`) + one mobile landscape viewport
(`pixel5-landscape-727x393`), steps: boot → enter → `qaTeleportNearThrowable` → `KeyE` →
click/tap throw → `qaProbeThrowImpact()` goes active → decays within ~1.5s. Screenshots at
throw-moment and post-decay.

**Not covered.** Actual on-screen look (stone mesh orientation, dust color/density reading as
"dust" rather than noise) — feel, stays manual via the tester's screenshot capture above.

## Cues

**Visual.** New: the landed-stone mesh + dust-burst `Points` at the throw's landing point,
`throwImpactGroup` (`engine/forest-engine.js`, new, placed per §1 above), triggered from
`throwThrowable()` (`:7234`-area) via `triggerThrowImpact()`. This is the one real gap the
decision identified — the other two legs below already ship.

**Audio.** Existing, unchanged: `leafRustle(false)` at `:7234`, `soundOn`-gated (verified live at
the call site; `leafRustle`'s own definition gates on `soundOn` same as every other cue sound in
this file). No new sound — the decision's research confirmed the landing thud already covers
this leg.

**Explanation.** Existing, unchanged: `#throwPrompt`'s persistent text while `heldThrowable`
(`components/Hud.tsx:1401`-`1411`, gated by `state.heldThrowable && hudLive`) already tells the
player what the throw does before they do it. No new copy — the decision's research confirmed
this leg already ships.

**Reduced motion.** New visual degrades to a static full-opacity stone mesh with the dust
`Points` held at `opacity = 0` for its whole lifetime (no particle motion computed at all, not
just hidden after computing) — see `triggerThrowImpact`'s `reducedMotion` branch in §2. Decided
once per trigger in `triggerThrowImpact`, not re-checked every tick in `updateThrowImpact`.

## Constraints

- Landing must stay instant — no projectile arc, no travel-time delay added anywhere in
  `throwThrowable()`. `triggerThrowImpact()` is called synchronously in the same tick the stone
  lands, same as every other landing-side-effect already in that function.
- `canThrowThrowable`'s guard (`:39`) is untouched — no new cooldown introduced by this visual.
- `updateThrowImpact(dt)` must be a no-op whenever `throwImpactStart < 0` — it runs every frame
  via `stepFrame()` regardless of whether a throw is in flight.
- Tier B: merges on green, review child issue opens after merge, not before.

## Out of scope

- Simulated projectile arc / travel-time change — declined in the decision page; would reopen the
  throw-timing economy (`decisions/lul-1869`) that already prices near-instant impact.
- First-person throw-arm animation — `armsGroup` is reserved for the carry-baby cinematic;
  declined in the decision page as a separate, larger change.
- `docs/CUES.md:24`'s stale "MISSING for pickup" note — real but unrelated gap (the pickup
  prompt itself already ships via LUL-2614); a one-line docs-only correction for whenever is
  convenient, not bundled here per the decision page.

## Split

- **Founding Engineer** (this spec): done — hand off to Game Engineer for implementation.
- **Game Engineer**: implement per this spec, including the new request file at
  `shared/local-qa/requests/lul-5992-throw-impact-visual.md` in the same PR. Tier B — merge on
  green, open the review child issue after.
