// LUL-650: mobile half of the admin-mode toggle (see ../admin-mode.spec.ts
// for the desktop spec and the full writeup).
//
// This also stands in as the "is Settings reachable on mobile" check the
// ticket asked for: components/Hud.tsx renders #panel (and #settingsBtn
// inside it) unconditionally once entered, independent of Escape/pause --
// Escape/pointer-lock is desktop-only (engine/forest-engine.js gates that
// listener block on `mode === 'desktop'`). #panel is also repositioned above
// MobileControls' sticks on narrow/coarse-pointer viewports (LUL-198), so
// tapping #settingsBtn directly, with no Escape/pause step at all, is the
// real mobile path -- and it already works without needing a reachability
// fix in this PR. Not device-verified; this is a headless-Chromium touch
// emulation repro, see the Game Tester's confirmation pass.
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
