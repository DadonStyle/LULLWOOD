// Founder 2026-10-16, mobile half of e2e/game-menu-suggest-link.spec.ts,
// e2e/credits.spec.ts and e2e/menu-tooltips.spec.ts: on a phone the Suggest and
// Credits buttons open their InfoDialog popups in place (no new tab), and a tap
// never leaves a tooltip stuck on screen -- MenuTooltip shows on hover only
// where the device can really hover (@media (hover: hover)). The mid-run Pause
// button (MobileControls) used to sit at a fixed left:132px, right on top of
// Suggest, and ate its taps; it now measures the row and sits past its end.
import { test, expect } from '../fixtures';
import { boot } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

async function enterMobile(page: import('@playwright/test').Page) {
  const viewport = page.viewportSize()!;
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (no pointer-lock on mobile)
}

for (const { id, popup, heading } of [
  { id: 'menuSuggest', popup: 'suggestPopup', heading: 'Suggest something' },
  { id: 'menuCredits', popup: 'creditsPopup', heading: 'Credits' },
]) {
  test(`${id}: a tap opens the ${heading} popup in place, with no tooltip left on screen`, async ({ page }) => {
    await boot(page);
    await enterMobile(page);
    let newTab = false;
    page.context().on('page', () => { newTab = true; });

    await page.getByTestId(id).tap();
    const dialog = page.getByTestId(popup);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toHaveText(heading);
    await expect(page.getByTestId(`${id}-tooltip`)).toBeHidden();

    await page.getByTestId(`${popup}-close`).tap();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId(`${id}-tooltip`)).toBeHidden();
    expect(newTab).toBe(false);
  });
}

test('mid-run, the Pause button sits clear of every button in the menu row', async ({ page }) => {
  await boot(page);
  await enterMobile(page);
  const pause = (await page.getByTestId('touchPause').boundingBox())!;
  for (const id of ['menuToggle', 'fullscreenToggle', 'menuSuggest', 'menuCredits', 'menuBeTheRescuer']) {
    const b = page.getByTestId(id);
    if (!(await b.count())) continue;
    const box = (await b.boundingBox())!;
    const overlaps = box.x < pause.x + pause.width && pause.x < box.x + box.width && box.y < pause.y + pause.height && pause.y < box.y + box.height;
    expect(overlaps, `${id} overlaps touchPause`).toBe(false);
  }
});
