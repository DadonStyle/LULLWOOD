import { serviceConfig, callService } from '../leaderboard/remote.ts';
import { parseRawEvent, type RawEvent } from './events.ts';

// LUL-155: the internal dashboard's event window. Founder 2026-10-16: read from
// the stats database on the founder's server (services/leaderboard-db/,
// GET /v1/events), which app/api/telemetry/route.ts already copied every event
// into. The old Vercel Blob reader listed every day folder and fetched every
// event object one by one on each page load, which used up the Blob store's
// Hobby-plan operations. aggregate.ts does the rest in memory, as before.

export type Range = '24h' | '7d' | '30d';

const RANGE_MS: Record<Range, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

// A 30-day window is a bigger answer than a leaderboard call; give it longer.
const READ_TIMEOUT_MS = 15_000;

export function isRange(v: string | undefined | null): v is Range {
  return v === '24h' || v === '7d' || v === '30d';
}

/**
 * Every parseable event in [now - range, now]. Empty when the service is
 * unconfigured or unreachable -- the dashboard renders real zeroes instead of
 * a 500, same contract the Blob reader had.
 */
export async function fetchEvents(range: Range): Promise<RawEvent[]> {
  const config = serviceConfig();
  if (!config) return [];
  const now = Date.now();
  const since = now - RANGE_MS[range];
  const result = await callService(config, 'GET', `/v1/events?since=${since}&until=${now}`, undefined, READ_TIMEOUT_MS);
  const list = result?.status === 200 ? (result.body as { events?: unknown } | null)?.events : null;
  if (!Array.isArray(list)) {
    console.error('[dashboard] could not read events from the stats service', result?.status ?? 'unreachable');
    return [];
  }
  return list.map(parseRawEvent).filter((e): e is RawEvent => e !== null && e.ts >= since && e.ts <= now);
}
