// Run: node --test lib/ui/menu-tips.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENU_TIPS } from './menu-tips.ts';

test('every menu button tooltip says what it is and ends with a call to action', () => {
  for (const [key, tip] of Object.entries(MENU_TIPS)) {
    assert.ok(tip.title.length > 0, `${key} title`);
    assert.ok(tip.text.length > 0, `${key} text`);
    assert.match(tip.cta, /^Click to .+\.$/, `${key} cta`);
  }
});

test('the suggestion tooltip invites the player to suggest new things', () => {
  assert.equal(MENU_TIPS.suggest.cta, 'Click to suggest new things.');
});
