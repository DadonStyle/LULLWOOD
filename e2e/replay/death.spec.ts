// LUL-216: records a QA_REGRESSION/ clip of the death path. Not a correctness
// check -- e2e/smoke.spec.ts's per-species loop already asserts this
// mechanic; this spec exists so `--project=replay` produces a real, playing
// video of it. Picks one species (wolf) rather than looping all three --
// see QA_REGRESSION/README.md, one death clip is enough to show the mechanic
// and looping would triple the recorded (and committed) video for no new
// signal this clip is meant to carry.
import { test, expect } from '@playwright/test';
import { boot, enter } from '../helpers';

test('death path: a hunting wolf closes the distance and kills you', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, { qaHooks: true });
  await enter(page);

  const lured = await page.evaluate(() => window.ForestEngine?.qaLurePredatorKind?.('wolf') ?? null);
  expect(lured, 'a wolf was lured (none left alive?)').toBe('wolf');

  const deathScreen = page.locator('#deathScreen');
  await expect(deathScreen).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#deathKind')).toHaveText('wolf');

  // CUT_END = 3.7s in forest-engine.js; the loss text reveals once the death
  // cutscene video ends.
  await expect(page.locator('#deathText')).toHaveCSS('opacity', '1', { timeout: 10_000 });
  await expect(page.locator('#deathText h1')).toHaveText('YOU LOSE');

  // Hold the death screen on screen for a beat so the clip reads clearly.
  await page.waitForTimeout(1_500);
});
