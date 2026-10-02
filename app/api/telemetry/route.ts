import { put } from '@vercel/blob';
import { deviceFromUserAgent, countryFromHeaders } from '../../../lib/request-identity.ts';
import { serviceConfig, callService } from '../../../lib/leaderboard/remote.ts';

// LUL-482: POST /api/telemetry — Vercel Blob sink for analytics events.
// If BLOB_READ_WRITE_TOKEN is absent, logs once per cold start and returns 204.
// That is a degraded state, not an error — see LUL-482 and game/m4-analytics-plan.
// A failed Blob write is treated the same way: logged, then 204. This route never
// answers 5xx to a browser beacon (LUL-4342).
//
// Uses web-standard Request/Response (no next/server import) so the handler
// is directly testable with node --test without mocking Next.js internals.
// Next.js Route Handlers accept web-standard Request/Response natively.

const VALID_EVENTS = new Set([
  'page_view',
  'cta_start_clicked',
  'game_start',
  'win',
  'loss',
  'session_length',
  'feature_engagement',
  'engine_contract_violation',
  'chase_gap',
  'started_tiers', // LUL-2998
]);

const MAX_BODY_BYTES = 2048;

// Abuse guard: in-memory counter per anon_id, resets each cold start.
// Best-effort only — a new Lambda instance starts fresh. Do not "fix" this
// by moving to a durable store; it is intentionally lightweight.
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60; // requests per minute per anon_id
const WINDOW_MS = 60_000;

function isRateLimited(anonId: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(anonId);
  if (!entry || now >= entry.resetAt) {
    requestCounts.set(anonId, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

let warnedAboutToken = false;

const STATS_TIMEOUT_MS = 1_500;

async function forwardToStats(req: Request, payload: Record<string, unknown>): Promise<void> {
  const config = serviceConfig();
  if (!config) return;
  const device = deviceFromUserAgent(req.headers.get('user-agent'));
  const result = await callService(config, 'POST', '/v1/events', {
    payload,
    device_class: device.deviceClass,
    browser: device.browser,
    country: countryFromHeaders(req),
  }, STATS_TIMEOUT_MS);
  if (result && result.status !== 202) console.error('[telemetry] stats copy refused', result.status);
}

export async function POST(req: Request): Promise<Response> {
  // Reject payloads over ~2KB before parsing
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload too large' }, { status: 413 });
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return Response.json({ error: 'payload too large' }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'invalid payload' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;

  const { event, ts, anon_id, build_sha, path } = payload;
  if (typeof event !== 'string' || !VALID_EVENTS.has(event)) {
    return Response.json({ error: 'unknown event' }, { status: 400 });
  }
  if (typeof ts !== 'number' || typeof anon_id !== 'string' || anon_id.length < 1) {
    return Response.json({ error: 'invalid envelope' }, { status: 400 });
  }
  if (typeof build_sha !== 'string' || typeof path !== 'string') {
    return Response.json({ error: 'invalid envelope' }, { status: 400 });
  }

  if (isRateLimited(anon_id)) {
    return Response.json({ error: 'rate limited' }, { status: 429 });
  }

  // LUL-3264 (SQLite variant): every validated event is also copied into the
  // stats database on the founder's server (services/leaderboard-db/), where
  // the agents can query it (win/loss land as typed `runs` rows). Same
  // contract as the Blob write below: unconfigured or unreachable means the
  // copy is skipped and logged, never a 5xx to the beacon. Short timeout so a
  // slow server cannot hold the function open.
  await forwardToStats(req, payload);

  // No Blob store yet — degraded mode. Return 204, do not throw.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    if (!warnedAboutToken) {
      console.warn('[telemetry] BLOB_READ_WRITE_TOKEN is not set — events are not persisted (LUL-481)');
      warnedAboutToken = true;
    }
    return new Response(null, { status: 204 });
  }

  // Blob path: events/{yyyy}/{mm}/{dd}/{uuid}.json
  // Date segments are load-bearing for LUL-155 date-prefix listing.
  const date = new Date(ts);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const uuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const blobPath = `events/${yyyy}/${mm}/${dd}/${uuid}.json`;

  // LUL-4342: `access: 'public'` made every telemetry event world-readable at a
  // Blob URL, and the store rejects it outright, so this `put()` threw on every
  // single request once the token was finally set. The throw was unguarded, so
  // the route answered 500 instead of persisting anything. The suggestions route
  // already writes `access: 'private'` (PR #743/#744); telemetry never got the
  // same change.
  //
  // The try/catch matters independently of the access mode. Telemetry is
  // fire-and-forget from the browser: a failed write must never surface to the
  // player as a 500, and it must never be silent either. Log loudly, return 204,
  // same contract as the missing-token branch above.
  try {
    await put(blobPath, JSON.stringify(payload), {
      access: 'private',
      contentType: 'application/json',
    });
  } catch (err) {
    console.error('[telemetry] blob write failed -- event dropped', blobPath, err);
  }

  return new Response(null, { status: 204 });
}
