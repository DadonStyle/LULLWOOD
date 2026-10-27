import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDevlogFeed, escapeXml } from './devlog-feed.ts';
import { getAllPosts } from './devlog.ts';

test('the feed has one entry per registry post and names Lullwood at feed level', () => {
  const xml = buildDevlogFeed();
  assert.equal((xml.match(/<entry>/g) ?? []).length, getAllPosts().length);
  assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">\s*<title>Lullwood devlog<\/title>\s*<subtitle>[^<]*Lullwood/);
});

test('the feed never carries a date later than today', () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const m of buildDevlogFeed().matchAll(/<(?:published|updated)>(\d{4}-\d{2}-\d{2})T/g)) {
    assert.ok(m[1] <= today, `${m[1]} is in the future`);
  }
});

test('escapeXml escapes the five XML specials', () => {
  assert.equal(escapeXml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
});
