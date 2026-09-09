// LUL-2202: backfill for LUL-1638-era throwables per docs/specs/
// lul-1623-throwables.md's '## e2e' section (LUL-2186) -- this mechanic shipped
// with zero automated coverage. Two new hooks make it testable: qaTeleportNearThrowable()
// stands the player next to a live stone WITHOUT grabbing it (unlike the existing
// qaGrabThrowable, which is for other specs that just need one in hand), so the real
// KeyE/pickup() path is what's under test here; qaStagePredatorNearThrowLanding(kind)
// places a roaming predator inside THROWABLE_NOISE_RADIUS of where the next throw will
// land, so the noise-redirect path (checkThrowableNoise()/hearThrowableNoise()) runs for
// real off a throw a test actually triggered, not a synthetic hearThrowableNoise() call.
// See e2e/mobile/throwables.spec.ts for the touch half.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook, VIEW_X, VIEW_Y, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

// Fixed step for the noise-redirect case, matching scent.spec.ts / positional-hiding.spec.ts
// (LUL-2107: qaSetFixedStep/qaAdvance instead of a real-RAF wall-clock poll).
const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

async function advanceUntil(
  page: import('@playwright/test').Page,
  predicate: () => Promise<boolean>,
  { chunkSeconds = 0.5, maxSeconds = 10 }: { chunkSeconds?: number; maxSeconds?: number } = {},
): Promise<boolean> {
  const chunkSteps = stepsFor(chunkSeconds);
  const chunks = Math.ceil(maxSeconds / chunkSeconds);
  for (let i = 0; i < chunks; i++) {
    await qaHook(page, 'qaAdvance', chunkSteps);
    if (await predicate()) return true;
  }
  return false;
}

test.describe('throwables (LUL-1623)', () => {
  test('grabbing a throwable sets heldThrowable and shows the throw prompt', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    await enter(page);

    const stone = await qaHook(page, 'qaTeleportNearThrowable');
    expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();

    // Made to fail once on purpose: standing next to the stone without pressing
    // E yet must not already hold it.
    await expect(page.locator('#throwPrompt')).toHaveCount(0);

    await page.keyboard.press('KeyE');

    await expect(page.locator('#throwPrompt')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('#throwPrompt')).toContainText('click to throw');

    expectNoConsoleErrors(errs);
  });

  test('throwing clears heldThrowable and the prompt disappears', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    const stone = await qaHook(page, 'qaTeleportNearThrowable');
    expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();

    await page.keyboard.press('KeyE');
    await expect(page.locator('#throwPrompt')).toBeVisible({ timeout: 3_000 });

    // throwThrowable() only fires from the real mousedown handler while Pointer
    // Lock is engaged (engine/forest-engine.js) -- enter() above already
    // requested it, so confirm it actually landed before relying on the click.
    const locked = await page.evaluate(() => document.pointerLockElement !== null);
    expect(locked, 'Pointer Lock must be engaged for the left-click below to reach throwThrowable()').toBe(true);

    await page.mouse.click(VIEW_X, VIEW_Y);

    await expect(page.locator('#throwPrompt')).toHaveCount(0, { timeout: 3_000 });
  });

  test('a thrown rock lures a nearby roaming predator into investigate', async ({ page }) => {
    test.setTimeout(30_000);
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const stone = await qaHook(page, 'qaTeleportNearThrowable');
    expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();

    const staged = await qaHook(page, 'qaStagePredatorNearThrowLanding', 'wolf');
    expect(staged, 'qaStagePredatorNearThrowLanding returned null -- no wolf spawned this seed').not.toBeNull();

    // Made to fail once on purpose: the staged predator must start out roaming,
    // not already investigating/hunting, or the transition below proves nothing.
    const before = await qaHook(page, 'qaProbePredatorState', 'wolf');
    expect(before?.state).toBe('roam');

    await page.keyboard.press('KeyE');
    await expect(page.locator('#throwPrompt')).toBeVisible({ timeout: 3_000 });

    const locked = await page.evaluate(() => document.pointerLockElement !== null);
    expect(locked, 'Pointer Lock must be engaged for the left-click below to reach throwThrowable()').toBe(true);
    await page.mouse.click(VIEW_X, VIEW_Y);

    const reachedInvestigate = await advanceUntil(page, async () => {
      const s = await qaHook(page, 'qaProbePredatorState', 'wolf');
      return s?.state === 'investigate';
    });
    expect(reachedInvestigate, 'wolf did not enter investigate off the thrown stone\'s landing noise').toBe(true);
  });
});
