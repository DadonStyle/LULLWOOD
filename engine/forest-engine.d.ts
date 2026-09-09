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
      /** LUL-2169: forces a deterministic death via the real triggerDeath() (not fake
       * state) so an e2e spec doesn't have to wait out a real predator's hunt/chase/
       * charge timer. `kind` defaults to 'wolf', `cause` to 'chase' -- both match the
       * defaults forest-engine.js's own triggerDeath() calls use for the everyday
       * chase-catch death. No-ops (mirrors triggerDeath/canTriggerDeath) if the run is
       * already dead, won, or mid-pickup. */
      qaTriggerDeath?: (kind?: 'wolf' | 'bear' | 'lion', cause?: 'charge' | 'hunt' | 'chase') => void;
      /** LUL-25: sets difficulty for the *next* generateMap() (restart/regen), not the
       * current map. No UI wires this yet (LUL-26) -- it's how a test exercises hard
       * mode's "child spawns beyond the bog" before that UI exists. */
      qaSetDifficulty?: (mode: 'normal' | 'hard') => void;
      /** LUL-25: the child's world position and whether it's past the forest/bog seam. */
      qaProbeBaby?: () => { x: number; z: number; inBog: boolean };
      /** LUL-2122: babyLight's live intensity/distance plus the pickup/carry/taken
       * state flags, so a test can assert the interact button actually reached
       * pickup() instead of only that it rendered and was tappable. */
      qaProbeBabyLight?: () => {
        intensity: number;
        distance: number;
        carrying: boolean;
        pickingUp: boolean;
        taken: boolean;
      };
      /** LUL-1093: w2m(x,z)'s clamped pixel output plus the minimap canvas size (mm),
       * so a test can assert an arbitrary world point stays on-canvas. */
      qaProbeMinimapPoint?: (x: number, z: number) => { px: number; py: number; mm: number };
      /** LUL-83: the seed generateMap() actually used, plus the tree/baby/predator
       * positions it produced -- diff two loads' output to prove `?seed=` pins an
       * exact layout and no `?seed=` varies it. */
      qaProbeMapSeed?: () => {
        seed: number;
        baby: { x: number; z: number };
        trees: { x: number; z: number }[];
        predators: { kind: 'wolf' | 'bear' | 'lion'; x: number; z: number }[];
      };
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
      /** LUL-1089: teleports the player to the first hide-spot prop (bramble/log) and places a lion 4 units away in chase state. Returns { idx, kind } on success, or null if no hide spot or no lion spawned. */
      qaOpenHideNearLionAtHideSpot?: () => { idx: number; kind: string } | null;
      /** Places predator[0] and the player on opposite sides of a real hiding-spot prop (bramble/log; LUL-212 narrowed this from any non-tree cover prop). Returns 0, or null if no hiding-spot prop exists. */
      qaHideBehindCover?: () => number | null;
      /** LUL-121: same as qaHideBehindCover but picks the first predator of the given species. Returns { idx, kind, playerX, playerZ } on success (playerX/playerZ per LUL-242, the player's placed position -- needed to compute an exact offset back to the predator, since cover-clearance separation and scent-pickup radius are different quantities), null if no clear hiding-spot placement exists. */
      qaHideBehindCoverKind?: (
        kind: 'wolf' | 'bear' | 'lion',
      ) => { idx: number; kind: 'wolf' | 'bear' | 'lion'; playerX: number; playerZ: number } | null;
      /** LUL-196: reset predator[idx] to roam without relocating it; returns {x,z} so callers can verify position unchanged, or null if idx doesn't resolve. */
      qaSetPredatorRoam?: (idx: number) => { x: number; z: number } | null;
      /** LUL-1620: read predator[idx]'s last-known-position return-sweep memory, or null if idx doesn't resolve. */
      qaGetPredatorLkp?: (idx: number) => { lkpX: number; lkpZ: number; lkpSweeps: number } | null;
      /** LUL-1620: whether the approach piano tell is currently gated on (mirrors the `:3479` piano gate, no raw Web Audio exposure). */
      qaIsApproachPianoActive?: () => boolean;
      /** LUL-1620: places the given species `dx/dz` from the player's current position (player untouched) and arms it one tick from the investigate/sniff give-up transition; returns {idx,x,z} or null if the species doesn't resolve. */
      qaStagePredatorGiveUp?: (kind: 'wolf' | 'bear' | 'lion', dx: number, dz: number) => { idx: number; x: number; z: number } | null;
      /** LUL-1620: teleports predator[idx] onto its own current roam waypoint so the next tick's arrival/repick runs immediately; returns {x,z} or null if idx doesn't resolve. */
      qaFastForwardPredatorToWaypoint?: (idx: number) => { x: number; z: number } | null;
      /** LUL-212: teleports the player to the first generated hiding spot (bramble/log), no predator involved. Returns the spot's kind, or null if none were generated. */
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
      /** LUL-224: `hidden` added so a test can confirm whether a KeyH press actually
       * entered the hold-still stance, since LUL-212 gated that on proximity to a
       * hiding-spot prop -- placement alone no longer implies the press worked. */
      qaPlayerState?: () => {
        x: number; z: number; yaw: number; pitch: number; mode: 'desktop' | 'mobile';
        jumping: boolean; paused: boolean; toggleRunOn: boolean; veilHeld: boolean;
        hidden: boolean;
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
      /** LUL-1461: places `kind` in a blind scent-chase (state='chase',
       * scentLock=SCENT_TRACK_TIME) straddling a real tree trunk -- predator and
       * player sit on opposite sides of the trunk's own z, `margin` units
       * beyond the trunk radius plus each actor's own collision radius (so
       * the actual standoff is derived per-tree, not a fixed distance), and
       * its collision circle sits squarely on the segment between them. Also
       * rejects any tree with a neighbour close enough to crowd the direct
       * line or a reasonable sidestep around it, so the scenario stays a
       * single-obstacle case (see the comment above the implementation for
       * why: a fixed large standoff measured as timing out even on
       * already-fixed code, for bear, by putting other trees in the gap).
       * Regression coverage for LUL-1091 (predators pathing around trees):
       * before that fix a predator staged this way grinds into the trunk and
       * never arrives. Every other predator is marked `inert` for the rest of
       * the page's life (same isolation qaStageBlindChaseThroughCover uses).
       * Returns the predator's index/kind/staged distance and the tree's
       * position/radius, or null if no tree in this seed left both staged
       * points clear of every other obstacle and neighbour-isolated. Prefer
       * qaStageAndTraceBehindTree for an actual assertion -- this alone races
       * the exact scenario it stages. */
      qaStageBehindTree?: (
        kind: 'wolf' | 'bear' | 'lion',
        margin: number,
      ) => { idx: number; kind: 'wolf' | 'bear' | 'lion'; treeX: number; treeZ: number; treeCr: number; dist: number } | null;
      /** LUL-1461: stages (as qaStageBehindTree) then, in the same synchronous
       * call, starts an in-page rAF loop recording `{t, dist, state, reached}`
       * once per frame until the game's own `dead` flag flips (matching
       * traceBlindChase's proven pattern -- an independently-computed
       * isCaught() check here resolved one frame early and left the test
       * hanging after page.evaluate() returned; see the implementation
       * comment) or `maxMs` elapses. Staging and the first observed frame
       * must happen in one page.evaluate() round trip, not two -- see
       * qaStageAndTraceBlindChase's comment for the measured reason. Returns
       * null if staging failed (see qaStageBehindTree). */
      qaStageAndTraceBehindTree?: (
        kind: 'wolf' | 'bear' | 'lion',
        margin: number,
        maxMs: number,
      ) => Promise<{
        idx: number;
        kind: 'wolf' | 'bear' | 'lion';
        dist: number;
        trace: { t: number; dist: number; state: string; reached: boolean }[];
      } | null>;
      /** LUL-69: the live camera vertical FOV (degrees) -- confirms the
       * mobile/desktop CAMERA_FOV split in init() actually took effect. */
      qaCameraFov?: () => number;
      /** LUL-1112: the live audio context state, whether it's started, soundOn flag,
       * and master gain value -- used to verify the audio context is running on mobile. */
      qaProbeAudio?: () => {
        state: AudioContextState | null;
        started: boolean;
        soundOn: boolean;
        masterGain: number | null;
      };
      /** LUL-2121: deterministic lose-sequence trigger. Returns `true` only
       * when this call itself landed a fresh death; `false` when rejected
       * (not yet entered, mid-pickup, already won, or already dead --
       * canTriggerDeath() in lib/game/outcome.ts plus an explicit `entered`
       * check the pure guard doesn't cover); `null` for an invalid kind or
       * cause. Goes through the real triggerDeath(), never fakes state. */
      qaForceDeath?: (kind?: 'wolf' | 'bear' | 'lion', cause?: 'hunt' | 'chase' | 'charge') => boolean | null;
      /** LUL-2121: reads the live death/lose-sequence state -- dead,
       * deathShown (flips true once #deathText reaches opacity 1),
       * cutsceneSkippable, seconds elapsed since death in game time, and the
       * death video's playback state. */
      qaProbeDeath?: () => {
        dead: boolean;
        deathShown: boolean;
        cutsceneSkippable: boolean;
        sinceDeath: number | null;
        video: { currentTime: number; ended: boolean; paused: boolean; readyState: number; display: string } | null;
      };
      /** LUL-2205: reads the live day/night pacing values -- timeOfRun (0 dawn
       * to 1 full night), the fog density and hemisphere-light intensity it
       * feeds, the resulting predator detect-radius multiplier, and the HUD
       * clock label -- in one call, so a test can assert the engine-visible
       * effect directly instead of only the #timeOfRunClock DOM text. */
      qaProbeTimeOfRun?: () => {
        timeOfRun: number;
        fogDensity: number;
        hemiIntensity: number;
        detectMul: number;
        clock: string;
      };
      /** LUL-2071: deterministic test clock -- parks the real RAF loop so a
       * test can advance simulation time in exact, jitter-free steps. Must be
       * called before qaAdvance(). */
      qaSetFixedStep?: (dtSeconds: number) => void;
      /** LUL-2071: advances simulation time by exactly dtSeconds * steps,
       * driving the same stepFrame() the real RAF loop calls. Throws if
       * qaSetFixedStep() hasn't been called first. */
      qaAdvance?: (steps?: number) => void;
      /** LUL-2123: teleports next to the nearest untaken throwable stone and
       * calls the real grabThrowable(), so #throwPrompt (desktop) / the Throw
       * button (mobile) render. Returns the stone's position, or null if no
       * untaken stone exists or the grab was rejected. */
      qaGrabThrowable?: () => { x: number; z: number } | null;
      /** LUL-2123: teleports just outside the active mission target's
       * interactRadius so #missionPanel, the mission prompt and the objective
       * are all on screen together. Returns the target, or null if no mission
       * is active. */
      qaTeleportNearMission?: () => { kind: 'deepwater'; x: number; z: number; status: 'active' | 'complete' } | null;
      /** LUL-2230: exactly what the last frame drew for the scent trail visual
       * -- `points.length` always equals the draw range the renderer used
       * this tick, so a test can assert the picture directly instead of
       * re-deriving THREE.Points state. `livePoints` is `scentPoints.length`
       * (the real detection array) for cross-checking the visual against the
       * mechanic it renders. */
      qaProbeScentTrail?: () => {
        settingOn: boolean;
        rendered: boolean;
        // `rawX`/`rawZ` are the point's undrifted deposit position, so a test can
        // recompute driftedScentPosition() itself against `windX`/`windZ` below
        // without a separate hook to read the wind vector.
        points: {
          x: number; z: number; age: number; alpha: number; inFrustum: boolean;
          rawX: number; rawZ: number; radius: number;
        }[];
        livePoints: number;
        captionVisible: boolean;
        captionSeen: boolean;
        veilAmount: number;
        windX: number;
        windZ: number;
      };
      /** LUL-2230: sets the camera yaw directly (the same `player.yaw` every
       * look-input path writes) so a test can turn to face its own scent
       * trail without pointer lock. Read-only otherwise -- no movement. */
      qaSetLookYaw?: (rad: number) => void;
      /** LUL-2230: clears the persisted `lullwood:scentTrailCaptionSeen` flag
       * and the in-memory one-time gate, so a single boot can prove the
       * caption is first-time-only twice in the same test. */
      qaResetScentCaption?: () => void;
    };
  }
}
