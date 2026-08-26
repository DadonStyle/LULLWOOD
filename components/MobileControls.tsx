'use client';

// LUL-68: twin-stick touch controls for mobile.
// LUL-276: renamed from TouchControls.tsx and split from desktop input.
// Mounting is decided once, by Hud.tsx, via lib/input-mode.ts's isMobile() --
// this component no longer detects touch itself, and DesktopControls mounts
// in its place on desktop. Exactly one of the two ever mounts.
//
// Layout:
//   Left  stick  (bottom-left)  → movement   (setTouchMove)
//   Right stick  (bottom-right) → camera look (setTouchLook)
//   Hide button  (bottom-right area, above stick)
//   Interact (E) button (bottom-left area, above stick)
//
// Both sticks are always-visible fixed-position circles, not thumb-anchored on
// first touch. This guarantees their touch regions never overlap.

import { useRef } from 'react';
import type { EngineActions } from './Hud';

// Dead-zone: stick must move beyond this fraction before input is emitted.
const DEAD = 0.2;
// Max stick travel in px (visual + input clamped to this).
const RADIUS = 48;

interface StickState {
  active: boolean;
  ox: number;  // offset from centre, clamped to [-RADIUS, RADIUS]
  oy: number;
}

interface StickProps {
  onMove: (nx: number, ny: number) => void;  // normalised [-1..1], 0,0 on release
  onSprint?: (v: boolean) => void;           // left stick only
  testId: string;
}

function Stick({ onMove, onSprint, testId }: StickProps) {
  const stateRef = useRef<StickState>({ active: false, ox: 0, oy: 0 });
  const thumbRef = useRef<HTMLDivElement>(null);
  const ptIdRef  = useRef<number | null>(null);

  function update(ox: number, oy: number) {
    const clamped = Math.hypot(ox, oy);
    if (clamped > RADIUS) { ox = ox / clamped * RADIUS; oy = oy / clamped * RADIUS; }
    stateRef.current.ox = ox;
    stateRef.current.oy = oy;
    if (thumbRef.current) {
      thumbRef.current.style.transform = `translate(${ox}px, ${oy}px)`;
    }
    const nx = ox / RADIUS;
    const ny = oy / RADIUS;
    const mag = Math.hypot(nx, ny);
    if (mag < DEAD) {
      onMove(0, 0);
      onSprint?.(false);
    } else {
      onMove(nx, ny);
      onSprint?.(mag > 0.75);
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (ptIdRef.current !== null) return;  // only one pointer per stick
    ptIdRef.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    stateRef.current.active = true;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    update(e.clientX - cx, e.clientY - cy);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (e.pointerId !== ptIdRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    update(e.clientX - cx, e.clientY - cy);
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (e.pointerId !== ptIdRef.current) return;
    ptIdRef.current = null;
    stateRef.current.active = false;
    update(0, 0);
  }

  const base: React.CSSProperties = {
    position: 'relative',
    width:  RADIUS * 2 + 32,
    height: RADIUS * 2 + 32,
    borderRadius: '50%',
    background: 'rgba(180,200,230,0.12)',
    border: '1.5px solid rgba(180,200,230,0.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    flexShrink: 0,
  };

  const thumb: React.CSSProperties = {
    width:  RADIUS,
    height: RADIUS,
    borderRadius: '50%',
    background: 'rgba(180,200,230,0.35)',
    border: '1.5px solid rgba(180,200,230,0.5)',
    pointerEvents: 'none',
    transition: 'transform 0.05s',
  };

  return (
    <div
      style={base}
      data-testid={testId}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div ref={thumbRef} style={thumb} />
    </div>
  );
}

interface ActionBtnProps {
  label: string;
  onTap: () => void;
  testId?: string;
  small?: boolean;
}

function ActionBtn({ label, onTap, testId, small }: ActionBtnProps) {
  const size = small ? 44 : 56;
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    background: 'rgba(180,200,230,0.14)',
    border: '1.5px solid rgba(180,200,230,0.28)',
    color: 'rgba(185,200,221,0.9)',
    fontSize: small ? 10 : 11,
    fontFamily: 'inherit',
    letterSpacing: '0.05em',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // LUL-653: was 'manipulation'. That still leaves the browser to decide,
    // on first contact, whether this gesture might be a pan (it permits
    // panning) -- Stick right next to this button already uses 'none' for
    // the same reason. A discrete tap target has no gesture to disambiguate,
    // so committing to 'none' up front removes that decision from the path
    // between pointerdown and this handler running.
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    cursor: 'pointer',
    flexShrink: 0,
  };

  return (
    <div
      style={style}
      data-testid={testId}
      onPointerDown={(e) => { e.preventDefault(); onTap(); }}
    >
      {label}
    </div>
  );
}

// LUL-529: mist veil (F on desktop) is a *hold*, not a tap -- the engine reads
// it every frame (touchVeil in forest-engine.js), same as keys['KeyF']. A
// plain ActionBtn's onTap fires once and lets go; this tracks pointer
// down/up/cancel so a gesture the browser cancels mid-hold (e.g. an OS
// swipe-back edge gesture) still releases the veil instead of stranding it on.
function HoldBtn({ label, onHold, testId }: { label: string; onHold: (v: boolean) => void; testId?: string }) {
  const style: React.CSSProperties = {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: 'rgba(180,200,230,0.14)',
    border: '1.5px solid rgba(180,200,230,0.28)',
    color: 'rgba(185,200,221,0.9)',
    fontSize: 11,
    fontFamily: 'inherit',
    letterSpacing: '0.05em',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    cursor: 'pointer',
    flexShrink: 0,
  };

  return (
    <div
      style={style}
      data-testid={testId}
      onPointerDown={(e) => {
        e.preventDefault();
        onHold(true);
        // Pointer capture is best-effort robustness (keeps the hold alive if
        // the finger drifts off the element) -- it must never gate onHold
        // itself. setPointerCapture throws NotFoundError for any pointerId
        // the browser doesn't recognise as currently active, which a
        // synthetically dispatched PointerEvent (e2e/mobile/veil.spec.ts)
        // always is; without the try/catch that throw aborted this handler
        // before onHold(true) ran, so the veil never actually engaged.
        try {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // no active pointer to capture -- onHold(true) above already fired.
        }
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
    >
      {label}
    </div>
  );
}

export default function MobileControls({
  actions,
  entered,
  runMode,
}: {
  actions: EngineActions | null;
  entered: boolean;
  runMode: 'hold' | 'toggle';
}) {
  if (!actions) return null;

  // LUL-529: `env(safe-area-inset-*)` only resolves once app/layout.tsx's
  // viewport export carries `viewportFit: 'cover'` -- without it every one of
  // these falls back to 0 and this is a no-op, not a bug in this file. On an
  // unnotched device the env() terms are just 0 and this collapses to the
  // original hardcoded 24px/20px.
  const wrapper: React.CSSProperties = {
    position: 'fixed',
    bottom: 'calc(24px + env(safe-area-inset-bottom))',
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    padding: '0 calc(20px + env(safe-area-inset-right)) 0 calc(20px + env(safe-area-inset-left))',
    zIndex: 30,
    pointerEvents: 'none',
  };

  const side: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    pointerEvents: 'auto',
  };

  const row: React.CSSProperties = {
    display: 'flex',
    gap: 10,
  };

  // LUL-529: pause is the only route into the settings panel on a phone (no
  // Escape key), so it lives top-left, well clear of the minimap (top-right,
  // components/GameCanvas.tsx OVERLAY_STYLE #minimap) and the bottom action
  // clusters -- it must stay reachable and visible even while every other
  // mobile control is mid-gesture.
  const pauseWrapper: React.CSSProperties = {
    position: 'fixed',
    top: 'calc(16px + env(safe-area-inset-top))',
    left: 'calc(16px + env(safe-area-inset-left))',
    zIndex: 31,
    pointerEvents: 'auto',
  };

  return (
    <>
      {entered && (
        <div style={pauseWrapper} data-testid="mobilePauseWrapper">
          <ActionBtn label="Pause" small testId="touchPause" onTap={() => actions.triggerTouchPause()} />
        </div>
      )}

      <div style={wrapper} data-testid="mobileControls">
        {/* Left side: interact + jump (+ run toggle) above the movement stick */}
        <div style={side}>
          {entered && (
            <div style={row}>
              <ActionBtn label="E" onTap={() => actions.triggerTouchInteract()} />
              {/* LUL-213/LUL-529: jump is the only way to clear a charging
                  wolf/lion -- survival-critical, not cosmetic, so it sits in
                  the same reachable row as pickup rather than being buried. */}
              <ActionBtn label="Jump" testId="touchJump" onTap={() => actions.triggerTouchJump()} />
              {/* LUL-529: only rendered when the accessibility setting
                  runMode === 'toggle' is on (SettingsPanel.tsx) -- hold-mode
                  players already get sprint for free from stick magnitude
                  above the 0.75 threshold and don't need this button. */}
              {runMode === 'toggle' && (
                <ActionBtn
                  label="Run"
                  small
                  testId="touchToggleRun"
                  onTap={() => actions.triggerTouchToggleRun()}
                />
              )}
            </div>
          )}
          <Stick
            // LUL-274 FACT 3: the stick reports screen-down-positive ny, but
            // the engine's iz axis is forward-positive (KeyW -> iz += 1). Flip
            // the sign here, at the source, so nothing downstream has to know
            // the stick and the engine disagree on which way is "up".
            onMove={(nx, ny) => actions.setTouchMove(nx, -ny)}
            onSprint={(v) => actions.setTouchSprint(v)}
            testId="leftStick"
          />
        </div>

        {/* Right side: hide + veil above the look stick */}
        <div style={side}>
          {entered && (
            <div style={row}>
              <ActionBtn label="Hide" onTap={() => actions.triggerTouchHide()} />
              <HoldBtn label="Veil" testId="touchVeil" onHold={(v) => actions.setTouchVeil(v)} />
            </div>
          )}
          <Stick
            onMove={(nx, ny) => actions.setTouchLook(nx, ny)}
            testId="rightStick"
          />
        </div>
      </div>
    </>
  );
}
