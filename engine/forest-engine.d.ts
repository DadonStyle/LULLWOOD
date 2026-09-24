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
       * mode's "child spawns far from home" before that UI exists. */
      qaSetDifficulty?: (mode: 'normal' | 'hard') => void;
      /** LUL-2225: regenerates the map with an explicit seed, the same
       * generateMap() every other map-gen path calls -- unlike regenMap()/
       * restart() (both draw Math.random()), this lets a test reproduce an
       * exact layout after qaSetDifficulty('hard'), for pinned-seed blackout
       * spawn coverage. */
      qaRegenerateMap?: (seed: number) => void;
      /** LUL-2225: the child's world position and its distance from home
       * (LUL-4676: dropped the `routeCrossesBog` field once the bog was
       * deleted -- blackout's hard-baby-spawn predicate now requires only
       * `>= BLACKOUT_MIN_RADIUS` and landmark clearance, see lib/game/mission.ts
       * pickHardBabyPosition()). */
      qaProbeBaby?: () => { x: number; z: number; distHome: number };
      /** LUL-2122: babyLight's live intensity/distance plus the pickup/taken
       * state flags, so a test can assert the interact button actually reached
       * pickup() instead of only that it rendered and was tappable. */
      qaProbeBabyLight?: () => {
        intensity: number;
        distance: number;
        pickingUp: boolean;
        taken: boolean;
      };
      /** LUL-1093: w2m(x,z)'s clamped pixel output plus the minimap canvas size (mm),
       * so a test can assert an arbitrary world point stays on-canvas. */
      qaProbeMinimapPoint?: (x: number, z: number) => { px: number; py: number; mm: number };
      /** LUL-2248: per-landmark beacon sprite presence + fog-exemption, one entry per
       * LANDMARKS kind, so a test can assert the sprite exists and reads past the fog line
       * without a screenshot. */
      qaProbeLandmarkBeacons?: () => Array<{ kind: string; x: number; z: number; visible: boolean; fog: boolean | null }>;
      /** LUL-2667: the resolved timeOfDay state plus the exact TOD_VISUAL/TOD_AUDIO
       * values init() applied, so a test can assert against the six documented
       * states without scraping renderer internals. Read-only snapshot -- see
       * `?qaHour=` (docs/specs/lul-2667-time-of-day-coverage.md) for how a test
       * pins which state this reflects. */
      qaProbeTimeOfDay?: () => {
        state: 'night' | 'early-morning' | 'morning' | 'noon' | 'afternoon' | 'evening';
        visual: import('../lib/game/timeOfDay').TimeOfDaySkyConfig;
        audio: import('../lib/game/timeOfDay').TimeOfDayAudioConfig;
      };
      /** LUL-83: the seed generateMap() actually used, plus the tree/baby/predator
       * positions it produced -- diff two loads' output to prove `?seed=` pins an
       * exact layout and no `?seed=` varies it. */
      qaProbeMapSeed?: () => {
        seed: number;
        baby: { x: number; z: number };
        trees: { x: number; z: number }[];
        predators: { kind: 'wolf' | 'bear' | 'lion'; x: number; z: number }[];
      };
      /** LUL-2247: per-chunk prop counts by category (cover/stone), the minimum pairwise centre-to-centre distance across every non-tree prop, and the total count -- all read from the finished, post-thin map. */
      qaProbePropDensity?: () => {
        perChunk: Array<{ chunk: number; cover: number; stone: number }>;
        minPairSpacing: number | null;
        total: number;
      };
      /** LUL-1487 (E6), extended by LUL-2249: `chunks`/`instantiated` are the
       * count of currently-live (ring-streamed) tree chunks, `populated` is
       * every chunk that has tree data regardless of live state, `totalInstances`
       * is the summed instance count across live chunks, and `expected` is
       * every tree whose chunk is currently live -- `totalInstances` must
       * equal `expected`. Was pre-existing/untyped (LUL-2257's own note);
       * declared now that this ticket extends the contract. */
      qaProbeTreeChunks?: () => {
        chunks: number;
        instantiated: number;
        populated: number;
        totalInstances: number;
        expected: number;
      };
      /** LUL-2249: the ring-streamed chunk lifecycle's own live state --
       * which chunk ids are currently live, how many cover chunks of
       * those are live, and the player's own current chunk id. */
      qaProbeChunkStreaming?: () => {
        liveChunks: number[];
        coverLive: number;
        playerChunk: number;
      };
      /** LUL-2250: active (non-inert, non-parked) predator count + how long
       * the board has been under MIN_ACTIVE_HUNTERS, for the hunter-guarantee e2e. */
      qaProbeActiveHunters?: () => { active: number; sinceBelowMin: number };
      /** LUL-2250: thin wrapper on the engine's own playerCanSee() FOV check. */
      qaProbePlayerCanSee?: (x: number, z: number) => boolean;
      /** Returns the lured predator's kind, or null if none was found. */
      qaLurePredator?: () => 'wolf' | 'bear' | 'lion' | null;
      /** Same as qaLurePredator, filtered to the given species. Returns the
       * lured predator's kind, or null if none of that species was found. */
      qaLurePredatorKind?: (kind: 'wolf' | 'bear' | 'lion') => 'wolf' | 'bear' | 'lion' | null;
      /** LUL-65: seeds one synthetic scent point `age` game-seconds old at (player.x+dx, player.z+dz). */
      qaSeedScentPoint?: (dx: number, dz: number, age: number) => void;
      /** LUL-2392: last {kind, durationMs, difficulty} the chase_gap analytics event fired with, or null if none yet this page load. */
      qaProbeChaseGap?: () => { kind: 'wolf' | 'bear' | 'lion'; durationMs: number; difficulty: 'lantern' | 'night' | 'blackout' } | null;
      /** LUL-65: places `kind` on the drifted oldest live scent point, in `roam`. Null if none live or species not found. */
      qaProbeScentOnOldest?: (kind: 'wolf' | 'bear' | 'lion') => { age: number; dist: number } | null;
      /** LUL-65: state + distance-to-player + scentOnto() re-trigger count for `kind`. Null if not found.
       * LUL-99: `t` is clock.elapsedTime -- game time, not wall time (see wiki: systems/dt-clamp-vs-walltime).
       * LUL-2667: `alertedBy` names which hearing channel set 'investigate' ('cry' via hearCry(), or null
       * for sight/scent/footstep) -- state alone can't distinguish them. */
      qaProbePredatorState?: (
        kind: 'wolf' | 'bear' | 'lion',
      ) => { state: string; dist: number; scentCalls: number; alertedBy: string | null; t: number } | null;
      /** LUL-2878: `kind`'s scaled effectiveDetect() this tick (veil/fog/time-of-run/difficulty/CONFIG.detectScaleMul applied on top of tuning.js's unscaled spec.detect), or null if not spawned. Use this, not the tuning constant, to stage a distance that will actually pass canSee()'s detect gate. */
      qaProbeEffectiveDetect?: (kind: 'wolf' | 'bear' | 'lion') => number | null;
      // LUL-22/LUL-43 positional-hiding scaffolding (see the qaHooks block
      // inside init() in forest-engine.js). Both placement hooks return the
      // predator's index into `predators`, or null if the scenario couldn't
      // be set up (no lion spawned / no non-tree cover generated) -- callers
      // must check for null rather than assume the index is always valid.
      /** Teleports the player to the spawn clearing and a lion 4 units out, hunting. Returns the lion's `predators` index, or null if no lion spawned. */
      qaOpenHideNearLion?: () => number | null;
      /** LUL-2664: places predator `kind` 6 units out in the spawn clearing, in the open,
       * pinned via `reroute` so it cannot close the gap mid-veil-hold -- isolates
       * veilDetectMul()'s canSee() cut from cover/stillness/chase-drift. Returns the
       * predator's `predators` index, or null if that species isn't spawned. */
      qaOpenVeilTarget?: (kind: 'wolf' | 'bear' | 'lion') => number | null;
      /** LUL-3150/LUL-4663: stages a chasing predator + full/unlocked veil charge for
       * Veil Overload testing, same body as qaOpenVeilTarget plus the charge reset (no
       * longer sets `carrying` -- LUL-4663 retargeted the trigger off it). Returns the
       * predator's `predators` index, or null if that species isn't spawned. */
      qaOpenVeilOverloadTarget?: (kind: 'wolf' | 'bear' | 'lion') => number | null;
      /** LUL-1089: teleports the player to the first hide-spot prop (bramble; LUL-2311 dropped log) and places a lion 4 units away in chase state. Returns { idx, kind } on success, or null if no hide spot or no lion spawned. */
      qaOpenHideNearLionAtHideSpot?: () => { idx: number; kind: string } | null;
      /** Places predator[0] and the player on opposite sides of a real hiding-spot prop (bramble; LUL-212 narrowed this from any non-tree cover prop, LUL-2311 narrowed it again to bramble only). Returns 0, or null if no hiding-spot prop exists. */
      qaHideBehindCover?: () => number | null;
      /** LUL-121: same as qaHideBehindCover but picks the first predator of the given species. Returns { idx, kind, playerX, playerZ, detect } on success (playerX/playerZ per LUL-242, the player's placed position -- needed to compute an exact offset back to the predator, since cover-clearance separation and scent-pickup radius are different quantities; `detect` per LUL-2878 is that predator's own effectiveDetect() at the placed position -- a candidate whose player/predator separation falls outside it is skipped rather than returned), null if no clear hiding-spot placement within detect range exists. */
      qaHideBehindCoverKind?: (
        kind: 'wolf' | 'bear' | 'lion',
      ) => { idx: number; kind: 'wolf' | 'bear' | 'lion'; playerX: number; playerZ: number; detect: number } | null;
      /** LUL-4528: rock-climb staging hook, mirrors qaHideBehindCoverKind's LOS-clear-ray
       * check shape but keyed on kind === 'rock' directly (rock is not in HIDE_KINDS).
       * Places the first live predator at (nearestRock.x + dx, nearestRock.z + dz), staged
       * into 'chase' so qaProbeEffectiveDetect(kind) reads a real detect roll immediately.
       * Returns the predator's staged {x,z}, or null if that offset is movement-blocked,
       * the ray back to the rock isn't LOS-clear, or there is no rock / no live predator. */
      qaStageRockClimb?: (dx: number, dz: number) => { x: number; z: number } | null;
      /** LUL-196: reset predator[idx] to roam without relocating it; returns {x,z} so callers can verify position unchanged, or null if idx doesn't resolve. */
      qaSetPredatorRoam?: (idx: number) => { x: number; z: number } | null;
      /** LUL-1620: read predator[idx]'s last-known-position return-sweep memory, or null if idx doesn't resolve. */
      qaGetPredatorLkp?: (idx: number) => { lkpX: number; lkpZ: number; lkpSweeps: number } | null;
      /** LUL-1620: whether the approach piano tell is currently gated on (mirrors the `:3479` piano gate, no raw Web Audio exposure). */
      qaIsApproachPianoActive?: () => boolean;
      /** LUL-1620: places the given species `dx/dz` from the player's current position (player untouched) and arms it one tick from the investigate/sniff give-up transition; returns {idx,x,z} or null if the species doesn't resolve. */
      qaStagePredatorGiveUp?: (kind: 'wolf' | 'bear' | 'lion', dx: number, dz: number) => { idx: number; x: number; z: number } | null;
      /** LUL-2246: places predator `kind` dx/dz from the player, parks every other spawned predator out of range, and fast-forwards `sinceClose` to 29.9s so the next real tick(s) cross the 30s force-hunt threshold through the engine's own logic. Returns `{idx,x,z}`, or null if the species isn't spawned. */
      qaStageForceHuntApproach?: (kind: 'wolf' | 'bear' | 'lion', dx: number, dz: number) => { idx: number; x: number; z: number } | null;
      /** LUL-2320: places predator `kind` dx/dz from the player and drops it straight into `chase` with a live `scentLock` (the exact blind-pursuit state the glue bug's root cause describes) -- player untouched. Returns `{idx,x,z}`, or null if the species isn't spawned. */
      qaStageChaseAtContact?: (kind: 'wolf' | 'bear' | 'lion', dx: number, dz: number) => { idx: number; x: number; z: number } | null;
      /** LUL-1620: teleports predator[idx] onto its own current roam waypoint so the next tick's arrival/repick runs immediately; returns {x,z} or null if idx doesn't resolve. */
      qaFastForwardPredatorToWaypoint?: (idx: number) => { x: number; z: number } | null;
      /** LUL-2505: marks every predator except idx `inert` (the same flag qaBuildScene's own parking uses) so a multi-second poll on the full map only ever sees idx's own contribution to the approach/piano threat scan, which skips inert predators entirely. Returns {idx,x,z}, or null if idx doesn't resolve. */
      qaIsolatePredator?: (idx: number) => { idx: number; x: number; z: number } | null;
      /** LUL-2841: re-runs qaLurePredatorKind's own nearest-of-`kind` search and marks every other predator `inert` (same flag as qaIsolatePredator) -- for a test built on qaTeleportToHideSpot's natural cover (so qaBuildScene isn't an option) that lures by kind rather than holding an idx. Returns {kind,x,z}, or null if the species isn't spawned. */
      qaIsolatePredatorKind?: (kind: 'wolf' | 'bear' | 'lion') => { kind: 'wolf' | 'bear' | 'lion'; x: number; z: number } | null;
      /** LUL-2457: marks every predator `inert` (same flag as qaIsolatePredator), parking them off-map so a long `qaAdvance` window (e.g. the day/night ramp) can't be ended early by an ambient kill. Returns the count parked. */
      qaClearAllPredators?: () => number;
      /** LUL-212: teleports the player to the first generated hiding spot (bramble; LUL-2311 dropped log from HIDE_KINDS), or the first prop of `kind` if given (LUL-2320). No predator involved. Returns the spot's kind, or null if none were generated / no prop of `kind` exists on this map. */
      qaTeleportToHideSpot?: (kind?: 'log' | 'bramble') => string | null;
      /** LUL-2311: teleports the player just outside the edge of the first cover prop of the given kind, no HIDE_KINDS check -- for asserting KeyH is a no-op beside a walkable-but-not-hide-eligible prop (e.g. 'log'). Returns the spot's kind, or null if none of that kind were generated. */
      qaTeleportNearCoverKind?: (kind: string) => string | null;
      /** LUL-211: the player's world position and heading -- the only way a test can
       * see where movement actually ended up (player is init()-closure-local).
       * LUL-3169 adds sprintWindBonusActive, mirroring stepFrame()'s own
       * `running && isMovingAgainstWind(mvx, mvz, windX, windZ)` (LUL-3149's Wind-Assisted
       * Evasion trigger) -- true only while the player is actively sprinting against the
       * wind, unlike qaProbeWind's movingAgainstWind which ignores `running`. */
      qaProbePlayer?: () => { x: number; z: number; yaw: number; sprintWindBonusActive: boolean };
      /** LUL-2189/LUL-2207: the module-scope wind unit vector (windX/windZ), set once per
       * generateMap() by generateWind() -- map-constant, not per-frame. windHighSpeed
       * (LUL-2539) is the independently-rolled high-wind flag from the same call.
       * LUL-3009 adds movingAgainstWind, the current per-frame EngineHudState value
       * (true while the player's live heading is moving against windX/windZ).
       * LUL-3149 adds two new consumers of movingAgainstWind: a sprint speed bonus
       * (WIND_ASSIST_SPEED_MUL) and a quieter footstep radius (NOISE_RADIUS_RUN_WIND),
       * both gated on running && movingAgainstWind. */
      qaProbeWind?: () => { windX: number; windZ: number; windHighSpeed: boolean; movingAgainstWind: boolean };
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
       * lateral movement (e.g. avoidDir() steering around cover) over time.
       * LUL-2320: `rad` (`PSPEC[kind].rad`) lets a test compute the live contact-catch
       * threshold (`rad + CATCH_MARGIN`) without hardcoding species constants.
       * LUL-2712: `sightFlicker` is the live `p.sightFlicker` value the chase LOS-flicker
       * grace (lib/game/predator.ts shouldDowngradeChase) reads/decrements every tick --
       * lets a test assert it is actually wired at the real canSee(p,dist) call site,
       * not just correct in isolation. */
      qaPredatorState?: (idx: number) => {
        kind: 'wolf' | 'bear' | 'lion';
        state: string;
        inv: string;
        sniffsLeft: number;
        scentCalls: number;
        dist: number; detectRange: number;
        canSee: boolean;
        rad: number;
        moveRad: number;
        x: number;
        z: number;
        gaveUpAt: number | null;
        parked: boolean;
        visible: boolean;
        sightFlicker: number;
        /** LUL-4893: seconds remaining in an active Predator Pause wind-freeze, 0 otherwise. */
        windPauseT: number;
        /** LUL-4897: 'beaconHunter' for that variant, undefined for every ordinary predator. */
        variant?: 'beaconHunter';
        /** LUL-4897: true while this predator is mid-chase via the wind-signal lock-on channel. */
        beaconHunterLocked: boolean;
        /** LUL-4996: seconds remaining in the post-freeze re-arm cooldown, 0 otherwise. */
        windPauseCooldownT: number;
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
      /** LUL-2853: `predators` index of whichever instance actually won
       * triggerDeath()'s once-only guard, or null if no death has happened yet
       * this run. Lets a test confirm a specific tracked predator (e.g. the one
       * returned by qaTriggerCharge) is the one that actually killed the player,
       * not a same-species pack-mate that independently won the race the same tick. */
      qaLastDeathPredatorIndex?: () => number | null;
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
        hidden: boolean; brambleSnagT: number;
        inLogCrawl: boolean; logCrawlExitX: number; logCrawlExitZ: number;
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
      /** LUL-5046: fixed-step sibling of qaStageAndTraceBehindTree above.
       * That hook's maxMs budget is real wall-clock time (performance.now())
       * against a frame dt that's clamped to DT_CLAMP_CEILING=0.05 every
       * tick -- under CI-realistic CPU contention simulated time falls
       * behind wall-clock time in proportion to how loaded the machine is,
       * so the same simulated arc (predators legitimately swing 2x+ further
       * from the player than the staged distance before curving back in,
       * confirmed live -- not a bug) needs proportionally more real seconds
       * to finish, which can exceed a fixed maxMs on a loaded runner even
       * though nothing about the steering itself is wrong. This variant
       * drives simulated time directly through qaAdvance's own stepFrame()
       * call instead of requestAnimationFrame, so the trace depends only on
       * simulated steps -- immune to real CPU speed. Requires
       * qaSetFixedStep(dt) first (same precondition qaAdvance() has).
       * Synchronous (no page-render wait needed, unlike the rAF-driven
       * sibling), returns null if staging failed (see qaStageBehindTree). */
      qaStageAndTraceBehindTreeFixed?: (
        kind: 'wolf' | 'bear' | 'lion',
        margin: number,
        maxSteps: number,
      ) => {
        idx: number;
        kind: 'wolf' | 'bear' | 'lion';
        dist: number;
        trace: { t: number; dist: number; state: string; reached: boolean }[];
      } | null;
      /** LUL-69: the live camera vertical FOV (degrees) -- confirms the
       * mobile/desktop CAMERA_FOV split in init() actually took effect. */
      qaCameraFov?: () => number;
      /** LUL-2953: the sky burst's live FOV compensation scale and its resulting
       * mesh scales -- confirms BOOM_FOV_SCALE reaches boomFlash/boomRing at
       * runtime instead of just existing as an unused constant. */
      qaProbeBoom?: () => { visible: boolean; elapsed: number; fovScale: number; ringScale: number; flashScale: number };
      /** LUL-2971: forces a render and reads back the WebGL canvas's center
       * pixel -- confirms the composited on-screen color at the burst's peak,
       * not just mesh color/scale math. */
      qaProbeBoomPixel?: () => { r: number; g: number; b: number };
      /** LUL-2985: boomFlash's own live material opacity -- pins the mesh's
       * fade curve directly, independent of the composited pixel probe above. */
      qaProbeBoomOpacity?: () => number;
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
        /** LUL-2461: distance in meters from CONFIG.home to the player's position at the
         * moment triggerDeath() fired, mirroring the loss event's `distance_from_home_m`.
         * `null` before any death this run. */
        distanceFromHomeAtDeathM: number | null;
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
       * qaSetFixedStep() hasn't been called first. Only the final step
       * renders, unless skipFinalRender (LUL-4600) is true, which skips
       * every render in this call -- for callers that only read engine
       * state (qaProbe*) and interleave repeated qaAdvance(1) calls, where
       * the "render on the last step" heuristic would otherwise render on
       * every single call. */
      qaAdvance?: (steps?: number, skipFinalRender?: boolean) => void;
      /** LUL-2123: teleports next to the nearest untaken throwable stone and
       * calls the real grabThrowable(), so #throwPrompt (desktop) / the Throw
       * button (mobile) render. Returns the stone's position, or null if no
       * untaken stone exists or the grab was rejected. */
      qaGrabThrowable?: () => { x: number; z: number } | null;
      /** LUL-2202: teleports within THROWABLE_PICKUP_RADIUS of the first untaken
       * stone WITHOUT grabbing it -- unlike qaGrabThrowable, this leaves the real
       * KeyE/pickup() path for the test to drive. Returns the stone's position,
       * or null if every stone is taken. */
      qaTeleportNearThrowable?: () => { x: number; z: number } | null;
      /** LUL-2202: places the first predator of `kind` a few units inside
       * THROWABLE_NOISE_RADIUS of where the player's next throw would land, reset
       * to a plain roaming state (state: 'roam', hunt: false, alert: 0). Returns
       * its predators index, or null if that species didn't spawn this seed. */
      qaStagePredatorNearThrowLanding?: (kind: 'wolf' | 'bear' | 'lion') => { idx: number } | null;
      /** LUL-2539: forces the high-wind scent-lifetime roll directly, bypassing the 50/50
       * generateWind() draw -- a test can't rely on a coin flip for a deterministic assertion. */
      qaSetWindHighSpeed?: (v: boolean) => void;
      /** LUL-3009: forces windX/windZ directly (normalized), same "bypass the roll" rationale
       * as qaSetWindHighSpeed above -- a movingAgainstWind test needs a known wind vector to
       * pick a heading that's provably against it. Also pushes the pair to HUD state, same as
       * generateMap()'s one-time push, so #windIndicator's rotation stays in sync. */
      qaSetWindDirection?: (x: number, z: number) => void;
      /** LUL-2547: places predator[kind] dx/dz from the player's current position, reset to a
       * plain roaming state. Returns its predators index and placed position, or null if that
       * species didn't spawn this seed. */
      qaStagePredatorNearPlayer?: (kind: 'wolf' | 'bear' | 'lion', dx: number, dz: number) => { idx: number; x: number; z: number } | null;
      /** LUL-2351: effective scent lifetime for the run's current Quiet Step tier --
       * lets a test assert the tier's effect without waiting out real decay. */
      qaProbeScentLifetime?: () => number;
      /** LUL-2351: throwablesReserve + heldThrowable + the purchase-cue fire count, so
       * a test can assert Pocket Stones granted +2 throws and a purchase played its
       * audio cue, without decoding actual WebAudio output. */
      qaProbeEmbersPurchase?: () => { throwablesReserve: number; heldThrowable: boolean; purchaseCueCount: number };
      /** LUL-3003: the accumulated purchases_made array for the CURRENT run (id/tier/cost,
       * matches lib/analytics.ts's PurchaseRecord), plus embers.tiers as it stands right now --
       * lets a test assert a purchase() call landed in the accumulator without waiting for a
       * win/loss track() call to read it. */
      qaProbePurchasesMade?: () => { purchasesMade: { id: string; tier: number; cost: number }[]; tiers: Record<string, number> };
      /** LUL-2331: places the player 2 units off the Stone Marker's live position -- mirrors
       * qaTeleportNearThrowable, works regardless of where the landmark actually sits (the
       * micro QA world leaves LANDMARKS untouched). Returns the marker's position. */
      qaTeleportNearStoneMarker?: () => { x: number; z: number };
      /** LUL-4894: places the player 2 units off ROOSTS[i]'s live position on the +z side,
       * yaw untouched -- with the default yaw=0 facing (-z), an immediate throw lands 16u
       * from the player, straight at the roost, inside its 20u radius. Mirrors
       * qaTeleportNearStoneMarker, since the micro QA world leaves ROOSTS untouched. Omit
       * `i` to target whichever roost is nearest the player's current position. Returns
       * null if `i` doesn't exist. */
      qaTeleportNearRoost?: (i?: number) => { i: number; x: number; z: number } | null;
      /** LUL-4894: raw roost burst/cooldown state off the existing arrays -- lets a test
       * assert a throw flushed roost `i` (burstActive flips true, then cooldown > 0) and
       * that a second throw within the cooldown window does not re-flush it. */
      qaProbeRoostState?: (i: number) => { cooldown: number; burstActive: boolean };
      /** LUL-2331: raw veil/charm state, mirrors qaProbeMission's shape. `releaseCueCount` is
       * the mist-charm activation cue's fire count, so a test can assert it fired without
       * decoding actual WebAudio output. */
      qaProbeVeil?: () => { charge: number; locked: boolean; reserve: boolean; releaseCueCount: number };
      /** Read-only: veil-overload countdown, per-round use flag (LUL-4663 -- was per-carry-leg), and denied-cue count. */
      qaProbeVeilOverload?: () => { chargeT: number; usedThisRound: boolean; deniedCueCount: number };
      /** LUL-4528: read-only rock-climb state, mirrors qaProbeVeilOverload's shape. Includes
       * all three cues' fire counts so a test can assert e.g. rockClimbEndCue fired exactly
       * once on countdown expiry, without decoding WebAudio output. */
      qaProbeRockClimb?: () => {
        mountedOnRock: boolean; rockClimbT: number;
        startCueCount: number; endCueCount: number; deniedCueCount: number;
      };
      /** LUL-5005: read-only chapel-sanctuary state, mirrors qaProbeRockClimb's shape.
       * veilReserve itself is read via qaProbeVeil() -- not duplicated here, a test reads
       * both hooks together to confirm the grant came from this feature specifically. */
      qaProbeChapelSanctuary?: () => {
        chapelSanctuaryActive: boolean; chapelSanctuaryChargeT: number; chapelSanctuaryUsedThisRun: boolean;
        promptVisible: boolean; startCueCount: number; deniedCueCount: number; earlyExitCueCount: number;
      };
      /** LUL-5005: places the player 2 units off the chapel steeple's live position -- mirrors
       * qaTeleportNearStoneMarker exactly (the micro QA world leaves LANDMARKS untouched). */
      qaTeleportNearChapel?: () => { x: number; z: number };
      /** LUL-2123: teleports just outside the active mission target's
       * interactRadius so #missionPanel, the mission prompt and the objective
       * are all on screen together. Returns the target, or null if no mission
       * is active. */
      qaTeleportNearMission?: () => { kind: 'deepwater' | 'oakHollow'; x: number; z: number; status: 'active' | 'complete' | 'expired' } | null;
      /** LUL-2884: sibling of qaTeleportNearMission, but places the player
       * already inside the mission target's interactRadius -- no wall-clock
       * movement needed to close the gap. Returns the target, or null if no
       * mission is active. */
      qaTeleportAtMissionTarget?: () => { kind: 'deepwater' | 'oakHollow'; x: number; z: number; status: 'active' | 'complete' | 'expired' } | null;
      /** LUL-2187/LUL-2209: raw mission state without moving the player -- same
       * fields qaTeleportNearMission returns as a side effect, for a test that
       * only needs to read, not teleport. */
      qaProbeMission?: () => { kind: 'deepwater' | 'oakHollow'; status: 'active' | 'complete' | 'expired'; x: number; z: number } | null;
      /** LUL-4958: directly sets the fog-tide cycle accumulator for deterministic e2e staging.
       * See engine/forest-engine.js's qaSetFogTideClock for the full rationale. */
      qaSetFogTideClock?: (seconds: number) => void;
      /** LUL-3010: shrinks the current mission's own timeLimitSeconds so the real per-tick
       * checkMissionExpiry() trips on the next frame. No-op (null) if the mission has no
       * timer (near variant / already resolved). */
      qaShrinkMissionTimer?: (seconds: number) => { kind: 'deepwater' | 'oakHollow'; timeLimitSeconds: number } | null;
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
      /** LUL-2230/LUL-2307: clears the persisted "seen" flag and in-memory gate for
       * the 'scent' hint only, so a single boot can prove the caption is
       * first-time-only twice in the same test. Thin alias over the generic hint
       * registry -- prefer qaResetHints() for new tests. */
      qaResetScentCaption?: () => void;
      /** LUL-2307: the active first-encounter hint's key (null if none) plus the
       * full seen-map by key, so a test can assert both "this hint showed" and "no
       * other hint has been marked seen yet" without racing the 8s/dismiss timer. */
      qaProbeHints?: () => { activeKey: string | null; seen: Record<string, boolean> };
      /** LUL-2307: clears every hint's persisted "seen" flag and the in-memory
       * gate (all keys, not just 'scent') -- the same resetHints() SettingsPanel's
       * "Reset hints" button calls in real play. */
      qaResetHints?: () => void;
      /** LUL-2547: exposes the live chronicle buffer (normally only handed to React at
       * win/death) so a test can assert an event was logged without ending the run. */
      qaGetChronicle?: () => { t: number; code: string; args: Record<string, unknown> | null }[];
      /** LUL-2328: builds a minimal, exact scene -- no rng, no full
       * generateMap() -- for tests that don't need the real procedural
       * forest. Clears and replaces treeData/coverData and every
       * predator's placement; landmarkData/throwableData/mission and the
       * player's position are left untouched. `predators` matches the fixed
       * 3-per-species pool by `kind` in array order (a 4th of the same kind
       * is dropped); every unmatched predator is parked inert. Cover `kind`
       * must be one of 'log'|'rock'|'bramble' -- an unrecognised kind
       * is dropped, not an error. Works with `?qaWorld=micro` and
       * `?qaNoRender=1` (both boot-time URL params, not hooks -- see
       * docs/specs/lul-2328-qa-world-micro-hooks.md). Returns the counts
       * actually placed. */
      qaBuildScene?: (scene: {
        trees?: { x: number; z: number; s?: number }[];
        props?: { kind: 'log' | 'rock' | 'bramble'; x: number; z: number; ry?: number }[];
        predators?: { kind: 'wolf' | 'bear' | 'lion'; x: number; z: number; state?: string; variant?: 'beaconHunter' }[];
        child?: { x: number; z: number };
        home?: { x: number; z: number };
      }) => { trees: number; props: number; predators: number };
      /** LUL-2328: renderer.info.memory (geometry/texture object counts,
       * always available) plus performance.memory (Chrome-only -- null on
       * engines that don't implement it, e.g. Firefox/Safari). Built for
       * LUL-2324's memory-budget assertions (micro world < 400MB, full
       * QA_PINNED_SEED map < 1.5GB JS heap + GPU buffers) -- `heap` is the
       * number that budget actually checks; `renderer` is a secondary,
       * cross-engine-safe signal. */
      qaProbeMemory?: () => {
        heap: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } | null;
        renderer: { geometries: number; textures: number };
      };
      /** LUL-2225: teleports the player to an arbitrary world point --
       * generic version of qaTeleportNearBaby/qaTeleportHome, for staging a
       * position that isn't a fixed named landmark. */
      qaTeleportTo?: (x: number, z: number) => void;
      /** LUL-2336: force-sets chargeVisible/objectiveVisible/coverPromptVisible/
       * heldThrowable/statusVisible all true on the real EngineHudState via
       * pushState() (not fake DOM), so a spec can assert none of #actionSlot's
       * five rows' bounding boxes intersect with real content in every row at
       * once -- no real playthrough state has more than two of these true
       * simultaneously. Call qaSetFixedStep() first so the next real
       * stepFrame() tick doesn't immediately recompute them back. */
      qaForceAllActionRows?: () => void;
    };
  }
}
