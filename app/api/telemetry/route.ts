import { put } from '@vercel/blob';

// LUL-482: POST /api/telemetry — Vercel Blob sink for analytics events.
// If BLOB_READ_WRITE_TOKEN is absent, logs once per cold start and returns 204.
// That is a degraded state, not an error — see LUL-482 and game/m4-analytics-plan.
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

  await put(blobPath, JSON.stringify(payload), {
    access: 'public',
    contentType: 'application/json',
  });

  return new Response(null, { status: 204 });
}
