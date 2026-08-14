import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // public/forest-engine.js now exposes init()/dispose() (LUL-17): every listener
  // is tracked and removed, the rAF loop is cancelled, and Three/Audio resources
  // are released. GameCanvas.tsx calls dispose() on unmount, so StrictMode's
  // double-invoked dev effects leave exactly one running instance.
  reactStrictMode: true,
};

export default nextConfig;
