import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGameRoute, showPlayHeader } from './site-chrome.ts';

test('only the home route is the game route', () => {
  assert.equal(isGameRoute('/'), true);
  assert.equal(isGameRoute('/faq'), false);
  assert.equal(isGameRoute('/guides/wolves'), false);
});

test('every public content route shows the play header', () => {
  for (const p of ['/faq', '/guides', '/guides/bears', '/devlog', '/devlog/some-post', '/press', '/credits', '/suggest', '/how-to-survive', '/games-like-slender']) {
    assert.equal(showPlayHeader(p), true, p);
  }
});

test('the game route and internal dashboard do not', () => {
  assert.equal(showPlayHeader('/'), false);
  assert.equal(showPlayHeader('/internal/dashboard'), false);
});
