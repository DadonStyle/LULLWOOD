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
import { boot, QA_PINNED_SEED, qaHook } from './helpers';

const CAPS = { cover: 12, reed: 24, bogTree: 12, stone: 3 };
const MIN_SPACING = 3.5;
const SLOP = 1e-6;

for (const seed of [QA_PINNED_SEED, QA_PINNED_SEED + 1, QA_PINNED_SEED + 2, QA_PINNED_SEED + 3]) {
  test(`prop density respects per-chunk caps and minimum spacing at seed ${seed}`, async ({ page }) => {
    await boot(page, { qaHooks: true, seed });

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
  });
}

test('qaProbePropDensity is a pure read -- calling it twice in a row does not mutate the map', async ({ page }) => {
  await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });

  const first = await qaHook(page, 'qaProbePropDensity');
  const second = await qaHook(page, 'qaProbePropDensity');

  expect(second).toEqual(first);
});
