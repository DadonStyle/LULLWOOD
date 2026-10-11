// LUL-5960 (root cause for LUL-5959/LUL-5958): app/api/telemetry/route.ts
// writes one private blob per event to events/{yyyy}/{mm}/{dd}/{uuid}.json
// and nothing ever deleted them. blob-source.ts only ever reads a bounded
// window (RANGE_MS, max 30d), so nothing older than that is ever read back.

export const TELEMETRY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const EVENT_PATH_RE = /^events\/(\d{4})\/(\d{2})\/(\d{2})\//;

/** Parses the events/{yyyy}/{mm}/{dd}/... prefix written by the telemetry
 * route (app/api/telemetry/route.ts:97-101) and read by blob-source.ts's
 * dayPrefix(). Returns null for anything that doesn't match that shape. */
export function parseEventDate(pathname: string): Date | null {
  const match = EVENT_PATH_RE.exec(pathname);
  if (!match) return null;
  const [, yyyy, mm, dd] = match;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** True only when pathname parses as an events/ blob AND is older than the
 * retention window. Unparseable paths (including non-events/ prefixes like
 * suggestions/) fail safe to false -- never delete the unexpected. */
export function isPrunable(
  pathname: string,
  nowMs: number,
  retentionMs: number = TELEMETRY_RETENTION_MS,
): boolean {
  const date = parseEventDate(pathname);
  if (!date) return false;
  return date.getTime() < nowMs - retentionMs;
}
