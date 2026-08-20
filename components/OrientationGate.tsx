'use client';

// LUL-69: a first-person horizontal-FOV game is unplayable in portrait on a
// phone -- steer mobile players into landscape with a full-screen blocking
// prompt rather than a hard Screen Orientation Lock API call (that needs
// fullscreen and has patchy support -- a scope-narrowing call made when
// LUL-51 was split, see wiki game/mobile-support-split). Desktop never sees
// this regardless of window shape: it's gated on lib/input-mode.ts's
// isMobile(), the same single source of truth every other mobile surface
// uses, not a standalone aspect-ratio check.
import { useEffect, useState } from 'react';
import { isMobile } from '@/lib/input-mode';

function matchesPortrait() {
  return typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches;
}

export default function OrientationGate() {
  // Decided once, like every other mobile/desktop branch in this app
  // (Hud.tsx's `mobile`, GameCanvas.tsx's inputMode) -- a device doesn't
  // switch control schemes mid-session, only orientation.
  const mobile = useState(() => isMobile())[0];
  const [portrait, setPortrait] = useState(() => mobile && matchesPortrait());

  useEffect(() => {
    if (!mobile || typeof window === 'undefined') return;
    const mq = window.matchMedia('(orientation: portrait)');
    const update = () => setPortrait(mq.matches);
    // `resize` alongside the MediaQueryList `change` listener: real devices
    // fire orientationchange/resize reliably, but some emulated/embedded
    // contexts (Playwright's setViewportSize among them) only reliably fire
    // resize -- belt and suspenders costs nothing here.
    mq.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [mobile]);

  if (!mobile || !portrait) return null;

  return (
    <div id="orientationGate" data-testid="orientationGate" role="alert">
      <div id="orientationGateIcon" aria-hidden="true">
        ⟳
      </div>
      <p>Rotate your device to play — Lullwood needs landscape.</p>
    </div>
  );
}
