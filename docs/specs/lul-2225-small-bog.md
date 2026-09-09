# SPEC: LUL-2225 Slow bog ground must be ONE small, clearly bounded patch

**Ticket:** LUL-2225 · **Tier:** C — touches `engine/forest-engine.js` simulation
(map generation, movement cost, blackout child-spawn placement). Needs `REVIEW: APPROVED`
before merge.

**Written against:** `main` @ `98c4874` (2026-09-09). Re-derive every `file:line` below
from the branch you actually implement on if it has moved.

## Files

- `lib/game/bog.ts` — edited: new `BOG_CENTER`/`BOG_INNER_RADIUS`/`BOG_OUTER_RADIUS`; drop
  the now-unreachable lake carve-out; add `bogKeepClear()`, `routeCrossesBog()`; rewrite
  `pickHardBabyPosition()`'s predicate.
- `lib/game/bog.test.ts` — edited: rewritten for the new geometry, plus new coverage
  (area-fraction, keep-clear, no-fallback spawn over 200 seeds).
- `engine/tuning.js` — edited: `BOG_TREES` 360→30; new `BOG_REEDS` (120).
- `engine/forest-engine.js` — edited: keep-clear post-filters on cover/throwables; forest
  tree culling inside the patch's dense core; reeds restricted to the inner..outer ring;
  visible ground discs; minimap disc; `qaProbeBog`/`qaProbeBogKeepClear`/`qaTeleportTo`
  hooks; `qaProbeBaby` return shape changed.
- `engine/forest-engine.d.ts` — edited: hook typings for the above.
- `docs/ELEMENTS.md` — edited: bog section corrected for the new geometry.
- `e2e/bog-zone.spec.ts`, `e2e/mobile/bog-zone.spec.ts` — created.

## The change

### Geometry (`lib/game/bog.ts`)

`BOG_CENTER = { x: -40, z: 80 }`, `BOG_INNER_RADIUS = 25`, `BOG_OUTER_RADIUS = 45` (was
`{x:-70,z:44}`, 35, 135). Verified numerically (not eyeballed):

- Area: `pi * 45^2 / 480^2` = 2.76% of the map (lattice-sampled at 2.75% in the unit test)
  — inside the founder's `[2%, 5%]` band.
- Falloff band: `45 - 25 = 20` units (was 100) — reads as an edge you can see, not a 17s
  boolean-feeling ramp.
- Keep-clear: every `LANDMARKS` entry, `CAVE`, and every `ROOSTS` site sits strictly
  outside `BOG_OUTER_RADIUS + its own clear/radius` (closest is `CAVE` at 58 units against
  a 57-unit floor). No landmark needs to move.
- Blackout reachability: `Math.hypot(BOG_CENTER.x, BOG_CENTER.z) = 89.4 > BOG_INNER_RADIUS`,
  so the origin sits outside the full-bogginess core and a route from home can cross it.

New pure exports:

```ts
export function bogKeepClear(x: number, z: number, pad: number): boolean {
  return Math.hypot(x - BOG_CENTER.x, z - BOG_CENTER.z) < BOG_OUTER_RADIUS + pad;
}

export function routeCrossesBog(ax: number, az: number, bx: number, bz: number): boolean {
  // min distance from BOG_CENTER to segment (ax,az)-(bx,bz) <= BOG_INNER_RADIUS
}
```

The `LAKE_CENTER`/`LAKE_CLEAR_RADIUS`/`LAKE_FADE_RADIUS` carve-out is removed: at the new
geometry `CONFIG.lake` (`{x:34,z:-28}`) is 131 units from `BOG_CENTER`, already outside
`BOG_OUTER_RADIUS`, so the carve-out was dead code. `biomeAt(34,-28) === 0` still holds and
is still asserted, now as a consequence of distance alone.

### Blackout spawn predicate (`lib/game/bog.ts` `pickHardBabyPosition()`)

Old predicate: `hypot(x,z) >= BLACKOUT_MIN_RADIUS && biomeAt(x,z) > 0 && clearOfLandmarks(...)`
— "child stands in the bog." Unsatisfiable for this geometry: the farthest any bog point can
be from home is `hypot(BOG_CENTER) + BOG_OUTER_RADIUS = 134.4 < BLACKOUT_MIN_RADIUS (192)`,
so every call fell through to the `maxTries` fallback (a random, possibly-dry point) — this
is the exact silent-degradation failure LUL-1902's own spec had warned about.

New predicate: `hypot(x,z) >= BLACKOUT_MIN_RADIUS && routeCrossesBog(0,0,x,z) &&
clearOfLandmarks(...)` — "the direct route home crosses the bog's full-bogginess core."
Verified by Monte Carlo (mulberry32 seeds 1..1000, `half=240`, `margin=20`, `maxTries=200`,
matching LUL-1902's own verification method): **1000/1000** succeed at the new geometry;
the old predicate scores **0/1000**. `lib/game/bog.test.ts` asserts this over the first 200
seeds directly (not a one-off script).

### Keep-clear enforcement (`engine/forest-engine.js`)

- `generateCover()`: after the existing prop-scatter loop (unchanged rng draw count/order),
  filter out any non-`'tree'` `coverData` entry with `bogKeepClear(c.x, c.z, 0)`. Tree-kind
  entries are left alone (already sparse from the culling below).
- `generateThrowables()`: same post-filter on `throwableData` after its loop.
- Forest trees (`generateMap()`'s `CONFIG.trees` loop): a tree with `biomeAt(x,z) > 0.5`
  (the patch's dense-core threshold) is marked `culled` — keep 1 in 4 via a deterministic
  counter (no extra `rng()` draw), cull the rest. `treeData.length` and every `rng()` draw
  are unchanged, so `QA_PINNED_SEED` layouts stay byte-identical; `layoutTreeChunks()`
  parks culled trees at `y=-999`/`scale 0.0001` (same pattern `layoutTreePool()` already
  uses for empty slots) while still drawing the same two `rng()` calls per tree in the same
  order. `addAllToGrid()` and `generateCover()`'s `t.s > 1.4` tagging both skip
  `t.culled` entries, so a culled tree neither blocks movement nor offers hide-cover.
- `generateBogTrees()`: count only, `BOG_TREES` 360→30 (`engine/tuning.js`); still scatters
  across the whole disc (`biomeAt(x,z) > 0`), unchanged placement rule.
- `generateReeds()`: own budget `BOG_REEDS` (120, was reusing `COVER_PROPS`); placement
  restricted to `BOG_INNER_RADIUS <= dist <= BOG_OUTER_RADIUS` (was `biomeAt(x,z) > 0`,
  i.e. anywhere in the disc) — reeds are now the boundary a player reads, not interior
  clutter.

All three post-filters are stream-safe: `layoutCoverMeshes()`/`layoutThrowableMeshes()`
consume no `rng()` and already park unused instance slots off-map, so shrinking the arrays
after generation cannot perturb any other seeded draw.

### Visible boundary

- Two concentric `THREE.CircleGeometry` ground discs at `BOG_OUTER_RADIUS`/
  `BOG_INNER_RADIUS`, positioned just above the base `ground` plane (`y=0.015`/`0.02`),
  darker/wetter `MeshStandardMaterial` — same "flat mesh just above ground" pattern the
  lake's own `water` mesh already uses.
- `drawMinimapStatic()`: one additional disc at `w2m(BOG_CENTER)`, radius
  `BOG_OUTER_RADIUS * mmS`, same pattern as the lake disc immediately above it. Blackout's
  `minimap: false` preset still hides the whole minimap, so this doesn't help blackout read
  the patch — that is blackout's point, not a gap in this change.

### QA hooks

- `qaProbeBog(x, z) -> { bogginess, speedMul, noiseMul }` — samples `biomeAt` and its two
  derived multipliers at an arbitrary point.
- `qaProbeBogKeepClear() -> { coverInside, reedsInsideCore, throwablesInside,
  treesInsideCore, landmarksInside }` — computed from the live `coverData`/`throwableData`/
  `treeData`/`landmarkData` against `bogKeepClear()`. `treesInsideCore` counts only
  non-culled trees strictly within `BOG_INNER_RADIUS` (sparse forest is the target, not
  zero); every other field is expected to read 0.
- `qaTeleportTo(x, z)` — generic teleport (existing hooks are all fixed-target).
- `qaProbeBaby()` changed shape: `{ x, z, distHome, routeCrossesBog }`, replacing the old
  `inBog` field (meaningless once no bog point is ever `>= BLACKOUT_MIN_RADIUS` from home).

## Verification

- `npx tsx --test lib/game/bog.test.ts` — 25 tests pass, including the area-fraction,
  keep-clear, and 200-seed no-fallback spawn assertions.
- `npm test` — full unit suite green (1035 tests as of this spec).
- `npx next typegen && npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- `npx next build` — clean.
- `npx playwright test e2e/bog-zone.spec.ts e2e/mobile/bog-zone.spec.ts` — green (desktop +
  mobile viewport).

## e2e

**Specs.**
- `e2e/bog-zone.spec.ts` (new, desktop, `QA_PINNED_SEED`, `?qaHooks=1`):
  - `'bogginess samples match the patch geometry'` — `qaProbeBog` at center (`=== 1`),
    `BOG_INNER_RADIUS - 1` along +x (`=== 1`), midway between inner/outer
    (`> 0 && < 1`), `BOG_OUTER_RADIUS + 1` (`=== 0`), home (`=== 0`), the lake (`=== 0`),
    every `LANDMARKS`/`CAVE` position (`=== 0`).
  - `'nothing else spawns inside the patch'` — `qaProbeBogKeepClear()`: `coverInside === 0`,
    `throwablesInside === 0`, `landmarksInside === 0`, `reedsInsideCore === 0`,
    `treesInsideCore <= 12` (`CONFIG.trees * pi*BOG_INNER_RADIUS^2/mapSize^2 ≈ 44.3`, so
    `<= 25%` of that is `<= 11.1`, rounded up).
  - `'walking through the bog is measurably slower'` — `qaSetFixedStep(1/60)`,
    `qaTeleportTo(BOG_CENTER.x, BOG_CENTER.z)`, hold `KeyW` for 120 `qaAdvance` steps, read
    `qaProbePlayer` displacement; repeat from `(0,-60)` (dry); assert bog displacement is
    within 10% of `0.5x` the dry displacement (`BOG_SPEED_MULTIPLIER`).
  - `'blackout spawns the child beyond the bog on four pinned seeds'` — neither
    `regenMap()` nor `restart()` accepts a seed (both draw `Math.random()`), so
    reproducing an exact layout after `qaSetDifficulty('hard')` needed a new
    `qaRegenerateMap(seed)` hook (calls the real `generateMap(seed)`, same function
    every map-gen path calls). Flow: `qaSetDifficulty('hard')`,
    `qaRegenerateMap(seed)`, `qaProbeBaby()` → `distHome >= 192 && routeCrossesBog
    === true`, repeated for `QA_PINNED_SEED`, `1`, `2`, `3`; then
    `qaSetDifficulty('normal')`, `qaRegenerateMap(seed)` → `distHome` in `[120, 192]`.
  - `'the bog patch is drawn on the minimap'` — `qaProbeMinimapPoint(BOG_CENTER.x,
    BOG_CENTER.z)` stays on-canvas; visually the static minimap layer includes the disc
    (asserted via `qaProbeBogKeepClear`'s companion data, not pixel-reading the canvas).
  - `'the win path is unaffected'` — existing pickup → carry → arrive-home flow
    (`e2e/smoke.spec.ts`, `e2e/win-persist.spec.ts`) must pass unchanged; not re-asserted
    here, listed as a regression check this PR must not break.
- `e2e/mobile/bog-zone.spec.ts` (new, viewport `727x393`, same assertions as the desktop
  bogginess/keep-clear/blackout-spawn specs above, touch joystick via `touch-cdp.ts` for the
  slow-walk check, same shape as `e2e/mobile/veil.spec.ts:10-16`).

**Hooks.**
- `window.ForestEngine.qaProbeBog(x, z): { bogginess: number; speedMul: number; noiseMul: number }`
  — samples `biomeAt`/`bogSpeedMultiplier`/`bogNoiseMultiplier` at an arbitrary point — new,
  declared in `engine/forest-engine.d.ts`, installed in the `?qaHooks` block.
- `window.ForestEngine.qaProbeBogKeepClear(): { coverInside: number; reedsInsideCore: number; throwablesInside: number; treesInsideCore: number; landmarksInside: number }`
  — new, same location.
- `window.ForestEngine.qaTeleportTo(x, z): void` — new, same location.
- `window.ForestEngine.qaRegenerateMap(seed: number): void` — new, same location. Not in
  the ticket's original hook list; added because neither `regenMap()` nor `restart()`
  accepts a seed, which the pinned-seed blackout-spawn spec needs.
- `window.ForestEngine.qaProbeBaby(): { x: number; z: number; distHome: number; routeCrossesBog: boolean }`
  — existing hook, return shape changed (was `{ x, z, inBog }`).
- `qaSetFixedStep`/`qaAdvance`/`qaProbePlayer`/`qaSetDifficulty`/`qaTeleportHome` — existing,
  reused unchanged for the slow-walk and blackout-spawn specs.

**Tester scenario.** `shared/local-qa/requests/lul-2225-bog-zone.md` — walk from home toward
`BOG_CENTER` (bearing north-west of spawn), confirm ground color/reed line reads before
speed drops, confirm few trees/no props/no landmark inside, confirm full speed 60 units past
the far edge, confirm blackout's beacon sits on the far side of the patch across three
rounds. All player-visible/feel items; not automatable, ticket says so explicitly.

**Not covered.** Ripple/water-shader pass on the ground discs (visual polish, explicit
follow-up, not a blocker). Real-device touch feel for the mobile slow-walk check stays
manual (`touch-cdp.ts` synthesizes the pointer events; the resulting movement is asserted
via `qaProbePlayer`, not device feel).

## Constraints

- `bogSpeedMultiplier`/`bogNoiseMultiplier`, `BOG_SPEED_MULTIPLIER` (0.5), `BOG_NOISE_MULTIPLIER`
  (1.6), and their single application sites (`forest-engine.js` player movement block,
  predator terrain multiplier) are unchanged — the LUL-1861 double-application guard in
  `bog.test.ts` stays.
- Wolf-only scent mask (`bogMaskLevel`, `WOLF_BOG_MASK_STRENGTH`, `checkScent()`) is
  unchanged.
- `BLACKOUT_MIN_RADIUS` (192) and the normal-mode child spawn are unchanged.
- Every `rng()` draw before `generateBogTrees()` in `generateMap()` (trees, predators,
  cover, throwables, wind) keeps its exact count and order — `QA_PINNED_SEED` layouts stay
  byte-identical. Tree culling and the cover/throwable post-filters are additive
  filters/markers applied after generation, never a rejection inside a stream-consuming
  loop.
- Lake and home stay dry; picking up the child is not the win (carry home is); landmark
  positions are unchanged (the bog moved, not them).
- Tier C: `REVIEW: APPROVED` required before merge (engine simulation change).

## Out of scope

- A ripple/water shader for the ground discs — flat colored `MeshStandardMaterial` discs
  are the acceptance bar here; a shader pass is a legitimate follow-up ticket, not a
  blocker.
- Re-tuning `WOLF_BOG_MASK_STRENGTH`/`BOG_SPEED_MULTIPLIER`/`BOG_NOISE_MULTIPLIER` feel now
  that the patch is smaller and more concentrated — the founder's ask was geometry and
  isolation, not the cost model; a follow-up ticket if playtesting flags it.
- Moving `CONFIG.lake`, `CONFIG.home`, or any `LANDMARKS`/`ROOSTS` entry — the whole point
  of this geometry choice is that nothing else has to move.
