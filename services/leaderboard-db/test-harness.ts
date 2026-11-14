import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { LeaderboardDb } from './db.ts';
import { createService } from './server.ts';
import { createTraceRecorder, recordTracePosition, finishTrace, type RunTrace } from '../../lib/game/run-trace.ts';

/**
 * Test-only: the proof-of-play trace an honest run of `endMs` sends at the
 * lift -- the player walks straight from home to a child 150 u away, one
 * engine frame every 16 ms (lib/game/run-trace.ts).
 */
export function honestTrace(endMs: number): RunTrace {
  const child = { x: 120, z: 90 };
  const rec = createTraceRecorder();
  for (let t = 0; t < endMs; t += 16) recordTracePosition(rec, t, (child.x * t) / endMs, (child.z * t) / endMs);
  return finishTrace(rec, endMs, child.x, child.z, child);
}

// Test-only: runs the real service (real SQLite, real signature check) on a
// loopback port and points the Vercel routes' fetch() at it, so a route test
// proves what the founder's server actually stored -- not that a mock was
// called. serviceConfig() insists on https, so LEADERBOARD_API_URL is a fake
// https origin that the patched fetch rewrites to the loopback server.
export const FAKE_SERVICE_URL = 'https://lb.example.ts.net';

// `now`: the service's clock (signature check and database), for tests that
// play a run session. Keep it within SIGNATURE_MAX_SKEW_MS of Date.now(): the
// routes sign with the real clock.
export async function startTestService(secret: string, now?: () => number, log: (line: string) => void = () => {}): Promise<{ db: LeaderboardDb; down: () => void; stop: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'lbtest-'));
  const db = new LeaderboardDb(join(dir, 'lb.db'));
  const server = createService({ db, secret, now, log });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;
  let reachable = true;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(FAKE_SERVICE_URL)) return realFetch(input, init);
    if (!reachable) return Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }));
    return realFetch(local + url.slice(FAKE_SERVICE_URL.length), init);
  }) as typeof fetch;
  process.env.LEADERBOARD_API_URL = FAKE_SERVICE_URL;
  process.env.LEADERBOARD_API_SECRET = secret;
  return {
    db,
    down: () => { reachable = false; },
    stop: async () => {
      globalThis.fetch = realFetch;
      delete process.env.LEADERBOARD_API_URL;
      delete process.env.LEADERBOARD_API_SECRET;
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
