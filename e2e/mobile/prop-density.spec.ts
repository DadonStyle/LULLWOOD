// LUL-2247: map generation has no touch/viewport dependency, so this is a
// parity proof (founder rule: every logic change ships desktop AND mobile),
// not a distinct behaviour -- identical assertions to e2e/prop-density.spec.ts.
// Landscape viewport, same shape as e2e/mobile/jump.spec.ts.
import { test, expect } from '@playwright/test';
import { boot, QA_PINNED_SEED, qaHook } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

const CAPS = { cover: 12, reed: 24, bogTree: 12, stone: 3 };
const MIN_SPACING = 3.5;
const SLOP = 1e-6;

for (const seed of [QA_PINNED_SEED, QA_PINNED_SEED + 1, QA_PINNED_SEED + 2, QA_PINNED_SEED + 3]) {
  test(`prop density respects per-chunk caps and minimum spacing at seed ${seed}`, async ({ page }) => {
    await boot(page, { qaHooks: true, seed });

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
  });
}
