# SPEC: LUL-2407 scale predator detect radius on the QA micro map

**Ticket:** LUL-2407 (sibling: desktop variant reported under the same root cause, tracked
separately) · **Tier:** C — edits `engine/tuning.js` and `engine/forest-engine.js`'s live
detection math. `REVIEW: APPROVED` required before merge.

**Written against:** `release/next` @ `a07775a` (2026-09-11).

## Root cause (already confirmed against source, see LUL-2407 comment thread)

`applyQaWorldMicroPreset()` (`engine/tuning.js:202-208`) shrinks `CONFIG.mapSize` 480 -> 96
(half 240 -> 48) for the QA rig but leaves `PSPEC.wolf/bear/lion.detect` (42/30/48,
`engine/tuning.js:240-242`) at their full-map absolute values. `placePredators()`
(`engine/forest-engine.js:1759`) spawns each predator at `d = half*(0.42+rng()*0.45)` from the
player's spawn point — 100.8-208.8u on the full map (past every detect radius, ~2.1x margin),
but only 20.16-41.76u on the micro map (inside every species' detect radius). Predators can
already see the idle player at t=0 on the QA rig, so a random roll can kill the player before a
scripted driver (e.g. `gate -> in-game -> hint -> menu-open -> qaTeleportNearBaby`) ever
finishes — this is what local-qa's `state-unreached-883a46e6f0` fingerprint caught.

## Files

- `engine/tuning.js` — add `CONFIG.detectScaleMul`, default 1; set to 0.2 inside
  `applyQaWorldMicroPreset()`.
- `engine/forest-engine.js` — fold `CONFIG.detectScaleMul` into the existing detect-multiplier
  chain in `effectiveDetect(p)` and `canSee(p, dist)`.

## The change

**`engine/tuning.js`** — in the `CONFIG` object (`tuning.js:16-34`), add one field next to
`mapSize`:

```js
mapSize: 480,
detectScaleMul: 1,    // LUL-2407: predator detect-radius multiplier; applyQaWorldMicroPreset()
                       // scales this down to match the shrunk map so spawn distance keeps the
                       // same safety margin against detect radius. 1 = full-map, no-op default.
```

In `applyQaWorldMicroPreset()` (`tuning.js:202-208`), add one line:

```js
export function applyQaWorldMicroPreset(){
  CONFIG.mapSize = 96;
  CONFIG.trees = 40;
  CONFIG.coverProps = 40;
  CONFIG.bogTrees = 0;
  CONFIG.bogReeds = 0;
  CONFIG.detectScaleMul = 0.2;   // LUL-2407: same 96/480 ratio the map itself shrinks by --
                                  // restores the full map's spawn-distance-to-detect-radius margin.
}
```

**`engine/forest-engine.js`** — `effectiveDetect(p)` and `canSee(p, dist)` (currently around
`forest-engine.js:2149-2155`; re-locate by grepping `DIFFICULTY_PRESETS[difficulty].detectMul *
veilDetectMul` if the branch has moved) each build a `detectMul` product before delegating to
`cover.ts`'s `effectiveDetect`/`canSee`. Append `CONFIG.detectScaleMul` to that product in both:

```js
function effectiveDetect(p){
  return geoEffectiveDetect(p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmountAt(p.x, p.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)) * timeOfRunDetectMul(timeOfRun) * CONFIG.detectScaleMul, { hidden, hideTime, carrying });
}
function canSee(p, dist){
  return geoCanSee(dist, p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmountAt(p.x, p.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)) * timeOfRunDetectMul(timeOfRun) * CONFIG.detectScaleMul, { hidden, hideTime, carrying }, p.x, p.z, player.x, player.z, coverGrid, CELL, WRAP_SPAN, p.rad + CATCH_MARGIN);
}
```

`cover.ts`'s `effectiveDetect`/`canSee` signatures (`lib/game/cover.ts:713`, `:721`) are
untouched — `detectMul` is already a plain composable number, this is one more multiplicand in
an existing product, not a new parameter.

Do not touch `placePredators()`'s `x*x+z*z < 2500` origin-clearance reject
(`forest-engine.js:1760`) — per LUL-791 it is an RNG-draw-count invariant on the full map, and
is not the cause of the close spawns (the ring distance `d` is drawn before the reject check
runs, so retrying doesn't change the distribution). Out of scope for this fix.

## Verification

- `node --test` — unchanged (this diff adds no new unit-testable pure function; the multiplier
  chain lives inline in the engine's `effectiveDetect`/`canSee` closures, exercised only by the
  new e2e coverage below).
- `npx tsc --noEmit` / `eslint` — clean.
- `grep -n "detectScaleMul" engine/tuning.js` — confirms the default-1 line exists once and the
  micro-preset override exists once; on the full map (`detectScaleMul` never reassigned) the
  multiplier chain's extra factor is exactly `1`, i.e. provably zero behavior change off the QA
  rig.

## e2e

**Specs.** `e2e/qa-world-micro.spec.ts` — new test `'scales predator detect radius with the
micro map'` in a new `describe('detectScaleMul')` block (extended file, new case).
**World.** micro (default) — `qaBuildScene({ predators: [{ kind: 'wolf', x: <dist>, z: 0,
state: 'roam' }] })`, player left at its default (0,0) boot position, no trees/props so line of
sight is trivially clear.
**Hooks.** `qaPredatorState(idx)` (existing, `engine/forest-engine.d.ts:171`, returns live
`canSee`/`dist`) — already reaches `canSee(p, dist)`, the exact function this diff edits; no new
hook needed. `qaBuildScene` (existing, `engine/forest-engine.d.ts:424`) places the predator at
an exact, deterministic offset instead of relying on `placePredators()`'s RNG roll, so the test
is not flaky the way the original bug report was.
**Tester scenario.** None new — this is QA-infra, not a player-visible mechanic; local-qa's own
`pickup-prompt` scenario (the one LUL-2407 was filed against) is the regression check that this
fix keeps green going forward.
**Not covered.** The original bug's exact repro path (random `placePredators()` roll killing the
player before a scripted driver finishes) is inherently non-deterministic and not worth
re-encoding as a flaky e2e case — `qaBuildScene` gives the same multiplier chain a deterministic,
exact-distance assertion instead.

## Cues

**Visual.** None — QA-infra only, `detectScaleMul` defaults to `1` (no-op) everywhere a player
can reach.
**Audio.** None.
**Explanation.** None.
**Reduced motion.** N/A.

## Constraints

- `detectScaleMul` must default to `1` and only ever be reassigned inside
  `applyQaWorldMicroPreset()` — any other write path would be a silent full-map difficulty
  change.
- No change to `cover.ts`'s exported `effectiveDetect`/`canSee` signatures.

## Out of scope

- `placePredators()`'s origin-clearance reject constant (see Root cause above) — real but
  unrelated waste, not the cause of this bug; leave it alone per LUL-791.
- The desktop sibling ticket's own closure — same root cause, same fix; close it by reference
  once this merges rather than duplicating the diff.
