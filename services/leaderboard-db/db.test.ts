// Run: node --test services/leaderboard-db/db.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LeaderboardDb, MAX_EVENTS_PER_DAY, EVENT_RETENTION_DAYS, SCHEMA_VERSION, type SubmitInput } from './db.ts';
import {
  COOLDOWN_MS, IP_LIMIT, GLOBAL_LIMIT, PLAUSIBILITY_FLOOR_MS, RUN_CLOCK_TOLERANCE_MS, RUN_SESSION_TTL_MS, RUN_START_IP_LIMIT, RUN_START_WINDOW_MS,
} from '../../lib/game/leaderboard.ts';
import { TRACE_TIME_TOLERANCE_MS } from '../../lib/game/run-trace.ts';
import { SUGGESTION_COOLDOWN_MS, SUGGESTION_IP_LIMIT, SUGGESTION_IP_WINDOW_MS, SUGGESTION_GLOBAL_LIMIT } from '../../lib/suggestions/rules.ts';

const T0 = 1_790_000_000_000;
let ipSeq = 0;
const ip = () => (++ipSeq).toString(16).padStart(64, '0');

type Entry = Omit<SubmitInput, 'runId'>;
function entry(over: Partial<Entry> = {}): Entry {
  return { nickname: 'ranger', country: 'IL', timeMs: 120_000, buildSha: 'abc1234', ipHash: ip(), anonId: null, deviceClass: 'desktop', browser: 'chrome', ...over };
}

// Most tests are about the board, not the session: play a real blackout run
// session that started timeMs + 5 s before `now` and finished 5 s before it.
const LIFT_TO_SUBMIT_MS = 5_000;
function startedRun(db: LeaderboardDb, e: Entry, now: number): string {
  const started = db.startRun({ difficulty: 'blackout', anonId: e.anonId, ipHash: ip() }, now - e.timeMs - LIFT_TO_SUBMIT_MS);
  assert.equal(started.ok, true);
  const runId = (started as { runId: string }).runId;
  assert.deepEqual(db.finishRun(runId, e.anonId, now - LIFT_TO_SUBMIT_MS), { ok: true });
  return runId;
}
function submitRun(db: LeaderboardDb, e: Entry, now: number) {
  return db.submit({ ...e, runId: startedRun(db, e, now) }, now);
}

function withDb(fn: (db: LeaderboardDb, path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'lbdb-'));
  const path = join(dir, 'lb.db');
  const db = new LeaderboardDb(path);
  try { fn(db, path); } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('an empty board has no current record', () => withDb((db) => {
  assert.equal(db.current(), null);
}));

test('the first submission becomes the record; a slower one does not; a faster one does', () => withDb((db) => {
  const a = submitRun(db, entry({ nickname: 'first', timeMs: 120_000 }), T0);
  assert.deepEqual(a, { ok: true, id: 1, isRecord: true });
  const b = submitRun(db, entry({ nickname: 'slower', timeMs: 130_000 }), T0 + 1);
  assert.deepEqual(b, { ok: true, id: 2, isRecord: false });
  const c = submitRun(db, entry({ nickname: 'faster', timeMs: 90_000 }), T0 + 2);
  assert.deepEqual(c, { ok: true, id: 3, isRecord: true });
  assert.equal(db.current()?.nickname, 'faster');
}));

test('a tie does not take the record from the earlier holder', () => withDb((db) => {
  submitRun(db, entry({ nickname: 'early', timeMs: 100_000 }), T0);
  assert.equal(submitRun(db, entry({ nickname: 'late', timeMs: 100_000 }), T0 + 1).ok, true);
  assert.equal(db.current()?.nickname, 'early');
}));

test('concurrent submissions from two connections leave the genuinely fastest as the record', () => withDb((db, path) => {
  submitRun(db, entry({ nickname: 'holder', timeMs: 200_000 }), T0);
  // A second writer process on the same file, as during a restart overlap. The
  // slower of the two faster-than-current times commits LAST, which is the
  // ordering that loses a record under a naive read-then-write.
  const other = new LeaderboardDb(path);
  try {
    assert.equal(submitRun(other, entry({ nickname: 'fastest', timeMs: 100_000 }), T0 + 1).ok, true);
    assert.equal(submitRun(db, entry({ nickname: 'second', timeMs: 150_000 }), T0 + 2).ok, true);
  } finally { other.close(); }
  assert.equal(db.current()?.nickname, 'fastest');
}));

test('cooldown: a second submission from one IP inside COOLDOWN_MS is refused and stores nothing', () => withDb((db) => {
  const h = ip();
  assert.equal(submitRun(db, entry({ ipHash: h }), T0).ok, true);
  assert.deepEqual(submitRun(db, entry({ ipHash: h }), T0 + COOLDOWN_MS - 1), { ok: false, reason: 'cooldown' });
  assert.equal(submitRun(db, entry({ ipHash: h }), T0 + COOLDOWN_MS).ok, true);
  assert.equal(db.list(50, null).records.length, 2);
}));

test('per-IP limit: IP_LIMIT submissions per hour', () => withDb((db) => {
  const h = ip();
  for (let i = 0; i < IP_LIMIT; i++) assert.equal(submitRun(db, entry({ ipHash: h }), T0 + i * COOLDOWN_MS).ok, true);
  assert.deepEqual(submitRun(db, entry({ ipHash: h }), T0 + IP_LIMIT * COOLDOWN_MS), { ok: false, reason: 'ip-limit' });
}));

test('global limit applies across IPs', () => withDb((db) => {
  for (let i = 0; i < GLOBAL_LIMIT; i++) assert.equal(submitRun(db, entry(), T0 + i).ok, true);
  assert.deepEqual(submitRun(db, entry(), T0 + GLOBAL_LIMIT), { ok: false, reason: 'global-limit' });
}));

test('invalidate soft-deletes and promotes the next fastest; invalidating the last valid row empties the board', () => withDb((db) => {
  submitRun(db, entry({ nickname: 'slow', timeMs: 150_000 }), T0);
  submitRun(db, entry({ nickname: 'cheater', timeMs: 20_000 }), T0 + 1);
  assert.equal(db.current()?.nickname, 'cheater');
  const r = db.invalidate(2, 'impossible time', T0 + 2);
  assert.equal(r.found, true);
  assert.equal(r.current?.nickname, 'slow');
  assert.equal(db.list(50, null).records.length, 1);
  assert.equal(db.invalidate(1, null, T0 + 3).current, null);
  assert.equal(db.invalidate(99, null, T0 + 4).found, false);
  const audit = db.db.prepare('SELECT record_id, outcome FROM admin_audit ORDER BY id').all();
  assert.deepEqual(audit.map((a) => [a.record_id, a.outcome]), [[2, 'ok'], [1, 'ok'], [99, 'not-found']]);
  assert.equal(Number(db.db.prepare('SELECT count(*) AS n FROM record_holders').get()!.n), 2, 'rows are never deleted');
}));

test('after an invalidate, a slower-than-the-cheater time can take the record', () => withDb((db) => {
  submitRun(db, entry({ nickname: 'cheater', timeMs: 20_000 }), T0);
  db.invalidate(1, null, T0 + 1);
  assert.equal(submitRun(db, entry({ nickname: 'honest', timeMs: 150_000 }), T0 + 2).ok, true);
  assert.equal(db.current()?.nickname, 'honest');
}));

test('list pages by id descending with a keyset cursor', () => withDb((db) => {
  for (let i = 0; i < 5; i++) submitRun(db, entry({ nickname: `p${i}xx` }), T0 + i);
  const page1 = db.list(2, null);
  assert.deepEqual(page1.records.map((r) => r.id), [5, 4]);
  const page2 = db.list(2, page1.nextCursor);
  assert.deepEqual(page2.records.map((r) => r.id), [3, 2]);
  const page3 = db.list(2, page2.nextCursor);
  assert.deepEqual(page3.records.map((r) => r.id), [1]);
  assert.equal(page3.nextCursor, null);
}));

test('players keeps nickname history: submissions, best time, first/last seen', () => withDb((db) => {
  submitRun(db, entry({ nickname: 'ranger', timeMs: 150_000 }), T0);
  submitRun(db, entry({ nickname: 'ranger', timeMs: 120_000, country: 'US' }), T0 + 100);
  submitRun(db, entry({ nickname: 'ranger', timeMs: 130_000 }), T0 + 200);
  const p = db.db.prepare('SELECT * FROM players WHERE nickname = ?').get('ranger')!;
  assert.equal(p.submissions, 3);
  assert.equal(p.best_time_ms, 120_000);
  assert.equal(p.best_record_id, 2);
  assert.equal(p.first_seen, T0);
  assert.equal(p.last_seen, T0 + 200);
  assert.equal(p.last_country, 'IL');
}));

test('win/loss events also land in runs, typed; the views aggregate them', () => withDb((db) => {
  const base = { anonId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', buildSha: 'abc1234', path: '/', deviceClass: 'mobile', browser: 'safari', country: 'IL', eventTs: T0 };
  db.recordEvent({ ...base, event: 'loss', payload: { event: 'loss', predator_kind: 'wolf', death_cause: 'charge', time_survived_ms: 30_000, difficulty: 'night', distance_from_home_m: 40.5, seed: 1, payout: 3, balance: 9 } }, T0);
  db.recordEvent({ ...base, event: 'win', payload: { event: 'win', time_survived_ms: 90_000, difficulty: 'night', seed: 2, payout: 10, balance: 19, purchases_made: [] } }, T0 + 1);
  db.recordEvent({ ...base, event: 'feature_engagement', payload: { event: 'feature_engagement', feature: 'hide', action: 'used' } }, T0 + 2);
  const runs = db.db.prepare('SELECT outcome, predator_kind, death_cause, distance_from_home_m FROM runs ORDER BY id').all();
  assert.deepEqual(runs.map((r) => [r.outcome, r.predator_kind, r.death_cause, r.distance_from_home_m]),
    [['loss', 'wolf', 'charge', 40.5], ['win', null, null, null]]);
  const daily = db.db.prepare('SELECT runs, wins, win_pct, players FROM v_runs_daily').get()!;
  assert.deepEqual([daily.runs, daily.wins, daily.win_pct, daily.players], [2, 1, 50, 1]);
  assert.equal(db.db.prepare('SELECT uses FROM v_feature_engagement WHERE feature = ?').get('hide')!.uses, 1);
  assert.equal(db.db.prepare('SELECT deaths FROM v_deaths').get()!.deaths, 1);
}));

test('events are shed past the daily cap and pruned after the retention window', () => withDb((db) => {
  const ev = { event: 'page_view', eventTs: null, anonId: null, buildSha: null, path: null, deviceClass: null, browser: null, country: null, payload: { event: 'page_view' } };
  const insert = db.db.prepare("INSERT INTO events (received_at, event, payload_json) VALUES (?, 'page_view', '{}')");
  db.db.exec('BEGIN');
  for (let i = 0; i < MAX_EVENTS_PER_DAY; i++) insert.run(T0);
  db.db.exec('COMMIT');
  assert.equal(db.recordEvent(ev, T0 + 1), false);
  const later = T0 + (EVENT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
  assert.equal(db.pruneEvents(later), MAX_EVENTS_PER_DAY);
  assert.equal(db.recordEvent(ev, later), true);
}));

test('the schema rejects a non-blackout row even if application code were bypassed', () => withDb((db) => {
  assert.throws(() => db.db.prepare(`INSERT INTO record_holders (nickname, country, time_ms, difficulty, build_sha, achieved_at, ip_hash)
    VALUES ('abc', 'IL', 1000, 'lantern', 'x', 0, ?)`).run('0'.repeat(64)));
}));

test('snapshot writes a consistent, independently openable copy', () => withDb((db, path) => {
  submitRun(db, entry({ nickname: 'snapme' }), T0);
  const snap = `${path}.snapshot`;
  db.snapshot(snap);
  db.snapshot(snap); // overwriting an existing snapshot works too
  const copy = new LeaderboardDb(snap);
  try { assert.equal(copy.current()?.nickname, 'snapme'); } finally { copy.close(); }
}));

test('suggestions: 10 s cooldown, 5 per IP per hour, 200 a day overall; stored oldest first', () => withDb((db) => {
  const a = ip();
  assert.deepEqual(db.submitSuggestion('first idea', a, T0), { ok: true, id: 1 });
  assert.deepEqual(db.submitSuggestion('too soon', a, T0 + SUGGESTION_COOLDOWN_MS - 1), { ok: false, reason: 'cooldown' });
  for (let i = 1; i < SUGGESTION_IP_LIMIT; i++) assert.equal(db.submitSuggestion('more', a, T0 + i * SUGGESTION_COOLDOWN_MS).ok, true);
  assert.deepEqual(db.submitSuggestion('one too many', a, T0 + SUGGESTION_IP_LIMIT * SUGGESTION_COOLDOWN_MS), { ok: false, reason: 'ip-limit' });
  assert.equal(db.submitSuggestion('next hour', a, T0 + SUGGESTION_IP_WINDOW_MS + 1).ok, true);
  const list = db.listSuggestions();
  assert.equal(list[0].text, 'first idea');
  assert.equal(list[0].submitted_at, new Date(T0).toISOString());
  assert.equal(list.length, SUGGESTION_IP_LIMIT + 1);
}));

test('suggestions: the global daily cap stops everyone once reached', () => withDb((db) => {
  for (let i = 0; i < SUGGESTION_GLOBAL_LIMIT; i++) assert.equal(db.submitSuggestion('idea', ip(), T0 + i).ok, true);
  assert.deepEqual(db.submitSuggestion('late', ip(), T0 + SUGGESTION_GLOBAL_LIMIT), { ok: false, reason: 'global-limit' });
}));

test('eventsBetween returns stored payloads in the received_at window, oldest first', () => withDb((db) => {
  const ev = (event: string, at: number) => db.recordEvent({ event, eventTs: at, anonId: null, buildSha: null, path: '/', deviceClass: null, browser: null, country: null, payload: { event, ts: at } }, at);
  ev('page_view', T0); ev('game_start', T0 + 10); ev('win', T0 + 20);
  assert.deepEqual(db.eventsBetween(T0 + 5, T0 + 20).map((e) => e.event), ['game_start', 'win']);
  assert.deepEqual(db.eventsBetween(T0 + 30, T0 + 40), []);
}));

// ---- server-timed run sessions ----

const ANON = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const sessionRow = (db: LeaderboardDb, id: string) => db.db.prepare('SELECT * FROM run_sessions WHERE id = ?').get(id);

test('runs: start returns a 128-bit hex id and stores the server start time', () => withDb((db) => {
  const r = db.startRun({ difficulty: 'blackout', anonId: ANON, ipHash: ip() }, T0);
  assert.equal(r.ok, true);
  const id = (r as { runId: string }).runId;
  assert.match(id, /^[0-9a-f]{32}$/);
  const row = sessionRow(db, id)!;
  assert.deepEqual([row.started_at, row.finished_at, row.used_at, row.difficulty, row.anon_id], [T0, null, null, 'blackout', ANON]);
  assert.notEqual((db.startRun({ difficulty: 'blackout', anonId: ANON, ipHash: ip() }, T0) as { runId: string }).runId, id);
}));

test('runs: happy path stores the client time, marks the session used', () => withDb((db) => {
  const id = (db.startRun({ difficulty: 'blackout', anonId: ANON, ipHash: ip() }, T0) as { runId: string }).runId;
  assert.deepEqual(db.finishRun(id, ANON, T0 + 60_000), { ok: true });
  const r = db.submit({ ...entry({ timeMs: 60_400, anonId: ANON }), runId: id }, T0 + 75_000);
  assert.deepEqual(r, { ok: true, id: 1, isRecord: true });
  assert.equal(db.current()?.timeMs, 60_400, 'the board shows the client time, which equals the UI timer');
  assert.equal(sessionRow(db, id)!.used_at, T0 + 75_000);
}));

test('runs: a second finish keeps the first stamp', () => withDb((db) => {
  const id = (db.startRun({ difficulty: 'blackout', anonId: ANON, ipHash: ip() }, T0) as { runId: string }).runId;
  db.finishRun(id, ANON, T0 + 60_000);
  assert.deepEqual(db.finishRun(id, ANON, T0 + 90_000), { ok: true });
  assert.equal(sessionRow(db, id)!.finished_at, T0 + 60_000);
}));

test('runs: unknown, reused, expired, non-blackout, foreign anon_id, unfinished, too fast and mismatched runs are refused and store nothing', () => withDb((db) => {
  const start = (over: { difficulty?: string; anonId?: string | null } = {}, at = T0) =>
    (db.startRun({ difficulty: 'blackout', anonId: ANON, ipHash: ip(), ...over }, at) as { runId: string }).runId;
  const e = entry({ timeMs: 60_000, anonId: ANON });

  assert.deepEqual(db.submit({ ...e, runId: 'f'.repeat(32) }, T0 + 70_000), { ok: false, reason: 'invalid_run' });

  const used = start();
  db.finishRun(used, ANON, T0 + 60_000);
  assert.equal(db.submit({ ...e, runId: used }, T0 + 70_000).ok, true);
  assert.deepEqual(db.submit({ ...e, ipHash: ip(), runId: used }, T0 + 70_000 + COOLDOWN_MS), { ok: false, reason: 'run_used' });
  assert.deepEqual(db.finishRun(used, ANON, T0 + 80_000), { ok: false, reason: 'run_used' });

  const old = start();
  db.finishRun(old, ANON, T0 + 60_000);
  assert.deepEqual(db.submit({ ...e, ipHash: ip(), runId: old }, T0 + RUN_SESSION_TTL_MS + 1), { ok: false, reason: 'run_expired' });

  const night = start({ difficulty: 'night' });
  db.finishRun(night, ANON, T0 + 60_000);
  assert.deepEqual(db.submit({ ...e, ipHash: ip(), runId: night }, T0 + 70_000), { ok: false, reason: 'invalid_run' });

  const mine = start();
  assert.deepEqual(db.finishRun(mine, 'ffffffff-4f89-41d3-9a0c-0305e82c3301', T0 + 60_000), { ok: false, reason: 'invalid_run' });
  db.finishRun(mine, ANON, T0 + 60_000);
  assert.deepEqual(db.submit({ ...e, ipHash: ip(), anonId: 'ffffffff-4f89-41d3-9a0c-0305e82c3301', runId: mine }, T0 + 70_000), { ok: false, reason: 'invalid_run' });

  const unfinished = start();
  assert.deepEqual(db.submit({ ...e, ipHash: ip(), runId: unfinished }, T0 + 70_000), { ok: false, reason: 'run_unfinished' });

  const fast = start();
  db.finishRun(fast, ANON, T0 + PLAUSIBILITY_FLOOR_MS - 1);
  assert.deepEqual(db.submit({ ...e, ipHash: ip(), timeMs: 16_000, runId: fast }, T0 + 70_000), { ok: false, reason: 'too_fast' });

  // Claims 16 s, the server measured 31 s.
  const slow = start();
  db.finishRun(slow, ANON, T0 + 31_000);
  assert.deepEqual(db.submit({ ...e, ipHash: ip(), timeMs: 16_000, runId: slow }, T0 + 40_000), { ok: false, reason: 'clock_mismatch' });
  // Claims more than the server measured.
  assert.deepEqual(db.submit({ ...e, ipHash: ip(), timeMs: 31_000 + RUN_CLOCK_TOLERANCE_MS + 1, runId: slow }, T0 + 40_000), { ok: false, reason: 'clock_mismatch' });
  assert.equal(sessionRow(db, slow)!.used_at, null, 'a refused run stays unused');

  assert.equal(db.list(50, null).records.length, 1, 'only the one valid run was stored');
}));

test('runs: a session without anon_id accepts a submission without one', () => withDb((db) => {
  const id = (db.startRun({ difficulty: 'blackout', anonId: null, ipHash: ip() }, T0) as { runId: string }).runId;
  db.finishRun(id, null, T0 + 60_000);
  assert.equal(db.submit({ ...entry({ timeMs: 60_000 }), runId: id }, T0 + 70_000).ok, true);
}));

test('runs: a run refused by the cooldown is not used up and can be submitted after it', () => withDb((db) => {
  const h = ip();
  assert.equal(submitRun(db, entry({ ipHash: h }), T0).ok, true);
  const e = entry({ ipHash: h, timeMs: 60_000 });
  const id = startedRun(db, e, T0 + 1);
  assert.deepEqual(db.submit({ ...e, runId: id }, T0 + 1), { ok: false, reason: 'cooldown' });
  assert.equal(db.submit({ ...e, runId: id }, T0 + COOLDOWN_MS).ok, true);
}));

test('runs: RUN_START_IP_LIMIT starts per IP hash per window; other IPs are not affected; old sessions are pruned', () => withDb((db) => {
  const h = ip();
  for (let i = 0; i < RUN_START_IP_LIMIT; i++) assert.equal(db.startRun({ difficulty: 'blackout', anonId: null, ipHash: h }, T0 + i).ok, true);
  assert.deepEqual(db.startRun({ difficulty: 'blackout', anonId: null, ipHash: h }, T0 + RUN_START_IP_LIMIT), { ok: false, reason: 'start-limit' });
  assert.equal(db.startRun({ difficulty: 'blackout', anonId: null, ipHash: ip() }, T0 + RUN_START_IP_LIMIT).ok, true);
  const later = T0 + Math.max(RUN_START_WINDOW_MS, RUN_SESSION_TTL_MS) + RUN_START_IP_LIMIT + 1;
  assert.equal(db.startRun({ difficulty: 'blackout', anonId: null, ipHash: h }, later).ok, true);
  assert.equal(Number(db.db.prepare('SELECT count(*) AS n FROM run_sessions').get()!.n), 1, 'only the fresh session is left');
}));

test('runs: two connections cannot both use one session', () => withDb((db, path) => {
  const e = entry({ timeMs: 60_000 });
  const id = startedRun(db, e, T0);
  const other = new LeaderboardDb(path);
  try {
    assert.equal(other.submit({ ...e, runId: id }, T0).ok, true);
    assert.deepEqual(db.submit({ ...e, ipHash: ip(), runId: id }, T0), { ok: false, reason: 'run_used' });
  } finally { other.close(); }
}));

test('a version-1 database file opens in place and gains run_sessions', () => withDb((db, path) => {
  db.db.exec('DROP TABLE run_sessions');
  db.db.prepare("UPDATE meta SET value = '1' WHERE key = 'schema_version'").run();
  const reopened = new LeaderboardDb(path);
  try {
    assert.equal(reopened.startRun({ difficulty: 'blackout', anonId: null, ipHash: ip() }, T0).ok, true);
    assert.equal(reopened.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()!.value, String(SCHEMA_VERSION));
  } finally { reopened.close(); }
}));

test('a version-2 database file opens in place and gains run_traces; its sessions stay usable', () => withDb((db, path) => {
  const id = (db.startRun({ difficulty: 'blackout', anonId: null, ipHash: ip() }, T0) as { runId: string }).runId;
  db.db.exec('DROP TABLE run_traces');
  db.db.prepare("UPDATE meta SET value = '2' WHERE key = 'schema_version'").run();
  const reopened = new LeaderboardDb(path);
  try {
    assert.equal(SCHEMA_VERSION, 3);
    assert.deepEqual(reopened.finishRun(id, null, T0 + 60_000, { endMs: 60_000, samples: 62 }), { ok: true });
    assert.equal(reopened.submit({ ...entry({ timeMs: 60_000 }), runId: id }, T0 + 70_000, { requireTrace: true }).ok, true);
  } finally { reopened.close(); }
}));

// ---- proof of play (lib/game/run-trace.ts) ----

const traceRow = (db: LeaderboardDb, id: string) => db.db.prepare('SELECT * FROM run_traces WHERE run_id = ?').get(id);

test('trace: finish keeps the first accepted trace; submit must claim its time when traced', () => withDb((db) => {
  const id = (db.startRun({ difficulty: 'blackout', anonId: ANON, ipHash: ip() }, T0) as { runId: string }).runId;
  assert.deepEqual(db.finishRun(id, ANON, T0 + 60_000, { endMs: 59_800, samples: 61 }), { ok: true });
  assert.deepEqual(db.finishRun(id, ANON, T0 + 61_000, { endMs: 30_000, samples: 31 }), { ok: true });
  const row = traceRow(db, id)!;
  assert.deepEqual([row.end_ms, row.samples, row.created_at], [59_800, 61, T0 + 60_000]);
  const e = entry({ timeMs: 59_800 + TRACE_TIME_TOLERANCE_MS + 1, anonId: ANON });
  assert.deepEqual(db.submit({ ...e, runId: id }, T0 + 70_000), { ok: false, reason: 'invalid_trace' }, 'checked even without requireTrace');
  assert.equal(sessionRow(db, id)!.used_at, null, 'a refused run stays unused');
  assert.equal(db.submit({ ...e, timeMs: 59_800, runId: id }, T0 + 70_000, { requireTrace: true }).ok, true);
}));

test('trace: with requireTrace a run finished without a trace is refused, without it (transition) it is accepted', () => withDb((db) => {
  const e = entry({ timeMs: 60_000 });
  const id = startedRun(db, e, T0);
  assert.deepEqual(db.submit({ ...e, runId: id }, T0, { requireTrace: true }), { ok: false, reason: 'invalid_trace' });
  assert.equal(db.submit({ ...e, runId: id }, T0, { requireTrace: false }).ok, true);
}));

test('trace: rows are pruned with the sessions', () => withDb((db) => {
  const id = (db.startRun({ difficulty: 'blackout', anonId: null, ipHash: ip() }, T0) as { runId: string }).runId;
  db.finishRun(id, null, T0 + 60_000, { endMs: 60_000, samples: 61 });
  db.startRun({ difficulty: 'blackout', anonId: null, ipHash: ip() }, T0 + 60_000 + RUN_SESSION_TTL_MS + 1);
  assert.equal(traceRow(db, id), undefined);
  assert.equal(Number(db.db.prepare('SELECT count(*) AS n FROM run_traces').get()!.n), 0);
}));
