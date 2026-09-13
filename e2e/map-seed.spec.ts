// LUL-83: CONFIG.seed used to be the only seed a page ever loaded with, so
// every player got the byte-identical forest/predator layout forever. The
// engine now draws a fresh seed per load by default (resolveInitialSeed() in
// engine/forest-engine.js) and `?seed=` pins an exact one for QA/repro. This
// spec proves both halves: the override reproduces a layout exactly, and the
// default does not reproduce anything.
import { test, expect } from '@playwright/test';
import { boot, QA_PINNED_SEED, qaHook, enter } from './helpers';
// fullmap-reason: asserts the seeded generator reproduces the real 480u layout (LUL-2377: the QA rig never runs @fullmap; run locally with E2E_FULLMAP=1)

async function dumpMapSeed(page: import('@playwright/test').Page) {
  const dump = await page.evaluate(() => window.ForestEngine?.qaProbeMapSeed?.() ?? null);
  if (dump === null) throw new Error('qaProbeMapSeed returned null -- qaHooks not active?');
  return dump;
}

test.describe('session-varied map seed @fullmap', () => {
  test('?seed= reproduces the exact same layout across two loads', async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true, seed: QA_PINNED_SEED });
    const first = await dumpMapSeed(page);

    await boot(page, { qaWorld: 'full',  qaHooks: true, seed: QA_PINNED_SEED });
    const second = await dumpMapSeed(page);

    expect(first.seed).toBe(QA_PINNED_SEED);
    expect(second).toEqual(first);
  });

  test('a pinned seed produces a different layout than another pinned seed', async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true, seed: QA_PINNED_SEED });
    const pinned = await dumpMapSeed(page);

    await boot(page, { qaWorld: 'full',  qaHooks: true, seed: QA_PINNED_SEED + 1 });
    const other = await dumpMapSeed(page);

    expect(other.seed).toBe(QA_PINNED_SEED + 1);
    expect(other).not.toEqual(pinned);
  });

  test('no ?seed= draws a fresh seed each load, not CONFIG.seed', async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true, seed: null });
    const a = await dumpMapSeed(page);

    await boot(page, { qaWorld: 'full',  qaHooks: true, seed: null });
    const b = await dumpMapSeed(page);

    expect(a.seed).not.toBe(QA_PINNED_SEED);
    expect(b.seed).not.toBe(QA_PINNED_SEED);
    expect(a.seed).not.toBe(b.seed);
    expect(a).not.toEqual(b);
  });
});

test.describe('runtime seed determinism — predator behavior @fullmap', () => {
  test('?seed= reproduces identical predator behavior across two runs (LUL-1104)', async ({ page }) => {
    // LUL-1104: the map seed is reproducible, but predator runtime behavior
    // (sniffs, positions, state machine transitions) must also be deterministic.
    // This drives the game forward and verifies predator states match exactly.

    // Let the predators update through several frames of behavior (roam,
    // sniff, investigate, etc). 1.5 game-seconds is enough for state changes.
    // Drive both runs via qaSetFixedStep/qaAdvance rather than polling the
    // real game clock -- the poll let CI jitter advance a different number
    // of engine ticks between the two sequential runs below, producing tiny
    // (~0.1-0.3 unit) x/z/dist drift that wasn't a real determinism bug.
    const FIXED_DT = 0.02;
    const GAME_SECONDS = 1.5;
    const STEPS = Math.round(GAME_SECONDS / FIXED_DT);

    async function runAndCaptureStates(page: import('@playwright/test').Page) {
      // LUL-2283: qaSetFixedStep() before enter(), not after -- enter()'s
      // gate click sets `entered=true` synchronously (all `playing`/
      // updatePredators() gate on), so the real RAF loop was moving
      // predators with real, frame-boundary-sensitive wall-clock dt for the
      // full 1200ms fade/pointer-lock wait inside enter() before this used
      // to freeze it. Same total wait, but nothing engine-visible happens
      // during it once the clock is parked first.
      await boot(page, { qaWorld: 'full',  qaHooks: true, seed: QA_PINNED_SEED });
      await qaHook(page, 'qaSetFixedStep', FIXED_DT);
      await enter(page);
      await qaHook(page, 'qaAdvance', STEPS);
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
