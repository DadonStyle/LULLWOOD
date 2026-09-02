// LUL-83: CONFIG.seed used to be the only seed a page ever loaded with, so
// every player got the byte-identical forest/predator layout forever. The
// engine now draws a fresh seed per load by default (resolveInitialSeed() in
// engine/forest-engine.js) and `?seed=` pins an exact one for QA/repro. This
// spec proves both halves: the override reproduces a layout exactly, and the
// default does not reproduce anything.
import { test, expect } from '@playwright/test';
import { boot, QA_PINNED_SEED, qaHook, enter } from './helpers';

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

test.describe('runtime seed determinism — predator behavior', () => {
  test('?seed= reproduces identical predator behavior across two runs (LUL-1104)', async ({ page }) => {
    // LUL-1104: the map seed is reproducible, but predator runtime behavior
    // (sniffs, positions, state machine transitions) must also be deterministic.
    // This drives the game forward and verifies predator states match exactly.

    async function runAndCaptureStates(page: import('@playwright/test').Page) {
      await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });
      await enter(page);
      // Let the predators update through several frames of behavior (roam,
      // sniff, investigate, etc). 1.5 seconds is enough for state changes.
      await page.waitForTimeout(1500);
      // Capture all 9 predators (3 species × 3 individuals)
      const states = [];
      for (let i = 0; i < 9; i++) {
        const state = await qaHook(page, 'qaPredatorState', i);
        states.push(state);
      }
      return states;
    }

    const firstRun = await runAndCaptureStates(page);
    const secondRun = await runAndCaptureStates(page);

    // Verify that all predator states are identical across both runs
    expect(secondRun).toEqual(firstRun);
  });
});
