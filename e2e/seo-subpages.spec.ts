// Head metadata and structured data on the routes other than "/" (the
// homepage's own tags are e2e/seo.spec.ts's job). Static HTML only -- none of
// these pages mount the game, so nothing here boots a world.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { getAllPosts } from '../lib/devlog';

const posts = getAllPosts(); // newest first
const middle = posts[1];

async function jsonLdBlocks(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((text) => JSON.parse(text));
}

// Each subpage sets its own `openGraph`/`twitter`, which Next merges shallowly
// over the layout's -- these routes shared as text-only cards until the root
// image was spread back in (lib/seo.ts).
const SUBPAGES: { path: string; crumbs: string[] }[] = [
  { path: '/devlog', crumbs: ['Home', 'Devlog'] },
  { path: `/devlog/${middle.slug}`, crumbs: ['Home', 'Devlog', middle.title] },
  { path: '/credits', crumbs: ['Home', 'Credits'] },
  { path: '/suggest', crumbs: ['Home', 'Suggest something'] },
];

test.describe('SEO on subpages', () => {
  for (const { path, crumbs } of SUBPAGES) {
    test(`${path}: large social card and a BreadcrumbList`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
      expect(ogImage).toMatch(/^https?:\/\/.+\/opengraph-image\.png$/);
      await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute('content', /\S/);
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
      await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', /opengraph-image\.png$/);
      const image = await page.request.get(new URL(ogImage as string).pathname);
      expect(image.status()).toBe(200);

      const breadcrumbs = (await jsonLdBlocks(page)).filter((d) => d['@type'] === 'BreadcrumbList');
      expect(breadcrumbs).toHaveLength(1);
      const items = breadcrumbs[0].itemListElement;
      expect(items.map((el: { name: string }) => el.name)).toEqual(crumbs);
      items.forEach((el: { position: number; item: string }, i: number) => {
        expect(el.position).toBe(i + 1);
        expect(el.item).toMatch(/^https?:\/\//);
      });
      expect(new URL(items[0].item).pathname).toBe('/');
      expect(new URL(items[items.length - 1].item).pathname).toBe(path);
    });
  }

  test('devlog post: BlogPosting carries image, dates, page and the org reference', async ({ page }) => {
    await page.goto(`/devlog/${middle.slug}`, { waitUntil: 'domcontentloaded' });
    const post = (await jsonLdBlocks(page)).find((d) => d['@type'] === 'BlogPosting');
    expect(post).toBeTruthy();
    expect(post.image).toMatch(/\/opengraph-image\.png$/);
    expect(post.datePublished).toBe(middle.date);
    expect(post.dateModified).toBe(middle.updated ?? middle.date);
    expect(post.mainEntityOfPage['@id']).toBe(post.url);
    for (const who of [post.author, post.publisher]) {
      expect(who['@id']).toMatch(/#org$/);
      expect(who.name).toBe('Lullwood');
    }
  });

  test('devlog post: links to the game and to its older and newer neighbours', async ({ page }) => {
    await page.goto(`/devlog/${middle.slug}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: 'Play Lullwood free in your browser' })).toHaveAttribute('href', '/');
    await expect(page.locator('a[rel="prev"]')).toHaveAttribute('href', `/devlog/${posts[2].slug}`);
    await expect(page.locator('a[rel="next"]')).toHaveAttribute('href', `/devlog/${posts[0].slug}`);
  });

  test('/suggest links back to the game', async ({ page }) => {
    await page.goto('/suggest', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toHaveText('Suggest something');
    await expect(page.locator('main a[href="/"]')).toBeVisible();
  });

  test('sitemap: fixed homepage lastmod and its screenshots as image entries', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    const home = xml.match(/<url>\s*<loc>[^<]+?<\/loc>[\s\S]*?<\/url>/)?.[0] ?? '';
    expect(home).not.toContain('/suggest');
    expect(home).toContain('<lastmod>2026-10-02');
    expect(home.match(/<image:loc>[^<]+\/screenshots\/[^<]+\.png<\/image:loc>/g)).toHaveLength(3);
  });

  for (const path of ['/no-such-page', '/devlog/no-such-post']) {
    test(`${path}: a helpful 404 with one title and a single noindex`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(res?.status()).toBe(404);
      await expect(page.locator('h1')).toHaveText('Page not found');
      await expect(page).toHaveTitle('Page not found — Lullwood');
      expect(await page.locator('head title').count()).toBe(1);

      const robots = await page.locator('meta[name="robots"], meta[name="googlebot"]').evaluateAll((els) =>
        els.map((el) => el.getAttribute('content')),
      );
      expect(robots).toEqual(['noindex']);

      await expect(page.getByRole('link', { name: 'Play Lullwood free in your browser' })).toHaveAttribute('href', '/');
      await expect(page.locator('main a[href="/devlog"]')).toBeVisible();
      await expect(page.locator(`main a[href="/devlog/${posts[0].slug}"]`)).toBeVisible();
    });
  }
});
