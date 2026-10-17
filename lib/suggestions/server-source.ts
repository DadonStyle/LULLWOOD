import { serviceConfig, callService } from '../leaderboard/remote.ts';
import type { StoredSuggestion } from './rules.ts';

// LUL-2993/LUL-3000: reads the player suggestions queue back for the agents'
// reader (app/api/agent/suggestions/route.ts). Founder 2026-10-16: they live in
// the SQLite service on the founder's server now (services/leaderboard-db/,
// GET /v1/suggestions), not Vercel Blob. Volume is capped at 200/day, so this
// always returns the whole queue, oldest first.

export type { StoredSuggestion };

/** Every stored suggestion, oldest first; null when the service is unconfigured or unreachable. */
export async function listSuggestions(): Promise<StoredSuggestion[] | null> {
  const config = serviceConfig();
  if (!config) return null;
  const result = await callService(config, 'GET', '/v1/suggestions');
  if (result?.status !== 200) return null;
  const list = (result.body as { suggestions?: unknown } | null)?.suggestions;
  return Array.isArray(list) ? (list as StoredSuggestion[]) : null;
}
