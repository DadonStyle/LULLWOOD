// Relative import (not the '@/lib' alias) so this route is directly
// testable with `node --test`, no bundler -- same reasoning as
// app/api/suggestions/route.test.ts's relative import of this same module.
import { listSuggestions } from '../../../../lib/suggestions/blob-source.ts';

// LUL-3000: read-only JSON endpoint so the CEO's plain curl/bash heartbeat
// can pull the suggestions queue (LUL-2993's CEO-side review duty) without
// holding BLOB_READ_WRITE_TOKEN itself -- that token never leaves Vercel,
// staying exactly where app/api/suggestions/route.ts and
// lib/suggestions/blob-source.ts already use it.
//
// Deliberately NOT under /internal/* -- that gate's secret,
// INTERNAL_DASHBOARD_SECRET (see proxy.ts), is founder-only. This route has
// its own single-purpose secret, AGENT_SUGGESTIONS_READ_SECRET, checked via
// a header (not proxy.ts's cookie/query flow) since the caller is a bare
// script, not a browser. Worst case on a leak of that secret: read access to
// suggestion text + salted ip_hash, never write/delete on the blob store.
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
  return Response.json({ suggestions });
}
