// LUL-2249 (rollout step 5/6 of parent epic LUL-2223): generateMap() used to
// instantiate every populated tree/cover/bog-tree chunk up front and keep it
// live forever (LUL-1487's own chunking only cut draw calls via per-mesh
// frustum culling, never memory/instantiation cost). This proves the ring
// controller actually streams: a fixed number of chunks live around the
// player at any time, moving changes the live set and disposes what falls
// out of range, and the streamed geometry is still real (collidable, no GPU
// lifecycle errors across repeated regen). See docs/specs/lul-2249-chunk-streaming.md.
//
// @fullmap: this spec's entire premise is the real 8x8 (TREE_CHUNKS_PER_AXIS)
// chunk grid the full 480-wide map produces -- at `?qaWorld=micro`
// (mapSize=96, 2x2=4 chunks total) the 5x5 wanted-ring clamps to every chunk
// unconditionally, so streaming is a no-op by construction there (see the
// spec's own "Note for the implementer"). There is no smaller world this can
// be tested against.
import { test, expect } from '@playwright/test';
import { boot, qaHook, QA_PINNED_SEED, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

const TREE_CHUNK_SIZE = 60;
const TREE_CHUNKS_PER_AXIS = 8; // Math.ceil(CONFIG.mapSize=480 / TREE_CHUNK_SIZE=60)
const HALF = 240; // CONFIG.mapSize / 2

function chunkIndexOf(x: number, z: number): number {
  const cx = Math.min(TREE_CHUNKS_PER_AXIS - 1, Math.max(0, Math.floor((x + HALF) / TREE_CHUNK_SIZE)));
  const cz = Math.min(TREE_CHUNKS_PER_AXIS - 1, Math.max(0, Math.floor((z + HALF) / TREE_CHUNK_SIZE)));
  return cx * TREE_CHUNKS_PER_AXIS + cz;
}

test.describe('chunked streaming @fullmap', () => {
  test('25 chunks are live at spawn (map-centered, not a corner case)', async ({ page }) => {
    await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });

    const chunks = await qaHook(page, 'qaProbeTreeChunks');
    // Spawn is always (0,0), the exact center of the 480-wide map -- the full
    // 5x5 (STREAM_RADIUS_CHUNKS=2) ring fits in-bounds, so this is never the
    // "fewer at a map-corner chunk" case the ticket allows for.
    expect(chunks.instantiated).toBe(25);
  });

  test("instance totals match the live chunks' own tree counts", async ({ page }) => {
    await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });

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

  test('moving near the child changes the live set and disposes old far chunks', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });

    const before = await qaHook(page, 'qaProbeChunkStreaming');
    await qaHook(page, 'qaTeleportNearBaby');
    // updateStreamedChunks() runs every stepFrame() (the real RAF loop is
    // already ticking pre-`enter()`) -- one settle wait covers several frames
    // at 60fps, same margin qa-world-micro.spec.ts uses for "let a couple of
    // real frames render".
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

  test('four consecutive map regenerations leave no stale live chunks or GPU errors', async ({ page }) => {
    // LUL-1487's own named GPU-lifecycle check, driven via qaRegenerateMap()
    // (existing hook, generateMap(seed) with a caller-given seed) rather than
    // the real regenMap() EngineAction -- that one lives only on the
    // component-facing EngineActions object (lib/engine-contract.ts), never
    // on window.ForestEngine, so it isn't reachable from a page.evaluate() at
    // all. qaRegenerateMap() exercises the exact same generateMap() reset
    // path this ticket's streaming hand-off runs through.
    const errors = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });

    // Sequential, not Promise.all -- each regen must fully settle (and its
    // own chunk-lifecycle assertions run) before the next one fires.
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

  test('qaProbeBlocked() is true at a live-chunk tree position', async ({ page }) => {
    await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });

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
