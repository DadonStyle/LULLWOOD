// LUL-5956 (child of LUL-5954): the suggestion box had no entry point from
// gameplay -- the only link to app/suggest/page.tsx (components/SuggestionBox.tsx)
// was buried in the landing page's FAQ.
// LUL-5983: the entry point moved to a standalone `menuSuggest` button in
// `.menuButtons` next to `fullscreenToggle`, visible without opening the menu.
// Founder 2026-10-16: it no longer opens /suggest in a new tab -- it opens the
// same SuggestionBox inside the reusable InfoDialog popup (`suggestPopup`), like
// "Be the rescuer", so the player never leaves the game. /suggest still exists
// for the landing page's FAQ link.
// Once a run is entered, the canvas is pointer-locked for mouse-look and
// Chromium routes a real Playwright `.click()` to the canvas instead of the
// button underneath it (locator.click times out, "canvas ... intercepts
// pointer events"). This is the same limitation `fullscreenToggle` already
// lives with (e2e/fullscreen-key.spec.ts uses the same `.evaluate(el.click())`
// dispatch) -- a synthetic click still runs the real onClick handler.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const click = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => (el as HTMLElement).click());

test.describe('GameMenu suggestion box entry point', () => {
  test('a visible button sits next to the fullscreen toggle, before entering a run', async ({ page }) => {
    await boot(page);

    await expect(page.getByTestId('menuSuggest')).toBeVisible();
    await expect(page.getByTestId('fullscreenToggle')).toBeVisible();
  });

  test('on the start screen a real mouse click reaches the button, not the click-to-start gate', async ({ page }) => {
    // #gate is a full-screen click-to-start layer; #gameMenu must sit above it
    // (z-index 21 vs 20) or this click starts the run instead.
    await boot(page);
    await page.getByTestId('menuSuggest').click();
    await expect(page.getByTestId('suggestPopup')).toBeVisible();
    await expect(page.locator('#gate')).toBeVisible();
  });

  test('once a run is entered, the button opens the suggestion box in a popup, not a new tab', async ({ page }) => {
    await page.route('**/api/suggestions', (route) => route.fulfill({ status: 204 }));
    await boot(page);
    await enter(page);

    const suggestButton = page.getByTestId('menuSuggest');
    await expect(suggestButton).toBeVisible();
    await expect(page.locator('.menuPanel')).toHaveCount(0);

    let newTab = false;
    page.context().on('page', () => { newTab = true; });
    await click(suggestButton);

    const dialog = page.getByTestId('suggestPopup');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toHaveText('Suggest something');
    await dialog.locator('#suggestion-text').fill('more owls in the forest');
    await dialog.getByRole('button', { name: /send suggestion/i }).click();
    await expect(dialog).toContainText('Thanks. The founder reads every suggestion by hand.');
    expect(newTab, 'the suggestion box must not open a new tab').toBe(false);

    await click(page.getByTestId('suggestPopup-close'));
    await expect(dialog).toHaveCount(0);
  });

  test('typing in the popup does not move the player (keys stay in the text box)', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await click(page.getByTestId('menuSuggest'));
    const textarea = page.getByTestId('suggestPopup').locator('#suggestion-text');
    await textarea.focus();

    const before = await qaHook(page, 'qaProbePlayer');
    for (let i = 0; i < 4; i++) await textarea.press('w', { delay: 150 });
    await page.waitForTimeout(500);
    const after = await qaHook(page, 'qaProbePlayer');

    await expect(textarea).toHaveValue('wwww');
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.01);
  });
});
