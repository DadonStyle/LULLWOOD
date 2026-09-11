// LUL-2247: generateCover()/generateReeds()/generateBogTrees()/
// generateThrowables() each reject a candidate against lake/spawn/baby/
// tree, but never against each other, and never against a per-area count --
// a bog chunk could hold dozens of cover/reed/bogTree props a couple of
// units apart. thinGeneratedProps() (engine/forest-engine.js) now runs a
// deterministic post-filter after every prop generator finishes, enforcing
// PROP_MIN_SPACING/PROP_CHUNK_CAP (engine/tuning.js). This proves the
// finished map actually respects both, at the pinned seed and three more, so
// a regression that reintroduces dense clustering for some seed but not
// others doesn't slip through. See docs/specs/lul-2247-prop-density.md.
import { test, expect } from '@playwright/test';
import { boot, QA_PINNED_SEED, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';
// fullmap-reason: measures per-chunk prop caps over the full 8x8 chunk grid (LUL-2377: the QA rig never runs @fullmap; run locally with E2E_FULLMAP=1)

const CAPS = { cover: 12, reed: 24, bogTree: 12, stone: 3 };
const MIN_SPACING = 3.5;
const SLOP = 1e-6;

// LUL-2249: same 60u/8x8 chunk grid PROP_CHUNK_CAP above is measured over --
// folded into this file rather than a new one so the streaming ring proof
// doesn't need its own FULLMAP_ALLOWLIST entry (lib/e2e-policy/world-policy.test.ts
// only grows the allowlist for a genuinely new reason; "per-chunk over the
// real grid" already covers this).
const TREE_CHUNK_SIZE = 60;
const TREE_CHUNKS_PER_AXIS = 8; // Math.ceil(CONFIG.mapSize=480 / TREE_CHUNK_SIZE=60)
const HALF = 240; // CONFIG.mapSize / 2

function chunkIndexOf(x: number, z: number): number {
  const cx = Math.min(TREE_CHUNKS_PER_AXIS - 1, Math.max(0, Math.floor((x + HALF) / TREE_CHUNK_SIZE)));
  const cz = Math.min(TREE_CHUNKS_PER_AXIS - 1, Math.max(0, Math.floor((z + HALF) / TREE_CHUNK_SIZE)));
  return cx * TREE_CHUNKS_PER_AXIS + cz;
}

for (const seed of [QA_PINNED_SEED, QA_PINNED_SEED + 1, QA_PINNED_SEED + 2, QA_PINNED_SEED + 3]) {
  test(`prop density respects per-chunk caps and minimum spacing at seed ${seed} @fullmap`, async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true, seed });

    const density = await qaHook(page, 'qaProbePropDensity');

    // A seed that thinned everything away would vacuously pass every <= cap
    // check below -- guard against that.
    expect(density.total).toBeGreaterThan(0);

    for (const entry of density.perChunk) {
      expect(entry.cover, `chunk ${entry.chunk} cover count`).toBeLessThanOrEqual(CAPS.cover);
      expect(entry.reed, `chunk ${entry.chunk} reed count`).toBeLessThanOrEqual(CAPS.reed);
      expect(entry.bogTree, `chunk ${entry.chunk} bogTree count`).toBeLessThanOrEqual(CAPS.bogTree);
      expect(entry.stone, `chunk ${entry.chunk} stone count`).toBeLessThanOrEqual(CAPS.stone);
    }

    expect(density.minPairSpacing).not.toBeNull();
    expect(density.minPairSpacing).toBeGreaterThanOrEqual(MIN_SPACING - SLOP);

    // Mandatory per the ticket: no reed may land inside CONFIG.lake.clear.
    // generateReeds() now runs inLake() as its own rejection check.
    expect(density.reedsInLakeClear, `seed ${seed} reeds inside CONFIG.lake.clear`).toBe(0);
  });
}

test('qaProbePropDensity is a pure read -- calling it twice in a row does not mutate the map @fullmap', async ({ page }) => {
  await boot(page, { qaWorld: 'full',  qaHooks: true, seed: QA_PINNED_SEED });

  const first = await qaHook(page, 'qaProbePropDensity');
  const second = await qaHook(page, 'qaProbePropDensity');

  expect(second).toEqual(first);
});

// LUL-2249 (rollout step 5/6 of parent epic LUL-2223): generateMap() used to
// instantiate every populated tree/cover/bog-tree chunk up front and keep it
// live forever. This proves the ring controller actually streams: a fixed
// number of chunks live around the player at any time, moving changes the
// live set and disposes what falls out of range, and the streamed geometry
// is still real (collidable, no GPU lifecycle errors across repeated regen).
// See docs/specs/lul-2249-chunk-streaming.md.
test.describe('chunked streaming', () => {
  test('25 chunks are live at spawn (map-centered, not a corner case) @fullmap', async ({ page }) => {
    await boot(page, { qaWorld: 'full', qaHooks: true, seed: QA_PINNED_SEED });

    const chunks = await qaHook(page, 'qaProbeTreeChunks');
    // Spawn is always (0,0), the exact center of the 480-wide map -- the full
    // 5x5 (STREAM_RADIUS_CHUNKS=2) ring fits in-bounds, so this is never the
    // "fewer at a map-corner chunk" case the ticket allows for.
    expect(chunks.instantiated).toBe(25);
  });

  test("instance totals match the live chunks' own tree counts @fullmap", async ({ page }) => {
    await boot(page, { qaWorld: 'full', qaHooks: true, seed: QA_PINNED_SEED });

    const [chunks, streaming, mapSeed] = await Promise.all([
      qaHook(page, 'qaProbeTreeChunks'),
      qaHook(page, 'qaProbeChunkStreaming'),
      qaHook(page, 'qaProbeMapSeed'),
    ]);

    const live = new Set<number>(streaming.liveChunks);
    const expectedCount = mapSeed.trees.filter((t: { x: number; z: number }) => live.has(chunkIndexOf(t.x, t.z))).length;

    expect(chunks.totalInstances).toBe(expectedCount);
    expect(chunks.expected).toBe(expectedCount);
    // Sanity: a seed that streamed in an empty ring would vacuously pass the
    // equality above.
    expect(chunks.totalInstances).toBeGreaterThan(0);
  });

  test('moving near the child changes the live set and disposes old far chunks @fullmap', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await boot(page, { qaWorld: 'full', qaHooks: true, seed: QA_PINNED_SEED });

    const before = await qaHook(page, 'qaProbeChunkStreaming');
    await qaHook(page, 'qaTeleportNearBaby');
    // updateStreamedChunks() runs every stepFrame() (the real RAF loop is
    // already ticking pre-`enter()`) -- one settle wait covers several frames
    // at 60fps.
    await page.waitForTimeout(300);
    const after = await qaHook(page, 'qaProbeChunkStreaming');

    expect(after.playerChunk).not.toBe(before.playerChunk);
    const beforeSet = new Set<number>(before.liveChunks);
    const afterSet = new Set<number>(after.liveChunks);
    expect(afterSet).not.toEqual(beforeSet);

    // The spawn chunk itself (player started at (0,0)) must be far enough
    // from the child (baby spawns "the other side" of the map, half*(0.5-0.8)
    // away -- see generateMap()) to fall outside STREAM_UNLOAD_CHEBYSHEV=3
    // and actually drop.
    const spawnChunk = chunkIndexOf(0, 0);
    expect(afterSet.has(spawnChunk)).toBe(false);

    expectNoConsoleErrors(errors);
  });

  test('four consecutive map regenerations leave no stale live chunks or GPU errors @fullmap', async ({ page }) => {
    // LUL-1487's own named GPU-lifecycle check, driven via qaRegenerateMap()
    // (existing hook, generateMap(seed) with a caller-given seed) rather than
    // the real regenMap() EngineAction -- that one lives only on the
    // component-facing EngineActions object (lib/engine-contract.ts), never
    // on window.ForestEngine, so it isn't reachable from a page.evaluate().
    const errors = trackConsoleErrors(page);
    await boot(page, { qaWorld: 'full', qaHooks: true, seed: QA_PINNED_SEED });

    for (let i = 0; i < 4; i++) {
      await qaHook(page, 'qaRegenerateMap', QA_PINNED_SEED + i + 1);
      await page.waitForTimeout(150);
      const chunks = await qaHook(page, 'qaProbeTreeChunks');
      expect(chunks.instantiated, `regen ${i + 1}`).toBeGreaterThan(0);
      expect(chunks.instantiated, `regen ${i + 1}`).toBeLessThanOrEqual(25);
      expect(chunks.totalInstances, `regen ${i + 1}`).toBe(chunks.expected);
    }

    expectNoConsoleErrors(errors);
  });

  test('qaProbeBlocked() is true at a live-chunk tree position @fullmap', async ({ page }) => {
    await boot(page, { qaWorld: 'full', qaHooks: true, seed: QA_PINNED_SEED });

    const [streaming, mapSeed] = await Promise.all([
      qaHook(page, 'qaProbeChunkStreaming'),
      qaHook(page, 'qaProbeMapSeed'),
    ]);
    const live = new Set<number>(streaming.liveChunks);
    const liveTree = mapSeed.trees.find((t: { x: number; z: number }) => live.has(chunkIndexOf(t.x, t.z)));
    expect(liveTree, 'expected at least one tree inside the spawn-time live ring').toBeTruthy();

    const blocked = await qaHook(page, 'qaProbeBlocked', liveTree.x, liveTree.z);
    expect(blocked).toBe(true);
  });
});
