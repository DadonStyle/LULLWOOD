// Run: node --test app/api/suggestions/route.test.ts
// Founder 2026-10-16: suggestions moved off Vercel Blob to the SQLite service
// on the founder's server. These tests run that real service in-process
// (services/leaderboard-db/test-harness.ts) behind the route, so "stored"
// means a row the service really wrote, readable back the way the agents'
// reader gets it.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from './route.ts';
import { hashIp } from '../../../lib/request-identity.ts';
import { startTestService } from '../../../services/leaderboard-db/test-harness.ts';
import { SUGGESTION_IP_LIMIT, SUGGESTION_GLOBAL_LIMIT } from '../../../lib/suggestions/rules.ts';

const SALT = 'test-salt';
let svc: Awaited<ReturnType<typeof startTestService>>;
before(async () => { svc = await startTestService('t'.repeat(48)); });
after(async () => { await svc.stop(); });
beforeEach(() => {
  process.env.SUGGESTIONS_IP_HASH_SALT = SALT;
  process.env.LEADERBOARD_API_URL = 'https://lb.example.ts.net';
  process.env.LEADERBOARD_API_SECRET = 't'.repeat(48);
  svc.db.db.exec('DELETE FROM suggestions');
});

let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter % 250}`;

function makeReq(body: unknown, ip: string, extraHeaders: Record<string, string> = {}): Request {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('http://localhost/api/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'content-length': String(json.length), 'x-forwarded-for': ip, ...extraHeaders },
    body: json,
  });
}
const stored = () => svc.db.listSuggestions();

test('valid text -> 204 and the suggestion is stored on the server with a salted ip hash, never the raw IP', async () => {
  const ip = freshIp();
  const res = await POST(makeReq({ text: 'add more owls to the forest', website: '' }, ip));
  assert.equal(res.status, 204);
  const rows = stored();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'add more owls to the forest');
  assert.equal(rows[0].ip_hash, hashIp(ip, SALT));
  assert.ok(!JSON.stringify(rows).includes(ip));
});

test('digits, punctuation, uppercase, too short and too long are rejected -> 400, nothing stored', async () => {
  for (const text of ['hey 123', 'hello!', 'Hello there', 'hi', 'a'.repeat(301), 42]) {
    assert.equal((await POST(makeReq({ text }, freshIp()))).status, 400, String(text));
  }
  assert.equal(stored().length, 0);
});

test('honeypot filled -> 204, nothing stored', async () => {
  assert.equal((await POST(makeReq({ text: 'buy cheap things', website: 'http://spam' }, freshIp()))).status, 204);
  assert.equal(stored().length, 0);
});

test('malformed or non-object JSON -> 400; oversized -> 413', async () => {
  assert.equal((await POST(makeReq('{nope', freshIp()))).status, 400);
  assert.equal((await POST(makeReq('[1,2]', freshIp()))).status, 400);
  assert.equal((await POST(makeReq({ text: 'x'.repeat(3000) }, freshIp()))).status, 413);
});

test('second suggestion within 10 s from the same IP -> 429 "please wait", the first is still stored', async () => {
  const ip = freshIp();
  assert.equal((await POST(makeReq({ text: 'first idea here' }, ip))).status, 204);
  const second = await POST(makeReq({ text: 'second idea here' }, ip));
  assert.equal(second.status, 429);
  assert.match((await second.json()).error, /please wait/);
  assert.deepEqual(stored().map((s) => s.text), ['first idea here']);
});

test('per-IP hourly limit and the global daily cap answer 429 "rate limited"', async () => {
  const ip = freshIp();
  const h = hashIp(ip, SALT);
  const now = Date.now();
  for (let i = 0; i < SUGGESTION_IP_LIMIT; i++) svc.db.submitSuggestion('earlier idea', h, now - 60 * 60 * 1000 + 60_000 + i * 60_000);
  const r = await POST(makeReq({ text: 'one more idea' }, ip));
  assert.deepEqual([r.status, (await r.json()).error], [429, 'rate limited']);

  svc.db.db.exec('DELETE FROM suggestions');
  for (let i = 0; i < SUGGESTION_GLOBAL_LIMIT; i++) svc.db.submitSuggestion('busy day', String(i).padStart(64, '0'), now - 1000 - i);
  const g = await POST(makeReq({ text: 'a new idea' }, freshIp()));
  assert.deepEqual([g.status, (await g.json()).error], [429, 'rate limited']);
});

test('A1: rotating the spoofable leading X-Forwarded-For hop does not bypass the cooldown', async () => {
  const trustedIp = freshIp();
  assert.equal((await POST(makeReq({ text: 'a fine suggestion text here' }, `9.9.9.9, ${trustedIp}`))).status, 204);
  assert.equal((await POST(makeReq({ text: 'another suggestion right after' }, `1.2.3.4, ${trustedIp}`))).status, 429);
});

test('A1: x-vercel-forwarded-for is preferred over a spoofed x-forwarded-for', async () => {
  const trustedIp = freshIp();
  assert.equal((await POST(makeReq({ text: 'a fine suggestion text here' }, '203.0.113.250', { 'x-vercel-forwarded-for': trustedIp }))).status, 204);
  assert.equal(stored()[0].ip_hash, hashIp(trustedIp, SALT));
  assert.equal((await POST(makeReq({ text: 'another suggestion right after' }, '198.51.100.1', { 'x-vercel-forwarded-for': trustedIp }))).status, 429);
});

test('A2: a missing or empty SUGGESTIONS_IP_HASH_SALT -> 503, never an unsalted hash, nothing stored', async () => {
  for (const salt of [undefined, '']) {
    if (salt === undefined) delete process.env.SUGGESTIONS_IP_HASH_SALT;
    else process.env.SUGGESTIONS_IP_HASH_SALT = salt;
    const res = await POST(makeReq({ text: 'a fine suggestion' }, freshIp()));
    assert.deepEqual([res.status, await res.json()], [503, { error: 'suggestion intake unavailable' }]);
  }
  assert.equal(stored().length, 0);
});

test('service not configured or unreachable -> 503, not a silent success', async () => {
  delete process.env.LEADERBOARD_API_URL;
  assert.equal((await POST(makeReq({ text: 'a fine suggestion' }, freshIp()))).status, 503);
  process.env.LEADERBOARD_API_URL = 'https://lb.example.ts.net';
  svc.down();
  assert.equal((await POST(makeReq({ text: 'a fine suggestion' }, freshIp()))).status, 503);
});
