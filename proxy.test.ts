// Node built-in test runner. Run: node --test proxy.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxy } from './proxy.ts';

function req(url: string, cookie?: string): Request {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new Request(url, { headers });
}

test('no secret configured -> 404 even with a plausible key', () => {
  delete process.env.INTERNAL_DASHBOARD_SECRET;
  const res = proxy(req('https://lullwood.example/internal/dashboard?key=anything'));
  assert.equal(res?.status, 404);
});

test('wrong key, no cookie -> 404', () => {
  process.env.INTERNAL_DASHBOARD_SECRET = 'topsecret';
  const res = proxy(req('https://lullwood.example/internal/dashboard?key=wrong'));
  assert.equal(res?.status, 404);
  delete process.env.INTERNAL_DASHBOARD_SECRET;
});

test('correct key via query -> redirect, strips key, sets cookie', () => {
  process.env.INTERNAL_DASHBOARD_SECRET = 'topsecret';
  const res = proxy(req('https://lullwood.example/internal/dashboard?key=topsecret&range=7d'));
  assert.equal(res?.status, 307);
  const location = new URL(res!.headers.get('location')!);
  assert.equal(location.searchParams.get('key'), null);
  assert.equal(location.searchParams.get('range'), '7d');
  const setCookie = res!.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /lw_dash_key=topsecret/);
  delete process.env.INTERNAL_DASHBOARD_SECRET;
});

test('correct cookie, no query -> continues (undefined)', () => {
  process.env.INTERNAL_DASHBOARD_SECRET = 'topsecret';
  const res = proxy(req('https://lullwood.example/internal/dashboard', 'lw_dash_key=topsecret'));
  assert.equal(res, undefined);
  delete process.env.INTERNAL_DASHBOARD_SECRET;
});

test('wrong cookie value -> 404', () => {
  process.env.INTERNAL_DASHBOARD_SECRET = 'topsecret';
  const res = proxy(req('https://lullwood.example/internal/dashboard', 'lw_dash_key=stale-value'));
  assert.equal(res?.status, 404);
  delete process.env.INTERNAL_DASHBOARD_SECRET;
});
