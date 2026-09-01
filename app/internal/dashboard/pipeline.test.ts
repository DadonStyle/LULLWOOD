// Node built-in test runner. Run: node --test --experimental-test-module-mocks app/internal/dashboard/pipeline.test.ts
//
// End-to-end check of the DoD's own acceptance test: "Route returns real
// aggregated numbers when pointed at Blob objects written by M4.2 -- verify
// with at least one seeded event of each of the 7 types." This drives the
// *real* POST handler (app/api/telemetry/route.ts) and the *real* dashboard
// read path (lib/dashboard/blob-source.ts + aggregate.ts) against a single
// in-memory fake of @vercel/blob's put/list -- no mocked aggregation logic.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>(); // pathname -> JSON body

mock.module('@vercel/blob', {
  namedExports: {
    put: async (pathname: string, body: string) => {
      store.set(pathname, body);
      return { url: `fake-blob://${pathname}` };
    },
    list: async (opts: { prefix?: string }) => {
      const prefix = opts.prefix ?? '';
      const blobs = Array.from(store.keys())
        .filter((p) => p.startsWith(prefix))
        .map((p) => ({ url: `fake-blob://${p}`, pathname: p }));
      return { blobs, hasMore: false };
    },
  },
} as Parameters<typeof mock.module>[1]);

const { POST } = await import('../../api/telemetry/route.ts');
const { fetchEvents } = await import('../../../lib/dashboard/blob-source.ts');
const { computeFunnel, computeOutcomes, computeSessions, computeFeatureEngagement } = await import(
  '../../../lib/dashboard/aggregate.ts'
);

function postEvent(payload: Record<string, unknown>): Promise<Response> {
  const json = JSON.stringify(payload);
  return POST(
    new Request('http://localhost/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'content-length': String(json.length) },
      body: json,
    }),
  );
}

test('all 7 event types: POST -> Blob -> dashboard read -> non-trivial aggregates', async (t) => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  t.after(() => delete process.env.BLOB_READ_WRITE_TOKEN);

  // node's fetch is real; point it at the fake blob store instead of the network.
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const pathname = url.replace('fake-blob://', '');
    const body = store.get(pathname);
    if (body === undefined) return { ok: false, json: async () => null } as Response;
    return { ok: true, json: async () => JSON.parse(body) } as Response;
  });

  const now = Date.now();
  const envelope = (event: string, extra: Record<string, unknown> = {}, anon_id = 'seed-anon') => ({
    event,
    ts: now,
    anon_id,
    build_sha: 'test-sha',
    path: '/',
    ...extra,
  });

  const responses = await Promise.all([
    postEvent(envelope('page_view')),
    postEvent(envelope('cta_start_clicked')),
    postEvent(envelope('game_start', { seed: 1 })),
    postEvent(envelope('win', { time_survived_ms: 12000, seed: 1 })),
    postEvent(envelope('loss', { predator_kind: 'bear', time_survived_ms: 8000, seed: 2 }, 'seed-anon-2')),
    postEvent(envelope('session_length', { duration_ms: 20000, reached_gameplay: true })),
    postEvent(envelope('feature_engagement', { feature: 'hide', action: 'used' })),
  ]);
  for (const res of responses) assert.equal(res.status, 204);
  assert.equal(store.size, 7, 'all 7 events should have actually been written to the fake Blob store');

  const events = await fetchEvents('24h');
  assert.equal(events.length, 7, 'the dashboard read path should see exactly the 7 seeded events');

  const funnel = computeFunnel(events);
  assert.deepEqual(
    funnel.map((s) => s.count),
    [1, 1, 1, 1],
  );

  const outcomes = computeOutcomes(events);
  assert.equal(outcomes.winCount, 1);
  assert.equal(outcomes.lossCount, 1);
  assert.equal(outcomes.winRatePct, 50);
  assert.equal(outcomes.lossByPredator.bear, 1);

  const sessions = computeSessions(events);
  assert.equal(sessions.sessionCount, 1);
  assert.equal(sessions.reachedGameplayRatePct, 100);

  const featureEngagement = computeFeatureEngagement(events);
  assert.deepEqual(featureEngagement, [{ feature: 'hide', action: 'used', count: 1 }]);
});
