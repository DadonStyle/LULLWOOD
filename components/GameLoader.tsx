"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// `ssr: false` is only allowed inside a Client Component, so this thin wrapper
// exists purely to host the dynamic() call for app/page.tsx (a Server Component).
const GameCanvas = dynamic(() => import("./GameCanvas"), { ssr: false });

declare global {
  interface Window {
    __qaRemount?: () => void;
  }
}

export default function GameLoader() {
  const [instance, setInstance] = useState(0);

  // QA-only remount hook (LUL-21): React StrictMode's dev-time double-invoke
  // fires and settles *before* GameCanvas's async engine-script load resolves,
  // so it never exercises a real ForestEngine.dispose() against a live engine
  // -- see e2e/lifecycle.spec.ts. This gives the suite a way to force a
  // genuine unmount -> remount of a *live* instance. Opt-in via `?qaHooks=1`
  // so it does nothing for real players.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("qaHooks")) return;
    window.__qaRemount = () => setInstance((n) => n + 1);
    return () => {
      delete window.__qaRemount;
    };
  }, []);

  return <GameCanvas key={instance} />;
}
