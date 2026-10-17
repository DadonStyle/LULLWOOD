// Run: node --test app/api/telemetry/route.test.ts
// Founder 2026-10-16: events are stored only in the stats database on the
// founder's server (no Vercel Blob copy). These tests run that real service
// in-process (services/leaderboard-db/test-harness.ts) behind the route.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from './route.ts';
import { startTestService } from '../../../services/leaderboard-db/test-harness.ts';

let svc: Awaited<ReturnType<typeof startTestService>>;
before(async () => { svc = await startTestService('m'.repeat(48)); });
after(async () => { await svc.stop(); });
beforeEach(() => { svc.db.db.exec('DELETE FROM events; DELETE FROM runs'); });

let anon = 0;
function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('http://localhost/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'content-length': String(json.length), ...headers },
    body: json,
  });
}
const validPayload = (event = 'page_view', extra: Record<string, unknown> = {}) =>
  ({ event, ts: Date.now(), anon_id: `test-anon-${++anon}`, build_sha: 'abc1234', path: '/', ...extra });
const storedEvents = () => (svc.db.db.prepare('SELECT event FROM events ORDER BY id').all() as Array<{ event: string }>).map((r) => r.event);

test('every valid event name -> 204 and is stored in the stats database', async () => {
  const events = [
    validPayload('page_view'),
    validPayload('cta_start_clicked'),
    validPayload('game_start', { seed: 42 }),
    validPayload('win', { time_survived_ms: 1000, seed: 42 }),
    validPayload('loss', { predator_kind: 'wolf', time_survived_ms: 500, seed: 42 }),
    validPayload('session_length', { duration_ms: 10000, reached_gameplay: true }),
    validPayload('feature_engagement', { feature: 'hide', action: 'used' }),
    validPayload('engine_contract_violation', { missing_keys: ['setMissionUnlocks'] }),
    validPayload('chase_gap', { duration_ms: 2500, difficulty: 'normal' }),
    validPayload('started_tiers', { tiers: { quietStep: 1, pocketStones: 0 } }), // LUL-2998
    validPayload('win', { time_survived_ms: 1000, seed: 42, purchases_made: [{ id: 'quietStep', tier: 1, cost: 150 }] }),
  ];
  for (const payload of events) assert.equal((await POST(makeReq(payload))).status, 204, payload.event);
  assert.deepEqual(storedEvents(), events.map((e) => e.event));
  assert.equal(Number((svc.db.db.prepare("SELECT count(*) AS n FROM runs WHERE outcome = 'win'").get() as { n: number }).n), 2);
});

test('unknown event, invalid json, missing envelope fields -> 400; over 2KB -> 413; nothing stored', async () => {
  assert.equal((await POST(makeReq({ ...validPayload(), event: 'nope' }))).status, 400);
  assert.equal((await POST(makeReq('{bad'))).status, 400);
  assert.equal((await POST(makeReq({ event: 'page_view', ts: Date.now() }))).status, 400);
  assert.equal((await POST(makeReq(validPayload('page_view', { pad: 'x'.repeat(3000) })))).status, 413);
  assert.deepEqual(storedEvents(), []);
});

test('service unconfigured or unreachable -> still 204 to the beacon, never a 5xx', async () => {
  const url = process.env.LEADERBOARD_API_URL;
  delete process.env.LEADERBOARD_API_URL;
  assert.equal((await POST(makeReq(validPayload()))).status, 204);
  process.env.LEADERBOARD_API_URL = url;
  svc.down();
  assert.equal((await POST(makeReq(validPayload()))).status, 204);
});
