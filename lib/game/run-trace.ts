// Proof of play (phase 2 of the "run times can be forged" fix,
// docs/specs/lul-3264-leaderboard-security.md "R2"). Pure: no DOM, no Node
// import -- shared by the engine (records the trace), the Vercel finish route
// and the leaderboard service (both validate it).
//
// During a run the engine samples the player's position every interval of
// run time, from the moment the run starts at home to the lift, and adds one
// last sample at the lift together with the child's position. The trace goes
// with POST /api/run/finish. The service accepts the finish only when the
// trace looks like a run of this game: it starts at home, it ends at the
// child, the child is where the game can place it, no step is faster than the
// player can move, and the sample count matches the run time it claims. The
// submitted time_ms must then equal that run time (checkRunSubmit).
//
// A script can still synthesise a trace that passes (see the spec's accepted
// risks). What this buys: a forged submission now needs a plausible path from
// home to a plausible child position at a legal speed, generated for every
// run, on top of the phase 1 server clock -- not just three HTTP calls.

import { STAMINA_SPRINT_MUL, WIND_ASSIST_SPEED_MUL } from './stamina.ts';

export const TRACE_VERSION = 1;
/** Run time between two samples while the trace is short. */
export const TRACE_BASE_INTERVAL_MS = 1_000;
/** Most regular samples (the lift sample comes on top). When full, every other sample is dropped and the interval doubles. */
export const TRACE_MAX_SAMPLES = 240;
/** Largest interval: 240 samples x 16 s covers more than the 1 h time ceiling. */
export const TRACE_MAX_INTERVAL_MS = 16_000;
/** Positions are stored as int16 counts of this many world units. */
export const TRACE_QUANTUM = 0.25;

// engine/tuning.js CONFIG.walk (6 u/s) x full-charge sprint x the wind-assist
// bonus = the fastest the player can move (12.96 u/s). The trace allows half
// as much again, plus a fixed slack per step for quantisation and the small
// position snaps of hiding and shuffling (lib/game/cover.ts SHUFFLE_OFFSET).
export const GAME_WALK_SPEED = 6;
export const GAME_MAX_SPEED = GAME_WALK_SPEED * STAMINA_SPRINT_MUL * WIND_ASSIST_SPEED_MUL;
export const TRACE_SPEED_MARGIN = 1.5;
export const TRACE_MAX_SPEED = GAME_MAX_SPEED * TRACE_SPEED_MARGIN;
export const TRACE_STEP_SLACK = 2;

/** engine/tuning.js mapSize 480: the player is clamped inside +-240. */
export const TRACE_WORLD_LIMIT = 250;
/** CONFIG.home is the origin (r 3.6); a run starts there. */
export const TRACE_HOME_RADIUS = 12;
/** The engine allows the pickup within 3.6 u of the child. */
export const TRACE_PICKUP_RADIUS = 8;
// The child spawns at least half*0.5 = 120 u from home (generateMap), and on
// Blackout at least BLACKOUT_MIN_RADIUS = 192 u -- but a first run after a
// difficulty change can still have the normal spawn, so only the lower bound
// is safe to enforce.
export const TRACE_MIN_CHILD_RADIUS = 110;
/** Largest gap between a submission's time_ms and the run time its trace ends at (both come from the same frozen run clock). */
export const TRACE_TIME_TOLERANCE_MS = 250;

/** Base64 length of TRACE_MAX_SAMPLES + 1 samples of 4 bytes. */
export const TRACE_MAX_ENCODED = 4 * Math.ceil(((TRACE_MAX_SAMPLES + 1) * 4) / 3);
/** Body cap of POST /api/run/finish: the largest trace plus room for the ids (the service's cap is 4096). */
export const MAX_FINISH_BODY_BYTES = TRACE_MAX_ENCODED + 1024;

/** The trace as it goes over the wire. `samples`: base64 of int16 LE (x, z) pairs in TRACE_QUANTUM units; the last pair is the lift. */
export interface RunTrace {
  v: number;
  interval_ms: number;
  end_ms: number;
  child: [number, number];
  samples: string;
}

// ---------------------------------------------------------------------------
// Recording (engine side)

export interface TraceRecorder {
  intervalMs: number;
  nextAtMs: number;
  /** Quantised x, z pairs, flat. */
  coords: number[];
}

export function createTraceRecorder(): TraceRecorder {
  return { intervalMs: TRACE_BASE_INTERVAL_MS, nextAtMs: 0, coords: [] };
}

const quantise = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v / TRACE_QUANTUM)));

/**
 * Called every frame with the run time (ms, pauses excluded) and the player's
 * position. Adds one sample for each interval boundary passed since the last
 * call, so a stalled or throttled tab still gets a sample count that matches
 * the run time (the player cannot move while frames are not running).
 */
export function recordTracePosition(rec: TraceRecorder, tMs: number, x: number, z: number): void {
  if (!Number.isFinite(tMs) || !Number.isFinite(x) || !Number.isFinite(z)) return;
  while (rec.nextAtMs <= tMs) {
    if (rec.coords.length / 2 >= TRACE_MAX_SAMPLES) {
      if (rec.intervalMs >= TRACE_MAX_INTERVAL_MS) return; // past the time ceiling: the run can't be submitted anyway
      const kept: number[] = [];
      for (let i = 0; i < rec.coords.length; i += 4) kept.push(rec.coords[i], rec.coords[i + 1]);
      rec.coords = kept;
      rec.intervalMs *= 2;
      rec.nextAtMs = (kept.length / 2) * rec.intervalMs;
      continue;
    }
    rec.coords.push(quantise(x), quantise(z));
    rec.nextAtMs += rec.intervalMs;
  }
}

/** The trace to send at the lift: the samples so far, the lift position and the child's position. */
export function finishTrace(rec: TraceRecorder, endMs: number, x: number, z: number, child: { x: number; z: number }): RunTrace {
  const end = Math.max(0, Math.round(endMs));
  recordTracePosition(rec, end, x, z);
  const coords = [...rec.coords, quantise(x), quantise(z)];
  return {
    v: TRACE_VERSION,
    interval_ms: rec.intervalMs,
    end_ms: end,
    child: [Math.round(child.x * 100) / 100, Math.round(child.z * 100) / 100],
    samples: encodeSamples(coords),
  };
}

// ---------------------------------------------------------------------------
// Encoding (no btoa/Buffer, so the same code runs in the browser and in Node)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*$/;

export function encodeSamples(coords: readonly number[]): string {
  const bytes: number[] = [];
  for (const c of coords) {
    const v = c & 0xffff;
    bytes.push(v & 0xff, v >> 8);
  }
  while (bytes.length % 3 !== 0) bytes.push(-1);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (Math.max(b, 0) << 8) | Math.max(c, 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b < 0 ? '=' : B64[(n >> 6) & 63]) + (c < 0 ? '=' : B64[n & 63]);
  }
  return out;
}

/** Quantised coords back, or null when the string is not base64 of whole int16 pairs. */
export function decodeSamples(text: string): number[] | null {
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const body = text.slice(0, text.length - pad) + 'A'.repeat(pad);
  if (!B64_PATTERN.test(body)) return null;
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i += 4) {
    const n = (B64.indexOf(body[i]) << 18) | (B64.indexOf(body[i + 1]) << 12) | (B64.indexOf(body[i + 2]) << 6) | B64.indexOf(body[i + 3]);
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  bytes.length -= pad;
  if (bytes.length % 4 !== 0) return null;
  const coords: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) {
    const v = bytes[i] | (bytes[i + 1] << 8);
    coords.push(v >= 0x8000 ? v - 0x10000 : v);
  }
  return coords;
}

// ---------------------------------------------------------------------------
// Validation (finish route and service)

/** Why a trace was refused. Logged on the server only; the player sees one code (invalid_trace). */
export type TraceRejectReason =
  | 'shape' | 'version' | 'interval' | 'encoding' | 'sample_count' | 'interval_too_long'
  | 'out_of_world' | 'start_not_home' | 'child_position' | 'end_not_at_child' | 'too_fast';

export type TraceCheck = { ok: true; endMs: number; samples: number } | { ok: false; reason: TraceRejectReason; detail?: string };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isValidInterval(ms: number): boolean {
  for (let i = TRACE_BASE_INTERVAL_MS; i <= TRACE_MAX_INTERVAL_MS; i *= 2) if (ms === i) return true;
  return false;
}

/**
 * Checks a trace on its own (no session needed). `maxEndMs` bounds the run
 * time it may claim. A valid trace's end_ms is what a submission's time_ms
 * must match.
 */
export function checkRunTrace(raw: unknown, maxEndMs: number): TraceCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'shape' };
  const t = raw as Record<string, unknown>;
  if (t.v !== TRACE_VERSION) return { ok: false, reason: 'version' };
  if (!isInt(t.end_ms) || t.end_ms < 0 || t.end_ms > maxEndMs) return { ok: false, reason: 'shape', detail: 'end_ms' };
  if (!isInt(t.interval_ms) || !isValidInterval(t.interval_ms)) return { ok: false, reason: 'interval' };
  if (!Array.isArray(t.child) || t.child.length !== 2 || !isNum(t.child[0]) || !isNum(t.child[1])) return { ok: false, reason: 'shape', detail: 'child' };
  if (typeof t.samples !== 'string' || t.samples.length > TRACE_MAX_ENCODED) return { ok: false, reason: 'encoding' };
  const coords = decodeSamples(t.samples);
  if (!coords) return { ok: false, reason: 'encoding' };

  const endMs = t.end_ms;
  const interval = t.interval_ms;
  const n = coords.length / 2;
  const regular = n - 1; // the last sample is the lift
  // One sample per interval boundary from 0 to end_ms. Off by one either way
  // is allowed: end_ms is rounded, the boundaries are not.
  const expected = Math.floor(endMs / interval) + 1;
  if (regular < 1 || regular > TRACE_MAX_SAMPLES || Math.abs(regular - expected) > 1) {
    return { ok: false, reason: 'sample_count', detail: `${regular} vs ${expected}` };
  }
  // A longer interval than needed would weaken the speed check: it is only
  // allowed once half of it would have overflowed TRACE_MAX_SAMPLES.
  if (interval > TRACE_BASE_INTERVAL_MS && Math.floor(endMs / (interval / 2)) + 1 < TRACE_MAX_SAMPLES - 1) {
    return { ok: false, reason: 'interval_too_long' };
  }

  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i] * TRACE_QUANTUM;
    const z = coords[i + 1] * TRACE_QUANTUM;
    if (Math.abs(x) > TRACE_WORLD_LIMIT || Math.abs(z) > TRACE_WORLD_LIMIT) return { ok: false, reason: 'out_of_world' };
    xs.push(x);
    zs.push(z);
  }
  if (Math.hypot(xs[0], zs[0]) > TRACE_HOME_RADIUS) return { ok: false, reason: 'start_not_home' };

  const [cx, cz] = t.child as [number, number];
  if (Math.abs(cx) > TRACE_WORLD_LIMIT || Math.abs(cz) > TRACE_WORLD_LIMIT || Math.hypot(cx, cz) < TRACE_MIN_CHILD_RADIUS) {
    return { ok: false, reason: 'child_position' };
  }
  if (Math.hypot(xs[n - 1] - cx, zs[n - 1] - cz) > TRACE_PICKUP_RADIUS) return { ok: false, reason: 'end_not_at_child' };

  for (let i = 1; i < n; i++) {
    const dtMs = i < n - 1 ? interval : Math.max(0, endMs - (regular - 1) * interval);
    const allowed = (TRACE_MAX_SPEED * dtMs) / 1000 + TRACE_STEP_SLACK;
    const step = Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    if (step > allowed) return { ok: false, reason: 'too_fast', detail: `sample ${i}: ${step.toFixed(1)}u > ${allowed.toFixed(1)}u` };
  }
  return { ok: true, endMs, samples: n };
}
