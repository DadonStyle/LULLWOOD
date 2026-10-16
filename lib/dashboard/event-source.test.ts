// Run: node --test lib/dashboard/event-source.test.ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fetchEvents, isRange } from './event-source.ts';
import { startTestService } from '../../services/leaderboard-db/test-harness.ts';

let svc: Awaited<ReturnType<typeof startTestService>>;
before(async () => { svc = await startTestService('e'.repeat(48)); });
after(async () => { await svc.stop(); });

const store = (payload: Record<string, unknown>, receivedAt: number) =>
  svc.db.recordEvent({ event: String(payload.event), eventTs: Number(payload.ts), anonId: null, buildSha: null, path: '/', deviceClass: null, browser: null, country: null, payload }, receivedAt);

test('isRange: only accepts the three known range strings', () => {
  assert.equal(isRange('24h'), true);
  assert.equal(isRange('7d'), true);
  assert.equal(isRange('30d'), true);
  assert.equal(isRange('1y'), false);
  assert.equal(isRange(null), false);
});

test('fetchEvents: returns the window from the stats service, drops malformed and out-of-window events', async () => {
  const now = Date.now();
  const env = { anon_id: 'a', build_sha: 'abc1234', path: '/' };
  store({ event: 'page_view', ts: now - 60_000, ...env }, now - 60_000);
  store({ event: 'win', ts: now - 30_000, time_survived_ms: 9000, ...env }, now - 30_000);
  store({ event: 'game_start', ts: now - 3 * 24 * 60 * 60 * 1000, ...env }, now - 3 * 24 * 60 * 60 * 1000);
  store({ event: 'page_view', ts: 'not-a-number', ...env } as Record<string, unknown>, now - 10_000);
  const day = await fetchEvents('24h');
  assert.deepEqual(day.map((e) => e.event), ['page_view', 'win']);
  assert.equal((await fetchEvents('7d')).length, 3);
});

test('fetchEvents: unconfigured or unreachable service -> [] (dashboard shows zeroes, not a 500)', async () => {
  const url = process.env.LEADERBOARD_API_URL;
  delete process.env.LEADERBOARD_API_URL;
  assert.deepEqual(await fetchEvents('24h'), []);
  process.env.LEADERBOARD_API_URL = url;
  svc.down();
  assert.deepEqual(await fetchEvents('24h'), []);
});
