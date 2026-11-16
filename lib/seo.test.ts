import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breadcrumbJsonLd, ORG_REF, socialImage } from './seo.ts';
import { SITE_URL } from './site.ts';

test('a breadcrumb trail starts at Home and numbers every crumb from 1', () => {
  const ld = breadcrumbJsonLd([
    { name: 'Devlog', path: '/devlog' },
    { name: 'The return trip', path: '/devlog/the-return-trip' },
  ]);
  assert.equal(ld['@type'], 'BreadcrumbList');
  assert.deepEqual(
    ld.itemListElement.map((el) => [el.position, el.name]),
    [[1, 'Home'], [2, 'Devlog'], [3, 'The return trip']],
  );
});

test('every breadcrumb item is an absolute URL on the site, Home without a trailing path', () => {
  const ld = breadcrumbJsonLd([{ name: 'Credits', path: '/credits' }]);
  assert.deepEqual(
    ld.itemListElement.map((el) => el.item),
    [SITE_URL, `${SITE_URL}/credits`],
  );
});

test('the org reference points at the Organization node app/layout.tsx emits', () => {
  assert.equal(ORG_REF['@id'], `${SITE_URL}#org`);
});

test('socialImage points at the /og card route with the encoded page title', () => {
  const img = socialImage('Is Lullwood Too Hard? Lantern & Night');
  assert.equal(img.url, '/og?title=Is%20Lullwood%20Too%20Hard%3F%20Lantern%20%26%20Night');
  assert.equal(img.width, 1200);
  assert.equal(img.height, 630);
  assert.match(img.alt, /^Is Lullwood Too Hard\? Lantern & Night — Lullwood/);
});
