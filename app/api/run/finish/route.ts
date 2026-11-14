import { validateAnonId, validateRunId, runRejectMessage, RUN_REJECT_CODES, MAX_BODY_BYTES } from '../../../../lib/game/leaderboard.ts';
import { serviceConfig, callService } from '../../../../lib/leaderboard/remote.ts';
import { readJsonObject } from '../../../../lib/leaderboard/json-body.ts';

// POST /api/run/finish { run_id, anon_id } -> 200 { ok: true }
//
// Server-timed run sessions (lib/game/leaderboard.ts "run sessions"): the
// client calls this the moment the run clock stops (the child is lifted). The
// win screen and its submit form appear ~11 s later, after the lift
// cinematic, so the service measures the run as finish - start, not as
// submit - start. Finishing twice keeps the first stamp.

const unavailable = () => Response.json({ error: 'run timing unavailable' }, { status: 503 });

export async function POST(req: Request): Promise<Response> {
  const body = await readJsonObject(req, MAX_BODY_BYTES);
  if (body instanceof Response) return body;
  const runId = validateRunId(body.run_id);
  if (runId === null) return Response.json({ error: runRejectMessage('invalid_run') }, { status: 400 });

  const config = serviceConfig();
  if (!config) {
    console.error('[run-finish] CRITICAL: LEADERBOARD_API_URL or LEADERBOARD_API_SECRET is not set -- run timing is down');
    return unavailable();
  }

  const result = await callService(config, 'POST', '/v1/runs/finish', { run_id: runId, anon_id: validateAnonId(body.anon_id) });
  if (!result) return unavailable();
  if (result.status === 200) return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  if (result.status === 400) {
    const code = (result.body as { error?: unknown })?.error;
    return Response.json({ error: runRejectMessage(RUN_REJECT_CODES.has(String(code)) ? code : 'invalid_run') }, { status: 400 });
  }
  console.error('[run-finish] unexpected service answer', result.status);
  return unavailable();
}
