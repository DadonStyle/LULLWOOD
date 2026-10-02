import { createHash } from 'node:crypto';

// Who sent a request, as far as a Vercel route handler can tell without
// storing anything personal. Extracted from app/api/suggestions/route.ts
// (LUL-3288 A1/A2 fixes) so the leaderboard routes reuse the fixed version
// instead of a copy -- the threat model's "do not copy the pre-fix guards".

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(salt + ip).digest('hex');
}

/** Returns null (never `''`) if the salt is unset or empty -- callers must fail closed (A2). */
export function usableSalt(salt: string | undefined): string | null {
  return salt && salt.length > 0 ? salt : null;
}

export function getClientIp(req: Request): string {
  // Vercel's edge sets/overwrites this header with the real client IP on
  // every request that reaches the deployment -- a client-supplied copy is
  // replaced before the function sees it, unlike `x-forwarded-for` where
  // the client fully controls the first hop (A1).
  const vercelIp = req.headers.get('x-vercel-forwarded-for');
  if (vercelIp) return vercelIp.split(',')[0].trim();

  // Fallback for environments without that header: the LAST hop of
  // `x-forwarded-for` is the one appended by the proxy closest to the
  // server, not the client-controlled first hop the client can spoof and
  // rotate at will.
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const hops = fwd
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  return req.headers.get('x-real-ip') ?? 'unknown';
}

export interface DeviceInfo {
  deviceClass: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  browser: 'chrome' | 'safari' | 'firefox' | 'edge' | 'samsung' | 'other' | 'unknown';
}

/**
 * Coarse device class + browser family from the User-Agent, for stats only.
 * Deliberately coarse: no versions, no OS build, nothing that narrows a
 * player down beyond "phone on Safari".
 */
export function deviceFromUserAgent(ua: string | null): DeviceInfo {
  if (!ua) return { deviceClass: 'unknown', browser: 'unknown' };
  const deviceClass = /iPad|Tablet|(Android(?!.*Mobile))/i.test(ua)
    ? 'tablet'
    : /Mobi|iPhone|iPod|Android/i.test(ua)
      ? 'mobile'
      : 'desktop';
  const browser = /SamsungBrowser/i.test(ua)
    ? 'samsung'
    : /Edg\//i.test(ua)
      ? 'edge'
      : /Firefox|FxiOS/i.test(ua)
        ? 'firefox'
        : /Chrome|CriOS|Chromium/i.test(ua)
          ? 'chrome'
          : /Safari/i.test(ua)
            ? 'safari'
            : 'other';
  return { deviceClass, browser };
}

/** Vercel's platform-set geo header (ISO alpha-2), or null. Not client-controllable on Vercel. */
export function countryFromHeaders(req: Request): string | null {
  const c = req.headers.get('x-vercel-ip-country');
  return c && /^[A-Z]{2}$/.test(c) ? c : null;
}
