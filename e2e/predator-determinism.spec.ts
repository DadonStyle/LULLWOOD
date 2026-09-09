// LUL-1104: predator behavior is deterministic within a seeded run.
// This verifies that the same seed reproduces not just the map, but also
// identical predator behavior across multiple loads. Predators draw from the
// seeded RNG for: waypoint selection (roam), sniff-cycle count (investigate),
// sniff back-off distance, and stuck-recovery waypoints.
//
// The test boots the game twice with an identical seed, drives both pages
// forward by the same game-time elapsed, then compares predator positions
// and state. A failure means a predator is drawing from Math.random() somewhere
// instead of the seeded rng(), breaking replay-ability.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook, QA_PINNED_SEED } from './helpers';

async function readPredatorState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const states = [];
    for (let i = 0; i < 9; i++) {
      const state = window.ForestEngine?.qaPredatorState?.(i);
      if (state) states.push(state);
    }
    return states;
  });
}

test.describe('predator determinism with seeded RNG', () => {
  test('two identical seeds produce identical predator positions after game ticks', async ({
    page: page1,
    context,
  }) => {
    const FIXED_DT = 0.02;
    const GAME_SECONDS = 5;
    const STEPS = Math.round(GAME_SECONDS / FIXED_DT);

    // Boot first page, then LUL-2283: park the real RAF loop via
    // qaSetFixedStep() *before* enter() rather than after. enter()'s gate
    // click sets `entered=true` synchronously, which is all `playing` (and
    // therefore updatePredators()) gates on -- so every real-wall-clock frame
    // between the click and the next qaSetFixedStep() call was already
    // moving this page's predators, off the browser's real (unthrottled,
    // frame-boundary-sensitive) tick(), not the seeded/fixed-step one.
    // Freezing the clock first means enter()'s click and its 1200ms fade/
    // pointer-lock wait (both DOM-only, not engine-frame-driven) can no
    // longer advance predator state at all before qaAdvance() does, on
    // either page.
    await boot(page1, { qaHooks: true, seed: QA_PINNED_SEED });
    await qaHook(page1, 'qaSetFixedStep', FIXED_DT);
    await enter(page1);

    // Boot second page in parallel (same seed, same entry)
    const page2 = await context.newPage();
    await boot(page2, { qaHooks: true, seed: QA_PINNED_SEED });
    await qaHook(page2, 'qaSetFixedStep', FIXED_DT);
    await enter(page2);

    // Initial states should match immediately after enter
    const initial1 = await readPredatorState(page1);
    const initial2 = await readPredatorState(page2);
    expect(initial1).toEqual(initial2);

    // Drive both pages forward by an identical, lockstep qaAdvance sequence
    // instead of two independent real-time polls -- two sequential
    // expect.poll() calls let CI jitter advance a different number of engine
    // ticks between page1 and page2, which is exactly the kind of drift this
    // determinism test exists to catch, not induce. 5 game-seconds is enough
    // time for predators to roam, potentially lose sight, and enter
    // investigate/sniff cycles -- the exact behaviors this test needs to
    // verify are deterministic.
    await Promise.all([page1, page2].map((p) => qaHook(p, 'qaAdvance', STEPS)));

    // Final comparison: predator positions and states must be identical
    const state1 = await readPredatorState(page1);
    const state2 = await readPredatorState(page2);

    // Assert the same number of predators were sampled
    expect(state1.length).toBe(state2.length);

    // Assert each predator has identical position and state
    for (let i = 0; i < state1.length; i++) {
      const p1 = state1[i];
      const p2 = state2[i];

      expect(p1, `predator ${i} state1`).not.toBeNull();
      expect(p2, `predator ${i} state2`).not.toBeNull();

      // Positions must match to within floating-point rounding
      // (allow 0.001 unit tolerance for accumulated drift)
      expect(Math.abs(p1.x - p2.x)).toBeLessThan(0.001);
      expect(Math.abs(p1.z - p2.z)).toBeLessThan(0.001);

      // State machine variables must match exactly
      expect(p1.state).toBe(p2.state);
      expect(p1.inv).toBe(p2.inv);
      expect(p1.sniffsLeft).toBe(p2.sniffsLeft);
    }

    await page2.close();
  });
});
