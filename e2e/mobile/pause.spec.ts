// LUL-529/LUL-1085: Escape is the only route into setPaused(true) on desktop
// (engine/forest-engine.js's keydown handler); a phone player had no way to
// pause at all before LUL-529. LUL-1085 moves Pause from MobileControls.tsx's
// circular button to GameMenu.tsx. This asserts the engine-visible effect
// (qaPlayerState().paused) of tapping the "Pause" menu row, both directions --
// pause and resume -- since triggerTouchPause is the only way back in too.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('tapping Pause in the game menu toggles the same paused state Escape toggles on desktop', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  // Open the menu
  const menuToggle = page.getByTestId('menuToggle');
  await expect(menuToggle).toBeVisible();
  await menuToggle.click();

  const pauseBtn = page.getByTestId('menuPause');
  await expect(pauseBtn).toBeVisible();

  const initial = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(initial?.paused).toBe(false);

  // Pause via menu
  await pauseBtn.click();
  await page.waitForTimeout(100);
  const paused = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(paused?.paused).toBe(true);

  // Resume via menu (need to reopen menu)
  await menuToggle.click();
  const pauseBtn2 = page.getByTestId('menuPause');
  await pauseBtn2.click();
  await page.waitForTimeout(100);
  const resumed = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(resumed?.paused).toBe(false);
});
