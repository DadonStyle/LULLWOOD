// Shared across app/layout.tsx, app/robots.ts and app/sitemap.ts so the
// production-URL derivation lives in exactly one place.
//
// VERCEL_PROJECT_PRODUCTION_URL is a bare hostname (no scheme), set on every
// Vercel deployment (including previews) to the project's *production*
// domain. Falling back to the hardcoded literal keeps this correct in any
// environment where that var isn't set (local dev, CI).
export const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'https://lullwood.vercel.app';

export const SITE_NAME = 'Lullwood';
export const SITE_DESCRIPTION = 'a lost child is somewhere in the dark';

// Google Search Console's HTML-tag verification token. Unset in every
// environment until the founder pastes it into Vercel (see LUL-370) --
// `|| undefined` collapses both "not set" and "set to an empty string" to
// the same undefined, so app/layout.tsx never emits a hollow
// `content=""` meta tag (GSC reads that as a failed verification, worse
// than no tag at all).
export const GOOGLE_SITE_VERIFICATION =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined;
