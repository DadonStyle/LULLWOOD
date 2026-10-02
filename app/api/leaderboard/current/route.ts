import { parseRecord } from '../../../../lib/game/leaderboard.ts';
import { serviceConfig, callService } from '../../../../lib/leaderboard/remote.ts';

// LUL-3264 wave 1, S2: GET /api/leaderboard/current -- the record holder or
// { record: null } (empty board). B7: the handler takes no `req` argument at
// all, so nothing user-controlled can reach it or vary the cached bytes.
//
// Cached at Vercel's edge via s-maxage (60s, decisions/lul-3264-leaderboard-
// accepted-2026-09-18 Decision 3: the record changes a few times a day at
// most). force-dynamic stops Next from trying to prerender it at build time,
// when the service may not be reachable.
//
// Never answers 5xx: this is fetched on every page load, and a 5xx shows up as
// a browser console error on every visit (and in every e2e run's console-error
// check) while the service is unconfigured or down. `{ unavailable: true }`
// with no-store instead; the client treats it exactly like a failed fetch
// (cached record or hidden line).

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const config = serviceConfig();
  const unavailable = () => Response.json({ unavailable: true }, { headers: { 'cache-control': 'no-store' } });
  if (!config) return unavailable();
  const result = await callService(config, 'GET', '/v1/current');
  if (!result || result.status !== 200) return unavailable();
  const record = parseRecord((result.body as { record?: unknown })?.record);
  return Response.json({ record }, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } });
}
