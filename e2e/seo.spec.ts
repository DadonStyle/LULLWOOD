// LUL-45 / LUL-48: static <head> metadata (OG/Twitter cards, JSON-LD). These
// tags are emitted with the initial HTML, before the game canvas mounts, so
// this suite never needs to click into the game -- it is cheap and static,
// unlike the rest of e2e/ which drives gameplay.
import { test, expect } from '@playwright/test';

test.describe('SEO metadata', () => {
  test('OG, Twitter, canonical and JSON-LD VideoGame tags are present', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveTitle('Lullwood');

    const head = await page.evaluate(() => {
      const meta = (name: string, attr: 'name' | 'property' = 'property') =>
        document.querySelector(`meta[${attr}="${name}"]`)?.getAttribute('content') ?? null;
      const jsonLd = document.querySelector('script[type="application/ld+json"]')?.textContent ?? null;
      return {
        ogTitle: meta('og:title'),
        ogDescription: meta('og:description'),
        ogType: meta('og:type'),
        ogUrl: meta('og:url'),
        ogSiteName: meta('og:site_name'),
        twitterCard: meta('twitter:card', 'name'),
        twitterTitle: meta('twitter:title', 'name'),
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
        jsonLd,
      };
    });

    expect(head.ogTitle).toBe('Lullwood');
    expect(head.ogDescription).toBe('a lost child is somewhere in the dark');
    expect(head.ogType).toBe('website');
    expect(head.ogUrl).toBeTruthy();
    expect(head.ogSiteName).toBe('Lullwood');
    expect(head.twitterCard).toBe('summary_large_image');
    expect(head.twitterTitle).toBe('Lullwood');
    expect(head.canonical).toBeTruthy();

    expect(head.jsonLd).toBeTruthy();
    const data = JSON.parse(head.jsonLd as string);
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toBe('VideoGame');
    expect(data.name).toBe('Lullwood');
    expect(data.genre).toBe('Horror');
    expect(data.applicationCategory).toBe('Game');
    expect(data.offers).toMatchObject({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
  });

  test('robots.txt and sitemap.xml resolve', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain('Sitemap:');

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain('<urlset');
  });
});
