// LUL-155: shared-secret gate for /internal/*. Not auth, not a real login --
// just enough that an anonymous crawler or a link on the public repo can't
// reach the analytics dashboard. Low-sensitivity data (no PII per the M4
// schema), but no reason to leave it open. See wiki `game/m4-analytics-plan` §3.
//
// The secret is INTERNAL_DASHBOARD_SECRET, a Vercel env var only the founder
// can set (no agent on this machine holds Vercel dashboard access -- see
// wiki `systems/vercel-cd`). Fails closed: if it's unset, nobody gets in,
// rather than the route silently being open to anyone.
//
// Uses web-standard Request/Response (no next/server import), the same
// reasoning as app/api/telemetry/route.ts: Next.js Proxy accepts a plain
// Response (or `undefined` to continue) at runtime, and this way the
// handler is directly testable with node --test with no Next.js internals
// to mock.
//
// File convention is `proxy.ts` / export `proxy`, not `middleware.ts` --
// Next.js 16 deprecated and renamed the `middleware` convention (it now
// warns on build and ships a `middleware-to-proxy` codemod). This project
// is on Next 16.3.1, so it ships on the current name from day one.

const COOKIE_NAME = 'lw_dash_key';
const QUERY_PARAM = 'key';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 1 week

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function serializeCookie(name: string, value: string, secure: boolean): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/internal', `Max-Age=${COOKIE_MAX_AGE_SECONDS}`, 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function proxy(req: Request): Response | undefined {
  const secret = process.env.INTERNAL_DASHBOARD_SECRET;
  if (!secret) {
    return new Response('Not found', { status: 404 });
  }

  const url = new URL(req.url);
  const queryKey = url.searchParams.get(QUERY_PARAM);
  if (queryKey === secret) {
    // Strip the secret from the URL before it can land in browser history
    // or a Referer header on a future request; a cookie carries auth from
    // here on.
    const redirectUrl = new URL(url);
    redirectUrl.searchParams.delete(QUERY_PARAM);
    return new Response(null, {
      status: 307,
      headers: {
        Location: redirectUrl.toString(),
        'Set-Cookie': serializeCookie(COOKIE_NAME, secret, process.env.NODE_ENV === 'production'),
      },
    });
  }

  const cookies = parseCookies(req.headers.get('cookie'));
  if (cookies[COOKIE_NAME] === secret) {
    return undefined; // continue to the requested resource
  }

  return new Response('Not found', { status: 404 });
}

export const config = {
  matcher: ['/internal/:path*'],
};
