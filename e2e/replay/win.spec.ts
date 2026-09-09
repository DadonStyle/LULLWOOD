// LUL-216: records a QA_REGRESSION/ clip of the win path. Not a correctness
// check -- e2e/smoke.spec.ts already asserts this mechanic; this spec exists
// so `--project=replay` (playwright.config.ts) produces a real, playing video
// of it. Same qaTeleportNearBaby hook as the smoke test, for the same reason
// documented there: scripting real obstacle-avoidance navigation across
// procedural terrain is out of scope, and is not what this clip is trying to
// show. LUL-2281 (reverts LUL-1307): no carry-home leg anymore, so no
// qaTeleportHome step either -- the ascend/explode cinematic wins outright.
import { test, expect } from '@playwright/test';
import { boot, enter, readObjective } from '../helpers';

test('win path: reach the child and lift her into the light', async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page, { qaHooks: true });
  await enter(page);

  await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
  await page.waitForTimeout(300);

  const objective = await readObjective(page);
  expect(objective, 'qaTeleportNearBaby did not land within pickup range').toContain('Press');

  await page.keyboard.press('KeyE');

  await expect(page.locator('#winScreen')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#winScreen h1')).toHaveText('YOU WON');

  // Hold the win screen on screen for a beat so the clip reads clearly.
  await page.waitForTimeout(1_500);
});
