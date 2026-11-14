// Run: node --test lib/game/run-trace.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../engine/tuning.js';
import {
  createTraceRecorder, recordTracePosition, finishTrace, encodeSamples, decodeSamples, checkRunTrace, isValidInterval,
  GAME_WALK_SPEED, GAME_MAX_SPEED, TRACE_MAX_SPEED, TRACE_MAX_SAMPLES, TRACE_MAX_ENCODED, TRACE_WORLD_LIMIT, TRACE_QUANTUM,
  TRACE_BASE_INTERVAL_MS, TRACE_MIN_CHILD_RADIUS, type RunTrace,
} from './run-trace.ts';
import { PLAUSIBILITY_CEILING_MS, PLAUSIBILITY_FLOOR_MS } from './leaderboard.ts';

const MAX_END = PLAUSIBILITY_CEILING_MS;
const CHILD = { x: 120, z: 90 }; // 150 u from home

/**
 * Plays a run the way the engine records it: one recordTracePosition() per
 * frame, the player walking from home to the child at constant speed so the
 * child is reached at endMs. `frameMs` is the frame time; `stalls` are
 * [fromMs, toMs] gaps with no frames at all (a hidden tab).
 */
function playRun(endMs: number, opts: { frameMs?: number; stalls?: [number, number][]; child?: { x: number; z: number }; path?: (f: number) => { x: number; z: number } } = {}): RunTrace {
  const child = opts.child ?? CHILD;
  const path = opts.path ?? ((f: number) => ({ x: child.x * f, z: child.z * f }));
  const rec = createTraceRecorder();
  const frame = opts.frameMs ?? 16;
  for (let t = 0; t < endMs; t += frame) {
    if (opts.stalls?.some(([a, b]) => t > a && t < b)) continue;
    const p = path(t / endMs);
    recordTracePosition(rec, t, p.x, p.z);
  }
  const end = path(1);
  return finishTrace(rec, endMs, end.x, end.z, child);
}

const coordsOf = (trace: RunTrace) => decodeSamples(trace.samples)!;
const withCoords = (trace: RunTrace, coords: number[]): RunTrace => ({ ...trace, samples: encodeSamples(coords) });

test('the speed cap is derived from the real engine speeds', () => {
  assert.equal(GAME_WALK_SPEED, CONFIG.walk);
  assert.ok(Math.abs(GAME_MAX_SPEED - 12.96) < 1e-9, String(GAME_MAX_SPEED));
  assert.ok(TRACE_MAX_SPEED >= GAME_MAX_SPEED * 1.5 - 1e-9);
  assert.ok(TRACE_WORLD_LIMIT >= CONFIG.mapSize / 2, 'the trace must accept every position the map allows');
});

test('encodeSamples/decodeSamples round-trip int16 pairs, negatives and every padding length', () => {
  for (const coords of [[0, 0], [1, -1, 32767, -32768], [5, 6, -7, 8, 900, -960], [-1, -2, -3, -4, -5, -6, -7, -8]]) {
    assert.deepEqual(decodeSamples(encodeSamples(coords)), coords);
  }
  assert.equal(decodeSamples('not base64!'), null);
  assert.equal(decodeSamples('AAA='), null, 'three bytes are not a whole int16 pair');
  assert.equal(decodeSamples('AA=A'), null);
});

test('an honest run passes and reports the run time it ends at', () => {
  const trace = playRun(42_345);
  assert.equal(trace.end_ms, 42_345);
  assert.equal(trace.interval_ms, TRACE_BASE_INTERVAL_MS);
  assert.deepEqual(trace.child, [120, 90]);
  const check = checkRunTrace(trace, MAX_END);
  assert.deepEqual(check, { ok: true, endMs: 42_345, samples: 44 }); // 0..42 s plus the lift
});

test('the fastest honest run the floor allows passes (sprinting with the wind the whole way)', () => {
  const end = PLAUSIBILITY_FLOOR_MS;
  const dist = (GAME_MAX_SPEED * end) / 1000;
  const child = { x: dist * 0.6, z: dist * 0.8 };
  assert.ok(checkRunTrace(playRun(end, { child }), MAX_END).ok);
});

test('low frame rates and a hidden tab still give a sample count that matches the run time', () => {
  assert.ok(checkRunTrace(playRun(60_000, { frameMs: 250 }), MAX_END).ok, '4 fps');
  assert.ok(checkRunTrace(playRun(60_000, { frameMs: 1_100 }), MAX_END).ok, 'under 1 fps');
  // No frames for 25 s (the player can't move either), then the run goes on.
  const path = (f: number) => {
    const g = f < 0.3 ? f : f < 0.72 ? 0.3 : f - 0.42; // still while stalled
    return { x: (CHILD.x * g) / 0.58, z: (CHILD.z * g) / 0.58 };
  };
  const trace = playRun(60_000, { stalls: [[18_000, 43_000]], path });
  const check = checkRunTrace(trace, MAX_END);
  assert.ok(check.ok, JSON.stringify(check));
});

test('a long run keeps the trace bounded: the interval doubles instead', () => {
  const trace = playRun(10 * 60_000, { frameMs: 50 });
  assert.equal(trace.interval_ms, 4_000);
  assert.ok(coordsOf(trace).length / 2 <= TRACE_MAX_SAMPLES + 1);
  assert.ok(trace.samples.length <= TRACE_MAX_ENCODED);
  assert.ok(checkRunTrace(trace, MAX_END).ok);
  const hour = playRun(PLAUSIBILITY_CEILING_MS - 1_000, { frameMs: 500 });
  assert.equal(hour.interval_ms, 16_000);
  assert.ok(hour.samples.length <= TRACE_MAX_ENCODED);
  assert.ok(checkRunTrace(hour, MAX_END).ok);
});

test('the scripted "start, wait, finish" run has no path to the child and is refused', () => {
  // Standing at home the whole time, claiming the child was there.
  const idle = playRun(16_000, { child: CHILD, path: () => ({ x: 0, z: 0 }) });
  assert.deepEqual(checkRunTrace(idle, MAX_END), { ok: false, reason: 'end_not_at_child' });
  // Claiming the child was at home.
  const atHome = playRun(16_000, { child: { x: 2, z: 2 } });
  assert.deepEqual(checkRunTrace(atHome, MAX_END), { ok: false, reason: 'child_position' });
});

test('a teleport anywhere in the path is too fast', () => {
  const trace = playRun(40_000);
  const coords = coordsOf(trace);
  coords[20] += Math.round(40 / TRACE_QUANTUM); // sample 10 jumps 40 u sideways
  const check = checkRunTrace(withCoords(trace, coords), MAX_END);
  assert.equal(check.ok, false);
  assert.equal(!check.ok && check.reason, 'too_fast');
  // Straight to the child in far less time than walking takes.
  const rushed = playRun(10_000, { child: { x: 200, z: 200 } });
  assert.equal((checkRunTrace(rushed, MAX_END) as { reason: string }).reason, 'too_fast');
});

test('each malformed trace has its own reason', () => {
  const good = playRun(30_000);
  const coords = coordsOf(good);
  const reason = (t: unknown, max = MAX_END) => {
    const c = checkRunTrace(t, max);
    return c.ok ? 'ok' : c.reason;
  };
  assert.equal(reason(good), 'ok');
  for (const bad of [null, 'trace', [], 42]) assert.equal(reason(bad), 'shape');
  assert.equal(reason({ ...good, v: 2 }), 'version');
  assert.equal(reason({ ...good, end_ms: 30_000.5 }), 'shape');
  assert.equal(reason({ ...good, end_ms: -1 }), 'shape');
  assert.equal(reason(good, 29_999), 'shape', 'claims more run time than allowed');
  assert.equal(reason({ ...good, child: [1] }), 'shape');
  assert.equal(reason({ ...good, child: ['120', 90] }), 'shape');
  for (const iv of [0, 999, 1_500, 32_000, '1000']) assert.equal(reason({ ...good, interval_ms: iv }), 'interval', String(iv));
  assert.equal(reason({ ...good, samples: 42 }), 'encoding');
  assert.equal(reason({ ...good, samples: '$$$$' }), 'encoding');
  assert.equal(reason({ ...good, samples: 'A'.repeat(TRACE_MAX_ENCODED + 4) }), 'encoding');
  // Samples missing from the middle, or extra ones.
  assert.equal(reason(withCoords(good, [...coords.slice(0, 20), ...coords.slice(30)])), 'sample_count');
  assert.equal(reason(withCoords(good, [0, 0, 0, 0, ...coords])), 'sample_count');
  assert.equal(reason(withCoords(good, coords.slice(-2))), 'sample_count', 'the lift sample alone');
  // A coarser interval than the run length needs weakens the speed check.
  const halved = coords.filter((_, i) => Math.floor(i / 2) % 2 === 0 || i >= coords.length - 2);
  assert.equal(reason(withCoords({ ...good, interval_ms: 2_000 }, halved)), 'interval_too_long');
  // Off the map, not starting at home, child out of the world.
  const off = [...coords];
  off[10] = Math.round(260 / TRACE_QUANTUM);
  assert.equal(reason(withCoords(good, off)), 'out_of_world');
  const away = [...coords];
  away[0] = Math.round(20 / TRACE_QUANTUM);
  assert.equal(reason(withCoords(good, away)), 'start_not_home');
  assert.equal(reason({ ...good, child: [300, 0] }), 'child_position');
  assert.equal(reason({ ...good, child: [TRACE_MIN_CHILD_RADIUS - 1, 0] }), 'child_position');
  assert.equal(reason({ ...good, child: [-120, -90] }), 'end_not_at_child');
});

test('isValidInterval: 1 s doubled up to 16 s only', () => {
  assert.deepEqual([1_000, 2_000, 4_000, 8_000, 16_000].map(isValidInterval), [true, true, true, true, true]);
  assert.deepEqual([500, 3_000, 32_000].map(isValidInterval), [false, false, false]);
});
