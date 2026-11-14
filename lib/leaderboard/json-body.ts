// The body checks every leaderboard route makes before it looks at a field:
// a byte cap (declared and actual) and a JSON object at the top level.

/** The parsed object, or the error Response to return as is (413 or 400). */
export async function readJsonObject(req: Request, maxBytes: number): Promise<Record<string, unknown> | Response> {
  if (Number(req.headers.get('content-length') ?? '0') > maxBytes) return Response.json({ error: 'payload too large' }, { status: 413 });
  let payload: unknown;
  try {
    const raw = await req.text();
    if (raw.length > maxBytes) return Response.json({ error: 'payload too large' }, { status: 413 });
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return Response.json({ error: 'invalid payload' }, { status: 400 });
  return payload as Record<string, unknown>;
}
