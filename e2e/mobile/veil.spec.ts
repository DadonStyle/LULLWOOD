// LUL-529: the mist veil is a *hold* (F held on desktop, read every frame at
// engine/forest-engine.js's `veilHeld = playing && (!!keys['KeyF'] || touchVeil)`),
// not a tap -- components/MobileControls.tsx's HoldBtn tracks pointer
// down/up/cancel to match. This asserts the engine-visible effect
// (qaPlayerState().veilHeld) goes true on press and back to false on
// release, not just that the button renders.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('holding the Veil button drives the same veilHeld the F key drives on desktop', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  const veilBtn = page.getByTestId('touchVeil');
  await expect(veilBtn).toBeVisible();

  const before = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(before?.veilHeld).toBe(false);

  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await veilBtn.dispatchEvent('pointerdown', pointerOpts);
  await page.waitForTimeout(100);
  const held = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(held?.veilHeld).toBe(true);

  await veilBtn.dispatchEvent('pointerup', pointerOpts);
  await page.waitForTimeout(100);
  const released = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(released?.veilHeld).toBe(false);
});
