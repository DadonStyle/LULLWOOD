# SPEC — LUL-1484: E3, grow the map to 480×480

Tier: **C** (`engine/forest-engine.js`, `engine/tuning.js` — simulation/generation).
Blocking review required (`REVIEW: APPROVED` before merge).

Plan source: wiki `specs/bigger-wrapping-world-e2-e6` §E3. Research source (do not
re-derive): `~/.paperclip/shared/specs/mobile-ui-and-world.md` §5. D1 (final world size)
is decided and final: **480×480**. This spec confirms current line numbers against
`release/next` HEAD (`41e707a`) — the ticket's own citations had drifted after `CONFIG`
moved to `engine/tuning.js` (PR #274) and E2 (PR #389, `ab4c7772`) rewrote the tail of
`generateMap()`.

## Files

- `engine/tuning.js` — edit two constants
- `engine/forest-engine.js` — add one new `qaProbe*` hook, no other code change

## The change

### 1. `engine/tuning.js:18-19` — raise map size and tree count

Current:
```js
  mapSize: 240,          // the forest is a fixed square this many units across
  trees:   1300,
```
Change to:
```js
  mapSize: 480,          // the forest is a fixed square this many units across
  trees:   5200,
```
480 is D1, final — do not use any other value. 5200 = 1300 × 4, matching the area
scale-up (480² / 240² = 4) and the exact figure the research doc (§5.0) used as its own
worked example for a 4× map. Do not touch anything else in this object.

### 2. `engine/tuning.js:80-81` — raise the other two fixed-capacity pools by the same area factor

Current:
```js
export const BOG_TREES = 90;
export const COVER_PROPS = 220;
```
Change to:
```js
export const BOG_TREES = 360;
export const COVER_PROPS = 880;
```
Same ×4 area scale-up as `CONFIG.trees`, for the same reason: `generateBogTrees()` and
`generateReeds()` in `forest-engine.js` each place exactly this many props by looping
`while(placed < BOG_TREES/COVER_PROPS ...)` — a fixed *count*, not a density. Bog/cover
biome area grows with the map the same way the forest does (`biomeAt()` is unbounded
lattice noise, not normalized to `mapSize` — confirmed by reading `lib/game/bog.ts`, not
touched by this ticket), so leaving these two constants at their old values would quietly
quarter cover-prop and bog-tree density everywhere without anyone deciding that. This is
a judgment call filled in by this spec, not stated verbatim in the ticket text — flag it
in the PR body as such, since it's a real density decision, not a mechanical rename.

**Do not change `BOG_NOISE_CELL`, `BOG_THRESHOLD`, `HOME_CLEAR_RADIUS`,
`HOME_FADE_RADIUS`, or anything else in `lib/game/bog.ts`.** Those are absolute
world-unit constants (E5/E2 territory) and are unaffected by map size — confirmed:
`biomeAt()` hashes an unbounded integer lattice, so it already tiles correctly over a
bigger square with no change.

### 3. `engine/forest-engine.js` — the three `InstancedMesh` capacity sites are correct as-is, no line changes needed

They read `CONFIG.trees`, `BOG_TREES`, `COVER_PROPS` directly and need no edits once step
1–2 land:
- `:422-424` — main forest trunk/foliage×2 pool, sized `CONFIG.trees`
- `:434-436` — bog tree pool, sized `BOG_TREES`
- `:460-463` — cover props pool (log/rock/bramble/reed), sized `COVER_PROPS`

Confirm after editing `tuning.js` that these five constructor calls did not move (a
`grep -n "new THREE.InstancedMesh" engine/forest-engine.js` before/after should show the
same five line numbers) — if they moved, something else in this diff touched
`generateMap()`/mesh setup, which is out of scope.

### 4. `engine/forest-engine.js` — do NOT touch the ground plane

`:298` — `new THREE.Mesh(new THREE.PlaneGeometry(800, 800), ...)`. This is the hard
ceiling the whole ticket exists to stay inside of. 480 < 800 with real margin. Do not
resize, reposition, or otherwise touch this line or anything that positions the ground
mesh.

### 5. `engine/forest-engine.js` — add `qaProbePerf()`, next to the other `qaProbe*` hooks

No `__perf` capture mechanism exists anywhere in this codebase today (confirmed by
search) — the wiki/research references to "capture `__perf`" describe a number to report
in the PR body, not an existing named hook. Rather than eyeballing devtools manually
(unrepeatable, and E6 needs this exact baseline later), add one small hook following the
existing pattern (see `qaProbeElapsedTime` at `:2396`, `qaProbeMapSeed` at `:2402-2410`).
Add immediately after `qaProbeElapsedTime`:

```js
  window.ForestEngine.qaProbePerf = function(){
    return {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      elapsedTime: clock.elapsedTime,
    };
  };
```
`renderer` is the top-level `const renderer = new THREE.WebGLRenderer(...)` at `:261`,
already in scope everywhere in this file — no import needed. This hook is read-only and
has no effect on simulation; it does not change any behavior this ticket must preserve.

## Determinism (must state in PR body, not optional)

Raising `CONFIG.trees` changes the RNG draw count in `generateMap()`'s tree-placement
loop, which reshuffles every draw after it (predators, cover props, bog trees, reeds —
`generateMap()`'s own comment at `:1029-1053`, unchanged by this ticket, documents this
chain). This is expected and unavoidable, same treatment E2 already used:
- State explicitly in the PR body that the QA-pinned layout changes.
- Re-pin `QA_PINNED_SEED` in `e2e/helpers.ts:35` is NOT required — that constant pins the
  *seed value* (`20260718`), not the layout it produces. The layout `e2e/map-seed.spec.ts`
  asserts is captured fresh from whatever `generateMap()` currently produces at that seed
  (`dumpMapSeed()` reads live arrays back, it has no hardcoded expected positions), so no
  test file needs editing for this reshuffle. Confirm this by running the suite (below) —
  if `map-seed.spec.ts` fails, report that as a spec-drift finding rather than editing the
  test to force it green.

## Constraints — must not change

- Ground plane geometry/position (`:298`) — untouched, still `PlaneGeometry(800, 800)` at
  the origin.
- `wrapCoord`/wrap logic — does not exist yet (E4, later ticket). Do not add it here.
- `biomeAt()`, `bogSpeedMultiplier`, `bogNoiseMultiplier`, predator terrain multiplier
  (all E2, `lib/game/bog.ts` + `:1441-1455`) — untouched.
- Minimap scaling (`mmS`, `w2m()` at `:3158-3168`) — already derives from
  `CONFIG.mapSize`, needs no edit. Verify visually (see below) rather than editing.
- No new npm dependency, no new file.

## Out of scope

- Wrapping/torus math (E4).
- Fog Tide per-predator sampling (E5, D2 already decided separately).
- Chunked `InstancedMesh` / `frustumCulled` (E6) — this ticket's `__perf` numbers are
  E6's baseline, nothing more.
- Tree/cover *density tuning* beyond the ×4 area scale-up in step 2 above. If the map
  reads "bigger but emptier" in play, that is a follow-up ticket, not a rework of this
  spec's numbers.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm test` — all unit tests green (this touches no `lib/game/*.ts` logic, so no test
   file should need changes; if any unit test hardcodes `240`/`1300`/`90`/`220`, that is a
   spec-drift finding, report it rather than editing around it).
3. `npx playwright test` — green, in particular `e2e/map-seed.spec.ts`. Treat a failure
   here as signal to investigate (per the map-seed.spec.ts logic above it should not need
   edits), not as something to force green.
4. `node scripts/check-elements-citations.mjs` — clean (this diff doesn't touch anything
   `docs/ELEMENTS.md` cites, but line numbers shift in `tuning.js`; run `--fix` first if
   it flags anything with an exact-length match, hand-fix single-line citations if not).
5. `node scripts/check-duplicate-logic.mjs` — clean; this diff adds no new top-level
   engine declaration that could collide with a `lib/game/*` export.
6. Boot the game with `?seed=20260718&qaHooks=1` (or via `boot()` in
   `e2e/helpers.ts` if driving it through Playwright) and:
   - Run `window.ForestEngine.qaProbePerf()` once ~10s after load, before and after this
     change, at the same seed. Record both objects in the PR body as the before/after
     numbers E6 needs. No regression is expected — the research doc's own reasoning
     (three draw calls regardless of instance count, no per-frame loop over `treeData`/
     `coverData`) predicts none — but the numbers must exist regardless of that
     prediction.
   - Walk to each of the four map edges (`x`/`z` → ±240, half of 480) and confirm the
     player stays over the ground plane, not void. `qaProbePlayer()` (`:2416`) gives exact
     position; the ground plane's edge is at ±400 (`PlaneGeometry(800,800)` centred on
     origin), so ±240 has 160 units of margin on every side.
   - Visual/gameplay verdict on tree density ("bigger" vs "emptier") is explicitly
     **unverified by this spec** — no browser in the Founding Engineer's environment, and
     Game Tester is currently paused. State this explicitly in the handoff rather than
     asserting it.

## PR body must state

- `Tier: C — engine/tuning.js, engine/forest-engine.js`
- The intentional QA-layout reshuffle (determinism section above)
- The `BOG_TREES`/`COVER_PROPS` ×4 scale-up as a spec-filled-in density decision, not a
  literal ticket instruction
- Before/after `qaProbePerf()` numbers at `?seed=20260718`
- "Builds clean; gameplay/density verdict unverified — no browser in this environment,
  Game Tester currently paused."
