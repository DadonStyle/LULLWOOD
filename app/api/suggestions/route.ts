import { getClientIp, hashIp, usableSalt } from '../../../lib/request-identity.ts';
import { serviceConfig, callService } from '../../../lib/leaderboard/remote.ts';
import { SUGGESTION_TEXT_PATTERN } from '../../../lib/suggestions/rules.ts';

// LUL-1918/LUL-2963/LUL-2993: POST /api/suggestions -- player suggestion
// intake for the suggestion box (parent LUL-1917). Re-validates the UI's
// lowercase-a-z-and-space restriction server-side, independently --
// duplication with components/SuggestionBox.tsx is intentional (LUL-1917
// guard 2).
//
// Uses web-standard Request/Response (no next/server import), same reasoning
// as app/api/telemetry/route.ts: directly testable with node --test.
//
// Security posture:
// - Text is DATA only, restricted to `^[a-z ]{3,300}$` -- lowercase English
//   letters and spaces, no digits, no punctuation, no other scripts.
// - IP addresses are never stored raw -- only a salted SHA-256 hash, used for
//   rate limiting and as an audit trail on the stored row.
// - LUL-3288 A1: the client IP comes from `x-vercel-forwarded-for`, else the
//   LAST `x-forwarded-for` hop -- never the client-controlled first one
//   (lib/request-identity.ts).
// - LUL-3288 A2: never hash with an empty salt; a missing
//   SUGGESTIONS_IP_HASH_SALT fails closed with a 503.
//
// Storage (founder 2026-10-16): suggestions used to be one Vercel Blob object
// each, with the cooldown and rate-limit counters as more Blob objects, and the
// store ran out of its Hobby-plan operations. They now live in the SQLite
// service on the founder's server (services/leaderboard-db/, same signed
// Tailscale Funnel hop as the leaderboard: LEADERBOARD_API_URL/_SECRET). The
// service checks the 10 s cooldown, 5/IP/hour and 200/day limits and stores
// the row in one transaction, so the limits are now exact instead of the old
// best-effort read-then-write. An unreachable service is an incident, not a
// silent success: logged loudly, 503 to the player.

const MAX_BODY_BYTES = 2048;
const UNAVAILABLE = { error: 'suggestion intake unavailable' };

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

  if (typeof text !== 'string' || !SUGGESTION_TEXT_PATTERN.test(text)) {
    return Response.json({ error: 'text must match ^[a-z ]{3,300}$' }, { status: 400 });
  }

  // Service-configuration gates, checked after the text so a bad request
  // still gets its 400.
  const salt = usableSalt(process.env.SUGGESTIONS_IP_HASH_SALT);
  if (!salt) {
    console.error('[suggestions] CRITICAL: SUGGESTIONS_IP_HASH_SALT is not set -- refusing to hash IPs with an empty salt');
    return Response.json(UNAVAILABLE, { status: 503 });
  }
  const config = serviceConfig();
  if (!config) {
    console.error('[suggestions] CRITICAL: LEADERBOARD_API_URL or LEADERBOARD_API_SECRET is not set -- suggestion intake is down');
    return Response.json(UNAVAILABLE, { status: 503 });
  }

  const result = await callService(config, 'POST', '/v1/suggestions', { text, ip_hash: hashIp(getClientIp(req), salt) });
  if (result?.status === 201) return new Response(null, { status: 204 });
  if (result?.status === 429) {
    const reason = (result.body as { error?: unknown } | null)?.error;
    return reason === 'cooldown'
      ? Response.json({ error: 'please wait a few seconds before sending another suggestion' }, { status: 429 })
      : Response.json({ error: 'rate limited' }, { status: 429 });
  }
  console.error('[suggestions] CRITICAL: the suggestion service did not store the suggestion', result?.status ?? 'unreachable');
  return Response.json(UNAVAILABLE, { status: 503 });
}
