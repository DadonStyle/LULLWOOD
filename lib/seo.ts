import { SITE_NAME, SITE_URL } from './site.ts';

// The root app/opengraph-image.png, for subpages that set their own
// `openGraph`/`twitter`. Next merges metadata shallowly, so a page that defines
// `openGraph` at all replaces the layout's -- including the image the file
// convention injected -- and shares as a bare text card. Spreading these back
// in keeps one social image site-wide. Alt mirrors app/opengraph-image.alt.txt.
export const SOCIAL_IMAGE = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  alt: 'Lullwood: a glowing child alone in a foggy night forest, first-person browser horror game',
};

export const SOCIAL_OPEN_GRAPH = { siteName: SITE_NAME, locale: 'en_US', images: [SOCIAL_IMAGE] };

export const SOCIAL_TWITTER = { card: 'summary_large_image' as const, images: [SOCIAL_IMAGE] };

// Feed autodiscovery (`<link rel="alternate" type="application/atom+xml">`).
// Next merges `alternates` shallowly, so every page that sets its own canonical
// must spread this back in or the link disappears from that page.
export const DEVLOG_FEED_TYPES = { 'application/atom+xml': [{ url: '/feed.xml', title: 'Lullwood devlog' }] };

// The Organization node app/layout.tsx emits on every page. Referencing it by
// @id lets Google join a page's author/publisher to the same entity instead of
// reading a second, anonymous org; `name` stays for parsers that don't resolve
// @id references.
export const ORG_REF = { '@id': `${SITE_URL}#org`, name: SITE_NAME };

export interface Crumb {
  name: string;
  path: string; // site-relative, e.g. "/devlog"
}

// schema.org BreadcrumbList for a page's trail, Home first. Google wants an
// absolute `item` URL on every element, including the current page.
export function breadcrumbJsonLd(crumbs: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '/' }, ...crumbs].map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: crumb.path === '/' ? SITE_URL : `${SITE_URL}${crumb.path}`,
    })),
  };
}
