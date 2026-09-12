// LUL-2310: fullscreen is toggled from two independent call sites --
// GameMenu.tsx's menu button and engine/forest-engine.js's F11/Alt+Enter
// keydown handler. Sharing this module (rather than two copies of the same
// three-line toggle) is what keeps them from drifting the way EngineActions
// and init()'s return object drifted in LUL-1697: one file to fix, one place
// both callers read from.
//
// Safari < 16.4 (and any other engine that never adopted the unprefixed
// Fullscreen API) only exposes the `webkit`-prefixed names, so every
// function here checks both.

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

export function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FullscreenDocument;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreenActive(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FullscreenDocument;
  return (d.fullscreenElement ?? d.webkitFullscreenElement ?? null) != null;
}

/** Both event names some browser in the collision matrix needs -- pass the
 * same callback to both; only one will ever actually fire on a given engine. */
export const FULLSCREEN_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

export function toggleFullscreen(): void {
  if (typeof document === 'undefined') return;
  const d = document as FullscreenDocument;
  if (isFullscreenActive()) {
    const exit = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.();
    exit?.catch(() => {});
  } else {
    const el = document.documentElement as FullscreenElement;
    const request = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
    request?.catch(() => {});
  }
}
