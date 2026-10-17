// Homepage entity + Q&A signals for search engines and AI answer engines:
// the FAQPage JSON-LD must match the visible Questions section (Google's
// structured-data policy), the WebSite/Organization nodes carry the brand
// fallbacks and sameAs, and /llms.txt is served. Static HTML only, no gameplay.
import { test, expect } from './fixtures';
import { FAQ } from '../lib/faq';
import { GITHUB_URL } from '../lib/site';

type JsonLd = Record<string, unknown> & { '@type'?: string; '@graph'?: Record<string, unknown>[] };

test.describe('SEO/GEO homepage signals', () => {
  test('FAQPage JSON-LD matches the visible Questions section', async ({ page }) => {
    await page.goto('/?qaWorld=micro', { waitUntil: 'domcontentloaded' });
    const { blocks, visible } = await page.evaluate(() => ({
      blocks: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent ?? ''),
      visible: Array.from(document.querySelectorAll('main.about h3')).map((h) => ({
        question: h.textContent ?? '',
        answer: h.nextElementSibling?.textContent ?? '',
      })),
    }));
    const lds = blocks.map((b) => JSON.parse(b) as JsonLd);

    const faq = lds.find((d) => d['@type'] === 'FAQPage') as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] } | undefined;
    expect(faq).toBeTruthy();
    const marked = faq!.mainEntity.map((q) => ({ question: q.name, answer: q.acceptedAnswer.text }));
    expect(marked).toEqual(FAQ);
    expect(visible).toEqual(FAQ);

    const graph = lds.flatMap((d) => d['@graph'] ?? []);
    expect(graph.find((n) => n['@type'] === 'WebSite')?.alternateName).toEqual(['Lullwood Game', 'lullwoodgame.com']);
    expect(graph.find((n) => n['@type'] === 'Organization')?.sameAs).toContain(GITHUB_URL);

    const game = lds.find((d) => d['@type'] === 'VideoGame') as { screenshot: string[] };
    expect(game.screenshot.length).toBeGreaterThanOrEqual(3);
    for (const url of game.screenshot) expect(new URL(url).pathname).toMatch(/^\/screenshots\/lullwood-.+\.png$/);
  });

  test('the homepage links to the devlog and credits in server-rendered HTML', async ({ request }) => {
    const html = await (await request.get('/')).text();
    expect(html).toContain('href="/devlog"');
    expect(html).toContain('href="/credits"');
  });

  test('/llms.txt is served as plain text', async ({ request }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/plain');
    expect(await res.text()).toMatch(/^# Lullwood\n/);
  });
});
