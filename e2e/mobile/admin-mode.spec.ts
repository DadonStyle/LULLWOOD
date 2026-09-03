// LUL-650/LUL-1085: mobile half of the admin-mode toggle (see ../admin-mode.spec.ts
// for the desktop spec and the full writeup).
//
// LUL-1085 moves Settings (#settingsBtn) from #panel (player-hidden when admin mode off)
// to GameMenu (always visible hamburger menu). This test verifies Settings is still
// reachable and the admin-mode toggle still works. The route is now: open menu ->
// tap Settings button -> toggle admin mode in the panel.
// Not device-verified; this is a headless-Chromium touch emulation repro,
// see the Game Tester's confirmation pass.
import { test, expect } from '@playwright/test';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

test('admin mode defaults off and is reachable/toggleable on mobile', async ({ page }) => {
  await boot(page);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  await expect(page.locator('#minimap')).toBeHidden();
  await expect(page.locator('#pace')).toBeHidden();

  // LUL-1085: Settings button moved to GameMenu, open it via the hamburger
  const menuToggle = page.getByTestId('menuToggle');
  await expect(menuToggle, 'Menu must be reachable on mobile').toBeVisible();
  await menuToggle.evaluate((el) => (el as HTMLElement).click());

  // el.click(), not a real Playwright tap -- see
  // wiki:systems/lul44-diagnosis-and-fix (HUD control taps/clicks in this rig
  // can time out real actionability polling under load; the desktop spec
  // hit the same thing and documents the fix).
  const settingsBtn = page.locator('#settingsBtn');
  await expect(settingsBtn, 'Settings must stay reachable on mobile even with admin mode off').toBeVisible();
  await settingsBtn.evaluate((el) => (el as HTMLElement).click());

  const toggle = page.getByLabel(/admin mode/i);
  await expect(toggle).not.toBeChecked();
  await toggle.evaluate((el) => (el as HTMLInputElement).click());

  await expect(page.locator('#minimap')).toBeVisible();
  await expect(page.locator('#pace')).toBeVisible();
});
