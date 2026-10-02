// Run: node --test lib/game/country-palettes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRY_ALLOWLIST } from './leaderboard.ts';
import { COUNTRY_PALETTES } from './country-palettes.ts';

test('every COUNTRY_ALLOWLIST code has a 2-3 colour hex palette', () => {
  for (const code of COUNTRY_ALLOWLIST) {
    const palette = COUNTRY_PALETTES[code];
    assert.ok(palette, `missing palette for allowlisted code ${code}`);
    assert.ok(palette.length === 2 || palette.length === 3, `${code} has ${palette.length} colours, want 2-3`);
    for (const hex of palette) assert.match(hex, /^#[0-9A-F]{6}$/, `${code} colour ${hex} is not #RRGGBB`);
  }
});

test('no palette entries beyond the allowlist (dead data drifts silently)', () => {
  for (const code of Object.keys(COUNTRY_PALETTES)) {
    assert.ok(COUNTRY_ALLOWLIST.has(code), `${code} has a palette but is not in COUNTRY_ALLOWLIST`);
  }
});
