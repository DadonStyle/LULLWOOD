import {
  validateNickname, validateCountry, validateTimeMs, validateAnonId, clampListLimit, parseCursor, parseRecord, MAX_BODY_BYTES,
  type LeaderboardRecord,
} from '../../../lib/game/leaderboard.ts';
import { getClientIp, hashIp, usableSalt, deviceFromUserAgent } from '../../../lib/request-identity.ts';
import { serviceConfig, callService } from '../../../lib/leaderboard/remote.ts';

// LUL-3264 wave 1, S1 (write) + S2 (winners table), SQLite variant. Storage is
// the leaderboard service on the founder's server (services/leaderboard-db/),
// reached with a signed request; see docs/specs/lul-3264-leaderboard-wave1.md
// "SQLite variant" and docs/specs/lul-3264-leaderboard-security.md.
//
// Uses web-standard Request/Response (no next/server import), same reasoning
// as app/api/suggestions/route.ts: directly testable with node --test.
//
// This handler validates everything (B1, B2, B4, B6, B9) and the service
// validates it all again. Rate limits (cooldown, per-IP, global) live in the
// service's SQLite transaction, keyed by the salted IP hash computed here --
// never in this function's memory (threat model A3).

const unavailable = () => Response.json({ error: 'leaderboard unavailable' }, { status: 503 });

export async function POST(req: Request): Promise<Response> {
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) return Response.json({ error: 'payload too large' }, { status: 413 });

  let payload: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return Response.json({ error: 'payload too large' }, { status: 413 });
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return Response.json({ error: 'invalid payload' }, { status: 400 });
  }
  const body = payload as Record<string, unknown>;

  // Honeypot (B11): bot-noise reduction only, not a security control.
  if (typeof body.website === 'string' && body.website.length > 0) return new Response(null, { status: 204 });

  const nickname = validateNickname(body.nickname);
  const country = validateCountry(body.country);
  const timeMs = validateTimeMs(body.time_ms);
  if (nickname === null) return Response.json({ error: 'nickname must be 3-20 letters or digits' }, { status: 400 });
  if (country === null) return Response.json({ error: 'unsupported country' }, { status: 400 });
  if (timeMs === null) return Response.json({ error: 'invalid time' }, { status: 400 });

  const salt = usableSalt(process.env.LEADERBOARD_IP_HASH_SALT);
  const config = serviceConfig();
  if (!salt || !config) {
    console.error('[leaderboard] CRITICAL: LEADERBOARD_IP_HASH_SALT, LEADERBOARD_API_URL or LEADERBOARD_API_SECRET is not set -- submissions refused');
    return unavailable();
  }

  const device = deviceFromUserAgent(req.headers.get('user-agent'));
  const result = await callService(config, 'POST', '/v1/submit', {
    nickname,
    country,
    time_ms: timeMs,
    ip_hash: hashIp(getClientIp(req), salt),
    // Vercel's own build env, never a client-supplied field.
    build_sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 40) || 'dev',
    anon_id: validateAnonId(body.anon_id),
    device_class: device.deviceClass,
    browser: device.browser,
  });
  if (!result) return unavailable();
  if (result.status === 201) {
    const isRecord = (result.body as { isRecord?: unknown })?.isRecord === true;
    return Response.json({ isRecord }, { status: 201 });
  }
  if (result.status === 429) {
    const reason = (result.body as { error?: unknown })?.error;
    const message = reason === 'cooldown' ? 'please wait a few seconds before submitting again' : 'rate limited';
    return Response.json({ error: message }, { status: 429 });
  }
  if (result.status === 400) return Response.json({ error: 'invalid submission' }, { status: 400 });
  console.error('[leaderboard] unexpected service status on submit', result.status);
  return unavailable();
}

export async function GET(req: Request): Promise<Response> {
  const config = serviceConfig();
  if (!config) return unavailable();
  // B3: only the clamped integer values reach the service URL, never the raw strings.
  const params = new URL(req.url).searchParams;
  const limit = clampListLimit(params.get('limit'));
  const cursor = parseCursor(params.get('cursor'));
  const result = await callService(config, 'GET', `/v1/records?limit=${limit}${cursor === null ? '' : `&cursor=${cursor}`}`);
  if (!result || result.status !== 200) return unavailable();
  const raw = result.body as { records?: unknown; nextCursor?: unknown };
  const records = Array.isArray(raw?.records)
    ? raw.records.map(parseRecord).filter((r): r is LeaderboardRecord => r !== null)
    : [];
  const nextCursor = typeof raw?.nextCursor === 'number' && Number.isSafeInteger(raw.nextCursor) ? raw.nextCursor : null;
  return Response.json({ records, nextCursor }, { headers: { 'cache-control': 'no-store' } });
}
