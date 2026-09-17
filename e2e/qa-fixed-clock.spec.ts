// LUL-2071 (Part 1): verifies the deterministic QA test-clock hook itself --
// qaSetFixedStep() parks the real RAF loop and qaAdvance() is the only thing
// that moves simulation time from then on, by exactly the requested amount.
// This does not rewrite any of the wall-clock-tuned specs (that's a separate
// follow-up per docs/specs/lul-2071-deterministic-qa-clock.md); it only
// proves the hook works. qaProbeElapsedTime is untyped in forest-engine.d.ts
// (see map-seed.spec.ts), hence the `as any` reads, same as that spec.
import { test, expect } from './fixtures';
import { boot } from './helpers';

async function readElapsedTime(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as any).ForestEngine?.qaProbeElapsedTime?.() ?? 0);
}

test.describe('deterministic QA test clock', () => {
  test('qaAdvance moves game time by exactly the requested amount, not wall time', async ({ page }) => {
    await boot(page, { qaHooks: true });

    // Read `before` only after the RAF loop is parked -- reading it first
    // (the original bug) leaves a wall-clock-timed gap between the read and
    // qaSetFixedStep() actually cancelling the pending frame, during which
    // the still-running real loop keeps advancing clock.elapsedTime. That
    // gap is small and invisible on a fast rig but real on the nightly
    // rig's CPU-starved concurrent build+test load (LUL-2649): observed
    // drift up to ~0.36s, corrupting the "moved by exactly 1.0s" assertion
    // with real time that was never meant to be measured.
    await page.evaluate(() => (window as any).ForestEngine.qaSetFixedStep(0.02));
    const before = await readElapsedTime(page);
    await page.evaluate(() => (window as any).ForestEngine.qaAdvance(50)); // 50 x 0.02s = 1.0s game time
    const after = await readElapsedTime(page);

    expect(Math.abs(after - before - 1.0)).toBeLessThan(1e-6);
  });

  test('parking the RAF loop actually stops it -- no real-time drift', async ({ page }) => {
    await boot(page, { qaHooks: true });

    await page.evaluate(() => (window as any).ForestEngine.qaSetFixedStep(0.02));
    const before = await readElapsedTime(page);
    await page.waitForTimeout(600); // no qaAdvance() call in this window
    const after = await readElapsedTime(page);

    expect(after).toBe(before);
  });
});
