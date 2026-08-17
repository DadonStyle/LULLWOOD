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
      /** LUL-65: state + distance-to-player + scentOnto() re-trigger count for `kind`. Null if not found.
       * LUL-99: `t` is clock.elapsedTime -- game time, not wall time (see wiki: systems/dt-clamp-vs-walltime). */
      qaProbePredatorState?: (
        kind: 'wolf' | 'bear' | 'lion',
      ) => { state: string; dist: number; scentCalls: number; t: number } | null;
      // LUL-22/LUL-43 positional-hiding scaffolding (see the qaHooks block
      // inside init() in forest-engine.js). Both placement hooks return the
      // predator's index into `predators`, or null if the scenario couldn't
      // be set up (no lion spawned / no non-tree cover generated) -- callers
      // must check for null rather than assume the index is always valid.
      /** Teleports the player to the spawn clearing and a lion 4 units out, hunting. Returns the lion's `predators` index, or null if no lion spawned. */
      qaOpenHideNearLion?: () => number | null;
      /** Places predator[0] and the player on opposite sides of a real hiding-spot prop (bramble/log; LUL-212 narrowed this from any non-tree cover prop). Returns 0, or null if no hiding-spot prop exists. */
      qaHideBehindCover?: () => number | null;
      /** LUL-121: same as qaHideBehindCover but picks the first predator of the given species. Returns { idx, kind } on success, null if no clear hiding-spot placement exists. */
      qaHideBehindCoverKind?: (kind: 'wolf' | 'bear' | 'lion') => { idx: number; kind: 'wolf' | 'bear' | 'lion' } | null;
      /** LUL-212: teleports the player to the nearest hiding spot (bramble/log), no predator involved. Returns the spot's kind, or null if none were generated. */
      qaTeleportToHideSpot?: () => string | null;
      /** LUL-211: the player's world position and heading -- the only way a test can
       * see where movement actually ended up (player is init()-closure-local). */
      qaProbePlayer?: () => { x: number; z: number; yaw: number };
      /** LUL-211: places the player 1.6 units off the -x face of the first reachable
       * cover prop of `kind`, facing it, so a held KeyW walks straight into it.
       * Returns the prop's AABB and the player's start, or null if no clear
       * placement exists for that kind. */
      qaStageWalkIntoCover?: (kind: 'tree' | 'rock' | 'log' | 'bramble') => {
        prop: { x: number; z: number; hx: number; hz: number; kind: string };
        start: { x: number; z: number };
      } | null;
      /** Snapshot of one predator's state machine, or null if `idx` doesn't resolve. */
      qaPredatorState?: (idx: number) => {
        kind: 'wolf' | 'bear' | 'lion';
        state: string;
        inv: string;
        sniffsLeft: number;
      } | null;
    };
  }
}
