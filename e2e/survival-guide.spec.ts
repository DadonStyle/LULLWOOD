// /how-to-survive, the player guide (app/how-to-survive/page.tsx). Static,
// server-rendered content like e2e/seo.spec.ts -- never boots the game, so it
// needs no qaWorld and no gameplay hooks.
import { test, expect } from './fixtures';

test.describe('survival guide page', () => {
  test('serves the guide with canonical, H1, social cards and JSON-LD', async ({ page }) => {
    const res = await page.goto('/how-to-survive', { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);

    await expect(page).toHaveTitle('How to Survive Lullwood: Hiding, Scent and Predator Guide');
    await expect(page.locator('h1')).toHaveText('How to survive Lullwood');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(new URL(canonical as string).pathname).toBe('/how-to-survive');

    // The root file-convention social images carry over to this route.
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
    expect(article.headline).toBe('How to Survive Lullwood: Hiding, Scent and Predator Guide');
    expect(article.image).toMatch(/\/screenshots\/.+\.png$/);
    expect(article.author['@id']).toMatch(/#org$/);
    expect(article.publisher['@id']).toMatch(/#org$/);
    expect(article.mainEntityOfPage['@id']).toMatch(/\/how-to-survive$/);
    const crumbs = nodes.find((n) => n['@type'] === 'BreadcrumbList');
    expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Home', 'How to survive']);

    await expect(page.getByRole('link', { name: 'Play Lullwood free in your browser' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: 'Read the Lullwood devlog' })).toHaveAttribute('href', '/devlog');
  });

  test('guide text is in the server HTML, not client-rendered', async ({ request }) => {
    const res = await request.get('/how-to-survive');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('To survive Lullwood');
    expect(html).toContain('Common mistakes');
  });

  test('sitemap lists the guide', async ({ request }) => {
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('/how-to-survive</loc>');
  });
});
