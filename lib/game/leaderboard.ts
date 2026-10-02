// LUL-3264 wave 1 (S1): pure leaderboard constants, validation and the
// plausibility floor. No DB import, no Node-only import -- shared verbatim by
// the Vercel route handlers (app/api/leaderboard/**), the client submit form
// (components/Leaderboard.tsx, UX only) and the SQLite service on the
// founder's server (services/leaderboard-db/), which re-validates every field
// itself rather than trusting the Vercel hop.
//
// Threat-model references (B1..B9) are decisions/lul-3288-leaderboard-threat-model-accepted-2026-09-18.

export const NICKNAME_PATTERN = /^[a-z0-9]{3,20}$/;
export const MAX_BODY_BYTES = 2048; // app/api/suggestions/route.ts MAX_BODY_BYTES, same cap reused (B6)
export const COOLDOWN_MS = 10_000; // app/api/suggestions/route.ts DEFAULT_COOLDOWN_MS, same value
export const IP_LIMIT = 5;
export const IP_WINDOW_MS = 60 * 60 * 1000;
export const GLOBAL_LIMIT = 200;
export const GLOBAL_WINDOW_MS = 24 * 60 * 60 * 1000;

// engine/tuning.js mapSize=480, home at origin, walk=6; lib/game/stamina.ts
// STAMINA_SPRINT_MUL=1.8 -- max theoretical speed 6*1.8=10.8 u/s, max
// theoretical distance = half-diagonal of the map ~= 339.4u. Floor = that
// distance / that speed, halved again as a margin against false positives on
// a genuinely fast run. Tune PLAUSIBILITY_MARGIN from real data once the board
// has traffic; do not re-derive the formula.
export const PLAUSIBILITY_MARGIN = 0.5;
export const PLAUSIBILITY_FLOOR_MS = Math.round((339.4 / 10.8) * 1000 * PLAUSIBILITY_MARGIN); // ~15_700
export const PLAUSIBILITY_CEILING_MS = 60 * 60 * 1000; // 1h -- rejects stale/bogus values, not a real constraint

// ISO 3166-1 alpha-2 allowlist (B9). Intentionally not the full table -- add
// codes as needed. S5's country->palette table is a separate concern.
export const COUNTRY_ALLOWLIST: ReadonlySet<string> = new Set([
  'US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'BR', 'IN', 'MX', 'ES', 'IT', 'NL', 'SE', 'NO',
  'DK', 'FI', 'PL', 'RU', 'CN', 'KR', 'ZA', 'NZ', 'IE', 'PT', 'AR', 'CL', 'TR', 'GR', 'IL',
]);

// B4: digit-substitution normalisation, applied after lowercasing.
const LEET_MAP: Record<string, string> = { '4': 'a', '1': 'i', '0': 'o', '3': 'e', '5': 's' };
export function normalizeForDenylist(nickname: string): string {
  return nickname.toLowerCase().replace(/[41035]/g, (c) => LEET_MAP[c]);
}

// Seed list only. The real list is a founder call (decisions/lul-3264-leaderboard-accepted-2026-09-18,
// "denylist seed") -- review before the record surface goes live to real players.
export const NICKNAME_DENYLIST: ReadonlySet<string> = new Set(['fuck', 'shit', 'cunt', 'nigger', 'nigga', 'rape']);

export function isDenylisted(nickname: string): boolean {
  const norm = normalizeForDenylist(nickname);
  for (const bad of NICKNAME_DENYLIST) if (norm.includes(bad)) return true;
  return false;
}

/** B2: lowercased nickname, or null. Rejects anything outside [a-z0-9]{3,20}. */
export function validateNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const lower = raw.toLowerCase();
  if (!NICKNAME_PATTERN.test(lower)) return null;
  if (isDenylisted(lower)) return null;
  return lower;
}

/** B9: upper-cased allowlisted country code, or null. */
export function validateCountry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.toUpperCase();
  return COUNTRY_ALLOWLIST.has(upper) ? upper : null;
}

/** B1: strict integer in [floor, ceiling]. `typeof` alone already rejects "5". */
export function validateTimeMs(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) return null;
  if (raw < PLAUSIBILITY_FLOOR_MS || raw > PLAUSIBILITY_CEILING_MS) return null;
  return raw;
}

// lib/analytics.ts anon_id: a v4 UUID, or one of its two documented fallbacks.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Links a submission to the browser profile's runs. Optional: null when absent or malformed. */
export function validateAnonId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const lower = raw.toLowerCase();
  return UUID_PATTERN.test(lower) ? lower : null;
}

/** Pagination clamp for the winners table (B3): never 400s, always a safe integer. */
export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 50;
export function clampListLimit(raw: unknown): number {
  const n = typeof raw === 'string' && /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= LIST_MAX_LIMIT ? n : LIST_DEFAULT_LIMIT;
}

/** Keyset cursor (a record id). Anything but a positive safe integer means "first page". */
export function parseCursor(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Shape of one record as the read endpoints return it and the client renders it. */
export interface LeaderboardRecord {
  id: number;
  nickname: string;
  country: string;
  timeMs: number;
  achievedAt: string;
}

/** B8: a value read back from localStorage or the network is untrusted until it passes this. */
export function parseRecord(raw: unknown): LeaderboardRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const nickname = validateNickname(r.nickname);
  const country = validateCountry(r.country);
  const timeMs = validateTimeMs(r.timeMs);
  if (nickname === null || country === null || timeMs === null) return null;
  if (typeof r.id !== 'number' || !Number.isSafeInteger(r.id) || r.id <= 0) return null;
  if (typeof r.achievedAt !== 'string' || Number.isNaN(Date.parse(r.achievedAt))) return null;
  return { id: r.id, nickname, country, timeMs, achievedAt: r.achievedAt };
}

// S3 client cache: last good record, shown when the fetch fails ("never fall
// back to empty on failure"), for at most CLIENT_CACHE_MAX_AGE_MS.
export const CLIENT_CACHE_KEY = 'lullwood:leaderboard:current';
export const CLIENT_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // "hours, not days"

export function encodeCachedRecord(record: LeaderboardRecord, now: number): string {
  return JSON.stringify({ record, storedAt: now });
}

/** B8: the localStorage value is untrusted -- any malformed or stale value is discarded. */
export function decodeCachedRecord(raw: string | null, now: number): LeaderboardRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { record, storedAt } = parsed as { record?: unknown; storedAt?: unknown };
  if (typeof storedAt !== 'number' || !Number.isFinite(storedAt)) return null;
  if (now - storedAt >= CLIENT_CACHE_MAX_AGE_MS || storedAt > now) return null;
  return parseRecord(record);
}
