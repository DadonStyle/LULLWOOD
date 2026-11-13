// LUL-6435: every non-game route scrolls and opens with a link to the game.
// Static pages only -- no game world is booted.
import { test, expect } from './fixtures';

const ROUTES = ['/faq', '/guides', '/guides/wolves', '/devlog', '/press', '/credits', '/how-to-survive', '/games-like-slender', '/suggest'];

test.describe('content pages scroll and link to the game', () => {
  for (const path of ROUTES) {
    test(`${path}: play link first, page scrolls`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      const play = page.locator('header.site-header a[href="/"]');
      await expect(play).toBeVisible();
      await expect(play).toContainText('Play Lullwood');
      const overflow = await page.evaluate(() => getComputedStyle(document.documentElement).overflowY);
      expect(overflow).not.toBe('hidden');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    });
  }
});
