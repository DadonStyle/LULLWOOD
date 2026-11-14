// Run: node --test lib/game/leaderboard.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import {
  validateNickname, validateCountry, validateTimeMs, validateAnonId, normalizeForDenylist, isDenylisted,
  clampListLimit, parseCursor, parseRecord, COUNTRY_ALLOWLIST, COUNTRY_NAMES, PLAUSIBILITY_FLOOR_MS, PLAUSIBILITY_CEILING_MS, LIST_DEFAULT_LIMIT,
  validateRunId, validateDifficulty, checkRunSubmit, checkRunFinish, runRejectMessage, leaderboardSubmitGate,
  RUN_ID_PATTERN, RUN_CLOCK_TOLERANCE_MS, RUN_SESSION_TTL_MS, RUN_REJECT_CODES, type RunSession,
  implausibleWin, WIN_FLOOR_ANY_TIER_MS,
} from './leaderboard.ts';
import { TRACE_TIME_TOLERANCE_MS } from './run-trace.ts';

test('the plausibility floor is the documented ~15.7s', () => {
  assert.equal(PLAUSIBILITY_FLOOR_MS, 15_713);
});

test('validateNickname lowercases and enforces [a-z]{3,20} (letters only)', () => {
  assert.equal(validateNickname('Ranger'), 'ranger');
  assert.equal(validateNickname('Ranger42'), null);
  assert.equal(validateNickname('123'), null);
  assert.equal(validateNickname('abc'), 'abc');
  assert.equal(validateNickname('a'.repeat(20)), 'a'.repeat(20));
  for (const bad of ['ab', 'a'.repeat(21), 'has space', 'émile', 'semi;colon', '', 42, null, undefined, ['abc']]) {
    assert.equal(validateNickname(bad), null, String(bad));
  }
});

test('B2: a nickname containing <script> never passes', () => {
  assert.equal(validateNickname('<script>alert(1)</script>'), null);
  assert.equal(validateNickname('abc<b>'), null);
});

test('B4: the denylist applies after lowercasing and digit substitution', () => {
  assert.equal(normalizeForDenylist('SH1T'), 'shit');
  assert.equal(normalizeForDenylist('4103 5'), 'aioe s');
  assert.equal(isDenylisted('xxsh1txx'), true);
  assert.equal(validateNickname('Sh1t'), null);
  assert.equal(validateNickname('r4p3r'), null);
  assert.equal(validateNickname('ranger'), 'ranger');
});

test('B9: only allowlisted ISO alpha-2 codes pass', () => {
  assert.equal(validateCountry('il'), 'IL');
  assert.equal(validateCountry('US'), 'US');
  for (const bad of ['XX', 'USA', 'U', '', 1, null]) assert.equal(validateCountry(bad), null, String(bad));
});

test('B1: time_ms rejects -1, 0, 1.5, "5", NaN, Infinity, 1e308 and out-of-range integers', () => {
  for (const bad of [-1, 0, 1.5, '5', NaN, Infinity, 1e308, PLAUSIBILITY_FLOOR_MS - 1, PLAUSIBILITY_CEILING_MS + 1, null]) {
    assert.equal(validateTimeMs(bad), null, String(bad));
  }
  assert.equal(validateTimeMs(PLAUSIBILITY_FLOOR_MS), PLAUSIBILITY_FLOOR_MS);
  assert.equal(validateTimeMs(120_000), 120_000);
  assert.equal(validateTimeMs(PLAUSIBILITY_CEILING_MS), PLAUSIBILITY_CEILING_MS);
});

test('validateAnonId accepts a v4 UUID only', () => {
  assert.equal(validateAnonId('3F2504E0-4F89-41D3-9A0C-0305E82C3301'), '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  for (const bad of ['unavailable', 'ssr', '3f2504e0-4f89-11d3-9a0c-0305e82c3301', '', 5]) {
    assert.equal(validateAnonId(bad), null, String(bad));
  }
});

test('B3: list limit clamps instead of erroring', () => {
  assert.equal(clampListLimit('10'), 10);
  assert.equal(clampListLimit('50'), 50);
  for (const bad of ['0', '51', '-1', '1.5', 'abc', '1e2', undefined, null, '10;drop']) {
    assert.equal(clampListLimit(bad), LIST_DEFAULT_LIMIT, String(bad));
  }
});

test('B3: cursor is a positive safe integer or null', () => {
  assert.equal(parseCursor('42'), 42);
  for (const bad of ['0', '-3', '1.0', '9'.repeat(16), 'x', '', null]) assert.equal(parseCursor(bad), null, String(bad));
});

test('B8: parseRecord validates every field of an untrusted record', () => {
  const good = { id: 7, nickname: 'ranger', country: 'IL', timeMs: 120_000, achievedAt: '2026-10-02T10:00:00.000Z' };
  assert.deepEqual(parseRecord(good), good);
  assert.equal(parseRecord({ ...good, nickname: '<img>' }), null);
  assert.equal(parseRecord({ ...good, timeMs: '120000' }), null);
  assert.equal(parseRecord({ ...good, id: -1 }), null);
  assert.equal(parseRecord({ ...good, achievedAt: 'yesterday' }), null);
  assert.equal(parseRecord(null), null);
  assert.equal(parseRecord([good]), null);
});

test('S3/B8: the client cache round-trips, expires after 6h, and discards anything malformed', async () => {
  const { encodeCachedRecord, decodeCachedRecord, CLIENT_CACHE_MAX_AGE_MS } = await import('./leaderboard.ts');
  const rec = { id: 7, nickname: 'ranger', country: 'IL', timeMs: 120_000, achievedAt: '2026-10-02T10:00:00.000Z' };
  const now = 1_790_000_000_000;
  const raw = encodeCachedRecord(rec, now);
  assert.deepEqual(decodeCachedRecord(raw, now + 1000), rec);
  assert.equal(decodeCachedRecord(raw, now + CLIENT_CACHE_MAX_AGE_MS), null);
  assert.equal(decodeCachedRecord(raw, now - 1), null, 'stored in the future');
  assert.equal(decodeCachedRecord('{nope', now), null);
  assert.equal(decodeCachedRecord(JSON.stringify({ record: { ...rec, nickname: '<b>' }, storedAt: now }), now), null);
  assert.equal(decodeCachedRecord(null, now), null);
});

test('parseRecord still reads a record saved before nicknames became letters-only', () => {
  const r = parseRecord({ id: 1, nickname: 'ranger42', country: 'IL', timeMs: 125_000, achievedAt: '2026-10-02T10:00:00.000Z' });
  assert.equal(r?.nickname, 'ranger42');
});

test('the country picker names, the allowlist and the flag images match exactly', () => {
  const allowed = [...COUNTRY_ALLOWLIST].sort();
  assert.deepEqual(Object.keys(COUNTRY_NAMES).sort(), allowed);
  const flags = readdirSync(new URL('../../public/flags/', import.meta.url)).map((f) => f.replace(/\.png$/, '').toUpperCase()).sort();
  assert.deepEqual(flags, allowed);
  assert.equal(COUNTRY_NAMES.IL, 'Israel');
});

// ---- server-timed run sessions ----

const T = 1_790_000_000_000;
const ANON = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const session = (over: Partial<RunSession> = {}): RunSession => ({
  startedAt: T, finishedAt: T + 60_000, usedAt: null, difficulty: 'blackout', anonId: ANON, traceEndMs: null, ...over,
});

test('validateRunId accepts only 32 lower-case hex characters', () => {
  assert.equal(validateRunId('a'.repeat(32)), 'a'.repeat(32));
  for (const bad of ['A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 'g'.repeat(32), `${'a'.repeat(31)}\n`, 5, null, undefined]) {
    assert.equal(validateRunId(bad), null, String(bad));
  }
  assert.ok(RUN_ID_PATTERN.test('0123456789abcdef0123456789abcdef'));
});

test('validateDifficulty accepts only the three presets', () => {
  for (const d of ['lantern', 'night', 'blackout']) assert.equal(validateDifficulty(d), d);
  for (const bad of ['Blackout', 'hard', '', 1, null]) assert.equal(validateDifficulty(bad), null, String(bad));
});

test('checkRunSubmit: a finished blackout run whose time agrees with the server clock passes', () => {
  assert.equal(checkRunSubmit(session(), { timeMs: 60_000, anonId: ANON }, T + 90_000), null);
  assert.equal(checkRunSubmit(session(), { timeMs: 60_000 + RUN_CLOCK_TOLERANCE_MS, anonId: ANON }, T + 90_000), null);
  assert.equal(checkRunSubmit(session(), { timeMs: 60_000 - RUN_CLOCK_TOLERANCE_MS, anonId: ANON }, T + 90_000), null);
  assert.equal(checkRunSubmit(session({ anonId: null }), { timeMs: 60_000, anonId: null }, T + 90_000), null, 'a session without anon_id binds nothing');
});

test('checkRunSubmit: each refusal has its own code', () => {
  const claim = { timeMs: 60_000, anonId: ANON };
  assert.equal(checkRunSubmit(null, claim, T), 'invalid_run');
  assert.equal(checkRunSubmit(session({ anonId: 'ffffffff-4f89-41d3-9a0c-0305e82c3301' }), claim, T + 90_000), 'invalid_run');
  assert.equal(checkRunSubmit(session(), { ...claim, anonId: null }, T + 90_000), 'invalid_run', 'a bound session needs its anon_id');
  assert.equal(checkRunSubmit(session({ difficulty: 'night' }), claim, T + 90_000), 'invalid_run');
  assert.equal(checkRunSubmit(session({ usedAt: T + 80_000 }), claim, T + 90_000), 'run_used');
  assert.equal(checkRunSubmit(session(), claim, T + RUN_SESSION_TTL_MS + 1), 'run_expired');
  assert.equal(checkRunSubmit(session({ finishedAt: null }), claim, T + 90_000), 'run_unfinished');
  assert.equal(checkRunSubmit(session({ finishedAt: T + 15_000 }), { ...claim, timeMs: 16_000 }, T + 90_000), 'too_fast');
  // Client claims 16 s, the server measured 31 s: the forged-time case.
  assert.equal(checkRunSubmit(session({ finishedAt: T + 31_000 }), { ...claim, timeMs: 16_000 }, T + 90_000), 'clock_mismatch');
  // And the other direction: claims longer than the server saw.
  assert.equal(checkRunSubmit(session({ finishedAt: T + 20_000 }), { ...claim, timeMs: 30_000 }, T + 90_000), 'clock_mismatch');
  assert.equal(checkRunSubmit(session(), { ...claim, timeMs: 60_000 + RUN_CLOCK_TOLERANCE_MS + 1 }, T + 90_000), 'clock_mismatch');
});

test('checkRunSubmit: proof of play -- the claimed time must be the time the trace ends at', () => {
  const claim = { timeMs: 60_000, anonId: ANON };
  const traced = session({ traceEndMs: 60_000 });
  assert.equal(checkRunSubmit(traced, claim, T + 90_000, { requireTrace: true }), null);
  assert.equal(checkRunSubmit(traced, { ...claim, timeMs: 60_000 + TRACE_TIME_TOLERANCE_MS }, T + 90_000, { requireTrace: true }), null);
  // Within the server clock tolerance, but not the trace's own time.
  assert.equal(checkRunSubmit(traced, { ...claim, timeMs: 60_000 + TRACE_TIME_TOLERANCE_MS + 1 }, T + 90_000, { requireTrace: true }), 'invalid_trace');
  assert.equal(checkRunSubmit(traced, { ...claim, timeMs: 59_000 }, T + 90_000), 'invalid_trace', 'a trace is checked even when not required');
  // No trace: refused only while the trace is required (the default after the transition).
  assert.equal(checkRunSubmit(session(), claim, T + 90_000, { requireTrace: true }), 'invalid_trace');
  assert.equal(checkRunSubmit(session(), claim, T + 90_000, { requireTrace: false }), null);
  // The phase 1 checks still come first.
  assert.equal(checkRunSubmit(session({ traceEndMs: 16_000, finishedAt: T + 31_000 }), { ...claim, timeMs: 16_000 }, T + 90_000, { requireTrace: true }), 'clock_mismatch');
});

test('implausibleWin: drops forged telemetry wins, keeps every real event', () => {
  assert.equal(implausibleWin({ event: 'win', difficulty: 'blackout', time_survived_ms: 0 }), 'below_floor');
  assert.equal(implausibleWin({ event: 'win', difficulty: 'blackout', time_survived_ms: PLAUSIBILITY_FLOOR_MS - 1 }), 'below_floor');
  assert.equal(implausibleWin({ event: 'win', difficulty: 'blackout', time_survived_ms: PLAUSIBILITY_FLOOR_MS }), null);
  // Lantern/Night wins are legitimately faster than the Blackout floor.
  assert.equal(implausibleWin({ event: 'win', difficulty: 'lantern', time_survived_ms: 12_000 }), null);
  assert.equal(implausibleWin({ event: 'win', difficulty: 'night', time_survived_ms: WIN_FLOOR_ANY_TIER_MS - 1 }), 'below_floor');
  assert.equal(implausibleWin({ event: 'win', time_survived_ms: 1_000 }), 'below_floor', 'no difficulty: the any-tier floor');
  for (const bad of [undefined, '20000', -5, Number.NaN, Infinity, null]) {
    assert.equal(implausibleWin({ event: 'win', difficulty: 'blackout', time_survived_ms: bad }), 'bad_time', String(bad));
  }
  // Losses and every other event pass through, even with a 0 ms time.
  assert.equal(implausibleWin({ event: 'loss', difficulty: 'blackout', time_survived_ms: 0 }), null);
  assert.equal(implausibleWin({ event: 'page_view' }), null);
  // The any-tier floor stays well under the fastest possible real win (120 u at 12.96 u/s = 9.26 s).
  assert.ok(WIN_FLOOR_ANY_TIER_MS > 4_000 && WIN_FLOOR_ANY_TIER_MS < 5_000, String(WIN_FLOOR_ANY_TIER_MS));
});

test('checkRunFinish: refuses unknown, foreign, used and expired sessions only', () => {
  assert.equal(checkRunFinish(session({ finishedAt: null }), ANON, T + 30_000), null);
  assert.equal(checkRunFinish(session({ difficulty: 'night', finishedAt: null }), ANON, T + 30_000), null);
  assert.equal(checkRunFinish(null, ANON, T), 'invalid_run');
  assert.equal(checkRunFinish(session(), null, T + 30_000), 'invalid_run');
  assert.equal(checkRunFinish(session({ usedAt: T + 1 }), ANON, T + 30_000), 'run_used');
  assert.equal(checkRunFinish(session(), ANON, T + RUN_SESSION_TTL_MS + 1), 'run_expired');
});

test('runRejectMessage: user-safe text for every code, and a generic one for anything else', () => {
  for (const code of RUN_REJECT_CODES) assert.match(runRejectMessage(code), /^this run/);
  assert.equal(runRejectMessage('<script>'), 'this run could not be verified');
  assert.equal(runRejectMessage(undefined), 'this run could not be verified');
});

test('leaderboardSubmitGate: admin, then difficulty, then the silent floor, then pause, then the run id', () => {
  const ok = { adminMode: false, adminUsedThisRun: false, difficulty: 'blackout', timeMs: 60_000, pausedThisRun: false, runId: 'a'.repeat(32) };
  assert.equal(leaderboardSubmitGate(ok), 'form');
  assert.equal(leaderboardSubmitGate({ ...ok, adminMode: true, difficulty: 'night', pausedThisRun: true }), 'admin');
  assert.equal(leaderboardSubmitGate({ ...ok, adminUsedThisRun: true }), 'admin');
  assert.equal(leaderboardSubmitGate({ ...ok, difficulty: 'night', runId: null }), 'ineligible');
  assert.equal(leaderboardSubmitGate({ ...ok, timeMs: PLAUSIBILITY_FLOOR_MS - 1, pausedThisRun: true }), 'hidden');
  assert.equal(leaderboardSubmitGate({ ...ok, pausedThisRun: true, runId: null }), 'paused');
  assert.equal(leaderboardSubmitGate({ ...ok, pausedThisRun: true, runId: null, runRefused: true }), 'paused');
  assert.equal(leaderboardSubmitGate({ ...ok, runId: null, runRefused: true }), 'unverified');
  assert.equal(leaderboardSubmitGate({ ...ok, runId: null }), 'untimed');
});
