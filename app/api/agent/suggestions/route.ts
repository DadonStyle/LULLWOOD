// Relative import (not the '@/lib' alias) so this route is directly
// testable with `node --test`, no bundler -- same reasoning as
// app/api/suggestions/route.test.ts's relative import of this same module.
import { listSuggestions } from '../../../../lib/suggestions/server-source.ts';

// LUL-3000: read-only JSON endpoint so the CEO's plain curl/bash heartbeat
// can pull the suggestions queue (LUL-2993's CEO-side review duty) without
// holding the leaderboard service secret itself -- that secret never leaves
// Vercel (lib/suggestions/server-source.ts reads the queue from the founder's
// server with it).
//
// Deliberately NOT under /internal/* -- that gate's secret,
// INTERNAL_DASHBOARD_SECRET (see proxy.ts), is founder-only. This route has
// its own single-purpose secret, AGENT_SUGGESTIONS_READ_SECRET, checked via
// a header (not proxy.ts's cookie/query flow) since the caller is a bare
// script, not a browser. Worst case on a leak of that secret: read access to
// suggestion text + salted ip_hash, never write or delete.
//
// Fails closed like proxy.ts: unset secret or a missing/mismatched header
// both return 404, never a 401/403 that would confirm the route exists, and
// never an empty-but-200 body that could be mistaken for "no suggestions".

const HEADER_NAME = 'x-agent-secret';

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.AGENT_SUGGESTIONS_READ_SECRET;
  if (!secret) {
    return new Response('Not found', { status: 404 });
  }

  const provided = req.headers.get(HEADER_NAME);
  if (provided !== secret) {
    return new Response('Not found', { status: 404 });
  }

  const suggestions = await listSuggestions();
  // Unreachable is a 503, never an empty-but-200 queue that reads as "no suggestions".
  if (suggestions === null) return Response.json({ error: 'suggestions unavailable' }, { status: 503 });
  return Response.json({ suggestions });
}
