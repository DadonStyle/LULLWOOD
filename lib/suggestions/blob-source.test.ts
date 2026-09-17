// Node built-in test runner. Run: node --test --experimental-test-module-mocks lib/suggestions/blob-source.test.ts
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

type ListedBlob = { pathname: string };
let blobsByPrefix: Record<string, ListedBlob[]> = {};
let bodyByPathname: Record<string, unknown> = {};
let getShouldThrowFor: Set<string> = new Set();

mock.module('@vercel/blob', {
  namedExports: {
    list: async (opts: { prefix?: string }) => {
      const blobs = blobsByPrefix[opts.prefix ?? ''] ?? [];
      return { blobs, hasMore: false };
    },
    get: async (pathname: string) => {
      if (getShouldThrowFor.has(pathname)) throw new Error('network blip');
      if (!(pathname in bodyByPathname)) return null;
      return { stream: new Response(JSON.stringify(bodyByPathname[pathname])).body, blob: {} };
    },
  },
} as Parameters<typeof mock.module>[1]);

const { listSuggestions } = await import('./blob-source.ts');

test('no BLOB_READ_WRITE_TOKEN -> [] without ever calling list()', async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  blobsByPrefix = { 'suggestions/': [{ pathname: 'suggestions/should-not-be-fetched.json' }] };
  const suggestions = await listSuggestions();
  assert.deepEqual(suggestions, []);
});

test('lists the suggestions/ prefix, fetches each blob, drops malformed ones', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  blobsByPrefix = {
    'suggestions/': [{ pathname: 'suggestions/a.json' }, { pathname: 'suggestions/b.json' }],
  };
  bodyByPathname = {
    'suggestions/a.json': { submitted_at: '2026-09-17T10:00:00.000Z', ip_hash: 'hasha', text: 'add a map' },
    'suggestions/b.json': { garbage: true }, // malformed -- must be dropped, not thrown
  };

  const suggestions = await listSuggestions();
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].text, 'add a map');
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

test('sorts by submitted_at ascending regardless of listing order', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  blobsByPrefix = {
    'suggestions/': [{ pathname: 'suggestions/later.json' }, { pathname: 'suggestions/earlier.json' }],
  };
  bodyByPathname = {
    'suggestions/later.json': { submitted_at: '2026-09-17T12:00:00.000Z', ip_hash: 'h1', text: 'second' },
    'suggestions/earlier.json': { submitted_at: '2026-09-17T10:00:00.000Z', ip_hash: 'h2', text: 'first' },
  };

  const suggestions = await listSuggestions();
  assert.deepEqual(
    suggestions.map((s) => s.text),
    ['first', 'second'],
  );
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

test('a get() rejection for one blob does not fail the whole read', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  blobsByPrefix = {
    'suggestions/': [{ pathname: 'suggestions/ok.json' }, { pathname: 'suggestions/bad.json' }],
  };
  bodyByPathname = {
    'suggestions/ok.json': { submitted_at: '2026-09-17T10:00:00.000Z', ip_hash: 'h', text: 'ok one' },
  };
  getShouldThrowFor = new Set(['suggestions/bad.json']);

  const suggestions = await listSuggestions();
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].text, 'ok one');
  delete process.env.BLOB_READ_WRITE_TOKEN;
  getShouldThrowFor = new Set();
});
