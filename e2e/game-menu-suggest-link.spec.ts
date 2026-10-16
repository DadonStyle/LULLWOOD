// LUL-5956 (child of LUL-5954): the suggestion box had no entry point from
// gameplay -- the only link to app/suggest/page.tsx (components/SuggestionBox.tsx)
// was buried in the landing page's FAQ.
// LUL-5983: the entry point moved from a `menuRow` link buried inside the
// hamburger dropdown to a standalone `menuSuggest` button that sits in
// `.menuButtons` next to `fullscreenToggle`, visible without opening the menu.
// It opens /suggest via window.open(..., '_blank', 'noopener,noreferrer').
// Once a run is entered, the canvas is pointer-locked for mouse-look and
// Chromium routes a real Playwright `.click()` to the canvas instead of the
// button underneath it -- confirmed directly (locator.click times out,
// "canvas ... intercepts pointer events", retried for 10s+ with the pointer
// never reaching the button). This is the same limitation `fullscreenToggle`
// already lives with (e2e/fullscreen-key.spec.ts:155 uses the same
// `.evaluate(el.click())` dispatch for exactly this reason) -- a synthetic
// click still runs the real onClick handler and still opens a real tab
// Playwright can observe via `waitForEvent('popup')`, it just doesn't route
// through hit-testing the way a genuine mouse click would.
import { test, expect } from './fixtures';
import { boot, enter } from './helpers';

test.describe('GameMenu suggestion box entry point', () => {
  test('a visible button to /suggest sits next to the fullscreen toggle, before entering a run', async ({ page }) => {
    await boot(page);

    await expect(page.getByTestId('menuSuggest')).toBeVisible();
    await expect(page.getByTestId('fullscreenToggle')).toBeVisible();
  });

  test('the button is reachable once a run is entered too, without opening the hamburger menu', async ({ page }) => {
    await boot(page);
    await enter(page);

    const suggestButton = page.getByTestId('menuSuggest');
    await expect(suggestButton).toBeVisible();
    await expect(page.locator('.menuPanel')).toHaveCount(0);

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      suggestButton.evaluate((el) => (el as HTMLElement).click()),
    ]);
    await expect(popup).toHaveURL(/\/suggest$/);
  });
});
