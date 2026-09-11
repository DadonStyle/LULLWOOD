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
    expect(await page.locator('meta[name="google-site-verification"]').count()).toBe(0);

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
        ogImageAlt: meta('og:image:alt'),
        twitterImage: meta('twitter:image', 'name'),
        // LUL-2375: icon URLs must be stable (no per-build hash query) so
        // Google settles on one favicon; manifest + theme-color present.
        iconHrefs: Array.from(document.querySelectorAll('link[rel="icon"]')).map((l) => l.getAttribute('href')),
        appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null,
        manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null,
        themeColor: meta('theme-color', 'name'),
        jsonLdCount: document.querySelectorAll('script[type="application/ld+json"]').length,
        jsonLd,
      };
    });

    // Next renders the root canonical as the bare origin (no trailing slash).
    expect(new URL(head.canonical as string).pathname).toBe('/');
    expect(head.ogImageAlt).toBeTruthy();
    expect(head.ogImageAlt).not.toMatch(/\n/);
    expect(head.iconHrefs).toEqual(expect.arrayContaining(['/favicon.ico', '/icon.svg']));
    for (const href of [...head.iconHrefs, head.appleIcon]) expect(href, `icon URL must be stable: ${href}`).not.toContain('?');
    expect(head.appleIcon).toBe('/apple-icon.png');
    expect(head.manifest).toBe('/manifest.webmanifest');
    expect(head.themeColor).toBe('#0c111a');
    expect(head.jsonLdCount).toBeGreaterThanOrEqual(2);

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
    // LUL-SEO widened this from a single 'Horror' string to a genre list
    // (app/layout.tsx's videoGameJsonLd) without a matching test update --
    // same stale-literal pattern as the title/OG-description bugs above.
    expect(data.genre).toEqual(['Horror', 'Survival', 'Adventure']);
    // LUL-2375: schema.org's enumerated value, not the bare word.
    expect(data.applicationCategory).toBe('GameApplication');
    expect(data.offers).toMatchObject({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
  });

  test('every indexable route has its own canonical (LUL-2375)', async ({ page }) => {
    // /suggest used to inherit the layout's canonical and declare itself a
    // duplicate of the homepage.
    await page.goto('/suggest', { waitUntil: 'domcontentloaded' });
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toMatch(/\/suggest$/);
    await page.goto('/devlog', { waitUntil: 'domcontentloaded' });
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toMatch(/\/devlog$/);
  });

  test('manifest, icons and social images resolve at stable URLs (LUL-2375)', async ({ request }) => {
    const manifest = await request.get('/manifest.webmanifest');
    expect(manifest.status()).toBe(200);
    const m = await manifest.json();
    expect(m.name).toBe(SITE_NAME);
    expect(m.icons.length).toBeGreaterThanOrEqual(2);
    for (const [path, type] of [
      ['/favicon.ico', /image\/(x-icon|vnd\.microsoft\.icon)/],
      ['/icon.svg', /image\/svg\+xml/],
      ['/apple-icon.png', /image\/png/],
    ] as const) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['content-type'], path).toMatch(type);
    }
  });

  test('robots.txt and sitemap.xml resolve', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain('Sitemap:');

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    const sitemapText = await sitemap.text();
    expect(sitemapText).toContain('<urlset');
    // LUL-2375: /suggest is indexable and linked from the homepage.
    expect(sitemapText).toContain('/suggest</loc>');
  });

  test('opengraph-image.png and twitter-image.png resolve (LUL-49)', async ({ request }) => {
    for (const path of ['/opengraph-image.png', '/twitter-image.png']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()['content-type'], path).toBe('image/png');
    }
  });
});
