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
import { startTestService, honestTrace } from '../../../services/leaderboard-db/test-harness.ts';
import { RUN_START_IP_LIMIT } from '../../../lib/game/leaderboard.ts';
import { decodeSamples, encodeSamples, MAX_FINISH_BODY_BYTES } from '../../../lib/game/run-trace.ts';

let svc: Awaited<ReturnType<typeof startTestService>>;
let offset = 0;
const serviceLog: string[] = [];
before(async () => {
  svc = await startTestService('r'.repeat(48), () => Date.now() + offset, (line) => serviceLog.push(line));
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

/** A Blackout run that started `ms` ago by the service clock and was lifted just now; the client's run clock read `traceMs`. */
async function play(ms: number, ip = nextIp(), traceMs = ms): Promise<string> {
  offset = -ms;
  const res = await START(post('/api/run/start', { difficulty: 'blackout', anon_id: ANON }, ip));
  offset = 0;
  assert.equal(res.status, 201);
  const { run_id } = await res.json();
  const fin = await FINISH(post('/api/run/finish', { run_id, anon_id: ANON, trace: honestTrace(traceMs) }, ip));
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
  const res = await FINISH(post('/api/run/finish', { run_id: 'f'.repeat(32), anon_id: ANON, trace: honestTrace(20_000) }));
  assert.deepEqual([res.status, await res.json()], [400, { error: 'this run could not be verified', code: 'invalid_run' }]);
});

test('finish: a forged trace is refused by the route before the service is called', async () => {
  offset = -20_000;
  const { run_id } = await (await START(post('/api/run/start', { difficulty: 'blackout', anon_id: ANON }, nextIp()))).json();
  offset = 0;
  serviceLog.length = 0;
  const trace = honestTrace(20_000);
  const coords = decodeSamples(trace.samples)!;
  coords[20] += 200; // one sample jumps 50 u
  for (const bad of [{ ...trace, samples: encodeSamples(coords) }, { ...trace, child: [3, 4] }, { ...trace, v: 9 }, 'path']) {
    const res = await FINISH(post('/api/run/finish', { run_id, anon_id: ANON, trace: bad }));
    assert.deepEqual([res.status, await res.json()], [400, { error: 'this run\'s path could not be verified', code: 'invalid_trace' }]);
  }
  assert.deepEqual(serviceLog.filter((l) => l.includes('/v1/runs/finish')), [], 'the service never saw them');
  assert.equal(svc.db.db.prepare('SELECT finished_at FROM run_sessions WHERE id = ?').get(run_id)!.finished_at, null);
  // An oversized body is refused outright.
  assert.equal((await FINISH(post('/api/run/finish', { run_id, pad: 'x'.repeat(MAX_FINISH_BODY_BYTES) }))).status, 413);
});

test('finish: without a trace the service refuses the run (trace required by default) and the client gets the code', async () => {
  offset = -20_000;
  const { run_id } = await (await START(post('/api/run/start', { difficulty: 'blackout', anon_id: ANON }, nextIp()))).json();
  offset = 0;
  const res = await FINISH(post('/api/run/finish', { run_id, anon_id: ANON }));
  assert.deepEqual([res.status, await res.json()], [400, { error: 'this run\'s path could not be verified', code: 'invalid_trace' }]);
  const row = svc.db.db.prepare('SELECT finished_at FROM run_sessions WHERE id = ?').get(run_id)!;
  assert.equal(row.finished_at, null);
});

test('finish: the route forwards only the trace fields the service reads', async () => {
  offset = -20_000;
  const ip = nextIp();
  const { run_id } = await (await START(post('/api/run/start', { difficulty: 'blackout', anon_id: ANON }, ip))).json();
  offset = 0;
  const res = await FINISH(post('/api/run/finish', { run_id, anon_id: ANON, trace: { ...honestTrace(20_000), note: 'ignore me' } }, ip));
  assert.equal(res.status, 200);
  const trace = svc.db.db.prepare('SELECT end_ms FROM run_traces WHERE run_id = ?').get(run_id)!;
  assert.equal(trace.end_ms, 20_000);
});

test('submit: a run timed by the service is stored with the client time', async () => {
  const run_id = await play(20_000, nextIp(), 20_300);
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

test('start: a missing salt or service config, or an unreachable service, is 200 { unavailable } (never 5xx); finish stays 503', async () => {
  const startUnavailable = async () => {
    const res = await START(post('/api/run/start', { difficulty: 'blackout' }));
    assert.deepEqual([res.status, await res.json(), res.headers.get('cache-control')], [200, { unavailable: true }, 'no-store']);
  };
  delete process.env.LEADERBOARD_IP_HASH_SALT;
  await startUnavailable();
  process.env.LEADERBOARD_IP_HASH_SALT = 'pepper';
  const url = process.env.LEADERBOARD_API_URL;
  delete process.env.LEADERBOARD_API_URL;
  await startUnavailable();
  assert.equal((await FINISH(post('/api/run/finish', { run_id: 'a'.repeat(32) }))).status, 503);
  process.env.LEADERBOARD_API_URL = url;
  svc.down();
  await startUnavailable();
  assert.equal((await FINISH(post('/api/run/finish', { run_id: 'a'.repeat(32) }))).status, 503);
});
