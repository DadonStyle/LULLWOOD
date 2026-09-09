# SPEC: LUL-2247 prop density -- spacing rule and per-chunk caps

**Ticket:** LUL-2247 · Rollout step 3/6 of parent epic LUL-2223. **Tier: C** —
`engine/forest-engine.js` map-generation code (changes what spawns where). Requires
`REVIEW: APPROVED` before merge.

**Written against:** `release/next` @ `bd459fa` (2026-09-09). Re-derive every
`file:line` below if it has moved on the branch you implement on.

## Files

- `lib/game/cover.ts` — edited: one new pure export, `thinProps()`.
- `lib/game/cover.test.ts` — edited: unit tests for `thinProps()`.
- `engine/tuning.js` — edited: two new exports, `PROP_MIN_SPACING` and `PROP_CHUNK_CAP`.
- `engine/forest-engine.js` — edited: import the two constants + `thinProps`; one new
  module-scope helper (`thinGeneratedProps()`); one call-site change in `generateMap()`;
  `layoutTreePool(bogParts, ...)` moves out of `generateBogTrees()` into `generateMap()`;
  one new QA hook.
- `engine/forest-engine.d.ts` — edited: declare the new hook.
- `docs/ELEMENTS.md` — edited: the bog/forest density bullets currently describe
  unbounded scatter; note the new cap.
- `e2e/prop-density.spec.ts` — created (desktop).
- `e2e/mobile/prop-density.spec.ts` — created (mobile viewport, identical assertions).

## The problem

`generateCover()` (`engine/forest-engine.js:655-672`), `generateThrowables()` (`:674-691`),
`generateBogTrees()` (`:850-865`) and `generateReeds()` (`:881-894`) each reject a
candidate against lake/spawn/baby/tree-trunk/tree-canopy/own-kind-so-far, but never against
each other, and never against a per-area count. A bog chunk (60x60 = 3600 u²) can hold cover
props, reeds and bog trees landing within a couple of units of each other, with no ceiling
on how many non-tree objects one 60x60 chunk collects. Reeds (`:886`) reject only
`biomeAt(x,z) <= 0` and `nearLandmarks` — never `inLake()` or `overlapsTreeTrunk()`, unlike
every other prop generator in this file.

## The fix

A deterministic **post-filter** — draws no `rng()`, same principle as the E6 tree-chunk
bucketing at `:780-781` (bucketing reads only `x`/`z`, already fixed before it runs) — run
once, after every prop-generating function has populated its array for this map, over the
union of `coverData` (excluding `kind === 'tree'`), `bogTreeData` and `throwableData`. It
enforces a flat centre-to-centre minimum spacing between any two non-tree objects
regardless of kind, and a per-60x60-chunk cap per category. Forest trees are untouched —
they already have their own spacing discipline (`overlapsTreeTrunk`/`overlapsTreeCanopy`
at generation time) and LUL-2225's separate bog-core culling; this ticket is only about the
four non-tree generators above.

### 1. `engine/tuning.js` — two new constants

Insert immediately after `export const COVER_PROPS = 880;` (currently line 151):

```js
// LUL-2247: flat centre-to-centre minimum spacing enforced between ANY two
// non-tree generated props (cover/reed/bogTree/stone), regardless of kind,
// as a post-filter over the finished map -- independent of and in addition
// to the tighter, kind-specific overlap checks each generator already runs
// at rng-draw time (overlapsTreeTrunk/overlapsTreeCanopy/overlapsExistingCover).
export const PROP_MIN_SPACING = 3.5;

// LUL-2247: per-60x60-chunk ceiling per prop category (same chunk grid as
// TREE_CHUNK_SIZE, forest-engine.js's treeChunkIndex()). 'cover' covers
// log/rock/bramble together (generateCover()'s non-reed, non-tree output);
// reed/bogTree/stone (== throwableData) are their own categories since each
// has its own generator and its own visual density expectation.
export const PROP_CHUNK_CAP = { cover: 12, reed: 24, bogTree: 12, stone: 3 };
```

### 2. `lib/game/cover.ts` — `thinProps()`

Append after `overlapsExistingCover()` (currently ends at line 128), in the same
LUL-2212 "cover-prop-vs-cover-prop spawn clearance" section since it is the same
family of concern (spacing between placed props), just applied post-hoc across
categories rather than during the rng loop:

```ts
// ---- cross-category prop density (LUL-2247) --------------------------------
// overlapsExistingCover() above runs DURING generateCover()'s rng loop and only
// ever compares a candidate against props from that same loop (log/rock/bramble/
// tree), using each prop's own half-extent as its clearance radius. It says
// nothing about reeds (generateReeds(), a separate loop that runs later and
// appends into the same coverData array), bog trees (generateBogTrees(), its
// own array) or stones (generateThrowables()/throwableData) -- and nothing
// about a per-area density ceiling at all. thinProps() is the post-hoc,
// cross-category version of the same idea: given every non-tree prop for this
// map in generation order, keep the first one to claim a location and reject
// anything that lands within `minSpacing` of an already-kept prop (regardless
// of kind) or that would push its chunk+kind over `caps[kind]`. Draws no RNG --
// safe to run after every generator has already consumed its own stream.
//
// `chunkIndexFn` is injected rather than imported from the engine (which owns
// TREE_CHUNK_SIZE/TREE_CHUNKS_PER_AXIS/half as module-scope state) so this stays
// pure and unit-testable with a trivial fixture chunking function.
export interface SpacedProp {
  x: number;
  z: number;
  kind: string;
}

export function thinProps<T extends SpacedProp>(
  list: readonly T[],
  minSpacing: number,
  caps: Readonly<Record<string, number>>,
  chunkIndexFn: (x: number, z: number) => number,
): T[] {
  const grid: SpatialGrid<T> = new Map();
  const chunkCounts = new Map<string, number>();
  const minSq = minSpacing * minSpacing;
  const kept: T[] = [];

  for (const item of list) {
    const cap = caps[item.kind];
    const chunkKey = cap !== undefined ? `${chunkIndexFn(item.x, item.z)}:${item.kind}` : '';
    if (cap !== undefined && (chunkCounts.get(chunkKey) ?? 0) >= cap) continue;

    let tooClose = false;
    for (const other of neighbourhood(grid, item.x, item.z, CELL)) {
      const dx = item.x - other.x, dz = item.z - other.z;
      if (dx * dx + dz * dz < minSq) { tooClose = true; break; }
    }
    if (tooClose) continue;

    kept.push(item);
    const k = gridKey(Math.floor(item.x / CELL), Math.floor(item.z / CELL));
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(item);
    if (cap !== undefined) chunkCounts.set(chunkKey, (chunkCounts.get(chunkKey) ?? 0) + 1);
  }
  return kept;
}
```

`CELL` (8) is safe as the neighbour-search cell size for a 3.5-unit `minSpacing`: a 3x3
neighbourhood at cell size 8 catches every point within 8 units of the query point, and
8 > 3.5, so no true positive is ever missed by `neighbourhood()`'s 1-cell-radius scan
(same guarantee `treesNear()`/`overlapsTreeTrunk()` already rely on for canopy radii up to
~8 elsewhere in this file). `neighbourhood()`/`gridKey()`/`CELL`/`SpatialGrid` are already
defined above in this file (`:202-253`) — no new grid primitive.

### 3. `engine/forest-engine.js` — imports

Add `thinProps` to the `@/lib/game/cover` import list (currently `:55-78`, alongside
`overlapsExistingCover`):

```js
  overlapsExistingCover,
  thinProps,
```

Add the two tuning constants to the `@/engine/tuning` import list (the same one LUL-2246
just extended with `FORCE_HUNT_LOCK`):

```js
  FORCE_HUNT_LOCK, PROP_MIN_SPACING, PROP_CHUNK_CAP,
```

### 4. `engine/forest-engine.js` — `thinGeneratedProps()` helper

New module-scope function, placed directly after `generateReeds()` (currently ends
`:894`):

```js
// LUL-2247: cross-category density pass. Runs once, after generateCover(),
// generateThrowables(), generateBogTrees() and generateReeds() have all
// finished (so coverData/bogTreeData/throwableData are each at their final,
// pre-thin size for this map) and before any of their layout*()/buildGrid()
// consumers run. Builds one combined, order-preserving list -- cover (log/
// rock/bramble) and reeds first (already in generation order inside
// coverData), then bog trees, then stones -- tags each with the category key
// thinProps()/PROP_CHUNK_CAP use, thins it, then filters the three real
// arrays down to exactly the kept objects (by reference, so no new object
// shapes are introduced downstream). 'tree' entries in coverData are excluded
// from the combined list entirely -- forest trees are not a "non-tree
// object" and already have their own spacing discipline; they pass through
// unfiltered below.
function thinGeneratedProps(){
  const combined = [];
  for(const c of coverData) if(c.kind !== 'tree') combined.push({ x: c.x, z: c.z, kind: c.kind === 'reed' ? 'reed' : 'cover', ref: c });
  for(const b of bogTreeData) combined.push({ x: b.x, z: b.z, kind: 'bogTree', ref: b });
  for(const t of throwableData) combined.push({ x: t.x, z: t.z, kind: 'stone', ref: t });

  const kept = thinProps(combined, PROP_MIN_SPACING, PROP_CHUNK_CAP, treeChunkIndex);
  const keptRefs = new Set(kept.map(k => k.ref));

  coverData = coverData.filter(c => c.kind === 'tree' || keptRefs.has(c));
  bogTreeData = bogTreeData.filter(b => keptRefs.has(b));
  throwableData = throwableData.filter(t => keptRefs.has(t));
}
```

`treeChunkIndex` (`:772-776`) is already module-scope in this file — no new import.

### 5. `engine/forest-engine.js` — `generateBogTrees()`: drop the internal layout call

Before (`:850-865`):

```js
function generateBogTrees(){
  bogTreeData = [];
  let tries = 0;
  // ...
  while(bogTreeData.length < BOG_TREES && tries < BOG_TREES*200){
    // ...
  }
  layoutTreePool(bogParts, bogTreeData, BOG_TREES);
}
```

After: delete the `layoutTreePool(bogParts, bogTreeData, BOG_TREES);` line from inside the
function. `bogTreeData` is filtered by `thinGeneratedProps()` after this function returns
(the caller in `generateMap()` now runs the layout call instead, see step 6) — laying the
pool out from inside this function would build meshes from the pre-thin array, one call too
early. `layoutTreePool()`'s own signature and every other call site are untouched.

### 6. `engine/forest-engine.js` — `generateMap()` call-site change

Before (`:956-958`):

```js
  generateBogTrees();
  generateReeds(); layoutCoverMeshes();
  buildGrid();   // picks up bogTreeData for blockedR()/canopyBlockedR()
```

After:

```js
  generateBogTrees();
  generateReeds();
  thinGeneratedProps();   // LUL-2247: cross-category spacing + per-chunk caps
  layoutTreePool(bogParts, bogTreeData, BOG_TREES);   // moved out of generateBogTrees() -- needs the thinned array
  layoutCoverMeshes();
  buildGrid();   // picks up bogTreeData for blockedR()/canopyBlockedR()
```

`layoutCoverMeshes()` (`:692-712`) and `layoutThrowableMeshes()` (called earlier, right
after `generateThrowables()` at `:951` — unchanged, stays where it is since throwables are
also filtered by `thinGeneratedProps()` which now runs *after* that call) already pad every
unused instance slot up to their pool's fixed capacity (`COVER_PROPS`/`BOG_TREES`/
`THROWABLE_COUNT`) off-map at `y=-999`/scale `0.0001` — the exact mechanism LUL-2225's bog
keep-clear filter already relies on for a shorter-than-pool-size array (see the comment on
`generateCover()`'s bog filter, `:689` on the `lul-2225-small-bog` branch). No mesh-padding
change needed here.

**`layoutThrowableMeshes()` ordering note:** it runs at `:951`, *before* `thinGeneratedProps()`
now runs (`:958` new location) — so on the first frame after `generateMap()`,
`layoutThrowableMeshes()` still lays out the *pre-thin* `throwableData`. Move its call too:
delete `layoutThrowableMeshes();` from `:951` and add it to the block in step 6, right after
`layoutTreePool(...)`:

```js
  generateCover(); layoutCoverMeshes();
  generateThrowables();
  generateWind();
  pushState({ windX, windZ });
  generateBogTrees();
  generateReeds();
  thinGeneratedProps();
  layoutTreePool(bogParts, bogTreeData, BOG_TREES);
  layoutThrowableMeshes();
  layoutCoverMeshes();
  buildGrid();
```

(`layoutCoverMeshes()` is called twice total across this sequence in the original code —
once right after `generateCover()` at `:950`, unchanged, and once after reeds/thin at the
new location — same as before this ticket, just re-run once more after thinning so reeds
and any cover prop the thin pass dropped are reflected in the instance buffers. The first
call after `generateCover()` is a no-op-losing intermediate render state only briefly, same
as today between `:950` and `:957`.)

### 7. New QA hook — after `qaProbeTreeChunks` (currently `:3213-3220`)

```js
  // LUL-2247: exposes the finished map's post-thin prop layout for e2e
  // assertions -- per-chunk counts by category (same categories
  // PROP_CHUNK_CAP keys), the minimum pairwise centre-to-centre distance
  // across every non-tree prop (cover/reed/bogTree/stone) regardless of
  // kind, and the total count. O(n^2) over the thinned (small) population --
  // test-only, never called per-frame.
  window.ForestEngine.qaProbePropDensity = function(){
    const perChunkMap = new Map();
    const bump = (chunk, cat) => {
      const e = perChunkMap.get(chunk) || { chunk, cover: 0, reed: 0, bogTree: 0, stone: 0 };
      e[cat]++; perChunkMap.set(chunk, e);
    };
    const all = [];
    for(const c of coverData){
      if(c.kind === 'tree') continue;
      const cat = c.kind === 'reed' ? 'reed' : 'cover';
      bump(treeChunkIndex(c.x, c.z), cat);
      all.push(c);
    }
    for(const b of bogTreeData){ bump(treeChunkIndex(b.x, b.z), 'bogTree'); all.push(b); }
    for(const t of throwableData){ bump(treeChunkIndex(t.x, t.z), 'stone'); all.push(t); }

    let minPairSpacing = Infinity;
    for(let i = 0; i < all.length; i++){
      for(let j = i+1; j < all.length; j++){
        const dx = all[i].x - all[j].x, dz = all[i].z - all[j].z;
        const d = Math.hypot(dx, dz);
        if(d < minPairSpacing) minPairSpacing = d;
      }
    }
    return {
      perChunk: Array.from(perChunkMap.values()),
      minPairSpacing: Number.isFinite(minPairSpacing) ? minPairSpacing : null,
      total: all.length,
    };
  };
```

### 8. `engine/forest-engine.d.ts` — hook declaration

Add next to `qaProbeTreeChunks` (grep for it — not currently declared in the `.d.ts`; add
both entries together, alphabetically near the other `qaProbe*` hooks around line 61-79):

```ts
/** LUL-2247: per-chunk prop counts by category (cover/reed/bogTree/stone), the minimum pairwise centre-to-centre distance across every non-tree prop, and the total count -- all read from the finished, post-thin map. */
qaProbePropDensity?: () => {
  perChunk: Array<{ chunk: number; cover: number; reed: number; bogTree: number; stone: number }>;
  minPairSpacing: number | null;
  total: number;
};
```

(`qaProbeTreeChunks` itself has no existing `.d.ts` entry either — pre-existing gap, out of
scope for this ticket; do not add it as a drive-by.)

### 9. `docs/ELEMENTS.md`

Find the bullet(s) describing bog trees/reeds/cover density (grep `BOG_TREES` and
`COVER_PROPS` in the doc) and add one clause noting the new cap, e.g. append to the
relevant bullet: "capped per 60x60 chunk and to a 3.5u minimum spacing across every
non-tree prop type (`PROP_CHUNK_CAP`/`PROP_MIN_SPACING`, `engine/tuning.js`, LUL-2247)."
Run `node scripts/check-elements-citations.mjs` before committing — fix with `--fix` if it
flags drift on a citation this diff's line-number shifts touch.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm run build` — clean.
3. `npx eslint engine/forest-engine.js engine/tuning.js lib/game/cover.ts` — clean.
4. `node scripts/check-elements-citations.mjs` — clean.
5. `node scripts/check-duplicate-logic.mjs` — clean.
6. `node --test lib/game/cover.test.ts` — new `thinProps()` tests pass (see below).
7. Determinism: grep the diff for `rng()`/`Math.random()` — none added. `thinProps()`
   reads only `x`/`z`/`kind`, draws nothing.
8. `e2e/map-seed.spec.ts` passes with **zero edits** — proves `thinGeneratedProps()` added
   no rng draw and didn't reorder any existing one (it runs strictly after every generator
   in the stream has already drawn everything it draws).
9. `npx playwright test e2e/prop-density.spec.ts e2e/mobile/prop-density.spec.ts e2e/map-seed.spec.ts e2e/bog-zone.spec.ts e2e/tree-pathing.spec.ts e2e/lul211-founder-report.spec.ts` —
   all green (the last three exercise cover/bog/LOS geometry this diff reshuffles which
   props survive, without changing the generation stream itself).

### `thinProps()` unit tests (`lib/game/cover.test.ts`)

Add near the LUL-2212 `overlapsExistingCover` tests:

- Two items of the same kind 3.0 units apart with `minSpacing=3.5`: second is rejected.
  3.6 units apart: both kept.
- Two items of *different* kinds within `minSpacing`: still rejected (spacing is
  cross-category, not per-kind) — this is the regression test for the exact gap the ticket
  describes (reeds never checked against cover/bogTree/stone).
- A chunk cap of 1 for kind `'x'`: a third same-chunk, same-kind item at a location that
  passes the spacing check is still rejected once the cap is reached; a different-kind item
  at the same location is unaffected by the `'x'` cap.
- Order matters, not identity: given two colliding items, the earlier one in `list` is
  always kept and the later one dropped — feed the same pair in both orders and assert the
  survivor flips.
- A `chunkIndexFn` that returns a constant (single global chunk) still enforces the cap
  correctly (degenerate case).
- Empty list in, empty list out.

## e2e (mandatory, ships in this PR)

**Specs.**
- `e2e/prop-density.spec.ts` — new, desktop. `boot(page, { qaHooks: true, seed:
  QA_PINNED_SEED })`, then for seeds `QA_PINNED_SEED, QA_PINNED_SEED+1, QA_PINNED_SEED+2,
  QA_PINNED_SEED+3` (reload with `?seed=`): call `qaProbePropDensity()` and assert every
  `perChunk` entry has `cover <= 12`, `reed <= 24`, `bogTree <= 12`, `stone <= 3`;
  `minPairSpacing >= 3.5` (allow a `1e-6` float-slop margin); no reed's position satisfies
  `overlapsTreeTrunk`... actually simpler and hook-only: assert `total` is the same whether
  computed once or twice in a row (idempotent read, no mutation from probing) and is `> 0`
  (a seed that thinned everything away would silently pass an `<= cap` check vacuously —
  guard against that).
- `e2e/mobile/prop-density.spec.ts` — new, mobile viewport (`727x393`, same shape as
  `e2e/mobile/bog-zone.spec.ts`). Identical assertions to the desktop spec — map generation
  has no touch/viewport dependency, so this is a parity proof (founder rule: every logic
  change ships desktop AND mobile), not a distinct behaviour.
- `e2e/map-seed.spec.ts` — must pass **unchanged** (proves no rng-stream perturbation).
- `e2e/bog-zone.spec.ts`, `e2e/tree-pathing.spec.ts`, `e2e/lul211-founder-report.spec.ts` —
  must pass unchanged (these sample `blocked()`/LOS/bog geometry that this diff can only
  ever make *sparser*, never invalid — a location that was walkable/visible before stays
  so; the reverse isn't claimed or tested here).

**Hooks.** `window.ForestEngine.qaProbePropDensity(): { perChunk, minPairSpacing, total }`
— see §7 above. New, declared in `engine/forest-engine.d.ts`, installed inside the
`?qaHooks=1` block in `init()`.

**Tester scenario.** No `shared/local-qa/requests/` file needed — this is pure generation
density with no HUD/visual-overlap surface the nightly vision-model audit covers
(`shared/local-qa/QA_TESTER.md` scope is HUD overlap + win/lose sequences). Covered
entirely by the Playwright specs above.

**Not covered.** Whether the *reduced* density reads as an improvement (less visual clutter,
easier sightlines) is a feel judgment for a human or the local-qa tester's vision-model
pass, not asserted here. Balance retuning of `PROP_MIN_SPACING`/`PROP_CHUNK_CAP` if a chunk
still reads as too dense or too sparse in practice is a follow-up ticket.

## Constraints (parent epic LUL-2223's "must not change", applies verbatim)

- Win rule: carrying the child to `CONFIG.home` wins (`arriveHome()`,
  `lib/game/outcome.ts`) — untouched.
- LUL-1081 end-screen persistence; `e2e/win-persist.spec.ts`, `e2e/death-persist.spec.ts`,
  `e2e/replay/*.spec.ts`, `e2e/mobile/win-persist.spec.ts` pass unchanged.
- Seed determinism: no `Math.random()`/new `rng()` draw added; `e2e/map-seed.spec.ts`,
  `e2e/predator-determinism.spec.ts` pass unchanged. `thinGeneratedProps()` runs strictly
  after every existing rng consumer in `generateMap()` and reorders no draw.
- `generateMap()` stream order — mission and cave draws stay last; `thinGeneratedProps()`
  inserts only between `generateReeds()` and `placeLandmarks()`, both non-rng-affecting
  relative to mission/cave.
- `CONFIG.wrapEnabled = false` and the `WRAP_SPAN` seam maths — untouched (`thinProps()`
  does no wrap-aware math; the map doesn't wrap).
- Fixed geography: `LANDMARKS`, `ROOSTS`, `CAVE`, `CONFIG.lake`, `CONFIG.home`,
  `BOG_CENTER`/radii — untouched.
- Shared `trunkGeo`/`cone1Geo`/`cone2Geo`/`trunkMat`/`foliageMat` — never disposed; this
  diff doesn't touch geometry/material lifecycles, only which generated positions survive.
- CI stays green: `scripts/check-duplicate-logic.mjs`, `scripts/check-elements-citations.mjs`.
- Every spec needs a `## e2e` section (founder rule 2026-09-08). Local QA tester comments
  `local-qa: PASS|FAIL @<sha>` on the PR (founder rule 2026-09-09) — do not run Playwright
  yourself as PR verification.

## Out of scope

- Reeds' missing `inLake()`/`overlapsTreeTrunk()` checks at *generation* time (the ticket's
  problem statement mentions this) — `thinProps()`'s cross-category spacing rule already
  prevents a reed from surviving within 3.5u of a tree-trunk-adjacent cover prop or from
  landing so densely that the chunk cap catches it, which covers the *symptom* (visual/
  spacing clutter). Adding the missing checks directly inside `generateReeds()`'s own loop
  is a separate, smaller fix if the spec author/reviewer decides the post-filter alone
  isn't sufficient after playtesting — not bundled here to keep this diff's rng-stream
  footprint minimal (zero new draws, vs. a new rejection branch that would shift `ry`'s
  draw count same as the LUL-2212/LUL-2225 precedents already accepted for a deliberate,
  declared reshuffle).
- The other four children of epic LUL-2223 (force-hunt lock — done, landmark beacons,
  streamed chunks, whole-map spawn) — each is its own ticket/PR.
- Retuning `PROP_MIN_SPACING`/`PROP_CHUNK_CAP` beyond the values this ticket derives from
  the reported density problem — a follow-up balance pass if playtesting says otherwise.
- `qaProbeTreeChunks` lacking a `.d.ts` entry (pre-existing gap, noted in §8) — not this
  ticket's to fix.
