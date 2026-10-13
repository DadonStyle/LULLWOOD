// LUL-5956 (child of LUL-5954): the suggestion box had no entry point from
// gameplay -- the only link to app/suggest/page.tsx (components/SuggestionBox.tsx)
// was buried in the landing page's FAQ.
// LUL-5983: the entry point moved from a `menuRow` link buried inside the
// hamburger dropdown to a standalone `menuSuggest` button that sits in
// `.menuButtons` next to `fullscreenToggle`, visible without opening the menu.
// It still opens /suggest via `window.open(..., '_blank', 'noopener,noreferrer')`
// so a player who has entered a run does not lose it just by clicking through.
// The `noopener` flag severs the new tab's opener relationship, which is also
// what makes Playwright's `page.waitForEvent('popup')` unable to attach to it
// (the pre-LUL-5983 link used the same `rel="noopener noreferrer"` and its
// test never asserted a popup either) -- stub `window.open` instead of relying
// on a real popup to appear.
import { test, expect } from './fixtures';
import { boot, enter } from './helpers';

test.describe('GameMenu suggestion box entry point', () => {
  test('a visible, reachable button to /suggest sits next to the fullscreen toggle, before entering a run', async ({ page }) => {
    await boot(page);

    const suggestButton = page.getByTestId('menuSuggest');
    await expect(suggestButton).toBeVisible();
    await expect(page.getByTestId('fullscreenToggle')).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __openCalls: unknown[][] }).__openCalls = [];
      window.open = (...args: unknown[]) => {
        (window as unknown as { __openCalls: unknown[][] }).__openCalls.push(args);
        return null;
      };
    });
    await suggestButton.evaluate((el) => (el as HTMLElement).click());
    const calls = await page.evaluate(() => (window as unknown as { __openCalls: unknown[][] }).__openCalls);
    expect(calls).toEqual([['/suggest', '_blank', 'noopener,noreferrer']]);
  });

  test('the button is reachable once a run is entered too, without opening the hamburger menu', async ({ page }) => {
    await boot(page);
    await enter(page);

    const suggestButton = page.getByTestId('menuSuggest');
    await expect(suggestButton).toBeVisible();
    await expect(page.locator('.menuPanel')).toHaveCount(0);

    await page.evaluate(() => {
      (window as unknown as { __openCalls: unknown[][] }).__openCalls = [];
      window.open = (...args: unknown[]) => {
        (window as unknown as { __openCalls: unknown[][] }).__openCalls.push(args);
        return null;
      };
    });
    await suggestButton.evaluate((el) => (el as HTMLElement).click());
    const calls = await page.evaluate(() => (window as unknown as { __openCalls: unknown[][] }).__openCalls);
    expect(calls).toEqual([['/suggest', '_blank', 'noopener,noreferrer']]);
  });
});
