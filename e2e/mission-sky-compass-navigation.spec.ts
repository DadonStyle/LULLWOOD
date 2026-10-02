// LUL-5528/LUL-5524: Sky Compass Navigation -- a near/untimed MISSION_POOL entry keyed to
// the `drownedCar` LANDMARKS entry, same shape as oakHollow (LUL-3010) and chapelSanctuary
// (LUL-5498). A teaching mission wrapping the shipped world-space Sky Compass
// (LUL-5486/PR#937): no new completion logic, reuses canCompleteMission() unchanged --
// see e2e/mission-progression.spec.ts's oakHollow case, which this file mirrors.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors } from './helpers';

// Every key in HINT_PRIORITY (engine/forest-engine.js) ahead of 'skyCompassNavigation' --
// same technique as e2e/wind-pulse.spec.ts's HINTS_AHEAD_OF_WIND_PULSE. Without this,
// 'landmark' (unconditionally eligible from frame 1) wins the slot first every time.
const HINTS_AHEAD_OF_SKY_COMPASS_NAVIGATION = ['scent', 'landmark', 'deepwater', 'oakHollow', 'beaconEvasion'];
async function preSeenHintsAheadOfSkyCompassNavigation(page: Page) {
  await page.addInitScript((keys) => {
    for (const k of keys) window.localStorage.setItem('lullwood:hints:' + k, '1');
  }, HINTS_AHEAD_OF_SKY_COMPASS_NAVIGATION);
}

test.describe('skyCompassNavigation (near/untimed)', () => {
  test('panel shows the name and glyph, no timer element, completes for the placeholder reward', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaMissionKind: 'skyCompassNavigation' });
    await enter(page);

    const mission = await qaHook(page, 'qaProbeMission');
    expect(mission?.kind).toBe('skyCompassNavigation');
    expect(mission?.status).toBe('active');

    await page.waitForTimeout(250);
    const panel = page.locator('#missionPanel');
    await expect(panel).toBeVisible({ timeout: 3_000 });
    await expect(panel).toContainText('Sky Compass Navigation');
    // No timer element at all for the untimed variant -- not just empty text.
    await expect(panel.locator('#missionTimer')).toHaveCount(0);

    const target = await qaHook(page, 'qaTeleportAtMissionTarget');
    expect(target?.kind).toBe('skyCompassNavigation');
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);

    const completed = await qaHook(page, 'qaProbeMission');
    expect(completed?.status).toBe('complete');
    await expect(panel.locator('#missionGlyph')).toHaveText('●');
    await expect(panel.locator('#missionTimer')).toHaveCount(0);

    expectNoConsoleErrors(errs);
  });

  test('shows the first-encounter hint caption naming the Sky Compass while the mission is active', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await preSeenHintsAheadOfSkyCompassNavigation(page);
    await boot(page, { qaHooks: true, qaMissionKind: 'skyCompassNavigation' });
    await enter(page);

    const caption = page.locator('#hintCaption');
    await expect(caption).toHaveAttribute('data-hint-key', 'skyCompassNavigation', { timeout: 5_000 });
    await expect(caption).toContainText('sky compass');

    expectNoConsoleErrors(errs);
  });
});
