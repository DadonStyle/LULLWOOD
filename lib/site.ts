// Shared across app/layout.tsx, app/robots.ts and app/sitemap.ts so the
// production-URL derivation lives in exactly one place.
//
// VERCEL_PROJECT_PRODUCTION_URL is a bare hostname (no scheme), set on every
// Vercel deployment (including previews) to the project's *production*
// domain. Falling back to the hardcoded literal keeps this correct in any
// environment where that var isn't set (local dev, CI). The literal is the
// real domain: lullwood.vercel.app only 308s there (next.config.ts).
export const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'https://www.lullwoodgame.com';

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
// LUL-2281 (2026-09-09) made lifting the child the win -- there is no carry-home
// leg any more, so the snippet must not promise one (founder SEO pass 2026-09-11).
export const SITE_DESCRIPTION =
  'A glowing child is lost in the fog. Cross a night forest, hide from wolves, bears and lions that hunt by sight and scent, and reach her first. Free in browser.';

// Brand colour for the manifest / theme-color -- the HUD's night ground
// (components/GameCanvas.tsx's #panel/#settingsPanel chrome uses
// rgba(12,17,26,…); LUL-5772 moved the action-prompt pills off this value
// onto the green hint palette, so it's no longer "every pill").
export const SITE_THEME_COLOR = '#0c111a';

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

// The public game repo -- the one official profile besides this site
// (app/layout.tsx's Organization `sameAs`).
export const GITHUB_URL = 'https://github.com/DadonStyle/LULLWOOD';

// The official Lullwood Bluesky account. The handle stays `petgem` (an old
// account the founder already owned); the display name and bio are the brand,
// set 2026-10-27 (LUL-6101). Listed in app/layout.tsx's Organization `sameAs`
// and lib/game-jsonld.ts's VideoGame `sameAs` so search and answer engines
// resolve the profile and this site to one entity rather than two.
export const BLUESKY_URL = 'https://bsky.app/profile/petgem.bsky.social';

// The official Lullwood dev.to account, created 2026-10-28. It publishes
// canonical cross-posts of our devlog (canonical_url always points back at
// www.lullwoodgame.com), so search engines should resolve it and this site to
// one entity. Listed in app/layout.tsx's Organization `sameAs` and
// lib/game-jsonld.ts's VideoGame `sameAs` (LUL-6124).
export const DEVTO_URL = 'https://dev.to/lullwoodgamer';

// In-engine screenshots in public/screenshots/, shown in app/page.tsx's
// gallery and listed in the VideoGame JSON-LD.
export const SCREENSHOTS = [
  'lullwood-night-forest-pine-trees.png',
  'lullwood-dense-pine-forest-snow.png',
  'lullwood-forest-rock-outcrop-night.png',
];
