// Run: node --test lib/game/leaderboard.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNickname, validateCountry, validateTimeMs, validateAnonId, normalizeForDenylist, isDenylisted,
  clampListLimit, parseCursor, parseRecord, PLAUSIBILITY_FLOOR_MS, PLAUSIBILITY_CEILING_MS, LIST_DEFAULT_LIMIT,
} from './leaderboard.ts';

test('the plausibility floor is the documented ~15.7s', () => {
  assert.equal(PLAUSIBILITY_FLOOR_MS, 15_713);
});

test('validateNickname lowercases and enforces [a-z0-9]{3,20}', () => {
  assert.equal(validateNickname('Ranger42'), 'ranger42');
  assert.equal(validateNickname('abc'), 'abc');
  assert.equal(validateNickname('a'.repeat(20)), 'a'.repeat(20));
  for (const bad of ['ab', 'a'.repeat(21), 'has space', 'émile', 'semi;colon', '', 42, null, undefined, ['abc']]) {
    assert.equal(validateNickname(bad), null, String(bad));
  }
});

test('B2: a nickname containing <script> never passes', () => {
  assert.equal(validateNickname('<script>alert(1)</script>'), null);
  assert.equal(validateNickname('abc<b>'), null);
});

test('B4: the denylist applies after lowercasing and digit substitution', () => {
  assert.equal(normalizeForDenylist('SH1T'), 'shit');
  assert.equal(normalizeForDenylist('4103 5'), 'aioe s');
  assert.equal(isDenylisted('xxsh1txx'), true);
  assert.equal(validateNickname('Sh1t'), null);
  assert.equal(validateNickname('r4p3r'), null);
  assert.equal(validateNickname('ranger'), 'ranger');
});

test('B9: only allowlisted ISO alpha-2 codes pass', () => {
  assert.equal(validateCountry('il'), 'IL');
  assert.equal(validateCountry('US'), 'US');
  for (const bad of ['XX', 'USA', 'U', '', 1, null]) assert.equal(validateCountry(bad), null, String(bad));
});

test('B1: time_ms rejects -1, 0, 1.5, "5", NaN, Infinity, 1e308 and out-of-range integers', () => {
  for (const bad of [-1, 0, 1.5, '5', NaN, Infinity, 1e308, PLAUSIBILITY_FLOOR_MS - 1, PLAUSIBILITY_CEILING_MS + 1, null]) {
    assert.equal(validateTimeMs(bad), null, String(bad));
  }
  assert.equal(validateTimeMs(PLAUSIBILITY_FLOOR_MS), PLAUSIBILITY_FLOOR_MS);
  assert.equal(validateTimeMs(120_000), 120_000);
  assert.equal(validateTimeMs(PLAUSIBILITY_CEILING_MS), PLAUSIBILITY_CEILING_MS);
});

test('validateAnonId accepts a v4 UUID only', () => {
  assert.equal(validateAnonId('3F2504E0-4F89-41D3-9A0C-0305E82C3301'), '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  for (const bad of ['unavailable', 'ssr', '3f2504e0-4f89-11d3-9a0c-0305e82c3301', '', 5]) {
    assert.equal(validateAnonId(bad), null, String(bad));
  }
});

test('B3: list limit clamps instead of erroring', () => {
  assert.equal(clampListLimit('10'), 10);
  assert.equal(clampListLimit('50'), 50);
  for (const bad of ['0', '51', '-1', '1.5', 'abc', '1e2', undefined, null, '10;drop']) {
    assert.equal(clampListLimit(bad), LIST_DEFAULT_LIMIT, String(bad));
  }
});

test('B3: cursor is a positive safe integer or null', () => {
  assert.equal(parseCursor('42'), 42);
  for (const bad of ['0', '-3', '1.0', '9'.repeat(16), 'x', '', null]) assert.equal(parseCursor(bad), null, String(bad));
});

test('B8: parseRecord validates every field of an untrusted record', () => {
  const good = { id: 7, nickname: 'ranger', country: 'IL', timeMs: 120_000, achievedAt: '2026-10-02T10:00:00.000Z' };
  assert.deepEqual(parseRecord(good), good);
  assert.equal(parseRecord({ ...good, nickname: '<img>' }), null);
  assert.equal(parseRecord({ ...good, timeMs: '120000' }), null);
  assert.equal(parseRecord({ ...good, id: -1 }), null);
  assert.equal(parseRecord({ ...good, achievedAt: 'yesterday' }), null);
  assert.equal(parseRecord(null), null);
  assert.equal(parseRecord([good]), null);
});

test('S3/B8: the client cache round-trips, expires after 6h, and discards anything malformed', async () => {
  const { encodeCachedRecord, decodeCachedRecord, CLIENT_CACHE_MAX_AGE_MS } = await import('./leaderboard.ts');
  const rec = { id: 7, nickname: 'ranger', country: 'IL', timeMs: 120_000, achievedAt: '2026-10-02T10:00:00.000Z' };
  const now = 1_790_000_000_000;
  const raw = encodeCachedRecord(rec, now);
  assert.deepEqual(decodeCachedRecord(raw, now + 1000), rec);
  assert.equal(decodeCachedRecord(raw, now + CLIENT_CACHE_MAX_AGE_MS), null);
  assert.equal(decodeCachedRecord(raw, now - 1), null, 'stored in the future');
  assert.equal(decodeCachedRecord('{nope', now), null);
  assert.equal(decodeCachedRecord(JSON.stringify({ record: { ...rec, nickname: '<b>' }, storedAt: now }), now), null);
  assert.equal(decodeCachedRecord(null, now), null);
});
