// /games-like-slender, the "games like Slender" landing page
// (app/games-like-slender/page.tsx). Static, server-rendered content like
// e2e/seo.spec.ts -- never boots the game, so it needs no qaWorld and no
// gameplay hooks.
import { test, expect } from './fixtures';

const TITLE = 'Games Like Slender You Can Play Free in Your Browser';

test.describe('games like Slender page', () => {
  test('serves the page with canonical, H1, social cards and JSON-LD', async ({ page }) => {
    const res = await page.goto('/games-like-slender', { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);

    await expect(page).toHaveTitle(TITLE);
    await expect(page.locator('h1')).toHaveText('Games like Slender');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(new URL(canonical as string).pathname).toBe('/games-like-slender');

    // The root file-convention social images are named explicitly on this route.
    expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toContain('opengraph-image.png');
    expect(await page.locator('meta[name="twitter:card"]').getAttribute('content')).toBe('summary_large_image');
    expect(await page.locator('meta[name="twitter:image"]').getAttribute('content')).toContain('twitter-image.png');

    // The layout emits its own two blocks; find this page's by content.
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const nodes = blocks.flatMap((b) => {
      const data = JSON.parse(b);
      return data['@graph'] ?? [data];
    });
    const article = nodes.find((n) => n['@type'] === 'Article');
    expect(article).toBeTruthy();
    expect(article.headline).toBe(TITLE);
    expect(article.image).toMatch(/\/screenshots\/.+\.png$/);
    expect(article.author['@id']).toMatch(/#org$/);
    expect(article.publisher['@id']).toMatch(/#org$/);
    expect(article.mainEntityOfPage['@id']).toMatch(/\/games-like-slender$/);
    const crumbs = nodes.find((n) => n['@type'] === 'BreadcrumbList');
    expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Home', 'Games like Slender']);

    await expect(page.getByRole('link', { name: 'Play Lullwood free in your browser' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: 'Lullwood survival guide' })).toHaveAttribute('href', '/how-to-survive');
    await expect(page.getByRole('link', { name: 'Read the Lullwood devlog' })).toHaveAttribute('href', '/devlog');
  });

  test('page text is in the server HTML, not client-rendered', async ({ request }) => {
    const res = await request.get('/games-like-slender');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('try Lullwood');
    expect(html).toContain('How Lullwood is different');
  });

  test('sitemap lists the page', async ({ request }) => {
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('/games-like-slender</loc>');
  });
});
