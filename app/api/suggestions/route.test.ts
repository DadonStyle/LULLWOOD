// Node built-in test runner. Run: node --test app/api/suggestions/route.test.ts
// LUL-2963: the route now writes to local disk instead of the Paperclip
// issues API, so tests point SUGGESTIONS_STORAGE_DIR at a throwaway temp
// directory instead of mocking fetch/credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let ipCounter = 0;
function freshIp(): string {
  ipCounter++;
  return `203.0.113.${ipCounter % 255}`;
}

async function importFreshRoute() {
  // Cache-busting query param forces a fresh module evaluation, which resets
  // the route's module-level rate-limit/cooldown counters -- required so
  // tests don't inherit state left by earlier tests.
  return import(`./route.ts?fresh=${Date.now()}-${Math.random()}`);
}

function makeReq(body: unknown, ip: string, extraHeaders: Record<string, string> = {}): Request {
  const json = JSON.stringify(body);
  return new Request('http://localhost/api/suggestions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'content-length': String(json.length),
      'x-forwarded-for': ip,
      ...extraHeaders,
    },
    body: json,
  });
}

async function withStorageDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'lullwood-suggestions-test-'));
  process.env.SUGGESTIONS_STORAGE_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    delete process.env.SUGGESTIONS_STORAGE_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

function noCooldown<T>(fn: () => Promise<T>): Promise<T> {
  process.env.SUGGESTIONS_COOLDOWN_MS_TEST_OVERRIDE = '0';
  return Promise.resolve(fn()).finally(() => {
    delete process.env.SUGGESTIONS_COOLDOWN_MS_TEST_OVERRIDE;
  });
}

test('valid text -> 204 and appends exactly one sanitized JSON line to the storage file', async () => {
  await withStorageDir(async (dir) => {
    const { POST } = await importFreshRoute();
    const res = await POST(makeReq({ text: 'add a second forest map' }, freshIp()));
    assert.equal(res.status, 204);

    const contents = await readFile(path.join(dir, 'suggestions.ndjson'), 'utf8');
    const lines = contents.trim().split('\n');
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.text, 'add a second forest map');
    assert.match(record.submitted_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof record.ip_hash, 'string');
    assert.notEqual(record.ip_hash, '');
  });
});

test('digits, punctuation and uppercase are rejected -> 400, nothing written', async () => {
  await withStorageDir(async () => {
    const { POST } = await importFreshRoute();
    const bad = ['has a 1 in it', 'semi;colon', 'Capital Letter', 'emoji 🙂 here', ''];
    for (const text of bad) {
      const res = await POST(makeReq({ text }, freshIp()));
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(text)}`);
    }
  });
});

test('under 3 chars and over 300 chars are rejected -> 400', async () => {
  await withStorageDir(async () => {
    const { POST } = await importFreshRoute();
    const tooShort = await POST(makeReq({ text: 'ab' }, freshIp()));
    assert.equal(tooShort.status, 400);

    const tooLong = await POST(makeReq({ text: 'a'.repeat(301) }, freshIp()));
    assert.equal(tooLong.status, 400);

    const atMax = await POST(makeReq({ text: 'a'.repeat(300) }, freshIp()));
    assert.equal(atMax.status, 204);
  });
});

test('honeypot filled -> 204, nothing written', async () => {
  await withStorageDir(async (dir) => {
    const { POST } = await importFreshRoute();
    const res = await POST(
      makeReq({ text: 'a real looking suggestion here', website: 'http://spam.example' }, freshIp()),
    );
    assert.equal(res.status, 204);
    await assert.rejects(() => readFile(path.join(dir, 'suggestions.ndjson')));
  });
});

test('storage directory unwritable -> 503, not a 500', async () => {
  // Point SUGGESTIONS_STORAGE_DIR *through* a plain file so mkdir(recursive)
  // fails with ENOTDIR -- simulates the real production failure mode (no
  // writable disk at all) without needing an actual missing mount.
  const parent = await mkdtemp(path.join(tmpdir(), 'lullwood-suggestions-test-'));
  const blocker = path.join(parent, 'not-a-directory');
  await writeFile(blocker, 'x');
  process.env.SUGGESTIONS_STORAGE_DIR = path.join(blocker, 'suggestions-subdir');
  try {
    const { POST } = await importFreshRoute();
    const res = await POST(makeReq({ text: 'a fine suggestion text' }, freshIp()));
    assert.equal(res.status, 503);
  } finally {
    delete process.env.SUGGESTIONS_STORAGE_DIR;
    await rm(parent, { recursive: true, force: true });
  }
});

test('malformed JSON body -> 400', async () => {
  const { POST } = await importFreshRoute();
  const req = new Request('http://localhost/api/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'content-length': '2' },
    body: '{{',
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
});

test('second request within 10s from the same IP -> 429, first still succeeded', async () => {
  await withStorageDir(async () => {
    const { POST } = await importFreshRoute();
    const ip = freshIp();
    const first = await POST(makeReq({ text: 'a fine suggestion text here' }, ip));
    assert.equal(first.status, 204);

    const second = await POST(makeReq({ text: 'another suggestion right after' }, ip));
    assert.equal(second.status, 429);
    const body = await second.json();
    assert.match(body.error, /wait/i);
  });
});

const IP_LIMIT_FOR_TEST = 5;

test('per-IP rate limit: 6th request within an hour from the same IP -> 429', async () => {
  await withStorageDir(async () => {
    await noCooldown(async () => {
      const { POST } = await importFreshRoute();
      const ip = freshIp();
      for (let i = 0; i < IP_LIMIT_FOR_TEST; i++) {
        const res = await POST(makeReq({ text: 'a fine suggestion text here' }, ip));
        assert.equal(res.status, 204, `request ${i} should succeed`);
      }
      const sixth = await POST(makeReq({ text: 'one suggestion too many' }, ip));
      assert.equal(sixth.status, 429);
    });
  });
});

test('global rate limit: 201st accepted request in the window -> 429', async () => {
  await withStorageDir(async () => {
    const { POST } = await importFreshRoute();
    let lastStatus = 0;
    for (let i = 0; i < 200; i++) {
      const res = await POST(makeReq({ text: 'a fine suggestion text here' }, freshIp()));
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 204);
    const overCap = await POST(makeReq({ text: 'a fine suggestion text here' }, freshIp()));
    assert.equal(overCap.status, 429);
  });
});
