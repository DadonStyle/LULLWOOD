// LUL-2224 (founder brief, item 1): the wind hint text used to fade to nothing
// 7s after the run started (`windHintFade` in components/GameCanvas.tsx) and
// never came back, leaving the wind arrow (`#windIndicator`) unexplained for
// the rest of the run. The fade is removed; this asserts it stays visible and
// that removing it didn't reopen the LUL-1933/LUL-2057 overlap this corner has
// a history of.
import { test, expect, type Page } from '@playwright/test';
import { boot, enter, assertInViewport } from './helpers';

test('wind hint text stays visible for the whole run, in default and admin mode', async ({ page }) => {
  await boot(page);
  await enter(page);

  const hint = page.locator('#windIndicatorHint');
  await expect(hint).toContainText(/wind/i);
  await expect(hint).toContainText(/scent trail/i);

  // The old fade completed at 7s (0-60% opacity 1, then to 0 by 100%/7s) --
  // wait past that and confirm the text is still fully opaque with no
  // animation driving it.
  await page.waitForTimeout(9_000);
  const computed = await hint.evaluate((el) => {
    const s = getComputedStyle(el);
    return { opacity: s.opacity, animationName: s.animationName };
  });
  expect(computed.opacity).toBe('1');
  expect(computed.animationName).toBe('none');

  await assertNoOverlap(page, '#windIndicatorHint', '#windIndicator');
  await assertInViewport(hint, page, '#windIndicatorHint');

  // Admin mode pushes both elements down (LUL-1933/LUL-2057) -- same
  // guarantees must hold there too. Real toggle route (el.click(), not a
  // Playwright .check() -- see wiki:systems/lul44-diagnosis-and-fix, same
  // pattern e2e/admin-mode.spec.ts uses), not a direct dataset write.
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
  const adminToggle = page.getByLabel(/admin mode/i);
  await adminToggle.evaluate((el) => (el as HTMLInputElement).click());
  await expect(adminToggle).toBeChecked();

  await expect(hint).toHaveCSS('opacity', '1');
  await assertNoOverlap(page, '#windIndicatorHint', '#windIndicator');
  await assertInViewport(hint, page, '#windIndicatorHint (admin mode)');
});

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
