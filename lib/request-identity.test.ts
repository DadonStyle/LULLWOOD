// Run: node --test lib/request-identity.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClientIp, hashIp, usableSalt, deviceFromUserAgent, countryFromHeaders } from './request-identity.ts';

const req = (headers: Record<string, string>) => new Request('https://example.com/', { headers });

test('A1: x-vercel-forwarded-for wins; otherwise the LAST x-forwarded-for hop, never the client-set first', () => {
  assert.equal(getClientIp(req({ 'x-vercel-forwarded-for': '198.51.100.7', 'x-forwarded-for': '1.1.1.1' })), '198.51.100.7');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' })), '203.0.113.9');
  assert.equal(getClientIp(req({ 'x-real-ip': '192.0.2.1' })), '192.0.2.1');
  assert.equal(getClientIp(req({})), 'unknown');
});

test('A2: an unset or empty salt is unusable; hashing is salted', () => {
  assert.equal(usableSalt(undefined), null);
  assert.equal(usableSalt(''), null);
  assert.equal(usableSalt('pepper'), 'pepper');
  assert.notEqual(hashIp('1.2.3.4', 'a'), hashIp('1.2.3.4', 'b'));
  assert.match(hashIp('1.2.3.4', 'a'), /^[0-9a-f]{64}$/);
});

test('deviceFromUserAgent is coarse: class + browser family only', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const pixel = 'Mozilla/5.0 (Linux; Android 15; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
  const tab = 'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
  const ff = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
  assert.deepEqual(deviceFromUserAgent(iphone), { deviceClass: 'mobile', browser: 'safari' });
  assert.deepEqual(deviceFromUserAgent(pixel), { deviceClass: 'mobile', browser: 'chrome' });
  assert.deepEqual(deviceFromUserAgent(tab), { deviceClass: 'tablet', browser: 'chrome' });
  assert.deepEqual(deviceFromUserAgent(edge), { deviceClass: 'desktop', browser: 'edge' });
  assert.deepEqual(deviceFromUserAgent(ff), { deviceClass: 'desktop', browser: 'firefox' });
  assert.deepEqual(deviceFromUserAgent(null), { deviceClass: 'unknown', browser: 'unknown' });
});

test('countryFromHeaders only accepts a two-letter code', () => {
  assert.equal(countryFromHeaders(req({ 'x-vercel-ip-country': 'IL' })), 'IL');
  assert.equal(countryFromHeaders(req({ 'x-vercel-ip-country': 'Israel' })), null);
  assert.equal(countryFromHeaders(req({})), null);
});
