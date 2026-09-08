// Node built-in test runner. Run: node --test app/api/suggestions/route.test.ts
// The route uses web-standard Request/Response (no next/server import), so
// only global fetch (the outbound Paperclip API call) needs mocking here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let ipCounter = 0;
function freshIp(): string {
  ipCounter++;
  return `203.0.113.${ipCounter % 255}`;
}

async function importFreshRoute() {
  // Cache-busting query param forces a fresh module evaluation, which resets
  // the route's module-level rate-limit counters -- required so the two
  // rate-limit tests below don't inherit counts left by earlier tests.
  return import(`./route.ts?fresh=${Date.now()}-${Math.random()}`);
}

function makeReq(body: unknown, ip: string, extraHeaders: Record<string, string> = {}): Request {
  const json = JSON.stringify(body);
  return new Request('http://localhost/api/suggestions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'content-length': String(json.length),
      'x-forwarded-for': ip,
      ...extraHeaders,
    },
    body: json,
  });
}

function withCredential<T>(fn: () => Promise<T>): Promise<T> {
  process.env.SUGGESTIONS_PAPERCLIP_TOKEN = 'test-token';
  process.env.SUGGESTIONS_PAPERCLIP_API_URL = 'https://example.invalid';
  process.env.SUGGESTIONS_PAPERCLIP_COMPANY_ID = 'test-company-id';
  return fn().finally(() => {
    delete process.env.SUGGESTIONS_PAPERCLIP_TOKEN;
    delete process.env.SUGGESTIONS_PAPERCLIP_API_URL;
    delete process.env.SUGGESTIONS_PAPERCLIP_COMPANY_ID;
  });
}

function mockFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

test('valid text + credential set -> 204 and posts exactly one create-issue call', async () => {
  const { POST } = await importFreshRoute();
  const calls: Array<{ url: string; body: string }> = [];
  const restore = mockFetch((async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init.body) });
    return new Response(null, { status: 200 });
  }) as typeof fetch);

  await withCredential(async () => {
    const res = await POST(makeReq({ text: 'add a second forest map' }, freshIp()));
    assert.equal(res.status, 204);
  });

  restore();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/companies\/test-company-id\/issues$/);
  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.title, '[SUGGESTION] add a second forest map');
  assert.equal(sent.status, 'backlog');
  assert.match(sent.description, /Untrusted player text/);
  assert.match(sent.description, /add a second forest map/);
});

test('digits, punctuation and uppercase are rejected -> 400, no fetch call', async () => {
  const { POST } = await importFreshRoute();
  let fetchCalled = false;
  const restore = mockFetch((async () => {
    fetchCalled = true;
    return new Response(null, { status: 200 });
  }) as typeof fetch);

  const bad = ['has a 1 in it', 'semi;colon', 'Capital Letter', 'emoji 🙂 here', ''];
  for (const text of bad) {
    const res = await POST(makeReq({ text }, freshIp()));
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(text)}`);
  }

  restore();
  assert.equal(fetchCalled, false);
});

test('under 3 chars and over 300 chars are rejected -> 400', async () => {
  const { POST } = await importFreshRoute();
  const tooShort = await POST(makeReq({ text: 'ab' }, freshIp()));
  assert.equal(tooShort.status, 400);

  const tooLong = await POST(makeReq({ text: 'a'.repeat(301) }, freshIp()));
  assert.equal(tooLong.status, 400);

  const atMax = await withCredential(async () => {
    const restore = mockFetch((async () => new Response(null, { status: 200 })) as typeof fetch);
    const res = await POST(makeReq({ text: 'a'.repeat(300) }, freshIp()));
    restore();
    return res;
  });
  assert.equal(atMax.status, 204);
});

test('honeypot filled -> 204, no fetch call, nothing created', async () => {
  const { POST } = await importFreshRoute();
  let fetchCalled = false;
  const restore = mockFetch((async () => {
    fetchCalled = true;
    return new Response(null, { status: 200 });
  }) as typeof fetch);

  const res = await POST(
    makeReq({ text: 'a real looking suggestion here', website: 'http://spam.example' }, freshIp()),
  );

  restore();
  assert.equal(res.status, 204);
  assert.equal(fetchCalled, false);
});

test('missing credential env -> 503, request still counted as invalid-config not silently ok', async () => {
  const { POST } = await importFreshRoute();
  const res = await POST(makeReq({ text: 'a fine suggestion text' }, freshIp()));
  assert.equal(res.status, 503);
});

test('malformed JSON body -> 400', async () => {
  const { POST } = await importFreshRoute();
  const req = new Request('http://localhost/api/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'content-length': '2' },
    body: '{{',
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
});

const IP_LIMIT_FOR_TEST = 5;

test('per-IP rate limit: 6th request within an hour from the same IP -> 429', async () => {
  const { POST } = await importFreshRoute();
  const restore = mockFetch((async () => new Response(null, { status: 200 })) as typeof fetch);
  const ip = freshIp();

  await withCredential(async () => {
    for (let i = 0; i < IP_LIMIT_FOR_TEST; i++) {
      const res = await POST(makeReq({ text: 'a fine suggestion text here' }, ip));
      assert.equal(res.status, 204, `request ${i} should succeed`);
    }
    const sixth = await POST(makeReq({ text: 'one suggestion too many' }, ip));
    assert.equal(sixth.status, 429);
  });

  restore();
});

test('global rate limit: 201st accepted request in the window -> 429', async () => {
  const { POST } = await importFreshRoute();
  const restore = mockFetch((async () => new Response(null, { status: 200 })) as typeof fetch);

  await withCredential(async () => {
    let lastStatus = 0;
    for (let i = 0; i < 200; i++) {
      const res = await POST(makeReq({ text: 'a fine suggestion text here' }, freshIp()));
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 204);
    const overCap = await POST(makeReq({ text: 'a fine suggestion text here' }, freshIp()));
    assert.equal(overCap.status, 429);
  });

  restore();
});
