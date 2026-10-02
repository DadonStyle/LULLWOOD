// Run: node --test services/leaderboard-db/db.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LeaderboardDb, MAX_EVENTS_PER_DAY, EVENT_RETENTION_DAYS, type SubmitInput } from './db.ts';
import { COOLDOWN_MS, IP_LIMIT, GLOBAL_LIMIT } from '../../lib/game/leaderboard.ts';

const T0 = 1_790_000_000_000;
let ipSeq = 0;
const ip = () => (++ipSeq).toString(16).padStart(64, '0');

function entry(over: Partial<SubmitInput> = {}): SubmitInput {
  return { nickname: 'ranger', country: 'IL', timeMs: 120_000, buildSha: 'abc1234', ipHash: ip(), anonId: null, deviceClass: 'desktop', browser: 'chrome', ...over };
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
  const a = db.submit(entry({ nickname: 'first', timeMs: 120_000 }), T0);
  assert.deepEqual(a, { ok: true, id: 1, isRecord: true });
  const b = db.submit(entry({ nickname: 'slower', timeMs: 130_000 }), T0 + 1);
  assert.deepEqual(b, { ok: true, id: 2, isRecord: false });
  const c = db.submit(entry({ nickname: 'faster', timeMs: 90_000 }), T0 + 2);
  assert.deepEqual(c, { ok: true, id: 3, isRecord: true });
  assert.equal(db.current()?.nickname, 'faster');
}));

test('a tie does not take the record from the earlier holder', () => withDb((db) => {
  db.submit(entry({ nickname: 'early', timeMs: 100_000 }), T0);
  assert.equal(db.submit(entry({ nickname: 'late', timeMs: 100_000 }), T0 + 1).ok, true);
  assert.equal(db.current()?.nickname, 'early');
}));

test('concurrent submissions from two connections leave the genuinely fastest as the record', () => withDb((db, path) => {
  db.submit(entry({ nickname: 'holder', timeMs: 200_000 }), T0);
  // A second writer process on the same file, as during a restart overlap. The
  // slower of the two faster-than-current times commits LAST, which is the
  // ordering that loses a record under a naive read-then-write.
  const other = new LeaderboardDb(path);
  try {
    assert.equal(other.submit(entry({ nickname: 'fastest', timeMs: 100_000 }), T0 + 1).ok, true);
    assert.equal(db.submit(entry({ nickname: 'second', timeMs: 150_000 }), T0 + 2).ok, true);
  } finally { other.close(); }
  assert.equal(db.current()?.nickname, 'fastest');
}));

test('cooldown: a second submission from one IP inside COOLDOWN_MS is refused and stores nothing', () => withDb((db) => {
  const h = ip();
  assert.equal(db.submit(entry({ ipHash: h }), T0).ok, true);
  assert.deepEqual(db.submit(entry({ ipHash: h }), T0 + COOLDOWN_MS - 1), { ok: false, reason: 'cooldown' });
  assert.equal(db.submit(entry({ ipHash: h }), T0 + COOLDOWN_MS).ok, true);
  assert.equal(db.list(50, null).records.length, 2);
}));

test('per-IP limit: IP_LIMIT submissions per hour', () => withDb((db) => {
  const h = ip();
  for (let i = 0; i < IP_LIMIT; i++) assert.equal(db.submit(entry({ ipHash: h }), T0 + i * COOLDOWN_MS).ok, true);
  assert.deepEqual(db.submit(entry({ ipHash: h }), T0 + IP_LIMIT * COOLDOWN_MS), { ok: false, reason: 'ip-limit' });
}));

test('global limit applies across IPs', () => withDb((db) => {
  for (let i = 0; i < GLOBAL_LIMIT; i++) assert.equal(db.submit(entry(), T0 + i).ok, true);
  assert.deepEqual(db.submit(entry(), T0 + GLOBAL_LIMIT), { ok: false, reason: 'global-limit' });
}));

test('invalidate soft-deletes and promotes the next fastest; invalidating the last valid row empties the board', () => withDb((db) => {
  db.submit(entry({ nickname: 'slow', timeMs: 150_000 }), T0);
  db.submit(entry({ nickname: 'cheater', timeMs: 20_000 }), T0 + 1);
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
  db.submit(entry({ nickname: 'cheater', timeMs: 20_000 }), T0);
  db.invalidate(1, null, T0 + 1);
  assert.equal(db.submit(entry({ nickname: 'honest', timeMs: 150_000 }), T0 + 2).ok, true);
  assert.equal(db.current()?.nickname, 'honest');
}));

test('list pages by id descending with a keyset cursor', () => withDb((db) => {
  for (let i = 0; i < 5; i++) db.submit(entry({ nickname: `p${i}xx` }), T0 + i);
  const page1 = db.list(2, null);
  assert.deepEqual(page1.records.map((r) => r.id), [5, 4]);
  const page2 = db.list(2, page1.nextCursor);
  assert.deepEqual(page2.records.map((r) => r.id), [3, 2]);
  const page3 = db.list(2, page2.nextCursor);
  assert.deepEqual(page3.records.map((r) => r.id), [1]);
  assert.equal(page3.nextCursor, null);
}));

test('players keeps nickname history: submissions, best time, first/last seen', () => withDb((db) => {
  db.submit(entry({ nickname: 'ranger', timeMs: 150_000 }), T0);
  db.submit(entry({ nickname: 'ranger', timeMs: 120_000, country: 'US' }), T0 + 100);
  db.submit(entry({ nickname: 'ranger', timeMs: 130_000 }), T0 + 200);
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
  db.submit(entry({ nickname: 'snapme' }), T0);
  const snap = `${path}.snapshot`;
  db.snapshot(snap);
  db.snapshot(snap); // overwriting an existing snapshot works too
  const copy = new LeaderboardDb(snap);
  try { assert.equal(copy.current()?.nickname, 'snapme'); } finally { copy.close(); }
}));
