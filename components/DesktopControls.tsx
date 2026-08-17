'use client';

// LUL-276: desktop counterpart to MobileControls. Desktop mouse-look and
// keyboard movement are handled entirely inside the engine (pointer-lock +
// mousemove/mousedown listeners, bound only when inputMode === 'desktop' --
// see engine/forest-engine.js), so there is no on-screen affordance to
// render here today. This component exists so Hud.tsx picks between exactly
// one of DesktopControls/MobileControls via lib/input-mode.ts's isMobile(),
// instead of MobileControls silently deciding to no-op on desktop.
export default function DesktopControls() {
  return null;
}
