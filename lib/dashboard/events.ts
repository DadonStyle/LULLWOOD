// LUL-155: shared shape for events read back out of Vercel Blob.
// Mirrors the schema locked in lib/analytics.ts / wiki `game/m4-analytics-plan`
// -- this module only re-validates the envelope, it does not own the schema.

export const KNOWN_EVENTS = [
  'page_view',
  'cta_start_clicked',
  'game_start',
  'win',
  'loss',
  'session_length',
  'feature_engagement',
] as const;

export type EventName = (typeof KNOWN_EVENTS)[number];

export interface RawEvent {
  event: EventName;
  ts: number;
  anon_id: string;
  [key: string]: unknown;
}

const KNOWN_EVENT_SET: ReadonlySet<string> = new Set(KNOWN_EVENTS);

/**
 * Parses one Blob object's JSON text into a RawEvent, or null if it doesn't
 * match the envelope. Malformed objects are dropped, never thrown -- a
 * dashboard read must not 500 because one historical event is corrupt.
 */
export function parseRawEvent(json: unknown): RawEvent | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.event !== 'string' || !KNOWN_EVENT_SET.has(obj.event)) return null;
  if (typeof obj.ts !== 'number' || !Number.isFinite(obj.ts)) return null;
  if (typeof obj.anon_id !== 'string' || obj.anon_id.length < 1) return null;
  return obj as RawEvent;
}
