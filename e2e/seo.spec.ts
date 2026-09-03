// LUL-45 / LUL-48: static <head> metadata (OG/Twitter cards, JSON-LD). These
// tags are emitted with the initial HTML, before the game canvas mounts, so
// this suite never needs to click into the game -- it is cheap and static,
// unlike the rest of e2e/ which drives gameplay.
import { test, expect } from '@playwright/test';
import { SITE_NAME, SITE_TITLE, SITE_TAGLINE } from '../lib/site';

// Mirrors the literal composition in app/layout.tsx's openGraph/twitter
// description fields -- kept as one expression, not re-hardcoded, so a
// future SITE_TAGLINE edit can't silently desync this assertion again
// (it already did once: cdc9b16 changed the tagline suffix and this test
// kept asserting the old short-form OG description until this fix).
const SOCIAL_DESCRIPTION = `${SITE_TAGLINE} A free first-person horror game you play in the browser.`;

test.describe('SEO metadata', () => {
  test('OG, Twitter, canonical and JSON-LD VideoGame tags are present', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveTitle(SITE_TITLE);

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
        ogImage: meta('og:image'),
        twitterImage: meta('twitter:image', 'name'),
        jsonLd,
      };
    });

    expect(head.ogTitle).toBe(SITE_TITLE);
    expect(head.ogDescription).toBe(SOCIAL_DESCRIPTION);
    expect(head.ogType).toBe('website');
    expect(head.ogUrl).toBeTruthy();
    expect(head.ogSiteName).toBe(SITE_NAME);
    expect(head.twitterCard).toBe('summary_large_image');
    expect(head.twitterTitle).toBe(SITE_TITLE);
    expect(head.canonical).toBeTruthy();
    // LUL-49: static app/opengraph-image.png + app/twitter-image.png,
    // registered by Next's file convention -- assert they resolve, not just
    // that the tag exists (a dangling reference would 404 silently).
    expect(head.ogImage).toContain('opengraph-image.png');
    expect(head.twitterImage).toContain('twitter-image.png');

    expect(head.jsonLd).toBeTruthy();
    const data = JSON.parse(head.jsonLd as string);
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toBe('VideoGame');
    expect(data.name).toBe(SITE_NAME);
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

  test('opengraph-image.png and twitter-image.png resolve (LUL-49)', async ({ request }) => {
    for (const path of ['/opengraph-image.png', '/twitter-image.png']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['content-type'], path).toBe('image/png');
    }
  });
});
