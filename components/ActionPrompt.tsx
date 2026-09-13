'use client';

// LUL-2312: one component for every bottom-centre action pill (E/H/F/SPACE and
// the hidden/hunted status line), replacing #objective/#actionPrompt/
// #throwPrompt/#chargePrompt/#status (components/GameCanvas.tsx,
// components/Hud.tsx) -- five independently-positioned pills with their own
// magic-number offsets, which is the exact class of bug LUL-1779 kept
// catching. Callers (Hud.tsx) own copy and mobile/desktop branching; this
// component only knows how to render one row of the "Press  E  to lift the
// child" look at whatever tone the row currently needs. CSS tokens live in
// GameCanvas.tsx's OVERLAY_STYLE (`--action-pill-*` custom properties) so
// there is exactly one place that defines what the pill looks like.
//
// `visible` never unmounts the row -- callers render a fixed five rows inside
// #actionSlot (Hud.tsx) so the CSS grid's row tracks stay put whether or not a
// given row currently has content; only the pill inside fades.

export type ActionPromptTone = 'calm' | 'ready' | 'urgent' | 'status';

export interface ActionPromptProgress {
  // Remounts the drain-bar animation on a fresh countdown (mirrors the old
  // #chargePrompt's `key={chargeToken}` -- see engine/forest-engine.js's
  // beginChargeHud comment for why a *fresh* charge needs a token bump and an
  // overlapping one doesn't).
  token: number;
  durationSeconds: number;
}

export interface ActionPromptProps {
  visible: boolean;
  // Text before/after the keycap chip -- callers compose full sentences like
  // "Press  {keycap}  to hide in the bush" by splitting on the keycap
  // ("Press  ", keycap="H", "  to hide in the bush"). Either half may be
  // omitted (the charge-dodge row has no surrounding text at all).
  text?: string;
  suffix?: string;
  keycap?: string;
  tone?: ActionPromptTone;
  progress?: ActionPromptProgress;
  reducedMotion?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  id?: string;
  testId?: string;
  // LUL-26: only #captionToast needs these -- carried through rather than a
  // generic prop spread so every other call site stays a plain pill with no
  // live-region semantics it doesn't actually have.
  role?: string;
  ariaLive?: 'polite' | 'assertive';
}

// LUL-1780: reduced-motion still needs the red "act now" colour, just not the
// flash -- same inline-style escape hatch the old #actionPrompt.urgent used
// (GameCanvas.tsx's `@media (prefers-reduced-motion: reduce)` rule can't
// reach into a CSS animation's *current frame* to freeze it there, so the
// end colour is restated as a static style instead).
const REDUCED_MOTION_URGENT_KEY_STYLE: React.CSSProperties = {
  animation: 'none',
  background: '#e8554a',
  boxShadow: '0 2px 26px rgba(232,85,74,0.85)',
};

export default function ActionPrompt({
  visible,
  text,
  suffix,
  keycap,
  tone = 'calm',
  progress,
  reducedMotion,
  onPointerDown,
  id,
  testId,
  role,
  ariaLive,
}: ActionPromptProps) {
  return (
    <div
      id={id}
      className="actionPromptRow"
      data-tone={tone}
      data-visible={visible ? '1' : '0'}
      data-testid={testId}
      role={role}
      aria-live={ariaLive}
      style={onPointerDown ? { pointerEvents: 'auto', touchAction: 'none', cursor: 'pointer' } : undefined}
      onPointerDown={onPointerDown}
    >
      {visible && (
        <div className="actionPromptLine">
          {text}
          {keycap && (
            <span
              className="actionPromptKey"
              style={tone === 'urgent' && reducedMotion ? REDUCED_MOTION_URGENT_KEY_STYLE : undefined}
            >
              {keycap}
            </span>
          )}
          {suffix}
        </div>
      )}
      {visible && progress && (
        <div className="actionPromptProgressTrack">
          <div
            className="actionPromptProgressBar"
            key={progress.token}
            style={{ animationDuration: `${progress.durationSeconds}s` }}
          />
        </div>
      )}
    </div>
  );
}
