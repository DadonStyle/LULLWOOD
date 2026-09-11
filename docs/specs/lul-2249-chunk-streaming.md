# SPEC: LUL-2249 streamed chunks -- instantiate on approach, dispose far

**Ticket:** LUL-2249 (rollout step 5/6 of parent epic LUL-2223) · **Tier:** C -- engine
simulation (per-chunk collision grid mutation, streaming lifecycle) and rendering
(InstancedMesh create/dispose on a hot path). Needs `REVIEW: APPROVED` from the Code
Reviewer before merge.

**Written against:** `release/next` @ `16c520ba` (2026-09-11). The ticket's own citations
were against `main` @ `4d7f1c9` (parent epic cut) and have drifted significantly --
`layoutTreeChunks()`'s chunking infrastructure already exists (LUL-1487, E6) and
`PROP_CHUNK_CAP`/prop-thinning already exists (LUL-2247); this spec builds on both rather
than inventing chunking from scratch. Population counts have also moved: `CONFIG.bogTrees`
is **30** today, not 360 (LUL-2225 shrank the bog patch), and `CONFIG.coverProps` is a
per-kind InstancedMesh **capacity** of 880 (log/rock/bramble/reed each get their own
880-capacity mesh), not "880 cover + 880 reeds" as two separate pools -- actual reed count
is capped by `CONFIG.bogReeds` (120), well under that capacity. Re-derive every citation
below again if this branch has moved further by the time this is implemented.

## Files

- `engine/forest-engine.js` -- edit `layoutTreeChunks()`, `buildGrid()`, `buildCoverGrid()`,
  `generateMap()` call sites, `coverMeshes`/`bogParts` construction, add a streaming
  controller (`ensureChunk`/`dropChunk`/`updateStreamedChunks`), add/extend `qaProbe*` hooks
- `engine/forest-engine.d.ts` -- declare the new/changed hooks
- `e2e/chunk-streaming.spec.ts` -- new
- `e2e/mobile/chunk-streaming.spec.ts` -- new
- `docs/ELEMENTS.md`, `docs/CUES.md` -- update any `forest-engine.js:<line>` citations that
  move (run `node scripts/check-elements-citations.mjs` to find them)

## The change

### 0. Vocabulary

"Chunk" always means a `TREE_CHUNK_SIZE=60` cell in the existing `TREE_CHUNKS_PER_AXIS x
TREE_CHUNKS_PER_AXIS` grid (`engine/forest-engine.js:828-834`, unchanged) -- the same chunk
id every prop category streams against, not a second grid. "Populated" = a chunk whose
`treeData`/cover/bog bucket is non-empty (data-level, always true for most of the 8x8 grid
on a 5200-tree map, unaffected by streaming). "Live"/"instantiated" = a chunk currently
holding real `InstancedMesh` objects in the scene graph. Before this ticket every populated
chunk is always live. After it, only chunks within the ring are live.

### 1. `engine/forest-engine.js:1093-1095` -- move tree rotation/tint rng draws to generate time

Current (inside `layoutTreeChunks()`, `:880-901`):
```js
for(let i=0; i<data.length; i++){
  const t = data[i];
  const yaw = rng()*Math.PI*2;
  const b = 0.72 + rng()*0.5;
  ...
}
```
This is the load-bearing determinism point. Move both draws into the forest-tree generation
loop in `generateMap()` (`:1083-1094`), in the same index order they run today (this loop
already runs before `layoutTreeChunks(treeData)` is called at `:1095`), and store them on
the object:
```js
while(treeData.length < CONFIG.trees && tries < CONFIG.trees*25){
  ...
  const s = 0.7 + rng()*1.7;
  ...
  const rot = rng()*Math.PI*2;
  const tintB = 0.72 + rng()*0.5;
  treeData.push({ x, z, s, cr: 0.35*s, crCanopy: ..., culled, rot, tint: tintB });
}
```
Draw order per tree stays `s` (already there) then `rot` then `tintB` -- same two new draws,
same position in the per-tree sequence `layoutTreeChunks()` used to make, so the rng stream
is byte-identical to today's for every existing seed. `layoutTreeChunks()`'s per-tree loop
(`:880-901`) now only reads `t.rot`/`t.tint` -- draws nothing -- so it can run partially (one
chunk at a time) without touching the stream. `qaProbeMapSeed()` (`:3516-3523`) is unaffected
(it never read rot/tint).

### 2. `engine/forest-engine.js:841-911` -- `layoutTreeChunks()` becomes data-only; instantiate/dispose moves to `ensureChunk`/`dropChunk`

`layoutTreeChunks(data)` keeps building `buckets`/`localIndex` (chunk -> tree indices) exactly
as today -- this is pure bucketing off `x`/`z`, no rng, no GPU work, and every other chunked
category (cover/bog, below) reuses the identical bucketing shape. What it stops doing: it no
longer creates or disposes any `InstancedMesh`. Split it:

```js
let treeChunkBuckets = [];  // chunk id -> array of tree indices into treeData, rebuilt per generateMap()
let treeChunkTrios = [];    // chunk id -> [trunk, cone1, cone2] InstancedMesh trio, ONLY for live chunks
let liveChunks = new Set(); // chunk ids currently instantiated, all categories share one liveness set

function bucketTreeChunks(data){
  const nChunks = TREE_CHUNKS_PER_AXIS * TREE_CHUNKS_PER_AXIS;
  treeChunkBuckets = Array.from({length: nChunks}, () => []);
  for(let i=0; i<data.length; i++) treeChunkBuckets[treeChunkIndex(data[i].x, data[i].z)].push(i);
}
```
`ensureChunk(c)` (new): if `treeChunkTrios[c]` already exists, return. Else, if
`treeChunkBuckets[c].length === 0`, return (nothing to build). Else build the trio sized to
that chunk's own tree count (`treeChunkBuckets[c].length`, same as today's per-chunk `count`),
write every tree's matrix/tint via the *stored* `t.rot`/`t.tint` (no rng), same
`culled` off-map handling as today's `:888-889` branch, `frustumCulled` left at the
Object3D default (true, unchanged), `computeBoundingSphere()` once after layout (unchanged),
add to `scene`, store in `treeChunkTrios[c]`.

`dropChunk(c)` (new): if `treeChunkTrios[c]` is absent, return. Else `scene.remove(m)` +
`m.dispose()` for each of the three meshes (same as today's `:848-851` loop, just for one
chunk instead of all), then `delete treeChunkTrios[c]` (or set to `undefined` -- keep the
sparse-array shape `qaProbeTreeChunks()` already assumes). **Never** call
`.geometry.dispose()`/`.material.dispose()` here -- `trunkGeo`/`cone1Geo`/`cone2Geo`/
`trunkMat`/`foliageMat` are shared across every chunk and with `bogParts`; this is the exact
trap the ticket flags and the one `layoutTreeChunks()`'s own comment (`:845-847`) already
warns about for the old all-at-once path.

`generateMap()`'s call site (`:1095`, currently `if(!qaNoRender) layoutTreeChunks(treeData);`)
becomes:
```js
if(!qaNoRender){
  for(const c of liveChunks){ dropChunk(c); }  // full reset on regen -- see §5
  liveChunks = new Set();
  bucketTreeChunks(treeData);
  updateStreamedChunks(true);  // force -- populate the ring around the fresh spawn point
}
```

### 2b. Tree collision grid stays whole-map (do not chunk `treeData`'s grid entries)

`treeData`/`bogTreeData`/`landmarkData` collision membership (`buildGrid()`, `:596-604`) is
**not** part of this streaming change -- re-derive why before touching it: `blocked()`/
`predatorBlocked()` are called for the player and for every active predator, and predators
already roam the *whole* map today (step 6 of this epic adds whole-map predator spawn on top
of that unchanged behaviour) -- an un-rendered chunk still needs real collision so a predator
crossing it, or the player about to enter it, doesn't fall through world geometry that simply
hasn't streamed in yet. Keep `buildGrid()` exactly as it is (still rebuilds from the full
`treeData`/`bogTreeData`/`landmarkData` arrays, still called from the same four call sites,
`:1096,:1134,:1136,:1145`) -- streaming only touches what's **rendered**, never what's
**collidable**. This also means `ensureChunk`/`dropChunk` for trees never touch `grid` at
all, only the cover grid (§4) does, because cover/reed collision (`coverBlockedR`) genuinely
differs from tree collision by design already (log/bramble are walkable, LUL-384) and its
population per chunk is two orders of magnitude smaller than the tree grid, making rebuild
cost negligible either way -- see §4 for why cover/bog gets true incremental grid streaming
and trees don't.

### 3. Ring controller -- `updateStreamedChunks(force)`

New module-scope state and function, placed after `treeChunkIndex()` (`:831-835`):
```js
const STREAM_RADIUS_CHUNKS = 2;   // load radius: 5x5 = 300x300u square around the player's chunk
const STREAM_UNLOAD_CHEBYSHEV = 3; // unload once Chebyshev distance exceeds this -- hysteresis band
let lastStreamChunkX = null, lastStreamChunkZ = null;

function chunkXZ(x, z){
  return [
    Math.min(TREE_CHUNKS_PER_AXIS-1, Math.max(0, Math.floor((x+half)/TREE_CHUNK_SIZE))),
    Math.min(TREE_CHUNKS_PER_AXIS-1, Math.max(0, Math.floor((z+half)/TREE_CHUNK_SIZE))),
  ];
}

function updateStreamedChunks(force){
  const [cx, cz] = chunkXZ(player.x, player.z);
  if(!force && cx === lastStreamChunkX && cz === lastStreamChunkZ) return;  // recompute only on chunk change
  lastStreamChunkX = cx; lastStreamChunkZ = cz;

  const wanted = new Set();
  for(let dx = -STREAM_RADIUS_CHUNKS; dx <= STREAM_RADIUS_CHUNKS; dx++){
    for(let dz = -STREAM_RADIUS_CHUNKS; dz <= STREAM_RADIUS_CHUNKS; dz++){
      const ccx = cx+dx, ccz = cz+dz;
      if(ccx < 0 || ccx >= TREE_CHUNKS_PER_AXIS || ccz < 0 || ccz >= TREE_CHUNKS_PER_AXIS) continue;
      wanted.add(ccx*TREE_CHUNKS_PER_AXIS + ccz);
    }
  }
  for(const c of wanted) if(!liveChunks.has(c)){ ensureChunk(c); ensureCoverChunk(c); ensureBogChunk(c); liveChunks.add(c); }
  for(const c of Array.from(liveChunks)){
    if(wanted.has(c)) continue;
    const [lcx, lcz] = [Math.floor(c/TREE_CHUNKS_PER_AXIS), c%TREE_CHUNKS_PER_AXIS];
    const cheb = Math.max(Math.abs(lcx-cx), Math.abs(lcz-cz));
    if(cheb > STREAM_UNLOAD_CHEBYSHEV){ dropChunk(c); dropCoverChunk(c); dropBogChunk(c); liveChunks.delete(c); }
  }
}
```
`wanted` (radius 2, 5x5 = up to 25 chunks) is the load set; a chunk only unloads once it's
past Chebyshev distance 3 from the player's current chunk -- since `wanted`'s own edge is at
Chebyshev 2, this leaves a one-chunk hysteresis band (radius 2 load / radius 3 unload) so a
player oscillating across a single chunk boundary doesn't thrash instantiate/dispose every
frame. `player.x`/`player.z` are read directly (module-scope, already how every other
per-frame check in this file reads player position) -- no `wrapDelta` needed for the chunk
index itself since `CONFIG.wrapEnabled` is false and coordinates are already clamped into
`[0, TREE_CHUNKS_PER_AXIS)` by `chunkXZ`'s own `Math.min`/`Math.max`, matching
`treeChunkIndex()`'s existing clamp (`:832-833`). If `wrapEnabled` is ever flipped true, this
clamp is exactly where wraparound chunk math would need to go through `wrapCellIndex()`
(`lib/game/wrap.ts`) instead -- flagged here per the ticket's constraint, not implemented
(`wrapEnabled` stays false, out of scope, §Out of scope below).

Call `updateStreamedChunks(false)` once per frame from `stepFrame()`, right after the
movement/collision-resolution block that writes the frame's final `player.x`/`player.z`
(`engine/forest-engine.js:5152-5153`, the `if(!blocked(nx, player.z))`/`if(!blocked(player.x,
nz))` slide-along-trunks pair -- the last write to `player.x`/`player.z` in `stepFrame()`,
confirmed by grepping every `player.x =`/`player.z =` assignment in the function). Note fog
density (`:5085`, earlier in `stepFrame()` than the movement block) already reads
`player.x`/`player.z` from *before* this frame's movement resolves -- a pre-existing
one-frame lag unrelated to this ticket; `updateStreamedChunks` inherits the same lag (a
just-streamed-in chunk's fog treatment is one frame behind position), which is negligible at
60fps and not a regression to fix here. The
function's own early-return on unchanged `(cx,cz)` is the "not per frame" cost control the
ticket asks for -- the per-frame cost when the chunk hasn't changed is two `Math.floor` calls
and an equality check.

### 4. Cover/reed pool -- per-chunk `InstancedMesh`, per-chunk collision grid entries

Replace the four fixed-capacity 880-instance meshes (`coverMeshes`, `:521-527`) with a
per-chunk, per-kind mesh, sized to that chunk's own count -- same shape as tree chunk trios.
`coverData` already carries `x`/`z` (bucketable via `treeChunkIndex()`, the one chunk grid
every category shares per §0) and `kind` (`log`/`rock`/`bramble`/`reed`).

```js
let coverChunkBuckets = [];              // chunk id -> array of coverData indices (non-tree kinds only)
let coverChunkMeshes = [];               // chunk id -> { log?, rock?, bramble?, reed?: InstancedMesh }

function bucketCoverChunks(){
  const nChunks = TREE_CHUNKS_PER_AXIS * TREE_CHUNKS_PER_AXIS;
  coverChunkBuckets = Array.from({length: nChunks}, () => []);
  for(let i=0; i<coverData.length; i++){
    const c = coverData[i];
    if(c.kind === 'tree') continue;
    coverChunkBuckets[treeChunkIndex(c.x, c.z)].push(i);
  }
}
```
`ensureCoverChunk(c)`: if already built, return. Group `coverChunkBuckets[c]` by `kind`; for
each kind present, build an `InstancedMesh(<kindGeo>, <kindMat>, <count for that kind in this
chunk>)` using the same geometry/material objects `coverMeshes` used today (`logGeo`/`logMat`
etc., unchanged, still shared -- never disposed, per the ticket's constraint), lay out each
instance's matrix from `coverData[i].x/y/z/ry/hx/hz` exactly as today's `layoutCoverMeshes()`
body does (`:739-743`, no rng, pure data read), add to `scene`, store in
`coverChunkMeshes[c]`. `dropCoverChunk(c)`: `scene.remove` + `.dispose()` each mesh in
`coverChunkMeshes[c]` (never the shared geo/mat), clear the entry.

Collision: `coverGrid` (`buildCoverGrid()`, `:632-638`) switches from "rebuild whole map from
`coverData` every call" to per-chunk add/remove into the same `Map<string, CoverAABB[]>` --
`ensureCoverChunk(c)` also pushes each of its entries' cell key (`gridKey(Math.floor(x/CELL),
Math.floor(z/CELL))`, `lib/game/cover.ts:256-260`, `CELL=8`) into `coverGrid`; `dropCoverChunk(c)`
removes exactly those same entries (splice by reference, or filter the cell's array --
cheap, a chunk holds at most `PROP_CHUNK_CAP.cover + PROP_CHUNK_CAP.reed` = 36 entries,
`engine/tuning.js:222`). `coverBlockedR()`/`canSee()`/`findHideSpot()`
(`lib/game/cover.ts`) all consume `coverGrid` through `neighbourhood()`
(`lib/game/cover.ts:294`) purely as a `Map`, generic over what's in it -- no signature change
needed, confirmed by reading `neighbourhood<T>`'s implementation. **This is a real behaviour
change worth naming explicitly**: a bramble/log/reed outside the streaming ring is no longer
a hide spot or LOS-blocker -- exactly the intended effect (nothing that far is rendered
either), but call it out in the PR body as a deliberate consequence, not a silent one, since
it's a detection-affecting change even though it's Tier C for engine-sim reasons already.

`generateMap()`'s cover-related call sites change: `layoutCoverMeshes()` calls (`:1099,
:1133`) are replaced by `bucketCoverChunks()` (data-only, no GPU work, safe to call
unconditionally including under `qaNoRender` the same way `bucketTreeChunks` is data-only).
The full-map `buildCoverGrid()` calls in `generateCover()`/`generateReeds()`/
`thinGeneratedProps()` (`:708,:990,:1026`) **stay exactly as they are** -- they run during
generation, before any chunk has streamed in, and every one of them is immediately followed
by more mutation to `coverData` (thinning, reed placement) that would just invalidate a
partial per-chunk grid anyway; only the post-generation steady-state (player moving around
after the map is built) uses the incremental per-chunk add/remove path. `regenMap()`
(`:4779`) goes through `generateMap()` so it's covered by the same reset in §5.

### 5. Bog tree pool -- same per-chunk treatment as cover, smaller scale

`bogParts` (`:490-495`) today is a single fixed-capacity trio sized `CONFIG.bogTrees` (30).
At 30 total instances this is already cheap -- chunk it anyway for consistency with the
ticket's ask and because the bog patch (`BOG_CENTER`, `lib/game/bog.ts:37-39`) sits inside
just 2-3 chunks of the ring, so a player who never visits the bog quadrant pays zero bog-tree
GPU cost, matching the "far chunks disposed" contract `qaProbeTreeChunks`-style hooks assert.
Same shape as §4 but for `bogTreeData`, with its own `let bogChunkBuckets = []` /
`let bogChunkMeshes = []` (chunk id -> `[trunk, cone1, cone2]` trio, mirroring
`treeChunkTrios`) alongside `bucketBogChunks()`, `ensureBogChunk(c)`/
`dropBogChunk(c)` building/disposing that trio per chunk from
`trunkGeo`/`cone1Geo`/`cone2Geo`/`trunkMat`/`foliageMat` (same shared geometry as the forest
tree chunks -- never disposed), instances written from `bogTreeData[i].x/z/s` plus a stored
`rot`/`tint` the same way §1 adds to `treeData` (apply the identical fix to
`layoutTreePool()`'s `ry`/`b` draws at `:802,:813` -- move them into `generateBogTrees()`'s
loop, `:918-931`, store on `bogTreeData[i]`). Bog trees are **not** movement/LOS colliders
today (only `treeData`/`landmarkData` go into `grid`; bog trees do via `buildGrid()`'s
`addAllToGrid(bogTreeData)` at `:599` -- re-read: they ARE in the tree collision grid). Per
§2b, that whole-map `grid` is unaffected by any of this -- only the *rendered* bog-tree
meshes stream.

### 6. `generateMap()` reset sequencing (regenMap / restart)

Every `generateMap()` call must leave `liveChunks` empty and every previously-live chunk's
meshes disposed before re-populating around the fresh spawn point -- a stale live chunk from
the *previous* seed's geometry must never survive into the new one. Sequence, replacing
`:1095,:1099,:1133`:
```js
for(const c of liveChunks){ dropChunk(c); dropCoverChunk(c); dropBogChunk(c); }
liveChunks = new Set();
lastStreamChunkX = null; lastStreamChunkZ = null;   // force a real recompute below, not a stale-match no-op
if(!qaNoRender){
  bucketTreeChunks(treeData);
  bucketCoverChunks();
  bucketBogChunks();
  updateStreamedChunks(true);
}
```
`player.x = 0; player.z = 0;` is already set earlier in `generateMap()` (`:1097`, before
`placePredators()`) -- confirm this line still runs **before** the reset block above so the
initial `updateStreamedChunks(true)` streams in the ring around the real spawn point (0,0),
not wherever the player was standing in the previous round. `qaBuildScene()` (`:4391-4408`,
the LUL-2328 headless-scene-build QA path) mirrors `generateMap()`'s render calls today
(`layoutTreeChunks`/`layoutCoverMeshes`) and must be updated to call the same
`bucketTreeChunks`/`bucketCoverChunks`/`bucketBogChunks`/`updateStreamedChunks(true)`
sequence, or that path silently stops exercising streaming at all. It also builds its
synthetic `treeData` directly (`:4393-4396`, `{x,z,s,cr,crCanopy,culled}`, no rng draw at
all -- this path is test-only staged geometry, not a seeded generate) -- add `rot: 0, tint:
1` (or any fixed values) to that object literal, or `layoutTreeChunks`'s per-tree read of
`t.rot`/`t.tint` (§1) hits `undefined` and writes a `NaN` transform for every QA-built tree,
silently invisible (not a thrown error) since `dummy.updateMatrix()` doesn't validate its
inputs.

### 7. QA hooks

`engine/forest-engine.js:3458-3465` (`qaProbeTreeChunks`, inside the existing `?qaHooks=1`
block, `:3320`) -- extend, don't replace, so any spec reading the old shape still gets a
`chunks`/`totalInstances`/`expected` triple, but the semantics of `chunks` change from
"chunks with any rendered trio" (== populated, since every populated chunk was always live
before this ticket) to genuinely "live" (== ring-limited). Add the populated count alongside
it so a test can distinguish the two:
```js
window.ForestEngine.qaProbeTreeChunks = function(){
  const liveTrios = treeChunkTrios.filter(Boolean);
  const populated = treeChunkBuckets.filter(b => b.length > 0).length;
  return {
    chunks: liveTrios.length,          // kept for back-compat with any existing reader
    instantiated: liveTrios.length,    // LUL-2249: explicit name matching the ticket's own e2e ask
    populated,                          // chunks with tree data, regardless of live/streamed state
    totalInstances: liveTrios.reduce((n, t) => n + t[0].count, 0),
    expected: treeData.filter(t => liveChunks.has(treeChunkIndex(t.x, t.z))).length,
  };
};
```
`expected` changes meaning too -- previously "every tree in the map" (since every chunk was
live), now "every tree in a currently-live chunk," which is what `totalInstances` should
actually equal for the invariant `e2e/chunk-streaming.spec.ts` needs (§e2e). Any existing
consumer of `qaProbeTreeChunks().expected === treeData.length` would break -- grep confirms
no e2e spec asserts that today (`qaProbeTreeChunks` is not referenced outside this file and
`docs/specs/lul-1487*` per a repo-wide grep), so this is safe.

New hook, same `?qaHooks=1` block, near `qaProbeTreeChunks`:
```js
window.ForestEngine.qaProbeChunkStreaming = function(){
  return {
    liveChunks: Array.from(liveChunks).sort((a,b) => a-b),
    coverLive: coverChunkMeshes.reduce((n, m, c) => n + (m ? 1 : 0), 0),
    bogLive: bogChunkMeshes.reduce((n, m, c) => n + (m ? 1 : 0), 0),
    playerChunk: (function(){ const [cx,cz] = chunkXZ(player.x, player.z); return cx*TREE_CHUNKS_PER_AXIS+cz; })(),
  };
};
```
Declare both in `engine/forest-engine.d.ts` next to the existing `qaProbeTreeChunks?` entry
(grep for it -- currently undeclared/untyped per LUL-2257's own note that `qaProbeTreeChunks`
"was already untyped in `forest-engine.d.ts`"; add typed declarations for both now since this
ticket is extending the contract, not just reading it).

`qaProbeBlocked(x,z)` (`:3606`, existing, unchanged signature) is the ticket's own e2e ask
("`qaProbeBlocked()` true at a live-chunk tree") -- no new hook needed, just call it at a
known live-chunk tree position after boot.

## Verification

- `npx next typegen && npx tsc --noEmit` -- no new errors.
- `npx next build` -- succeeds.
- `npx eslint .` -- clean.
- `node scripts/check-duplicate-logic.mjs && node scripts/check-elements-citations.mjs` --
  fix any `docs/ELEMENTS.md`/`docs/CUES.md` citation whose line number moved (this diff
  touches `:480-1150` and shifts most of `engine/forest-engine.js` below it).
- **Record perf before/after in the PR body.** `docs/specs/lul-2245-baseline-perf.md`'s
  `calls`/`triangles` numbers are known-broken (its own "Known limitation" section) --
  `qaProbePerf()` was fixed after that doc was written (LUL-2257, `engine/forest-engine.js:3446`)
  but the doc was never re-recorded against the fix. **Do not compare this ticket's numbers
  against LUL-2245's raw `calls`/`triangles` column** -- record a fresh "before" measurement
  on this branch's pre-streaming parent commit using today's correct `qaProbePerf()`, then an
  "after" measurement post-implementation, both at `QA_PINNED_SEED`, spawn and near-child
  (`qaTeleportNearBaby()`), desktop (1280x720) and mobile (727x393, Pixel 5 emulation, same
  method `lul-2245-baseline-perf.md` §Method describes) -- that "before" run's boot-to-
  networkidle and `calls`/`triangles` numbers are the real baseline this ticket's headline
  win is measured against, not the stale doc.
- `npx playwright test e2e/chunk-streaming.spec.ts e2e/mobile/chunk-streaming.spec.ts
  e2e/map-seed.spec.ts e2e/predator-determinism.spec.ts e2e/smoke.spec.ts
  e2e/win-persist.spec.ts e2e/death-persist.spec.ts e2e/replay --project=chromium
  --project=mobile --project=replay` locally -- green. Per founder rule 2026-09-09 this is a
  pre-PR sanity check, not the PR's verification -- the local QA tester comments
  `local-qa: PASS|FAIL @<sha>` on the PR.

## e2e

**Specs.**
- `e2e/chunk-streaming.spec.ts` (new):
  - `'25 chunks are live at spawn (fewer only at a map-corner chunk)'` -- boot at
    `QA_PINNED_SEED` (spawn is (0,0), map-centered, so the full 5x5 ring is in-bounds --
    not a corner case), call `qaProbeTreeChunks()`, assert `instantiated === 25`.
  - `'instance totals match the live chunks' own tree counts'` -- `totalInstances` equals
    the sum of `treeData` entries whose `treeChunkIndex` is in `qaProbeChunkStreaming().liveChunks`
    (computed test-side from `qaProbeMapSeed().trees`, same formula `expected` uses).
  - `'moving near the child changes the live set and disposes old far chunks'` -- record
    `qaProbeChunkStreaming().liveChunks` at spawn, call `qaTeleportNearBaby()`, wait one
    frame (or poll until the chunk-change is picked up -- `updateStreamedChunks` runs every
    `stepFrame`, so a single `page.waitForTimeout` covering >=1 frame at 60fps is enough),
    re-read `liveChunks`, assert the sets differ and that the spawn-time chunk farthest from
    the child (Chebyshev > `STREAM_UNLOAD_CHEBYSHEV`) is no longer in the new set -- **and no
    console errors** (`expectNoConsoleErrors`, `e2e/helpers.ts`).
  - `'four consecutive regenMap() calls leave no stale live chunks or GPU errors'` -- the
    ticket's named LUL-1487 GPU-lifecycle check: call `regenMap()` 4x, after each call assert
    `qaProbeTreeChunks().instantiated` is still a sane count (<=25, >0) and
    `expectNoConsoleErrors` (context-lost / disposed-geometry errors surface as console
    errors in Chromium).
  - `'qaProbeBlocked() is true at a live-chunk tree position'` -- read a tree from
    `qaProbeMapSeed().trees` inside the spawn-time live ring, assert `qaProbeBlocked(x,z)`
    (adjusted to the tree's actual `cr` -- reuse whatever adjacent spec already does this,
    e.g. the LUL-211 hide-spot probes' pattern) reports blocked.
- `e2e/mobile/chunk-streaming.spec.ts` (new) -- mirrors the first two specs above under the
  `mobile` Playwright project (`playwright.config.ts:145`, `CAMERA_FOV=85`) -- the ring is
  distance-based, not FOV-based, so the same 25-chunk assertion applies unchanged; this spec
  exists to prove that claim rather than assume it.
- **Must pass unchanged:** `e2e/map-seed.spec.ts` (byte-identical `treeData`/`baby`/
  `predators` positions per seed -- this is the spec that breaks first if §1's rng-draw move
  is wrong), `e2e/predator-determinism.spec.ts`, `e2e/smoke.spec.ts`,
  `e2e/win-persist.spec.ts`, `e2e/death-persist.spec.ts`, `e2e/replay/win.spec.ts`,
  `e2e/replay/death.spec.ts`, `e2e/mobile/win-persist.spec.ts`.

**Hooks.**
- `window.ForestEngine.qaProbeTreeChunks(): {chunks, instantiated, populated, totalInstances,
  expected}` -- extended (existing, `engine/forest-engine.js:3458`, currently untyped in
  `forest-engine.d.ts` -- add a typed declaration now), see §7.
- `window.ForestEngine.qaProbeChunkStreaming(): {liveChunks: number[], coverLive: number,
  bogLive: number, playerChunk: number}` -- new, declared in `forest-engine.d.ts`, installed
  in the `?qaHooks=1` block (`:3320` area), see §7.
- `qaTeleportNearBaby()` -- existing (`:3321`), reused unchanged.
- `qaProbeBlocked(x,z)` -- existing (`:3606`), reused unchanged.
- `regenMap()` -- existing `EngineActions` member (`lib/engine-contract.ts:15`), reused
  unchanged, called directly via `page.evaluate(() => window.ForestEngine!.regenMap!())` the
  same way other specs drive it.

**Tester scenario.** Not player-visible by design (the core loop must feel identical -- see
Constraints) -- no `shared/local-qa/requests/` file needed beyond the standard PR
`local-qa: PASS|FAIL` gate every PR already gets. If the implementer notices any visible pop-in
at the ring edge during manual testing, that's a bug against this spec (fog should hide it
per the Fix's own design point), not an expected/acceptable artifact to request a tester
scenario for.

**Not covered.** Real GPU memory measurement (this spec proves instance *counts* drop via
`qaProbeTreeChunks`, not actual VRAM freed -- Chromium/Playwright has no reliable
cross-platform VRAM probe; the `.dispose()` calls are the correctness contract, verified by
the "4x `regenMap()`, no console errors" spec instead). Visual pop-in/LOD blending at the
ring edge (fog is the design's stated mitigation, not a smooth crossfade -- if a human
reviewer sees hard pop-in in a screenshot, that's a follow-up tuning ticket on
`STREAM_RADIUS_CHUNKS`, not a gap in this spec).

## Cues

**N/A -- not a new interactive feature.** Per `decisions/0015-cue-triple`'s Scope note, the
cue-triple rule applies to "anything the player can walk up to and trigger"; this ticket is a
rendering/collision-lifecycle optimization with an explicit design goal of **zero**
player-visible behaviour change (per the parent epic's "the core loop... still feels the
same" success bar and this ticket's own "keep per-seed determinism" framing) -- there is no
new visual, audio, or explanation cue to name because nothing new is being introduced for the
player to notice. If ring pop-in ends up visible in practice despite the fog mitigation, that
is a defect against this spec (see e2e "Not covered" above), not a cue this spec should have
shipped.

## Constraints

Tier C -- `REVIEW: APPROVED` required before merge. Everything in the parent ticket's
"Must NOT change" list applies unchanged, most load-bearing for this spec specifically:

- Seed determinism: `e2e/map-seed.spec.ts` and `e2e/predator-determinism.spec.ts` must pass
  byte-identical. §1's rng-draw relocation is the single highest-risk change in this spec --
  get the draw order/count wrong and both specs fail. No other rng-draw-count change is
  introduced anywhere else in this diff (§4/§5's cover/bog chunking is pure data
  read/instancing, zero new `rng()` calls).
- `generateMap()` stream order (`:1054-1153` region) -- every existing call in this sequence
  keeps its position; this spec only changes *what* the tree/cover/bog layout calls do
  internally (bucket instead of instantiate-everything), not *when* they run relative to
  predator placement, mission pick, or cave placement.
- `CONFIG.wrapEnabled` stays `false` -- §3 flags exactly where wrap math would plug in later
  (`chunkXZ`'s clamp) without implementing it now.
- Shared `trunkGeo`/`cone1Geo`/`cone2Geo`/`trunkMat`/`foliageMat`/`logGeo`/`rockGeo`/
  `brambleGeo`/`reedGeo`/`logMat`/`rockMat`/`brambleMat`/`reedMat` are never disposed by any
  `dropChunk`/`dropCoverChunk`/`dropBogChunk` call -- only the per-chunk `InstancedMesh`
  wrapper objects are.
- Fixed geography (`LANDMARKS`, `ROOSTS`, `CAVE`, `CONFIG.lake`, `CONFIG.home`,
  `BOG_CENTER`/radii, 800x800 ground plane) stays always-live, untouched by streaming --
  confirmed none of §1-§7 above touches `placeLandmarks()`, the lake/home meshes, or the
  ground plane.
- Camera `far` stays 400 (`:321`, unchanged) -- fog does the ring-edge hiding, not a reduced
  draw distance.
- `SNIFF_IMMUNITY_TIME`, `shouldGiveUpChase()`, `DIFFICULTY_PRESETS` semantics -- untouched;
  this spec makes no predator-AI change (predator movement/collision reads the unchanged
  whole-map `grid`, per §2b).
- Win rule (`arriveHome()`, `lib/game/outcome.ts`) and LUL-1081 end-screen persistence --
  untouched; no state-machine change anywhere in this diff.

## Out of scope

- Chunking the collision grid for trees/landmarks (`grid`, as opposed to `coverGrid`) -- §2b
  explains why: predators roam the whole map and need whole-map collision regardless of what
  has visually streamed in. Only rendered meshes (trees, cover, bog trees) and the
  cover-specific collision grid (§4, genuinely cheap to chunk) stream.
- Whole-map predator spawn -- step 6 of the parent epic (LUL-2223 child 6/6), explicitly
  depends on this ticket landing first per the epic's own sequencing, not part of this diff.
- `CONFIG.wrapEnabled = true` / actual seam-walk support -- §3 names the one call site
  (`chunkXZ`'s clamp) that would need `wrapCellIndex()` if this ever flips; not implemented
  here, per the parent epic's constraint that `wrapEnabled` stays `false`.
- Landmark/lake/home/cave/throwable-pool streaming -- explicitly named always-live in the
  ticket (they're tiny -- 6 landmarks, 1 lake, 1 home, 0-1 cave, 90 throwables) and confirmed
  cheap enough that streaming them would add lifecycle complexity for no measurable win.
- Smooth LOD/crossfade at the ring edge -- fog is the stated mitigation (ticket: "Camera far
  stays 400; fog does the hiding"), not a blend; see e2e "Not covered."
- Adjustable `STREAM_RADIUS_CHUNKS`/`STREAM_UNLOAD_CHEBYSHEV` (settings, difficulty-based
  tuning, etc.) -- fixed constants per the ticket's own numbers, not exposed anywhere new.

**Note for the implementer, not a task:** at `?qaWorld=micro` (`CONFIG.mapSize=96` ->
`TREE_CHUNKS_PER_AXIS = ceil(96/60) = 2`, 4 chunks total), the 5x5 wanted-ring clamps to all
4 existing chunk indices from any player position -- every chunk is always "live" in the
micro preset, so streaming is a no-op there by construction, not a special case to code
around. `e2e/qa-world-micro.spec.ts` needs no changes for this reason (confirmed by reading
it -- it asserts `qaProbeMapSeed`/`qaProbeMemory`/`qaProbeTreeChunks().totalInstances` under
`qaNoRender`, none of which this spec's semantics changes for that mode).
