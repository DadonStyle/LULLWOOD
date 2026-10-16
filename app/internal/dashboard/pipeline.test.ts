// Run: node --test app/internal/dashboard/pipeline.test.ts
//
// End-to-end check of the dashboard's acceptance test: real aggregated numbers
// from at least one seeded event of each type. Drives the *real* POST handler
// (app/api/telemetry/route.ts), the *real* stats service on the founder's
// server (services/leaderboard-db/, run in-process by test-harness.ts) and the
// *real* dashboard read path (lib/dashboard/event-source.ts + aggregate.ts) --
// no mocked storage, no mocked aggregation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../../api/telemetry/route.ts';
import { fetchEvents } from '../../../lib/dashboard/event-source.ts';
import { computeFunnel, computeOutcomes, computeSessions, computeFeatureEngagement } from '../../../lib/dashboard/aggregate.ts';
import { startTestService } from '../../../services/leaderboard-db/test-harness.ts';

let svc: Awaited<ReturnType<typeof startTestService>>;
before(async () => { svc = await startTestService('p'.repeat(48)); });
after(async () => { await svc.stop(); });

function postEvent(payload: Record<string, unknown>): Promise<Response> {
  const json = JSON.stringify(payload);
  return POST(new Request('http://localhost/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'content-length': String(json.length) },
    body: json,
  }));
}

test('all 7 event types: POST -> stats service -> dashboard read -> non-trivial aggregates', async () => {
  const now = Date.now();
  const envelope = (event: string, extra: Record<string, unknown> = {}, anon_id = 'seed-anon') =>
    ({ event, ts: now, anon_id, build_sha: 'abc1234', path: '/', ...extra });

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

  const events = await fetchEvents('24h');
  assert.equal(events.length, 7, 'the dashboard read path should see exactly the 7 seeded events');

  assert.deepEqual(computeFunnel(events).map((s) => s.count), [1, 1, 1, 1]);
  const outcomes = computeOutcomes(events);
  assert.equal(outcomes.winCount, 1);
  assert.equal(outcomes.lossCount, 1);
  assert.equal(outcomes.winRatePct, 50);
  assert.equal(outcomes.lossByPredator.bear, 1);
  const sessions = computeSessions(events);
  assert.equal(sessions.sessionCount, 1);
  assert.equal(sessions.reachedGameplayRatePct, 100);
  assert.deepEqual(computeFeatureEngagement(events), [{ feature: 'hide', action: 'used', count: 1 }]);
});
