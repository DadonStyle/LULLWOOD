import { validateAnonId, validateRunId, runRejectMessage, RUN_REJECT_CODES, RUN_SESSION_TTL_MS } from '../../../../lib/game/leaderboard.ts';
import { checkRunTrace, MAX_FINISH_BODY_BYTES, type RunTrace } from '../../../../lib/game/run-trace.ts';
import { serviceConfig, callService } from '../../../../lib/leaderboard/remote.ts';
import { readJsonObject } from '../../../../lib/leaderboard/json-body.ts';

// POST /api/run/finish { run_id, anon_id, trace } -> 200 { ok: true }
//
// Server-timed run sessions (lib/game/leaderboard.ts "run sessions"): the
// client calls this the moment the run clock stops (the child is lifted). The
// win screen and its submit form appear ~11 s later, after the lift
// cinematic, so the service measures the run as finish - start, not as
// submit - start. Finishing twice keeps the first stamp.
//
// Proof of play (lib/game/run-trace.ts): `trace` is the path the engine
// recorded. It is checked here (an invalid one never reaches the service)
// and again by the service, which also decides whether a finish without one
// is still accepted (LB_TRACE_REQUIRED, the deploy transition window). A
// refusal is 400 { error, code } -- the client only needs to know the run
// was refused, the sentence is for the player.

const unavailable = () => Response.json({ error: 'run timing unavailable' }, { status: 503 });
const refused = (code: string) => Response.json({ error: runRejectMessage(code), code }, { status: 400 });

export async function POST(req: Request): Promise<Response> {
  const body = await readJsonObject(req, MAX_FINISH_BODY_BYTES);
  if (body instanceof Response) return body;
  const runId = validateRunId(body.run_id);
  if (runId === null) return refused('invalid_run');
  let trace: RunTrace | null = null;
  if (body.trace !== undefined) {
    const check = checkRunTrace(body.trace, RUN_SESSION_TTL_MS);
    if (!check.ok) {
      console.warn('[run-finish] invalid trace refused:', check.reason);
      return refused('invalid_trace');
    }
    // Only the fields the service reads, nothing else the sender added.
    const t = body.trace as RunTrace;
    trace = { v: t.v, interval_ms: t.interval_ms, end_ms: t.end_ms, child: [t.child[0], t.child[1]], samples: t.samples };
  }

  const config = serviceConfig();
  if (!config) {
    console.error('[run-finish] CRITICAL: LEADERBOARD_API_URL or LEADERBOARD_API_SECRET is not set -- run timing is down');
    return unavailable();
  }

  const result = await callService(config, 'POST', '/v1/runs/finish', {
    run_id: runId, anon_id: validateAnonId(body.anon_id), ...(trace ? { trace } : {}),
  });
  if (!result) return unavailable();
  if (result.status === 200) return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  if (result.status === 400) {
    const code = String((result.body as { error?: unknown })?.error);
    return refused(RUN_REJECT_CODES.has(code) ? code : 'invalid_run');
  }
  console.error('[run-finish] unexpected service answer', result.status);
  return unavailable();
}
