import { createHash, timingSafeEqual } from 'node:crypto';
import { parseRecord } from '../../../../../lib/game/leaderboard.ts';
import { serviceConfig, callService } from '../../../../../lib/leaderboard/remote.ts';

// LUL-3264 wave 1, B5: POST /api/leaderboard/:id/invalidate -- admin soft
// delete of a bogus or offensive entry; the service promotes the next-fastest
// valid row in the same transaction.
//
// Authorization: Bearer <LEADERBOARD_ADMIN_TOKEN>. Unset token -> 503, fail
// closed (A2 lesson: never accept an unauthenticated call because the token
// was not configured). Wrong/missing header -> 401. Every call logs one line
// with { id, outcome } -- function logs plus the service's admin_audit table
// are the trail.

function tokenMatches(header: string | null, token: string): boolean {
  const given = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  // Compare fixed-length digests so neither length nor content leaks through timing.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(token).digest();
  return given.length > 0 && timingSafeEqual(a, b);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: rawId } = await params;
  const token = process.env.LEADERBOARD_ADMIN_TOKEN;
  if (!token || token.length < 32) {
    console.error('[leaderboard] invalidate', { id: rawId, outcome: 'refused-no-token-configured' });
    return Response.json({ error: 'admin unavailable' }, { status: 503 });
  }
  if (!tokenMatches(req.headers.get('authorization'), token)) {
    console.error('[leaderboard] invalidate', { id: rawId, outcome: 'unauthorized' });
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!/^\d{1,15}$/.test(rawId) || Number(rawId) <= 0) {
    console.error('[leaderboard] invalidate', { id: rawId, outcome: 'bad-id' });
    return Response.json({ error: 'invalid id' }, { status: 400 });
  }
  const config = serviceConfig();
  if (!config) return Response.json({ error: 'leaderboard unavailable' }, { status: 503 });

  let reason: string | null = null;
  try {
    const body = JSON.parse((await req.text()) || '{}') as { reason?: unknown };
    if (typeof body.reason === 'string') reason = body.reason.slice(0, 200);
  } catch {
    // reason is optional; a malformed body just means "no reason given"
  }

  const result = await callService(config, 'POST', `/v1/records/${Number(rawId)}/invalidate`, { reason });
  const outcome = !result ? 'service-unavailable' : result.status === 200 ? 'ok' : result.status === 404 ? 'not-found' : `service-${result.status}`;
  console.error('[leaderboard] invalidate', { id: rawId, outcome });
  if (!result) return Response.json({ error: 'leaderboard unavailable' }, { status: 503 });
  if (result.status === 404) return Response.json({ error: 'not found' }, { status: 404 });
  if (result.status !== 200) return Response.json({ error: 'leaderboard unavailable' }, { status: 503 });
  return Response.json({ current: parseRecord((result.body as { current?: unknown })?.current) });
}
