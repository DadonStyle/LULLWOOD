// LUL-2224 (founder brief, item 1) mobile half -- see ../wind-hint.spec.ts for
// the desktop spec and the full writeup. The wind hint text no longer fades
// after 7s; this checks the always-on text doesn't collide with the
// bottom-right touch controls (Hide/Veil/right stick) on short landscape
// phones, in both default and admin mode -- the geometry the ticket flagged
// as the one worth measuring (admin mode pushes the hint to top:228px, close
// to the control column on a 375px-tall screen).
import { test, expect, type Page } from '@playwright/test';
import { boot, assertInViewport } from '../helpers';

const VIEWPORTS = [
  { name: 'Pixel 5 landscape', width: 851, height: 393 },
  { name: 'iPhone SE landscape', width: 667, height: 375 },
];

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('wind hint stays visible and clear of the touch controls, default and admin mode', async ({ page }) => {
      await boot(page);

      const vp = page.viewportSize();
      if (!vp) throw new Error('mobile project must have a viewport size');
      await page.mouse.click(vp.width / 2, vp.height / 2);
      await page.waitForTimeout(1200); // gate fade settle

      const hint = page.locator('#windIndicatorHint');
      await expect(hint).toContainText(/wind/i);
      await expect(hint).toContainText(/scent trail/i);
      await expect(hint).toHaveCSS('opacity', '1');

      await assertInViewport(hint, page, `${viewport.name}: #windIndicatorHint`);
      await assertNoOverlap(page, '#windIndicatorHint', '[data-testid=touchHide]');
      await assertNoOverlap(page, '#windIndicatorHint', '[data-testid=touchVeil]');
      await assertNoOverlap(page, '#windIndicatorHint', '[data-testid=rightStick]');

      // Admin mode: menu -> Settings -> checkbox (e2e/mobile/admin-mode.spec.ts route).
      await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
      await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
      const adminToggle = page.getByLabel(/admin mode/i);
      await adminToggle.evaluate((el) => (el as HTMLInputElement).click());
      await expect(adminToggle).toBeChecked();

      await expect(hint).toHaveCSS('opacity', '1');
      await assertInViewport(hint, page, `${viewport.name}: #windIndicatorHint (admin mode)`);
      await assertNoOverlap(page, '#windIndicatorHint', '[data-testid=touchHide]');
      await assertNoOverlap(page, '#windIndicatorHint', '[data-testid=touchVeil]');
      await assertNoOverlap(page, '#windIndicatorHint', '[data-testid=rightStick]');
    });
  });
}

/** Bounding-box intersection check -- fails loudly with both boxes on overlap. */
async function assertNoOverlap(page: Page, selA: string, selB: string) {
  const a = await page.locator(selA).boundingBox();
  const b = await page.locator(selB).boundingBox();
  expect(a, `${selA} must have a bounding box`).not.toBeNull();
  expect(b, `${selB} must have a bounding box`).not.toBeNull();
  const overlaps =
    a!.x < b!.x + b!.width && a!.x + a!.width > b!.x &&
    a!.y < b!.y + b!.height && a!.y + a!.height > b!.y;
  expect(overlaps, `${selA} (${JSON.stringify(a)}) must not overlap ${selB} (${JSON.stringify(b)})`).toBe(false);
}
