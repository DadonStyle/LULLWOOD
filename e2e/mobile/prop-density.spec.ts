// LUL-2247: map generation has no touch/viewport dependency, so this is a
// parity proof (founder rule: every logic change ships desktop AND mobile),
// not a distinct behaviour -- identical assertions to e2e/prop-density.spec.ts.
// Landscape viewport, same shape as e2e/mobile/jump.spec.ts.
import { test, expect } from '@playwright/test';
import { boot, QA_PINNED_SEED, qaHook } from '../helpers';
// fullmap-reason: measures per-chunk prop caps over the full chunk grid on a phone viewport (LUL-2377: the QA rig never runs @fullmap; run locally with E2E_FULLMAP=1)

test.use({ viewport: { width: 727, height: 393 } });

// LUL-2249: folded here (rather than a new file) for the same reason as the
// desktop counterpart in ../prop-density.spec.ts -- avoids growing
// lib/e2e-policy/world-policy.test.ts's FULLMAP_ALLOWLIST for a case this
// file's own reason already covers.

const CAPS = { cover: 12, reed: 24, bogTree: 12, stone: 3 };
const MIN_SPACING = 3.5;
const SLOP = 1e-6;

for (const seed of [QA_PINNED_SEED, QA_PINNED_SEED + 1, QA_PINNED_SEED + 2, QA_PINNED_SEED + 3]) {
  test(`prop density respects per-chunk caps and minimum spacing at seed ${seed} @fullmap`, async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true, seed });

    const density = await qaHook(page, 'qaProbePropDensity');

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
    expect(density.reedsInLakeClear, `seed ${seed} reeds inside CONFIG.lake.clear`).toBe(0);
  });
}

// LUL-2249: the streaming ring is distance-based (player world position), not
// FOV-based -- CAMERA_FOV=85 on mobile widens the frustum but the same
// STREAM_RADIUS_CHUNKS=2 ring applies unchanged. This proves that claim
// rather than assume it, mirroring the first two desktop assertions in
// ../prop-density.spec.ts's 'chunked streaming' describe.
test('25 chunks are live at spawn on mobile (FOV 85) @fullmap', async ({ page }) => {
  await boot(page, { qaWorld: 'full', qaHooks: true, seed: QA_PINNED_SEED });

  const chunks = await qaHook(page, 'qaProbeTreeChunks');
  expect(chunks.instantiated).toBe(25);
});

test("instance totals match the live chunks' own tree counts on mobile (FOV 85) @fullmap", async ({ page }) => {
  await boot(page, { qaWorld: 'full', qaHooks: true, seed: QA_PINNED_SEED });

  const chunks = await qaHook(page, 'qaProbeTreeChunks');
  expect(chunks.totalInstances).toBe(chunks.expected);
  expect(chunks.totalInstances).toBeGreaterThan(0);
});
