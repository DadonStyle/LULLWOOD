// LUL-6108: Atom 1.0 feed of the devlog, built only from the getAllPosts()
// registry so it cannot drift from the sitemap. No `new Date()` here: every
// timestamp is a registry date, so the feed can never carry a date the
// registry does not hold.
import { getAllPosts } from './devlog.ts';
import { SITE_NAME, SITE_URL } from './site.ts';

export const FEED_PATH = '/feed.xml';
export const FEED_TITLE = `${SITE_NAME} devlog`;

const FEED_SUBTITLE = `Development notes from the ${SITE_NAME} team: design decisions, mechanics, and what we learned building a free browser horror game.`;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const stamp = (day: string) => `${day}T00:00:00Z`;

export function buildDevlogFeed(): string {
  const posts = getAllPosts(); // newest first
  const feedUpdated = posts
    .map((p) => p.updated ?? p.date)
    .reduce((a, b) => (a > b ? a : b), '1970-01-01');

  const entries = posts
    .map((p) => {
      const url = `${SITE_URL}/devlog/${p.slug}`;
      return `  <entry>
    <title>${escapeXml(p.title)}</title>
    <link rel="alternate" type="text/html" href="${escapeXml(url)}"/>
    <id>${escapeXml(url)}</id>
    <published>${stamp(p.date)}</published>
    <updated>${stamp(p.updated ?? p.date)}</updated>
    <author><name>${escapeXml(SITE_NAME)}</name></author>
    <summary>${escapeXml(p.description)}</summary>
  </entry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(FEED_TITLE)}</title>
  <subtitle>${escapeXml(FEED_SUBTITLE)}</subtitle>
  <link rel="alternate" type="text/html" href="${escapeXml(`${SITE_URL}/devlog`)}"/>
  <link rel="self" type="application/atom+xml" href="${escapeXml(`${SITE_URL}${FEED_PATH}`)}"/>
  <id>${escapeXml(`${SITE_URL}/devlog`)}</id>
  <updated>${stamp(feedUpdated)}</updated>
  <author><name>${escapeXml(SITE_NAME)}</name></author>
${entries}
</feed>
`;
}
