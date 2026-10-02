import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// LUL-3264 (SQLite variant): request signing between the Vercel route handlers
// and the leaderboard service on the founder's server. The service is reachable
// from the public internet (Tailscale Funnel -- Vercel's functions cannot reach
// a tailnet), so every request except GET /healthz must carry a valid signature
// made with LEADERBOARD_API_SECRET, which only Vercel and the server hold.
//
// Signed string: `${ts}\n${nonce}\n${METHOD}\n${pathWithQuery}\n${sha256(body)}`.
// - ts bounds replay to SIGNATURE_MAX_SKEW_MS; the nonce closes the window
//   inside it (the service remembers nonces it has accepted until they expire).
// - method + path + body hash stop a captured signature being re-pointed at a
//   different route or a different payload.

export const SIGNATURE_HEADER = 'x-lb-signature';
export const TIMESTAMP_HEADER = 'x-lb-timestamp';
export const NONCE_HEADER = 'x-lb-nonce';
export const SIGNATURE_MAX_SKEW_MS = 60_000;
export const MIN_SECRET_LENGTH = 32;

const NONCE_PATTERN = /^[0-9a-f]{32}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

function canonical(ts: string, nonce: string, method: string, path: string, body: string): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return `${ts}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
}

/** Returns null (never a weak value) when the secret is unset or too short -- callers fail closed. */
export function usableSecret(secret: string | undefined): string | null {
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function sign(secret: string, ts: number, nonce: string, method: string, path: string, body: string): string {
  return createHmac('sha256', secret).update(canonical(String(ts), nonce, method, path, body)).digest('hex');
}

export function signedHeaders(secret: string, method: string, path: string, body: string, now: number, nonce: string): Record<string, string> {
  return {
    [TIMESTAMP_HEADER]: String(now),
    [NONCE_HEADER]: nonce,
    [SIGNATURE_HEADER]: sign(secret, now, nonce, method, path, body),
  };
}

export type VerifyResult = { ok: true; nonce: string; ts: number } | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'bad-signature' };

/**
 * Checks shape, clock skew and the HMAC. Does NOT check nonce reuse -- that
 * needs state, so the caller does it after a successful verify.
 */
export function verify(
  secret: string,
  headers: { ts: string | null | undefined; nonce: string | null | undefined; signature: string | null | undefined },
  method: string,
  path: string,
  body: string,
  now: number,
): VerifyResult {
  const { ts, nonce, signature } = headers;
  if (!ts || !nonce || !signature) return { ok: false, reason: 'missing' };
  if (!/^\d{13}$/.test(ts) || !NONCE_PATTERN.test(nonce) || !SIGNATURE_PATTERN.test(signature)) {
    return { ok: false, reason: 'malformed' };
  }
  const tsNum = Number(ts);
  if (Math.abs(now - tsNum) > SIGNATURE_MAX_SKEW_MS) return { ok: false, reason: 'stale' };
  const expected = Buffer.from(sign(secret, tsNum, nonce, method, path, body), 'hex');
  const given = Buffer.from(signature, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad-signature' };
  return { ok: true, nonce, ts: tsNum };
}
