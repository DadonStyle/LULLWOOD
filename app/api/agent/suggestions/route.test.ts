// Run: node --test app/api/agent/suggestions/route.test.ts
// Reads the queue from the real suggestion service, run in-process
// (services/leaderboard-db/test-harness.ts).
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from './route.ts';
import { startTestService } from '../../../../services/leaderboard-db/test-harness.ts';

let svc: Awaited<ReturnType<typeof startTestService>>;
before(async () => {
  svc = await startTestService('a'.repeat(48));
  svc.db.submitSuggestion('add a map', 'b'.repeat(64), Date.UTC(2026, 8, 17, 10));
  svc.db.submitSuggestion('more owls', 'c'.repeat(64), Date.UTC(2026, 8, 18, 10));
});
after(async () => { await svc.stop(); });
beforeEach(() => { process.env.AGENT_SUGGESTIONS_READ_SECRET = 'test-secret'; });
afterEach(() => { delete process.env.AGENT_SUGGESTIONS_READ_SECRET; });

const makeReq = (headers: Record<string, string> = {}) => new Request('http://localhost/api/agent/suggestions', { headers });

test('AGENT_SUGGESTIONS_READ_SECRET unset -> 404 even with a header set', async () => {
  delete process.env.AGENT_SUGGESTIONS_READ_SECRET;
  assert.equal((await GET(makeReq({ 'x-agent-secret': 'anything' }))).status, 404);
});

test('missing or wrong header -> 404', async () => {
  assert.equal((await GET(makeReq())).status, 404);
  assert.equal((await GET(makeReq({ 'x-agent-secret': 'wrong' }))).status, 404);
});

test('correct header -> 200 with the suggestions queue from the server, oldest first', async () => {
  const res = await GET(makeReq({ 'x-agent-secret': 'test-secret' }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { suggestions: Array<{ text: string; submitted_at: string }> };
  assert.deepEqual(body.suggestions.map((s) => s.text), ['add a map', 'more owls']);
  assert.equal(body.suggestions[0].submitted_at, '2026-09-17T10:00:00.000Z');
});

test('service unreachable -> 503, never an empty queue', async () => {
  svc.down();
  const res = await GET(makeReq({ 'x-agent-secret': 'test-secret' }));
  assert.equal(res.status, 503);
});
