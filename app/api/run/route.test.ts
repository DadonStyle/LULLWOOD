// Run: node --test app/api/run/route.test.ts
// Server-timed run sessions end to end through the Vercel routes and the real
// leaderboard service (services/leaderboard-db/test-harness.ts). The service's
// clock is Date.now() + `offset`, so a test can say "this run started 31 s
// ago" without waiting; offsets stay inside the 60 s signature window.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { POST as START } from './start/route.ts';
import { POST as FINISH } from './finish/route.ts';
import { POST as SUBMIT } from '../leaderboard/route.ts';
import { startTestService } from '../../../services/leaderboard-db/test-harness.ts';
import { RUN_START_IP_LIMIT } from '../../../lib/game/leaderboard.ts';

let svc: Awaited<ReturnType<typeof startTestService>>;
let offset = 0;
before(async () => {
  svc = await startTestService('r'.repeat(48), () => Date.now() + offset);
  process.env.LEADERBOARD_IP_HASH_SALT = 'pepper';
});
after(async () => {
  await svc.stop();
  delete process.env.LEADERBOARD_IP_HASH_SALT;
});

const ANON = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
let ipSeq = 10;
const nextIp = () => `198.51.100.${++ipSeq}`;

function post(path: string, body: unknown, ip = '198.51.100.7') {
  return new Request(`https://www.lullwoodgame.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** A Blackout run that started `ms` ago by the service clock and was lifted just now. */
async function play(ms: number, ip = nextIp()): Promise<string> {
  offset = -ms;
  const res = await START(post('/api/run/start', { difficulty: 'blackout', anon_id: ANON }, ip));
  offset = 0;
  assert.equal(res.status, 201);
  const { run_id } = await res.json();
  const fin = await FINISH(post('/api/run/finish', { run_id, anon_id: ANON }, ip));
  assert.deepEqual([fin.status, await fin.json()], [200, { ok: true }]);
  return run_id;
}

const holders = () => Number(svc.db.db.prepare('SELECT count(*) AS n FROM record_holders').get()!.n);
const sessions = () => Number(svc.db.db.prepare('SELECT count(*) AS n FROM run_sessions').get()!.n);
const entry = (over: Record<string, unknown> = {}) => ({ nickname: 'ranger', country: 'IL', time_ms: 20_000, anon_id: ANON, ...over });

test('start: answers a run id and stores the session with a salted IP hash, never the raw IP', async () => {
  const res = await START(post('/api/run/start', { difficulty: 'blackout', anon_id: ANON }, '203.0.113.9'));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['run_id']);
  assert.match(body.run_id, /^[0-9a-f]{32}$/);
  const row = svc.db.db.prepare('SELECT * FROM run_sessions WHERE id = ?').get(body.run_id)!;
  assert.equal(row.difficulty, 'blackout');
  assert.equal(row.anon_id, ANON);
  assert.match(String(row.ip_hash), /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(row).includes('203.0.113.9'), false);
});

test('start: a bad body or difficulty is refused before the service is called', async () => {
  const before = sessions();
  for (const bad of [{ difficulty: 'hard' }, { difficulty: 'Blackout' }, {}]) {
    assert.equal((await START(post('/api/run/start', bad))).status, 400, JSON.stringify(bad));
  }
  assert.equal((await START(post('/api/run/start', '{bad'))).status, 400);
  assert.equal((await START(post('/api/run/start', { pad: 'x'.repeat(3000) }))).status, 413);
  assert.equal(sessions(), before);
});

test('finish: a malformed or unknown run id is a 400 with a plain message', async () => {
  for (const run_id of [undefined, 'x', 'A'.repeat(32)]) {
    assert.equal((await FINISH(post('/api/run/finish', { run_id }))).status, 400);
  }
  const res = await FINISH(post('/api/run/finish', { run_id: 'f'.repeat(32), anon_id: ANON }));
  assert.deepEqual([res.status, await res.json()], [400, { error: 'this run could not be verified' }]);
});

test('submit: a run timed by the service is stored with the client time', async () => {
  const run_id = await play(20_000);
  const res = await SUBMIT(post('/api/leaderboard', entry({ time_ms: 20_300, run_id }), nextIp()));
  assert.equal(res.status, 201);
  const row = svc.db.db.prepare('SELECT time_ms FROM record_holders ORDER BY id DESC LIMIT 1').get()!;
  assert.equal(row.time_ms, 20_300);
});

test('submit: no run id, or a malformed one, is a 400 before the service is called', async () => {
  const before = holders();
  for (const run_id of [undefined, '', 'a'.repeat(31), `${'a'.repeat(32)} `, 42]) {
    const res = await SUBMIT(post('/api/leaderboard', entry({ run_id }), nextIp()));
    assert.deepEqual([res.status, await res.json()], [400, { error: 'this run could not be verified' }], String(run_id));
  }
  assert.equal(holders(), before);
});

test('submit: the forged-time case -- claims 16 s, the service measured 31 s -- is refused', async () => {
  const before = holders();
  const run_id = await play(31_000);
  const res = await SUBMIT(post('/api/leaderboard', entry({ time_ms: 16_000, run_id }), nextIp()));
  assert.deepEqual([res.status, await res.json()], [400, { error: 'this run\'s time could not be verified' }]);
  assert.equal(holders(), before);
});

test('submit: an unknown or reused run id is refused with its own message', async () => {
  const unknown = await SUBMIT(post('/api/leaderboard', entry({ run_id: 'e'.repeat(32) }), nextIp()));
  assert.deepEqual([unknown.status, await unknown.json()], [400, { error: 'this run could not be verified' }]);
  const run_id = await play(20_000);
  assert.equal((await SUBMIT(post('/api/leaderboard', entry({ run_id }), nextIp()))).status, 201);
  const again = await SUBMIT(post('/api/leaderboard', entry({ run_id }), nextIp()));
  assert.deepEqual([again.status, await again.json()], [400, { error: 'this run was already submitted' }]);
});

test('start: more than RUN_START_IP_LIMIT starts an hour from one IP get 429', async () => {
  const ip = nextIp();
  for (let i = 0; i < RUN_START_IP_LIMIT; i++) assert.equal((await START(post('/api/run/start', { difficulty: 'blackout' }, ip))).status, 201);
  assert.equal((await START(post('/api/run/start', { difficulty: 'blackout' }, ip))).status, 429);
  assert.equal((await START(post('/api/run/start', { difficulty: 'blackout' }, nextIp()))).status, 201);
});

test('start and finish: a missing salt or service config, or an unreachable service, is 503', async () => {
  delete process.env.LEADERBOARD_IP_HASH_SALT;
  assert.equal((await START(post('/api/run/start', { difficulty: 'blackout' }))).status, 503);
  process.env.LEADERBOARD_IP_HASH_SALT = 'pepper';
  const url = process.env.LEADERBOARD_API_URL;
  delete process.env.LEADERBOARD_API_URL;
  assert.equal((await START(post('/api/run/start', { difficulty: 'blackout' }))).status, 503);
  assert.equal((await FINISH(post('/api/run/finish', { run_id: 'a'.repeat(32) }))).status, 503);
  process.env.LEADERBOARD_API_URL = url;
  svc.down();
  assert.equal((await START(post('/api/run/start', { difficulty: 'blackout' }))).status, 503);
  assert.equal((await FINISH(post('/api/run/finish', { run_id: 'a'.repeat(32) }))).status, 503);
});
