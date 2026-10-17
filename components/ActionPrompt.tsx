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
// `visible` never unmounts the row -- callers render a fixed set of rows
// inside #actionSlot (Hud.tsx, 10 as of LUL-5166) so the CSS grid's row
// tracks stay put whether or not a given row currently has content; only the
// pill inside fades. GameCanvas.tsx's grid-template-rows/--action-slot-height
// must have exactly as many tracks as Hud.tsx has <ActionPrompt> rows --
// LUL-5166 was a real offscreen-row bug from that count drifting.

// LUL-5004: 'disabled' -- a row that's visible (something to do) but not
// currently actionable (insufficient stamina). Grayed rather than hidden --
// Q5: a refused input needs a positive tell, not just silence.
export type ActionPromptTone = 'calm' | 'ready' | 'urgent' | 'status' | 'disabled';

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
  // Kept for callers; nothing in the row animates any more except the fade-in,
  // which GameCanvas.tsx's prefers-reduced-motion rule already turns off.
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

export default function ActionPrompt({
  visible,
  text,
  suffix,
  keycap,
  tone = 'calm',
  progress,
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
            // Plain bold key in the hint; a static chip only on a row the player taps.
            <span className={onPointerDown ? 'actionPromptKey actionPromptKeyTap' : 'actionPromptKey'}>{keycap}</span>
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
