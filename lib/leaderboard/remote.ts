import { randomBytes } from 'node:crypto';
import { signedHeaders, usableSecret } from './signing.ts';

// LUL-3264 (SQLite variant): the Vercel side of the call to the leaderboard
// service (services/leaderboard-db/server.ts) on the founder's server, reached
// through Tailscale Funnel. Server-only: LEADERBOARD_API_SECRET must never get
// a NEXT_PUBLIC_ name or reach the client bundle.

export const SERVICE_TIMEOUT_MS = 4_000;

export interface ServiceConfig {
  baseUrl: string;
  secret: string;
}

/** Null when either env var is missing or unusable -- callers answer 503, never call unsigned. */
export function serviceConfig(env: Record<string, string | undefined> = process.env): ServiceConfig | null {
  const secret = usableSecret(env.LEADERBOARD_API_SECRET);
  const url = env.LEADERBOARD_API_URL;
  // https only: the signature stops forgery and replay, but nicknames and
  // ip hashes still should not cross the internet in clear text.
  if (!secret || !url || !/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(url)) return null;
  return { baseUrl: url, secret };
}

export type ServiceResponse = { status: number; body: unknown } | null;

/**
 * One signed request. Returns null (never throws) when the service is
 * unreachable, times out, or answers something that is not JSON -- the
 * caller treats that as "service unavailable".
 */
export async function callService(
  config: ServiceConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = SERVICE_TIMEOUT_MS,
): Promise<ServiceResponse> {
  const text = body === undefined ? '' : JSON.stringify(body);
  const headers = {
    'content-type': 'application/json',
    ...signedHeaders(config.secret, method, path, text, Date.now(), randomBytes(16).toString('hex')),
  };
  try {
    const res = await fetch(config.baseUrl + path, {
      method,
      headers,
      body: method === 'POST' ? text : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
      redirect: 'error',
    });
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  } catch (err) {
    console.error('[leaderboard] service call failed', method, path.split('?')[0], err instanceof Error ? err.message : err);
    return null;
  }
}
