// LUL-1633: regression coverage for the win-reveal dead-window vignette.
// fireBoom() (engine/forest-engine.js, cinematic e>=9.3) and finishPickup()
// flipping winVisible (e>=11.3) leave a ~2.0s window where the boom burst has
// already decayed but no win text is up yet -- #winPendingCue fills it with a
// warm vignette that builds from 0 to 0.35 opacity over 1.5s, keyed off the
// same fireBoom() trigger #flash already uses (see win-burst-flash-decay.spec.ts
// for that sibling cue's own timing coverage).
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;

async function advance(page: Page, seconds: number) {
  const steps = Math.round(seconds / FIXED_DT);
  await qaHook(page, 'qaAdvance', steps);
}

async function winPendingOpacity(page: Page) {
  return parseFloat(await page.locator('#winPendingCue').evaluate((el: HTMLElement) => el.style.opacity));
}

test('#winPendingCue builds from 0 to 0.35 opacity over the fireBoom->winVisible dead window, then holds while superseded by #winText', async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page, { qaHooks: true, qaWorld: 'micro' });
  await enter(page);
  await qaHook(page, 'qaTeleportNearBaby');
  await page.waitForTimeout(300);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await page.keyboard.press('KeyE');

  const probe = await qaHook(page, 'qaProbeBabyLight');
  expect(probe.pickingUp, 'KeyE did not start the pickingUp cinematic').toBe(true);

  // Padded 0.02s past the e>=9.3 fireBoom trigger keyframe, same padding
  // win-burst-flash-decay.spec.ts uses for the same trigger.
  await advance(page, 9.32);
  const ramping = await winPendingOpacity(page);
  expect(ramping, 'vignette must have started building just past fireBoom()').toBeGreaterThan(0);
  expect(ramping, 'vignette must not yet be at peak this early in the 1.5s build').toBeLessThan(0.35);

  // Total elapsed since fireBoom() is now 1.6s, past the 1.5s build -- ramp complete, holding at peak.
  await advance(page, 10.9 - 9.32);
  expect(await winPendingOpacity(page)).toBeGreaterThanOrEqual(0.33);

  // Total elapsed since fireBoom() is now 2.02s, just past finishPickup()'s e>=11.3 keyframe.
  await advance(page, 11.32 - 10.9);
  await expect(page.locator('#winScreen')).toBeVisible();
  expect(await winPendingOpacity(page), 'vignette must still be visibly present, superseded by #winText fading in over it, not reset').toBeGreaterThanOrEqual(0.33);
});

test('#winPendingCue resets to 0 opacity when the player restarts', async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page, { qaHooks: true, qaWorld: 'micro' });
  await enter(page);
  await qaHook(page, 'qaTeleportNearBaby');
  await page.waitForTimeout(300);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await page.keyboard.press('KeyE');

  // Past finishPickup() (e>=11.3) and winRevealed flipping one frame later,
  // enabling .restartBtn (disabled={!state.winRevealed} in Hud.tsx).
  await advance(page, 11.5);
  await expect(page.locator('#winScreen')).toBeVisible();
  await expect(page.locator('.restartBtn')).toBeEnabled();
  expect(await winPendingOpacity(page)).toBeGreaterThan(0);

  // Same el.click() pattern win-persist.spec.ts uses -- a real Playwright
  // .click()'s actionability polling is known to time out under CI contention.
  await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#winScreen')).toBeHidden();
  expect(await winPendingOpacity(page)).toBe(0);
});
