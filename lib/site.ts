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

// SITE_NAME is the site's display name used in page titles and metadata
export const SITE_NAME = 'Lullwood';

// SEO title. "Lullwood" alone is an invented word with no search volume --
// nobody types it who doesn't already know the game. The suffix carries the
// terms people actually search ("browser horror game", "free", "no download")
// while the brand still leads, which is what Google shows in the result.
// Kept under ~60 chars so it isn't truncated in SERPs.
export const SITE_TITLE = 'Lullwood — Free Browser Horror Game, No Download';

// The search-result snippet. The old value ("a lost child is somewhere in the
// dark") is a great in-game line and a poor meta description: 36 chars, no
// nouns anyone searches for. This keeps the tone but earns the click and lands
// in the ~150-160 char window Google renders without truncating.
export const SITE_DESCRIPTION =
  'A glowing child is lost in the fog. Cross a night forest, hide from wolves, bears and lions that hunt by sight and scent, and carry her home. Free in browser.';

// Short, atmospheric line for social cards, where mood beats keywords -- a
// shared link is seen by people, not crawlers.
export const SITE_TAGLINE = 'A lost child is somewhere in the dark.';

// Google Search Console's HTML-tag verification token. Unset in every
// environment until the founder pastes it into Vercel (see LUL-370) --
// `|| undefined` collapses both "not set" and "set to an empty string" to
// the same undefined, so app/layout.tsx never emits a hollow
// `content=""` meta tag (GSC reads that as a failed verification, worse
// than no tag at all).
export const GOOGLE_SITE_VERIFICATION =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined;
