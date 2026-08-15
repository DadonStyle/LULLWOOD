// LUL-34 (M2b): forest-engine.js stays plain JS (module decomposition into
// lib/game/ is separate, still-open scope per wiki:game/port-plan). This
// colocated declaration file is the only thing that gives GameCanvas.tsx real
// types for the dynamic import, instead of an implicit `any`. The HUD state
// and action shapes are defined once in components/Hud.tsx (it's the
// consumer that cares most about the exact fields) and re-used here so
// there's a single source of truth.
import type { EngineActions, EngineHudState } from '@/components/Hud';

export function init(onStateChange?: (state: EngineHudState) => void): EngineActions | null;
export function dispose(): void;

// LUL-35 (pass 2): the `window.ForestEngine` shape used to be re-declared by
// hand in GameCanvas.tsx, which meant the same two signatures were written
// twice and could drift apart. It is declared here instead -- next to the
// module that actually installs the global (see the bottom of
// forest-engine.js) -- and the `init` / `dispose` entries reuse the exported
// types above rather than restating them.
declare global {
  interface Window {
    ForestEngine?: {
      init: typeof init;
      dispose: typeof dispose;
      threeRevision: string;
      // Present only under `?qaHooks=1` (see the qaHooks block inside init()).
      // Declared here so the Playwright specs can call them without each one
      // casting `window` to `any` and losing every other guarantee with it.
      qaTeleportNearBaby?: () => void;
      qaTeleportHome?: () => void;
      /** Returns the lured predator's kind, or null if none was found. */
      qaLurePredator?: () => 'wolf' | 'bear' | 'lion' | null;
      /** Same as qaLurePredator, filtered to the given species. Returns the
       * lured predator's kind, or null if none of that species was found. */
      qaLurePredatorKind?: (kind: 'wolf' | 'bear' | 'lion') => 'wolf' | 'bear' | 'lion' | null;
      /** LUL-65: seeds one synthetic scent point `age` game-seconds old at (player.x+dx, player.z+dz). */
      qaSeedScentPoint?: (dx: number, dz: number, age: number) => void;
      /** LUL-65: places `kind` on the drifted oldest live scent point, in `roam`. Null if none live or species not found. */
      qaProbeScentOnOldest?: (kind: 'wolf' | 'bear' | 'lion') => { age: number; dist: number } | null;
      /** LUL-65: state + distance-to-player + scentOnto() re-trigger count for `kind`. Null if not found. */
      qaProbePredatorState?: (
        kind: 'wolf' | 'bear' | 'lion',
      ) => { state: string; dist: number; scentCalls: number } | null;
    };
  }
}
