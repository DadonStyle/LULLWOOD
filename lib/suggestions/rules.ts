// Suggestion-box rules shared by the Vercel route (app/api/suggestions/route.ts)
// and the founder's-server service that stores them
// (services/leaderboard-db/, installed by install.sh, which copies this file).
// Founder direction 2026-09-16: 1 suggestion per 10 s per IP; 5 per IP per
// hour; 200 a day across everyone.

/** Lowercase English letters and spaces only -- the box itself enforces the same (components/SuggestionBox.tsx). */
export const SUGGESTION_TEXT_PATTERN = /^[a-z ]{3,300}$/;
export const SUGGESTION_COOLDOWN_MS = 10 * 1000;
export const SUGGESTION_IP_LIMIT = 5;
export const SUGGESTION_IP_WINDOW_MS = 60 * 60 * 1000;
export const SUGGESTION_GLOBAL_LIMIT = 200;
export const SUGGESTION_GLOBAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** One stored suggestion as the agents' reader (app/api/agent/suggestions) returns it. */
export interface StoredSuggestion {
  submitted_at: string;
  ip_hash: string;
  text: string;
}
