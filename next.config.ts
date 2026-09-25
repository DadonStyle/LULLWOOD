import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // engine/forest-engine.js exposes init()/dispose() (LUL-17): every listener
  // is tracked and removed, the rAF loop is cancelled, and Three/Audio resources
  // are released. GameCanvas.tsx calls dispose() on unmount, so StrictMode's
  // double-invoked dev effects leave exactly one running instance.
  reactStrictMode: true,

  // LUL-5089: `lib/analytics.ts`'s `track()` reads `process.env.NEXT_PUBLIC_BUILD_SHA`
  // and falls back to `'dev'` when unset -- and it has been unset in every production
  // build to date (no env var of that name was ever set in Vercel or here), so every
  // telemetry event ever emitted has `build_sha: 'dev'`, permanently excluded by
  // scripts/win-rate-by-tier.mjs's `isAtOrAfter` (docs/TELEMETRY_SCHEMA.md's own
  // "unknown shas are excluded rather than assumed eligible" policy). `VERCEL_GIT_COMMIT_SHA`
  // is a Vercel System Environment Variable, always populated at build time (no
  // dashboard toggle needed -- that toggle only gates *runtime* function access to
  // System Environment Variables, per Vercel's docs); this inlines it under a
  // `NEXT_PUBLIC_` name so the client bundle can read it, same mechanism Vercel's own
  // docs recommend for exposing the commit sha to the browser.
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  },

  // Next 16 refuses to serve /_next/* to a dev request whose Host it does not
  // recognise, and answers 403 -- so hitting the dev server on 127.0.0.1 rather
  // than "localhost" 403s every chunk, no JS evaluates, and the engine never
  // boots, which reads as a hung game rather than as a blocked request.
  // Dev-only; `next start` and production are unaffected.
  //
  // LUL-28 added this because the Playwright suite drove a dev server; LUL-35
  // (pass 2) moved the whole suite onto the production build, so it now serves
  // only humans running `npm run dev` against 127.0.0.1. Kept for them.
  allowedDevOrigins: ["127.0.0.1"],

  // LUL-2852: lullwood.vercel.app is a legacy alias on the same Vercel
  // project/deployment as www.lullwoodgame.com -- both served identical,
  // fully-indexable content (200, robots "index, follow"), splitting link
  // equity and search-ranking signal across two URLs for the same page.
  // Next.js's `has: [{ type: 'host' }]` redirect is compiled into
  // routes-manifest.json and applied by Vercel's edge routing layer before
  // any page renders, so every path on the vercel.app host 308s (permanent:
  // true) to the canonical domain with the path preserved. No DNS, domain,
  // or Vercel project-settings change -- both hostnames stay attached to
  // this same project exactly as already provisioned.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "lullwood.vercel.app" }],
        destination: "https://www.lullwoodgame.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
