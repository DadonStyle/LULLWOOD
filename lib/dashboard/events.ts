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
  // LUL-2239's `engine_contract_violation` and LUL-2392's `chase_gap` were added to the
  // lib/analytics.ts emitter union but never added here -- parseRawEvent() silently dropped
  // every row of both as "unknown event" (LUL-2392 follow-up: this file, not the emitter or
  // aggregate.ts, is what a dashboard read actually gates on).
  'engine_contract_violation',
  'chase_gap',
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
