// Run: node --test lib/leaderboard/signing.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, signedHeaders, verify, usableSecret, SIGNATURE_MAX_SKEW_MS, TIMESTAMP_HEADER, NONCE_HEADER, SIGNATURE_HEADER } from './signing.ts';

const SECRET = 'a'.repeat(48);
const NOW = 1_790_000_000_000;
const NONCE = '0123456789abcdef0123456789abcdef';

function headersFor(method: string, path: string, body: string, now = NOW, secret = SECRET) {
  const h = signedHeaders(secret, method, path, body, now, NONCE);
  return { ts: h[TIMESTAMP_HEADER], nonce: h[NONCE_HEADER], signature: h[SIGNATURE_HEADER] };
}

test('a correctly signed request verifies', () => {
  const r = verify(SECRET, headersFor('POST', '/v1/submit', '{"a":1}'), 'POST', '/v1/submit', '{"a":1}', NOW);
  assert.deepEqual(r, { ok: true, nonce: NONCE, ts: NOW });
});

test('a changed body, path, method or secret fails', () => {
  const h = headersFor('POST', '/v1/submit', '{"a":1}');
  assert.equal(verify(SECRET, h, 'POST', '/v1/submit', '{"a":2}', NOW).ok, false);
  assert.equal(verify(SECRET, h, 'POST', '/v1/events', '{"a":1}', NOW).ok, false);
  assert.equal(verify(SECRET, h, 'GET', '/v1/submit', '{"a":1}', NOW).ok, false);
  assert.equal(verify('b'.repeat(48), h, 'POST', '/v1/submit', '{"a":1}', NOW).ok, false);
});

test('the query string is part of what is signed', () => {
  const h = headersFor('GET', '/v1/records?limit=5', '');
  assert.equal(verify(SECRET, h, 'GET', '/v1/records?limit=50', '', NOW).ok, false);
});

test('outside the clock-skew window is stale, on either side', () => {
  const h = headersFor('GET', '/v1/current', '');
  assert.deepEqual(verify(SECRET, h, 'GET', '/v1/current', '', NOW + SIGNATURE_MAX_SKEW_MS + 1), { ok: false, reason: 'stale' });
  assert.deepEqual(verify(SECRET, h, 'GET', '/v1/current', '', NOW - SIGNATURE_MAX_SKEW_MS - 1), { ok: false, reason: 'stale' });
  assert.equal(verify(SECRET, h, 'GET', '/v1/current', '', NOW + SIGNATURE_MAX_SKEW_MS).ok, true);
});

test('missing and malformed headers are rejected before any HMAC work', () => {
  assert.deepEqual(verify(SECRET, { ts: null, nonce: NONCE, signature: 'x' }, 'GET', '/', '', NOW), { ok: false, reason: 'missing' });
  const good = headersFor('GET', '/', '');
  assert.deepEqual(verify(SECRET, { ...good, ts: '12' }, 'GET', '/', '', NOW), { ok: false, reason: 'malformed' });
  assert.deepEqual(verify(SECRET, { ...good, nonce: 'short' }, 'GET', '/', '', NOW), { ok: false, reason: 'malformed' });
  assert.deepEqual(verify(SECRET, { ...good, signature: 'zz'.repeat(32) }, 'GET', '/', '', NOW), { ok: false, reason: 'malformed' });
});

test('sign is deterministic and hex', () => {
  const a = sign(SECRET, NOW, NONCE, 'post', '/v1/submit', '');
  assert.equal(a, sign(SECRET, NOW, NONCE, 'POST', '/v1/submit', ''));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('usableSecret refuses unset and short secrets instead of degrading', () => {
  assert.equal(usableSecret(undefined), null);
  assert.equal(usableSecret(''), null);
  assert.equal(usableSecret('x'.repeat(31)), null);
  assert.equal(usableSecret('x'.repeat(32)), 'x'.repeat(32));
});
