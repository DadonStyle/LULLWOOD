# SPEC: LUL-2735 re-check origin/baby clearance after the lake push

**Ticket:** LUL-2735 · **Tier:** C — touches `placePredators()`'s post-retry-loop lake push
inside `generateMap()`'s shared-RNG-stream call chain (wiki
`game/lul791-lake-predator-spawn-rng-shift`, LUL-791/LUL-794 P1). Needs `REVIEW: APPROVED`
from the Code Reviewer before merge — do not merge on green alone.

**Written against:** `release/next` @ `939891b264cb0c49cd79597bf6927ab217c411b1` (2026-09-18).
Re-derive every `file:line` below from the branch you actually implement on if it has moved.

**Severity (carried from the ticket):** QA-rig fidelity only. `qaWorld=micro`'s half=48 makes
`CONFIG.lake`'s full-map-sized clearance ring (`tuning.js:59`, deliberately left unscaled)
cover a much larger fraction of the map, so this is the practical trigger; the same
interaction is geometrically possible on the full map too but "astronomically rarer" per the
ticket's own analysis (LUL-2732's regression spec already excludes it from its full-map-style
assertion rather than treat it as a live full-map bug). No production/player impact — this
closes a false-negative gap in QA-rig fidelity, same class as LUL-2725/LUL-2732.

## Files

- `lib/game/lake.ts` — edit. New pure function `pushOutOfLakeClearanceAvoiding()`.
- `lib/game/lake.test.ts` — edit. Unit-tests the new function, including the two live-repro
  seeds' geometry.
- `engine/forest-engine.js` — edit. `placePredators()`'s lake-push line (`:2036`) calls the
  new function with the origin/baby avoid-circles already computed by the surrounding loop,
  and falls back to the pre-push candidate if the result still fails `blockedR()`.
- `e2e/predator-spawn-clearance.spec.ts` — edit. Removes the LUL-2735 exclusion the LUL-2732
  spec already carries, so the existing 100-seed loop covers this case with no more
  carve-outs.

No `docs/ELEMENTS.md` change — no new player-facing state (severity note above: predator
spawn position is invisible engine mechanics, not a readout).

## The change

### `lib/game/lake.ts` (edit)

Add below the existing `pushOutOfLakeClearance()` (after `:66`), same file, no new imports:

```ts
// LUL-2735: pushOutOfLakeClearance() only guarantees the result clears the
// lake itself -- it walks the candidate straight out to lake.clear+margin
// along its own bearing with no awareness of anything else near the lake.
// engine/forest-engine.js's placePredators() retry loop already rejects
// candidates inside the origin/baby clearance circles *before* the lake
// push runs, but the push itself can walk a candidate that passed that
// check back into one of those circles (observed live: qaWorld=micro seed
// 43 pushed a bear to 6.786u of the baby, seed 141 a lion to 5.515u, against
// a scaled threshold of 6.8u). This wraps the existing push with a
// deterministic angular search around the *same* clearance-ring radius
// (never moves the point closer to or farther from the lake than the plain
// push already does -- only the angle changes, so "provably outside the
// lake" still holds), same "spiral outward, no rng(), give up and return
// the nominal result" shape as findClearLandmarkSpot() (LUL-2740,
// lib/game/landmarkClearance.ts) -- deliberately reused rather than
// reinvented. Callers on the shared LUL-791/LUL-794 rng() stream must not
// introduce an rng() call here; there is none.
const LAKE_CLEARANCE_RING_STEPS = 36; // 10-degree steps

export interface ClearanceCircle {
  x: number;
  z: number;
  r: number;
}

export function pushOutOfLakeClearanceAvoiding(
  x: number,
  z: number,
  lake: LakeConfig,
  avoid: readonly ClearanceCircle[],
  margin = 0.5,
): { x: number; z: number } {
  const pushed = pushOutOfLakeClearance(x, z, lake, margin);
  const clears = (px: number, pz: number) =>
    avoid.every((a) => Math.hypot(px - a.x, pz - a.z) >= a.r);
  if (clears(pushed.x, pushed.z)) return pushed;
  const targetDist = lake.clear + margin;
  const baseAngle = Math.atan2(pushed.z - lake.z, pushed.x - lake.x);
  for (let i = 1; i <= LAKE_CLEARANCE_RING_STEPS / 2; i++) {
    const step = (i / LAKE_CLEARANCE_RING_STEPS) * Math.PI * 2;
    for (const sign of [1, -1]) {
      const angle = baseAngle + sign * step;
      const px = lake.x + Math.cos(angle) * targetDist;
      const pz = lake.z + Math.sin(angle) * targetDist;
      if (clears(px, pz)) return { x: px, z: pz };
    }
  }
  return pushed; // every angle on the ring still fails -- return the plain push unchanged
}
```

### `lib/game/lake.test.ts` (edit)

Add after the existing `pushOutOfLakeClearance` tests, same `lake` fixture already declared
at the top of the file:

- Baseline: an avoid-list the plain push already clears (e.g. a circle far from the push
  point) returns the exact same result as `pushOutOfLakeClearance()` — proves the wrapper is
  a no-op when nothing conflicts.
- The two live-repro geometries from the ticket, reconstructed: a lake-interior candidate
  whose plain push lands inside a baby-sized avoid circle placed at the push point's exact
  coordinates minus a small offset (or simpler: place the avoid circle at
  `pushOutOfLakeClearance(candidate.x, candidate.z, lake)`'s own output with `r` large enough
  to force a conflict) — assert the returned point (a) is still at distance
  `lake.clear + margin` from the lake center (same ring, only angle moved), and (b) clears
  the avoid circle.
- Exhaustion: an avoid circle radius large enough to cover the *entire* ring (e.g. centered
  at the lake with `r > lake.clear + margin + 1`) — assert the function falls back to the
  plain `pushOutOfLakeClearance()` result unchanged (the "every angle still fails" path).
- Determinism: call twice with identical inputs, assert identical output (guards against an
  accidental `Math.random()`/`Date.now()` creeping in later).

### `engine/forest-engine.js` (edit)

1. Extend the existing `lib/game/lake` import (`:169-175`) with the new symbol:
   ```js
   import {
     inLakeWater,
     inLakeClearance,
     lakeSpeedMultiplier,
     pushOutOfLakeClearance,
     pushOutOfLakeClearanceAvoiding,
     keepWaypointOffLake,
   } from '@/lib/game/lake';
   ```

2. In `placePredators()`, replace the lake-push line (`:2036`):
   ```js
   if(inLake(x,z)){ const pushed = pushOutOfLakeClearance(x, z, CONFIG.lake); x = pushed.x; z = pushed.z; }
   ```
   with:
   ```js
   if(inLake(x,z)){
     // LUL-2735: the plain push only guarantees clear-of-lake, not
     // clear-of-origin/baby (see the wrapper's own comment in lib/game/lake.ts).
     // Re-check both circles this loop already enforced above and, if the
     // push still violates one, search the same clearance ring for an angle
     // that clears it too. If even that also collides with a tree/prop
     // (blockedR), fall back to the pre-push candidate -- it already passed
     // this loop's own blockedR check on exit (or, on the rare 60-try
     // exhaustion path, is no worse than what shipped before this fix).
     const pushed = pushOutOfLakeClearanceAvoiding(x, z, CONFIG.lake, [
       { x: 0, z: 0, r: 50 * clearScale },
       { x: baby.x, z: baby.z, r: 34 * clearScale },
     ]);
     if(blockedR(pushed.x, pushed.z, p.rad+0.5) && !blockedR(x, z, p.rad+0.5)){
       // pushed candidate now collides with a prop the pre-push spot didn't -- keep the pre-push spot (still inside the lake, same as today's unfixed behavior for this one rare corner).
     } else {
       x = pushed.x; z = pushed.z;
     }
   }
   ```
   Note the origin radius is `50 * clearScale` (matching `x*x+z*z < 2500*clearScale*clearScale`
   on `:2035` — `sqrt(2500)===50`), not a re-derivation; keep the two circles' constants
   textually next to the retry loop's own `2500`/`34` so a future edit to one is easy to spot
   as needing the other.

3. No change to the `:2035` retry loop itself or its rng() draw count — this only touches
   what happens after `inLake(x,z)` is already true, and the wrapper itself never calls
   `rng()`, so the LUL-791/LUL-794 P1 identity is untouched by construction, not by care
   taken to skip a branch.

## Verification

- `node --test lib/game/lake.test.ts` — all assertions pass, including the new ones.
- `npx tsc --noEmit` — clean (new export, new call site).
- `npx eslint lib/game/lake.ts lib/game/lake.test.ts engine/forest-engine.js e2e/predator-spawn-clearance.spec.ts` — clean.
- `npx playwright test e2e/predator-spawn-clearance.spec.ts` — passes with the exclusion
  removed (micro world, no `@fullmap`, runs on the QA rig).
- `npx playwright test e2e/map-seed.spec.ts e2e/predator-determinism.spec.ts --grep @fullmap`
  locally with `E2E_FULLMAP=1` — must still pass unchanged (proves the full-map rng() stream
  is untouched; do not add a 14th `FULLMAP_ALLOWLIST` entry, it's already at the LUL-2725
  cap).
- `npx vitest run lib/e2e-policy/world-policy.test.ts` — still passes (no new `@fullmap`
  file).

## e2e

**Specs.** `e2e/predator-spawn-clearance.spec.ts` — extended — `'every predator spawns
outside the scaled clearance radius across 100 map regenerations'`. Delete the `if
(Math.abs(distFromLake - LAKE_PUSH_DIST) < 0.01) continue;` exclusion and its LUL-2735
comment block (currently `:36-45`-ish, re-locate exactly) — with the fix in place every
predator, lake-pushed or not, should clear both circles on all 100 seeds, so the carve-out
is no longer needed. The unused `LAKE`/`LAKE_PUSH_DIST` constants at the top of the file can
go too if nothing else in the file references them after the deletion — check before
removing.
`e2e/map-seed.spec.ts` and `e2e/predator-determinism.spec.ts` — must pass unchanged
(`@fullmap`, `E2E_FULLMAP=1` locally, not on the rig per LUL-2377) — same full-map identity
proof LUL-2725 already relies on.
**World.** micro (default) — the existing spec already boots `qaWorld=micro` and drives
`generateMap()` via `qaRegenerateMap`; no `qaBuildScene` staging needed, this is the same
spec, just with its carve-out removed.
**Hooks.** No new hooks. `qaRegenerateMap(seed: number): void` and `qaProbeMapSeed(): {
seed, baby, trees, predators }` (both already declared, `engine/forest-engine.d.ts`) already
expose everything needed.
**Tester scenario.** None: not player-visible (same severity note as LUL-2725 — `qaWorld=
micro` is QA-rig-only). The extended e2e spec is the regression guard.
**Not covered.** Feel/audio: none, no player-facing behavior changes. Real-device: none,
deterministic engine math. The full-map occurrence (same interaction, "astronomically
rarer") stays unverified by an explicit test — proving it statistically on a 480-unit map
would need many more than 100 regenerations to hit the same lake-adjacent-to-baby geometry
by chance; the micro-world coverage above plus the unit tests on the pure function are the
practical verification for this fix.

## Cues

Not applicable — no player-visible state, no new UI, no new input. Predator spawn placement
is invisible engine mechanics; the severity note above already establishes no real player
session is affected.

## Constraints

- `pushOutOfLakeClearanceAvoiding()` must not call `rng()` — the LUL-791/LUL-794 P1 shared
  rng() stream identity depends on this; it is a pure deterministic function of its inputs,
  same as `pushOutOfLakeClearance()` and `findClearLandmarkSpot()` already are.
- The returned point must stay at exactly `lake.clear + margin` from the lake center on every
  path except the two fallback returns (unmodified plain push, or the pre-push candidate) —
  do not let the angular search drift the radius.
- Do not touch the `:2035` retry loop's own conditions or the `:2009` `clearScale` hoist —
  unrelated to this bug (LUL-2725's own scope).
- `blockedR(x, z, p.rad+0.5)` stays the collision check used for the fallback decision — do
  not introduce a different radius or a new collision primitive for this one call site.

## Out of scope

- Scaling `CONFIG.lake` itself for `qaWorld=micro` (`tuning.js:59`'s own comment says this is
  deliberate) — this fix works within the lake staying full-map-sized, per the ticket's own
  framing.
- The full-map occurrence of this same interaction — geometrically possible, not statistically
  verified here (see "Not covered" above); flagged, not fixed differently, since the fix
  applies unconditionally regardless of map size.
- Any change to `relocateParkedHunter()`'s own lake-push call (`:2096`) — that function has no
  baby-clearance concept in its own retry loop (only player-distance/visibility/blockedR), so
  this bug does not apply there; out of scope by construction, not by omission.
