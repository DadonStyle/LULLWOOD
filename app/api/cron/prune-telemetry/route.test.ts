// Node built-in test runner. Run: node --test --experimental-test-module-mocks app/api/cron/prune-telemetry/route.test.ts
// The route uses web-standard Request/Response (no next/server import), so
// only @vercel/blob needs to be mocked here.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const listCalls: Array<{ prefix?: string; cursor?: string }> = [];
const delCalls: string[][] = [];
let listPages: Array<{ blobs: Array<{ pathname: string }>; hasMore: boolean; cursor?: string }> = [];

mock.module('@vercel/blob', {
  namedExports: {
    list: async (opts: { prefix?: string; cursor?: string }) => {
      listCalls.push(opts);
      const page = listPages[listCalls.length - 1] ?? { blobs: [], hasMore: false };
      return page;
    },
    del: async (pathnames: string[]) => {
      delCalls.push(pathnames);
    },
  },
} as Parameters<typeof mock.module>[1]);

const { GET } = await import('./route.ts');

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/prune-telemetry', { headers });
}

function reset(pages: typeof listPages) {
  listCalls.length = 0;
  delCalls.length = 0;
  listPages = pages;
}

test('no secret configured → 401', async () => {
  reset([]);
  delete process.env.CRON_SECRET;
  const res = await GET(makeReq());
  assert.equal(res.status, 401);
});

test('wrong secret → 401', async () => {
  reset([]);
  process.env.CRON_SECRET = 'correct-secret';
  const res = await GET(makeReq({ authorization: 'Bearer wrong-secret' }));
  assert.equal(res.status, 401);
  delete process.env.CRON_SECRET;
});

test('missing authorization header → 401', async () => {
  reset([]);
  process.env.CRON_SECRET = 'correct-secret';
  const res = await GET(makeReq());
  assert.equal(res.status, 401);
  delete process.env.CRON_SECRET;
});

test('correct secret but no blob token → 204, no list/del calls', async () => {
  reset([]);
  process.env.CRON_SECRET = 'correct-secret';
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const res = await GET(makeReq({ authorization: 'Bearer correct-secret' }));
  assert.equal(res.status, 204);
  assert.equal(listCalls.length, 0);
  delete process.env.CRON_SECRET;
});

function recentEventPath(name: string): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday, well inside the 30d window
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `events/${yyyy}/${mm}/${dd}/${name}.json`;
}

test('happy path: paginated list, prunes old blobs, keeps recent ones', async () => {
  process.env.CRON_SECRET = 'correct-secret';
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  const oldPath = 'events/2020/01/01/old.json';
  const recentPath = recentEventPath('recent');
  reset([
    { blobs: [{ pathname: oldPath }], hasMore: true, cursor: 'page2' },
    { blobs: [{ pathname: recentPath }], hasMore: false },
  ]);

  const res = await GET(makeReq({ authorization: 'Bearer correct-secret' }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { scanned: number; deleted: number };
  assert.equal(body.scanned, 2);
  assert.equal(body.deleted, 1);
  assert.equal(listCalls.length, 2);
  assert.deepEqual(delCalls, [[oldPath]]);

  delete process.env.CRON_SECRET;
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

test('no prunable blobs → del is never called', async () => {
  process.env.CRON_SECRET = 'correct-secret';
  process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
  reset([{ blobs: [{ pathname: recentEventPath('recent') }], hasMore: false }]);

  const res = await GET(makeReq({ authorization: 'Bearer correct-secret' }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { scanned: number; deleted: number };
  assert.equal(body.scanned, 1);
  assert.equal(body.deleted, 0);
  assert.equal(delCalls.length, 0);

  delete process.env.CRON_SECRET;
  delete process.env.BLOB_READ_WRITE_TOKEN;
});
