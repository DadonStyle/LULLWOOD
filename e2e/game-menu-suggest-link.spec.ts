// LUL-5956 (child of LUL-5954): the suggestion box had no entry point from
// gameplay -- the only link to app/suggest/page.tsx (components/SuggestionBox.tsx)
// was buried in the landing page's FAQ. This adds a `menuSuggest` row to
// GameMenu.tsx's hamburger panel, same `menuRow` convention as `menuPause`/
// `settingsBtn`, as the first row for visibility per the player report
// ("very visible"). It opens in a new tab (target="_blank") so a player who
// has entered a run does not lose it just by clicking through.
import { test, expect } from './fixtures';
import { boot, enter } from './helpers';

test.describe('GameMenu suggestion box entry point', () => {
  test('menu panel has a visible, reachable link to /suggest, before entering a run', async ({ page }) => {
    await boot(page);

    const menuToggle = page.getByTestId('menuToggle');
    await expect(menuToggle).toBeVisible();
    await menuToggle.evaluate((el) => (el as HTMLElement).click());

    const link = page.getByTestId('menuSuggest');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/suggest');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveText('Suggest something...');
  });

  test('menu panel has the link once a run is entered too, and clicking it closes the menu', async ({ page }) => {
    await boot(page);
    await enter(page);

    await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
    const link = page.getByTestId('menuSuggest');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/suggest');

    await link.evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('.menuPanel')).toHaveCount(0);
  });
});
