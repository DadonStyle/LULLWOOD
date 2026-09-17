// LUL-2612: mobile parity for the first-visit welcome splash -- same
// dismiss-persists-to-localStorage behaviour, driven by a viewport-relative
// tap instead of the desktop-hardcoded VIEW_X/VIEW_Y (same pattern as
// ../hide.spec.ts's mobile counterpart).
import { test, expect } from '../fixtures';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('a first-time mobile visitor sees the welcome splash and can dismiss it', async ({ page }) => {
  await boot(page, { seedWelcomeSplashSeen: false });

  const splash = page.locator('#welcomeSplash');
  await expect(splash).toBeVisible();
  await expect(splash).toContainText('Welcome to Lullwood');
  await expect(splash).toContainText('Built by Independence AI Studio!');

  const dismiss = page.locator('#welcomeSplashDismiss');
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await expect(splash).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem('lullwood:welcomeSeen'))).toBe('1');

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200);
});

test('a returning mobile visitor never sees the splash', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#welcomeSplash')).toHaveCount(0);
  await expect(page.locator('#gate')).toBeVisible();
});
