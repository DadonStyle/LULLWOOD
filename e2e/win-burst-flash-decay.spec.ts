// LUL-2605: regression coverage for the win-burst `#flash` decay window.
// LUL-2520 widened the linear decay (`updateBoom()`, engine/forest-engine.js)
// after a QA capture round trip landed 0.64 game-seconds after fireBoom() and
// caught opacity already faded below the vision check's 0.5 threshold. This
// ticket recurred with a bigger measured delay (1.36s) because a linear decay
// from e=0 keeps shrinking the safe capture window as rig load varies -- any
// fixed slope eventually gets outrun by a slow enough round trip. The fix
// (this file's target) replaces the slope with a plateau-then-fade curve:
// full peak (FLASH_PEAK_OPACITY, 0.65 as of LUL-2971) held through e<=1.5,
// then a fast fade to 0 by e=1.8 in sync
// with boomGroup's own retirement (`if(e > 1.8){ boomGroup.visible = false;
// boomStart = -1; }`). This spec pins that curve at the two delays this bug
// has now been filed against twice, plus the eventual fade-out, so a future
// re-narrowing of the plateau fails CI instead of waiting for the nightly
// vision check to catch it again.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;

async function advance(page: Page, seconds: number) {
  const steps = Math.round(seconds / FIXED_DT);
  await qaHook(page, 'qaAdvance', steps);
}

async function flashOpacity(page: Page) {
  return parseFloat(await page.locator('#flash').evaluate((el: HTMLElement) => el.style.opacity));
}

test('#flash holds full opacity through both LUL-2520 (0.64s) and LUL-2605 (1.36s) measured capture delays, then fades out with boomGroup', async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page, { qaHooks: true });
  await enter(page);
  await qaHook(page, 'qaTeleportNearBaby');
  await page.waitForTimeout(300);
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await page.keyboard.press('KeyE');

  const probe = await qaHook(page, 'qaProbeBabyLight');
  expect(probe.pickingUp, 'KeyE did not start the pickingUp cinematic').toBe(true);

  // Padded 0.02s past the LUL-2281 e>=9.3 fireBoom trigger keyframe to clear float rounding.
  await advance(page, 9.32);
  expect(await flashOpacity(page)).toBeCloseTo(0.65, 1);

  await advance(page, 0.64); // LUL-2520's originally-measured capture delay
  expect(await flashOpacity(page)).toBeGreaterThanOrEqual(0.5);

  await advance(page, 1.36 - 0.64); // LUL-2605's measured delay (1.36s total since trigger)
  expect(await flashOpacity(page)).toBeGreaterThanOrEqual(0.5);

  await advance(page, 0.5); // e~1.86 since trigger, past boomGroup's e>1.8 retirement
  expect(await flashOpacity(page)).toBe(0);
});
