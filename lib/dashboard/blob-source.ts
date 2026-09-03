// LUL-155: reads the dashboard's event window back out of Vercel Blob.
// Blob has no query engine (per wiki `game/m4-analytics-plan` §2) -- this
// lists date-prefixed folders for the range, fetches each object, and
// aggregate.ts does the rest in memory. Fine at current traffic; revisit
// if volume ever makes this slow (note the limit, don't solve it now).

import { list } from '@vercel/blob';
import { parseRawEvent, type RawEvent } from './events.ts';

export type Range = '24h' | '7d' | '30d';

const RANGE_MS: Record<Range, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function isRange(v: string | undefined | null): v is Range {
  return v === '24h' || v === '7d' || v === '30d';
}

function dayPrefix(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `events/${yyyy}/${mm}/${dd}/`;
}

/** Every calendar-day (UTC) folder prefix the [since, until] window can touch. */
export function enumerateDayPrefixes(since: number, until: number): string[] {
  const prefixes: string[] = [];
  const startDay = Math.floor(since / DAY_MS);
  const endDay = Math.floor(until / DAY_MS);
  for (let day = startDay; day <= endDay; day++) {
    prefixes.push(dayPrefix(day * DAY_MS));
  }
  return prefixes;
}

interface BlobRef {
  url: string;
}

async function listAllForPrefix(prefix: string): Promise<BlobRef[]> {
  const blobs: BlobRef[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function fetchAndParse(blob: BlobRef): Promise<RawEvent | null> {
  try {
    const res = await fetch(blob.url);
    if (!res.ok) return null;
    const json = await res.json();
    return parseRawEvent(json);
  } catch {
    // One unreadable object must not fail the whole dashboard load.
    return null;
  }
}

/** Fetches and aggregation-ready-parses every event in [now - range, now]. */
export async function fetchEvents(range: Range): Promise<RawEvent[]> {
  // Same degraded-mode contract as app/api/telemetry/route.ts: no token means
  // no store connected yet (LUL-481) -- render real zeroes instead of a
  // 500, rather than assuming the token is always present the way `list()`
  // does (it throws outright with no credentials).
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return [];
  }

  const now = Date.now();
  const since = now - RANGE_MS[range];

  const prefixes = enumerateDayPrefixes(since, now);
  const perPrefixBlobs = await Promise.all(prefixes.map(listAllForPrefix));
  const blobs = perPrefixBlobs.flat();

  const parsed = await Promise.all(blobs.map(fetchAndParse));
  return parsed.filter((e): e is RawEvent => e !== null && e.ts >= since && e.ts <= now);
}
