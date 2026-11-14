import { validateDifficulty, validateAnonId, validateRunId, MAX_BODY_BYTES } from '../../../../lib/game/leaderboard.ts';
import { getClientIp, hashIp, usableSalt } from '../../../../lib/request-identity.ts';
import { serviceConfig, callService } from '../../../../lib/leaderboard/remote.ts';
import { readJsonObject } from '../../../../lib/leaderboard/json-body.ts';

// POST /api/run/start { difficulty, anon_id } -> 201 { run_id } | 200 { unavailable: true } | 429
//
// Server-timed run sessions (lib/game/leaderboard.ts "run sessions"): the
// client calls this when a Blackout run starts. The leaderboard service stamps
// the start on its own clock and returns a random run id; the run's finish
// (app/api/run/finish) and its leaderboard submission must carry that id.
// The IP hash is computed exactly as app/api/leaderboard/route.ts does it, so
// the service can rate-limit starts per IP (RUN_START_IP_LIMIT).

// Fetched on every Blackout run start, so never a 5xx while the service is
// unconfigured or down (a 5xx is a browser console error in every QA/preview
// run; same convention as app/api/leaderboard/current). The client treats any
// non-201 as "no run id": the run is simply not leaderboard-eligible.
const unavailable = () => Response.json({ unavailable: true }, { headers: { 'cache-control': 'no-store' } });

export async function POST(req: Request): Promise<Response> {
  const body = await readJsonObject(req, MAX_BODY_BYTES);
  if (body instanceof Response) return body;
  const difficulty = validateDifficulty(body.difficulty);
  if (difficulty === null) return Response.json({ error: 'invalid difficulty' }, { status: 400 });

  const salt = usableSalt(process.env.LEADERBOARD_IP_HASH_SALT);
  const config = serviceConfig();
  if (!salt || !config) {
    console.error('[run-start] CRITICAL: LEADERBOARD_IP_HASH_SALT, LEADERBOARD_API_URL or LEADERBOARD_API_SECRET is not set -- run timing is down');
    return unavailable();
  }

  const result = await callService(config, 'POST', '/v1/runs/start', {
    difficulty,
    anon_id: validateAnonId(body.anon_id),
    ip_hash: hashIp(getClientIp(req), salt),
  });
  if (!result) return unavailable();
  if (result.status === 201) {
    const runId = validateRunId((result.body as { run_id?: unknown })?.run_id);
    if (runId) return Response.json({ run_id: runId }, { status: 201, headers: { 'cache-control': 'no-store' } });
  }
  if (result.status === 429) return Response.json({ error: 'too many runs started, try again later' }, { status: 429 });
  console.error('[run-start] unexpected service answer', result.status);
  return unavailable();
}
