import { createHash, timingSafeEqual } from 'node:crypto';
import { list, del } from '@vercel/blob';
import { isPrunable } from '../../../../lib/dashboard/retention.ts';

// LUL-5960 (root cause for LUL-5959/LUL-5958): app/api/telemetry/route.ts
// writes one private blob per event under events/ and nothing ever deleted
// them. This daily cron prunes events/ blobs older than
// lib/dashboard/retention.ts's TELEMETRY_RETENTION_MS -- the dashboard's
// longest read window (lib/dashboard/blob-source.ts RANGE_MS['30d']), so
// nothing this deletes was ever going to be read again.
//
// Vercel Cron Jobs send `Authorization: Bearer ${CRON_SECRET}` automatically
// when the CRON_SECRET project env var is set -- this is Vercel's documented
// cron-auth pattern. Fails closed: missing/mismatched header, or CRON_SECRET
// itself unset, is a 401, same "warn once per cold start" guard already used
// for BLOB_READ_WRITE_TOKEN in app/api/telemetry/route.ts:45-50.

let warnedAboutSecret = false;

function tokenMatches(header: string | null, secret: string): boolean {
  const given = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  // Compare fixed-length digests so neither length nor content leaks through timing.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return given.length > 0 && timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (!warnedAboutSecret) {
      console.error('[prune-telemetry] CRON_SECRET is not set -- refusing to run');
      warnedAboutSecret = true;
    }
    return new Response(null, { status: 401 });
  }

  if (!tokenMatches(req.headers.get('authorization'), secret)) {
    return new Response(null, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return new Response(null, { status: 204 });
  }

  const nowMs = Date.now();
  let scanned = 0;
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: 'events/', cursor, limit: 1000 });
    scanned += page.blobs.length;
    const prunablePathnames = page.blobs
      .filter((blob) => isPrunable(blob.pathname, nowMs))
      .map((blob) => blob.pathname);
    if (prunablePathnames.length > 0) {
      await del(prunablePathnames);
      deleted += prunablePathnames.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return Response.json({ scanned, deleted });
}
