'use client';

import { useEffect, useRef, useState } from 'react';

// LUL-2612: marketing splash shown once, before a first-time visitor ever
// sees the entry gate. `lullwood:welcomeSeen` follows the same
// localStorage-boolean pattern as every other one-shot player record in this
// codebase (`lullwood:hasDied`, `lullwood:hints:<key>`) -- see
// components/Hud.tsx's EMBERS_KEY/MISSION_UNLOCKS_KEY reads for the
// precedent. e2e/helpers.ts's `boot()` seeds this key by default so the rest
// of the suite keeps booting straight to `#gate`; only
// e2e/welcome-splash.spec.ts opts out to exercise the real first-visit path.
const WELCOME_SEEN_KEY = 'lullwood:welcomeSeen';

function hasSeenWelcome(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_SEEN_KEY) === '1';
  } catch {
    // Storage unavailable (private mode / disabled) -- don't block a real
    // player behind a splash that can never be dismissed-and-remembered.
    return true;
  }
}

// GameCanvas only ever mounts client-side (GameLoader's `dynamic(..., { ssr:
// false })`), so reading localStorage in the `useState` initializer is safe
// here -- there is no server render to mismatch against.
export default function WelcomeSplash() {
  const [visible, setVisible] = useState(() => !hasSeenWelcome());
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (visible) dismissRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(WELCOME_SEEN_KEY, '1');
    } catch {
      // Nothing to persist to -- the splash still closes for this visit.
    }
    setVisible(false);
  }

  return (
    <div id="welcomeSplash" role="dialog" aria-modal="true" aria-labelledby="welcomeSplashTitle">
      <h1 id="welcomeSplashTitle">Welcome to Lullwood</h1>
      <p>
        Lullwood is a free browser-based first-person horror game. You cross a
        foggy night forest to find a lost, glowing child while wolves, bears
        and lions hunt you by sight and scent. There is no weapon — the only
        tool you have is stillness: duck into cover, hold still, and let a
        predator lose your trail.
      </p>
      <p className="welcomeSplashStudio">
        <strong>Built by Independence AI Studio!</strong>
      </p>
      <p>
        Independence AI Studio is a one-game studio run almost entirely by a
        coordinated fleet of AI agents: design, engineering, testing and
        difficulty balancing are all done by language-model agents working
        from a shared task board and codebase, with one human founder setting
        direction and approving every release.
      </p>
      <p>
        The game itself is a Next.js and Three.js web app, built and shipped
        straight from the browser with no download or install. The goal is a
        genuinely tense, free horror game — and a public proof of how much of
        a real game an AI-run studio can build and ship on its own.
      </p>
      <button type="button" id="welcomeSplashDismiss" ref={dismissRef} onClick={dismiss}>
        Enter the forest
      </button>
    </div>
  );
}
