// LUL-2993: reads player suggestions back out of the same Vercel Blob store
// app/api/suggestions/route.ts writes to (`suggestions/` prefix). Mirrors
// lib/dashboard/blob-source.ts's list-then-fetch shape -- Blob has no query
// engine, so this lists every object under the prefix and fetches each one.
// Suggestion volume is capped at 200/day (route.ts's GLOBAL_LIMIT), so unlike
// the telemetry dashboard this does not need a date-range window: it always
// returns the whole queue.
//
// Unlike the telemetry dashboard (public blobs, read with a plain `fetch` of
// the object's public URL), suggestions are written with `access: 'private'`
// (route.ts, LUL-2993 founder review) so a reader must go through `get()`,
// which is authenticated with the same BLOB_READ_WRITE_TOKEN the write used.

import { get, list } from '@vercel/blob';

export interface StoredSuggestion {
  submitted_at: string;
  ip_hash: string;
  text: string;
}

interface BlobRef {
  pathname: string;
}

function parseSuggestion(json: unknown): StoredSuggestion | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.submitted_at !== 'string') return null;
  if (typeof obj.ip_hash !== 'string') return null;
  if (typeof obj.text !== 'string') return null;
  return { submitted_at: obj.submitted_at, ip_hash: obj.ip_hash, text: obj.text };
}

async function listAllBlobs(): Promise<BlobRef[]> {
  const blobs: BlobRef[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: 'suggestions/', cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function fetchAndParse(blob: BlobRef): Promise<StoredSuggestion | null> {
  try {
    const result = await get(blob.pathname, { access: 'private' });
    if (!result || !result.stream) return null;
    const json = await new Response(result.stream).json();
    return parseSuggestion(json);
  } catch {
    // One unreadable object must not fail the whole read.
    return null;
  }
}

/** Fetches every suggestion currently in the store, oldest first. */
export async function listSuggestions(): Promise<StoredSuggestion[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return [];
  }
  const blobs = await listAllBlobs();
  const parsed = await Promise.all(blobs.map(fetchAndParse));
  return parsed
    .filter((s): s is StoredSuggestion => s !== null)
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
}
