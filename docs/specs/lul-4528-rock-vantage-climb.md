# SPEC: LUL-4528 Rock — Vantage Climb (sightline-only cut)

**Ticket:** LUL-4528 · **Tier:** C — extends the predator detection-weight multiplier chain
(`effectiveDetect()`/`canSee()`) and the camera-height (`eyeH`) simulation path. `REVIEW:
APPROVED` required before merge, per the CTO's PLAN comment on this ticket.

**Written against:** `release/next` @ `4356de6` (2026-09-23). Re-derive every `file:line`
below if the branch has moved.

**Source.** Wiki `game/mechanics/rock-vantage-climb` (Feature Scout proposal, Checklist
Section 0 answered) + `decisions/lul-3254-prop-powers-accepted-2026-09-22` (CEO: accepted
with the Scout's own self-imposed cut — no directional ping, sightline only, to avoid
duplicating Threat Beacon LUL-3009) + the CTO's PLAN comment on this ticket (2026-09-23).

## Deviations found verifying the PLAN's citations live (fix before implementing)

The PLAN comment cites two things that don't exist at the line given; the real code confirms
the same underlying claim, just at a different location:

1. **"New proximity query in `lib/game/cover.ts` alongside `findHideSpot` (:2588)"** —
   `findHideSpot` the *pure* function lives at `lib/game/cover.ts:644`
   (`export function findHideSpot(...)`, filters `HIDE_KINDS`, radius `HIDE_RADIUS`).
   `engine/forest-engine.js:2588` is a thin wrapper: `function findHideSpot(x,z){ return
   geoFindHideSpot(x,z,coverGrid,CELL,WRAP_SPAN); }`, importing the real function as
   `findHideSpot as geoFindHideSpot` (`engine/forest-engine.js:74`). The new rock query
   needs both halves — see **Files** below.
2. **"`ROCK_MOUNT_HEIGHT`: … rocks vary per-rock, `forest-engine.js:786` `y: r*0.55`"** —
   that line is `lib/game/cover.ts:786` (inside `generateCover()`'s rock branch:
   `return { kind: 'rock', hx: r, hz: r * (0.7 + rng() * 0.5), y: r * 0.55 };`), not
   `forest-engine.js`. Confirms the PLAN's underlying point (rock mesh height is
   per-rock and random, so a per-rock mount-height lookup is out of scope for this
   slice) — the file attribution was just wrong.

Everything else in the PLAN's citations checked out exactly or within a line or two
(`caveImmuneT` state/decrement/reset-site trio, `effectiveDetect`/`canSee` chain,
`HINT_PRIORITY`, `eyeH` lerp, `ENGINE_ACTION_KEYS`, `#caveImmunePanel`).

## Files

- `lib/game/rockClimb.ts` — new. Tunable constants (Economist's follow-up target) + three
  pure functions, mirrors `lib/game/veilOverload.ts` and `lib/game/cave.ts` exactly.
- `lib/game/cover.ts` — edited. New `findRockMountSpot()` pure function next to
  `findHideSpot()` (`:644`).
- `engine/forest-engine.js` — edited. State, wrapper, trigger, decrement/reset wiring,
  detection-multiplier hook, camera-height hook, HUD state push, HINT_PRIORITY entry,
  cues, mobile action, QA hook.
- `engine/forest-engine.d.ts` — edited. `triggerTouchClimb` on `Window.ForestEngine`,
  new `qaStageRockClimb` QA hook declaration.
- `lib/engine-contract.ts` — edited. `triggerTouchClimb` added to `ENGINE_ACTION_KEYS`.
- `components/Hud.tsx` — edited. `EngineHudState` fields, `EngineActions.triggerTouchClimb`,
  new `#actionSlot` row `climbPrompt`, new countdown panel sibling of `#caveImmunePanel`.
- `docs/ELEMENTS.md` — edited. `### Rock` section (`:567-593`), Hints section
  (`:2371-2424` range), interaction matrix.
- `e2e/rock-vantage-climb.spec.ts` — new.
- `shared/local-qa/requests/lul-4528-rock-vantage-climb.md` — new.

## The change

### `lib/game/rockClimb.ts` (new)

```ts
// Tunable constants for Rock -- Vantage Climb (LUL-4528, LUL-3254 cheap slice, sightline
// only -- no directional ping, CEO decision 2026-09-22). Economist's parallel ticket tunes
// these values directly; no engine change needed to retune.
export const ROCK_MOUNT_RADIUS = 3;        // interact radius, matches THROWABLE_PICKUP_RADIUS
                                            // scale (engine/forest-engine.js:546)
export const ROCK_MOUNT_DURATION = 2;      // seconds -- fixed mount window (tap-trigger, not
                                            // held -- see Trigger section below)
export const ROCK_MOUNT_HEIGHT = 1.4;      // added to CONFIG.eye while mounted -- fixed
                                            // constant, not a per-rock mesh-height lookup
                                            // (rocks vary per-rock, lib/game/cover.ts:786) --
                                            // visual-fidelity cut, flag for a screenshot check
export const ROCK_CLIMB_DETECT_MUL = 1.6;  // placeholder exposure multiplier while mounted

/** true from the frame mounting happens until the countdown reaches 0. Same shape as
 * isCaveImmune()/isVeilOverloadActive() (lib/game/cave.ts, lib/game/veilOverload.ts). */
export function isRockClimbActive(rockClimbT: number): boolean {
  return rockClimbT > 0;
}

/** Gate for the KeyC / touch-climb trigger: not already hidden, not already mounted,
 * a rock is in range. Mutually exclusive with hiding by construction (mirrors
 * canGrabThrowable's shape, lib/game/outcome.ts:89). */
export function canMountRock(hidden: boolean, mountedOnRock: boolean, distToRock: number, radius: number): boolean {
  return !hidden && !mountedOnRock && distToRock < radius;
}

/** Multiplicative exposure add-on to the effectiveDetect()/canSee() chain -- sight only,
 * same shape as veilDetectMul()/fogTideDetectMul()/timeOfRunDetectMul(). */
export function rockClimbDetectMul(mountedOnRock: boolean): number {
  return mountedOnRock ? ROCK_CLIMB_DETECT_MUL : 1;
}
```

### `lib/game/cover.ts` — new `findRockMountSpot()`, next to `findHideSpot()` (`:644-658`)

Same shape as `findHideSpot`, parameterized to `kind === 'rock'` and `ROCK_MOUNT_RADIUS`
instead of `HIDE_KINDS`/`HIDE_RADIUS` — reuses the rock's actual AABB edge distance
(`distanceToCoverEdge`, already imported at cover.ts) rather than a flat center-to-center
radius, so a large rock's mount trigger tracks its real footprint the same way hiding does:

```ts
export function findRockMountSpot(
  x: number, z: number,
  coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL, span: number = Infinity,
): CoverAABB | null {
  let best: CoverAABB | null = null, bestD = Infinity;
  for (const c of neighbourhood(coverGrid, x, z, cell, span)) {
    if (c.kind !== 'rock') continue;
    const dx = wrapDelta(x, c.x, span), dz = wrapDelta(z, c.z, span);
    const ry = c.ry ?? 0, co = Math.cos(ry), si = Math.sin(ry);
    const lx = dx * co - dz * si, lz = dx * si + dz * co;
    const d = distanceToCoverEdge(lx, lz, c.hx, c.hz);
    if (d < ROCK_MOUNT_RADIUS && d < bestD) { bestD = d; best = c; }
  }
  return best;
}
```

Import `ROCK_MOUNT_RADIUS` from `./rockClimb` at the top of `cover.ts`.

### `engine/forest-engine.js`

**Imports** — add alongside the existing `lib/game/cover` import block (`:74`, next to
`findHideSpot as geoFindHideSpot`):
```js
findRockMountSpot as geoFindRockMountSpot,
```
New import line next to `:124` (`veilOverload` import):
```js
import { ROCK_MOUNT_RADIUS, ROCK_MOUNT_DURATION, ROCK_MOUNT_HEIGHT, isRockClimbActive, canMountRock, rockClimbDetectMul } from '@/lib/game/rockClimb';
```

**State** — new module-level lets next to `caveImmuneT` (`:617`):
```js
let mountedOnRock = false, rockClimbT = 0;
```

**Wrapper** — next to `findHideSpot`'s own wrapper (`:2588`):
```js
function findRockMountSpot(x,z){ return geoFindRockMountSpot(x,z,coverGrid,CELL,WRAP_SPAN); }
```

**Trigger** — tap, not hold (see rationale below). New functions next to
`enterHide`/`exitHide`/`toggleHidden` (`:3554-3599`):
```js
function enterRockClimb(spot){
  mountedOnRock = true; rockClimbT = ROCK_MOUNT_DURATION;
  rockClimbStartCue();
}
function exitRockClimb(){
  if(!mountedOnRock) return;
  mountedOnRock = false; rockClimbT = 0;
  rockClimbEndCue();
}
function toggleRockClimb(){
  if(mountedOnRock){ exitRockClimb(); return; }
  const spot = findRockMountSpot(player.x, player.z);
  if(canMountRock(hidden, mountedOnRock, spot ? 0 : Infinity, ROCK_MOUNT_RADIUS) && spot) enterRockClimb(spot);
  else rockClimbDeniedCue();   // Q5: declined-interact tell, not silence -- see Cues
}
```
`canMountRock`'s distance arg collapses to `spot ? 0 : Infinity` because `findRockMountSpot`
already applied `ROCK_MOUNT_RADIUS` as its own cutoff — the pure function is still useful on
its own (mirrors `canGrabThrowable`'s shape, used where a real distance is available, e.g.
the per-frame HUD gate below) but the trigger only needs "did a spot resolve."

**Key binding** — new handler next to `KeyH` (`:3343`, KeyC confirmed free by grep of every
`e.code === 'Key…'` handler: KeyE `:3317`, KeyQ `:3339`, KeyH `:3343`; veil is held KeyF
`:3399-3402`):
```js
if(e.code === 'KeyC' && playing && !paused) toggleRockClimb();
```

**Decrement** — next to the `caveImmuneT`/`veilOverloadChargeT` countdown pair
(`:6925-6939`), same "never lapse silently" comment already documents the house rule:
```js
let rockClimbJustEnded = false;
if(rockClimbT > 0){
  rockClimbT = Math.max(0, rockClimbT - dt);
  if(rockClimbT === 0){ rockClimbJustEnded = true; mountedOnRock = false; }
}
if(rockClimbJustEnded) rockClimbEndCue();
```

**Reset at all 3 `hidden = false` sites** (exact matches, not approximate — confirmed live):
- `:5842` (`pickup()`) — add `mountedOnRock = false; rockClimbT = 0;`
- `:6110` (`triggerDeath()`) — add `mountedOnRock = false; rockClimbT = 0;`
- `:6162` (`restart()`) — add `mountedOnRock = false; rockClimbT = 0;`

**Detection hook** — `effectiveDetect()`/`canSee()` (`:2596-2599`), add
`rockClimbDetectMul(mountedOnRock)` to both multiplier chains:
```js
DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(...) * timeOfRunDetectMul(timeOfRun) * rockClimbDetectMul(mountedOnRock) * CONFIG.detectScaleMul
```
in both `effectiveDetect(p)` and `canSee(p, dist)`.

**Camera height** — extend the `eyeH` lerp ternary (`:6496`):
```js
eyeH += ((mountedOnRock ? CONFIG.eye + ROCK_MOUNT_HEIGHT : hidden ? 1.05 : CONFIG.eye) - eyeH) * Math.min(1, dt*8);
```
Confirmed, not assumed: `blocked()` (`:681`) already forwards live `eyeH` into
`geoBlocked(...)` → `canopyBlockedR()` (`lib/game/cover.ts:460`) every frame via the
comment at `engine/forest-engine.js:678-680` ("pass the live eyeH … so canopyBlockedR()
recomputes each tree's canopy radius against the player's actual current eye height").
Raising `eyeH` while mounted therefore does improve the player's own outward canopy
clearance with zero new geometry code — this SPEC's `## e2e` section asserts it rather
than leaving it as an unverified claim.

**Per-frame HUD computation** — inside the throttled cover-probe block (`:6885-6889`,
`COVER_PROBE_HZ`), compute `lastRockMountSpot` the same way `lastHideSpot` already is:
```js
lastRockMountSpot = (!hidden && !mountedOnRock) ? findRockMountSpot(player.x, player.z) : null;
```
(new module-level let `lastRockMountSpot = null` next to `lastHideSpot` at `:451`).
Then in the per-frame `pushState({...})` block (`:6941-6971`), add:
```js
mountedOnRock,
rockClimbTimeLeft: rockClimbT,
climbPromptVisible: !hidden && !mountedOnRock && lastRockMountSpot !== null,
```
and in the `else` branch reset (`:6979`), add `mountedOnRock: false` (do **not** force
`rockClimbT`/timer state here — mirrors how `caveImmuneActive`/`veilOverloadActive` reset
to `false` in the paused/not-playing branch without touching their own countdown lets,
since `tick()` only runs `if(playing)`).

**Mobile** — `triggerTouchClimb()`, mirrors `triggerTouchHide()`/`triggerTouchVeilOverload()`
(`:7336`/`:7367`) inside the same `?qaHooks`-adjacent `init()` return block:
```js
function triggerTouchClimb() { toggleRockClimb(); }
```
Add to `init()`'s `return { ... }` object (bottom of `init()`) alongside the other
`triggerTouch*` keys.

**Copy / HINT_PRIORITY** — add `'rockClimb'` to the `HINT_PRIORITY` array (`:2245`) and its
copy-map entry next to `caveImmune`'s (`:2268` pattern):
```js
rockClimb: 'climb the rock to see farther — but you\'re exposed while you\'re up there',
```

**Cues** — three new one-shot functions, mirror `caveImmuneStartCue()`/`caveImmuneEndCue()`
(`:6016`/`:6025`):
- `rockClimbStartCue()` — climb-up sound, gated `soundOn`.
- `rockClimbEndCue()` — descent-thud sound, gated `soundOn`. Fires on both natural
  countdown expiry and manual KeyC dismount (both routes call `exitRockClimb()`).
- `rockClimbDeniedCue()` — short declined-interact sound (Q5) + caption, fires when KeyC
  is pressed with no rock in range **or** while hidden. Caption text: "can't climb here" /
  "can't climb while hidden" per which condition failed (mirrors the granularity the
  proposal's Q5 answer asked for — `toggleHidden()` itself silently no-ops today,
  `:3596-3599`, this is a new obligation, not copied from an existing pattern).

**QA hook** — new `window.ForestEngine.qaStageRockClimb` inside the `?qaHooks` block, mirrors
`qaHideBehindCoverKind` (`:4687`) but keyed on `kind === 'rock'` directly (rock is not in
`HIDE_KINDS`, so `qaHideBehindCoverKind` cannot be reused as-is — it filters
`if(!HIDE_KINDS[c.kind]) continue;`). Stages a predator with partial LOS to the nearest rock
at a fixed clear distance, same LOS-ray-clear check shape as `qaHideBehindCoverKind`'s loop
(`:4692-4703`). Declare in `engine/forest-engine.d.ts` alongside `qaHideBehindCoverKind`
(`:172-186`).

### `engine/forest-engine.d.ts`

Add `triggerTouchClimb?: () => void;` to the `Window.ForestEngine` interface next to
`triggerTouchHide`. Add the `qaStageRockClimb` hook declaration next to
`qaHideBehindCoverKind` (`:172-186`).

### `lib/engine-contract.ts`

Add `'triggerTouchClimb'` to `ENGINE_ACTION_KEYS` (`:14-29`). The exhaustiveness check
(`:31-36`) fails `tsc` if `EngineActions` (below) gains the key but this array doesn't.

### `components/Hud.tsx`

`EngineHudState` (`:32` interface) — add next to `caveImmuneActive`/`caveImmuneTimeLeft`
(`:67-69`):
```ts
mountedOnRock: boolean;
rockClimbTimeLeft: number;
climbPromptVisible: boolean;
```
`EngineActions` (`:179` interface) — add `triggerTouchClimb: () => void;` next to
`triggerTouchHide`. `INITIAL_HUD_STATE` (`:230`) — add matching defaults
(`mountedOnRock: false, rockClimbTimeLeft: 0, climbPromptVisible: false`).

New `#actionSlot` row `climbPrompt` — insert into the row list (`:1071-1163`) per the
project's one prompt convention (a `<ActionPrompt>` row inside `#actionSlot`, never a
free-floating keycap — LUL-2312). **Placement note:** Game Engineer's LUL-4660
(`e2e/action-prompt.spec.ts` row-order + the `qaForceAllActionRows`/`FORCED_ROW_IDS` gap,
`engine/forest-engine.js:5803`) touches this same row-order list concurrently and had not
merged as of this SPEC (no `lul-4660` commit found in `release/next`'s history at
`4356de6`). **Implementer: check `git log -- e2e/action-prompt.spec.ts` before landing —
if LUL-4660 has merged, rebase onto its row list rather than editing blind.**
```tsx
<ActionPrompt
  id="climbPrompt"
  visible={state.climbPromptVisible && hudLive}
  tone="calm"
  text="Press  C  to climb the rock"
  keycap={mobile ? 'Climb' : undefined}
  onPointerDown={mobile ? (e) => { e.preventDefault(); actions?.triggerTouchClimb(); } : undefined}
/>
```
Place it after `pickupPrompt` (`:1153`), before `status` (`:1162`) — it's a contextual
"something to do" prompt like `pickupPrompt`, not the terminal `status` row.

New countdown panel, sibling of `#caveImmunePanel` (`:984-986`), outside `#panel` so it's
visible with `adminMode` off (Q3):
```tsx
{state.mountedOnRock && (
  <div id="rockClimbPanel">
    Exposed · {Math.ceil(state.rockClimbTimeLeft)}s
  </div>
)}
```

Mobile tap button placement for `triggerTouchClimb` (new mobile-only layout decision, same
as `pickupPrompt`'s existing `onPointerDown` pattern above) — flagged in the proposal as not
pre-solved; use the `climbPrompt` row's own `onPointerDown` (shown above) rather than a
separate floating button, matching how `throwPrompt`/`veilOverloadPrompt` handle mobile
today (the `#actionSlot` row itself is the tap target, no extra button).

### `docs/ELEMENTS.md`

- `### Rock` (`:567-593`) — add a `## Vantage Climb (LUL-4528)` subsection: trigger (tap
  KeyC / `triggerTouchClimb`, `ROCK_MOUNT_RADIUS`), state (`mountedOnRock`/`rockClimbT`),
  effect (`ROCK_CLIMB_DETECT_MUL` on `effectiveDetect`/`canSee`, `ROCK_MOUNT_HEIGHT` on
  `eyeH`), HUD (`climbPrompt` row, `#rockClimbPanel`), mutual exclusion with hiding.
  Update "**What it CANNOT do**" (`:578-581`) — rock still cannot be a `HIDE_KINDS` spot,
  but can now be mounted; make the distinction explicit so a future reader doesn't conflate
  the two.
- Hints section (`:2371-2424` range) — add `'rockClimb'` to the enumerated `HINT_PRIORITY`
  list at `:2376`.
- Interaction matrix (`:2000+`) — add the Rock/Vantage-Climb row per the existing matrix
  format; check `scripts/check-elements-citations.mjs` passes after any line-number drift
  this diff causes elsewhere in the file (LUL-1575/LUL-4663 precedent: a mid-file insertion
  shifts every citation after it).

## Verification

- `npx tsc --noEmit` — clean (baseline `layout.tsx` error only, per every prior FE run this
  week; do not treat that one as new).
- `npm test` (unit) — 1220+ pass, no regressions in `veil.spec.ts`/`cave`-adjacent suites.
- `node scripts/check-elements-citations.mjs` — clean after the `docs/ELEMENTS.md` edit.
- `npx eslint .` (`lint` script — `next lint` was removed in Next 16) — clean.
- New e2e spec (below) passes locally against a real build.

## e2e

**Specs.** `e2e/rock-vantage-climb.spec.ts` — new, at minimum:
- `'mounting a rock raises effectiveDetect/canSee exposure'` — stages a predator with
  partial LOS to a rock at a fixed clear distance via `qaStageRockClimb`, player presses
  KeyC (real input path, not a hook that force-sets `mountedOnRock` — Q1.5, the LUL-4662
  dead-trigger incident was exactly a hook-only path), asserts the detection value/roll is
  higher mounted than the pre-mount baseline standing at the same spot.
- `'raising eyeH while mounted improves the player's own canopy clearance'` — asserts
  `canopyBlockedR()`'s live behavior changes with `mountedOnRock`, not just that the number
  exists (the "confirmed, not assumed" claim above needs a real assertion per the
  runtime-boundary-review standard, not a comment).
- `'mounting is refused while hidden, and while hidden refusal has a positive tell'` (Q5) —
  hide, press KeyC, assert `rockClimbDeniedCue`'s caption/sound fires, `mountedOnRock`
  stays false.
- `'mounting is refused with no rock in range'` (Q5) — press KeyC away from any rock, assert
  the "can't climb here" tell fires, no silent no-op.
- `'countdown expires and dismounts automatically'` — mount, advance past
  `ROCK_MOUNT_DURATION`, assert `mountedOnRock` flips false and `rockClimbEndCue` fires
  exactly once (not on every subsequent frame — "never lapse silently" but also never
  re-fire).
- `e2e/action-prompt.spec.ts` — extended (new `climbPrompt` row) **or** left untouched with
  a documented reason, depending on LUL-4660's merge state at implementation time (see the
  placement note in **The change** above) — must pass unchanged either way.

**World.** micro (`qaBuildScene`) — one rock prop (`kind: 'rock'`) at a fixed position, one
predator (`kind: 'wolf'`, arbitrary — detection math is species-agnostic here) staged via
the new `qaStageRockClimb` hook at a fixed clear-LOS distance from the rock, no other cover
between them. Not `@fullmap` — nothing in this feature needs the procedural map.

**Hooks.** `window.ForestEngine.qaStageRockClimb(dx, dz): {x,z} | null` — new (declare in
`engine/forest-engine.d.ts`, install inside the `?qaHooks` block in `init()`, mirrors
`qaHideBehindCoverKind`'s LOS-clear-ray check, `engine/forest-engine.js:4687-4707`, but
keyed on `kind === 'rock'` since rock is outside `HIDE_KINDS`). Existing hooks reused:
`qaProbeEffectiveDetect(kind): number | null` (`:4456-4460`) already returns the live,
fully-scaled `effectiveDetect(p)` value for a predator by kind — the before/after detect
comparison in the first e2e case above needs no new probe hook, just two calls to this one
(mounted vs. not). `qaSetFixedStep`/`qaAdvance` (used by `lul-3150-veil-overload.md`'s
request, same countdown-expiry shape) for the auto-dismount test.

**Tester scenario.** `shared/local-qa/requests/lul-4528-rock-vantage-climb.md` — filed
alongside this SPEC PR. Verb grammar: mount via KeyC near a staged rock, screenshot the
`#rockClimbPanel` countdown and `climbPrompt` row with `adminMode` off, desktop viewport
only (mount/dismount is a keyboard+camera-height interaction; no mobile-specific visual
regression risk beyond the existing tap-target pattern `pickupPrompt` already covers).

**Not covered.** Feel of the camera-height ease (subjective, matches the existing `eyeH`
lerp's established feel — no new easing curve introduced). The climb-up/descent-thud SFX's
actual sound design — mixed by ear, only "does it fire, is it gated by `soundOn`" is
e2e-checked. `ROCK_MOUNT_HEIGHT`'s specific visual fit against actual (per-rock-varying)
rock mesh geometry — flagged in **The change** as a screenshot check, not a code-verify one.

## Cues

**Visual.** Camera rises by `ROCK_MOUNT_HEIGHT` over the existing `eyeH` lerp
(`engine/forest-engine.js:6496`) — no new mesh, matches the no-held-item-mesh precedent at
`components/Hud.tsx:1133-1136`. `#rockClimbPanel` countdown text (Hud.tsx, new, sibling of
`#caveImmunePanel`). `climbPrompt` row appears/disappears in `#actionSlot`.
**Audio.** `rockClimbStartCue()` (new, gated `soundOn`) on mount. `rockClimbEndCue()` (new,
gated `soundOn`) on dismount, whether by countdown expiry or manual KeyC toggle.
`rockClimbDeniedCue()` (new, gated `soundOn`) on a refused mount attempt.
**Explanation.** First-encounter caption via `HINT_PRIORITY`'s new `'rockClimb'` entry:
"climb the rock to see farther — but you're exposed while you're up there." Refusal
captions: "can't climb here" / "can't climb while hidden", fired unconditionally (not
gated by first-encounter/`hintSeen`, since they're a repeated-input tell, not a one-time
explanation — matches how declined-interact tells work elsewhere).
**Reduced motion.** The `eyeH` lerp is a height ease, not a flash/bounce/scale transition —
same class of motion the existing hide/stand lerp already uses unconditionally regardless
of `reducedMotion`. This SPEC asserts that explicitly in e2e (`captionsOn=true` and
`reducedMotion=true` variants of the mount test) rather than assuming it, per Q15's
standard — if the assertion surfaces an actual flash/pop the implementer missed, add a
reduced-motion branch; do not skip the assertion to avoid finding out.

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- Tier C: this touches the shared `effectiveDetect()`/`canSee()` multiplier chain used by
  every predator every frame — `rockClimbDetectMul(mountedOnRock)` must return exactly `1`
  (no-op) whenever `mountedOnRock` is false, verified by the existing veil/cave/wind e2e
  suites staying green (no regression in unrelated detection scenarios).
- Mounting and hiding are mutually exclusive by construction (`canMountRock`'s `!hidden`
  gate; `toggleHidden()` should likewise refuse while `mountedOnRock` — add the symmetric
  `!mountedOnRock` check to `toggleHidden()`'s existing gate, since a player parked on a
  rock has no reachable hide spot logically but the code should say so, not rely on
  geometry to make it impossible).
- No directional ping, no compass indicator, no Threat Beacon (LUL-3009) widget reuse — the
  CEO's accepted cut. Pure sightline (camera height + detection-weight exposure) only.
- `ROCK_MOUNT_RADIUS`, `ROCK_MOUNT_DURATION`, `ROCK_CLIMB_DETECT_MUL`, `ROCK_MOUNT_HEIGHT`
  ship as named exports in `lib/game/rockClimb.ts`, never inlined — Economist's follow-up
  tuning ticket is a config-value change, not a code change.

## Out of scope

- Directional ping / compass widget — explicitly cut per the CEO decision, not deferred to
  "later," cut for good unless a future proposal re-raises it with a Threat Beacon
  differentiation argument.
- Per-rock mount-height lookup (matching each rock's actual mesh height,
  `lib/game/cover.ts:786`) — `ROCK_MOUNT_HEIGHT` is a single fixed constant for this slice.
- Predator AI reaction to a mounted player beyond the existing detection-weight chain (e.g.
  a rock-specific "converge on last-seen-mounted position" behavior) — out of scope, no
  such behavior exists for any other exposure state (veil-drained, standing in open ground)
  either.
- New mobile-only floating button — the `climbPrompt` row's own tap target covers mobile,
  matching `throwPrompt`/`veilOverloadPrompt`'s existing pattern.
