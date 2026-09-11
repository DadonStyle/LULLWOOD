// LUL-2309: mobile half of the minimap's own `showMinimap` setting (see
// ../minimap-setting.spec.ts for the desktop spec and the full writeup).
// Same landscape-viewport / manual-tap pattern as ../mobile/admin-mode.spec.ts.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

async function seedSettings(context: import('@playwright/test').BrowserContext, settings: Record<string, unknown>) {
  await context.addInitScript((s: Record<string, unknown>) => {
    window.localStorage.setItem('lullwood:settings', JSON.stringify(s));
  }, settings);
}

test('minimap defaults off on mobile, and stays off with adminMode alone', async ({ page, context }) => {
  await seedSettings(context, { adminMode: true });
  await boot(page);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  await expect(page.locator('#minimap')).toBeHidden();
  // confirms admin mode itself is genuinely on, not just a no-op seed
  await expect(page.locator('#pace')).toBeVisible();
});

test('minimap shows on mobile with showMinimap:true', async ({ page, context }) => {
  await seedSettings(context, { showMinimap: true });
  await boot(page);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  await expect(page.locator('#minimap')).toBeVisible();
});
