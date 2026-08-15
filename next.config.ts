import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // engine/forest-engine.js exposes init()/dispose() (LUL-17): every listener
  // is tracked and removed, the rAF loop is cancelled, and Three/Audio resources
  // are released. GameCanvas.tsx calls dispose() on unmount, so StrictMode's
  // double-invoked dev effects leave exactly one running instance.
  reactStrictMode: true,

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
};

export default nextConfig;
