// Run: node --test app/api/leaderboard/route.test.ts
// The leaderboard service is mocked at the fetch() boundary: each test sees
// exactly the signed request the route would send to the founder's server,
// and verifies it with the real lib/leaderboard/signing.ts.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST, GET } from './route.ts';
import { GET as GET_CURRENT } from './current/route.ts';
import { POST as INVALIDATE } from './[id]/invalidate/route.ts';
import { verify, TIMESTAMP_HEADER, NONCE_HEADER, SIGNATURE_HEADER } from '../../../lib/leaderboard/signing.ts';

const SECRET = 'k'.repeat(40);
const ADMIN = 'admin-'.repeat(8);
const realFetch = globalThis.fetch;

interface Sent { method: string; path: string; body: Record<string, unknown> | null; signed: boolean }
let sent: Sent[];
let reply: (s: Sent) => { status: number; body: unknown } | 'throw';

beforeEach(() => {
  process.env.LEADERBOARD_API_URL = 'https://lb.example.ts.net';
  process.env.LEADERBOARD_API_SECRET = SECRET;
  process.env.LEADERBOARD_IP_HASH_SALT = 'pepper';
  process.env.LEADERBOARD_ADMIN_TOKEN = ADMIN;
  sent = [];
  reply = () => ({ status: 201, body: { id: 1, isRecord: true } });
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    const text = typeof init?.body === 'string' ? init.body : '';
    const h = init?.headers as Record<string, string>;
    const signed = verify(SECRET, { ts: h[TIMESTAMP_HEADER], nonce: h[NONCE_HEADER], signature: h[SIGNATURE_HEADER] },
      init?.method ?? 'GET', path, text, Date.now()).ok;
    const s: Sent = { method: init?.method ?? 'GET', path, body: text ? JSON.parse(text) : null, signed };
    sent.push(s);
    const r = reply(s);
    if (r === 'throw') throw new Error('ECONNREFUSED');
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ['LEADERBOARD_API_URL', 'LEADERBOARD_API_SECRET', 'LEADERBOARD_IP_HASH_SALT', 'LEADERBOARD_ADMIN_TOKEN']) delete process.env[k];
});

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://www.lullwoodgame.com/api/leaderboard', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '198.51.100.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const good = { nickname: 'Ranger42', country: 'il', time_ms: 120_000, anon_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' };

test('a valid submission is forwarded signed, normalized, with a salted IP hash and server-side build sha', async () => {
  process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567';
  const res = await POST(post(good, { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1' }));
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { isRecord: true });
  assert.equal(sent.length, 1);
  const s = sent[0];
  assert.equal(s.signed, true);
  assert.equal(s.path, '/v1/submit');
  assert.equal(s.body!.nickname, 'ranger42');
  assert.equal(s.body!.country, 'IL');
  assert.equal(s.body!.build_sha, 'abcdef1234567');
  assert.equal(s.body!.device_class, 'mobile');
  assert.match(String(s.body!.ip_hash), /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(s.body).includes('198.51.100.7'), false, 'raw IP never leaves Vercel');
});

test('a client-supplied build_sha or difficulty is ignored', async () => {
  await POST(post({ ...good, build_sha: 'forged', difficulty: 'lantern' }));
  assert.equal(sent[0].body!.build_sha, 'dev');
  assert.equal('difficulty' in sent[0].body!, false);
});

test('A1: a spoofed X-Forwarded-For does not change the IP hash (cooldown cannot be reset)', async () => {
  await POST(post(good, { 'x-forwarded-for': '1.1.1.1' }));
  await POST(post(good, { 'x-forwarded-for': '2.2.2.2' }));
  assert.equal(sent[0].body!.ip_hash, sent[1].body!.ip_hash);
});

test('A2: a missing salt, URL or secret refuses (503) and calls nothing', async () => {
  for (const k of ['LEADERBOARD_IP_HASH_SALT', 'LEADERBOARD_API_URL', 'LEADERBOARD_API_SECRET']) {
    const saved = process.env[k];
    delete process.env[k];
    assert.equal((await POST(post(good))).status, 503, k);
    process.env[k] = saved;
  }
  process.env.LEADERBOARD_API_SECRET = 'short';
  assert.equal((await POST(post(good))).status, 503, 'short secret');
  process.env.LEADERBOARD_API_URL = 'http://lb.example.ts.net';
  process.env.LEADERBOARD_API_SECRET = SECRET;
  assert.equal((await POST(post(good))).status, 503, 'plain http');
  assert.equal(sent.length, 0);
});

test('invalid fields are 400 before any service call (B1, B2, B4, B9)', async () => {
  for (const bad of [{ nickname: '<script>' }, { nickname: 'sh1t' }, { country: 'XX' },
    { time_ms: -1 }, { time_ms: 0 }, { time_ms: 1.5 }, { time_ms: '5' }, { time_ms: 1e308 }]) {
    assert.equal((await POST(post({ ...good, ...bad }))).status, 400, JSON.stringify(bad));
  }
  assert.equal((await POST(post('[1]'))).status, 400);
  assert.equal((await POST(post('{bad'))).status, 400);
  assert.equal((await POST(post({ pad: 'x'.repeat(3000) }))).status, 413);
  assert.equal(sent.length, 0);
});

test('the honeypot looks successful and stores nothing', async () => {
  const res = await POST(post({ ...good, website: 'http://spam' }));
  assert.equal(res.status, 204);
  assert.equal(sent.length, 0);
});

test('service 429 maps to 429; unreachable or unexpected maps to 503', async () => {
  reply = () => ({ status: 429, body: { error: 'cooldown' } });
  const r = await POST(post(good));
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /wait/);
  reply = () => 'throw';
  assert.equal((await POST(post(good))).status, 503);
  reply = () => ({ status: 500, body: { error: 'internal error' } });
  assert.equal((await POST(post(good))).status, 503);
});

test('GET list: only clamped integers reach the service; records are re-validated (B3, B8)', async () => {
  reply = () => ({ status: 200, body: { records: [
    { id: 3, nickname: 'ranger', country: 'IL', timeMs: 120_000, achievedAt: '2026-10-02T10:00:00.000Z' },
    { id: 2, nickname: '<img onerror=x>', country: 'IL', timeMs: 120_000, achievedAt: '2026-10-02T10:00:00.000Z' },
  ], nextCursor: 2 } });
  const res = await GET(new Request('https://x/api/leaderboard?limit=5;drop&cursor=1%20or%201=1'));
  assert.equal(sent[0].path, '/v1/records?limit=20');
  const body = await res.json();
  assert.deepEqual(body.records.map((r: { id: number }) => r.id), [3]);
  assert.equal(body.nextCursor, 2);
  await GET(new Request('https://x/api/leaderboard?limit=5&cursor=40'));
  assert.equal(sent[1].path, '/v1/records?limit=5&cursor=40');
});

test('GET current: edge-cacheable, takes no input, null on an empty board, uncached 200 { unavailable } on failure (B7)', async () => {
  reply = () => ({ status: 200, body: { record: null } });
  const empty = await GET_CURRENT();
  assert.deepEqual(await empty.json(), { record: null });
  assert.match(empty.headers.get('cache-control')!, /s-maxage=60/);
  assert.equal(GET_CURRENT.length, 0, 'handler accepts no request argument');
  reply = () => 'throw';
  const down = await GET_CURRENT();
  assert.equal(down.status, 200, 'never 5xx: fetched on every page load');
  assert.deepEqual(await down.json(), { unavailable: true });
  assert.equal(down.headers.get('cache-control'), 'no-store');
  delete process.env.LEADERBOARD_API_SECRET;
  assert.deepEqual(await (await GET_CURRENT()).json(), { unavailable: true });
});

function inv(id: string, auth?: string) {
  const req = new Request(`https://x/api/leaderboard/${id}/invalidate`, {
    method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify({ reason: 'impossible time' }),
  });
  return INVALIDATE(req, { params: Promise.resolve({ id }) });
}

test('B5: invalidate without the token is 401 and changes nothing; unset token is 503', async () => {
  assert.equal((await inv('3')).status, 401);
  assert.equal((await inv('3', 'Bearer wrong')).status, 401);
  assert.equal((await inv('3', ADMIN)).status, 401, 'missing Bearer prefix');
  delete process.env.LEADERBOARD_ADMIN_TOKEN;
  assert.equal((await inv('3', `Bearer ${ADMIN}`)).status, 503);
  assert.equal(sent.length, 0);
});

test('B5: invalidate with the token forwards to the service and returns the new holder', async () => {
  reply = () => ({ status: 200, body: { current: { id: 2, nickname: 'honest', country: 'US', timeMs: 150_000, achievedAt: '2026-10-02T10:00:00.000Z' } } });
  const res = await inv('3', `Bearer ${ADMIN}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).current.nickname, 'honest');
  assert.equal(sent[0].path, '/v1/records/3/invalidate');
  assert.equal(sent[0].signed, true);
  assert.equal((await inv('3abc', `Bearer ${ADMIN}`)).status, 400);
  reply = () => ({ status: 404, body: { error: 'not found' } });
  assert.equal((await inv('99', `Bearer ${ADMIN}`)).status, 404);
});
