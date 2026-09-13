# SPEC: LUL-2328 engine boot-path QA hooks -- qaWorld=micro, qaNoRender, qaBuildScene, qaProbeMemory

**Ticket:** LUL-2328 · **Tier:** C -- touches `engine/forest-engine.js`'s map-generation boot
path (`generateMap()` and the values `init()` derives from `CONFIG` before `generateMap()`
ever runs). Every new hook/preset is opt-in (a `?qaWorld=`/`?qaNoRender=` URL param or a
`window.ForestEngine.qaXxx` call, none reachable without deliberately requesting it) and
none is part of `EngineActions`/`init()`'s return object, so there is no engine/React
contract implication (LUL-2239) -- but this is still boot-path code every real page load
executes the unchanged branch of, so `REVIEW: APPROVED` from the Code Reviewer is required
before merge. Child 1/2 of epic LUL-2324 (founder brief: full-map e2e boots under software
GL measured 3.5-9 GB and OOM-killed the nightly QA host 20+ times). Child 2/2 migrates the
hook-staged e2e suite onto these hooks; blocked on this landing.

**Written against:** `release/next` @ `3572e53` (2026-09-11). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

## Files

- `engine/tuning.js` -- edited. `COVER_PROPS`/`BOG_TREES`/`BOG_REEDS` move onto `CONFIG`
  (`CONFIG.coverProps`/`CONFIG.bogTrees`/`CONFIG.bogReeds`); new
  `applyQaWorldMicroPreset()` export.
- `engine/forest-engine.js` -- edited. Import the new preset function; read
  `qaWorld`/`qaNoRender` once at the top of `init()`; gate the three mesh-construction
  calls inside `generateMap()`; two new hooks inside the `?qaHooks=1` block
  (`qaBuildScene`, `qaProbeMemory`); every `COVER_PROPS`/`BOG_TREES`/`BOG_REEDS` read-site
  updated to `CONFIG.coverProps`/`CONFIG.bogTrees`/`CONFIG.bogReeds`.
- `engine/forest-engine.d.ts` -- edited. `qaBuildScene`/`qaProbeMemory` declared on
  `Window.ForestEngine`, same JSDoc-per-hook pattern as every existing entry.
- `e2e/qa-world-micro.spec.ts` -- created. The three specs in the `## e2e` section below.

## The change

### 1. `CONFIG.coverProps`/`CONFIG.bogTrees`/`CONFIG.bogReeds` replace standalone exports

`engine/tuning.js` currently exports `COVER_PROPS`/`BOG_TREES`/`BOG_REEDS` as standalone
`const` numbers (`:159-173` on the cited sha), imported by name into
`engine/forest-engine.js` (`:182`) and read at 9 call sites (mesh-capacity construction at
`:474-476` and `:505-508`, generator loops at `:672`, `:730`, `:907`, `:960`, `:1114`).
A `qaWorld=micro` preset needs to shrink these three numbers for one page load without a
second `if(qaWorld) X_MICRO else X` branch at every one of those 9 sites -- the same "no
second code path per constant" requirement the ticket states for `CONFIG.mapSize`/
`CONFIG.trees`, which already satisfy it today purely because they're object properties on
the shared `CONFIG` singleton, read fresh at each call site rather than imported as
snapshotted bindings.

**Rejected approach:** convert the three standalone consts to `let` and mutate them
directly, relying on ES module live-binding semantics (a `let` export's importer sees a
later reassignment from the exporting module without re-importing). This works per spec but
introduces a webpack/Next.js bundling assumption this codebase doesn't currently rely on
anywhere else, for a change that has a strictly safer alternative already proven in this
exact file.

**Chosen approach:** move the three values onto `CONFIG` itself
(`CONFIG.coverProps`/`CONFIG.bogTrees`/`CONFIG.bogReeds`, `engine/tuning.js`'s `CONFIG`
object literal, next to `trees`/`mapSize`), and change every read site in
`forest-engine.js` from the bare identifier to the `CONFIG.` property (mechanical rename,
same values, same behaviour for every existing seed -- this alone is a no-op diff for real
players). This reuses the exact mutation mechanism `CONFIG.mapSize`/`CONFIG.trees` already
use at `forest-engine.js:225` (`const half = CONFIG.mapSize / 2`) and `:1066`
(`while(treeData.length < CONFIG.trees ...)`) -- a plain property read at time of use, no
import-binding question at all.

### 2. `applyQaWorldMicroPreset()` (`engine/tuning.js`)

```js
export function applyQaWorldMicroPreset(){
  CONFIG.mapSize = 96;
  CONFIG.trees = 40;
  CONFIG.coverProps = 40;
  CONFIG.bogTrees = 0;
  CONFIG.bogReeds = 0;
}
```

Idempotent (always assigns the same targets, never scales off the current value) --- safe
to call more than once in one page life. Every existing reader of these five properties
(`half`/`margin`/`WRAP_SPAN`/`TREE_CHUNKS_PER_AXIS` at `forest-engine.js:225-241,811-812`,
the tree/cover/bog-tree/reed generator loops, `layoutTreeChunks`/`layoutCoverMeshes`'s own
padding loops, minimap scaling `mmS = MM/CONFIG.mapSize`) adapts automatically -- zero
additional branches anywhere else in the file.

**Bog/landmarks/lake, decided:** `CONFIG.bogTrees`/`CONFIG.bogReeds` are zeroed rather than
left to shrink proportionally. `BOG_CENTER` (`lib/game/bog.ts:43`, `{x:-40,z:80}`) is a
fixed absolute position, not derived from `CONFIG.mapSize` -- at `mapSize:96` (`half:48`),
`BOG_OUTER_RADIUS` (45) would partially overlap the map's own edge (closest in-bounds point
to `BOG_CENTER` is ~32 units away, inside the 45-unit outer radius), so leaving
`bogTrees`/`bogReeds` at their full-map values would either let a sliver of bog spawn at
the corner of a "micro" map (surprising, untested interaction) or spend each generator
loop's entire try budget (`BOG_TREES*200`/`BOG_REEDS*200`) rejecting candidates outside
that sliver. Zeroing both sidesteps the geometry question entirely: no bog content in the
micro world. `LANDMARKS`/`CAVE`/`CONFIG.lake` are left untouched -- `LANDMARKS` is already
placed unconditionally regardless of map size (`engine/tuning.js`'s own LANDMARKS comment),
so at 96-wide it simply sits near/past the map edge; `CAVE` is a coin-flip roll, same
treatment; `CONFIG.lake` (`{x:34,z:-28,r:15}`) is well inside a 96-wide map and costs three
small non-instanced meshes regardless of map size. None of the three needed a special case.

**Declared limitation, not fixed here:** `pickHardBabyPosition()`'s (`lib/game/bog.ts:182`)
`BLACKOUT_MIN_RADIUS` predicate (192 units) is unsatisfiable at `mapSize:96`
(`half-margin` = 28, so no reachable point is even close to 192 units from origin) -- it
already has a documented `maxTries` fallback (returns its last, unsatisfying candidate)
for exactly this shape of failure. `qaSetDifficulty('hard')` combined with `qaWorld=micro`
will silently hit that fallback every time. Out of scope here (see Out of scope); child 2
must not combine the two until a follow-up addresses it.

**Where it's called:** `forest-engine.js`'s `init()`, immediately after the existing
`cleanupFns`/`on`/`later` helper declarations and before `const half = CONFIG.mapSize / 2`
(the earliest existing read of any of the five overridden properties) --

```js
const qaParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
if(qaParams && qaParams.get('qaWorld') === 'micro') applyQaWorldMicroPreset();
const qaNoRender = !!(qaParams && qaParams.has('qaNoRender'));
```

Both flags are read unconditionally (not gated on `?qaHooks=1` -- they change what
`generateMap()` builds, not what's exposed on `window.ForestEngine`), matching
`resolveInitialSeed()`'s own `?seed=` precedent one function up.

### 3. `qaNoRender` skips exactly three mesh-construction calls in `generateMap()`

`generateMap()` (`forest-engine.js:1037`, line numbers below are its body on the cited sha
**before** this diff's `if(!qaNoRender)` wrapping) calls, among others:

- `layoutTreeChunks(treeData)` (`:1078`) -- builds one `InstancedMesh` trio per populated
  60-unit tree chunk (`:824`).
- `layoutCoverMeshes()` (`:1082` and again at `:1116`, after reeds are added) -- fills the
  4 fixed-capacity `coverMeshes` (`log`/`rock`/`bramble`/`reed`, capacity
  `CONFIG.coverProps` each) `InstancedMesh`es.
- `layoutThrowableMeshes()` (`:1115`) -- fills the fixed-capacity (`THROWABLE_COUNT=90`,
  unaffected by `qaWorld`) `throwableMesh`.

Each becomes `if(!qaNoRender) layoutXxx(...)`. Everything else in `generateMap()` --
`treeData`/`coverData`/`bogTreeData`/`throwableData` population, `buildGrid()`/
`buildCoverGrid()`, `placePredators()`, `placeLandmarks()`/`placeCave()`, `pickMission()`,
`drawMinimapStatic()` -- runs unchanged, so collision (`blockedR`/`blocked`/
`predatorBlocked`), LOS (`hasLOS`/`canSee`), scent, and the HUD/minimap all work exactly as
without `qaNoRender`; only the GPU/CPU-buffer-owning mesh objects are never populated.

**Confirmed safe by inspection (per the ticket's ask to grep every reader of the
`InstancedMesh` refs these three functions write):** `grep -n "raycast\|Raycaster"
engine/forest-engine.js` finds no `THREE.Raycaster` usage anywhere in the file -- every
collision/LOS/interaction check is pure math against the `treeData`/`coverData`/
`throwableData` arrays and the `grid`/`coverGrid` spatial hashes those arrays feed, never a
mesh read-back. `treeChunkTrios`/`coverMeshes`/`throwableMesh` are written-only outside the
render loop; the one other reader, `qaProbeTreeChunks()` (`:3195` pre-diff), is itself a
QA probe -- under `qaNoRender` it correctly reports `chunks: 0, totalInstances: 0` against
a nonzero `expected: treeData.length`, which is the "no mesh count" signal the e2e spec
below asserts.

**Not gated:** `layoutThrowableMeshes()`'s other call site (`:4426` pre-diff, inside the
real pickup-a-thrown-stone interaction path) is a per-interaction incremental re-layout of
an already-existing, always-constructed `throwableMesh` (created once at init()-body top
level regardless of `qaNoRender`, `:517` pre-diff) -- not part of map-generation cost, and
gating it would break a `qaNoRender` test that wants to exercise a real pickup. Left as-is.
`layoutTreePool(bogParts, ...)` for bog trees (`:1114` pre-diff) is also left ungated --
out of the ticket's explicit three-function list, and its footprint is `CONFIG.bogTrees`
(already 0 by default under `qaWorld=micro`, 30 at full map size) -- negligible either way.

### 4. `qaBuildScene(scene)` hook (new, inside the `?qaHooks=1` block)

Signature and behaviour: see `engine/forest-engine.d.ts`'s new `qaBuildScene` entry (full
JSDoc there) and `engine/forest-engine.js`'s implementation (installed directly before the
block's closing brace, after `qaResetScentCaption`). Summary:

- `trees`/`props` replace `treeData`/`coverData` outright (previous content dropped, not
  merged) and re-run exactly the two layout calls needed for what was placed
  (`layoutTreeChunks(treeData)`, `buildCoverGrid()` + `layoutCoverMeshes()` -- both skipped
  under `qaNoRender`, same as `generateMap()`) plus `buildGrid()`, so `blockedR`/`blocked`/
  `hasLOS`/`findHideSpot` all see the built scene immediately, real collision/LOS, not fake
  state.
- Cover prop shape per `kind` is a fixed constant (`QA_COVER_SHAPE` in the implementation),
  the midpoint of `rollCoverPropShape()`'s (`lib/game/cover.ts:704`) own random range for
  that kind -- deterministic on purpose (this hook must never advance the seeded `rng()`
  stream, so a caller can call it after any `generateMap()`, any number of times, without
  perturbing anything else that still depends on that stream, e.g. a later
  `qaRegenerateMap()` call).
- `predators` matches the fixed 9-entry `predators` pool (3 per species, built once at
  module scope, `forest-engine.js:1706` pre-diff) by `kind` in array order -- the Nth entry
  of a kind claims that species' `speciesIdx = N-1` slot (a 4th of the same kind is
  silently dropped, matching this pool's real fixed capacity). Every unclaimed predator is
  parked exactly like `placePredators()`'s own inert branch (`x=z=-9999`,
  `g.visible=false`).
- `bogTreeData` is always cleared and its meshes (`bogParts`, capacity `CONFIG.bogTrees`)
  re-laid-out empty -- `qaBuildScene` doesn't support placing bog trees (out of scope, see
  below).
- `child`/`home` are optional; when given, mutate `baby.x/z`
  (+`babyGroup`/`placeBabyWisps()`, same as the existing `qaTeleportNearBaby` hook) and
  `CONFIG.home.x/z` respectively. Omitted fields leave that state untouched.
- **Deliberately not touched:** `landmarkData`, `throwableData`, `mission`, and the
  player's own position -- see Out of scope.
- Returns `{ trees, props, predators }` -- the counts actually placed (predators counts
  matched-and-placed entries, not the input array length, since a >3-of-one-kind entry is
  dropped).

### 5. `qaProbeMemory()` hook (new, inside the `?qaHooks=1` block)

```js
window.ForestEngine.qaProbeMemory = function(){
  const perfMem = (typeof performance !== 'undefined' && performance.memory) ? {
    usedJSHeapSize: performance.memory.usedJSHeapSize,
    totalJSHeapSize: performance.memory.totalJSHeapSize,
    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
  } : null;
  return {
    heap: perfMem,
    renderer: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
  };
};
```

`performance.memory` is Chrome-only (non-standard `MemoryInfo`); `heap` is `null` on any
engine that doesn't implement it -- callers (child 2's budget assertions) must handle that,
not assume a number. `renderer.info.memory.{geometries,textures}` (standard Three.js
`WebGLRenderer.info`) is always available and gives an engine-independent, if coarser,
signal (object counts, not bytes) as a fallback/cross-check. Playwright's launch config
(`playwright.config.ts`, `--use-gl=angle --use-angle=gl-egl`) runs Chromium, so `heap` is
non-null in the actual nightly QA/CI environment this hook is built for.

## Verification

- `node --check engine/forest-engine.js && node --check engine/tuning.js` -- both parse.
- `npx tsc --noEmit` -- `engine/forest-engine.d.ts`'s new declarations typecheck against
  the new `e2e/qa-world-micro.spec.ts` call sites.
- `npm run lint` -- clean.
- `npx playwright test e2e/qa-world-micro.spec.ts` -- the three new specs pass (see `## e2e`
  below); confirms the `CONFIG.coverProps`/`CONFIG.bogTrees`/`CONFIG.bogReeds` rename and
  the live `applyQaWorldMicroPreset()` mutation actually take effect at runtime under the
  real Next.js/webpack bundle, not just by inspection.
- Regression: `npx playwright test e2e/smoke.spec.ts` -- unaffected (no `?qaWorld=`/
  `?qaNoRender=` param, `applyQaWorldMicroPreset()` never called, every touched constant
  reads its original default value through its original call site).

## e2e

**Specs.** `e2e/qa-world-micro.spec.ts` (new):
- `'qaWorld=micro boots a small, cheap world'` -- loads `?qaHooks=1&qaWorld=micro`, calls
  `qaProbeMapSeed()` and asserts `trees.length` is in the tens (`<= 60`, a margin above the
  40-tree target to avoid a flaky exact-count assertion against `tries`-budget variance),
  then calls `qaProbeMemory()` and asserts `renderer.geometries`/`renderer.textures` are
  nonzero-but-small and (when `heap` is non-null, i.e. Chromium) `heap.usedJSHeapSize` is
  under the LUL-2324 micro budget (400MB).
- `'qaNoRender=1 skips mesh construction, keeps the HUD alive'` -- loads
  `?qaHooks=1&qaNoRender=1`, asserts `#hud`/`#minimap` (or the equivalent live HUD element)
  is visible and `qaProbePlayer()` returns a real position (proves the render loop and HUD
  are alive), then asserts `qaProbeTreeChunks().totalInstances === 0` while
  `qaProbeMapSeed().trees.length > 0` (proves generation ran but layout didn't).
- `'qaBuildScene places exactly one bramble, one predator, and the player'` -- loads
  `?qaHooks=1`, calls
  `qaBuildScene({ props:[{kind:'bramble',x:10,z:0}], predators:[{kind:'wolf',x:15,z:0,state:'roam'}] })`,
  asserts the return value (`{ trees:0, props:1, predators:1 }`), then asserts
  `qaPredatorState(idx)` (found via `qaBuildScene`'s return or a direct
  `predators.findIndex`-equivalent probe -- reuse `qaStageWalkIntoCover('bramble')` after
  the build call as a real-collision cross-check: it must find the placed bramble and
  return a non-null result, proving `coverData`/`coverGrid` are genuinely built, not just
  returned as a count) confirms the wolf is at the given position in `'roam'`.

**Hooks.** `window.ForestEngine.qaBuildScene(scene): {trees,props,predators}` -- new,
declared in `engine/forest-engine.d.ts`, installed inside the `?qaHooks=1` block in
`init()` (`engine/forest-engine.js`). `window.ForestEngine.qaProbeMemory(): {heap,
renderer}` -- new, same file/install site. `qaWorld`/`qaNoRender` are boot-time URL params,
not hooks -- no `.d.ts` entry (matches `?seed=`, which is also undeclared there).
`qaProbeMapSeed`, `qaProbeTreeChunks`, `qaProbePlayer`, `qaStageWalkIntoCover`,
`qaPredatorState` are pre-existing hooks, reused unchanged.

**Tester scenario.** None: this ticket's own surface is QA/CI instrumentation, not
player-visible -- no nightly `shared/local-qa/` coverage needed. (LUL-2324 child 2/2 is
what actually reduces the nightly tester's own memory footprint, by migrating its specs
onto these hooks -- that migration's own e2e coverage is that ticket's concern.)

**Not covered.** `qaBuildScene`'s `child`/`home` optional fields and the "4th predator of
one kind is dropped" edge are not separately spec'd here -- straightforward reads of the
implementation, and child 2 will exercise `child`/`home` naturally once real specs use
them. The Firefox/Safari `performance.memory === null` path for `qaProbeMemory()` is not
exercised -- this repo's Playwright suite runs Chromium only (`playwright.config.ts`).

## Constraints

- No change to any code path a real player's page load executes differently than before
  this diff -- `qaWorld`/`qaNoRender` absent, `qaBuildScene`/`qaProbeMemory` never called
  (both require `?qaHooks=1`, itself never on in production). The `COVER_PROPS`/
  `BOG_TREES`/`BOG_REEDS` -> `CONFIG.coverProps`/`CONFIG.bogTrees`/`CONFIG.bogReeds` rename
  must not change any value read at any of the 9 touched call sites for the default
  (non-`qaWorld`) path -- verified by `e2e/smoke.spec.ts` staying green and by inspection
  (same numeric literals, just relocated).
- `qaBuildScene` must never call `rng()` (directly or via a function that does) -- it must
  be safe to call after any `generateMap()`/`qaRegenerateMap()` without perturbing the
  seeded stream those depend on for reproducibility.
- Tier C: requires `REVIEW: APPROVED` from the Code Reviewer before merge.

## Out of scope

- The e2e spec migration itself (27 hook-staged specs -> `qaWorld=micro`/`qaBuildScene`,
  ~18 full-map specs tagged `@fullmap`) -- LUL-2324 child 2/2, blocked on this landing.
- `qaWorld=micro` + `qaSetDifficulty('hard')` compatibility (`pickHardBabyPosition()`'s
  `BLACKOUT_MIN_RADIUS` predicate is unsatisfiable at `mapSize:96`, see "Declared
  limitation" above) -- flagged, not fixed; a follow-up ticket if child 2 needs it.
- `qaBuildScene` support for placing bog trees, landmarks, the cave, or throwables --
  ticket scope named `trees`/`props`/`predators`/`child`/`home` only.
- `qaBuildScene` support for setting the player's own position -- existing hooks
  (`qaTeleportHome`, `qaTeleportNearBaby`, the various `qaStageXxx` hide/chase stagers)
  already cover that; not duplicated here.
- LUL-2249 (streamed chunks -- the real fix for the live game's resident set) -- separate,
  already queued, does not touch the production boot path; this ticket only adds
  `?qaHooks`-gated surface.
