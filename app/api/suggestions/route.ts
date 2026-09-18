import { createHash } from 'node:crypto';
import { put, get } from '@vercel/blob';

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
// LUL-3288 (founder security review, 2026-09-18): three defects fixed here,
// confirmed live and inherited by nothing yet (the leaderboard write path
// this route's guards were slated to seed does not exist in the repo as of
// this fix):
// - A1: `getClientIp` used to trust the client-supplied FIRST hop of
//   `x-forwarded-for`, which a client can set to anything and rotate per
//   request -- a complete, curl-only bypass of the cooldown/rate limit. Now
//   uses Vercel's platform-appended `x-vercel-forwarded-for`, falling back
//   to the LAST `x-forwarded-for` hop (the one appended by the nearest
//   trusted proxy, not the client-controlled first one).
// - A2: `hashIp` used to default the salt to `''` when
//   `SUGGESTIONS_IP_HASH_SALT` was unset, making every stored "hash" a
//   plain `sha256(ip)` -- reversible via a precomputed IPv4 rainbow table in
//   minutes. The route now fails closed (503, loud `console.error`) instead
//   of ever hashing with an empty salt.
// - A3: the cooldown/per-IP/global counters used to be plain in-process
//   `Map`s -- reset on every cold start, and each concurrent Lambda instance
//   kept its own, so the effective limit was "per instance, until it
//   recycles". They now live in the same Blob store the suggestions
//   themselves are written to, under a `suggestions/_ratelimit/` prefix, so
//   the limits are shared across instances and survive cold starts. This is
//   still best-effort (a plain read-then-write, no compare-and-swap --
//   concurrent requests can race and both see themselves as "first"), which
//   is an acceptable tradeoff for a low-traffic suggestion form; it is NOT
//   an acceptable pattern to copy forward for the leaderboard's
//   record-write path, which needs real atomicity (see the leaderboard
//   threat-model doc this ticket also produced).
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

// Abuse guards: state lives in the Blob store (see A3 note above) so it is
// shared across Lambda instances and survives cold starts.
const DEFAULT_COOLDOWN_MS = 10 * 1000; // founder direction 2026-09-16: 1 suggestion per 10s per IP

function cooldownMs(): number {
  // Overridable only so route.test.ts can run many same-IP requests back to
  // back without a real 10s sleep per test; production always gets the
  // 10s default, no env var is set for it anywhere else.
  const override = Number(process.env.SUGGESTIONS_COOLDOWN_MS_TEST_OVERRIDE);
  return Number.isFinite(override) && override >= 0 ? override : DEFAULT_COOLDOWN_MS;
}

const IP_LIMIT = 5;
const IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const DAY_MS = 24 * 60 * 60 * 1000;
const GLOBAL_LIMIT = 200;

const RATE_LIMIT_PREFIX = 'suggestions/_ratelimit';

interface RateWindow {
  count: number;
  resetAt: number;
}

interface CooldownRecord {
  lastSubmitAt: number;
}

/** Reads one rate-limit record back. Never throws -- a missing object, a
 * missing token, or a transient Blob error all just mean "no record yet",
 * which fails a single request open. That is the same best-effort tradeoff
 * the old in-memory Maps made on every cold start, just rarer now. */
async function readRateRecord<T>(path: string): Promise<T | null> {
  try {
    const result = await get(path, { access: 'private' });
    if (!result || !result.stream) return null;
    return (await new Response(result.stream).json()) as T;
  } catch {
    return null;
  }
}

async function writeRateRecord(path: string, data: RateWindow | CooldownRecord): Promise<void> {
  try {
    await put(path, JSON.stringify(data), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  } catch (err) {
    console.error('[suggestions] rate-limit state write failed -- this request fails open', err);
  }
}

function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(salt + ip).digest('hex');
}

/** Returns null (never `''`) if the salt is unset or empty -- the caller
 * must fail closed rather than hash with an empty salt (A2). */
function getIpHashSalt(): string | null {
  const salt = process.env.SUGGESTIONS_IP_HASH_SALT;
  return salt && salt.length > 0 ? salt : null;
}

function getClientIp(req: Request): string {
  // Vercel's edge sets/overwrites this header with the real client IP on
  // every request that reaches the deployment -- a client-supplied copy is
  // replaced before the function sees it, unlike `x-forwarded-for` where
  // the client fully controls the first hop (A1).
  const vercelIp = req.headers.get('x-vercel-forwarded-for');
  if (vercelIp) return vercelIp.split(',')[0].trim();

  // Fallback for environments without that header: the LAST hop of
  // `x-forwarded-for` is the one appended by the proxy closest to the
  // server, not the client-controlled first hop the client can spoof and
  // rotate at will.
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const hops = fwd
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  return req.headers.get('x-real-ip') ?? 'unknown';
}

async function isInCooldown(ipHash: string): Promise<boolean> {
  const path = `${RATE_LIMIT_PREFIX}/cooldown/${ipHash}.json`;
  const now = Date.now();
  const record = await readRateRecord<CooldownRecord>(path);
  if (record && now - record.lastSubmitAt < cooldownMs()) {
    return true;
  }
  await writeRateRecord(path, { lastSubmitAt: now });
  return false;
}

async function isIpRateLimited(ipHash: string): Promise<boolean> {
  const path = `${RATE_LIMIT_PREFIX}/ipcount/${ipHash}.json`;
  const now = Date.now();
  const record = await readRateRecord<RateWindow>(path);
  if (!record || now >= record.resetAt) {
    await writeRateRecord(path, { count: 1, resetAt: now + IP_WINDOW_MS });
    return false;
  }
  const count = record.count + 1;
  await writeRateRecord(path, { count, resetAt: record.resetAt });
  return count > IP_LIMIT;
}

async function isGlobalRateLimited(): Promise<boolean> {
  const path = `${RATE_LIMIT_PREFIX}/global.json`;
  const now = Date.now();
  const record = await readRateRecord<RateWindow>(path);
  const stale = !record || now >= record.resetAt;
  const count = stale ? 1 : record.count + 1;
  const resetAt = stale ? now + DAY_MS : record.resetAt;
  await writeRateRecord(path, { count, resetAt });
  return count > GLOBAL_LIMIT;
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
 * Writes one suggestion to the Blob store. Assumes the caller already
 * checked `BLOB_READ_WRITE_TOKEN` is set. Returns false (never throws) on a
 * failed `put()`, logged loudly with `console.error` on every occurrence
 * (not throttled the way the telemetry route throttles its warning) because
 * a dropped suggestion is the kind of silent data loss LUL-2993 was filed
 * over; the caller degrades to 503.
 */
async function writeSuggestion(text: string, ipHash: string): Promise<boolean> {
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

  // Both checks below are service-configuration gates, not per-request
  // quota -- fail fast before spending a Blob round-trip on rate-limit
  // state that can never lead anywhere but a 503 anyway.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[suggestions] CRITICAL: BLOB_READ_WRITE_TOKEN is not set -- suggestion intake is completely down');
    return Response.json({ error: 'suggestion intake unavailable' }, { status: 503 });
  }

  const salt = getIpHashSalt();
  if (!salt) {
    // A2: never hash with an empty/missing salt -- that turns the "hash"
    // into a reversible sha256(ip), precomputable across the whole IPv4
    // space in minutes.
    console.error('[suggestions] CRITICAL: SUGGESTIONS_IP_HASH_SALT is not set -- refusing to hash IPs with an empty salt');
    return Response.json({ error: 'suggestion intake unavailable' }, { status: 503 });
  }

  const ipHash = hashIp(getClientIp(req), salt);

  if (await isInCooldown(ipHash)) {
    return Response.json({ error: 'please wait a few seconds before sending another suggestion' }, { status: 429 });
  }

  if ((await isIpRateLimited(ipHash)) || (await isGlobalRateLimited())) {
    return Response.json({ error: 'rate limited' }, { status: 429 });
  }

  const created = await writeSuggestion(text, ipHash);
  if (!created) {
    return Response.json({ error: 'suggestion intake unavailable' }, { status: 503 });
  }

  return new Response(null, { status: 204 });
}
