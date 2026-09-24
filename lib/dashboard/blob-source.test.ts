// Node built-in test runner. Run: node --test --experimental-test-module-mocks lib/dashboard/blob-source.test.ts
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

const { fetchEvents, enumerateDayPrefixes, isRange } = await import('./blob-source.ts');

test('enumerateDayPrefixes: single-day window returns one prefix', () => {
  const ts = Date.UTC(2026, 7, 20, 15, 0, 0);
  const prefixes = enumerateDayPrefixes(ts, ts);
  assert.deepEqual(prefixes, ['events/2026/08/20/']);
});

test('enumerateDayPrefixes: window spanning a month boundary covers both months', () => {
  const since = Date.UTC(2026, 6, 31, 23, 0, 0); // 2026-07-31 23:00 UTC
  const until = Date.UTC(2026, 7, 1, 1, 0, 0); // 2026-08-01 01:00 UTC
  const prefixes = enumerateDayPrefixes(since, until);
  assert.deepEqual(prefixes, ['events/2026/07/31/', 'events/2026/08/01/']);
});

test('isRange: only accepts the three known range strings', () => {
  assert.equal(isRange('24h'), true);
  assert.equal(isRange('7d'), true);
  assert.equal(isRange('30d'), true);
  assert.equal(isRange('90d'), false);
  assert.equal(isRange(undefined), false);
});

test('fetchEvents: no BLOB_READ_WRITE_TOKEN -> [] without ever calling list() (LUL-481 not-yet-connected shape)', async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  blobsByPrefix = { 'events/2026/08/20/': [{ pathname: 'events/2026/08/20/should-not-be-fetched.json' }] };
  const events = await fetchEvents('24h');
  assert.deepEqual(events, []);
});

test('fetchEvents: lists per-day prefixes, fetches each blob via authenticated get(), drops malformed ones', async (t) => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  const now = Date.UTC(2026, 7, 20, 12, 0, 0);
  t.mock.timers.enable({ apis: ['Date'], now });

  const todayPrefix = 'events/2026/08/20/';
  blobsByPrefix = {
    [todayPrefix]: [{ pathname: 'events/2026/08/20/a.json' }, { pathname: 'events/2026/08/20/b.json' }],
  };
  bodyByPathname = {
    'events/2026/08/20/a.json': { event: 'page_view', ts: now, anon_id: 'x' },
    'events/2026/08/20/b.json': { garbage: true }, // malformed -- must be dropped, not thrown
  };

  const events = await fetchEvents('24h');
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'page_view');
});

test('fetchEvents: filters out events outside the requested window even if the day folder overlaps it', async (t) => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  const now = Date.UTC(2026, 7, 20, 12, 0, 0);
  t.mock.timers.enable({ apis: ['Date'], now });

  const todayPrefix = 'events/2026/08/20/';
  blobsByPrefix = {
    [todayPrefix]: [{ pathname: 'events/2026/08/20/early.json' }],
  };
  bodyByPathname = {
    // This event is on today's calendar day but ~30 days before "now",
    // well outside a 24h-range's actual millisecond window -- exercise the
    // ts filter regardless.
    'events/2026/08/20/early.json': { event: 'page_view', ts: now - 30 * 24 * 60 * 60 * 1000, anon_id: 'x' },
  };

  const events = await fetchEvents('24h');
  assert.equal(events.length, 0);
});

test('fetchEvents: a get() rejection for one blob does not fail the whole call', async (t) => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  const now = Date.UTC(2026, 7, 20, 12, 0, 0);
  t.mock.timers.enable({ apis: ['Date'], now });

  const todayPrefix = 'events/2026/08/20/';
  blobsByPrefix = {
    [todayPrefix]: [{ pathname: 'events/2026/08/20/ok.json' }, { pathname: 'events/2026/08/20/bad.json' }],
  };
  bodyByPathname = {
    'events/2026/08/20/ok.json': { event: 'win', ts: now, anon_id: 'x', time_survived_ms: 100, seed: 1 },
  };
  getShouldThrowFor = new Set(['events/2026/08/20/bad.json']);

  const events = await fetchEvents('24h');
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'win');
  getShouldThrowFor = new Set();
});
