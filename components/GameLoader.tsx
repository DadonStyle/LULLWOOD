"use client";

import dynamic from "next/dynamic";

// `ssr: false` is only allowed inside a Client Component, so this thin wrapper
// exists purely to host the dynamic() call for app/page.tsx (a Server Component).
const GameCanvas = dynamic(() => import("./GameCanvas"), { ssr: false });

export default function GameLoader() {
  return <GameCanvas />;
}
