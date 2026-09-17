import { createHash } from 'node:crypto';
import { put } from '@vercel/blob';

// LUL-1918/LUL-2963/LUL-2993: POST /api/suggestions -- player suggestion
// intake for the suggestion box (parent LUL-1917). Re-validates the UI's
// lowercase-a-z-and-space restriction server-side, independently, byte for
// byte -- duplication with components/SuggestionBox.tsx is intentional
// (LUL-1917 guard 2).
//
// Uses web-standard Request/Response (no next/server import), same reasoning
// as app/api/telemetry/route.ts: directly testable with node --test, no
// Next.js runtime mocking required.
//
// Security posture (see PR body for the full note):
// - Text is DATA only, restricted to `^[a-z ]{3,300}$` -- lowercase English
//   letters and spaces, no digits, no punctuation, no other scripts. It is
//   fenced as "untrusted player text" wherever it is persisted and is never
//   placed anywhere it could be read as an instruction.
// - IP addresses are never stored raw -- only a salted SHA-256 hash, used
//   both for rate-limit bucketing and as an audit trail on the stored record.
//
// LUL-2993 (founder review, 2026-09-17): LUL-2963's local-disk storage
// (`/mnt/hdd/lullwood-suggestions`) never persisted a single suggestion in
// production -- the Vercel serverless runtime for www.lullwoodgame.com gets a
// fresh, isolated, non-persistent filesystem per invocation with no route to
// any physical disk on this box, so every write failed and every submit
// degraded to a silent 503. This route now writes to the same Vercel Blob
// store app/api/telemetry/route.ts already uses (BLOB_READ_WRITE_TOKEN is
// live there), under a `suggestions/` prefix instead of `events/`. Unlike
// telemetry's degrade-to-204-on-missing-token contract (acceptable there --
// analytics loss is not urgent), a missing token or a failed `put()` here is
// treated as an incident: logged loudly with `console.error` so it surfaces
// in Vercel's function logs, not merely `console.warn`'d once and forgotten.

const TEXT_PATTERN = /^[a-z ]{3,300}$/;
const MAX_BODY_BYTES = 2048;

// Abuse guards: in-memory, reset on cold start. Best-effort only, same
// tradeoff as app/api/telemetry/route.ts's isRateLimited -- a new Lambda
// instance starts fresh. Vercel KV would survive across instances; not worth
// the added dependency for a form nobody expects to be hammered.
const lastSubmitAtByIp = new Map<string, number>();
const DEFAULT_COOLDOWN_MS = 10 * 1000; // founder direction 2026-09-16: 1 suggestion per 10s per IP

function cooldownMs(): number {
  // Overridable only so route.test.ts can run many same-IP requests back to
  // back without a real 10s sleep per test; production always gets the
  // 10s default, no env var is set for it anywhere else.
  const override = Number(process.env.SUGGESTIONS_COOLDOWN_MS_TEST_OVERRIDE);
  return Number.isFinite(override) && override >= 0 ? override : DEFAULT_COOLDOWN_MS;
}

const ipCounts = new Map<string, { count: number; resetAt: number }>();
const IP_LIMIT = 5;
const IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const DAY_MS = 24 * 60 * 60 * 1000;
const GLOBAL_LIMIT = 200;
let globalCount = 0;
let globalResetAt = Date.now() + DAY_MS;

function hashIp(ip: string): string {
  const salt = process.env.SUGGESTIONS_IP_HASH_SALT ?? '';
  return createHash('sha256').update(salt + ip).digest('hex');
}

function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function isInCooldown(ipHash: string): boolean {
  const now = Date.now();
  const last = lastSubmitAtByIp.get(ipHash);
  if (last !== undefined && now - last < cooldownMs()) {
    return true;
  }
  lastSubmitAtByIp.set(ipHash, now);
  return false;
}

function isIpRateLimited(ipHash: string): boolean {
  const now = Date.now();
  const entry = ipCounts.get(ipHash);
  if (!entry || now >= entry.resetAt) {
    ipCounts.set(ipHash, { count: 1, resetAt: now + IP_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > IP_LIMIT;
}

function isGlobalRateLimited(): boolean {
  const now = Date.now();
  if (now >= globalResetAt) {
    globalCount = 0;
    globalResetAt = now + DAY_MS;
  }
  globalCount++;
  return globalCount > GLOBAL_LIMIT;
}

// Blob path: suggestions/{yyyy}/{mm}/{dd}/{uuid}.json -- same date-prefix
// layout as app/api/telemetry/route.ts (see lib/dashboard/blob-source.ts for
// why: Blob has no query engine, so a reader lists date folders and fetches
// each object).
function blobPath(now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const uuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `suggestions/${yyyy}/${mm}/${dd}/${uuid}.json`;
}

/**
 * Writes one suggestion to the Blob store. Returns false (never throws) on
 * any failure -- a missing token or a failed `put()` is logged loudly with
 * `console.error` on every occurrence (not throttled the way the telemetry
 * route throttles its warning) because a dropped suggestion is the kind of
 * silent data loss LUL-2993 was filed over; the caller degrades to 503.
 */
async function writeSuggestion(text: string, ipHash: string): Promise<boolean> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[suggestions] CRITICAL: BLOB_READ_WRITE_TOKEN is not set -- suggestion intake is completely down');
    return false;
  }

  const now = new Date();
  const record = {
    submitted_at: now.toISOString(),
    ip_hash: ipHash,
    text,
  };

  try {
    // access: 'private' (not telemetry's 'public') -- deliberate, per LUL-2993
    // founder review: telemetry's public blobs are anonymous event counters,
    // but a suggestion is free-form human text a player typed, so its URL
    // must not be guessable/fetchable by anyone holding it. Reading a
    // private blob back (lib/suggestions/blob-source.ts) requires the same
    // BLOB_READ_WRITE_TOKEN this write already needs.
    await put(blobPath(now), JSON.stringify(record), {
      access: 'private',
      contentType: 'application/json',
    });
    return true;
  } catch (err) {
    console.error('[suggestions] CRITICAL: Blob store write failed -- suggestion intake is degraded', err);
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload too large' }, { status: 413 });
  }

  let payload: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return Response.json({ error: 'payload too large' }, { status: 413 });
    }
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return Response.json({ error: 'invalid payload' }, { status: 400 });
  }

  const { text, website } = payload as Record<string, unknown>;

  // Honeypot: hidden from real players via CSS, so a non-empty value means a
  // bot filled every field. Look successful, create nothing.
  if (typeof website === 'string' && website.length > 0) {
    return new Response(null, { status: 204 });
  }

  if (typeof text !== 'string' || !TEXT_PATTERN.test(text)) {
    return Response.json({ error: 'text must match ^[a-z ]{3,300}$' }, { status: 400 });
  }

  const ipHash = hashIp(getClientIp(req));

  if (isInCooldown(ipHash)) {
    return Response.json({ error: 'please wait a few seconds before sending another suggestion' }, { status: 429 });
  }

  if (isIpRateLimited(ipHash) || isGlobalRateLimited()) {
    return Response.json({ error: 'rate limited' }, { status: 429 });
  }

  const created = await writeSuggestion(text, ipHash);
  if (!created) {
    return Response.json({ error: 'suggestion intake unavailable' }, { status: 503 });
  }

  return new Response(null, { status: 204 });
}
