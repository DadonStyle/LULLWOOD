// LUL-83: CONFIG.seed used to be the only seed a page ever loaded with, so
// every player got the byte-identical forest/predator layout forever. The
// engine now draws a fresh seed per load by default (resolveInitialSeed() in
// engine/forest-engine.js) and `?seed=` pins an exact one for QA/repro. This
// spec proves both halves: the override reproduces a layout exactly, and the
// default does not reproduce anything.
import { test, expect } from '@playwright/test';
import { boot, QA_PINNED_SEED } from './helpers';

async function dumpMapSeed(page: import('@playwright/test').Page) {
  const dump = await page.evaluate(() => window.ForestEngine?.qaProbeMapSeed?.() ?? null);
  if (dump === null) throw new Error('qaProbeMapSeed returned null -- qaHooks not active?');
  return dump;
}

test.describe('session-varied map seed', () => {
  test('?seed= reproduces the exact same layout across two loads', async ({ page }) => {
    await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });
    const first = await dumpMapSeed(page);

    await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });
    const second = await dumpMapSeed(page);

    expect(first.seed).toBe(QA_PINNED_SEED);
    expect(second).toEqual(first);
  });

  test('a pinned seed produces a different layout than another pinned seed', async ({ page }) => {
    await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });
    const pinned = await dumpMapSeed(page);

    await boot(page, { qaHooks: true, seed: QA_PINNED_SEED + 1 });
    const other = await dumpMapSeed(page);

    expect(other.seed).toBe(QA_PINNED_SEED + 1);
    expect(other).not.toEqual(pinned);
  });

  test('no ?seed= draws a fresh seed each load, not CONFIG.seed', async ({ page }) => {
    await boot(page, { qaHooks: true, seed: null });
    const a = await dumpMapSeed(page);

    await boot(page, { qaHooks: true, seed: null });
    const b = await dumpMapSeed(page);

    expect(a.seed).not.toBe(QA_PINNED_SEED);
    expect(b.seed).not.toBe(QA_PINNED_SEED);
    expect(a.seed).not.toBe(b.seed);
    expect(a).not.toEqual(b);
  });
});
