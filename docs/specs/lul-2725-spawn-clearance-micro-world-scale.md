# SPEC: LUL-2725 scale placePredators() spawn-clearance for qaWorld=micro

**Ticket:** LUL-2725 · **Tier:** C — touches `placePredators()`'s `rng()`-consuming retry
loop inside `generateMap()`'s shared-RNG-stream call chain (wiki
`game/lul791-lake-predator-spawn-rng-shift`, LUL-791/LUL-794 P1). Needs `REVIEW: APPROVED`
from the Code Reviewer before merge — do not merge on green alone.

**Written against:** `release/next` @ `a0936f3d47e50c8da441952d7f54cb88c42653dc` (2026-09-16).
Re-derive every `file:line` below from the branch you actually implement on if it has moved.

**Severity (CTO retriage, comment on LUL-2725):** QA-rig fidelity only. `qaWorld=micro` is
read once from a URL query param at `engine/forest-engine.js:245` — a real player's session
never sets it, so the full map (`CONFIG.mapSize=480`, `half=240`) is untouched by this bug.
No production/player impact; this fixes false-positive `[BUG]` findings from the nightly
local-qa tester's default micro world (LUL-2377).

## Files

- `lib/game/spawnClearance.ts` — new. Pure scale function, same pattern as
  `lib/game/wrap.ts`/`lib/game/veil.ts` (small pure math extracted from `forest-engine.js`
  for unit-testability).
- `lib/game/spawnClearance.test.ts` — new. Pins the full-map identity permanently.
- `engine/forest-engine.js` — edit. Import the new function; scale the two clearance
  constants in `placePredators()`'s retry loop (`:1957-1959`).
- `e2e/predator-spawn-clearance.spec.ts` — new. Statistical micro-world regression test,
  same method as the ticket's own live evidence (`qaRegenerateMap` + `qaProbeMapSeed`).

No `docs/ELEMENTS.md` change — this adds no new player-facing state (severity note above:
the fix is inert on every real map).

## The change

### `lib/game/spawnClearance.ts` (new)

```ts
// LUL-2725: placePredators()'s spawn-clearance retry loop
// (engine/forest-engine.js, LUL-791/LUL-794 P1 comment) used the same fixed
// 50u-from-origin / 34u-from-baby constants at every CONFIG.mapSize. At
// qaWorld=micro's half=48 (engine/tuning.js applyQaWorldMicroPreset(),
// CONFIG.mapSize=96) the 50u exclusion radius covers nearly the entire
// usable square, so the loop's 60-try budget occasionally exhausts and
// falls through with a candidate close to the origin -- observed live at
// 5.0u in 1/40 trials. This scales the constants by the same 96/480 ratio
// applyQaWorldMicroPreset() already uses for detectScaleMul/speedScaleMul/
// missionScaleMul (tuning.js:216-222), extracted to a pure function so the
// full-map identity (scale===1, hence 2500*1*1===2500 and 34*1===34 --
// byte-identical rng() accept/reject outcome and draw count to today) is a
// permanent unit test, not a one-time manual diff.
export const FULL_MAP_HALF = 240;

/** Linear scale for the spawn-clearance constants, keyed off the map's
 * half-width. Exactly 1 for any half>=FULL_MAP_HALF (every real map),
 * shrinking proportionally below that. */
export function spawnClearanceScale(half: number): number {
  return Math.min(1, half / FULL_MAP_HALF);
}
```

### `lib/game/spawnClearance.test.ts` (new)

Cover at minimum:
- `spawnClearanceScale(240)` === `1` (exact, full map).
- `spawnClearanceScale(480)` === `1` (defensive: larger than full map still clamps to 1).
- `spawnClearanceScale(48)` === `0.2` (qaWorld=micro, exact — same ratio
  `applyQaWorldMicroPreset()` uses).
- `spawnClearanceScale(120)` === `0.5` (an arbitrary intermediate half, proves linearity).
- Full-map byte-identity, spelled out explicitly (this is the LUL-791 wiki checklist's
  "diff base vs head on the same fixed seed" requirement, made a permanent assertion instead
  of a one-time manual diff): with `scale = spawnClearanceScale(240)`, assert
  `2500 * scale * scale === 2500` and `34 * scale === 34`.

### `engine/forest-engine.js` (edit)

1. Add the import in the existing `@/lib/game/*` import block (any line in that group —
   order is not significant, e.g. near `@/lib/game/wrap` at `:84-85`):
   ```js
   import { spawnClearanceScale } from '@/lib/game/spawnClearance';
   ```

2. In `placePredators()`, hoist one scale read above the per-predator loop (it does not
   change between predators) and use it in the retry condition. Current code
   (`:1936-1959`):
   ```js
   function placePredators(){
     ...
     const preset = DIFFICULTY_PRESETS[difficulty];
     for(const p of predators){
       ...
       let x, z, tries = 0;
       do { x=rnd(-half+margin, half-margin); z=rnd(-half+margin, half-margin); tries++; }
       while((x*x+z*z < 2500 || Math.hypot(x-baby.x, z-baby.z) < 34 || blockedR(x, z, p.rad+0.5)) && tries < 60);
   ```
   New:
   ```js
   function placePredators(){
     ...
     const preset = DIFFICULTY_PRESETS[difficulty];
     // LUL-2725: scale===1 on every real map (half>=240) -- see
     // lib/game/spawnClearance.ts and its full-map identity test. Only
     // qaWorld=micro's half=48 changes the threshold.
     const clearScale = spawnClearanceScale(half);
     for(const p of predators){
       ...
       let x, z, tries = 0;
       do { x=rnd(-half+margin, half-margin); z=rnd(-half+margin, half-margin); tries++; }
       while((x*x+z*z < 2500*clearScale*clearScale || Math.hypot(x-baby.x, z-baby.z) < 34*clearScale || blockedR(x, z, p.rad+0.5)) && tries < 60);
   ```
   Note `x*x+z*z < 2500*clearScale*clearScale` (not `< (50*clearScale)**2`) — keep the
   left side exactly as-is (`x*x+z*z`, no `Math.hypot`/`Math.pow` call) so no floating-point
   rounding is introduced into the retry condition beyond the multiplication itself; at
   `clearScale===1` this is `2500*1*1` which is exactly `2500` in IEEE 754, not merely
   "close".

3. Extend the existing LUL-791/LUL-794 comment immediately above the loop (`:1942-1956`)
   with one line noting the LUL-2725 addition and pointing at the new module, so the next
   person editing this loop sees both constraints together. Do not otherwise reword that
   comment — it documents a separate, still-binding constraint (no `inLake()` in this
   loop's condition).

## Verification

- `npx vitest run lib/game/spawnClearance.test.ts` — all assertions pass, including the
  full-map identity checks.
- `npx tsc --noEmit` — clean (new import, new file).
- `npx eslint lib/game/spawnClearance.ts lib/game/spawnClearance.test.ts engine/forest-engine.js e2e/predator-spawn-clearance.spec.ts` — clean.
- `npx playwright test e2e/predator-spawn-clearance.spec.ts` — passes (micro world, no
  `@fullmap`, runs on the QA rig).
- `npx playwright test e2e/map-seed.spec.ts e2e/predator-determinism.spec.ts --grep @fullmap` locally with `E2E_FULLMAP=1` — must still pass unchanged (these already prove two
  same-seed full-map loads match each other; combined with the unit-test identity above,
  this closes the LUL-791 checklist's "diff base vs head" requirement without a new
  `@fullmap` spec file — the `FULLMAP_ALLOWLIST` in `lib/e2e-policy/world-policy.test.ts`
  is capped at 13 entries and is already at the cap; do not add a 14th).
- `npx vitest run lib/e2e-policy/world-policy.test.ts` — still passes (no new `@fullmap`
  file added).
- `node .github/scripts/check-elements-citations.mjs` (or equivalent CI step) — unaffected,
  no `docs/ELEMENTS.md` change.

## e2e

**Specs.** `e2e/predator-spawn-clearance.spec.ts` — new — `'every predator spawns outside
the scaled clearance radius across 100 map regenerations'`. Boots `qaWorld=micro` (default),
loops `qaRegenerateMap(seed)` for `seed = 1..100`, and after each regeneration reads
`qaProbeMapSeed()` and asserts every predator's distance from the origin is
`>= 50*0.2 - epsilon` and distance from the baby is `>= 34*0.2 - epsilon` (epsilon ~0.01 for
float slack). This is the same method the ticket's own live evidence used (40 trials, 1
failure at 5.0u) — 100 trials gives comfortable margin above that sample size without
inventing a new methodology.
`e2e/map-seed.spec.ts` and `e2e/predator-determinism.spec.ts` — must pass unchanged
(`@fullmap`, run locally with `E2E_FULLMAP=1`, not on the rig per LUL-2377) — proves the fix
does not disturb full-map same-seed reproducibility. Neither file needs edits.
**World.** micro (default) for the new spec — no `qaBuildScene` staging needed, it drives
`generateMap()` itself via `qaRegenerateMap`, which is exactly the code path under test.
The two existing `@fullmap` specs it relies on for the full-map side are already on the
`FULLMAP_ALLOWLIST`; this spec adds no new entry.
**Hooks.** No new hooks. Both `qaRegenerateMap(seed: number): void`
(`engine/forest-engine.js:3863`) and `qaProbeMapSeed(): { seed, baby, trees, predators }`
(`:4066`, declared `engine/forest-engine.d.ts:80`) already exist and already expose
everything this test needs (predator `x`/`z`, baby `x`/`z`).
**Tester scenario.** None: not player-visible (severity note above — `qaWorld=micro` is
QA-rig-only, no real player session ever sets it). The e2e spec above is the regression
guard; no `shared/local-qa/requests/` file needed.
**Not covered.** Feel/audio: none — this changes no player-facing behavior. Real-device:
none — this is deterministic engine math, not a rendering or input path.

## Cues

Not applicable — no player-visible state, no new UI, no new input. Severity note above:
the bug is confined to `qaWorld=micro`, which no real player session ever activates.

## Constraints

- Full-map (`half>=240`) `rng()` accept/reject outcome and draw count must be byte-identical
  to today, for every seed and every predator candidate — this is the LUL-791/LUL-794 P1
  constraint. `spawnClearanceScale(half)===1` whenever `half>=240` is what guarantees this;
  do not change the clamp's `1` bound or the `240` constant without re-verifying every
  downstream `generateCover()`/`generateBogTrees()`/`generateReeds()`/`placeLandmarks()`
  draw is still unaffected (wiki `game/lul791-lake-predator-spawn-rng-shift`).
- Do not add `inLake(x,z)` to this loop's while-condition (still forbidden, same wiki page —
  unrelated to this change, restated because it sits in the same comment block).
- Left side of the origin check stays `x*x+z*z` (squared-distance compare), not a
  `Math.hypot`/`Math.pow` rewrite — keeps the full-map arithmetic exactly as it is today.
- Do not touch `blockedR(x, z, p.rad+0.5)` — unrelated to this bug, unscaled on purpose (prop
  collision radius, not map-size-relative clearance).

## Out of scope

- The still-unconfirmed "LUL-2606 Bug B" pattern this fix is a strong candidate for — this
  spec only fixes the spawn-clearance math; re-confirming Bug B against a build with this
  fix is separate follow-up work, not part of this diff.
- `blockedR`'s own prop-collision radius (`p.rad+0.5`) — untouched, not map-size-relative.
- Any change to `DIFFICULTY_PRESETS`/`activePerSpecies` — this fix applies regardless of
  which predators are active.
