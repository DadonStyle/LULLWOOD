import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { LeaderboardDb } from './db.ts';
import { createService } from './server.ts';

// Test-only: runs the real service (real SQLite, real signature check) on a
// loopback port and points the Vercel routes' fetch() at it, so a route test
// proves what the founder's server actually stored -- not that a mock was
// called. serviceConfig() insists on https, so LEADERBOARD_API_URL is a fake
// https origin that the patched fetch rewrites to the loopback server.
export const FAKE_SERVICE_URL = 'https://lb.example.ts.net';

export async function startTestService(secret: string): Promise<{ db: LeaderboardDb; down: () => void; stop: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'lbtest-'));
  const db = new LeaderboardDb(join(dir, 'lb.db'));
  const server = createService({ db, secret, log: () => {} });
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
