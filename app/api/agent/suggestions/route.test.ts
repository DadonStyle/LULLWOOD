// Node built-in test runner. Run: node --test --experimental-test-module-mocks app/api/agent/suggestions/route.test.ts
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

type ListedBlob = { pathname: string };
let blobsByPrefix: Record<string, ListedBlob[]> = {};
let bodyByPathname: Record<string, unknown> = {};

mock.module('@vercel/blob', {
  namedExports: {
    list: async (opts: { prefix?: string }) => {
      const blobs = blobsByPrefix[opts.prefix ?? ''] ?? [];
      return { blobs, hasMore: false };
    },
    get: async (pathname: string) => {
      if (!(pathname in bodyByPathname)) return null;
      return { stream: new Response(JSON.stringify(bodyByPathname[pathname])).body, blob: {} };
    },
  },
} as Parameters<typeof mock.module>[1]);

const { GET } = await import('./route.ts');

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/agent/suggestions', { headers });
}

async function withSecretAndData<T>(fn: () => Promise<T>): Promise<T> {
  process.env.AGENT_SUGGESTIONS_READ_SECRET = 'test-secret';
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  blobsByPrefix = {
    'suggestions/': [{ pathname: 'suggestions/a.json' }],
  };
  bodyByPathname = {
    'suggestions/a.json': { submitted_at: '2026-09-17T10:00:00.000Z', ip_hash: 'h', text: 'add a map' },
  };
  try {
    return await fn();
  } finally {
    delete process.env.AGENT_SUGGESTIONS_READ_SECRET;
    delete process.env.BLOB_READ_WRITE_TOKEN;
  }
}

test('AGENT_SUGGESTIONS_READ_SECRET unset -> 404 even with a header set', async () => {
  delete process.env.AGENT_SUGGESTIONS_READ_SECRET;
  const res = await GET(makeReq({ 'x-agent-secret': 'anything' }));
  assert.equal(res.status, 404);
});

test('missing header -> 404', async () => {
  await withSecretAndData(async () => {
    const res = await GET(makeReq());
    assert.equal(res.status, 404);
  });
});

test('wrong header value -> 404', async () => {
  await withSecretAndData(async () => {
    const res = await GET(makeReq({ 'x-agent-secret': 'wrong' }));
    assert.equal(res.status, 404);
  });
});

test('correct header -> 200 with the suggestions queue, oldest first', async () => {
  await withSecretAndData(async () => {
    const res = await GET(makeReq({ 'x-agent-secret': 'test-secret' }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { suggestions: Array<{ text: string }> };
    assert.equal(body.suggestions.length, 1);
    assert.equal(body.suggestions[0].text, 'add a map');
  });
});
