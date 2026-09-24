# SPEC: LUL-5104 Drowned Car Refuge

**Ticket:** LUL-5104 · **Tier:** A — cheap slice, same file-span shape as PR#875 (Chapel
Sanctuary): `engine/forest-engine.js`, `engine/tuning.js`, `engine/forest-engine.d.ts`,
`components/Hud.tsx`, `docs/ELEMENTS.md`, one e2e spec, one local-qa request file. No
`MissionKind`/`mission.ts` change (see Constraints). Tier A merges on green CI; no
`REVIEW: APPROVED` gate.

**Written against:** `release/next` @ `af3d874` (2026-09-25). Re-derive every `file:line`
below from the branch you actually implement on if it has moved — PR#875 (Chapel Sanctuary,
merged `2db983b`) already caused several citation drifts elsewhere in this file, expect the
same here.

**Scoping ruling this SPEC implements:** wiki
`decisions/lul-5101-refuge-landmark-retarget-2026-09-25` (CTO). That ruling already closed
the two items Scout flagged on the parent proposal (LUL-5101) as needing CTO scoping before
a tier could be assigned: Q1.5 (which landmark, and why not the literal Fire Tower) and Q13
(local-qa request path + hooks). This SPEC does not reopen either.

## Player Experience

Mechanically identical to Chapel Sanctuary (`game/mechanics/chapel-sanctuary.md`): a second,
free, one-shot-per-run route to `veilReserve = true`. The **only** substantive differences
are the landmark (`drownedCar` instead of `chapelSteeple`) and the fact that this variant's
own e2e coverage stages a predator during the dwell — Chapel Sanctuary's Q11 explicitly
skipped that ("no predator interaction specified in this cheap slice"); this ticket exists
specifically to close that gap at a second landmark, per Scout's own "generalizes to other
landmarks" follow-up.

Deep in the outer ring, a drowned car sits half-submerged — currently beacon-glow only, no
interact mechanic (`engine/forest-engine.js:1261-1272`, confirmed zero E-key/mission
reference against `origin/release/next`). Approach within 4 units and the E-key prompt reads
"Drowned car refuge." Press E to start a 15s dwell; leave early and nothing is granted or
consumed — come back and try again. Complete the full 15s and you leave with `veilReserve`,
free, exactly the same charm `buyVeilCharm()` sells at the Stone Marker for embers, and
exactly the same charm Chapel Sanctuary already grants for free at its own landmark.

## Files

- `engine/tuning.js` — edited: two new tunables.
- `engine/forest-engine.js` — edited: state, dwell/grant/early-exit tick logic, `KeyE` +
  `triggerTouchInteract()` wiring, cue functions, two new QA hooks, per-run reset in
  `enter()`.
- `engine/forest-engine.d.ts` — edited: type declarations for the two new QA hooks.
- `components/Hud.tsx` — edited: `EngineHudState` fields, default state, `#drownedCarRefugePanel`
  countdown, `#drownedCarRefugePrompt` `#actionSlot` row.
- `docs/ELEMENTS.md` — edited: new "Drowned Car Refuge" entry, same shape as the existing
  "Chapel Sanctuary" entry at `:2097`.
- `e2e/drowned-car-refuge.spec.ts` — created.
- `shared/local-qa/requests/lul-5101-drowned-car-refuge.md` — created (path fixed by the
  CTO ruling — name it `drowned-car`, keyed to the parent proposal ticket LUL-5101, not
  `fire-tower` and not LUL-5104).

## The change

### 1. Tunables (`engine/tuning.js`, alongside `CHAPEL_SANCTUARY_*` at `:93-94`)

```js
export const DROWNED_CAR_REFUGE_INTERACT_RADIUS = 4;
export const DROWNED_CAR_REFUGE_DURATION = 15;   // seconds of dwell required for the free grant
```

The `drownedCar` landmark already exists in `LANDMARKS` (`engine/tuning.js:67`, `x:-95,
z:46, clear: 11, cr: 2.3`) and already has a populated `landmarkGroups.drownedCar` group
(built generically from `LANDMARKS` — see `engine/forest-engine.js:1360-1387`, the same
loop that builds `landmarkGroups.chapelSteeple`). No new landmark registration needed.

### 2. Engine state (`engine/forest-engine.js`, alongside the `chapelSanctuary*` flags at
`:603`)

```js
let drownedCarRefugeActive = false, drownedCarRefugeChargeT = 0, drownedCarRefugeUsedThisRun = false;
```

Import the two new tunables into the existing destructured import block at `:200`
(`CHAPEL_SANCTUARY_INTERACT_RADIUS, CHAPEL_SANCTUARY_DURATION,` →  add
`DROWNED_CAR_REFUGE_INTERACT_RADIUS, DROWNED_CAR_REFUGE_DURATION,`).

### 3. Per-run reset (`engine/forest-engine.js:1412`, same `enter()` line that resets the
chapel flags)

```js
chapelSanctuaryActive = false; chapelSanctuaryChargeT = 0; chapelSanctuaryUsedThisRun = false;
drownedCarRefugeActive = false; drownedCarRefugeChargeT = 0; drownedCarRefugeUsedThisRun = false;
```

Deliberately **not** reset on `arriveHome()`/child set-down — identical Q1.5 reasoning to
Chapel Sanctuary: that carry-leg path is dead in real play
(`decisions/lul-2281-pickup-is-the-win-2026-09-09`), so `drownedCarRefugeUsedThisRun` simply
starts `false` each run and never resets mid-run.

### 4. Prompt-gate declarations (`engine/forest-engine.js:3010-3011`, alongside
`chapelSanctuaryInRadius`/`chapelSanctuaryPromptVisible`)

```js
drownedCarRefugeInRadius = false,
drownedCarRefugePromptVisible = false;
```

### 5. Per-tick distance + gate (`engine/forest-engine.js:7217-7224`, same block that
computes `distChapel`)

```js
const distDrownedCar = Math.hypot(player.x - landmarkGroups.drownedCar.position.x, player.z - landmarkGroups.drownedCar.position.z);
drownedCarRefugeInRadius = distDrownedCar < DROWNED_CAR_REFUGE_INTERACT_RADIUS;
drownedCarRefugePromptVisible = drownedCarRefugeInRadius && !drownedCarRefugeUsedThisRun && !drownedCarRefugeActive;
```

### 6. `KeyE` handler (`engine/forest-engine.js:3119-3129`) — insert right after the
`chapelSanctuary*` branches, same else-if chain

```js
if(e.code === 'KeyE' && playing && !paused){
  if(canPickup) pickup();
  else if(canBuyVeilCharm) buyVeilCharm();
  else if(chapelSanctuaryPromptVisible) startChapelSanctuary();
  else if(chapelSanctuaryInRadius && chapelSanctuaryUsedThisRun && !chapelSanctuaryActive) chapelSanctuaryDeniedCue();
  else if(drownedCarRefugePromptVisible) startDrownedCarRefuge();
  else if(drownedCarRefugeInRadius && drownedCarRefugeUsedThisRun && !drownedCarRefugeActive) drownedCarRefugeDeniedCue();
  else if(missionCanComplete) completeMissionSequence();
  else if(secondaryCanComplete) completeSecondarySequence();
  else grabThrowable();
}
```

Order versus the chapel branches is arbitrary — the two landmarks are >100 units apart
(`drownedCar` at `x:-95,z:46` vs `chapelSteeple` at `x:20,z:-178`, `Math.hypot(115, 224) ≈
252`), so `chapelSanctuaryPromptVisible` and `drownedCarRefugePromptVisible` can never both
be true in the same frame — see Q7 below. Placing it after chapel rather than before keeps
the diff a pure insertion.

**Touch parity** (`engine/forest-engine.js`, `triggerTouchInteract()`, mirrors the desktop
chain at `:7783-7784`):

```js
else if(chapelSanctuaryPromptVisible) startChapelSanctuary();
else if(chapelSanctuaryInRadius && chapelSanctuaryUsedThisRun && !chapelSanctuaryActive) chapelSanctuaryDeniedCue();
else if(drownedCarRefugePromptVisible) startDrownedCarRefuge();
else if(drownedCarRefugeInRadius && drownedCarRefugeUsedThisRun && !drownedCarRefugeActive) drownedCarRefugeDeniedCue();
```

### 7. Dwell loop (`engine/forest-engine.js`, next to `startChapelSanctuary()` at `:6011-6018`
and the active-dwell tick block at `:7339-7351`)

```js
function startDrownedCarRefuge(){
  drownedCarRefugeActive = true;
  drownedCarRefugeChargeT = DROWNED_CAR_REFUGE_DURATION;
  drownedCarRefugeStartCue();
}
```

```js
// per-frame update, alongside the chapelSanctuaryActive block at :7339-7351
if(drownedCarRefugeActive){
  drownedCarRefugeChargeT = Math.max(0, drownedCarRefugeChargeT - dt);
  if(drownedCarRefugeChargeT === 0){
    veilReserve = true;
    drownedCarRefugeUsedThisRun = true;
    drownedCarRefugeActive = false;
    drownedCarRefugeGrantCue();
  } else if(distDrownedCar > DROWNED_CAR_REFUGE_INTERACT_RADIUS * 1.5){
    drownedCarRefugeActive = false;
    drownedCarRefugeChargeT = 0;
    drownedCarRefugeEarlyExitCue();
  }
}
```

This is the piece the CTO ruling calls out explicitly: **no new completion branch is
needed for predator pressure.** A predator closing on the player during the dwell has no
special-cased interaction here — if the player breaks position to flee (the correct real
response to a closing predator), `distDrownedCar` exceeds `1.5x` the interact radius and
the existing early-exit branch fires: nothing granted, nothing consumed, gate stays open.
If the predator does not close the distance, the dwell completes normally. The e2e spec
(below) is what proves this is actually true under a staged predator, not a new engine
branch.

### 8. Cues (`engine/forest-engine.js`, alongside `chapelSanctuaryStartCue()` /
`chapelSanctuaryDeniedCue()` / `chapelSanctuaryEarlyExitCue()` at `:6266-6296`)

```js
let qaDrownedCarRefugeStartCueCount = 0, qaDrownedCarRefugeDeniedCueCount = 0, qaDrownedCarRefugeEarlyExitCueCount = 0;
function drownedCarRefugeStartCue(){ /* identical triangle 220->330Hz sweep, mirrors chapelSanctuaryStartCue() body exactly */ }
function drownedCarRefugeGrantCue(){
  embersPurchaseCue();   // reuse — same charm, same tell, whichever route granted it (Q6/Q7)
  if(captionsOn) pushState({ caption: 'a charm against the mist', captionId: ++captionSeq });
}
function drownedCarRefugeDeniedCue(){ /* identical square/100Hz/~0.17s buzz, mirrors chapelSanctuaryDeniedCue() body exactly, caption 'Refuge unavailable -- one-time per run' */ }
function drownedCarRefugeEarlyExitCue(){ /* identical quieter triangle 260->180Hz, mirrors chapelSanctuaryEarlyExitCue() body exactly, caption 'left the drowned car early -- nothing happened' */ }
```

Note: Chapel Sanctuary's own grant path does **not** have a separate `chapelSanctuaryGrantCue()`
— it calls `embersPurchaseCue()` directly inline in the `tick()` full-dwell branch (mirrors
`buyVeilCharm()`'s own cue call). Follow that exact shape here — `drownedCarRefugeGrantCue()`
above is written out as a named function for clarity in this SPEC; the implementer should
match whatever Chapel Sanctuary's real `tick()` branch does line-for-line (inline call vs.
wrapper) so the two features stay structurally identical, not just behaviorally identical.
Do **not** add a `drownedCarRefugeGrantCueCount` QA counter if Chapel Sanctuary's grant path
has none of its own — `qaProbeVeil()` already answers "did a grant happen" via `reserve`.

Start/denied/early-exit counters (`qaDrownedCarRefugeStartCueCount` etc.) exist only because
`qaProbeChapelSanctuary()`'s shape exposes the equivalent three — mirror exactly, no more,
no fewer.

### 9. HUD state exposure (`components/Hud.tsx`, `EngineHudState` interface `:79-81`)

```ts
drownedCarRefugeActive: boolean;
drownedCarRefugeChargeT: number;
drownedCarRefugePromptVisible: boolean;
```

Default state object (`components/Hud.tsx:280-282`):

```ts
drownedCarRefugeActive: false,
drownedCarRefugeChargeT: 0,
drownedCarRefugePromptVisible: false,
```

### 10. HUD panel (`components/Hud.tsx`, alongside `#chapelSanctuaryPanel` at `:1045-1048`)

```jsx
{state.drownedCarRefugeActive && (
  <div id="drownedCarRefugePanel">
    Refuge · {Math.ceil(state.drownedCarRefugeChargeT)}s
  </div>
)}
```

Sibling of `#caveImmunePanel`/`#chapelSanctuaryPanel`, outside `#panel` — stays visible with
`adminMode` off (Q3, same as chapel).

### 11. HUD prompt row (`components/Hud.tsx`, alongside `#chapelSanctuaryPrompt` at
`:1259-1263`, inside `#actionSlot`)

```jsx
<ActionPrompt
  id="drownedCarRefugePrompt"
  visible={state.drownedCarRefugePromptVisible && hudLive}
  tone="calm"
  text="Press  E  for drowned car refuge — shelter 15s for a free charm against the mist"
/>
```

No `onPointerDown` — same reasoning as `chapelSanctuaryPrompt`: E-key/`triggerTouchInteract()`
(the shared MobileControls "E" button) is what actually starts the dwell.

### 12. QA hooks (`engine/forest-engine.js`, alongside `qaProbeChapelSanctuary()` /
`qaTeleportNearChapel()` at `:5712-5727`; declare in `engine/forest-engine.d.ts` alongside
the existing declarations at `:560-565`)

```js
window.ForestEngine.qaProbeDrownedCarRefuge = function(){
  return {
    drownedCarRefugeActive, drownedCarRefugeChargeT, drownedCarRefugeUsedThisRun,
    promptVisible: drownedCarRefugePromptVisible,
    startCueCount: qaDrownedCarRefugeStartCueCount,
    deniedCueCount: qaDrownedCarRefugeDeniedCueCount,
    earlyExitCueCount: qaDrownedCarRefugeEarlyExitCueCount,
  };
};
window.ForestEngine.qaTeleportNearDrownedCar = function(){
  const p = landmarkGroups.drownedCar.position;
  player.x = p.x + 2; player.z = p.z;
  return { x: p.x, z: p.z };
};
```

`.d.ts` declarations mirror `qaProbeChapelSanctuary?`/`qaTeleportNearChapel?` exactly, typed
`{ drownedCarRefugeActive: boolean; drownedCarRefugeChargeT: number;
drownedCarRefugeUsedThisRun: boolean; promptVisible: boolean; startCueCount: number;
deniedCueCount: number; earlyExitCueCount: number }` and `() => { x: number; z: number }`
respectively.

`qaStagePredatorNearPlayer(kind, dx, dz)` (`engine/forest-engine.js:5615`, declared
`forest-engine.d.ts:511`) already exists and needs no changes — it places `predators[kind]`
at an offset from the player's *current* position, which is exactly what the e2e spec below
needs after `qaTeleportNearDrownedCar()`.

### 13. `docs/ELEMENTS.md`

Add a "Drowned Car Refuge (LUL-5104, second free `veilReserve` refuge)" entry immediately
after the existing "Chapel Sanctuary" entry (`:2097` onward), same subsection shape ("What
it is" / "What it can do" / "What it CANNOT do" / "Behaviours & logic"). Call out explicitly
in "What it CANNOT do": cannot fire the same frame as Chapel Sanctuary or the Stone Marker
purchase (landmarks >100 units apart, `LANDMARKS`), and is not a `MissionKind` — it is not
in `MISSION_POOL` (`lib/game/mission.ts:57-102`) and never will be (CTO ruling, see below).

## Verification

- `npx tsc --noEmit` — no new type errors (in particular: `EngineHudState` additions match
  `init()`'s return object exactly, and `ENGINE_ACTION_KEYS` in `lib/engine-contract.ts`
  needs **no** change — this feature adds HUD-state fields, not a new `EngineActions`
  method; the E-key handler stays internal to the engine, same as Chapel Sanctuary).
- `npm run lint` (eslint) — clean.
- `npm test` (unit tests) — existing suite green, no unit test targets this feature (it has
  no pure-function logic split out, same as Chapel Sanctuary).
- `node scripts/check-elements-citations.mjs` — clean, including any citation drift this
  diff's own line-shifts cause elsewhere in `docs/ELEMENTS.md` (the chapel PR needed 6
  hand-fixes here; budget time for the same).
- `node scripts/check-duplicate-logic.mjs` — clean.
- `next build` — clean.
- `npx playwright test e2e/drowned-car-refuge.spec.ts` — all scenarios pass locally before
  push (rig CI re-runs it; see `## e2e` below for what it must NOT depend on —
  `E2E_FULLMAP=1`).

## e2e

**Specs.** `e2e/drowned-car-refuge.spec.ts` (new):
- `'a full 15s dwell grants veilReserve for free and closes the one-shot gate'` — same
  timer/grant assertions as Chapel Sanctuary's equivalent test, at the `drownedCar`
  landmark.
- `'leaving the radius before the dwell completes grants nothing and leaves the gate open
  for a retry'` — same early-exit assertions, at `drownedCar`.
- `'a predator closing on the player mid-dwell breaks the dwell via the existing early-exit
  path'` (**new coverage, not in Chapel Sanctuary** — this is the opposing-system test the
  CTO ruling and Chapel Sanctuary's own Q11 both call out): teleport to `drownedCar`, start
  the dwell, stage a predator within detection range but outside lethal range partway
  through the 15s via `qaStagePredatorNearPlayer('wolf', dx, dz)`, move the player away in
  response (the correct real-player action against a closing predator), and assert
  `qaProbeDrownedCarRefuge().drownedCarRefugeActive` becomes `false`,
  `drownedCarRefugeUsedThisRun` stays `false`, and `qaProbeVeil().reserve` stays `false` —
  proving the predator-pressure scenario resolves through the *existing* early-exit branch
  with no new completion path.
- `'a predator staged nearby that never closes the distance does not interrupt the dwell'`
  — companion case: stage the predator far enough that `distDrownedCar` never exceeds
  `DROWNED_CAR_REFUGE_INTERACT_RADIUS * 1.5`, advance the full 15s, assert the grant still
  completes normally (`qaProbeVeil().reserve` becomes `true`) — proves predator *presence*
  alone doesn't break the mechanic, only the player's own distance does, matching the
  "predators already roam the full map, no new engine state" premise in the CTO ruling.
- `'displays countdown timer on HUD while active'` — same HUD assertion shape as Chapel
  Sanctuary's, on `#drownedCarRefugePanel`.
- `'repeat E-press after the gate closes fires the denied cue'` — mirrors Chapel Sanctuary's
  denied-cue coverage.
- `captionsOn`/`reducedMotion` degraded-cue assertions — mirror Chapel Sanctuary's spec
  structure (`enableCaptions()`/`enableReducedMotion()` helpers already exist in
  `e2e/chapel-sanctuary.spec.ts`, reusable via `./helpers` if not already there).

Use `qaSetFixedStep`/`advanceChunked` (fixed sim-time ticks) to drive the 15s dwell, **not**
`page.waitForTimeout()` — same `DT_CLAMP_CEILING` wall-clock-drift reasoning documented at
the top of `e2e/chapel-sanctuary.spec.ts`.

**World.** micro (default) — `qaBuildScene({})` is sufficient; `LANDMARKS` positions
(including `drownedCar`) are untouched by `applyQaWorldMicroPreset()`, same as chapel. No
`@fullmap` tag, no allowlist entry needed.

**Hooks.**
- `qaTeleportNearDrownedCar(): { x: number; z: number }` — new, declared in
  `engine/forest-engine.d.ts`, installed in `init()`'s `?qaHooks` block. Mirrors
  `qaTeleportNearChapel()`.
- `qaProbeDrownedCarRefuge(): { drownedCarRefugeActive: boolean; drownedCarRefugeChargeT:
  number; drownedCarRefugeUsedThisRun: boolean; promptVisible: boolean; startCueCount:
  number; deniedCueCount: number; earlyExitCueCount: number }` — new, mirrors
  `qaProbeChapelSanctuary()`.
- `qaStagePredatorNearPlayer(kind, dx, dz)` — existing (`engine/forest-engine.js:5615`), no
  change needed.
- `qaProbeVeil()` — existing, reused to assert the shared `veilReserve` grant target.
- `qaSetFixedStep(dt)` / `qaAdvance` (via `advanceChunked` helper) — existing.

**Tester scenario.** Request file `shared/local-qa/requests/lul-5101-drowned-car-refuge.md`
(created with this spec, per CTO ruling Q13 — keyed to the parent proposal ticket LUL-5101,
not LUL-5104):
1. Start run at default difficulty.
2. Confirm `veilReserve` is false.
3. Navigate to the drowned car (outer ring, `x:-95, z:46`).
4. Enter refuge via E-key, hold position 15s.
5. Verify: `veilReserve` is now true, the "a charm against the mist" cue fired.
6. Attempt re-entry — confirm blocked (denied cue, no prompt).
7. Separately: repeat 1–4 but leave after ~3s. Verify `veilReserve` still false, prompt
   still available.
8. Separately: repeat 1–4, but have a predator wander near the drowned car partway through
   the dwell (real roam AI, not staged — this is the nightly rig's one chance to catch
   real-predator-pathing interaction the e2e micro-world staging can't). Note whether the
   dwell broke correctly (gate stays open, nothing granted) if the predator closed distance,
   or completed normally if it did not.

**Not covered.** Feel/audio subjective quality (cue pitch/timbre "sounds right") and the
beacon-glow pulse's visual polish stay manual, same as Chapel Sanctuary — this SPEC reuses
`buyVeilCharm()`'s existing grant cue verbatim, so no new audio design review is needed.
Real-predator-pathing interaction with the refuge (item 8 above) is nightly-rig-only, not
e2e — the e2e spec staging (`qaStagePredatorNearPlayer`) proves the *engine logic* handles a
nearby predator correctly; it does not and cannot prove real AI pathing behaves any
particular way near the landmark.

## Cues

**Visual.** Landmark beacon-glow pulse boost on grant (`chapelSanctuaryPulseT` pattern,
`engine/forest-engine.js:7474-7475` — add a `drownedCarRefugePulseT` mirror gated on `kind
=== 'drownedCar'`), same color/scale/opacity shape already defined for `drownedCar` in
`LANDMARK_VISUALS` (`engine/tuning.js:119`).
**Audio.** Grant reuses `embersPurchaseCue()` (`engine/forest-engine.js:6058`, existing — no
new sound). Start/denied/early-exit cues are new but structurally identical to Chapel
Sanctuary's three (see § 8 above), gated on `soundOn`.
**Explanation.** Entry caption on E-press start: `"Drowned car refuge — shelter 15s for a
free charm against the mist. One-time per run."` (`startDrownedCarRefuge()` call site, new).
Grant caption reuses `'a charm against the mist'` (existing, `buyVeilCharm()`'s own).
Denied caption: `'Refuge unavailable -- one-time per run'` (new,
`drownedCarRefugeDeniedCue()`). Early-exit caption: `'left the drowned car early -- nothing
happened'` (new, `drownedCarRefugeEarlyExitCue()`). All gated on `captionsOn`.
**Reduced motion.** Beacon-glow pulse skips the animated ramp and shows at static boosted
brightness, same degrade Chapel Sanctuary's `chapelSanctuaryPulseT` already gets via
`motionReduced()` (`engine/forest-engine.js:7475`).

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- **Not a `MissionKind`.** Do not add an entry to `MISSION_POOL`
  (`lib/game/mission.ts:57-102`). This mechanic stays entirely outside `lib/game/mission.ts`
  — standalone engine flags only, landmark-interact-gated, same as Chapel Sanctuary. Adding
  it to `MISSION_POOL` would make it compete with/replace the player's real run objective on
  a fraction of runs, which is explicitly ruled out (CTO ruling, LUL-5101 decision doc).
- **Landmark is `drownedCar`, not `fireTower`.** Do not retarget to the literal Fire Tower —
  `fireTower` is already the `'deepwater'` mission's E-key completion target
  (`lib/game/mission.ts:94`, `engine/forest-engine.js:7159`) and a refuge prompt there would
  intercept the E-key ahead of `missionCanComplete` in the same if/else-if chain on any run
  where `deepwater` is drawn. This is the exact collision
  `decisions/lul-1697-retrieval-landmark-radiomast-2026-09-08` already retargeted away from
  once; do not reintroduce it here.
- **Cue/state shape must mirror Chapel Sanctuary structurally, not just behaviorally** — same
  variable naming pattern (`drownedCarRefuge*` instead of `chapelSanctuary*`), same function
  shapes, same QA-hook shapes. A reviewer or future engineer generalizing this pattern to a
  third landmark should be able to diff the two implementations and see only the
  landmark-specific values differ.
- Pure additions — no existing Chapel Sanctuary, Stone Marker, or mission-completion
  behavior changes.

## Out of scope

- Any change to `veilCharge` (the auto-regenerating resource) — this feature, like Chapel
  Sanctuary, only ever touches `veilReserve`.
- Animated shelter pose, interior mesh detail, ambient audio layering beyond the cue triple
  — Tier B if ever pursued, not scoped here.
- A third/fourth refuge-variant landmark — this SPEC covers `drownedCar` only. If the
  pattern generalizes further, that is a new SPEC with its own landmark-occupancy check
  (same shape as the LUL-5101 decision doc's table).
- Difficulty/economy tuning of `DROWNED_CAR_REFUGE_DURATION` — ships with the same `15`
  Chapel Sanctuary uses; Game Economist can revise via tuning-only follow-up without a new
  spec revision, same standing arrangement as `CHAPEL_SANCTUARY_DURATION` (LUL-5072).

---

## Feature Checklist Section 0 — carried-over and differing answers

Per `docs/FEATURE_CHECKLIST.md` § 0. Q2–Q6, Q9–Q10, Q15–Q16 carry over unchanged from
`game/mechanics/chapel-sanctuary.md` (same readout/cue-triple/HUD-panel/gate-reset pattern —
see that page for the full prose). Only the differing answers are restated here.

**Q1 (state → pixels).** `drownedCarRefugeActive`/`ChargeT` → `#drownedCarRefugePanel`
("Refuge · Xs"); `drownedCarRefugeUsedThisRun` → no pixels, engine-only gate (identical
shape to chapel's table).

**Q1.5 (trigger reachability).** Trigger `!drownedCarRefugeUsedThisRun`, reset `false` only
at run start (`enter()`, § 3 above) — a real, always-reachable player-input code path (E-key
in radius, no QA hook involved), same as Chapel Sanctuary's identical answer. Landmark
occupancy re-verified against `origin/release/next` this SPEC (§ "The change" — `drownedCar`
has zero existing interact code, confirmed by grep).

**Q7/Q8 (duplicate check).** Not a duplicate of Chapel Sanctuary: two independent grant
*routes* to the one existing `veilReserve` flag, mutually exclusive by landmark separation
(`drownedCar` `x:-95,z:46` vs. `chapelSteeple` `x:20,z:-178`, `Math.hypot(115,224) ≈ 252`
units apart — cannot both be in interact radius the same frame), exactly the "generalizes to
other landmarks" relationship Scout's own proposal analysis called out, structurally the
same as chapel vs. Stone Marker already established. No copy dies; no new readout needed for
`veilReserve` itself.

**Q11/Q12 (opposing system + rig execution).** New: `'a predator closing on the player
mid-dwell breaks the dwell via the existing early-exit path'` and its companion
non-interrupting case, staged via `qaStagePredatorNearPlayer()` — the piece Chapel
Sanctuary's own Q11 explicitly declined. Executes on the QA rig (micro world, no
`@fullmap`).

**Q13 (local-qa request).** `shared/local-qa/requests/lul-5101-drowned-car-refuge.md`
(created with this SPEC). Hooks: `qaPositionPlayer`/`qaTeleportNearDrownedCar`,
`qaSetEngineState`/`qaGetEngineState`, `qaStagePredatorNearPlayer` — all exist or are added
in this SPEC, no gap.

**Q14 (baseline).** `~/.paperclip/shared/local-qa/state/e2e-baseline.json`, date
`2026-09-24`: 3 failing, all in `beacon-hunter.spec.ts` — no overlap with `drownedCarRefuge*`
state (re-check at implementation time per standing practice).
