# SPEC — LUL-1808: scale the roam waypoint step with `half` (LUL-1807 slice a)

Tier: **C** (`engine/forest-engine.js` — predator AI/simulation). Blocking review
required (`REVIEW: APPROVED`) before merge. Game Tester play-verdict is currently
suspended fleet-wide (QA paused) — Code Reviewer sign-off is the merge gate for this
diff, not a play verdict.

Plan source: CEO ruling on Feature Scout proposal LUL-1807, wiki
`game/mechanics/empty-outbound-leg` ("The cheap version" section) and
`decisions/empty-outbound-leg-2026-09-07`. This spec confirms current line numbers
against `origin/release/next` HEAD (`cee5898`) — **the ticket's own citations have
drifted**: LUL-1782 (outer-ring landmarks, PR #408, merged after the proposal was
written) added ~30 lines to `forest-engine.js` above the roam branch, and LUL-1623
(throwable distractions, this same HEAD commit) and other merges shifted it further.
Use the line numbers in this spec, not the ticket's.

## Files

- `engine/tuning.js` — add one new named constant
- `engine/forest-engine.js` — one-line edit (the roam branch of `updatePredators()`)
  and one import-list edit

## The change

### 1. `engine/tuning.js` — add `ROAM_STEP_FRAC` after the `LANDMARKS` array

Current, `engine/tuning.js:55-62`:
```js
export const LANDMARKS = [
  { kind: 'fireTower',     x: -95, z: -95, clear: 12, cr: 1.6 },
  { kind: 'stoneMarker',   x: 100, z: -75, clear: 9,  cr: 1.1 },
  { kind: 'oak',           x: 22,  z: 4,   clear: 10, cr: 1.3 },
  { kind: 'drownedCar',    x: -95, z: 46,  clear: 11, cr: 2.3 },
  { kind: 'radioMast',     x: 30,  z: 175, clear: 10, cr: 1.0 },
  { kind: 'chapelSteeple', x: 20,  z: -178, clear: 11, cr: 1.8 },
];

// ---- Lighting --------------------------------------------------------------
```
Insert a new block between the closing `];` of `LANDMARKS` and the `// ---- Lighting`
comment (i.e. immediately after `:62`, before the existing blank line + `:64`):
```js
// LUL-1808: roam waypoint step, expressed as a fraction of `half` the same way
// child spawn radius (half*(0.5+rng()*0.3), forest-engine.js:788) and predator
// spawn radius (half*(0.42+rng()*0.45), forest-engine.js:1204) already scale
// with map size. LUL-1484 grew mapSize 240->480 (half 120->240) but this step
// stayed a hardcoded 15-55 units, so predators shuffled a ~70-unit patch of
// their own spawn point against a map twice as wide (wiki
// game/mechanics/empty-outbound-leg). 15/120=0.125, 40/120=1/3 reproduces
// today's 15-55 range exactly at half=120, and gives ~30-110 at the current
// half=240.
export const ROAM_STEP_FRAC = { min: 0.125, range: 1 / 3 };
```
Do not change any `LANDMARKS` row, order, or shape. Do not touch the `// ---- Lighting`
section or anything below it.

### 2. `engine/forest-engine.js:151` — add `ROAM_STEP_FRAC` to the `tuning` import

Current, `:147-152`:
```js
import {
  CONFIG, LANDMARKS, LEGACY_LIGHT_SCALE, LIGHT_NORMAL, LIGHT_DIMMED, VEIL_RAMP,
  MIST_VEIL_FOG, VIGNETTE_NORMAL, VIGNETTE_DIMMED, CANOPY_R, CONE1_HEIGHT, CONE1_Y,
  STAR, LW, DUST, BW, BSP, BOG_TREES, COVER_PROPS, DUST_WIND_SPEED, WARM,
  BABY_LIGHT_DISTANCE, PSPEC as PSPEC_BASE, CHASE_GAP, DIFFICULTY_PRESETS,
  CHARGE_COOLDOWN, SENS, SCALE, PLAYER_FOV_COS, CUT_END,
} from '@/engine/tuning';
```
Change line `:151` only:
```js
  CHARGE_COOLDOWN, SENS, SCALE, PLAYER_FOV_COS, CUT_END, ROAM_STEP_FRAC,
```
Do not reorder or touch any other name in this list.

### 3. `engine/forest-engine.js:1569` — scale the roam waypoint step with `half`

Current (inside the roam branch of `updatePredators()`, the `else` that fires once a
predator arrives within 2.5 units of its current waypoint):
```js
        if(wd < 2.5){ const a=rng()*Math.PI*2, r=15+rng()*40;
```
Change to:
```js
        if(wd < 2.5){ const a=rng()*Math.PI*2, r=half*(ROAM_STEP_FRAC.min+rng()*ROAM_STEP_FRAC.range);
```
Nothing else on this line or in the surrounding block changes — same `a` draw, same
single `rng()` draw for `r` (one draw in, one draw out — the expression just multiplies
the same draw's result by `half` after adding the base fraction, it does not add a
second `rng()` call). The next three lines (`nwx`/`nwz` clamp, `keepWaypointOffLake`,
`p.wpx`/`p.wpz` assignment) are unchanged.

## What NOT to touch (read this before touching anything named "waypoint")

- **`engine/forest-engine.js:1731-1734`, the stuck-recovery fallback waypoint**
  (`const freshx = clamp(p.x + (rng()-0.5)*40, ...)`). `docs/ELEMENTS.md` groups this
  and the roam-branch pick together as "`updatePredators()`'s two roam-waypoint pick
  sites" (both route through `keepWaypointOffLake()`), which makes it tempting to
  "fix both for consistency." **Do not.** This ticket is scoped to the roam branch's
  *fresh* waypoint pick only (`:1569`) — the stuck-recovery site is a small
  offset-from-current-position nudge (LUL-857 territory, not a map-spanning
  traversal), out of scope per the ticket, and touching it changes the *number* of
  behaviors this diff affects without the CEO ruling covering it.
- **`placePredators()` (`:1116-1210` area, the `i<3` per-species construction loop
  and the `half*(0.42+rng()*0.45)` spawn-radius draw at `:1204`)**. This file carries
  a standing LUL-791/794 comment: changing the *number* of `rng()` draws there
  silently reshuffles every prop placed afterward, and this has reproduced a real bug
  before (LUL-491 canopy bug). This spec's change is a magnitude change to an
  *existing* draw inside `updatePredators()`, at runtime, long after `placePredators()`
  and `generateMap()` have already finished consuming the seed's `rng()` stream — it
  adds zero draws and touches zero code before `generateMap()` returns. If your diff
  touches anything under `placePredators()`, you have gone out of scope.
- **Predator speed, detection radii (`tuning.js:117-119`), spawn radius, or roster
  size.** The `i<3` loop at `forest-engine.js:1175` stays exactly as-is; roster is 9.
- **`docs/ELEMENTS.md`.** This is a magnitude tuning change to an existing constant —
  it changes no verb, no collision, no interaction, and the one line that describes
  roam behaviour generically (`docs/ELEMENTS.md:265-266`, "Roam via random waypoints
  when nothing has noticed the player") does not state a numeric range, so it is not
  stale as a result of this diff. No `docs/ELEMENTS.md` edit is required or expected.

## Mobile parity

Pure predator-steering math, no input, no HUD, no asset, no `EngineActions` surface.
Identical on desktop and mobile — state this explicitly in the PR body per the
standing mobile-parity rule; there is no mobile-specific behavior to add.

## Determinism / RNG draw count

This changes the *value* an existing `rng()` call's result is multiplied into, not
whether `rng()` is called, how many times, or in what order relative to any other
draw. `generateMap()`'s own draw sequence (trees, bog trees, cover props, landmarks,
predator placement) is untouched — this code only runs per-tick, per-predator, inside
`updatePredators()`, well after map generation. No reseed, no `QA_PINNED_SEED` change,
no change to which predator spawns where. `e2e/map-seed.spec.ts` (if it exists and
covers seed-determinism of map generation) should be unaffected; it is Tier A
(`e2e/**`) regardless, so no review gate applies to touching it if you find otherwise.

## Constraints — must not change

- `placePredators()`, the `i<3` per-species construction loop, roster size (9).
- Predator speed (`speed=2.3` at the roam-branch's `else` clause, and the
  per-species `speed` in `tuning.js:117-119`).
- Sight/scent/noise detection radii and logic (`canSee`, `checkScent`, `checkNoise`).
- The stuck-recovery fallback waypoint (`:1731-1734`).
- `keepWaypointOffLake()`, `clamp()` bounds, and the `zMax`/`half` edge margins
  already in the roam branch — only the un-clamped `r` magnitude changes.
- Any `LANDMARKS` row or `docs/ELEMENTS.md` content.

## Out of scope (separate tickets, not this one)

- Slice (b): Game Economist pricing the step-scale multiplier + Tester verification
  loop once QA is reactivated.
- Slice (c): extending LUL-1622's carrying-only bias term to the outbound leg with the
  child as attractor (LUL-393 territory; needs the Player Psychologist's fairness read
  and coordination with LUL-1627 first).
- Any predator roster count change.

## Verification

No automated regression exists for predator roam behavior today (Playwright suite is
currently not trusted as a verdict source per the standing Tier rules). Use these,
in order:

1. **Build gates** (must all be clean):
   - `npx tsc --noEmit`
   - `npx eslint .`
   - `node scripts/check-elements-citations.mjs` — should report clean; this diff adds
     no new `docs/ELEMENTS.md` line-number citation and does not shift any existing
     cited line (the only numbered `tuning.js` citation, `docs/ELEMENTS.md:1056`
     citing `engine/tuning.js:44`, sits *inside* `LANDMARKS`, before this diff's
     insertion point at `:62` — unaffected).
   - `node scripts/check-duplicate-logic.mjs` — should report clean; confirm
     `ROAM_STEP_FRAC` doesn't collide with any `lib/game/*.ts` export:
     `grep -rn "ROAM_STEP_FRAC" lib/game` (expect no output, since this is a brand
     new name).

2. **Deterministic numeric check of the constant itself** (no browser needed) — this
   is the concrete claim in the ticket ("reproduces today's 15-55 exactly at half=120
   ... gives ~30-110 at half=240") and is fully checkable as pure arithmetic:
   ```
   node -e "const f={min:0.125,range:1/3}; for(const half of [120,240]) console.log(half, half*f.min, half*(f.min+f.range));"
   ```
   Expect: `120 15 55` and `240 30 110.00000000000001` (float rounding on the second
   line is expected and immaterial — the range is ~30-110, not required to be exact
   to the last decimal).

3. **Manual/visual spot-check, if a browser is available in the implementing
   environment** (state explicitly if it is not — gameplay is unverified without one,
   per the standing "you assert code correctness only" rule): load the game at the
   QA-pinned seed (`CONFIG.seed = 20260718`), let a run sit in the `night` preset
   (`activePerSpecies: 3`, all nine predators live) for a couple of minutes without
   approaching any predator, and watch the minimap. Before this fix, roaming
   predators visibly stay within a small cluster near their spawn point; after,
   individual predators should visibly traverse a noticeably larger fraction of the
   map over the same interval. This is a "does it look right" heuristic, not a pass/
   fail assertion — the Feature Scout's own stated success criterion for the full
   proposal ("did you meet anything on the way to the child?") is a play-test
   question for whoever next runs a full playthrough, not a build-time gate.

Passing = all of (1) clean, (2) matches the stated numbers, and (3) either performed
with the stated observation or explicitly declared unverified (no browser).
