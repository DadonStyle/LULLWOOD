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

export const SERVICE_ATTEMPTS = 3;

// Connection-level failures: the request never reached the service, so retrying cannot duplicate a write.
const CONNECT_ERRORS = /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|other side closed/;

function isConnectFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
  return CONNECT_ERRORS.test(`${err.message} ${cause?.code ?? ''} ${cause?.message ?? ''}`);
}

/**
 * One signed request. Returns null (never throws) when the service is
 * unreachable, times out, or answers something that is not JSON -- the
 * caller treats that as "service unavailable".
 *
 * Retries (2026-10-06): Tailscale Funnel publishes the service behind three
 * relay IPs, and one of them stopped answering (176.58.90.145) -- about a third
 * of production calls failed. A connection-level failure is retried on a new,
 * freshly signed connection (new nonce), which usually lands on a healthy
 * relay, all inside the one `timeoutMs` budget. The bad relay does not refuse
 * connections, it hangs, so each attempt gets an equal slice of the budget and
 * a timeout is retried too. That is safe for a POST: if a timed-out submission
 * did land, the retry is refused by the service's own 10 s per-IP cooldown
 * inside its write transaction, so no duplicate row can be stored (worst case
 * the player sees "please wait" for a run that was saved).
 */
export async function callService(
  config: ServiceConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = SERVICE_TIMEOUT_MS,
  attempts = SERVICE_ATTEMPTS,
): Promise<ServiceResponse> {
  const text = body === undefined ? '' : JSON.stringify(body);
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; ; attempt++) {
    const slice = Math.max(Math.min(deadline - Date.now(), Math.ceil(timeoutMs / attempts)), 1);
    const headers = {
      'content-type': 'application/json',
      ...signedHeaders(config.secret, method, path, text, Date.now(), randomBytes(16).toString('hex')),
    };
    try {
      const res = await fetch(config.baseUrl + path, {
        method,
        headers,
        body: method === 'POST' ? text : undefined,
        signal: AbortSignal.timeout(slice),
        cache: 'no-store',
        redirect: 'error',
      });
      const raw = await res.text();
      return { status: res.status, body: raw ? JSON.parse(raw) : null };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      if ((timedOut || isConnectFailure(err)) && attempt < attempts && deadline - Date.now() > 250) continue;
      console.error('[leaderboard] service call failed', method, path.split('?')[0], `attempt ${attempt}`, err instanceof Error ? err.message : err);
      return null;
    }
  }
}
