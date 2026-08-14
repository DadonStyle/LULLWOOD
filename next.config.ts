import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // engine/forest-engine.js exposes init()/dispose() (LUL-17): every listener
  // is tracked and removed, the rAF loop is cancelled, and Three/Audio resources
  // are released. GameCanvas.tsx calls dispose() on unmount, so StrictMode's
  // double-invoked dev effects leave exactly one running instance.
  reactStrictMode: true,

  // Next 16 refuses to serve /_next/* to a dev request whose Host it does not
  // recognise, and answers 403. Playwright drives the dev server at 127.0.0.1
  // (playwright.config.ts pins the port), not "localhost", so without this every
  // chunk 403s, no JS evaluates, and the engine simply never boots -- which reads
  // as a hung game rather than as a blocked request. Dev-only; `next start` and
  // production are unaffected.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
