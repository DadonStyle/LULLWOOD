'use client';

// LUL-68: twin-stick touch controls for mobile.
//
// Renders only on touch-capable / no-pointer-lock viewports; desktop keyboard +
// mouse-look are unaffected and neither stick appears there.
//
// Layout:
//   Left  stick  (bottom-left)  → movement   (setTouchMove)
//   Right stick  (bottom-right) → camera look (setTouchLook)
//   Hide button  (bottom-right area, above stick)
//   Interact (E) button (bottom-left area, above stick)
//
// Both sticks are always-visible fixed-position circles, not thumb-anchored on
// first touch. This guarantees their touch regions never overlap.

import { useRef, useState } from 'react';
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

// Lazy initializer: safe here because GameCanvas is ssr:false so this
// component never runs on the server.
function useTouchDevice() {
  return useState(() => {
    if (typeof window === 'undefined') return false;
    // Pointer-lock unavailability is the canonical signal.
    // Width ≤ 768 catches touch tablets that do expose the API.
    return (
      !document.documentElement.requestPointerLock ||
      window.matchMedia('(max-width: 768px)').matches ||
      navigator.maxTouchPoints > 0
    );
  })[0];
}

interface StickProps {
  onMove: (nx: number, ny: number) => void;  // normalised [-1..1], 0,0 on release
  onSprint?: (v: boolean) => void;           // left stick only
}

function Stick({ onMove, onSprint }: StickProps) {
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
}

function ActionBtn({ label, onTap }: ActionBtnProps) {
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
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    cursor: 'pointer',
    flexShrink: 0,
  };

  return (
    <div
      style={style}
      onPointerDown={(e) => { e.preventDefault(); onTap(); }}
    >
      {label}
    </div>
  );
}

export default function TouchControls({
  actions,
  entered,
}: {
  actions: EngineActions | null;
  entered: boolean;
}) {
  const isTouch = useTouchDevice();

  if (!isTouch || !actions) return null;

  const wrapper: React.CSSProperties = {
    position: 'fixed',
    bottom: 24,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    padding: '0 20px',
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

  return (
    <div style={wrapper}>
      {/* Left side: interact button above left stick */}
      <div style={side}>
        {entered && (
          <ActionBtn label="E" onTap={() => actions.triggerTouchInteract()} />
        )}
        <Stick
          onMove={(nx, ny) => actions.setTouchMove(nx, ny)}
          onSprint={(v) => actions.setTouchSprint(v)}
        />
      </div>

      {/* Right side: hide button above right stick */}
      <div style={side}>
        {entered && (
          <ActionBtn label="Hide" onTap={() => actions.triggerTouchHide()} />
        )}
        <Stick
          onMove={(nx, ny) => actions.setTouchLook(nx, ny)}
        />
      </div>
    </div>
  );
}
