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
