// LUL-34 (M2b): forest-engine.js stays plain JS (module decomposition into
// lib/game/ is separate, still-open scope per wiki:game/port-plan). This
// colocated declaration file is the only thing that gives GameCanvas.tsx real
// types for the dynamic import, instead of an implicit `any`. The HUD state
// and action shapes are defined once in components/Hud.tsx (it's the
// consumer that cares most about the exact fields) and re-used here so
// there's a single source of truth.
import type { EngineActions, EngineHudState } from '@/components/Hud';

// LUL-276: inputMode picks which listeners the engine binds -- 'desktop'
// (default) wires pointer-lock/mouse, 'mobile' leaves those unbound and
// makes the touch setters live. See wiki game/lul274-input-mode-separation.
export function init(
  onStateChange?: (state: EngineHudState) => void,
  inputMode?: 'desktop' | 'mobile',
): EngineActions | null;
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
      /** LUL-25: sets difficulty for the *next* generateMap() (restart/regen), not the
       * current map. No UI wires this yet (LUL-26) -- it's how a test exercises hard
       * mode's "child spawns beyond the bog" before that UI exists. */
      qaSetDifficulty?: (mode: 'normal' | 'hard') => void;
      /** LUL-25: the child's world position and whether it's past the forest/bog seam. */
      qaProbeBaby?: () => { x: number; z: number; inBog: boolean };
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
      /** LUL-121: same as qaHideBehindCover but picks the first predator of the given species. Returns { idx, kind, playerX, playerZ } on success (playerX/playerZ per LUL-242, the player's placed position -- needed to compute an exact offset back to the predator, since cover-clearance separation and scent-pickup radius are different quantities), null if no clear hiding-spot placement exists. */
      qaHideBehindCoverKind?: (
        kind: 'wolf' | 'bear' | 'lion',
      ) => { idx: number; kind: 'wolf' | 'bear' | 'lion'; playerX: number; playerZ: number } | null;
      /** LUL-196: reset predator[idx] to roam without relocating it; returns {x,z} so callers can verify position unchanged, or null if idx doesn't resolve. */
      qaSetPredatorRoam?: (idx: number) => { x: number; z: number } | null;
      /** LUL-212: teleports the player to the nearest hiding spot (bramble/log), no predator involved. Returns the spot's kind, or null if none were generated. */
      qaTeleportToHideSpot?: () => string | null;
      /** LUL-211: the player's world position and heading -- the only way a test can
       * see where movement actually ended up (player is init()-closure-local). */
      qaProbePlayer?: () => { x: number; z: number; yaw: number };
      /** LUL-211/LUL-288: places the player off the -x face of the first reachable
       * cover prop of `kind`, facing it, so a held KeyW walks straight into it. The
       * standoff distance is rotation-aware (props render at prop.ry), so it clears
       * the prop's true rotated collision boundary, not just its axis-aligned hx.
       * Returns the prop's AABB (plus ry) and the player's start, or null if no
       * clear placement exists for that kind. LUL-388: `kind:'tree'` is a circle
       * (real trunk radius, ry always 0 in the returned prop), not a rotated box --
       * tree coverData rows carry no `ry` at all. */
      qaStageWalkIntoCover?: (kind: 'tree' | 'rock' | 'log' | 'bramble') => {
        prop: { x: number; z: number; hx: number; hz: number; ry: number; kind: string };
        start: { x: number; z: number };
      } | null;
      /** LUL-384: exposes the exact `blocked()` predicate player movement gates on,
       * so a test can sample collision across a span directly instead of inferring
       * it from how far real keyboard-driven movement got within a fixed wall-clock
       * window (unreliable under CI render load, wiki: systems/dt-clamp-vs-walltime). */
      qaProbeBlocked?: (x: number, z: number) => boolean;
      /** Snapshot of one predator's state machine, or null if `idx` doesn't resolve.
       * LUL-388: `dist`/`canSee` are the exact live values the engine's own kill
       * check uses this tick -- poll these instead of racing wall-clock time
       * against game time (see wiki: systems/dt-clamp-vs-walltime).
       * LUL-659: `x`/`z` are the predator's raw world position, for tracing
       * lateral movement (e.g. avoidDir() steering around cover) over time. */
      qaPredatorState?: (idx: number) => {
        kind: 'wolf' | 'bear' | 'lion';
        state: string;
        inv: string;
        sniffsLeft: number;
        scentCalls: number;
        dist: number;
        canSee: boolean;
        x: number;
        z: number;
      } | null;
      /** LUL-213: forces the first `wolf`/`lion` straight into a charge telegraph,
       * deterministically (the real trigger is a per-frame probability roll, which a
       * test can't reliably wait on). Places it due +x of the player at the trigger
       * band's midpoint, in the open. Returns the predator's `predators` index, or
       * null if that species isn't spawned or `kind` isn't `wolf`/`lion`. */
      qaTriggerCharge?: (kind: 'wolf' | 'bear' | 'lion') => number | null;
      /** LUL-373: live ChargeState.phase/t for predator `idx`, or null if it has
       * no active charge. `t` is seconds elapsed in that phase, in game time
       * (not wall time). Lets a test poll for "well into 'charging'" against
       * the engine's own clock instead of guessing a wall-clock wait -- see
       * wiki systems/dt-clamp-vs-walltime.
       * LUL-421: also returns overshootDuration (the LUL-323 dodge-timing
       * value), and falls back to the most recently resolved charge once the
       * live one goes null -- `t` is 0 in that fallback case. */
      qaChargePhase?: (idx: number) => {
        phase: 'telegraph' | 'charging' | 'overshoot' | 'caught' | 'cleared';
        t: number;
        overshootDuration: number;
      } | null;
      /** LUL-275: snapshot of the player's transform and detected input mode --
       * this init() actually bound -- proves which input branch bound at runtime,
       * not just which the test requested. See wiki: game/lul274-input-mode-separation. */
      /** LUL-529: jumping/paused/toggleRunOn/veilHeld added so mobile e2e specs can
       * assert a touch control's engine-visible effect, not just DOM presence. */
      qaPlayerState?: () => {
        x: number; z: number; yaw: number; pitch: number; mode: 'desktop' | 'mobile';
        jumping: boolean; paused: boolean; toggleRunOn: boolean; veilHeld: boolean;
      };
      /** LUL-388: places `kind` in a blind scent-chase (state='chase', scentLock=SCENT_TRACK_TIME)
       * within catch range (dist < rad+CATCH_MARGIN) of the player, with a real cover prop's
       * rotated AABB straddling the segment between them so canSee() reads false -- the exact
       * shape of the LUL-387 regression. Every other predator is marked `inert` for the rest of
       * the page's life so a catch can only ever be this one (see qaStageAndTraceBlindChase's
       * comment for why that isolation is load-bearing, not defensive). Returns the predator's
       * index, kind, and the staged distance, or null if no cover prop was thin enough to fit
       * inside catch range for this species/seed. Prefer qaStageAndTraceBlindChase for an actual
       * assertion -- this on its own races the exact scenario it stages, see that hook's comment. */
      qaStageBlindChaseThroughCover?: (
        kind: 'wolf' | 'bear' | 'lion',
      ) => { idx: number; kind: 'wolf' | 'bear' | 'lion'; dist: number } | null;
      /** LUL-388: stages (as qaStageBlindChaseThroughCover) then, in the same
       * synchronous call, starts an in-page rAF loop recording `{t, dist, canSee,
       * dead}` once per frame until `dead` or `maxMs` elapses. Staging and the
       * first observed frame must happen in one page.evaluate() round trip, not
       * two -- the staged gap is necessarily small (has to land inside catch
       * range), and since predators never collide with cover (LUL-119/211) one
       * measured closing it, into a genuine sightline, in fewer frames than a
       * single Playwright IPC round trip takes. Two separate calls (stage, then
       * a would-be trace/poll hook) let that closing happen in the gap between
       * them and made every case look caught from frame one, even with the
       * LUL-387 fix intact. Returns null if staging failed (see
       * qaStageBlindChaseThroughCover). */
      qaStageAndTraceBlindChase?: (
        kind: 'wolf' | 'bear' | 'lion',
        maxMs: number,
      ) => Promise<{
        idx: number;
        kind: 'wolf' | 'bear' | 'lion';
        dist: number;
        trace: { t: number; dist: number; canSee: boolean; dead: boolean }[];
      } | null>;
      /** LUL-69: the live camera vertical FOV (degrees) -- confirms the
       * mobile/desktop CAMERA_FOV split in init() actually took effect. */
      qaCameraFov?: () => number;
    };
  }
}
