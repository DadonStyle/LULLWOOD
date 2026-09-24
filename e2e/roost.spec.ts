// LUL-4894: Roost Scare, slice (b) -- a player-thrown stone landing near a roost
// flushes it through the exact same flushRoost(i)/roostCooldown machinery slice (a)
// (LUL-1914, updateRoosts()) already drives for the ambient predator-proximity trigger.
// Both paths share the per-roost cooldown array, so the risk this ticket actually adds
// is a double-fire across the two triggers -- the second test below is the one that
// would catch that, not the happy path alone. See wiki game/mechanics/roost-scare.md.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook, advanceChunked, VIEW_X, VIEW_Y } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

// Clears triggerRoostBurst()'s ~0.9s particle animation window while staying well
// inside the 32s ROOST_COOLDOWN, so the shared-cooldown test can prove the second
// throw produced no new burst rather than reading a burst still mid-animation.
const PAST_BURST_WINDOW_S = 1.5;

async function grabAThrowable(page: Page) {
  const stone = await qaHook(page, 'qaTeleportNearThrowable');
  expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();
  await page.keyboard.press('KeyE');
}

async function throwAtLockedTarget(page: Page) {
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  expect(locked, 'Pointer Lock must be engaged for the left-click below to reach throwThrowable()').toBe(true);
  await page.mouse.click(VIEW_X, VIEW_Y);
}

// Same wrapping-label click-bypass and #sound-mute isolation as
// e2e/hide-alert.spec.ts's identical helper -- muting sound keeps
// roostFlushSound()'s own soundOn-gated "birds scatter" caption from
// interleaving with the hint pill under test in captionsOn assertions.
async function enableCaptions(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  await page.getByLabel('Captions for predator calls').evaluate((el) => (el as HTMLInputElement).click());
  await page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());
  await page.locator('#sound').evaluate((el) => (el as HTMLElement).click());
}

test.describe('roost scare (LUL-4894)', () => {
  test('throwing a stone near a roost flushes it', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    await grabAThrowable(page);
    const roost = await qaHook(page, 'qaTeleportNearRoost');
    expect(roost, 'qaTeleportNearRoost returned null').not.toBeNull();

    const before = await qaHook(page, 'qaProbeRoostState', roost.i);
    expect(before.burstActive).toBe(false);
    expect(before.cooldown).toBe(0);

    await throwAtLockedTarget(page);

    const after = await qaHook(page, 'qaProbeRoostState', roost.i);
    expect(after.burstActive).toBe(true);
    expect(after.cooldown).toBeGreaterThan(0);
  });

  test('shares cooldown with the ambient predator trigger -- a second throw inside the window does not re-flush', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await grabAThrowable(page);
    const roost = await qaHook(page, 'qaTeleportNearRoost');
    expect(roost, 'qaTeleportNearRoost returned null').not.toBeNull();

    await throwAtLockedTarget(page);
    const afterFirst = await qaHook(page, 'qaProbeRoostState', roost.i);
    expect(afterFirst.burstActive).toBe(true);
    expect(afterFirst.cooldown).toBeGreaterThan(0);

    // Clear the burst animation window; still well inside the 32s cooldown.
    await advanceChunked(page, stepsFor(PAST_BURST_WINDOW_S));
    const settled = await qaHook(page, 'qaProbeRoostState', roost.i);
    expect(settled.burstActive).toBe(false);
    expect(settled.cooldown).toBeGreaterThan(0);

    // Grab a second stone and throw it at the SAME roost, still inside the cooldown.
    await grabAThrowable(page);
    const roost2 = await qaHook(page, 'qaTeleportNearRoost', roost.i);
    expect(roost2.i).toBe(roost.i);

    await throwAtLockedTarget(page);
    await qaHook(page, 'qaAdvance', 1);

    const afterSecond = await qaHook(page, 'qaProbeRoostState', roost.i);
    expect(
      afterSecond.burstActive,
      'a second throw inside the shared cooldown window must not re-flush the roost',
    ).toBe(false);
  });

  test('captionsOn=true: the first player-thrown flush ever shows the one-shot hint pill', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await enableCaptions(page);
    await qaHook(page, 'qaResetHints');

    await grabAThrowable(page);
    const roost = await qaHook(page, 'qaTeleportNearRoost');
    expect(roost, 'qaTeleportNearRoost returned null').not.toBeNull();

    const caption = page.locator('#captionToast');
    await throwAtLockedTarget(page);

    await expect(caption).toContainText('throw a stone at a roost to startle it');
  });
});
