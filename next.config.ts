import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The ported game engine (public/forest-engine.js, see components/GameCanvas.tsx)
  // registers 16 listeners and starts an rAF loop with no teardown -- it wasn't built
  // to survive a mount/unmount/remount cycle. StrictMode's double-invoked effects in
  // dev would double every listener, WebGL context, and AudioContext. Giving the
  // engine a real dispose() lifecycle is M2 (LUL-9) scope, not this port.
  reactStrictMode: false,
};

export default nextConfig;
