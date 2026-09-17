// Node built-in test runner. Run: node --test --experimental-test-module-mocks lib/suggestions/blob-source.test.ts
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

type ListedBlob = { url: string };
let blobsByPrefix: Record<string, ListedBlob[]> = {};

mock.module('@vercel/blob', {
  namedExports: {
    list: async (opts: { prefix?: string }) => {
      const blobs = blobsByPrefix[opts.prefix ?? ''] ?? [];
      return { blobs, hasMore: false };
    },
  },
} as Parameters<typeof mock.module>[1]);

const { listSuggestions } = await import('./blob-source.ts');

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

test('no BLOB_READ_WRITE_TOKEN -> [] without ever calling list()', async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  blobsByPrefix = { 'suggestions/': [{ url: 'https://blob.example/should-not-be-fetched.json' }] };
  const suggestions = await listSuggestions();
  assert.deepEqual(suggestions, []);
});

test('lists the suggestions/ prefix, fetches each blob, drops malformed ones', async (t) => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  blobsByPrefix = {
    'suggestions/': [{ url: 'https://blob.example/a.json' }, { url: 'https://blob.example/b.json' }],
  };

  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('a.json')) {
      return jsonResponse({ submitted_at: '2026-09-17T10:00:00.000Z', ip_hash: 'hasha', text: 'add a map' });
    }
    return jsonResponse({ garbage: true }); // malformed -- must be dropped, not thrown
  });

  const suggestions = await listSuggestions();
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].text, 'add a map');
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

test('sorts by submitted_at ascending regardless of listing order', async (t) => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  blobsByPrefix = {
    'suggestions/': [{ url: 'https://blob.example/later.json' }, { url: 'https://blob.example/earlier.json' }],
  };

  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('later.json')) {
      return jsonResponse({ submitted_at: '2026-09-17T12:00:00.000Z', ip_hash: 'h1', text: 'second' });
    }
    return jsonResponse({ submitted_at: '2026-09-17T10:00:00.000Z', ip_hash: 'h2', text: 'first' });
  });

  const suggestions = await listSuggestions();
  assert.deepEqual(
    suggestions.map((s) => s.text),
    ['first', 'second'],
  );
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

test('a fetch rejection for one blob does not fail the whole read', async (t) => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  blobsByPrefix = {
    'suggestions/': [{ url: 'https://blob.example/ok.json' }, { url: 'https://blob.example/bad.json' }],
  };

  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('bad.json')) throw new Error('network blip');
    return jsonResponse({ submitted_at: '2026-09-17T10:00:00.000Z', ip_hash: 'h', text: 'ok one' });
  });

  const suggestions = await listSuggestions();
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].text, 'ok one');
  delete process.env.BLOB_READ_WRITE_TOKEN;
});
