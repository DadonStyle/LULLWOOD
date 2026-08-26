// LUL-529: Escape is the only route into setPaused(true) on desktop
// (engine/forest-engine.js's keydown handler); a phone player had no way to
// pause at all before this ticket. This asserts the engine-visible effect
// (qaPlayerState().paused) of tapping the new "Pause" button in
// components/MobileControls.tsx, both directions -- pause and resume --
// since triggerTouchPause is the only way back in too (no pointer-lock
// re-acquire mousedown handler exists on the touch path).
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('tapping Pause toggles the same paused state Escape toggles on desktop', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  const pauseBtn = page.getByTestId('touchPause');
  await expect(pauseBtn).toBeVisible();

  const initial = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(initial?.paused).toBe(false);

  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await pauseBtn.dispatchEvent('pointerdown', pointerOpts);
  await page.waitForTimeout(100);
  const paused = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(paused?.paused).toBe(true);

  await pauseBtn.dispatchEvent('pointerdown', pointerOpts);
  await page.waitForTimeout(100);
  const resumed = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(resumed?.paused).toBe(false);
});
