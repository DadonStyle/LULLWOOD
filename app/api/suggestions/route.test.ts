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

// One in-memory store shared by the mocked put()/list()/get() so a test can
// prove a POSTed suggestion is actually readable back out, the way it would
// be in production -- not just that put() was called. Suggestions are
// written with access: 'private' (LUL-2993), so the read side is get(), not
// a plain fetch() of a public URL.
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
      const blobs = [...blobStore.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ pathname: k }));
      return { blobs, hasMore: false };
    },
    get: async (pathname: string) => {
      const body = blobStore.get(pathname);
      if (body === undefined) return null;
      return { stream: new Response(body).body, blob: {} };
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
  process.env.SUGGESTIONS_IP_HASH_SALT = 'test-salt';
  blobStore = new Map();
  try {
    return await fn();
  } finally {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.SUGGESTIONS_IP_HASH_SALT;
  }
}

function noCooldown<T>(fn: () => Promise<T>): Promise<T> {
  process.env.SUGGESTIONS_COOLDOWN_MS_TEST_OVERRIDE = '0';
  return Promise.resolve(fn()).finally(() => {
    delete process.env.SUGGESTIONS_COOLDOWN_MS_TEST_OVERRIDE;
  });
}

test('valid text -> 204 and the suggestion is readable back through the Blob store', async () => {
  await withToken(async () => {
    const { POST } = await importFreshRoute();
    const res = await POST(makeReq({ text: 'add a second forest map' }, freshIp()));
    assert.equal(res.status, 204);

    const suggestions = await listSuggestions();
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

// LUL-3288 A1: a client used to fully control rate-limit bucketing by
// setting the FIRST hop of X-Forwarded-For and rotating it per request.
// Vercel's edge appends the real client IP as the hop closest to the
// server, so the fix reads the LAST hop (or x-vercel-forwarded-for, which
// Vercel sets itself and a client cannot override in production).
test('A1: rotating the spoofable leading X-Forwarded-For hop does not bypass the cooldown', async () => {
  await withToken(async () => {
    const { POST } = await importFreshRoute();
    const trustedIp = freshIp();
    const first = await POST(makeReq({ text: 'a fine suggestion text here' }, `9.9.9.9, ${trustedIp}`));
    assert.equal(first.status, 204);

    // Attacker rotates the client-controlled first hop on every request;
    // the trusted last hop (what a real proxy would append) is unchanged.
    const second = await POST(makeReq({ text: 'another suggestion right after' }, `1.2.3.4, ${trustedIp}`));
    assert.equal(second.status, 429);
  });
});

test('A1: x-vercel-forwarded-for is preferred over a spoofed x-forwarded-for', async () => {
  await withToken(async () => {
    const { POST } = await importFreshRoute();
    const trustedIp = freshIp();
    const first = await POST(
      makeReq({ text: 'a fine suggestion text here' }, '203.0.113.250', { 'x-vercel-forwarded-for': trustedIp }),
    );
    assert.equal(first.status, 204);

    const second = await POST(
      makeReq({ text: 'another suggestion right after' }, '198.51.100.1', { 'x-vercel-forwarded-for': trustedIp }),
    );
    assert.equal(second.status, 429);
  });
});

// LUL-3288 A2: an unset SUGGESTIONS_IP_HASH_SALT used to silently degrade to
// sha256(ip) -- reversible across the whole IPv4 space in minutes. The fix
// fails closed instead.
test('A2: missing SUGGESTIONS_IP_HASH_SALT -> 503, never an empty-salt hash', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  delete process.env.SUGGESTIONS_IP_HASH_SALT;
  blobStore = new Map();
  try {
    const { POST } = await importFreshRoute();
    const res = await POST(makeReq({ text: 'a fine suggestion text here' }, freshIp()));
    assert.equal(res.status, 503);
    assert.equal(blobStore.size, 0);
  } finally {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  }
});

test('A2: empty-string SUGGESTIONS_IP_HASH_SALT is treated the same as unset -> 503', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  process.env.SUGGESTIONS_IP_HASH_SALT = '';
  blobStore = new Map();
  try {
    const { POST } = await importFreshRoute();
    const res = await POST(makeReq({ text: 'a fine suggestion text here' }, freshIp()));
    assert.equal(res.status, 503);
  } finally {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.SUGGESTIONS_IP_HASH_SALT;
  }
});

// LUL-3288 A3: the old cooldown/rate-limit counters were plain module-scope
// Maps, so a fresh module import (the test suite's stand-in for a cold
// start / a second concurrent Lambda instance) reset them completely. State
// now lives in the Blob store, keyed by IP hash, so it survives a fresh
// import of the route module -- this test is the regression guard for that.
test('A3: cooldown survives a simulated cold start (fresh module import, same Blob store)', async () => {
  await withToken(async () => {
    const ip = freshIp();
    const routeA = await importFreshRoute();
    const first = await routeA.POST(makeReq({ text: 'a fine suggestion text here' }, ip));
    assert.equal(first.status, 204);

    // A brand new module instance -- as a new Lambda invocation would get --
    // must still see the cooldown because it reads the same Blob object.
    const routeB = await importFreshRoute();
    const second = await routeB.POST(makeReq({ text: 'another suggestion right after' }, ip));
    assert.equal(second.status, 429);
  });
});

test('A3: per-IP rate limit survives a simulated cold start between every request', async () => {
  await withToken(async () => {
    await noCooldown(async () => {
      const ip = freshIp();
      for (let i = 0; i < IP_LIMIT_FOR_TEST; i++) {
        const { POST } = await importFreshRoute();
        const res = await POST(makeReq({ text: 'a fine suggestion text here' }, ip));
        assert.equal(res.status, 204, `request ${i} should succeed`);
      }
      const { POST } = await importFreshRoute();
      const sixth = await POST(makeReq({ text: 'one suggestion too many' }, ip));
      assert.equal(sixth.status, 429);
    });
  });
});
