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
import { boot, enter, QA_PINNED_SEED, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';
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

function chunkXZOf(x: number, z: number): [number, number] {
  const cx = Math.min(TREE_CHUNKS_PER_AXIS - 1, Math.max(0, Math.floor((x + HALF) / TREE_CHUNK_SIZE)));
  const cz = Math.min(TREE_CHUNKS_PER_AXIS - 1, Math.max(0, Math.floor((z + HALF) / TREE_CHUNK_SIZE)));
  return [cx, cz];
}

// LUL-2250: same load radius placePredators()/tick() park predators outside of.
const STREAM_RADIUS_CHUNKS = 2;

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

  test('moving far from spawn changes the live set and disposes old far chunks @fullmap', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await boot(page, { qaWorld: 'full', qaHooks: true, seed: QA_PINNED_SEED });

    const before = await qaHook(page, 'qaProbeChunkStreaming');
    // Not qaTeleportNearBaby(): the child spawns at a random angle, half*(0.5-0.8)
    // from spawn (see generateMap()) -- for plenty of angles that lands well
    // inside STREAM_UNLOAD_CHEBYSHEV=3 of the spawn chunk (found live: this
    // exact flake on the QA_PINNED_SEED baby position). Chunk (0,0) is the one
    // corner guaranteed >3 chunks (index 4, the spawn chunk's row/col, is only
    // 3 chunks from the far edge (index 7) but 4 from the near edge (index 0)
    // on this 8x8 grid) from the spawn chunk regardless of seed.
    await qaHook(page, 'qaTeleportTo', -HALF + 5, -HALF + 5);
    // updateStreamedChunks() runs every stepFrame() (the real RAF loop is
    // already ticking pre-`enter()`) -- one settle wait covers several frames
    // at 60fps.
    await page.waitForTimeout(300);
    const after = await qaHook(page, 'qaProbeChunkStreaming');

    expect(after.playerChunk).not.toBe(before.playerChunk);
    const beforeSet = new Set<number>(before.liveChunks);
    const afterSet = new Set<number>(after.liveChunks);
    expect(afterSet).not.toEqual(beforeSet);

    // The spawn chunk itself (player started at (0,0)) must have dropped.
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

  // LUL-2250 (rollout step 6/6 of parent epic LUL-2223): placePredators() now
  // draws uniformly over the whole map instead of a fixed annulus, and a
  // predator outside the live streaming ring is `parked` -- not simulated,
  // not visible, forgotten. See docs/specs/lul-2250-predator-spawn-park-hunter.md.
  test('predators spawn uniformly whole-map and outside the ring start parked @fullmap', async ({ page }) => {
    await boot(page, { qaWorld: 'full', qaHooks: true, seed: QA_PINNED_SEED });

    const streaming = await qaHook(page, 'qaProbeChunkStreaming');
    const pcx = Math.floor(streaming.playerChunk / TREE_CHUNKS_PER_AXIS);
    const pcz = streaming.playerChunk % TREE_CHUNKS_PER_AXIS;

    let sawParked = false, sawActive = false;
    for (let i = 0; i < 9; i++) {
      const p = await qaHook(page, 'qaPredatorState', i);
      if (!p) continue;
      const [ccx, ccz] = chunkXZOf(p.x, p.z);
      const cheb = Math.max(Math.abs(ccx - pcx), Math.abs(ccz - pcz));
      const expectedParked = cheb > STREAM_RADIUS_CHUNKS;
      expect(p.parked, `predator ${i} parked`).toBe(expectedParked);
      expect(p.visible, `predator ${i} visible`).toBe(!expectedParked);
      if (expectedParked) sawParked = true; else sawActive = true;
    }
    // Whole-map draw means most of the 9 spawn outside the 39%-of-map ring --
    // guard against a seed/regression where the parked/active split degenerates.
    expect(sawParked, 'expected at least one parked predator at spawn').toBe(true);
    expect(sawActive, 'expected at least one active predator at spawn').toBe(true);
  });

  for (const seed of [QA_PINNED_SEED, QA_PINNED_SEED + 1, QA_PINNED_SEED + 2]) {
    test(`the child-carry pickup point puts at least one predator in the ring, matching an off-annulus spawn at seed ${seed} @fullmap`, async ({ page }) => {
      await boot(page, { qaWorld: 'full', qaHooks: true, seed });

      const streaming = await qaHook(page, 'qaProbeChunkStreaming');
      expect(streaming.liveChunks.length).toBeGreaterThan(0);

      let sawActive = false;
      for (let i = 0; i < 9 && !sawActive; i++) {
        const p = await qaHook(page, 'qaPredatorState', i);
        if (p && !p.parked) sawActive = true;
      }
      expect(sawActive, `seed ${seed}: expected at least one non-parked predator at spawn`).toBe(true);
    });
  }

  test('unparking on approach and re-parking on retreat toggles visible+parked @fullmap', async ({ page }) => {
    await boot(page, { qaWorld: 'full', qaHooks: true, seed: QA_PINNED_SEED });

    // Find a predator parked at spawn (player at (0,0)) to walk up to.
    let target: { idx: number; x: number; z: number } | null = null;
    for (let i = 0; i < 9; i++) {
      const p = await qaHook(page, 'qaPredatorState', i);
      if (p && p.parked) { target = { idx: i, x: p.x, z: p.z }; break; }
    }
    expect(target, 'expected at least one parked predator at spawn to test unparking on').toBeTruthy();

    const FIXED_DT = 0.02;
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await enter(page);

    // Teleport into the same chunk as the target predator (well within the ring).
    await qaHook(page, 'qaTeleportTo', target!.x, target!.z);
    await qaHook(page, 'qaAdvance', 5); // a few ticks is enough for the per-tick recompute to fire

    const near = await qaHook(page, 'qaPredatorState', target!.idx);
    expect(near.parked, 'expected target to unpark once the player is in its chunk').toBe(false);
    expect(near.visible, 'expected target to become visible once unparked').toBe(true);

    // Retreat back to spawn -- far enough that the target re-parks.
    await qaHook(page, 'qaTeleportTo', 0, 0);
    await qaHook(page, 'qaAdvance', 5);

    const far = await qaHook(page, 'qaPredatorState', target!.idx);
    expect(far.parked, 'expected target to re-park once the player retreats').toBe(true);
    expect(far.visible, 'expected target to become invisible once re-parked').toBe(false);
    expect(far.state, 'expected the park transition to reset state to roam ("forgets you")').toBe('roam');
  });

  test('hunter guarantee relocates a parked predator when fewer than 2 are active @fullmap', async ({ page }) => {
    await boot(page, { qaWorld: 'full', qaHooks: true, seed: QA_PINNED_SEED });

    const FIXED_DT = 0.02;
    const HUNTER_GUARANTEE_T = 90;
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await enter(page);

    // Search every chunk on the 8x8 grid for the one whose 5x5 ring covers
    // the fewest of the 9 predators' spawn-time positions, then stand there --
    // this is deterministic (positions don't change pre-`playing`... but we're
    // already `entered` here, so read positions fresh right before searching)
    // and doesn't depend on guessing where a whole-map-random draw landed.
    const positions: ({ x: number; z: number } | null)[] = [];
    for (let i = 0; i < 9; i++) {
      const p = await qaHook(page, 'qaPredatorState', i);
      positions.push(p ? { x: p.x, z: p.z } : null);
    }

    let bestChunk = [0, 0], bestCount = Infinity;
    for (let cx = 0; cx < TREE_CHUNKS_PER_AXIS; cx++) {
      for (let cz = 0; cz < TREE_CHUNKS_PER_AXIS; cz++) {
        let count = 0;
        for (const pos of positions) {
          if (!pos) continue;
          const [pcx, pcz] = chunkXZOf(pos.x, pos.z);
          if (Math.max(Math.abs(pcx - cx), Math.abs(pcz - cz)) <= STREAM_RADIUS_CHUNKS) count++;
        }
        if (count < bestCount) { bestCount = count; bestChunk = [cx, cz]; }
      }
    }
    const targetX = bestChunk[0] * TREE_CHUNK_SIZE - HALF + TREE_CHUNK_SIZE / 2;
    const targetZ = bestChunk[1] * TREE_CHUNK_SIZE - HALF + TREE_CHUNK_SIZE / 2;
    await qaHook(page, 'qaTeleportTo', targetX, targetZ);
    await qaHook(page, 'qaAdvance', 5);

    const before = await qaHook(page, 'qaProbeActiveHunters');
    expect(before.active, 'expected the searched-for corner to leave fewer than 2 active hunters').toBeLessThan(2);

    // Each below-minimum stretch only relocates one predator before its own
    // timer resets (see relocateParkedHunter()), so closing a 2-hunter deficit
    // can take more than one HUNTER_GUARANTEE_T window -- advance enough
    // cycles (with margin) to cover the worst case (0 active -> 2 relocations).
    const cyclesNeeded = Math.max(1, 2 - before.active);
    const seconds = cyclesNeeded * (HUNTER_GUARANTEE_T + 5) + 5;
    const steps = Math.ceil(seconds / FIXED_DT);
    await qaHook(page, 'qaAdvance', steps);

    const after = await qaHook(page, 'qaProbeActiveHunters');
    expect(after.active).toBeGreaterThanOrEqual(2);

    // Find a predator that got relocated (was parked, now isn't) and confirm
    // it landed outside the player's view and at least 70 units away, per
    // relocateParkedHunter()'s own reject condition.
    let relocated: { x: number; z: number } | null = null;
    for (let i = 0; i < 9; i++) {
      const p = await qaHook(page, 'qaPredatorState', i);
      const before = positions[i];
      if (!p || !before) continue;
      const moved = Math.hypot(p.x - before.x, p.z - before.z) > 0.001;
      if (moved && !p.parked) { relocated = { x: p.x, z: p.z }; break; }
    }
    expect(relocated, 'expected at least one predator to have been relocated').toBeTruthy();

    const dist = Math.hypot(relocated!.x - targetX, relocated!.z - targetZ);
    expect(dist).toBeGreaterThanOrEqual(70);
    const canSee = await qaHook(page, 'qaProbePlayerCanSee', relocated!.x, relocated!.z);
    expect(canSee).toBe(false);
  });
});
