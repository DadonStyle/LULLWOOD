// Node built-in test runner. Run: node --test --experimental-test-module-mocks app/api/suggestions/route.test.ts
// LUL-2993: the route now writes to the same Vercel Blob store
// app/api/telemetry/route.ts uses (local disk never persisted anything in
// production -- see route.ts's LUL-2993 comment), so tests mock @vercel/blob
// exactly like telemetry's route.test.ts instead of pointing at a temp dir.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let ipCounter = 0;
function freshIp(): string {
  ipCounter++;
  return `203.0.113.${ipCounter % 255}`;
}

// One in-memory store shared by the mocked put()/list()/fetch() so a test
// can prove a POSTed suggestion is actually readable back out, the way it
// would be in production -- not just that put() was called.
let blobStore: Map<string, string>;
let putShouldFail = false;

mock.module('@vercel/blob', {
  namedExports: {
    put: async (path: string, body: string) => {
      if (putShouldFail) throw new Error('network blip');
      blobStore.set(path, body);
      return { url: `https://blob.example/${path}` };
    },
    list: async (opts: { prefix?: string }) => {
      const prefix = opts.prefix ?? '';
      const blobs = [...blobStore.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ url: `https://blob.example/${k}` }));
      return { blobs, hasMore: false };
    },
  },
} as Parameters<typeof mock.module>[1]);

const { listSuggestions } = await import('../../../lib/suggestions/blob-source.ts');

async function importFreshRoute() {
  // Cache-busting query param forces a fresh module evaluation, which resets
  // the route's module-level rate-limit/cooldown counters -- required so
  // tests don't inherit state left by earlier tests. The @vercel/blob mock
  // above stays shared (module identity doesn't change), so blobStore below
  // is still the source of truth across a fresh route import.
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

async function withToken<T>(fn: () => Promise<T>): Promise<T> {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  blobStore = new Map();
  try {
    return await fn();
  } finally {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  }
}

function noCooldown<T>(fn: () => Promise<T>): Promise<T> {
  process.env.SUGGESTIONS_COOLDOWN_MS_TEST_OVERRIDE = '0';
  return Promise.resolve(fn()).finally(() => {
    delete process.env.SUGGESTIONS_COOLDOWN_MS_TEST_OVERRIDE;
  });
}

// Mocks globalThis.fetch the way listSuggestions() expects: resolving each
// blob URL back to the JSON body stored under it, exactly as it would run
// against the real Blob CDN. Environment has no local disk at any point.
function withFetchOverBlobStore<T>(t: { mock: { method: typeof mock.method } }, fn: () => Promise<T>): Promise<T> {
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const key = url.replace('https://blob.example/', '');
    const body = blobStore.get(key);
    return { ok: body !== undefined, json: async () => (body ? JSON.parse(body) : null) } as Response;
  });
  return fn();
}

test('valid text -> 204 and the suggestion is readable back through the Blob store', async (t) => {
  await withToken(async () => {
    const { POST } = await importFreshRoute();
    const res = await POST(makeReq({ text: 'add a second forest map' }, freshIp()));
    assert.equal(res.status, 204);

    const suggestions = await withFetchOverBlobStore(t, () => listSuggestions());
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].text, 'add a second forest map');
    assert.match(suggestions[0].submitted_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof suggestions[0].ip_hash, 'string');
    assert.notEqual(suggestions[0].ip_hash, '');
  });
});

test('digits, punctuation and uppercase are rejected -> 400, nothing written', async () => {
  await withToken(async () => {
    const { POST } = await importFreshRoute();
    const bad = ['has a 1 in it', 'semi;colon', 'Capital Letter', 'emoji 🙂 here', ''];
    for (const text of bad) {
      const res = await POST(makeReq({ text }, freshIp()));
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(text)}`);
    }
    assert.equal(blobStore.size, 0);
  });
});

test('under 3 chars and over 300 chars are rejected -> 400', async () => {
  await withToken(async () => {
    const { POST } = await importFreshRoute();
    const tooShort = await POST(makeReq({ text: 'ab' }, freshIp()));
    assert.equal(tooShort.status, 400);

    const tooLong = await POST(makeReq({ text: 'a'.repeat(301) }, freshIp()));
    assert.equal(tooLong.status, 400);

    const atMax = await POST(makeReq({ text: 'a'.repeat(300) }, freshIp()));
    assert.equal(atMax.status, 204);
  });
});

test('honeypot filled -> 204, nothing written', async () => {
  await withToken(async () => {
    const { POST } = await importFreshRoute();
    const res = await POST(
      makeReq({ text: 'a real looking suggestion here', website: 'http://spam.example' }, freshIp()),
    );
    assert.equal(res.status, 204);
    assert.equal(blobStore.size, 0);
  });
});

test('missing BLOB_READ_WRITE_TOKEN -> 503, not a silent success', async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const { POST } = await importFreshRoute();
  const res = await POST(makeReq({ text: 'a fine suggestion text' }, freshIp()));
  assert.equal(res.status, 503);
});

test('Blob put() failure -> 503, not a 500', async () => {
  await withToken(async () => {
    putShouldFail = true;
    try {
      const { POST } = await importFreshRoute();
      const res = await POST(makeReq({ text: 'a fine suggestion text' }, freshIp()));
      assert.equal(res.status, 503);
    } finally {
      putShouldFail = false;
    }
  });
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

test('second request within 10s from the same IP -> 429, first still succeeded', async () => {
  await withToken(async () => {
    const { POST } = await importFreshRoute();
    const ip = freshIp();
    const first = await POST(makeReq({ text: 'a fine suggestion text here' }, ip));
    assert.equal(first.status, 204);

    const second = await POST(makeReq({ text: 'another suggestion right after' }, ip));
    assert.equal(second.status, 429);
    const body = await second.json();
    assert.match(body.error, /wait/i);
  });
});

const IP_LIMIT_FOR_TEST = 5;

test('per-IP rate limit: 6th request within an hour from the same IP -> 429', async () => {
  await withToken(async () => {
    await noCooldown(async () => {
      const { POST } = await importFreshRoute();
      const ip = freshIp();
      for (let i = 0; i < IP_LIMIT_FOR_TEST; i++) {
        const res = await POST(makeReq({ text: 'a fine suggestion text here' }, ip));
        assert.equal(res.status, 204, `request ${i} should succeed`);
      }
      const sixth = await POST(makeReq({ text: 'one suggestion too many' }, ip));
      assert.equal(sixth.status, 429);
    });
  });
});

test('global rate limit: 201st accepted request in the window -> 429', async () => {
  await withToken(async () => {
    const { POST } = await importFreshRoute();
    let lastStatus = 0;
    for (let i = 0; i < 200; i++) {
      const res = await POST(makeReq({ text: 'a fine suggestion text here' }, freshIp()));
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 204);
    const overCap = await POST(makeReq({ text: 'a fine suggestion text here' }, freshIp()));
    assert.equal(overCap.status, 429);
  });
});
