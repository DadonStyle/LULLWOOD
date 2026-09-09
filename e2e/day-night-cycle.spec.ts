// LUL-2205 (backfill for LUL-1709, per docs/specs/day-night-cycle.md's '## e2e'
// section, LUL-2190): timeOfRun is the engine's live pacing clock, 0 (dawn) to
// 1 (full night) over TIME_OF_RUN_DURATION_S (120s) of actual play. It feeds
// fog density, ambient (hemisphere) light, predator detect radius, and a
// plain-text HUD clock. Uses qaSetFixedStep/qaAdvance (LUL-2071, exercised in
// e2e/qa-fixed-clock.spec.ts) to fast-forward the full 120s deterministically
// -- never page.waitForTimeout(120_000) or real wall time. Asserts through
// qaProbeTimeOfRun() (the engine-visible effect: timeOfRun, fogDensity,
// hemiIntensity, detectMul, clock) rather than only the #timeOfRunClock DOM
// text, per e2e/README.md's "assert the effect, not the DOM node" rule.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

test.describe('day/night cycle (timeOfRun)', () => {
  test('timeOfRun ramps 0 -> 1 over TIME_OF_RUN_DURATION_S and resets to 0 on restart', async ({ page }) => {
    test.setTimeout(45_000);
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    // Park the RAF loop before entering: enter()'s gate-fade/pointer-lock
    // settle wait (helpers.ts) is ~1.2s of real time during which `playing`
    // is already true, so real frames would otherwise advance runElapsed
    // before the test ever gets a fixed-step handle on it.
    await qaHook(page, 'qaSetFixedStep', 1); // 1 game-second per step
    await enter(page);

    // Made to fail once on purpose: a fresh run must start at dawn, not mid-ramp.
    const atStart = await qaHook(page, 'qaProbeTimeOfRun');
    expect(atStart.timeOfRun).toBe(0);

    await qaHook(page, 'qaAdvance', 120); // 120 x 1s == TIME_OF_RUN_DURATION_S

    const atFullNight = await qaHook(page, 'qaProbeTimeOfRun');
    expect(atFullNight.timeOfRun).toBeCloseTo(1, 5);

    // clamps at 1, doesn't run past full night
    await qaHook(page, 'qaAdvance', 10);
    const afterOvershoot = await qaHook(page, 'qaProbeTimeOfRun');
    expect(afterOvershoot.timeOfRun).toBe(1);

    // restart() -> enter() resets runElapsed to 0; a run after the first must
    // not start already partway into the night ramp.
    expect(await qaHook(page, 'qaForceDeath', 'wolf', 'hunt')).toBe(true);
    await expect(page.locator('#deathText')).toHaveCSS('opacity', '1', { timeout: 10_000 });
    await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());

    // timeOfRun is only recomputed inside stepFrame(), so one more fixed step
    // is needed to observe the post-restart value -- qaFixedDt survives
    // restart() (it isn't part of freshRunState()), so qaSetFixedStep need
    // not be called again.
    await qaHook(page, 'qaAdvance', 1);
    const afterRestart = await qaHook(page, 'qaProbeTimeOfRun');
    expect(afterRestart.timeOfRun).toBeLessThan(0.01);

    expectNoConsoleErrors(errs);
  });

  test('fog density, ambient light, and predator detect radius all ramp with timeOfRun', async ({ page }) => {
    test.setTimeout(45_000);
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    // Park before entering -- see the previous test's comment: enter()'s
    // ~1.2s settle wait otherwise runs real frames while already `playing`.
    await qaHook(page, 'qaSetFixedStep', 1);
    await enter(page);

    const dawn = await qaHook(page, 'qaProbeTimeOfRun');
    // Made to fail once on purpose: at dawn the detect multiplier must be a no-op (1x).
    expect(dawn.detectMul).toBe(1);

    await qaHook(page, 'qaAdvance', 120);

    const night = await qaHook(page, 'qaProbeTimeOfRun');
    expect(night.timeOfRun).toBeCloseTo(1, 5);
    // Fog thickens toward full night (TIME_OF_RUN_FOG_DELTA is additive and positive).
    expect(night.fogDensity).toBeGreaterThan(dawn.fogDensity);
    // Ambient light dims toward full night (hemiLight.intensity ramps to 0.3x).
    expect(night.hemiIntensity).toBeLessThan(dawn.hemiIntensity);
    // Predators see further at full night (TIME_OF_RUN_DETECT_MUL == 1.3).
    expect(night.detectMul).toBeCloseTo(1.3, 5);
    expect(night.detectMul).toBeGreaterThan(dawn.detectMul);

    expectNoConsoleErrors(errs);
  });

  test('HUD clock reads 6:00 AM at dawn and 9:00 PM at full night', async ({ page }) => {
    test.setTimeout(45_000);
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    // Park before entering -- see the ramp test's comment: enter()'s ~1.2s
    // settle wait otherwise runs real frames while already `playing`.
    await qaHook(page, 'qaSetFixedStep', 1);
    await enter(page);

    const dawn = await qaHook(page, 'qaProbeTimeOfRun');
    expect(dawn.clock).toBe('6:00 AM');
    // Made to fail once on purpose: the DOM readout must actually reflect the
    // engine value, not just render some placeholder text.
    await expect(page.locator('#timeOfRunClock')).toContainText('6:00 AM');

    await qaHook(page, 'qaAdvance', 120);

    const night = await qaHook(page, 'qaProbeTimeOfRun');
    expect(night.clock).toBe('9:00 PM');
    await expect(page.locator('#timeOfRunClock')).toContainText('9:00 PM');

    expectNoConsoleErrors(errs);
  });
});
