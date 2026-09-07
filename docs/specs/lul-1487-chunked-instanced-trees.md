# SPEC — LUL-1487: E6, chunked InstancedMesh + frustumCulled=true for the main forest

Tier: **C** (`engine/forest-engine.js` — rendering/simulation setup). Blocking review
required (`REVIEW: APPROVED` before merge).

Plan source: wiki `specs/bigger-wrapping-world-e2-e6` §E6. Research source (do not
re-derive): `~/.paperclip/shared/specs/mobile-ui-and-world.md` §5. Depends on E3
(LUL-1484, merged as `ea2e753`/PR #395 — `CONFIG.mapSize=480`, `CONFIG.trees=5200`).
This spec confirms current line numbers against `release/next` HEAD `70967dc`
(§5's own citations — `:377,:390,:419` — predate E3's growth and have drifted; the
line numbers below are read fresh off `70967dc`, not the ticket's).

## Scope — read before deviating

**In scope: the main forest tree pool only** (`treeData`, currently 5200 trees, the
`const parts = [...]` trio at `:423-428`). This is by far the largest pool (5200 vs.
360 bog trees, 880 cover props) and is what §5.0's "1300 trees" (pre-E3 figure)
literally refers to.

**Out of scope, deliberately — do not chunk these in this ticket:**
- `bogParts` (bog tree trio, `:435-440`, sized `BOG_TREES`=360) — an order of
  magnitude smaller pool, already spatially concentrated in bog regions (not spread
  over the full map), so the frustum-culling win is much smaller per chunk-management
  complexity added. Leave `frustumCulled = false` at `:440` untouched.
- `coverMeshes` (log/rock/bramble/reed, `:461-467`, sized `COVER_PROPS`=880) — same
  reasoning, plus `layoutCoverMeshes()` (`:611-630`) is shared machinery with reeds
  that this ticket must not disturb. Leave `frustumCulled = false` at `:467` untouched.

If the measured before/after numbers (below) come back flat and a reviewer wants the
bog/cover pools chunked too, that is a follow-up ticket, not scope creep on this one.

## Files

- `engine/forest-engine.js` — one new module-scope helper section, one function
  rewrite of the call site, no other file touched.

## The change

### 1. Remove the monolithic `parts` block

Delete `:423-428`:
```js
const parts = [
  new THREE.InstancedMesh(trunkGeo, trunkMat,   CONFIG.trees),
  new THREE.InstancedMesh(cone1Geo, foliageMat, CONFIG.trees),
  new THREE.InstancedMesh(cone2Geo, foliageMat, CONFIG.trees),
];
parts.forEach(p => { p.frustumCulled = false; scene.add(p); });
```
`trunkGeo`/`cone1Geo`/`cone2Geo` (`:386-388`) and `trunkMat`/`foliageMat` (`:420-421`)
stay exactly as they are — every chunk mesh below instances the same shared
geometry/material objects, only the per-chunk `InstancedMesh` wrapper and its
`instanceMatrix`/`instanceColor` buffers are new per chunk.

### 2. Add chunk state + the two new functions, next to `layoutTreePool` (`:640-657`)

`half` (`:188`, `= CONFIG.mapSize / 2`) and `dummy`/`tintCol` (`:487-488`) are already
in scope everywhere in this file — no new imports.

```js
// ---- E6: chunk the main forest pool so three.js can frustum-cull whole chunks ----
// FogExp2 (density 0.04) already hides anything past ~40-60 units; the old single
// map-spanning InstancedMesh submitted all 5200 trees every frame regardless
// (frustumCulled=false, because a single mesh spanning the whole map is *always*
// at least partly in view, so per-mesh culling was never an option before this).
// Chunking lets the renderer skip whole chunks that are outside the view frustum
// for free -- no new per-frame code, exactly the win the ticket asks for.
const TREE_CHUNK_SIZE = 60;   // world units/edge; CONFIG.mapSize=480 -> 8x8 = 64 chunks
const TREE_CHUNKS_PER_AXIS = Math.ceil(CONFIG.mapSize / TREE_CHUNK_SIZE);

function treeChunkIndex(x, z){
  const cx = Math.min(TREE_CHUNKS_PER_AXIS-1, Math.max(0, Math.floor((x+half)/TREE_CHUNK_SIZE)));
  const cz = Math.min(TREE_CHUNKS_PER_AXIS-1, Math.max(0, Math.floor((z+half)/TREE_CHUNK_SIZE)));
  return cx*TREE_CHUNKS_PER_AXIS + cz;
}

// Sparse array indexed by chunk id; each populated entry is [trunk, cone1, cone2]
// for that chunk, or absent/undefined for a chunk with zero trees in it.
let treeChunkTrios = [];

function layoutTreeChunks(data){
  // Regenerate on every generateMap() call (restart/new seed draws a different
  // tree count and placement per chunk) -- dispose the previous chunk meshes'
  // own instanceMatrix/instanceColor GPU buffers via .dispose() before dropping
  // the reference. Do NOT call .geometry.dispose() or .material.dispose() here:
  // trunkGeo/cone1Geo/cone2Geo/trunkMat/foliageMat are shared with every other
  // chunk AND with bogParts -- disposing them would break the bog tree pool.
  for(const trio of treeChunkTrios){
    if(!trio) continue;
    for(const m of trio){ scene.remove(m); m.dispose(); }
  }
  treeChunkTrios = [];

  const nChunks = TREE_CHUNKS_PER_AXIS * TREE_CHUNKS_PER_AXIS;
  const buckets = Array.from({length: nChunks}, () => []);
  // Bucketing reads only t.x/t.z, already fixed in `data` before this runs --
  // no rng() draw here, so this cannot perturb the seeded stream.
  for(let i=0; i<data.length; i++) buckets[treeChunkIndex(data[i].x, data[i].z)].push(i);

  const localIndex = new Array(data.length);
  for(let c=0; c<nChunks; c++) buckets[c].forEach((treeIdx, slot) => { localIndex[treeIdx] = slot; });

  for(let c=0; c<nChunks; c++){
    const count = buckets[c].length;
    if(count === 0) continue;
    const trio = [
      new THREE.InstancedMesh(trunkGeo, trunkMat,   count),
      new THREE.InstancedMesh(cone1Geo, foliageMat, count),
      new THREE.InstancedMesh(cone2Geo, foliageMat, count),
    ];
    // frustumCulled left at the Object3D default (true) -- this is the whole point.
    trio.forEach(m => scene.add(m));
    treeChunkTrios[c] = trio;
  }

  // Same rng() draw, same order (tree index 0..data.length-1), same count as the
  // old layoutTreePool loop -- only the destination mesh/slot differs, and that's
  // decided above from x/z alone. This is why NO QA_PINNED_SEED re-pin is needed:
  // the RNG stream this produces is byte-identical to before this ticket.
  for(let i=0; i<data.length; i++){
    const t = data[i];
    dummy.position.set(t.x, 0, t.z);
    dummy.rotation.set(0, rng()*Math.PI*2, 0);
    dummy.scale.setScalar(t.s);
    dummy.updateMatrix();
    const trio = treeChunkTrios[treeChunkIndex(t.x, t.z)];
    const slot = localIndex[i];
    for(const p of trio) p.setMatrixAt(slot, dummy.matrix);
    const b = 0.72 + rng()*0.5;
    tintCol.setRGB(b*0.92, b, b*0.86);
    trio[1].setColorAt(slot, tintCol); trio[2].setColorAt(slot, tintCol);
  }

  for(const trio of treeChunkTrios){
    if(!trio) continue;
    for(const m of trio){
      m.instanceMatrix.needsUpdate = true;
      if(m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();   // static after layout -- compute once, not per frame
    }
  }
}
```

`layoutTreePool` itself (`:640-657`) is untouched — `generateBogTrees()`
(`:664-679`) still calls it unchanged for `bogParts`/`bogTreeData`/`BOG_TREES`.

### 3. Change the call site in `generateMap()` (`:748`)

```js
// before
layoutTreePool(parts, treeData, CONFIG.trees);
// after
layoutTreeChunks(treeData);
```

No other line in `generateMap()` changes. No padding/dead-instance logic is needed
in the new path (unlike the old fixed-capacity `parts`, each chunk mesh is sized to
its exact tree count — no unused slots to hide off-screen).

### 4. Optional, cheap self-check hook — add next to `qaProbePerf` (`:2404-2411`)

Not required for the ticket's bar, but the fastest way to catch a bucketing bug
(e.g. a tree silently dropped, or double-counted across chunks) without a visual
diff:
```js
window.ForestEngine.qaProbeTreeChunks = function(){
  const trios = treeChunkTrios.filter(Boolean);
  return {
    chunks: trios.length,
    totalInstances: trios.reduce((n, t) => n + t[0].count, 0),
    expected: treeData.length,
  };
};
```
`totalInstances` must equal `expected` (and `treeData.length`) exactly after every
`generateMap()` call. If you add this, verify it once and leave it — it costs
nothing at runtime (never called outside a manual QA probe).

## What must NOT change

- `trunkGeo`/`cone1Geo`/`cone2Geo`/`trunkMat`/`foliageMat` — shared as-is, never
  disposed, never duplicated.
- `bogParts` and `coverMeshes` — untouched, still `frustumCulled = false`, still the
  single fixed-capacity pools they are today. Out of scope (see above).
- `layoutTreePool` — untouched, still used by `generateBogTrees()`.
- The RNG draw order/count inside the per-tree loop — one `rng()*Math.PI*2`
  (rotation) then one `rng()` (brightness) per tree, in tree-index order — must
  stay identical to the current `layoutTreePool` body. Reordering the two draws,
  or drawing per-chunk instead of per-tree-index, changes every seed's visual
  layout even though total draw count wouldn't change.
- Camera `far`, star shell `r`, ground plane geometry — none of this ticket's
  business; not touched.
- `qaProbeMapSeed()` (`:2417-2425`) reads tree positions from `treeData` directly,
  not from any mesh — already compatible with this change, no edit needed. Confirm
  this stays true rather than re-deriving it.

## Determinism

**No RNG stream change, and no `QA_PINNED_SEED` re-pin needed** — this is the
opposite situation from E2/E3. Chunk assignment is a pure function of each tree's
already-fixed `x`/`z` and consumes no rng() draws; the per-tree rng() draws
(rotation, brightness) still happen exactly once per tree, in the same 0..N-1 order,
regardless of which chunk mesh receives the result. State this explicitly in the PR
body as a positive determinism claim, then prove it: `e2e/map-seed.spec.ts` must
pass with **zero changes**, since `dumpMapSeed()`/`qaProbeMapSeed()` reads
`treeData` (the source array, itself untouched), not any mesh.

## GPU resource lifecycle — the trap in this ticket

The old `parts` trio was created **once** at module load and reused (re-filled via
`setMatrixAt`) on every `generateMap()` call (restart, `regenMap()`), so it never
leaked. The chunked design creates **new** `InstancedMesh` objects on every
`generateMap()` call, each with its own `instanceMatrix`/`instanceColor`
`BufferAttribute` holding a real WebGL buffer. If the old chunk meshes are only
`scene.remove()`d and not `.dispose()`d, every restart leaks up to 5200
instances-worth of GPU buffers. `layoutTreeChunks()` above calls `m.dispose()` on
every mesh in the outgoing `treeChunkTrios` before replacing it — **do not drop
that call**, and do not "simplify" it to a geometry/material dispose (see "must not
change" above, it would break the shared bog-tree pool).

Manually verify: call `regenMap()` (or restart) 3-4 times via `qaHooks` and confirm
no console warning/error appears and memory does not visibbly climb
(`performance.memory` if available under Chromium, or just confirm no WebGL
context-loss/warning in the console-error tracker `e2e/helpers.ts` already attaches).

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm test` — green. This touches no `lib/game/*.ts`, so no test file should need
   editing.
3. `npx playwright test` — green, **with zero spec edits**, in particular
   `e2e/map-seed.spec.ts` (see Determinism above — if this needs an edit to pass,
   something in the implementation deviated from this spec; report it, don't force
   it green).
4. `node scripts/check-elements-citations.mjs` — run `--fix` first if line numbers
   shifted; hand-fix any single-line citation it can't auto-correct.
5. `node scripts/check-duplicate-logic.mjs` — clean; this diff adds no new
   top-level engine declaration name that collides with a `lib/game/*` export
   (`treeChunkIndex`, `layoutTreeChunks`, `treeChunkTrios`, `TREE_CHUNK_SIZE`,
   `TREE_CHUNKS_PER_AXIS` are all new names — confirm none collides).
6. **Before/after `qaProbePerf()` at a fixed seed, in the PR body — this is the bar
   the ticket exists to clear.** Boot `?seed=20260718&qaHooks=1` (same seed
   `docs/specs/lul-1484-grow-map.md` used for E3's baseline), wait ~10s, call
   `window.ForestEngine.qaProbePerf()`. Capture this **on `release/next` HEAD
   before this diff** (the true current baseline — the E3 PR body did not actually
   record numeric `qaProbePerf()` figures despite its spec asking for them; do not
   assume a prior number, measure fresh) and again after, at the same camera
   position (spawn, `player.x=0,z=0`, default yaw/pitch — `generateMap()` sets
   this, don't move the camera between the two captures). Record both raw objects
   in the PR body.
   - If `calls`/`triangles` drop: real win, say by how much.
   - If they don't move: valid result per §5.0's own prediction (frame cost
     dominated by lights/post-chain/predator meshes, none of which this touches) —
     state that plainly and close it; do not tune chunk size to force a number.
   - Either way, also try one non-spawn vantage point (e.g. teleport via
     `qaHooks` to a corner, facing across the map) where more chunks should be
     behind/beside the camera — this is the condition most likely to show the
     culling win if spawn's default view doesn't.
7. If you added `qaProbeTreeChunks()` (step 4 above): call it once after boot,
   confirm `totalInstances === expected`.
8. Gameplay/visual verdict (does the forest still look the same, no chunk seams,
   no popping trees at chunk boundaries under normal fog) is **unverified by this
   spec** — no interactive browser in the Founding Engineer's environment, and
   Game Tester is currently paused. State this explicitly in the handoff.

## Out of scope

- Chunking `bogParts`/`coverMeshes` (see Scope above).
- The follow-on optimisation targets §5.0 already identifies if numbers come back
  flat (11 forward lights, the 9-pass `renderPost()` chain, ~264 predator meshes)
  — file these as their own tickets per the parent ticket's instruction, do not
  fold them into this diff.
- Any change to `layoutTreePool`, `generateBogTrees()`, `generateReeds()`,
  `layoutCoverMeshes()`.

## PR body must state

- `Tier: C — engine/forest-engine.js`
- The determinism claim (no RNG reshuffle, no re-pin) and that Playwright proves it
  with zero spec edits
- The `.dispose()` GPU-lifecycle fix and why it's necessary (see above)
- Before/after `qaProbePerf()` numbers at `?seed=20260718`, at spawn and at one
  off-spawn vantage point, or the explicit "flat, as predicted by §5.0" statement
- "Builds clean; gameplay/visual verdict unverified — no browser in this
  environment, Game Tester currently paused."
