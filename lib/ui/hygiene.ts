// LUL-UI-HYGIENE: pure rules for "does this screen look and work right".
//
// Why this file exists: every mobile-UI defect the founder reported on
// 2026-08-30 (instruction text printed on top of the movement sticks, a dev
// panel parked at eye level, a 43px tap target, a restart button whose mobile
// override never applied) is *measurable* from element geometry alone. None of
// them needed a human to look at a screenshot. This module is that measurement,
// kept pure so it runs under node --test with no browser, exactly like
// lib/game/*.ts. The browser half -- walking the DOM to produce Elem[] -- lives
// in e2e/ui-hygiene.spec.ts and scripts/ui-audit.mjs, which share this file.

export interface Elem {
  key: string;            // #id / [data-testid] / .class / tag, for the message
  x: number; y: number; w: number; h: number;
  fontPx: number;
  tappable: boolean;
  pointerEvents: string;
  position: string;
  opaqueBg: boolean;      // background alpha >= OPAQUE_ALPHA
  isText: boolean;        // has its own (non-descendant) text
  isBackdrop: boolean;    // covers >= BACKDROP_COVERAGE of the viewport (gate, win, death, dialog scrim)
}

export interface Viewport { w: number; h: number; }

export interface Defect {
  rule: string;
  severity: 'error' | 'warn';
  message: string;
  keys: string[];
}

// WCAG 2.5.5 / Apple HIG / Material all land on ~44px as the minimum comfortable
// touch target. The repo already cites this number twice in
// components/GameCanvas.tsx's mobile media block, so this is not a new standard,
// it is the one the codebase already claims to follow.
export const MIN_TAP_PX = 44;
// Below this a label stops being readable at arm's length on a phone.
export const MIN_FONT_PX = 12;
// Fraction of the smaller element's area that must be covered before two
// elements count as colliding. Small enough to catch a stick with text over it,
// large enough that a 1px antialias touch is not a defect.
export const OVERLAP_TOLERANCE = 0.10;
// A fixed, opaque panel bigger than this fraction of the viewport, sitting
// inside the central band, is blocking the player's view of the game.
export const VIEW_BLOCK_AREA = 0.03;
// The vertical band a first-person player actually looks through. Chrome
// belongs above or below it, not inside it.
export const VIEW_BAND = { top: 0.18, bottom: 0.72 };
export const OPAQUE_ALPHA = 0.35;
export const BACKDROP_COVERAGE = 0.7;
// Distance from the viewport edge inside which a tap target risks the OS's own
// edge gestures (back-swipe, notification pull).
export const EDGE_MARGIN_PX = 8;

function intersection(a: Elem, b: Elem): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
}

const area = (e: Elem) => e.w * e.h;

// A backdrop containing its own children is not a collision -- #gate contains
// #gateTitle by design. Only same-layer siblings colliding is a defect.
function collidable(e: Elem): boolean {
  return !e.isBackdrop && e.pointerEvents !== 'none' ? true : !e.isBackdrop && e.isText;
}

export function checkTapTargets(els: Elem[]): Defect[] {
  return els
    .filter(e => e.tappable && !e.isBackdrop && (e.w < MIN_TAP_PX || e.h < MIN_TAP_PX))
    .map(e => ({
      rule: 'tap-target',
      severity: 'error' as const,
      message: `${e.key} is ${Math.round(e.w)}x${Math.round(e.h)}px, under the ${MIN_TAP_PX}px minimum touch target`,
      keys: [e.key],
    }));
}

export function checkOverlaps(els: Elem[]): Defect[] {
  // A wrapper that exactly boxes its only child (MobileControls' pause wrapper
  // around the pause button, a stick's own div around the stick) is one visual
  // thing, and reporting both halves of it doubles every real collision into a
  // pair of near-identical messages. Keep the first element at each rect.
  // When a wrapper and its child share a rect, keep whichever one has a real
  // name -- an unnamed <div> in the message tells the reader nothing, and the
  // named half is always the one the fix will touch.
  const best = new Map<string, Elem>();
  for (const e of els.filter(collidable)) {
    const k = [Math.round(e.x), Math.round(e.y), Math.round(e.w), Math.round(e.h)].join(':');
    const prev = best.get(k);
    if (!prev || (prev.key.length <= 3 && e.key.length > 3)) best.set(k, e);
  }
  const c = [...best.values()];
  const out: Defect[] = [];
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) {
      const a = c[i], b = c[j];
      // a nested inside b is composition, not collision
      const inter = intersection(a, b);
      if (inter === 0) continue;
      const smaller = Math.min(area(a), area(b));
      if (smaller === 0) continue;
      if (inter >= smaller * 0.995) continue;   // full containment
      if (inter / smaller < OVERLAP_TOLERANCE) continue;
      out.push({
        rule: 'overlap',
        severity: 'error',
        message: `${a.key} and ${b.key} overlap by ${Math.round((100 * inter) / smaller)}% of the smaller element`,
        keys: [a.key, b.key],
      });
    }
  }
  return out;
}

export function checkViewBlocking(els: Elem[], vp: Viewport): Defect[] {
  const bandTop = vp.h * VIEW_BAND.top;
  const bandBottom = vp.h * VIEW_BAND.bottom;
  return els
    .filter(e =>
      e.position === 'fixed' &&
      e.opaqueBg &&
      !e.isBackdrop &&
      area(e) > vp.w * vp.h * VIEW_BLOCK_AREA &&
      e.y + e.h > bandTop &&
      e.y < bandBottom)
    .map(e => ({
      rule: 'view-blocking',
      severity: 'error' as const,
      message: `${e.key} (${Math.round(e.w)}x${Math.round(e.h)}, ${((100 * area(e)) / (vp.w * vp.h)).toFixed(1)}% of screen) sits in the player's sight band`,
      keys: [e.key],
    }));
}

export function checkFonts(els: Elem[]): Defect[] {
  return els
    .filter(e => e.isText && e.fontPx > 0 && e.fontPx < MIN_FONT_PX)
    .map(e => ({
      rule: 'font-size',
      severity: 'warn' as const,
      message: `${e.key} renders text at ${e.fontPx}px, under the ${MIN_FONT_PX}px floor`,
      keys: [e.key],
    }));
}

// The founder's rule, made mechanical: nothing important may cost more than two
// taps, and the first tap is opening the menu. The caller supplies the measured
// depth per action; this only judges it.
export function checkReachability(depths: Record<string, number>, max = 2): Defect[] {
  return Object.entries(depths)
    .filter(([, d]) => d > max || d < 0)
    .map(([action, d]) => ({
      rule: 'reachability',
      severity: 'error' as const,
      message: d < 0
        ? `"${action}" is not reachable at all`
        : `"${action}" takes ${d} taps, over the ${max}-tap budget`,
      keys: [action],
    }));
}

export function checkOverflow(els: Elem[], vp: Viewport): Defect[] {
  return els
    .filter(e => e.position === 'fixed' && !e.isBackdrop &&
      (e.x < -1 || e.y < -1 || e.x + e.w > vp.w + 1 || e.y + e.h > vp.h + 1))
    .map(e => ({
      rule: 'overflow',
      severity: 'error' as const,
      message: `${e.key} at (${Math.round(e.x)},${Math.round(e.y)}) ${Math.round(e.w)}x${Math.round(e.h)} extends outside the ${vp.w}x${vp.h} viewport`,
      keys: [e.key],
    }));
}

export function checkEdgeGestures(els: Elem[], vp: Viewport): Defect[] {
  return els
    .filter(e => e.tappable && !e.isBackdrop &&
      (e.x < EDGE_MARGIN_PX || e.x + e.w > vp.w - EDGE_MARGIN_PX))
    .map(e => ({
      rule: 'edge-gesture',
      severity: 'warn' as const,
      message: `${e.key} sits within ${EDGE_MARGIN_PX}px of a screen edge, where the OS claims the swipe`,
      keys: [e.key],
    }));
}

export function audit(els: Elem[], vp: Viewport, depths: Record<string, number> = {}): Defect[] {
  return [
    ...checkTapTargets(els),
    ...checkOverlaps(els),
    ...checkViewBlocking(els, vp),
    ...checkFonts(els),
    ...checkOverflow(els, vp),
    ...checkEdgeGestures(els, vp),
    ...checkReachability(depths),
  ];
}
