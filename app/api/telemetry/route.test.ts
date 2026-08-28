// Node built-in test runner. Run: node --test --experimental-test-module-mocks app/api/telemetry/route.test.ts
// The route uses web-standard Request/Response (no next/server import), so
// only @vercel/blob needs to be mocked here.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock @vercel/blob before importing the route
const putCalls: Array<{ path: string; body: string }> = [];

mock.module('@vercel/blob', {
  namedExports: {
    put: async (path: string, body: string) => {
      putCalls.push({ path, body });
      return { url: `https://example.com/${path}` };
    },
  },
} as Parameters<typeof mock.module>[1]);

const { POST } = await import('./route.ts');

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body);
  return new Request('http://localhost/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'content-length': String(json.length), ...headers },
    body: json,
  });
}

function validPayload(event = 'page_view', extra: Record<string, unknown> = {}) {
  return {
    event,
    ts: Date.now(),
    anon_id: 'test-anon-id',
    build_sha: 'abc123',
    path: '/',
    ...extra,
  };
}

function resetPuts() {
  putCalls.length = 0;
}

test('valid event with token → 204 and puts to blob', async () => {
  resetPuts();
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  const res = await POST(makeReq(validPayload()));
  assert.equal(res.status, 204);
  assert.equal(putCalls.length, 1);
  assert.match(putCalls[0].path, /^events\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.json$/);
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

test('all 7 valid event names are accepted', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  const events = [
    validPayload('page_view'),
    validPayload('cta_start_clicked'),
    validPayload('game_start', { seed: 42 }),
    validPayload('win', { time_survived_ms: 1000, seed: 42 }),
    validPayload('loss', { predator_kind: 'wolf', time_survived_ms: 500, seed: 42 }),
    validPayload('session_length', { duration_ms: 10000, reached_gameplay: true }),
    validPayload('feature_engagement', { feature: 'hide', action: 'used' }),
  ];
  for (const payload of events) {
    resetPuts();
    const res = await POST(makeReq(payload));
    assert.equal(res.status, 204, `${payload.event} should return 204`);
    assert.equal(putCalls.length, 1, `${payload.event} should call put`);
  }
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

test('unknown event → 400', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  const res = await POST(makeReq(validPayload('unknown_event')));
  assert.equal(res.status, 400);
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

test('missing token → 204, no blob write', async () => {
  resetPuts();
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const res = await POST(makeReq(validPayload('cta_start_clicked', { anon_id: 'no-token-test-1' })));
  assert.equal(res.status, 204);
  assert.equal(putCalls.length, 0);
});

test('missing token never throws', async () => {
  resetPuts();
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const r1 = await POST(makeReq(validPayload('game_start', { seed: 1, anon_id: 'no-token-test-2' })));
  const r2 = await POST(makeReq(validPayload('win', { time_survived_ms: 100, seed: 1, anon_id: 'no-token-test-3' })));
  assert.equal(r1.status, 204);
  assert.equal(r2.status, 204);
  assert.equal(putCalls.length, 0);
});

test('payload over 2KB → 413', async () => {
  const bigPayload = { ...validPayload(), junk: 'x'.repeat(3000) };
  const json = JSON.stringify(bigPayload);
  const req = new Request('http://localhost/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'content-length': String(json.length) },
    body: json,
  });
  const res = await POST(req);
  assert.equal(res.status, 413);
});

test('invalid json → 400', async () => {
  const req = new Request('http://localhost/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'content-length': '7' },
    body: 'badjson',
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
});

test('missing envelope fields → 400', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  const res = await POST(makeReq({ event: 'page_view' }));
  assert.equal(res.status, 400);
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

test('blob path date segments are correct (load-bearing for LUL-155)', async () => {
  resetPuts();
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  const ts = new Date('2026-08-28T12:00:00Z').getTime();
  const res = await POST(makeReq(validPayload('cta_start_clicked', { ts, anon_id: 'unique-date-test' })));
  assert.equal(res.status, 204);
  const [, yyyy, mm, dd] = putCalls[0].path.split('/');
  assert.equal(yyyy, '2026');
  assert.equal(mm, '08');
  assert.equal(dd, '28');
  delete process.env.BLOB_READ_WRITE_TOKEN;
});
