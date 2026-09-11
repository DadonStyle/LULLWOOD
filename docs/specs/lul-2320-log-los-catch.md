# SPEC: LUL-2320 predators can't catch a player standing on a log/bramble

**Ticket:** LUL-2320 · **Tier: C** — `lib/game/cover.ts` (LOS/detection geometry),
`lib/game/predator.ts` (kill-gate decision helper), `engine/forest-engine.js` (predator state
machine call sites). Requires `REVIEW: APPROVED` before merge.

**Written against:** `release/next` @ `3572e53` (2026-09-11). Re-derive every `file:line`
below if it has moved on the branch you implement on.

Implements the PLAN posted on the issue (`plan` document, `origin/main` @ `80bf8dc`) — rules
A-D are pinned there as decisions, not open questions. This SPEC makes each one a concrete
diff and resolves the two things the PLAN left to the SPEC: whether rule A's box-skip applies
to every cover kind or only walkable ones (§A, scoped to walkable), and how rule B threads a
catch-margin into `canSee()` without `cover.ts` importing `CATCH_MARGIN` from `predator.ts`
(§B, caller-supplied `catchDist`).

## Files

- `lib/game/cover.ts` — edited: `hasLOS()` (rule A), new `insideHideFootprint()` helper, `canSee()` (rule B).
- `lib/game/predator.ts` — edited: `canCatchInChase()` gains a `hidden` parameter (rule C).
- `lib/game/cover.test.ts` — edited: new unit tests for A/B.
- `lib/game/predator.test.ts` — edited: new unit tests for C's `hidden` matrix.
- `engine/forest-engine.js` — edited: `canSee(p,dist)` wrapper (thread the catch margin),
  `hunt` branch (rule C), `chase` branch (rule C + rule D), two new QA hooks, one QA hook
  gains an optional parameter.
- `engine/forest-engine.d.ts` — edited: declare/update the three QA hooks touched above.
- `docs/ELEMENTS.md` — edited: Player collision profile, Log card, Bramble card, predator
  Collision & physics profile — each currently states or implies catch is LOS-independent or
  that standing on a log doesn't affect detection; none of that is true today.
- `e2e/positional-hiding.spec.ts` — edited: three new cases.

## The change

### A — `hasLOS()` stops treating a walkable box as an occluder for the point standing inside it

`lib/game/cover.ts:559-588`, inside the per-box loop (`:578-585`):

```ts
    for (const c of arr) {
      const ry = c.ry ?? 0, co = Math.cos(ry), si = Math.sin(ry);
      const dx0 = wrapDelta(x0, c.x, span), dz0 = wrapDelta(z0, c.z, span);
      const dx1 = dx0 + ddx, dz1 = dz0 + ddz;
      if (segRayVsAABB(dx0 * co - dz0 * si, dx0 * si + dz0 * co, dx1 * co - dz1 * si, dx1 * si + dz1 * co, 0, 0, c.hx, c.hz)) {
        return false;
      }
    }
```

becomes:

```ts
    for (const c of arr) {
      const ry = c.ry ?? 0, co = Math.cos(ry), si = Math.sin(ry);
      const dx0 = wrapDelta(x0, c.x, span), dz0 = wrapDelta(z0, c.z, span);
      const dx1 = dx0 + ddx, dz1 = dz0 + ddz;
      const lx0 = dx0 * co - dz0 * si, lz0 = dx0 * si + dz0 * co;
      const lx1 = dx1 * co - dz1 * si, lz1 = dx1 * si + dz1 * co;
      // LUL-2320 (A): a walkable box (log/bramble, `!coverKindBlocksMovement`) does not
      // occlude a segment endpoint standing inside its own footprint -- segRayVsAABB
      // clamps tmax to 1, so an endpoint inside the box is otherwise an unconditional
      // "blocked" no matter which direction the sightline approaches from (LUL-91's
      // rotated-AABB slab test doesn't distinguish "grazes the box" from "starts/ends
      // inside it"). Symmetric on both ends: the predator's own origin must not be
      // blinded by a bramble it happens to be standing in either. Solid kinds
      // (rock/reed/tree) are NOT skipped -- coverBlockedR()/blockedForPredator() already
      // make a solid box's interior physically unreachable by either actor's exact
      // (x,z), so this case is geometrically impossible for them today; skipping it too
      // would be a behaviour change with no reachable effect, so the existing
      // "zero-length segment inside cover reports blocked" test (kind: 'rock') is
      // deliberately left asserting the old contract.
      if (!coverKindBlocksMovement(c.kind)) {
        const insideAtTarget = Math.abs(lx1) <= c.hx && Math.abs(lz1) <= c.hz;
        const insideAtOrigin = Math.abs(lx0) <= c.hx && Math.abs(lz0) <= c.hz;
        if (insideAtTarget || insideAtOrigin) continue;
      }
      if (segRayVsAABB(lx0, lz0, lx1, lz1, 0, 0, c.hx, c.hz)) {
        return false;
      }
    }
```

(`segRayVsAABB`'s call arguments are unchanged in value — `lx0,lz0,lx1,lz1` are the exact same
rotated coordinates the original call computed inline; only named now so the two half-extent
checks above can reuse them without recomputing.)

`coverKindBlocksMovement` is already defined in this file (`:210-211`) and already imported by
no one outside it except the engine — no new import needed inside `cover.ts` itself.

### New helper — `insideHideFootprint()`, for rule B

Insert immediately after `findHideSpot()` (`:601-616`), before the "sight detection range"
section comment (`:618`):

```ts
// ---- is a point standing inside a HIDE_KINDS footprint? (LUL-2320) ----------------
// Narrower than findHideSpot(): that function answers "is (x,z) within HIDE_RADIUS of a
// hide-prop's edge" (the KeyH trigger zone, which extends *outside* the box). This
// answers "is (x,z) inside the box itself" -- the geometric condition canSee() (below)
// needs to decide whether a hidden player's own footprint should still shield them after
// hasLOS() (above) stops treating that footprint as a blanket occluder.
export function insideHideFootprint(
  x: number, z: number,
  coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL, span: number = Infinity,
): boolean {
  for (const c of neighbourhood(coverGrid, x, z, cell, span)) {
    if (!HIDE_KINDS[c.kind]) continue;
    const dx = wrapDelta(x, c.x, span), dz = wrapDelta(z, c.z, span);
    const ry = c.ry ?? 0, co = Math.cos(ry), si = Math.sin(ry);
    const lx = dx * co - dz * si, lz = dx * si + dz * co;
    if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) return true;
  }
  return false;
}
```

### B — `canSee()` keeps a hidden player on a hide-spot invisible except at contact range

`lib/game/cover.ts:657-668`:

```ts
export function canSee(
  dist: number,
  detect: number,
  detectMul: number,
  state: DetectionState,
  x0: number, z0: number, x1: number, z1: number,
  coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL, span: number = Infinity,
): boolean {
  if (dist >= effectiveDetect(detect, detectMul, state)) return false;
  return hasLOS(x0, z0, x1, z1, coverGrid, cell, span);
}
```

becomes:

```ts
export function canSee(
  dist: number,
  detect: number,
  detectMul: number,
  state: DetectionState,
  x0: number, z0: number, x1: number, z1: number,
  coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL, span: number = Infinity,
  // LUL-2320 (B): the contact-range threshold (rad + CATCH_MARGIN) at which a *hidden*
  // player standing inside a HIDE_KINDS footprint stops being shielded by that footprint.
  // Passed in rather than importing CATCH_MARGIN from predator.ts -- cover.ts has no
  // dependency on predator.ts today (predator.ts already imports from cover.ts indirectly
  // via the engine; the reverse would be new and check-duplicate-logic.mjs would still
  // flag a second copy of the constant if inlined here). Defaults to 0 (no exception) so
  // every existing caller that doesn't pass it keeps exact prior behaviour.
  catchDist: number = 0,
): boolean {
  // LUL-2320 (B): (A) above stops the box a hidden player is standing in from blanket-
  // blocking every sightline to them -- which would undo the LUL-1642 bramble mechanic
  // (cover.ts:193-209's whole point was putting the hider inside the footprint hasLOS()
  // tests). Re-add the protection explicitly, keyed on `hidden` rather than geometry: a
  // hidden player inside a hide-spot's footprint is invisible regardless of stillness/
  // detect-range math UNLESS a predator has closed to contact range. This mirrors the
  // existing open-ground invariant (positional-hiding.spec.ts's "hold-still alone does
  // not save you when a predator is on top of you") for the one case that invariant
  // couldn't previously reach, because hasLOS() made it geometrically unreachable.
  if (state.hidden && insideHideFootprint(x1, z1, coverGrid, cell, span)) {
    return dist < catchDist;
  }
  if (dist >= effectiveDetect(detect, detectMul, state)) return false;
  return hasLOS(x0, z0, x1, z1, coverGrid, cell, span);
}
```

`catchDist` is trailing and defaults to `0` (`dist < 0` is never true), so every existing call
in `cover.test.ts` that omits it keeps its exact current result — verified against every
`hidden: true` fixture in that file (`:828,833,838-839,865,883-884`): none of them also builds
a `coverGrid` containing a `HIDE_KINDS` box the test point sits inside, so this branch is
unreached by any existing test either way, defaulted or not.

### C — `canCatchInChase()` gains a `hidden` parameter

`lib/game/predator.ts:64-66`:

```ts
export function canCatchInChase(canSee: boolean, dist: number, rad: number): boolean {
  return canSee && isCaught(dist, rad);
}
```

becomes:

```ts
// LUL-2320 (C): `hidden` defaults to `true` -- every *existing* caller of this function
// (all five in predator.test.ts, `:71,75,79,83-84`) was written to pin LUL-387's original
// guarantee ("a hidden player behind cover can't be blind-caught"), i.e. every one of
// those callers' intent is "assume hidden" even though the 3-arg signature never said so
// explicitly. Defaulting to `true` reproduces the old `canSee && isCaught` formula
// exactly for every existing call (verified below) and makes the new, deliberately
// looser `!hidden` case opt-in only. The one real caller, `chase`'s kill check in
// forest-engine.js, always passes its own live `hidden` explicitly.
export function canCatchInChase(canSee: boolean, dist: number, rad: number, hidden: boolean = true): boolean {
  return isCaught(dist, rad) && (canSee || !hidden);
}
```

Verify the default against each existing assertion before writing the new tests (do not
change these five lines in `predator.test.ts`):

| call | `isCaught(dist,rad)` | `canSee \|\| !hidden` (hidden=true ⇒ `canSee \|\| false`) | result | expected |
|---|---|---|---|---|
| `canCatchInChase(false, 1, 1)` | `true` (1 < 1+1.3) | `false` | `false` | `false` ✓ |
| `canCatchInChase(true, 1, 1)` | `true` | `true` | `true` | `true` ✓ |
| `canCatchInChase(false, 0, 1)` | `true` | `false` | `false` | `false` ✓ |
| `canCatchInChase(true, 1+CATCH_MARGIN, 1)` | `false` (not `<`) | — | `false` | `false` ✓ |
| `canCatchInChase(true, 1+CATCH_MARGIN-0.001, 1)` | `true` | `true` | `true` | `true` ✓ |

All five hold unchanged — no edit needed to the existing test file beyond adding the new
`hidden=false` cases (see Verification/e2e below).

### `engine/forest-engine.js` — three call sites

**1. `canSee(p, dist)` wrapper, `:2033-2036`** — thread the contact margin through:

```js
function canSee(p, dist){
  if(isCaveImmune(caveImmuneT)) return false;
  return geoCanSee(dist, p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmountAt(p.x, p.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)) * timeOfRunDetectMul(timeOfRun), { hidden, hideTime, carrying }, p.x, p.z, player.x, player.z, coverGrid, CELL, WRAP_SPAN, p.rad + CATCH_MARGIN);
}
```

(one argument added at the end: `p.rad + CATCH_MARGIN`. `CATCH_MARGIN` is already imported
from `@/lib/game/predator` at `:99`.) Every one of the ~15 call sites in this file that reads
`canSee(p, dist)` goes through this single wrapper (roam's spot check, sightLock, charge
trigger, flank, cover-feedback scan, the two touched below) — none of the others need a
separate edit; they all now see the contact-range exception automatically, which is correct:
none of them are kill decisions, so a hidden player at contact reading as "seen" there just
means (for example) the cover-feedback HUD state or a charge-telegraph eligibility check
reflects reality, not a new invariant to re-verify against C/D.

**2. `hunt` branch, `:2173-2189`** — add the C check before the existing `!canSee` split:

```js
    } else if(p.hunt){                                // forced: comes straight for you while it can see you (no giving up otherwise)
      if(!canSee(p, dist)){
        if(p.scentLock > 0){ p.state='chase'; p.hunt=false; }
        else { p.state='investigate'; p.inv='approach'; p.sniffsLeft=rollSniffs(rng, 4); p.hunt=false; }
      }
      else {
        if(isCaught(dist, p.rad)) triggerDeath(p.kind, 'hunt');   // LUL-1194: the 30s force-hunt escalation caught up
        else { desx=ux; desz=uz; speed=p.spec.speed*pLakeMul; }
        if(dist < 8) p.hunt = false;                   // reached you → back to normal
        p.callTimer -= dt; if(p.callTimer <= 0){ predatorCall(p.kind, false, p); p.callTimer = rnd(2.6,4.6); }
      }
    } else if(p.state === 'roam'){
```

becomes (one new top-level branch inserted before the existing `if(!canSee...)`):

```js
    } else if(p.hunt){                                // forced: comes straight for you while it can see you (no giving up otherwise)
      // LUL-2320 (C): a player who isn't hidden gets caught on contact regardless of LOS --
      // matches the identical addition to `chase` below. Checked before the `!canSee` split
      // (not folded into the `else` branch's existing isCaught check, `:2185` today) so an
      // un-hidden player standing on a log gets caught even on the tick `canSee` happens to
      // read false (e.g. some other real cover still breaks the raw sightline). A *hidden*
      // player in contact is unaffected by this branch and falls through to the pre-existing
      // `!canSee`/`else` split -- (B)'s own contact-range exception means `canSee` reads true
      // there once actually in contact, so the existing `isCaught` check inside that `else`
      // (unchanged, below) still catches them the same way it always has.
      if(isCaught(dist, p.rad) && !hidden){ triggerDeath(p.kind, 'hunt'); }
      else if(!canSee(p, dist)){
        if(p.scentLock > 0){ p.state='chase'; p.hunt=false; }
        else { p.state='investigate'; p.inv='approach'; p.sniffsLeft=rollSniffs(rng, 4); p.hunt=false; }
      }
      else {
        if(isCaught(dist, p.rad)) triggerDeath(p.kind, 'hunt');   // LUL-1194: the 30s force-hunt escalation caught up
        else { desx=ux; desz=uz; speed=p.spec.speed*pLakeMul; }
        if(dist < 8) p.hunt = false;                   // reached you → back to normal
        p.callTimer -= dt; if(p.callTimer <= 0){ predatorCall(p.kind, false, p); p.callTimer = rnd(2.6,4.6); }
      }
    } else if(p.state === 'roam'){
```

`hidden` is already an in-scope closure variable at this point (read by `effectiveDetect()`/
`canSee()` themselves, `:2029-2036`, and directly by the `investigate` branch, `:2300`) — no
new plumbing.

**3. `chase` branch's final `else`, `:2266-2280`** — rules C and D together:

```js
      else {
        // LUL-387: gate the kill on an actual sightline, not just distance --
        // see canCatchInChase()'s comment. Without this, a predator still
        // mid-blind-chase (scentLock > 0) can catch the player straight
        // through the cover prop breaking canSee() right now, since
        // predators never physically collide with cover (LUL-119/LUL-211).
        // LUL-1857 mitigation 4 (recommended): a chase this predator only entered because
        // it heard the carried child's cry gets a distinguishable death cause -- see
        // hearCry()/the carriedCryPulse branch below for where p.alertedBy is set, and
        // hearNoise()/scentOnto()/spotOnto() for where it's cleared by every other channel.
        if(canCatchInChase(canSee(p, dist), dist, p.rad)){ triggerDeath(p.kind, p.alertedBy === 'cry' ? 'heard' : 'chase'); }   // LUL-1194: run down mid-chase, in the open
        else { desx=ux; desz=uz; speed=p.spec.speed*pLakeMul; }
        if(shouldGiveUpChase(p.scentLock, dist, effectiveDetect(p))){ p.state='roam'; p.spotted=false; logChronicle('predator_gave_up', { kind: p.kind }); }
        p.callTimer -= dt; if(p.callTimer <= 0){ predatorCall(p.kind, false, p); p.callTimer = rnd(2.6,4.6); }
      }
```

becomes:

```js
      else {
        // LUL-387: gate the kill on an actual sightline, not just distance --
        // see canCatchInChase()'s comment. Without this, a predator still
        // mid-blind-chase (scentLock > 0) can catch the player straight
        // through the cover prop breaking canSee() right now, since
        // predators never physically collide with cover (LUL-119/LUL-211).
        // LUL-1857 mitigation 4 (recommended): a chase this predator only entered because
        // it heard the carried child's cry gets a distinguishable death cause -- see
        // hearCry()/the carriedCryPulse branch below for where p.alertedBy is set, and
        // hearNoise()/scentOnto()/spotOnto() for where it's cleared by every other channel.
        // LUL-2320 (C): `hidden` threaded through -- an un-hidden player in contact is
        // caught regardless of LOS (matches the `hunt` branch above); a hidden player
        // keeps LUL-387's original LOS-gated guarantee.
        if(canCatchInChase(canSee(p, dist), dist, p.rad, hidden)){ triggerDeath(p.kind, p.alertedBy === 'cry' ? 'heard' : 'chase'); }   // LUL-1194: run down mid-chase, in the open
        // LUL-2320 (D): contact was reached (isCaught) but the kill was refused because the
        // player is hidden and canSee() still read false at that exact range -- e.g. (B)'s
        // contact-range exception and isCaught()'s own circular margin can disagree right at
        // a hide prop's thin edge, where the rotated-AABB footprint and the circular catch
        // radius aren't the same shape. Without this, the `else` below keeps steering
        // `desx=ux;desz=uz` at full species speed directly at the player's exact position --
        // already in contact, so every subsequent tick re-aims at (near-)zero distance,
        // reading as the reported "stands on the player, pushes, jitters" glue. Drop straight
        // into the sniff loop's approach→standoff hand-off (LUL-1090) instead of waiting for
        // `shouldGiveUpChase()`'s distance/timer give-up below to eventually fire.
        else if(hidden && isCaught(dist, p.rad)){
          p.state = 'investigate'; p.inv = 'approach'; p.sniffsLeft = rollSniffs(rng, 4);
        }
        else { desx=ux; desz=uz; speed=p.spec.speed*pLakeMul; }
        if(shouldGiveUpChase(p.scentLock, dist, effectiveDetect(p))){ p.state='roam'; p.spotted=false; logChronicle('predator_gave_up', { kind: p.kind }); }
        p.callTimer -= dt; if(p.callTimer <= 0){ predatorCall(p.kind, false, p); p.callTimer = rnd(2.6,4.6); }
      }
```

`p.state = 'investigate'` inside this `else if` skips the rest of the current tick's `chase`
branch body (`shouldGiveUpChase`/`callTimer` lines still run after it, harmlessly — they read
`p.scentLock`/`p.callTimer`, not `p.state`, and `p.state` having already changed this tick just
means the *next* tick's outer `if/else-if` chain reads `investigate` instead of `chase`; both
branches already tolerate a state change mid-tick the same way `p.hunt=false` inside the
`hunt` branch does). The very next tick runs `investigate`'s `approach` sub-phase
(`:2301-2335`), which — since the predator is already inside `SNIFF_APPROACH_MARGIN`
(`rad+1.7`, wider than `CATCH_MARGIN`'s `rad+1.3`) — immediately computes `step.enterSniff`,
sees `hidden === true`, and calls the existing `sniffStandoffPoint()` (`:2328`, LUL-1090) to
back off to `SNIFF_STANDOFF` (4.5u) before sniffing — the exact "hold at standoff instead of
re-approaching to zero" behaviour the ticket's part D describes, reusing that machinery
verbatim rather than duplicating the standoff-point computation inline here.

### QA hooks

**1. `qaTeleportToHideSpot`, `engine/forest-engine.js:3866-3871`** — add an optional `kind`
filter (existing 0-arg callers keep picking the first `HIDE_KINDS` entry, unchanged):

```js
  window.ForestEngine.qaTeleportToHideSpot = function(kind){
    const spot = kind ? coverData.find(c => c.kind === kind) : coverData.find(c => HIDE_KINDS[c.kind]);
    if(!spot) return null;
    player.x = spot.x; player.z = spot.z;
    return spot.kind;
  };
```

`engine/forest-engine.d.ts:135` becomes:

```ts
      /** LUL-212: teleports the player to the first generated hiding spot (bramble/log, or the first prop of `kind` if given -- LUL-2320). No predator involved. Returns the spot's kind, or null if none were generated / no prop of `kind` exists on this map. */
      qaTeleportToHideSpot?: (kind?: 'log' | 'bramble') => string | null;
```

**2. `qaPredatorState`, `engine/forest-engine.js:3907-3914`** — add `rad` to the returned
snapshot (additive field, existing consumers unaffected):

```js
  window.ForestEngine.qaPredatorState = function(idx){
    const p = predators[idx];
    if(!p) return null;
    const dist = Math.hypot(player.x-p.x, player.z-p.z) || 0.0001;
    return { kind: p.kind, state: p.state, inv: p.inv, sniffsLeft: p.sniffsLeft, scentCalls: p.scentCalls, dist, canSee: canSee(p, dist), rad: p.rad, x: p.x, z: p.z, sightLock: p.sightLock ? { phase: p.sightLock.phase, t: p.sightLock.t } : null };
  };
```

`engine/forest-engine.d.ts:165-175` gains `rad: number;` in the returned object shape (next
to `dist`/`canSee`), with the doc comment above it (`:159-164`) getting one added line:
"LUL-2320: `rad` (`PSPEC[kind].rad`) lets a test compute the live contact-catch threshold
(`rad + CATCH_MARGIN`) without hardcoding species constants."

**3. New hook, `qaStageChaseAtContact`** — placed after `qaStageForceHuntApproach`
(`engine/forest-engine.js:3834-3844`), same style:

```js
  // LUL-2320: places predator[kind] dx/dz from the player (player untouched, so KeyH staging
  // done before this call survives it) directly into `chase` with a scentLock held open, the
  // exact state the glue bug's root cause (#4 in the ticket) describes -- blind pursuit at
  // full species speed with no LOS requirement while scentLock > 0 (`:2248-2250`). dx/dz is
  // the caller's choice deliberately, not auto-placed at contact range, so a test can also
  // exercise the normal "closing distance" leg before the predator arrives. Clears every
  // higher-priority branch (charge/sightLock/alert/reroute/hunt) that would otherwise pre-empt
  // `chase` this tick, same set qaStageForceHuntApproach already clears. Returns
  // `{idx,x,z}`, or null if the species isn't spawned.
  window.ForestEngine.qaStageChaseAtContact = function(kind, dx, dz){
    const idx = predators.findIndex(p => p.kind === kind);
    if(idx < 0) return null;
    const p = predators[idx];
    p.x = player.x + dx; p.z = player.z + dz;
    p.vx = p.vz = 0; p.charge = null; p.sightLock = null; p.alert = 0; p.reroute = 0; p.stuckT = 0;
    p.hunt = false; p.state = 'chase'; p.scentLock = SCENT_TRACK_TIME; p.alertedBy = null;
    return { idx, x: p.x, z: p.z };
  };
```

`SCENT_TRACK_TIME` is already an in-scope module constant (used at `:1852`,
`scentOnto()` — same value a real scent pickup sets `p.scentLock` to, so this hook reproduces
a real blind-chase lock, not an inflated synthetic one).

`engine/forest-engine.d.ts`, next to `qaStageForceHuntApproach` (`:130-131`):

```ts
      /** LUL-2320: places predator `kind` dx/dz from the player and drops it straight into `chase` with a live `scentLock` (the exact blind-pursuit state the glue bug's root cause describes) -- player untouched. Returns `{idx,x,z}`, or null if the species isn't spawned. */
      qaStageChaseAtContact?: (kind: 'wolf' | 'bear' | 'lion', dx: number, dz: number) => { idx: number; x: number; z: number } | null;
```

### `docs/ELEMENTS.md`

**Player collision profile** (`:184-193`) — the bullet at `:187-190` currently reads:

```markdown
- Two different downstream checks read player position without going through
  `blocked()`: `hasLOS()` (sight, rotated-AABB raycast, includes tagged
  trees `s>1.4`) and the distance-only scent/noise/catch/pickup/win checks
  above — geometry gates *sight only*; it never gates scent or hearing
  (`checkScent()` and `checkNoise()` take no cover/LOS
  argument at all).
```

Replace with:

```markdown
- Two different downstream checks read player position without going through
  `blocked()`: `hasLOS()` (sight, rotated-AABB raycast, includes tagged
  trees `s>1.4`) and the distance-only scent/noise/pickup/win checks above —
  geometry gates *sight only*; it never gates scent or hearing (`checkScent()`
  and `checkNoise()` take no cover/LOS argument at all). **Catch is the
  exception** (LUL-2320): `chase`/`hunt` gate a kill on `canCatchInChase()`/
  `isCaught()`, which read `canSee()` (and therefore `hasLOS()`) whenever the
  player is `hidden` — only an *un-hidden* player in contact is caught by
  distance alone. See the Log/Bramble cards and the predator card below for
  what that means while standing inside either prop's own footprint.
```

**Log card, "Collision & physics profile"** (`:564-572`) — `:567-569` currently reads:

```markdown
- **No movement collision for either actor** (LUL-384 removed the
  player-only block; predators never had one). Catch resolves normally on
  or beside a log — `isCaught()`/chase are proximity checks, never gated on
  `blocked()`/`coverBlockedR()`, so a log is not a safe zone.
```

Replace with:

```markdown
- **No movement collision for either actor** (LUL-384 removed the
  player-only block; predators never had one). Catch is **not** purely a
  proximity check while `hidden` is true and the player's exact position is
  inside the log's footprint: `hasLOS()` (LUL-2320) still treats that
  footprint as concealment from every angle at range, same as it always did
  for `hidden`, and only stops once a predator closes to contact range
  (`rad + CATCH_MARGIN`) — `canSee()`'s new `insideHideFootprint()` check.
  An **un-hidden** player standing on/at a log is caught on contact
  regardless of LOS (`canCatchInChase()`'s `hidden` parameter) — walking
  onto a log without pressing `H` is not a safe zone. Before LUL-2320,
  `hasLOS()` treated the log's footprint as an occluder unconditionally
  (hidden or not, any range), which made *any* player standing on it
  uncatchable and glued a chasing predator at contact range forever — see
  wiki `game/lul2320-log-los-catch`.
```

**Bramble card, "Collision & physics profile"** (`:616-621`) — `:618-621` currently reads:

```markdown
- **No movement collision for either actor** (LUL-1642 matched Log's
  LUL-384 exemption; predators never had one). `findHideSpot()`-eligible,
  unaffected — that function reads `coverGrid` directly and never calls
  `coverBlockedR()`.
```

Append one sentence:

```markdown
- **No movement collision for either actor** (LUL-1642 matched Log's
  LUL-384 exemption; predators never had one). `findHideSpot()`-eligible,
  unaffected — that function reads `coverGrid` directly and never calls
  `coverBlockedR()`. Same LUL-2320 catch behaviour as Log above: `hidden`
  protects at range, contact range still catches.
```

**Predator card, "Collision & physics profile"** (`:425-432`) — `:429-430` currently reads:

```markdown
- LOS: same rotated-AABB raycast as the player's own (`hasLOS()`), applied
  symmetrically (`canSee()` calls it both directions along the same line).
```

Append:

```markdown
- LOS: same rotated-AABB raycast as the player's own (`hasLOS()`), applied
  symmetrically (`canSee()` calls it both directions along the same line).
  LUL-2320: a predator standing inside a log/bramble's own footprint is not
  blinded by it either (`hasLOS()`'s symmetric origin-side skip) — matches
  the player-side fix and keeps the raycast genuinely symmetric.
```

Run `node scripts/check-elements-citations.mjs` (no `--fix` expected — no cited symbol's
declaration line moves; `canCatchInChase`/`canSee`/`hasLOS` all keep their names and files)
before committing.

## Verification

1. `npx next typegen && npx tsc --noEmit` — clean (must run `typegen` first, see wiki
   `systems/lullwood-checkout`).
2. `npm run build` — clean.
3. `npx eslint lib/game/cover.ts lib/game/predator.ts engine/forest-engine.js engine/forest-engine.d.ts` — clean.
4. `node scripts/check-elements-citations.mjs` — clean.
5. `node scripts/check-duplicate-logic.mjs` — clean (confirms `catchDist`/`CATCH_MARGIN`
   aren't flagged as a duplicated constant — `cover.ts` never hardcodes `1.3`).
6. `node --test lib/game/cover.test.ts lib/game/predator.test.ts` — all green, including the
   new cases below and every existing case unchanged (per the table in §C and the
   `catchDist=0` default in §B).
7. Determinism: no `rng()`/`Math.random()` call added anywhere in this diff — grep the diff
   to confirm. Every new/changed line is either pure geometry or a state assignment.
8. `npx playwright test e2e/positional-hiding.spec.ts e2e/smoke.spec.ts e2e/blind-chase-cover.spec.ts e2e/cover-feedback.spec.ts e2e/predator-determinism.spec.ts` — all green.

### New unit tests — `lib/game/cover.test.ts`

- `hasLOS`: a segment whose target endpoint is inside a `kind: 'log'` box is **not** blocked
  by that box (contrast with the existing `kind: 'rock'` case at `:504-507`, left unchanged).
- `hasLOS`: same, `kind: 'bramble'`.
- `hasLOS`: symmetric — the **origin** endpoint inside a `kind: 'bramble'` box is also not
  blocked by it (predator-standing-in-bramble case).
- `hasLOS`: a walkable box skip does not suppress an *other*, solid box on the same segment —
  place a `rock` further along the same line past a `log` the endpoint sits inside; still
  blocked by the rock.
- `insideHideFootprint`: true for a point inside a `log`/`bramble` box, false just outside its
  edge, false for a point inside a `rock` (not `HIDE_KINDS`).
- `canSee`: `hidden: true`, target inside a `bramble` footprint, `dist` just under
  `catchDist` → `false`; `dist` just at/over `catchDist` → `true` (strict `<`, mirrors
  `isCaught`'s own convention).
- `canSee`: `hidden: false`, same footprint/geometry → ordinary `effectiveDetect`/`hasLOS`
  path (the (B) branch never taken), i.e. behaves per (A) alone.
- `canSee`: `catchDist` omitted (default `0`) with `hidden: true` and target inside a
  footprint → always `false` regardless of `dist` (pins the default's documented behaviour).

### New unit tests — `lib/game/predator.test.ts`

- `canCatchInChase(true, 1, 1, false)` → `true` (not hidden, LOS, in range).
- `canCatchInChase(false, 1, 1, false)` → `true` (not hidden, **no** LOS, in range — the new
  case rule C adds).
- `canCatchInChase(false, 1, 1, true)` → `false` (hidden, no LOS — LUL-387's original
  guarantee, now reached via the explicit param instead of the default).
- `canCatchInChase(false, 1 + CATCH_MARGIN, 1, false)` → `false` (not hidden, but not in
  range either — `!hidden` never overrides `isCaught`).
- The five pre-existing 3-arg calls (`:71,75,79,83-84`) stay byte-identical — the default
  parameter is the thing under test there, not a rewrite.

## e2e

**Specs.** `e2e/positional-hiding.spec.ts`:

- New: `'wolf: standing on a log without hiding is not a safe zone (LUL-2320)'` — desktop,
  `qaHooks: true`. `qaTeleportToHideSpot('log')`, then `qaLurePredatorKind('wolf')`
  (`engine/forest-engine.js:3622-3634`, places the wolf 6u away with `hunt=true` — same rig
  the existing "hold-still alone does not save you" case at `:243-270` already uses for the
  open-ground equivalent). Do **not** press `KeyH`. Assert `#deathScreen` visible within
  20s and `#deathKind` is `wolf`. If the map has no log on the QA-pinned seed, `null` from
  `qaTeleportToHideSpot('log')` fails the test loudly (not silently skipped) — the QA-pinned
  seed is known to generate cover of both kinds (existing `qaHideBehindCoverKind` tests
  already depend on that).
- New: `'wolf: hiding on a log stops a blind-chasing predator without gluing to the player (LUL-2320)'` —
  desktop, `qaHooks: true`, `qaSetFixedStep`/`qaAdvance` (deterministic clock, same rig as
  `assertCoverHidesFromSpecies`, `:200-213`). `qaTeleportToHideSpot('log')`, press `KeyH`,
  confirm `qaPlayerState().hidden === true`, then `qaStageChaseAtContact('wolf', 1.0, 0)` (1
  unit away — inside `CATCH_MARGIN` for every species, so the predator starts already in
  the contact zone the glue bug describes). Advance in fixed steps for up to 15 game-seconds,
  sampling `qaPredatorState(idx)` each step:
  - `#deathScreen` must never appear (assert count 0 at the end, and inline on every step
    for a fast, specific failure rather than only the final assertion).
  - No-glue assertion: track consecutive samples with `dist < rad + CATCH_MARGIN`
    (`qaPredatorState`'s new `rad` field) and fail if that streak exceeds 1 real
    game-second's worth of steps — the predator may touch contact range momentarily
    (the tick before (D)'s transition fires) but must not sit there.
  - Eventually `inv === 'sniff'`, then eventually `state === 'roam'` with a
    `predator_gave_up` chronicle entry (reuse whatever chronicle-read hook
    `assertCoverHidesFromSpecies` already relies on, or `qaPredatorState`'s `state` field if
    the chronicle isn't directly queryable — confirm which during implementation and use the
    existing pattern, don't invent a second one).
- New: `'lion: hiding inside a bramble footprint in the open survives at range, dies within 5s of moving (LUL-2320)'` —
  desktop. `qaTeleportToHideSpot('bramble')`, press `KeyH`, `qaLurePredatorKind('lion')`
  with the lion placed beyond contact range (confirm via `qaPredatorState`'s `dist`/`rad` —
  if `qaLurePredatorKind`'s fixed 6u placement lands inside `lion.rad + CATCH_MARGIN`
  adjust the case to lure at range instead, e.g. reuse `qaStageForceHuntApproach` with a
  larger `dx`). Assert survives (no `#deathScreen`) for 5s while holding still, then release
  `KeyH` and press `KeyW`: assert `#deathScreen` appears within 5s (matches (B)'s "protection
  ends the instant `hidden` is false" and (A)'s "un-hidden + inside footprint is ordinary
  LOS", which is clear here since the lion is in the open).
- Existing: `assertCoverHidesFromSpecies` (wolf/bear/lion, `:222-241`), `'hold-still alone
  does not save you when a predator is on top of you'` (`:243-270`) — must pass unchanged;
  neither touches a `HIDE_KINDS` prop's interior.

`e2e/smoke.spec.ts` hunting wolf/bear/lion kill cases, `e2e/blind-chase-cover.spec.ts`,
`e2e/cover-feedback.spec.ts`, `e2e/predator-determinism.spec.ts` — must pass unchanged; all
exercise `hasLOS`/`canSee` against solid (non-`HIDE_KINDS`) cover, which (A)/(B) never touch.

**Hooks.**
- `window.ForestEngine.qaTeleportToHideSpot(kind?): string | null` — extended, optional
  param, `engine/forest-engine.js:3866` / `.d.ts:135`.
- `window.ForestEngine.qaPredatorState(idx): {...,rad,...} | null` — extended, additive
  field, `engine/forest-engine.js:3907` / `.d.ts:165`.
- `window.ForestEngine.qaStageChaseAtContact(kind, dx, dz): {idx,x,z} | null` — new, declared
  in `engine/forest-engine.d.ts`, installed inside the `?qaHooks=1` block in `init()`,
  `engine/forest-engine.js` (next to `qaStageForceHuntApproach`).

**Tester scenario.** The nightly local-qa tester audits HUD/overlap and the LOSE/WIN
sequences via a vision model (`shared/local-qa/QA_TESTER.md`); it doesn't probe predator-AI
state-machine timing, same reasoning `lul-2246-force-hunt-lock.md`'s spec gave — no
`shared/local-qa/requests/` file needed. The Playwright suite above is what's allowed to
assert this gameplay correctness (wiki `systems/headless-qa-rig`).

**Not covered.** No mobile counterpart — pure predator/detection simulation, no rendering,
HUD, or input-handling surface, same reasoning as every other predator-AI e2e spec in this
codebase (`e2e/predator-memory.spec.ts`, `e2e/scent.spec.ts`, `e2e/blind-chase-cover.spec.ts`
have none either). Feel — does the standoff-then-give-up read as "the animal lost me" rather
than "it glitched" — is unverified until a human or the local-qa tester's vision-model pass
says so.

## Constraints

- `shouldGiveUpChase`, `rollSniffs`'s N values, `SNIFF_APPROACH_MARGIN`, `SNIFF_STANDOFF`,
  `SNIFF_IMMUNITY_TIME`, `sniffStandoffPoint()`'s own math — none edited. (D) calls
  `rollSniffs(rng, 4)` with the exact same arguments the pre-existing
  `chase → investigate` transition already uses one branch up (`:2250`), not a new roll
  shape.
- `coverBlockedR`/`blockedForPredator` (movement collision) — untouched. This fix is entirely
  in the LOS/kill-gate path.
- `segRayVsAABB` itself — untouched; (A) only changes which boxes `hasLOS()` calls it against.
- No new `DetectionState` field — (B) computes `insideHideFootprint()` fresh inside `canSee()`
  from the `coverGrid` it already receives, per the PLAN's stated preference, rather than
  threading a boolean the engine would have to keep in sync by hand every tick.
- Win rule, end-screen persistence (`e2e/win-persist.spec.ts`, `e2e/death-persist.spec.ts`,
  `e2e/replay/*.spec.ts`) — untouched, not on this diff's path.
- Seed determinism — no `Math.random()`/new `rng()` draw added; `insideHideFootprint()` and
  the `hasLOS()` box-skip are pure geometry, same determinism class as their callers today.
- CI stays green: `scripts/check-duplicate-logic.mjs`, `scripts/check-elements-citations.mjs`.

## Out of scope

- LUL-2311 (remove log hiding) — this diff's e2e coverage deliberately does not assume it has
  landed (bramble alone reproduces the bug; the new log-specific case is written to still be
  meaningful if LUL-2311 later removes log from `HIDE_KINDS`, since it also covers the
  un-hidden/no-longer-hideable case either way).
- LUL-2306 (predator collision radius + steering unstick) — touches the identical `chase`
  block this diff edits (`:2266-2280`, LUL-2306's brief wants the same steering line). Per
  the PLAN, LUL-2306 stays unassigned in `todo` until this PR merges to `release/next`;
  whoever picks it up next branches from a post-merge head.
- Retuning `CATCH_MARGIN`, `SNIFF_STANDOFF`, or any existing constant's value — this is a
  correctness fix restoring a kill path, not a balance pass.
- The `docs/ELEMENTS.md` predator card's stale movement-collider claim (`:426-428`, "checked
  only against the tree-trunk grid... never `coverBlockedR`" — contradicted by LUL-1643's
  `blockedForPredator()`, already live on `main`) — pre-existing drift, unrelated to LOS/catch,
  not this ticket's doc-update list. Flagged here so a reviewer doesn't wonder if it was
  missed; file separately if it should be fixed.
