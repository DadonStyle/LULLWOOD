// Ported from the forest.html prototype (M1). LUL-17 (M2a) gave it a real
// init()/dispose() lifecycle so it can survive React StrictMode's double-invoked
// effects: everything that was module-scope state now lives inside init()'s
// closure, every addEventListener/setTimeout is tracked via on()/later() so
// dispose() can undo it, and dispose() walks the scene graph to release Three
// resources (geometries, materials, textures) plus the renderer/AudioContext.
// LUL-28 (M2b) made it a real ES module: it `import`s three directly and is
// bundled by Turbopack, instead of being served from /public as a raw <script>
// that read a `window.THREE` global GameCanvas had to install first. The IIFE
// wrapper is gone because module scope already provides one, and modules are
// always strict. The body below is otherwise unchanged -- deliberately not
// reindented, so this stays a reviewable diff and not a 1,200-line reformat.
import * as THREE from 'three';
import { track } from '@/lib/analytics';
import { jumpOffset, JUMP_DURATION } from '@/lib/game/jump';
import {
  freshRunState,
  isPlaying,
  canPickUp,
  beginPickup,
  completePickup,
  canArriveHome,
  arriveHome as outcomeArriveHome,
  triggerDeath as outcomeTriggerDeath,
  canGrabThrowable,
  canThrowThrowable,
  canRegenMap,
  canSetDown,
  beginSetDown,
} from '@/lib/game/outcome';
import {
  shouldTriggerCharge,
  startCharge,
  stepCharge,
  chargeSpeed,
  CHARGE_TRIGGER_MIN,
  CHARGE_TRIGGER_MAX,
} from '@/lib/game/charge';
import { startSightLock, stepSightLock, SIGHT_TELL_TIME } from '@/lib/game/sightLock';
import {
  clampDt,
  isScentDetected,
  isScentExpired,
  isScentPastPruneCutoff,
  scentDriftDistance,
  driftedScentPosition,
  SCENT_DEPOSIT_INTERVAL,
  SCENT_LIFETIME,
  SCENT_RADIUS_WALK,
  SCENT_RADIUS_RUN,
  SCENT_TRACK_TIME,
  isMovingAgainstWind,
  WIND_AGAINST_RADIUS_MULTIPLIER,
} from '@/lib/game/scent';
import {
  coverKindBlocksMovement,
  distanceToCoverEdge,
  overlapsTreeCanopy,
  overlapsTreeTrunk,
  overlapsExistingCover,
  thinProps,
  canopyRadiusAtEye,
  rollCoverPropShape,
  pickAvoidDirection,
  slideVelocity,
  HIDE_KINDS,
  WALKABLE_KINDS,
  CELL,
  gridKey as key,
  neighbourhood,
  blockedR as geoBlockedR,
  blocked as geoBlocked,
  blockedForPredator as geoBlockedForPredator,
  hasLOS as geoHasLOS,
  findHideSpot as geoFindHideSpot,
  effectiveDetect as geoEffectiveDetect,
  canSee as geoCanSee,
  COVER_URGENT_RANGE,
  COVER_PROBE_HZ,
} from '@/lib/game/cover';
import { wrapCoord, wrapDelta } from '@/lib/game/wrap';
import { isNoiseHeard, NOISE_RADIUS_WALK, NOISE_RADIUS_RUN, checkThrowableNoise, THROWABLE_NOISE_RADIUS, CRY_NOISE_RADIUS, CARRIED_NOISE_FLOOR } from '@/lib/game/noise';
import { selectPackLeaderIndex, flankTarget, FLANK_RECOMPUTE, FLANK_ARRIVE_R, FLANK_SPEED_MUL } from '@/lib/game/pack';
import { bearingOf, bearingPan, callVolumeMul } from '@/lib/game/bearing';
import {
  biomeAt,
  bogSpeedMultiplier,
  bogNoiseMultiplier,
  bogMaskLevel,
  pickHardBabyPosition,
  clearOfLandmarks,
  bogKeepClear,
  routeCrossesBog,
  BOG_CENTER,
  BOG_INNER_RADIUS,
  BOG_OUTER_RADIUS,
} from '@/lib/game/bog';
import {
  backOffPoint,
  canCatchInChase,
  CATCH_MARGIN,
  isCaught,
  isSniffImmune,
  LKP_MAX_SWEEPS,
  pickRoamWaypoint,
  predatorSeparationPush,
  rollSniffs,
  shouldGiveUpChase,
  shouldRevertInvestigateToChase,
  SNIFF_IMMUNITY_TIME,
  SNIFF_STATUS_RANGE,
  sniffStandoffPoint,
  stepApproach,
  stepFlankHold,
  stepSniffLoop,
  tickTimers,
} from '@/lib/game/predator';
import { stepVeilCharge, veilDetectMul, veilFogDensity, VEIL_PROMPT_MIN_CHARGE } from '@/lib/game/veil';
import { CAVE_IMMUNITY_TIME, isCaveImmune } from '@/lib/game/cave';
import { stepStamina, sprintSpeedMul, STAMINA_SPRINT_MUL } from '@/lib/game/stamina';
import { carryGlowIntensity, carryHaloOpacity, idleGlowIntensity, idleHaloOpacity } from '@/lib/game/childGlow';
import {
  freshEmbersState,
  computeWinPayout,
  computeDeathPayout,
  applyPayout,
  purchaseDeeperLungs as economyPurchaseDeeperLungs,
  veilMaxHoldForTier,
  DEEPER_LUNGS_MAX_TIER,
  MISSION_DEEPWATER_REWARD,
  DEEPWATER_RETRIEVAL_BONUS,
  DEEPWATER_SPEEDRUN_BONUS,
  computeDepth,
  computeSurvival,
  applySpend,
  VEIL_CHARM_PRICE,
} from '@/lib/game/economy';
// LUL-1258: M2 Deepwater. Pure mission-state helpers, no Three.js -- mirrors
// how lib/game/outcome.ts's transitions are imported above.
import {
  pickMission,
  distToMissionTarget,
  canCompleteMission,
  completeMission,
  canCompleteRetrieval,
  completeRetrieval,
  secondaryComplete,
  RETRIEVAL_ITEM,
} from '@/lib/game/mission';
import {
  inLakeWater,
  inLakeClearance,
  lakeSpeedMultiplier,
  pushOutOfLakeClearance,
  keepWaypointOffLake,
} from '@/lib/game/lake';
import {
  FOG_TIDE_CONFIG,
  FOG_TIDE_RAMP,
  FOG_TIDE_AUDIO_RAMP,
  fogTidePhase,
  fogTideBuildAmount,
  fogTideActiveTarget,
  fogTideDetectMul,
  fogTideGlowMul,
  fogTideGlowRangeMul,
  fogTideFogBoost,
  fogTideDroneGainMul,
  fogTideWindGainMul,
  fogTideAmountAt,
  fogTideBuildAt,
} from '@/lib/game/fogTide';
import {
  timeOfDayFromHour,
  TIME_OF_DAY_VISUALS,
  TIME_OF_DAY_AUDIO,
} from '@/lib/game/timeOfDay';
import { timeOfRunDetectMul } from '@/lib/game/dayNight';
import { nearestLandmarkName } from '@/lib/game/chronicle';
import {
  CONFIG, LANDMARKS, LEGACY_LIGHT_SCALE, LIGHT_NORMAL, LIGHT_DIMMED, VEIL_RAMP,
  MIST_VEIL_FOG, VIGNETTE_NORMAL, VIGNETTE_DIMMED, CANOPY_R, CONE1_HEIGHT, CONE1_Y,
  STAR, LW, DUST, BW, BSP, DUST_WIND_SPEED, WARM,
  BABY_LIGHT_DISTANCE, PSPEC as PSPEC_BASE, CHASE_GAP, DIFFICULTY_PRESETS,
  CAVE, CHARGE_COOLDOWN, SENS, SCALE, PLAYER_FOV_COS, CUT_END, LANDMARK_BEACONS,
  VEIL_CHARM_INTERACT_RADIUS, WOLF_BOG_MASK_STRENGTH, ROOSTS, ROOST_COOLDOWN,
  FORCE_HUNT_LOCK, PROP_MIN_SPACING, PROP_CHUNK_CAP, applyQaWorldMicroPreset,
} from '@/engine/tuning';

// LUL-975: r152 turned THREE.ColorManagement on by default, which now decodes every
// hex/CSS light and material color as sRGB before lighting math runs. r128 never did
// that decode -- colors were used as authored, directly as linear values -- so every
// light and material color in this file was hand-tuned against the old (no-decode)
// behavior. Turning it back off is the most faithful way to keep those colors reading
// the same, rather than re-deriving a decode-compensation constant per color. This is
// independent of the light *intensity* scale below (LEGACY_LIGHT_SCALE), which exists
// because r155/r163 additionally removed useLegacyLights outright, with no opt-out.
THREE.ColorManagement.enabled = false;

let activeDispose = null;

function init(onStateChange, inputMode) {
  if (activeDispose) return null;   // already running; init() is idempotent
  const emitState = typeof onStateChange === 'function' ? onStateChange : function(){};
  // LUL-276: 'desktop' | 'mobile', set once at init and never re-derived.
  // Desktop binds pointer-lock/mouse listeners and mobile's touch setters
  // become no-ops; mobile never binds the mouse listeners and the touchLook
  // tick block never runs. See wiki game/lul274-input-mode-separation --
  // this is the fix for the mouse and stick both writing player.yaw/pitch
  // in the same frame.
  const mode = inputMode === 'mobile' ? 'mobile' : 'desktop';

  const cleanupFns = [];
  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    cleanupFns.push(function () { target.removeEventListener(type, handler, opts); });
  }
  const timers = [];
  function later(fn, ms) {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

  // LUL-2328: qaWorld/qaNoRender are read once, here, before anything below
  // reads CONFIG.mapSize/CONFIG.trees/CONFIG.coverProps/CONFIG.bogTrees/
  // CONFIG.bogReeds for the first time this page life -- the very next
  // statement (`half = CONFIG.mapSize / 2`) is the earliest such read. See
  // applyQaWorldMicroPreset()'s comment (engine/tuning.js) for why that
  // ordering is load-bearing. Absent by default, so both do nothing for real
  // players; neither requires `?qaHooks=1` -- they change what generateMap()
  // builds, not what's exposed on window.ForestEngine.
  const qaParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  if(qaParams && qaParams.get('qaWorld') === 'micro') applyQaWorldMicroPreset();
  // Skips updateStreamedChunks()/layoutThrowableMeshes() inside generateMap()
  // below -- LUL-2249: streaming replaced the old direct layoutTreeChunks()/
  // layoutCoverMeshes() instantiate-everything calls with a ring-limited
  // ensure/drop pass, and qaNoRender now skips that pass entirely (no chunk
  // is ever "live", so no InstancedMesh -- see qaProbeTreeChunks().totalInstances
  // === 0 under this flag, e2e/qa-world-micro.spec.ts) -- while still running
  // generateMap()'s full simulation (treeData/coverData/grid/buildGrid()) and
  // keeping the renderer/HUD alive. See generateMap()'s own call sites.
  const qaNoRender = !!(qaParams && qaParams.has('qaNoRender'));

// ---- Knobs ---------------------------------------------------------------
const half = CONFIG.mapSize / 2;
const margin = 4;
// LUL-1483: the world is a square again -- x and z both bound to
// [-half, half]. `zMax` is kept, equal to `half`, purely so every existing
// `[-half+n, zMax-n]`-shaped clamp elsewhere in this file (backOffPoint,
// roam/reroute waypoints, the predator/player position clamps in
// updatePredators()/tick()) keeps compiling and behaving correctly without a
// site-by-site rename -- it is not a second world boundary, just an alias.
// inBog()/isInBog() are gone; biomeAt(x, z) (lib/game/bog.ts) replaces both.
const zMax = half;
// LUL-1485: collapses every distance/LOS/detection call below to today's
// exact behavior (Infinity is a no-op by construction, see lib/game/wrap.ts)
// while the flag is off. Hard-bound clamp sites (world wall, waypoints,
// backoff/flank retreat points) branch on Number.isFinite(WRAP_SPAN)
// explicitly instead, since clamp-with-margin and wrap are different
// formulas, not the same one parameterized by span.
const WRAP_SPAN = CONFIG.wrapEnabled ? CONFIG.mapSize : Infinity;
// LUL-25: six fixed navigational landmarks (two added by LUL-1782), "visible
// over the fog line" so
// the player can orient without the minimap (which stays scaled to the
// original 240x240 forest -- see w2m()/drawMinimap() below, both untouched).
// Fixed constants, not an rng draw, same treatment as CONFIG.lake/CONFIG.home
// -- a place you can actually learn, not one more random prop. Two sit in the
// forest, two mark the bog: the split oak at its near edge (a gateway you see
// coming) and the drowned car deep in it (how far you've come).
// `cr` is the movement-collision radius (LUL-374) -- deliberately much
// smaller than `clear` (which only keeps trees/cover from generating too
// close to the landmark's nudge target). Every `cr` here is comfortably
// under its row's `clear`, so clearLandmarkSpot()'s existing guarantee --
// nothing else this seed placed sits within `clear` of the settled position
// -- also guarantees nothing overlaps the tighter `cr` collider.

// ---- Seeded RNG (so a given map is a real, repeatable place) --------------
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
// LUL-83: every player used to get the byte-identical forest (CONFIG.seed was
// the only seed ever used). The FIRST map now draws a fresh seed per page
// load so a second playthrough isn't the nine spawn points you've already
// learned; `?seed=` pins an exact layout for QA/manual repro (e.g. `?seed=20260718`
// reproduces today's fixed layout byte-for-byte). Only the seed *source*
// changes -- generateMap() below still draws from the same mulberry32 stream
// either way, so LUL-25's append-order determinism note is untouched.
function resolveInitialSeed(){
  const pinned = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('seed')
    : null;
  const n = pinned === null ? NaN : Number(pinned);
  if(Number.isFinite(n)) return n >>> 0;
  return (Math.random() * 0x100000000) >>> 0;
}
let rng = mulberry32(CONFIG.seed);
// LUL-153: the seed actually in play -- generateMap() below is called with a
// fresh random seed on every restart()/regenMap(), so CONFIG.seed alone only
// describes the very first map. Analytics events that carry `seed` read this.
let currentSeed = CONFIG.seed;
const rnd = (a=1,b) => b===undefined ? rng()*a : a + rng()*(b-a);
const clamp = (v,a,b) => v<a ? a : v>b ? b : v;

// LUL-1644: time-of-day is a per-session snapshot of the player's real
// wall-clock hour at load, not a live clock during play -- see
// docs/specs/time-of-day.md for why. Consumed by the sky/lighting block
// below and by startAudio().
const timeOfDay = timeOfDayFromHour(new Date().getHours());
const TOD_VISUAL = TIME_OF_DAY_VISUALS[timeOfDay];
const TOD_AUDIO = TIME_OF_DAY_AUDIO[timeOfDay];

// ---- Scene / camera / renderer -------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.bg);
scene.fog = new THREE.FogExp2(TOD_VISUAL.fogColor, CONFIG.fog);

// LUL-69: a phone screen is usually narrower (portrait) or shorter (landscape)
// than the 1280x720-ish desktop window this FOV was tuned for -- Three's
// PerspectiveCamera `fov` is the *vertical* field of view, so horizontal
// coverage (what a narrow/short aspect actually crops) is
// `2*atan(tan(fov/2)*aspect)`. Widening the vertical FOV on mobile keeps more
// of the scene visible on both aspect ratios without touching PLAYER_FOV_COS
// below (a gameplay detection cone, unrelated to render FOV).
const CAMERA_FOV = mode === 'mobile' ? 85 : 70;
const camera = new THREE.PerspectiveCamera(CAMERA_FOV, innerWidth/innerHeight, 0.1, 400);
camera.rotation.order = 'YXZ';
camera.position.set(0, CONFIG.eye, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
// LUL-160: the canvas used to rely on being the only content in <body>'s
// normal flow to sit at the top of the page -- true back when it was the
// sole thing appendChild ever put there. LUL-46's SSR content shell
// (app/page.tsx's <main class="about">) added real in-flow height *before*
// this element in document order, which pushed the statically-positioned
// canvas down the page by however tall that shell is; html/body's
// overflow:hidden then just hid the scrollbar that would have revealed it,
// not the mispositioning itself. Pin it to the viewport like every other
// overlay element already is (#gate, #vignette, ...) so its position no
// longer depends on sibling content at all.
// LUL-211: z-index was -1, which places the canvas BEHIND normal-flow
// elements (body, main.about) in the CSS stacking order -- step 2 (negative
// z-index) is below step 3 (normal-flow boxes), so the body's background
// (#0a0e15) painted over the canvas, making the 3D scene invisible. Using
// z-index 0 puts the canvas in step 6 (positioned, z-index 0/auto), above
// the body background and the main.about SSR shell, while remaining below
// all the game's fixed overlays (z-index 10+).
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.inset = '0';
renderer.domElement.style.zIndex = '0';
document.body.appendChild(renderer.domElement);

// LUL-975: r155 dropped the `Math.PI` "artist-friendly" scaling factor that used to
// sit between a light's `intensity` and the render output (useLegacyLights, gone
// entirely as of r163 -- no opt-out). Every intensity below was hand-tuned against
// that old scale, so every one is multiplied by LEGACY_LIGHT_SCALE to read the same
// as it did on r128. Confirmed by direct before/after screenshot comparison, not
// just the documented factor -- see wiki systems/three-r185-upgrade.
const HEMI_BASE_INTENSITY = TOD_VISUAL.hemisphereIntensity * LEGACY_LIGHT_SCALE;
const hemiLight = new THREE.HemisphereLight(TOD_VISUAL.hemisphereSky, TOD_VISUAL.hemisphereGround, HEMI_BASE_INTENSITY);
scene.add(hemiLight);
const moon = new THREE.DirectionalLight(TOD_VISUAL.sunMoonColor, TOD_VISUAL.sunMoonIntensity * LEGACY_LIGHT_SCALE); moon.position.set(-6, 16, -4); scene.add(moon);
const rim = new THREE.DirectionalLight(TOD_VISUAL.rimColor, TOD_VISUAL.rimIntensity * LEGACY_LIGHT_SCALE); rim.position.set(4, 5, 9); scene.add(rim);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800),
  new THREE.MeshStandardMaterial({ color: CONFIG.ground, roughness: 1, metalness: 0 }));
ground.rotation.x = -Math.PI/2; scene.add(ground);

// ---- Sky: gradient backdrop, stars, sun/moon disc (per TOD_VISUAL); soft fill on the player ---
(function(){
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0.0, TOD_VISUAL.skyTop); grd.addColorStop(0.55, TOD_VISUAL.skyMid); grd.addColorStop(1.0, TOD_VISUAL.skyBottom);
  g.fillStyle = grd; g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex;
})();
const starArr = new Float32Array(STAR*3);
for(let i=0;i<STAR;i++){ const th = Math.random()*Math.PI*2, y = Math.random()*0.9 + 0.05, s = Math.sqrt(1-y*y), r = 300;
  starArr[i*3] = r*s*Math.cos(th); starArr[i*3+1] = r*y; starArr[i*3+2] = r*s*Math.sin(th); }
const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starArr, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.15,
  sizeAttenuation: false, transparent: true, opacity: TOD_VISUAL.starOpacity, depthWrite: false, fog: false }));
scene.add(stars);
const moonDir = new THREE.Vector3(-6, 16, -4).normalize();
const moonGroup = new THREE.Group();
moonGroup.add(
  new THREE.Mesh(new THREE.CircleGeometry(34, 32), new THREE.MeshBasicMaterial({ color: TOD_VISUAL.sunMoonHaloColor, transparent: true, opacity: TOD_VISUAL.sunMoonHaloOpacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })),
  new THREE.Mesh(new THREE.CircleGeometry(15, 40), new THREE.MeshBasicMaterial({ color: TOD_VISUAL.sunMoonColor, fog: false }))
);
scene.add(moonGroup);
const playerLight = new THREE.PointLight(0x33456a, 0.7 * LEGACY_LIGHT_SCALE, 20, 2); camera.add(playerLight);
// LUL-40/LUL-382: hold KeyF for the mist veil. The founder rejected the original
// LUL-40 dim-only version as too small a lever (decisions/0012-feature-impact-bar) --
// the light cut is kept (still a smaller lit pool) but it's now one piece of a bigger,
// world-visible state: mist ramps to near-opaque (MIST_VEIL_FOG below) and predator
// sight range drops hard while it's up (veilDetectMul(), lib/game/veil.ts, used from
// effectiveDetect()). Binary hold, not a slider, for the same reason as before -- an
// every-second decision, not a set-once knob. `lightDimmed` now names "is the veil
// actually active" (it can be held down and denied by the charge meter -- see
// stepVeilCharge(), lib/game/veil.ts -- so it's not just "is F held").
let lightDimmed = false;
// LUL-382: charge/lock state machine and the two multipliers it gates live in
// lib/game/veil.ts (pure, unit tested -- see wiki systems/unit-testing-standard).
// The engine only owns the rendering-side bits: how fast the mist visibly ramps
// (VEIL_RAMP), how thick it gets at full ramp (MIST_VEIL_FOG), and the mutable
// per-frame state itself.
let veilCharge = 1, veilLocked = false, veilAmount = 0, staminaCharge = 1, staminaLowCuePlayed = false, veilReserve = false, playerBogMask = 0;
// LUL-1089: throttled cover probe (COVER_PROBE_HZ). lastHideSpot holds the
// last result between probes; coverProbeAccum counts elapsed seconds.
let lastHideSpot = null, coverProbeAccum = 0;
let fogBase = CONFIG.fog;         // last player-set "Mist" slider value; veil ramps up from this, not a hardcoded floor

// LUL-27: Fog Tide, the first recurring world event (lib/game/eventScheduler.ts
// + lib/game/fogTide.ts own the pure phase/multiplier math; the engine only
// owns the mutable per-frame state and how the effect actually renders/plays,
// same split as the veil above). `fogTideClock` only advances while `playing`
// (see tick()) -- that's the whole "pausable" requirement, no separate flag.
let fogTideClock = 0, fogTideAmount = 0, fogTideBuild = 0, fogTideActive = false;
// LUL-1709: live time-of-run pacing clock, 0 (dawn) -> 1 (full night) over
// TIME_OF_RUN_DURATION_S of actual play. Same pausable-accumulator pattern as
// fogTideClock immediately above -- only advances while `playing` (see tick()),
// so the pause menu freezes the pacing ramp exactly like it freezes everything
// else. Distinct from LUL-1644's TOD_VISUAL/TOD_AUDIO (a static snapshot of the
// player's real wall-clock hour, computed once at load) -- this is a live value
// that changes every frame during a run and the two compose, not replace.
const TIME_OF_RUN_DURATION_S = 120;
const TIME_OF_RUN_FOG_DELTA = 0.10 - CONFIG.fog;   // additive fog-density term at full night
let runElapsed = 0, timeOfRun = 0;
// LUL-313: LUL-292's browser QA pass (pixel diff, methodology in the ticket)
// found the point-light radius/intensity cut above unreadable against this
// scene -- ambient/moonlight/fog dominate perceived brightness, so a smaller
// PointLight.distance never produces a visible edge. Diagnosis on the ticket:
// cutting distance further won't fix that on its own, because the thing
// that's swamping it (ambient) is untouched either way. Cue is layered on
// top instead, on the existing #vignette DOM overlay (GameCanvas.tsx) rather
// than in the post-processing shader below, so it applies identically
// whether or not WebGL post-processing initialized (usePost).
// dimAmount eases 0->1 the same way eyeH eases above, so the pool visibly
// contracts over ~0.3s instead of popping -- reads as "a smaller lit area
// with dark past its rim" per the ticket's own framing, not just darker.
let dimAmount = 0;
const vignetteEl = document.getElementById('vignette');
function applyVignette(amt){
  if (!vignetteEl) return;
  const inner = VIGNETTE_NORMAL.inner + (VIGNETTE_DIMMED.inner - VIGNETTE_NORMAL.inner) * amt;
  const outerAlpha = VIGNETTE_NORMAL.outerAlpha + (VIGNETTE_DIMMED.outerAlpha - VIGNETTE_NORMAL.outerAlpha) * amt;
  vignetteEl.style.background = `radial-gradient(120% 90% at 50% 44%, transparent ${inner}%, rgba(0,0,0,${outerAlpha}) 100%)`;
}

// ---- Trees: one instanced "master tree", positions fixed per map ---------
const trunkGeo = new THREE.CylinderGeometry(0.12, 0.20, 1.6, 6);   trunkGeo.translate(0, 0.8, 0);
const cone1Geo = new THREE.ConeGeometry(CANOPY_R, CONE1_HEIGHT, 7); cone1Geo.translate(0, CONE1_Y, 0);
const cone2Geo = new THREE.ConeGeometry(0.78, 1.9, 7);             cone2Geo.translate(0, 3.35, 0);
// LUL-267: cone1's radius at the player's own eye height, not its (much wider)
// base -- a cone tapers, so the true cross-section the camera can hit is
// narrower than the base almost everywhere along its height. Eye height is
// fixed at CONFIG.eye while moving -- the only lower eye height (hiding,
// 1.05) always exits hiding on the same frame movement resumes (see
// exitHide() call site, `hidden && moveKey`), so no in-motion frame needs a
// wider radius than this.
//
// Trees are instance-scaled uniformly around the origin (dummy.scale.setScalar(s)
// in generateMap()), so cone1's baked-in translate scales too: a *larger* tree's
// foliage base sits proportionally *higher* off the ground, not just wider. So
// CONFIG.eye intersects a different relative slice of the cone depending on s --
// this is why the visual bug gets worse on large trees (LUL-266's own finding):
// at large s the (risen) base is close to eye height, so the true cross-section
// there is close to the full base radius; at small s, eye height sits close to
// the (also risen-in-scale, but tiny) apex, where the cross-section is nearly 0.
// A first pass used a single scale-independent coefficient (fixed fraction of
// CANOPY_R*s) and was measured live to be wrong in both directions: too wide for
// small/mid trees (walled the player in a few units from spawn -- neighbouring
// canopies' widened circles started overlapping previously-walkable gaps, the
// same shape of regression LUL-119 already burned once, just against the player
// instead of a predator) and, since it was still only ~46% of the base radius,
// too narrow to fully clear large trees. canopyRadiusAtEye() derives the exact
// per-tree value from the cone's actual (scaled) geometry instead of guessing
// one coefficient for every tree size.
const CONE1_APEX_Y = CONE1_Y + CONE1_HEIGHT/2;   // local apex height, before per-tree scale
// LUL-425: canopyRadiusAtEye() itself now lives in lib/game/cover.ts (pure,
// unit-tested) -- this stays the single place that packages the Three.js
// geometry constants it needs, so cover.ts can never silently drift from the
// mesh those constants actually describe.
const CANOPY_GEO = { canopyR: CANOPY_R, cone1Height: CONE1_HEIGHT, apexY: CONE1_APEX_Y };
const trunkMat   = new THREE.MeshStandardMaterial({ color: CONFIG.trunk,   roughness: 1 });
const foliageMat = new THREE.MeshStandardMaterial({ color: CONFIG.foliage, roughness: 1 });

// ---- Bog tree cover (LUL-25) -----------------------------------------------
// Own data array, much smaller than CONFIG.trees -- "thinner tree cover" per
// the ticket. A separate pool, not a bigger CONFIG.trees, so the original
// forest loop's rng draw count (and every draw after it) is untouched -- see
// generateBogTrees() below. LUL-2249: no longer a single fixed-capacity
// InstancedMesh trio -- chunked the same way as the forest trees (see
// ensureBogChunk()/dropBogChunk() below), reusing this same shared
// trunkGeo/cone1Geo/cone2Geo/trunkMat/foliageMat.

// ---- Cover props (LUL-43): brambles, fallen logs, rock shelves -----------
// Purely visual + line-of-sight-blocking (see canSee()/hasLOS() below) --
// deliberately NOT movement colliders. LUL-1643 made rock/reed real predator
// colliders (see predatorBlocked() below and blockedForPredator() in
// lib/game/cover.ts); log/bramble stay walkable for predators, matching the
// player's own exemption.
const THROWABLE_COUNT = 90;             // ~1 stone found per run at an 8u acquisition
                                        // radius; see wiki game/economy/throwable-price
const THROWABLE_PICKUP_RADIUS = 3;      // matches canPickUp's baby radius scale
const THROWABLE_THROW_DISTANCE = 18;    // landing point = player pos + facing * this
const THROWABLE_INVESTIGATE_TIME = [3, 5]; // rnd() range, seconds
const logGeo = new THREE.BoxGeometry(1, 1, 1);
const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const brambleGeo = new THREE.IcosahedronGeometry(1, 1);
const logMat = new THREE.MeshStandardMaterial({ color: 0x241a10, roughness: 1 });
const rockMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 1 });
const brambleMat = new THREE.MeshStandardMaterial({ color: 0x121a0e, roughness: 1 });
// LUL-25: reed clumps -- tall cover volumes in the bog, same "duck behind it"
// LOS-blocking treatment as rock/bramble (see coverBlockedR/hasLOS below),
// not a HIDE_KINDS entry -- canSee()'s LOS raycast already treats any
// coverData AABB as real sight-cover regardless of hide-stance membership;
// the reeds' actual cost is the louder splash while wading (see bogNoiseMultiplier).
const reedGeo = new THREE.ConeGeometry(0.5, 1, 5);
const reedMat = new THREE.MeshStandardMaterial({ color: 0x2e3b1c, roughness: 1 });
// LUL-2249: was four fixed-capacity (CONFIG.coverProps) InstancedMesh, one per
// kind, instantiated once and fully repainted by layoutCoverMeshes() every
// generateMap() call. Replaced by a per-chunk, per-kind InstancedMesh sized to
// that chunk's own count (ensureCoverChunk()/dropCoverChunk() below) -- this
// map is now just the shared geometry/material lookup every chunk's meshes
// draw from, never disposed.
const COVER_GEO_MAT = {
  log: [logGeo, logMat],
  rock: [rockGeo, rockMat],
  bramble: [brambleGeo, brambleMat],
  reed: [reedGeo, reedMat],
};

// ---- Throwable distractions (LUL-1623) ------------------------------------
// Not coverData/HIDE_KINDS per CTO plan decision 3 -- no LOS block, no
// collision, own spawn list and own instanced mesh.
const throwableGeo = rockGeo; // reuse, scaled down at layout time -- see layoutThrowableMeshes()
const throwableMat = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 1 });
const throwableMesh = new THREE.InstancedMesh(throwableGeo, throwableMat, THROWABLE_COUNT);
throwableMesh.frustumCulled = false;
scene.add(throwableMesh);

// ---- Hiding spots (LUL-212, LUL-2311) -----------------------------------
// Every cover prop still blocks line of sight the same way (see canSee()/
// hasLOS() below -- that math is untouched). The player's deliberate
// `hidden` stance (KeyH / touch Hide button) does not work anywhere you can
// find LOS-blocking geometry. It requires standing at the one dedicated
// hiding-spot kind -- researched against real-world stealth/horror foley
// convention (rustling leaves read as the universal "something is hiding in
// the brush" cue) -- bramble ("bush", leaf rustle). Rocks, logs, and tagged
// trees remain sight-blocking obstacles you can duck behind incidentally,
// exactly as before, but never a place you can formally "hide": no crouch,
// no stillness bonus, no sound. That is the original ticket's whole ask --
// "hiding will only be in specific places" -- narrowed to props that read
// as something a person could actually climb into or behind, not just
// stand near. LUL-2311 later dropped log from that set entirely (founder:
// a fallen log is walkable, thin cover, nothing you're visibly "inside" of
// -- it never made sense as a hiding spot the way a bush does).
// LUL-425: HIDE_KINDS itself now lives in lib/game/cover.ts, alongside
// HIDE_RADIUS (used only inside findHideSpot(), which moved with it).

const dummy = new THREE.Object3D();
const tintCol = new THREE.Color();
let treeData = [];            // {x,z,s,cr,crCanopy}
let bogTreeData = [];          // LUL-25: same shape, thinner cover, bog band only -- own array so
                                // it can't shift how many rng() calls the original tree loop makes
let landmarkData = [];          // LUL-374: {x,z,cr} -- movement-only colliders for the four fixed
                                 // landmark meshes, populated by placeLandmarks() post-nudge. No
                                 // crCanopy (canopyBlockedR() skips entries that lack it) and never
                                 // added to coverData/HIDE_KINDS -- these block movement, not LOS,
                                 // and aren't meant to be hiding spots.
// LUL-1904: cave landmark -- caveSpawned/caveData decided once per round in
// generateMap() (rng-gated, see placeCave()); caveConsumed is the single-use
// gate; caveImmuneT is the live countdown (0 = inactive), decremented in
// tick() alongside the other per-frame timers.
let caveSpawned = false, caveData = null, caveConsumed = false, caveImmuneT = 0;
let grid = new Map();
let coverData = [];            // {x,z,hx,hz,kind} -- LOS-blocking AABBs (tagged trees + new props)
let coverGrid = new Map();     // same CELL keying as `grid`, built from coverData
let throwableData = [];   // {x,z,taken} -- ambient pickup props, own spawn list, no LOS/collision role

function inLake(x,z){ return inLakeClearance(x, z, CONFIG.lake); }
function inSpawn(x,z){ return x*x+z*z < 40; }
// LUL-873: keepWaypointOffLake() extracted to lib/game/lake.ts (pure,
// CONFIG.lake passed in explicitly) -- imported above.
// LUL-425: CELL and key() (now gridKey) live in lib/game/cover.ts, imported
// above -- single source of truth for the bucketing convention every
// grid-querying function in this file and in cover.ts now shares.

function addAllToGrid(arr){
  for(const t of arr){
    // LUL-2225: skip forest trees culled for standing inside the bog patch's
    // dense-core threshold (see the treeData.push() below) -- a culled tree
    // is parked off-screen in layoutTreeChunks() and must not still block
    // movement/LOS via this grid. bogTreeData/landmarkData entries never
    // carry `culled`, so this is a no-op for them.
    if(t.culled) continue;
    const k = key(Math.floor(t.x/CELL), Math.floor(t.z/CELL));
    (grid.get(k) || grid.set(k, []).get(k)).push(t);
  }
}
function buildGrid(){
  grid = new Map();
  addAllToGrid(treeData);
  addAllToGrid(bogTreeData);
  // LUL-374: landmarkData is only populated once placeLandmarks() has run
  // (empty on the first, pre-landmark call this function makes at map-gen
  // time -- see the third call right after placeLandmarks() below).
  addAllToGrid(landmarkData);
}
// LUL-425: blockedR/coverBlockedR/canopyBlockedR/blocked (the tree-circle,
// rotated-cover-AABB, tree-canopy and composite movement-block checks) now
// live in lib/game/cover.ts, unit-tested there -- see the module comment at
// the top of that file's LUL-425 section. These are thin wrappers that just
// inject the engine's own `grid`/`coverGrid` closure state. Predators now
// call predatorBlocked() (grid + cover, no canopy) instead of bare
// blockedR(), for every real movement call site (see predatorBlocked()
// below); blockedR() itself is unchanged and still used directly only where
// a tree/landmark-circle-only check is intentionally wanted (the QA helpers
// that stage against HIDE_KINDS props only). coverBlockedR/canopyBlockedR
// themselves stay in cover.ts
// (not wrapped here individually, only via the composite blocked()) --
// nothing outside blocked() called them directly. LUL-384's walkable-log
// skip (coverKindBlocksMovement(), imported above) is preserved inside
// cover.ts's own coverBlockedR(), so geoBlocked() below still treats 'log'
// as non-blocking, same as release/next did before this extraction.
function blockedR(x,z,pr){ return geoBlockedR(x,z,pr,grid,CELL,WRAP_SPAN); }
// LUL-273: pass the live eyeH (not a fixed CONFIG.eye) so canopyBlockedR()
// recomputes each tree's canopy radius against the player's actual current
// eye height -- fixes the under-protection window right after exiting a
// hide spot while moving, while eyeH is still lerping back up from 1.05.
function blocked(x,z){ return geoBlocked(x,z,grid,coverGrid,CELL,eyeH,CANOPY_GEO,WRAP_SPAN); }
// LUL-1643: predator movement now consults cover the same way blocked() does
// for the player, minus canopyBlockedR (camera-only, LUL-267 -- see
// blockedForPredator()'s own comment in cover.ts for why canopy stays excluded).
function predatorBlocked(x,z,pr){ return geoBlockedForPredator(x,z,pr,grid,coverGrid,CELL,WRAP_SPAN); }

function buildCoverGrid(){
  coverGrid = new Map();
  for(const c of coverData){
    const k = key(Math.floor(c.x/CELL), Math.floor(c.z/CELL));
    (coverGrid.get(k) || coverGrid.set(k, []).get(k)).push(c);
  }
}
// Tag a subset of the trees just placed as cover, then scatter new dedicated
// props. This runs at the END of generateMap(), after every existing rng draw
// (baby, trees, predators) -- so it only ever APPENDS to the seeded stream and
// today's map (tree/baby/predator positions) stays byte-identical.
// LUL-396: cover props only ever checked inLake()/inSpawn()/inBaby() against
// their own center point -- never tree positions -- so a rock/log/bramble
// could spawn overlapping a tree trunk's own movement-collision circle
// (t.cr). Worst case for a HIDE_KINDS prop (bramble/log): an unreachable or
// broken hide spot, since the player's own tree collision (blockedR) would
// keep them from ever standing where findHideSpot() would trigger. Reuses
// the same tree `grid` blockedR() walks (already built by buildGrid() before
// generateCover() runs, see generateMap()) against overlapsTreeTrunk()
// (lib/game/cover.ts), rather than a second parallel implementation of the
// same circle-overlap math.
//
// LUL-384/LUL-491: walkable kinds (currently just 'log') get an extra check
// against the wider canopy radius (overlapsTreeCanopy(), lib/game/cover.ts).
// Trunk-only clearance is fine for solid props, but a log invites the player
// to walk its full span, and canopyBlockedR() blocks unconditionally within
// a tree's canopy circle regardless of what's on the ground -- without this,
// a log could spawn clear of every trunk yet still clip a canopy circle
// somewhere along its length and wedge the player mid-crossing.
//
// LUL-2212: none of the checks above ever compared a new candidate against
// cover props already placed in this same pass -- only against trees. A
// solid prop (rock/reed) could land overlapping a walkable one (log/bramble)
// undetected: blocked() correctly skips the walkable prop's own AABB
// (coverKindBlocksMovement()), but the overlapping solid neighbour's AABB
// still blocks, so the player hits an invisible wall mid-span on a prop
// that's supposed to be fully walkable end to end. Found via
// e2e/lul211-founder-report.spec.ts's blocked()-sampling failing for both
// 'log' and 'bramble' on the QA-pinned seed -- a reed spawned 0.5 units from
// a bramble's centre. overlapsExistingCover() (lib/game/cover.ts) rejects
// against coverData itself, same conservative circle-vs-circle approximation
// as the tree checks above.
//
// Deliberate consequence, not a bug: the new rejection branch below skips a
// candidate's `ry` rng() draw when it fires (same short-circuit shape the
// existing inLake()/inSpawn()/inBaby() check above already has). Tree/baby/
// predator positions are unaffected (this fix only touches generateCover()'s
// own stream, which runs after all of those per the comment above) -- but
// the exact set and layout of cover props for a given seed will shift from
// pre-fix `main` wherever a rejected overlap used to land. That is the fix
// working, not a regression.
function treesNear(x, z){ return neighbourhood(grid, x, z, CELL, WRAP_SPAN); }
function generateCover(){
  coverData = [];
  for(const t of treeData) if(!t.culled && t.s > 1.4) coverData.push({ x: t.x, z: t.z, hx: t.cr*1.4, hz: t.cr*1.4, kind: 'tree' });

  let tries = 0, placed = 0;
  while(placed < CONFIG.coverProps && tries < CONFIG.coverProps*25){
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(-half+margin, half-margin);
    if(inLake(x,z) || inSpawn(x,z) || inBaby(x,z)) continue;
    const roll = rng();
    const { kind, hx, hz, y } = rollCoverPropShape(roll, rng);   // LUL-425: lib/game/cover.ts
    if(overlapsTreeTrunk(x, z, Math.max(hx,hz), treesNear(x,z))) continue;
    if(!coverKindBlocksMovement(kind) && overlapsTreeCanopy(x, z, Math.max(hx,hz), treesNear(x,z))) continue;
    if(overlapsExistingCover(x, z, Math.max(hx,hz), coverData)) continue;
    coverData.push({ x, z, hx, hz, kind, y, ry: rng()*Math.PI*2 });
    placed++;
  }
  // LUL-2225: drop any non-tree prop (log/rock/bramble) that landed inside
  // the bog's keep-clear radius -- nothing but reeds (generateReeds(), own
  // ring-only placement) is allowed in the patch. Filtering the finished
  // array, not rejecting inside the loop above, keeps the loop's rng() draw
  // count/order byte-identical for every existing seed (see the LUL-2212
  // comment above this function on why that stream must not move).
  coverData = coverData.filter(c => c.kind === 'tree' || !bogKeepClear(c.x, c.z, 0));
  buildCoverGrid();
}
function generateThrowables(){
  throwableData = [];
  let placed = 0, tries = 0;
  while(placed < THROWABLE_COUNT && tries < THROWABLE_COUNT * 40){
    tries++;
    const x = (rng() - 0.5) * (half * 2 - 8);
    const z = (rng() - 0.5) * (half * 2 - 8);
    // reject too close to home/spawn or overlapping existing cover/tree geometry --
    // reuse the same rejection test generateCover() uses against tree trunks
    // (overlapsTreeTrunk()) plus a check against already-placed throwables so they
    // don't stack visually.
    if(overlapsTreeTrunk(x, z, 1.5, treesNear(x, z))) continue;
    if(Math.hypot(x - CONFIG.home.x, z - CONFIG.home.z) < 12) continue;
    if(throwableData.some(t => Math.hypot(t.x - x, t.z - z) < 6)) continue;
    throwableData.push({ x, z, taken: false });
    placed++;
  }
  // LUL-2225: drop any throwable inside the bog's keep-clear radius. Filters
  // the finished array rather than rejecting inside the loop, so the loop's
  // rng() draw count/order stays byte-identical for every existing seed.
  // layoutThrowableMeshes() already parks any index past throwableData's new,
  // shorter length off-map (its `!t` branch) -- no rng consumed there either.
  throwableData = throwableData.filter(t => !bogKeepClear(t.x, t.z, 0));
}
// LUL-2249: layoutCoverMeshes() (repainted all four fixed-capacity meshes from
// coverData every call) is gone -- ensureCoverChunk()/dropCoverChunk() below
// do the same per-instance matrix layout, per chunk, on approach/departure.
const _throwMat4 = new THREE.Matrix4();
function layoutThrowableMeshes(){
  for(let i = 0; i < THROWABLE_COUNT; i++){
    const t = throwableData[i];
    if(!t || t.taken){
      // park hidden props off-map rather than resizing the InstancedMesh --
      // same "move it away" pattern used elsewhere for consumed/inactive instances.
      _throwMat4.compose(
        new THREE.Vector3(0, -50, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(0.001, 0.001, 0.001),
      );
    } else {
      _throwMat4.compose(
        new THREE.Vector3(t.x, 0.25, t.z),
        new THREE.Quaternion(),
        new THREE.Vector3(0.28, 0.28, 0.28), // small stone scale vs. full-size rock cover
      );
    }
    throwableMesh.setMatrixAt(i, _throwMat4);
  }
  throwableMesh.instanceMatrix.needsUpdate = true;
}

function nearLandmarks(x, z, pad){
  return !clearOfLandmarks(x, z, LANDMARKS, pad);
}
// LUL-375/LUL-2247, replaced by LUL-2249: this used to be layoutTreePool(),
// shared by generateMap()'s forest-tree loop (until LUL-2249 moved trees onto
// treeChunkTrios) and generateBogTrees()'s own instanced trio, drawing
// rotation/tint rng() *and* writing the mesh in one pass. Streaming needs
// those two split -- see the tree-chunk section above for why (rot/tint must
// be stored on the object and drawn once, mesh writes happen later, per chunk,
// on approach). This is the bog-only half of that split: draws rotation/tint
// for the FULL pre-thin array, in order, same rng stream position
// layoutTreePool() used to draw them from (immediately after
// thinGeneratedProps(), nothing else consumes rng in between) -- so every
// seed's post-tree rng draws (placeCave(), pickMission()) stay byte-identical.
// `count` (CONFIG.bogTrees) mirrors layoutTreePool()'s own loop bound: `data`
// can be shorter than `count` if generateBogTrees()'s try-budget didn't fill
// it, and no draw happens past `data.length` (same as before). Entries the
// later density thin drops still get rot/tint drawn here (this is the
// load-bearing part LUL-2247 fixed in layoutTreePool() -- draw count must stay
// fixed at data.length regardless of what thinGeneratedProps() keeps) but are
// simply never in the final (already-thinned) bogTreeData array
// ensureBogChunk() buckets from, so nothing extra needs parking off-map.
function drawBogTreeVisuals(data, count){
  for(let i=0; i<count; i++){
    if(i >= data.length) break;
    data[i].rot = rng()*Math.PI*2;
    data[i].tint = 0.72 + rng()*0.5;
  }
}
// ---- E6: chunk the main forest pool so three.js can frustum-cull whole chunks ----
// FogExp2 (density 0.04) already hides anything past ~40-60 units; the old single
// map-spanning InstancedMesh submitted all 5200 trees every frame regardless
// (frustumCulled=false, because a single mesh spanning the whole map is *always*
// at least partly in view, so per-mesh culling was never an option before this).
// Chunking lets the renderer skip whole chunks that are outside the view frustum
// for free -- no new per-frame code, exactly the win the ticket asks for.
const TREE_CHUNK_SIZE = 60;   // world units/edge; CONFIG.mapSize=480 -> 8x8 = 64 chunks
const TREE_CHUNKS_PER_AXIS = Math.ceil(CONFIG.mapSize / TREE_CHUNK_SIZE);

function treeChunkIndex(x, z){
  const cx = Math.min(TREE_CHUNKS_PER_AXIS-1, Math.max(0, Math.floor((x+half)/TREE_CHUNK_SIZE)));
  const cz = Math.min(TREE_CHUNKS_PER_AXIS-1, Math.max(0, Math.floor((z+half)/TREE_CHUNK_SIZE)));
  return cx*TREE_CHUNKS_PER_AXIS + cz;
}

// ---- LUL-2249: streamed chunk lifecycle ------------------------------------
// Before this ticket, every populated chunk was instantiated up front and
// stayed live forever (see git history for the old layoutTreeChunks()/
// layoutCoverMeshes()/layoutTreePool() this replaces). Now only chunks within
// STREAM_RADIUS_CHUNKS of the player's own chunk are "live" (hold real
// InstancedMesh objects); everything else is bucketed data waiting to stream
// in. "Chunk" always means the same TREE_CHUNK_SIZE cell every category below
// buckets against -- one shared id space, not a second grid per category.
//
// Sparse arrays indexed by chunk id; a populated entry is that chunk's live
// mesh (or trio), absent/undefined for a chunk that's either empty of that
// category's data or simply not currently live.
let treeChunkTrios = [];     // chunk id -> [trunk, cone1, cone2], live tree chunks only
let treeChunkBuckets = [];   // chunk id -> indices into treeData, every populated chunk
let coverChunkMeshes = [];   // chunk id -> { log?, rock?, bramble?, reed?: InstancedMesh }, live only
let coverChunkBuckets = [];  // chunk id -> indices into coverData (non-'tree' kinds only)
let bogChunkMeshes = [];     // chunk id -> [trunk, cone1, cone2], live bog chunks only
let bogChunkBuckets = [];    // chunk id -> indices into bogTreeData
let liveChunks = new Set();  // chunk ids currently live -- one liveness set, every category
                              // streams in/out together since they all share one ring

function bucketTreeChunks(data){
  const nChunks = TREE_CHUNKS_PER_AXIS * TREE_CHUNKS_PER_AXIS;
  treeChunkBuckets = Array.from({length: nChunks}, () => []);
  // Bucketing reads only t.x/t.z, already fixed in `data` before this runs --
  // no rng() draw here, so this cannot perturb the seeded stream.
  for(let i=0; i<data.length; i++) treeChunkBuckets[treeChunkIndex(data[i].x, data[i].z)].push(i);
}

// Builds chunk `c`'s tree trio from its bucketed indices, reading the
// rot/tint every tree already had drawn and stored on it at generate time
// (generateMap()'s forest-tree loop, right where layoutTreeChunks() used to
// draw them) -- no rng() call here, so streaming a chunk in/out can never
// perturb the seeded stream. No-op if already live or the chunk has no trees.
function ensureChunk(c){
  if(treeChunkTrios[c]) return;
  const idxs = treeChunkBuckets[c];
  if(!idxs || idxs.length === 0) return;
  const trio = [
    new THREE.InstancedMesh(trunkGeo, trunkMat,   idxs.length),
    new THREE.InstancedMesh(cone1Geo, foliageMat, idxs.length),
    new THREE.InstancedMesh(cone2Geo, foliageMat, idxs.length),
  ];
  // frustumCulled left at the Object3D default (true) -- this is the whole
  // point (E6): a whole chunk outside the view frustum is now free to skip.
  idxs.forEach((ti, slot) => {
    const t = treeData[ti];
    // LUL-2225: a culled tree (sparse bog-core forest) is parked off-screen,
    // same as before this ticket -- only what's rendered differs, never rng.
    if(t.culled){
      dummy.position.set(0, -999, 0); dummy.scale.setScalar(0.0001); dummy.rotation.set(0,0,0);
    } else {
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, t.rot, 0);
      dummy.scale.setScalar(t.s);
    }
    dummy.updateMatrix();
    for(const p of trio) p.setMatrixAt(slot, dummy.matrix);
    tintCol.setRGB(t.tint*0.92, t.tint, t.tint*0.86);
    trio[1].setColorAt(slot, tintCol); trio[2].setColorAt(slot, tintCol);
  });
  for(const m of trio){
    scene.add(m);
    m.instanceMatrix.needsUpdate = true;
    if(m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();   // static after layout -- compute once, not per frame
  }
  treeChunkTrios[c] = trio;
}
// Disposes chunk `c`'s live tree trio's own instanceMatrix/instanceColor GPU
// buffers via .dispose(), then drops the reference -- never
// .geometry.dispose()/.material.dispose(): trunkGeo/cone1Geo/cone2Geo/
// trunkMat/foliageMat are shared with every other tree/bog chunk. No-op if
// the chunk isn't currently live.
function dropChunk(c){
  const trio = treeChunkTrios[c];
  if(!trio) return;
  for(const m of trio){ scene.remove(m); m.dispose(); }
  treeChunkTrios[c] = undefined;
}

// ---- ring controller --------------------------------------------------
const STREAM_RADIUS_CHUNKS = 2;    // load radius: 5x5 = 300x300u square around the player's chunk
const STREAM_UNLOAD_CHEBYSHEV = 3; // unload once Chebyshev distance exceeds this -- hysteresis band
                                    // against a player oscillating across a single chunk boundary
let lastStreamChunkX = null, lastStreamChunkZ = null;

function chunkXZ(x, z){
  return [
    Math.min(TREE_CHUNKS_PER_AXIS-1, Math.max(0, Math.floor((x+half)/TREE_CHUNK_SIZE))),
    Math.min(TREE_CHUNKS_PER_AXIS-1, Math.max(0, Math.floor((z+half)/TREE_CHUNK_SIZE))),
  ];
}

// Called once per stepFrame() (see the movement/collision block below) plus
// forced (`force=true`) right after every generateMap()/qaBuildScene() reset.
// `CONFIG.wrapEnabled` is false, and chunkXZ()'s own clamp already keeps the
// index in [0, TREE_CHUNKS_PER_AXIS) -- if wrapEnabled is ever flipped true,
// this clamp is exactly where wraparound chunk math would need to go through
// wrapDelta()/wrapCellIndex() instead (out of scope here, per the ticket).
function updateStreamedChunks(force){
  const [cx, cz] = chunkXZ(player.x, player.z);
  if(!force && cx === lastStreamChunkX && cz === lastStreamChunkZ) return;   // the "not per frame" cost control
  lastStreamChunkX = cx; lastStreamChunkZ = cz;

  const wanted = new Set();
  for(let dx = -STREAM_RADIUS_CHUNKS; dx <= STREAM_RADIUS_CHUNKS; dx++){
    for(let dz = -STREAM_RADIUS_CHUNKS; dz <= STREAM_RADIUS_CHUNKS; dz++){
      const ccx = cx+dx, ccz = cz+dz;
      if(ccx < 0 || ccx >= TREE_CHUNKS_PER_AXIS || ccz < 0 || ccz >= TREE_CHUNKS_PER_AXIS) continue;
      wanted.add(ccx*TREE_CHUNKS_PER_AXIS + ccz);
    }
  }
  for(const c of wanted) if(!liveChunks.has(c)){ ensureChunk(c); ensureCoverChunk(c); ensureBogChunk(c); liveChunks.add(c); }
  for(const c of Array.from(liveChunks)){
    if(wanted.has(c)) continue;
    const lcx = Math.floor(c/TREE_CHUNKS_PER_AXIS), lcz = c%TREE_CHUNKS_PER_AXIS;
    const cheb = Math.max(Math.abs(lcx-cx), Math.abs(lcz-cz));
    if(cheb > STREAM_UNLOAD_CHEBYSHEV){ dropChunk(c); dropCoverChunk(c); dropBogChunk(c); liveChunks.delete(c); }
  }
}

// ---- cover/reed pool: per-chunk InstancedMesh, per-chunk coverGrid entries ----
// coverData already carries x/z (bucketable via the same treeChunkIndex() every
// category shares) and kind (log/rock/bramble/reed); 'tree' entries (tagged
// forest trees, already handled above) are excluded.
function bucketCoverChunks(){
  const nChunks = TREE_CHUNKS_PER_AXIS * TREE_CHUNKS_PER_AXIS;
  coverChunkBuckets = Array.from({length: nChunks}, () => []);
  for(let i=0; i<coverData.length; i++){
    if(coverData[i].kind === 'tree') continue;
    coverChunkBuckets[treeChunkIndex(coverData[i].x, coverData[i].z)].push(i);
  }
}
// Builds chunk `c`'s per-kind cover meshes (one InstancedMesh per kind present
// in this chunk, sized to that kind's own count here) and pushes each
// instance's cell into `coverGrid` -- the real, incremental half of this
// ticket's collision change: coverBlockedR()/hasLOS()/findHideSpot()/canSee()
// (lib/game/cover.ts, via `neighbourhood()`, generic over what Map holds it)
// only ever see cover that's actually live. No-op if already live or empty.
function ensureCoverChunk(c){
  if(coverChunkMeshes[c]) return;
  const idxs = coverChunkBuckets[c];
  if(!idxs || idxs.length === 0) return;
  const byKind = { log: [], rock: [], bramble: [], reed: [] };
  for(const i of idxs) byKind[coverData[i].kind].push(i);
  const meshes = {};
  for(const kind in byKind){
    const kindIdxs = byKind[kind];
    if(kindIdxs.length === 0) continue;
    const [geo, mat] = COVER_GEO_MAT[kind];
    const m = new THREE.InstancedMesh(geo, mat, kindIdxs.length);
    m.frustumCulled = false;   // matches the old fixed-capacity coverMeshes -- not part of this ticket's ask
    kindIdxs.forEach((i, slot) => {
      const cv = coverData[i];
      dummy.position.set(cv.x, cv.y, cv.z);
      dummy.rotation.set(0, cv.ry, 0);
      dummy.scale.set(cv.hx*2, cv.y*2, cv.hz*2);
      dummy.updateMatrix();
      m.setMatrixAt(slot, dummy.matrix);
      const k2 = key(Math.floor(cv.x/CELL), Math.floor(cv.z/CELL));
      (coverGrid.get(k2) || coverGrid.set(k2, []).get(k2)).push(cv);
    });
    m.instanceMatrix.needsUpdate = true;
    scene.add(m);
    meshes[kind] = m;
  }
  coverChunkMeshes[c] = meshes;
}
// Disposes chunk `c`'s live cover meshes (never the shared geo/mat) and pulls
// exactly this chunk's entries back out of coverGrid by reference. No-op if
// the chunk isn't currently live.
function dropCoverChunk(c){
  const meshes = coverChunkMeshes[c];
  if(!meshes) return;
  for(const i of (coverChunkBuckets[c] || [])){
    const cv = coverData[i];
    const k2 = key(Math.floor(cv.x/CELL), Math.floor(cv.z/CELL));
    const arr = coverGrid.get(k2);
    if(!arr) continue;
    const at = arr.indexOf(cv);
    if(at !== -1) arr.splice(at, 1);
  }
  for(const kind in meshes){ scene.remove(meshes[kind]); meshes[kind].dispose(); }
  coverChunkMeshes[c] = undefined;
}

// ---- bog tree pool: same per-chunk treatment, smaller scale ----------------
// bogTreeData is already the final (post-thin) array by the time this ever
// runs (see generateMap()'s reset sequence) -- every bucketed index renders.
function bucketBogChunks(){
  const nChunks = TREE_CHUNKS_PER_AXIS * TREE_CHUNKS_PER_AXIS;
  bogChunkBuckets = Array.from({length: nChunks}, () => []);
  for(let i=0; i<bogTreeData.length; i++) bogChunkBuckets[treeChunkIndex(bogTreeData[i].x, bogTreeData[i].z)].push(i);
}
function ensureBogChunk(c){
  if(bogChunkMeshes[c]) return;
  const idxs = bogChunkBuckets[c];
  if(!idxs || idxs.length === 0) return;
  const trio = [
    new THREE.InstancedMesh(trunkGeo, trunkMat,   idxs.length),
    new THREE.InstancedMesh(cone1Geo, foliageMat, idxs.length),
    new THREE.InstancedMesh(cone2Geo, foliageMat, idxs.length),
  ];
  trio.forEach(m => { m.frustumCulled = false; });   // matches the old bogParts trio
  idxs.forEach((bi, slot) => {
    const t = bogTreeData[bi];
    dummy.position.set(t.x, 0, t.z);
    dummy.rotation.set(0, t.rot, 0);
    dummy.scale.setScalar(t.s);
    dummy.updateMatrix();
    for(const p of trio) p.setMatrixAt(slot, dummy.matrix);
    tintCol.setRGB(t.tint*0.92, t.tint, t.tint*0.86);
    trio[1].setColorAt(slot, tintCol); trio[2].setColorAt(slot, tintCol);
  });
  for(const m of trio){
    scene.add(m);
    m.instanceMatrix.needsUpdate = true;
    if(m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }
  bogChunkMeshes[c] = trio;
}
function dropBogChunk(c){
  const trio = bogChunkMeshes[c];
  if(!trio) return;
  for(const m of trio){ scene.remove(m); m.dispose(); }
  bogChunkMeshes[c] = undefined;
}
// ---- Bog map band (LUL-25) --------------------------------------------------
// generateBogTrees()/generateReeds()/applyHardBabySpawn() are all called from
// the tail of generateMap(), strictly after every existing rng() draw (baby,
// trees, predators, cover, wind) -- new content only ever appends to the
// seeded stream, same rule LUL-43/LUL-23 already established, so the current
// forest keeps generating byte-identical for CONFIG.seed.
function generateBogTrees(){
  bogTreeData = [];
  let tries = 0;
  // LUL-1483: was a direct scatter into the z-band (100% acceptance minus
  // nearLandmarks) -- now also rejects on biomeAt (~30% of the square is
  // boggy), so the try budget is raised to keep hitting BOG_TREES reliably.
  while(bogTreeData.length < CONFIG.bogTrees && tries < CONFIG.bogTrees*200){
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(-half+margin, half-margin);
    if(biomeAt(x, z) <= 0) continue;
    if(nearLandmarks(x, z, 2)) continue;
    const s = 0.6 + rng()*1.3;   // thinner cover -- same scatter shape, smaller sizes than the forest
    bogTreeData.push({ x, z, s, cr: 0.35*s, crCanopy: canopyRadiusAtEye(s, CONFIG.eye, CANOPY_GEO) });
  }
  // LUL-2247/LUL-2249: drawBogTreeVisuals() moved out of here -- it now runs
  // from generateMap(), after thinGeneratedProps() has filtered bogTreeData,
  // so ensureBogChunk() can render only the surviving (post-thin) trees while
  // drawBogTreeVisuals() still draws rng() for the full pre-thin array
  // (review fix -- see drawBogTreeVisuals()'s own comment).
}
// Reeds: tall cover volumes, bog band only. Pushed into the same coverData
// array log/rock/bramble use (see COVER_GEO_MAT.reed above) so canSee()'s LOS
// raycast and the player's coverBlockedR() movement check treat them exactly
// like any other prop, with zero changes to either function.
//
// LUL-2212: this loop had no overlap check against `coverData` at all --
// generateCover() (called earlier in generateMap(), so its rock/log/bramble/
// tree entries are already in `coverData` by the time this runs) checks new
// candidates against trees and, as of this same ticket, against each other,
// but reeds bypassed all of it. A reed (solid, coverKindBlocksMovement()
// true) spawning on top of a log/bramble (walkable) reintroduces exactly the
// bug the other check fixes: the player hits an invisible wall mid-span on a
// prop that's supposed to be fully walkable. This was the actual failure
// e2e/lul211-founder-report.spec.ts caught on the QA-pinned seed -- a reed
// 0.5 units from a bramble's centre.
//
// LUL-2225: reeds are now the patch's visible boundary, not scattered
// through its interior -- restricted to the ring between BOG_INNER_RADIUS
// and BOG_OUTER_RADIUS (the old `biomeAt(x,z) <= 0` reject let them land
// anywhere in the disc, including the dense core). Own budget (BOG_REEDS),
// no longer COVER_PROPS -- a much smaller target ring than the old 135-unit
// disc COVER_PROPS was sized for.
//
// LUL-2247 review fix: this loop never checked `inLake()`/`overlapsTreeTrunk()`
// at all, unlike every other prop generator in this file (generateCover()
// runs both). `inLake()` is a no-op after LUL-2225's backmerge -- BOG_CENTER
// is 131 units from CONFIG.lake, well outside BOG_OUTER_RADIUS, so no ring
// candidate can ever be inLake() -- kept anyway per the ticket/review ask and
// as a guard if the bog or lake geometry ever moves again. overlapsTreeTrunk()
// is the one that matters today: ordinary (non-culled, non-bog) forest trees
// are NOT excluded from the 25-45 ring, and overlapsExistingCover() below
// deliberately skips `kind==='tree'` entries (lib/game/cover.ts), so without
// this a reed can still land on top of a forest tree trunk in the ring.
// Declared reshuffle (LUL-2212/LUL-2225 precedent): both new checks can
// reject a candidate before its `ry` rng() draw, so the exact ry stream for
// this loop -- and only this loop, since it's the last rng() consumer before
// thinGeneratedProps(), which draws none -- shifts for any seed where either
// check now fires. No other generator's stream is affected.
function generateReeds(){
  let tries = 0, placed = 0;
  while(placed < CONFIG.bogReeds && tries < CONFIG.bogReeds*200){
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(-half+margin, half-margin);
    const dist = Math.hypot(x - BOG_CENTER.x, z - BOG_CENTER.z);
    if(dist < BOG_INNER_RADIUS || dist > BOG_OUTER_RADIUS) continue;
    if(nearLandmarks(x, z, 3)) continue;
    if(inLake(x, z)) continue;
    const r = 0.5 + rng()*0.4, h = 1.3 + rng()*0.9;
    if(overlapsTreeTrunk(x, z, r, treesNear(x, z))) continue;
    if(overlapsExistingCover(x, z, r, coverData)) continue;
    coverData.push({ x, z, hx: r, hz: r, y: h*0.5, kind: 'reed', ry: rng()*Math.PI*2 });
    placed++;
  }
  buildCoverGrid();
}
// LUL-2247: cross-category density pass. Runs once, after generateCover(),
// generateThrowables(), generateBogTrees() and generateReeds() have all
// finished (so coverData/bogTreeData/throwableData are each at their final,
// pre-thin size for this map) and before any of their layout*()/buildGrid()
// consumers run. Builds one combined, order-preserving list -- cover (log/
// rock/bramble) and reeds first (already in generation order inside
// coverData), then bog trees, then stones -- tags each with the category key
// thinProps()/PROP_CHUNK_CAP use, thins it, then filters the three real
// arrays down to exactly the kept objects (by reference, so no new object
// shapes are introduced downstream). 'tree' entries in coverData are excluded
// from the combined list entirely -- forest trees are not a "non-tree
// object" and already have their own spacing discipline; they pass through
// unfiltered below.
//
// buildCoverGrid() was already run twice above (end of generateCover(), end
// of generateReeds()) against the pre-thin coverData -- coverGrid is a
// separate Map of object references built at call time, so it still holds
// entries this pass is about to drop. Re-running it here (same call the two
// mutators above already make after touching coverData) keeps coverGrid in
// sync with the array coverBlockedR()/hasLOS()/canSee()/findHideSpot() are
// meant to reflect; skipping it would leave invisible collision/LOS from
// props whose meshes this ticket has already moved off-map.
function thinGeneratedProps(){
  const combined = [];
  for(const c of coverData) if(c.kind !== 'tree') combined.push({ x: c.x, z: c.z, kind: c.kind === 'reed' ? 'reed' : 'cover', ref: c });
  for(const b of bogTreeData) combined.push({ x: b.x, z: b.z, kind: 'bogTree', ref: b });
  for(const t of throwableData) combined.push({ x: t.x, z: t.z, kind: 'stone', ref: t });

  const kept = thinProps(combined, PROP_MIN_SPACING, PROP_CHUNK_CAP, treeChunkIndex);
  const keptRefs = new Set(kept.map(k => k.ref));

  coverData = coverData.filter(c => c.kind === 'tree' || keptRefs.has(c));
  bogTreeData = bogTreeData.filter(b => keptRefs.has(b));
  throwableData = throwableData.filter(t => keptRefs.has(t));
  buildCoverGrid();
}
// LUL-25: 'normal' | 'hard'. Driven by setDifficulty() below (LUL-372) --
// 'blackout', the hardest DIFFICULTY_PRESETS tier, maps to 'hard'; the other
// two map to 'normal'. Also settable directly via qaSetDifficulty() for
// tests. Normal never calls pickHardBabyPosition, so its rng stream is
// byte-identical to before this ticket; hard draws its extra point after
// every other generateMap() draw.
// Named distinctly from LUL-26's `difficulty` (DIFFICULTY_PRESETS, below) --
// they are two unrelated concepts (baby spawn placement vs. the real
// lantern/night/blackout preset) that collided on the same identifier during
// a backmerge; see LUL-427.
let babySpawnDifficulty = 'normal';
// The "other side" position drawn at the top of generateMap(), captured
// there (see below) before applyHardBabySpawn() can override it -- LUL-799:
// applyHardBabySpawn() must be able to restore this when babySpawnDifficulty
// flips hard -> normal without a fresh generateMap()/rng draw (setDifficulty()
// can be called pre-entry, any number of times, in either direction).
let babyNormalSpawn = { x: 0, z: 0 };
function applyHardBabySpawn(){
  const pos = babySpawnDifficulty === 'hard'
    ? pickHardBabyPosition(rng, half, LANDMARKS)
    : babyNormalSpawn;
  baby.x = pos.x; baby.z = pos.z;
  babyGroup.position.set(baby.x, 0, baby.z);
  placeBabyWisps();
}

function generateMap(seed){
  currentSeed = seed >>> 0;
  rng = mulberry32(seed >>> 0);
  scentPoints = [];   // LUL-23: no trail survives a fresh map/restart

  // place the child far across the map (the "other side"), clear of the pool
  do {
    const ang = rng()*Math.PI*2, d = half*(0.5 + rng()*0.3);
    baby.x = Math.cos(ang)*d; baby.z = Math.sin(ang)*d;
  } while(inLake(baby.x, baby.z));
  babyNormalSpawn = { x: baby.x, z: baby.z };
  baby.taken = false;
  babyGroup.visible = true;
  babyGroup.position.set(baby.x, 0, baby.z);
  placeBabyWisps();

  treeData = [];
  let tries = 0;
  // LUL-2225: "sparse inside the bog, not none" -- every 4th tree that lands
  // within BOG_INNER_RADIUS of BOG_CENTER is kept, the rest marked `culled`.
  // Deterministic (a counter, no extra rng() draw) so this cannot perturb
  // the seeded tree stream below it; ensureChunk() parks culled trees
  // off-screen and addAllToGrid()/generateCover() skip them for collision/
  // hide-cover. Scoped to BOG_INNER_RADIUS specifically (not the wider
  // biomeAt > 0.5 threshold, which reaches ~35 units at this geometry) so
  // the counter directly controls the density qaProbeBogKeepClear() and the
  // spec's e2e section measure, rather than a proxy region whose overlap
  // with the measured radius varies by seed.
  let bogCoreSeen = 0;
  while(treeData.length < CONFIG.trees && tries < CONFIG.trees*25){
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(-half+margin, half-margin);
    if(inLake(x,z) || inSpawn(x,z) || inBaby(x,z)) continue;
    const s = 0.7 + rng()*1.7;
    let culled = false;
    if(Math.hypot(x - BOG_CENTER.x, z - BOG_CENTER.z) < BOG_INNER_RADIUS){
      culled = (bogCoreSeen % 4 !== 0);
      bogCoreSeen++;
    }
    treeData.push({ x, z, s, cr: 0.35*s, crCanopy: canopyRadiusAtEye(s, CONFIG.eye, CANOPY_GEO), culled });
  }
  // LUL-2249: rot/tint used to be drawn inside layoutTreeChunks()'s own
  // per-tree loop, which ran here -- right after tree generation finished,
  // before buildGrid()/placePredators() -- with nothing else consuming rng in
  // between. Drawing them in a second pass over treeData, in the same index
  // order, at the same point in the seeded stream, keeps every existing
  // seed's tree/predator/etc. positions byte-identical; only *when* the
  // resulting mesh gets built (streamed in per-chunk, later) has changed.
  for(let i=0; i<treeData.length; i++){
    treeData[i].rot = rng()*Math.PI*2;
    treeData[i].tint = 0.72 + rng()*0.5;
  }
  buildGrid();
  player.x = 0; player.z = 0; player.yaw = 0; player.pitch = -0.02;
  placePredators();
  generateCover();   // LUL-43: last rng consumer -- appends, doesn't reorder, the stream
  generateThrowables();
  generateWind();   // LUL-23: appended after cover -- doesn't reorder either stream
  pushState({ windX, windZ });   // LUL-1724: map-constant, pushed once, not per-frame
  // LUL-25: everything below is new and runs last -- see the comment on
  // generateBogTrees() for why the ordering is load-bearing.
  generateBogTrees();
  // LUL-2215: generateCover() (above) ran before bog trees existed, so its
  // overlapsTreeCanopy() check for walkable kinds (log/bramble -- see the
  // comment on that call) couldn't see bog tree canopies. A log/bramble could
  // land overlapping one; canopyBlockedR() blocks the player unconditionally
  // within a tree's canopy circle regardless of what's on the ground, so the
  // player hits the exact same invisible-wall-mid-span bug LUL-2212 fixed for
  // cover-vs-cover overlap, but for cover-vs-bog-tree. Filtering the finished
  // coverData array here, rather than reordering generateBogTrees() before
  // generateCover() or rejecting inside generateCover()'s loop, keeps every
  // existing rng() draw -- tree, baby, predator, and generateCover()'s own
  // stream -- byte-identical for every seed; same precedent as the LUL-2225
  // bog-keep-clear filter in generateCover() above.
  coverData = coverData.filter(c =>
    c.kind === 'tree' ||
    coverKindBlocksMovement(c.kind) ||
    !overlapsTreeCanopy(c.x, c.z, Math.max(c.hx, c.hz), bogTreeData)
  );
  generateReeds();
  // LUL-2247 review fix: capture the pre-thin array by reference before
  // thinGeneratedProps() reassigns bogTreeData to a filtered copy --
  // drawBogTreeVisuals() below needs the full array so its rng() draw count
  // stays fixed at bogTreeData.length regardless of what the thin drops
  // (see the comment on drawBogTreeVisuals() itself).
  const bogTreeDataPreThin = bogTreeData;
  thinGeneratedProps();   // LUL-2247: cross-category spacing + per-chunk caps -- draws no rng
  // LUL-2249: same rot/tint extraction as the forest trees above -- draws for
  // the FULL pre-thin array, in order, at the same rng stream position
  // layoutTreePool() used to draw them from here (moved out of
  // generateBogTrees() for the same LUL-2247 reason: needs the full array,
  // not the thinned one, to keep its draw count fixed for any seed).
  drawBogTreeVisuals(bogTreeDataPreThin, CONFIG.bogTrees);
  if(!qaNoRender) layoutThrowableMeshes();   // moved from right after generateThrowables() -- needs the thinned array too
  buildGrid();   // picks up bogTreeData for blockedR()/canopyBlockedR()
  placeLandmarks();
  buildGrid();   // LUL-374: re-run now landmarkData is populated, so blockedR()/predators'
                  // own blockedR() calls treat the four landmark meshes as solid too
  applyHardBabySpawn();
  bwisps.visible = true;   // LUL-38: pickup() hides these; a fresh map/restart brings them back
  // LUL-1258: draw this run's mission last, after every other rng() consumer
  // above, so it never shifts the stream any existing seed/replay depends on.
  mission = pickMission(rng, secondaryChoice);
  missionHumTimer = 2;
  placeCave();   // LUL-1904: new rng consumer -- must stay last, after mission
  buildGrid();   // landmarkData just changed (placeCave() may have pushed to it); same
                  // reasoning as the LUL-374 buildGrid() call above
  // LUL-2249: hand off from "every populated chunk instantiated up front" to
  // the streamed ring, now that treeData/coverData/bogTreeData are all at
  // their final, post-thin state. Drop whatever the PREVIOUS seed left live
  // (those meshes are sized for that seed's per-chunk counts, never
  // reusable), rebucket this seed's data, and reset coverGrid to empty --
  // buildCoverGrid() (generateCover()/generateReeds()/thinGeneratedProps())
  // populated it whole-map for generation-time overlap checks, but from here
  // on only a live chunk's own entries belong in it (ensureCoverChunk() adds
  // them, dropCoverChunk() removes them), so coverBlockedR()/hasLOS()/
  // findHideSpot()/canSee() only ever see cover that's actually rendered --
  // a deliberate, ticket-named consequence, not a bug. `player.x`/`player.z`
  // were reset to (0,0) above, before any of this, so the initial
  // updateStreamedChunks(true) streams in the ring around the real spawn
  // point, not wherever the player stood in the previous round.
  for(const c of liveChunks){ dropChunk(c); dropCoverChunk(c); dropBogChunk(c); }
  liveChunks = new Set();
  lastStreamChunkX = null; lastStreamChunkZ = null;
  coverGrid = new Map();
  if(!qaNoRender){
    bucketTreeChunks(treeData);
    bucketCoverChunks();
    bucketBogChunks();
    updateStreamedChunks(true);
  }
  // LUL-1093: moved from right after the tree-pool buildGrid() above.
  // bogTreeData/landmarkData don't exist until generateBogTrees()/
  // placeLandmarks() run, both below the old call site -- drawing from them
  // there always rendered empty arrays. This draws from data only and
  // consumes no rng, so it cannot perturb the seeded stream (LUL-25's
  // ordering comment above generateBogTrees() explains what does).
  drawMinimapStatic();
}

// ---- Lake landmark (the thing to find) -----------------------------------
const water = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.lake.r, 48),
  new THREE.MeshStandardMaterial({ color: 0x0a1a2c, roughness: 0.35, metalness: 0.15 }));
water.rotation.x = -Math.PI/2; water.position.set(CONFIG.lake.x, 0.02, CONFIG.lake.z); scene.add(water);

const ring = new THREE.Mesh(new THREE.RingGeometry(CONFIG.lake.r*0.72, CONFIG.lake.r*1.05, 48),
  new THREE.MeshBasicMaterial({ color: CONFIG.lake.glow, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI/2; ring.position.set(CONFIG.lake.x, 0.06, CONFIG.lake.z); scene.add(ring);

const lakeLight = new THREE.PointLight(CONFIG.lake.glow, 1.3 * LEGACY_LIGHT_SCALE, 75, 2);
lakeLight.position.set(CONFIG.lake.x, 7, CONFIG.lake.z); scene.add(lakeLight);

// ---- Bog patch ground (LUL-2225) ------------------------------------------
// The single flat `ground` plane above gave the bog no visible boundary at
// all -- a player could only learn where the slow ground was by getting
// slow. Two concentric discs, same "flat mesh just above `ground`" approach
// as `water`/`ring` above: a wide dark/wet disc out to BOG_OUTER_RADIUS (the
// full falloff, where bogginess reaches 0) and a darker one at
// BOG_INNER_RADIUS (the full-bogginess core) sitting fractionally higher so
// it doesn't z-fight. Static geometry, no rng draw, no shader -- a
// ripple/water-shader pass is a legitimate follow-up, not a blocker here.
const bogOuterGround = new THREE.Mesh(new THREE.CircleGeometry(BOG_OUTER_RADIUS, 64),
  new THREE.MeshStandardMaterial({ color: 0x0c1a14, roughness: 0.6, metalness: 0.05 }));
bogOuterGround.rotation.x = -Math.PI/2;
bogOuterGround.position.set(BOG_CENTER.x, 0.015, BOG_CENTER.z);
scene.add(bogOuterGround);

const bogInnerGround = new THREE.Mesh(new THREE.CircleGeometry(BOG_INNER_RADIUS, 48),
  new THREE.MeshStandardMaterial({ color: 0x08120f, roughness: 0.55, metalness: 0.1 }));
bogInnerGround.rotation.x = -Math.PI/2;
bogInnerGround.position.set(BOG_CENTER.x, 0.02, BOG_CENTER.z);
scene.add(bogInnerGround);

// ---- Home landmark: where the child must be carried (LUL-38) -------------
// Deliberately minimal -- "reuse the spawn point" per the ticket's own scope,
// a lit waypoint rather than a new art pass. Static (no rng draw), so map
// generation stays byte-identical for existing seeds.
const homeLight = new THREE.PointLight(CONFIG.home.glow, 1.0 * LEGACY_LIGHT_SCALE, 240, 2);
homeLight.position.set(CONFIG.home.x, 3, CONFIG.home.z); scene.add(homeLight);
const homeRing = new THREE.Mesh(new THREE.RingGeometry(CONFIG.home.r*0.7, CONFIG.home.r*1.1, 40),
  new THREE.MeshBasicMaterial({ color: CONFIG.home.glow, transparent: true, opacity: 0.2,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
homeRing.rotation.x = -Math.PI/2; homeRing.position.set(CONFIG.home.x, 0.04, CONFIG.home.z); scene.add(homeRing);

// ---- Navigational landmarks (LUL-25) --------------------------------------
// Same "static group + a light to read through the fog" recipe as the lake/
// home beacons above, just four distinct low-poly silhouettes instead of a
// ring. Built once at module scope (LANDMARKS gives each its target x/z);
// placeLandmarks(), called at the tail of generateMap(), only ever nudges
// their position a few units to keep this seed's actual trees from
// overlapping a fixed spot -- it never touches rng, so it can't affect
// determinism for anything else generateMap() draws.
// LUL-2248: kind -> beacon sprite, populated once by each buildX() below so
// tick()'s pulse loop can iterate all six without hardcoding six variable names.
const landmarkBeaconGlows = {};
function addBeaconGlow(g, kind, topY){
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: buildBeaconGlowTexture(LANDMARK_BEACONS[kind].color),
    transparent: true, opacity: LANDMARK_BEACONS[kind].opacityBase,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  glow.position.set(0, topY, 0);
  glow.scale.set(LANDMARK_BEACONS[kind].scale, LANDMARK_BEACONS[kind].scale, 1);
  g.add(glow);
  landmarkBeaconGlows[kind] = glow;
}
function buildFireTower(){
  const g = new THREE.Group();
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a1d12, roughness: 1 });
  const legGeo = new THREE.CylinderGeometry(0.14, 0.2, 9, 5);
  for(const [lx,lz] of [[-1.1,-1.1],[1.1,-1.1],[-1.1,1.1],[1.1,1.1]]){
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(lx*0.55, 4.5, lz*0.55);
    leg.rotation.x = -lx*0.12; leg.rotation.z = lz*0.12;
    g.add(leg);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.25, 2.6), legMat);
  deck.position.y = 9; g.add(deck);
  const light = new THREE.PointLight(0xff9a4a, 0.9 * LEGACY_LIGHT_SCALE, 26, 2); light.position.set(0, 9.6, 0); g.add(light);
  g.rotation.z = 0.13; g.rotation.x = 0.05;   // leaning
  addBeaconGlow(g, 'fireTower', 9.6);   // LUL-2248: matches the tower's own beacon PointLight height
  return g;
}
function buildStoneMarker(){
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x565f68, roughness: 0.9 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.75, 5.5, 4), stoneMat);
  shaft.position.y = 2.75; shaft.rotation.y = 0.4; g.add(shaft);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.5, 0.6, 4), stoneMat);
  cap.position.y = 5.6; cap.rotation.y = 0.4; g.add(cap);
  const glow = new THREE.PointLight(0x9fd0ff, 0.55 * LEGACY_LIGHT_SCALE, 16, 2); glow.position.set(0, 3.2, 0); g.add(glow);
  addBeaconGlow(g, 'stoneMarker', 5.9);   // LUL-2248: top of the cap (5.6 + half its 0.6 height)
  return g;
}
function buildDrownedCar(){
  const g = new THREE.Group();
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x3a2320, roughness: 1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.3, 1.9), rustMat);
  body.position.y = 0.35; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 1.7), rustMat);
  cab.position.set(-0.3, 1.15, 0); g.add(cab);
  g.rotation.set(0.05, 0.6, 0.16);   // tilted, half-sunken
  g.position.y = -0.3;
  const headlight = new THREE.PointLight(0xffcf7a, 0.35 * LEGACY_LIGHT_SCALE, 9, 2); headlight.position.set(2.0, 0.5, 0.6); g.add(headlight);
  addBeaconGlow(g, 'drownedCar', 1.6);   // LUL-2248: top of the cab (1.15 + half its 0.9 height)
  return g;
}
function buildSplitOak(){
  const g = new THREE.Group();
  const charMat = new THREE.MeshStandardMaterial({ color: 0x201a16, roughness: 1 });
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xb8ada0, roughness: 0.85 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 4.5, 6), charMat);
  trunk.position.y = 2.25; g.add(trunk);
  for(const side of [-1, 1]){
    const half_ = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.35, 6.5, 5), boneMat);
    half_.position.set(side*0.6, 4.5 + 3.25, side*0.3);
    half_.rotation.z = -side*0.35; half_.rotation.x = 0.1;
    g.add(half_);
  }
  const glow = new THREE.PointLight(0xcfe6ff, 0.4 * LEGACY_LIGHT_SCALE, 14, 2); glow.position.set(0, 6, 0); g.add(glow);
  addBeaconGlow(g, 'oak', 11.0);   // LUL-2248: top of the split bone spikes (7.75 + half their 6.5 height)
  return g;
}
// LUL-1855: soft radial-gradient canvas texture for the radio mast's
// fog-exempt beacon glow (see buildRadioMast() below) -- same canvas-texture
// idiom already used for the sky gradient above (:306-312), applied to a
// small square instead, so the sprite reads as a soft point of light rather
// than a hard-edged disc.
function buildBeaconGlowTexture(hex){
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const col = '#' + hex.toString(16).padStart(6, '0');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, col); grd.addColorStop(0.4, col); grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function buildRadioMast(){
  const g = new THREE.Group();
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.8, metalness: 0.4 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 11, 5), mastMat);
  mast.position.y = 5.5; g.add(mast);
  for(const y of [3, 6, 9]){
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 4), mastMat);
    brace.position.y = y; brace.rotation.z = Math.PI/2; g.add(brace);
  }
  const beacon = new THREE.PointLight(0xff2a2a, 0.5 * LEGACY_LIGHT_SCALE, 18, 2);
  beacon.position.set(0, 11.2, 0); g.add(beacon);
  // LUL-1855: fog-exempt beacon glow -- the PointLight above only lights
  // surfaces within its 18-unit cutoff, which FogExp2 erases by ~43 units
  // anyway (wiki game/mechanics/landmarks-below-the-fog-line). This sprite is
  // a separate, unlit, fog:false marker so the beacon stays visible past the
  // fog line as a bearing, not a lit scene -- same idiom as stars/moon
  // (:318, :323-325) and the win burst (:1061-1067). LUL-2248: generalised
  // to all six landmarks; radioMast keeps its original hue/height unchanged.
  addBeaconGlow(g, 'radioMast', 11.2);
  g.rotation.z = 0.05;   // slight lean
  return g;
}
function buildChapelSteeple(){
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3d3831, roughness: 0.95 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.4, 2.4), stoneMat);
  base.position.y = 1.7; g.add(base);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 3.2, 4), stoneMat);
  roof.position.y = 5.0; roof.rotation.y = Math.PI/4; g.add(roof);
  const glow = new THREE.PointLight(0xd8c9a0, 0.45 * LEGACY_LIGHT_SCALE, 15, 2);
  glow.position.set(0, 3.2, 0); g.add(glow);
  addBeaconGlow(g, 'chapelSteeple', 6.6);   // LUL-2248: top of the roof cone (5.0 + half its 3.2 height)
  return g;
}
function buildCave(){
  const g = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x27241f, roughness: 1 });
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 6, 0, Math.PI*2, 0, Math.PI*0.55), rockMat);
  mouth.rotation.x = Math.PI; mouth.position.y = 1.4; g.add(mouth);
  const glow = new THREE.PointLight(0x6fd6c4, 0.6 * LEGACY_LIGHT_SCALE, 14, 2);
  glow.position.set(0, 1.2, 1.6); g.add(glow);
  g.visible = false;   // LUL-1904: the first landmark whose visibility is conditional
                        // per-round, not always-on -- see placeCave().
  return g;
}
const landmarkGroups = {
  fireTower: buildFireTower(),
  stoneMarker: buildStoneMarker(),
  drownedCar: buildDrownedCar(),
  oak: buildSplitOak(),
  radioMast: buildRadioMast(),
  chapelSteeple: buildChapelSteeple(),
  cave: buildCave(),
};
Object.values(landmarkGroups).forEach(g => scene.add(g));
// Nudges (x,z) away from any tree/cover prop this seed actually generated
// nearby -- pure geometry, no rng, so it can't shift the seeded stream.
function clearLandmarkSpot(x, z, clear){
  for(let i=0; i<8; i++){
    let hit = false;
    for(const t of treeData){ if(Math.hypot(x-t.x, z-t.z) < clear + t.cr) { hit = true; break; } }
    if(!hit) for(const t of bogTreeData){ if(Math.hypot(x-t.x, z-t.z) < clear + t.cr) { hit = true; break; } }
    if(!hit) for(const c of coverData){ if(Math.hypot(x-c.x, z-c.z) < clear + Math.max(c.hx, c.hz)) { hit = true; break; } }
    if(!hit) return [x, z];
    const a = i * 0.9;
    x += Math.cos(a) * 3; z += Math.sin(a) * 3;
  }
  return [x, z];
}
function placeLandmarks(){
  landmarkData = [];
  for(const l of LANDMARKS){
    const [x, z] = clearLandmarkSpot(l.x, l.z, l.clear);
    landmarkGroups[l.kind].position.x = x;
    landmarkGroups[l.kind].position.z = z;
    landmarkData.push({ x, z, cr: l.cr, kind: l.kind });
  }
}
// LUL-1904: the cave's own spawn coin-flip is a NEW rng() consumer and must
// run strictly after generateMap()'s last existing draw (mission =
// pickMission(rng), forest-engine.js:917 -- see the LUL-1258 comment there:
// "draw this run's mission last... so it never shifts the stream any
// existing seed/replay depends on"). Placement itself (clearLandmarkSpot)
// draws no rng, same as placeLandmarks() -- it can run conditionally with no
// determinism concern either way.
function placeCave(){
  caveSpawned = rng() < 0.5;
  caveConsumed = false;
  caveImmuneT = 0;
  if(caveSpawned){
    const [x, z] = clearLandmarkSpot(CAVE.x, CAVE.z, CAVE.clear);
    caveData = { x, z };
    landmarkGroups.cave.position.set(x, 0, z);
    landmarkGroups.cave.visible = true;
    landmarkData.push({ x, z, cr: CAVE.cr });
  } else {
    caveData = null;
    landmarkGroups.cave.visible = false;
  }
}

const lwArr = new Float32Array(LW*3);
for(let i=0;i<LW;i++){ const a=Math.random()*Math.PI*2, r=Math.random()*CONFIG.lake.r*0.95;
  lwArr[i*3]=CONFIG.lake.x+Math.cos(a)*r; lwArr[i*3+1]=0.3+Math.random()*4; lwArr[i*3+2]=CONFIG.lake.z+Math.sin(a)*r; }
const lwGeo = new THREE.BufferGeometry(); lwGeo.setAttribute('position', new THREE.BufferAttribute(lwArr,3));
const lwisps = new THREE.Points(lwGeo, new THREE.PointsMaterial({ color: CONFIG.lake.glow, size: 0.17,
  transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
lwisps.frustumCulled = false; scene.add(lwisps);

// ---- Ambient dust that drifts around you ---------------------------------
// Drift direction is windX/windZ (LUL-195): wind silently decides scent
// outcomes (checkScent(), ~line 569) with no other player-visible tell, so
// the one ambient particle system already running becomes that tell for
// free -- no HUD, no compass, matches the "no readouts" feel of the rest of
// the game. Speed is tuned for legibility, not to match WIND_STRENGTH
// (3.2u/s would read as a gust, not a steady drift).
const dustArr = new Float32Array(DUST*3);
for(let i=0;i<DUST;i++){ dustArr[i*3]=(Math.random()*2-1)*30; dustArr[i*3+1]=Math.random()*12; dustArr[i*3+2]=(Math.random()*2-1)*30-3; }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustArr,3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xa8c2e8, size: 0.06,
  transparent: true, opacity: 0.5, depthWrite: false }));
dust.frustumCulled = false; scene.add(dust);

// ---- Scent trail visual (LUL-2230) ---------------------------------------
// Renders the same scentPoints array checkScent() reads, at the same
// driftedScentPosition() a predator actually smells -- the picture never
// lies about where the trail really is. Presentation only: this reads
// scentPoints/windX/windZ/veilAmount but never writes them, and veil dims
// the alpha here without touching checkScent()/scentOnto() (see
// docs/ELEMENTS.md's veil-vs-scent split, :865-866-equivalent).
const SCENT_TRAIL_MAX = Math.ceil(SCENT_LIFETIME / SCENT_DEPOSIT_INTERVAL) + 2;
const SCENT_TRAIL_COLOR = new THREE.Color(0x9fe0d0);
const scentTrailPos = new Float32Array(SCENT_TRAIL_MAX * 3);
const scentTrailCol = new Float32Array(SCENT_TRAIL_MAX * 3);
const scentTrailGeo = new THREE.BufferGeometry();
scentTrailGeo.setAttribute('position', new THREE.BufferAttribute(scentTrailPos, 3));
scentTrailGeo.setAttribute('color', new THREE.BufferAttribute(scentTrailCol, 3));
scentTrailGeo.setDrawRange(0, 0);
const scentTrailPts = new THREE.Points(scentTrailGeo, new THREE.PointsMaterial({
  size: 0.28, transparent: true, vertexColors: true, blending: THREE.AdditiveBlending,
  depthWrite: false, sizeAttenuation: true,
}));
scentTrailPts.frustumCulled = false; scene.add(scentTrailPts);
const _scentProjVec = new THREE.Vector3();   // scratch, reused every frame -- avoid per-point GC

// ---- The lost child (the objective) --------------------------------------
const baby = { x: 60, z: 60, taken: false };
function inBaby(x,z){ const dx=x-baby.x, dz=z-baby.z; return dx*dx+dz*dz < 20; }   // ~4.5-unit clearing

// LUL-1258: M2 Deepwater. Per-run mission state, drawn once per generateMap()
// call (see the tail of generateMap() below) from the same seeded rng stream
// map/predator generation already consumes -- never player-selected.
let mission = null;
let cryTimer = 2;   // LUL-1255 (Ship 1 wayfinding S3d): first cry fires quickly, not after a full interval
let homeFireTimer = 2;   // LUL-1255 (Ship 1 wayfinding S5): same init as cryTimer
let missionHumTimer = 2;   // LUL-1258: mirrors childCry's cryTimer init -- first hum fires quickly, not after a full interval
// LUL-1666: cross-session record of which missions have had their secondary
// unlocked (completed baseline once). Engine-owned, synced from
// components/Hud.tsx's localStorage read via setMissionUnlocks(), same split
// as `embers` (line ~1646). Keyed by MissionKind for forward-compatibility
// with M1/M4/M5 once they ship, even though only 'deepwater' is reachable today.
let missionUnlocks = { deepwater: false };
// LUL-1666: the player's pre-run menu choice for the *next* draw -- 'none' by
// default. Read once at pickMission() time in generateMap(), not re-read mid-run.
let secondaryChoice = null;
let carriedCryPulse = false;   // LUL-1857: one-tick pulse, set by the carry-leg cry timer, consumed by updatePredators() the same frame

const babyGroup = new THREE.Group();
const bundle = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xf3d3c0, emissive: 0xffcaa0, emissiveIntensity: 0.5, roughness: 0.85 }));
bundle.scale.set(1, 0.8, 1); bundle.position.y = 0.42;
const babyHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xf7e2d4, emissive: 0xffd6b4, emissiveIntensity: 0.5, roughness: 0.85 }));
babyHead.position.y = 0.8;
const halo = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12),
  new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false }));
halo.position.y = 0.55;
const babyLight = new THREE.PointLight(WARM, 1.1 * LEGACY_LIGHT_SCALE, BABY_LIGHT_DISTANCE, 2); babyLight.position.set(0, 1.3, 0);
babyGroup.add(bundle, babyHead, halo, babyLight);
scene.add(babyGroup);

// warm beacon wisps so it can be spotted through the fog
const bwArr = new Float32Array(BW*3);
const bwisps = new THREE.Points(new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: WARM, size: 0.14, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
bwisps.geometry.setAttribute('position', new THREE.BufferAttribute(bwArr, 3));
bwisps.frustumCulled = false; scene.add(bwisps);
function placeBabyWisps(){
  for(let i=0;i<BW;i++){ const a=Math.random()*Math.PI*2, r=Math.random()*1.2;
    bwArr[i*3]=baby.x+Math.cos(a)*r; bwArr[i*3+1]=0.2+Math.random()*3.2; bwArr[i*3+2]=baby.z+Math.sin(a)*r; }
  bwisps.geometry.attributes.position.needsUpdate = true;
}

// ---- First-person arms (only shown during the pickup cinematic) ----------
scene.add(camera);
const armsGroup = new THREE.Group(); armsGroup.visible = false; camera.add(armsGroup);
const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a884, emissive: 0x3a241a, emissiveIntensity: 0.6, roughness: 0.75 });
function makeArm(){
  const arm = new THREE.Group();
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.9, 8), skinMat); fore.position.y = 0.45;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), skinMat); hand.position.y = 0.95; hand.scale.set(1, 0.8, 1.15);
  arm.add(fore, hand); return arm;
}
const armL = makeArm(), armR = makeArm(); armsGroup.add(armL, armR);

// ---- Sky burst for the win (fires after the child ascends) ----------------
const flashEl = document.getElementById('flash');
const boomGroup = new THREE.Group(); boomGroup.visible = false; scene.add(boomGroup);
const boomFlash = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
const boomRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 44),
  new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
boomRing.rotation.x = Math.PI/2;
const bspArr = new Float32Array(BSP*3), bspVel = [];
const bspPts = new THREE.Points(new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: 0xffe6b0, size: 0.7, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
bspPts.geometry.setAttribute('position', new THREE.BufferAttribute(bspArr, 3));
boomGroup.add(boomFlash, boomRing, bspPts);
let boomStart = -1;
// LUL-1914: startled roosts, slice (a) -- one small persistent THREE.Points burst
// per fixed roost site (not fireBoom/boomGroup: that's a single shared instance
// built for one radial burst at a time; two roosts can flush within the same
// few seconds from different predators, so each site needs its own timer).
const ROOST_BURST_PTS = 10;   // bird-lift silhouette, not an explosion -- keep small
const roostCooldown = new Float32Array(ROOSTS.length);      // seconds remaining, 0 = ready
const roostBurstStart = new Float32Array(ROOSTS.length).fill(-1);  // seconds since flush, -1 = idle
const roostBurstVel = ROOSTS.map(() => []);
const roostGroups = ROOSTS.map(r => {
  const g = new THREE.Group();
  g.position.set(r.x, 14, r.z);   // canopy height, above ground cover/fog line
  g.visible = false;
  const arr = new Float32Array(ROOST_BURST_PTS * 3);
  const pts = new THREE.Points(new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ color: 0x2a2620, size: 0.35, transparent: true, opacity: 1,
      depthWrite: false, fog: false }));   // fog:false: must read above the fog line at range (proposal §3)
  pts.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  pts.userData.arr = arr;
  g.add(pts);
  g.userData.pts = pts;
  scene.add(g);
  return g;
});
function fireBoom(x, y, z){
  boomGroup.position.set(x, y, z); boomGroup.visible = true; boomStart = 0;
  for(let i=0;i<BSP;i++){ const a=Math.random()*Math.PI*2, e=Math.acos(2*Math.random()-1), sp=8+Math.random()*24;
    bspVel[i]=[Math.sin(e)*Math.cos(a)*sp, Math.cos(e)*sp, Math.sin(e)*Math.sin(a)*sp];
    bspArr[i*3]=bspArr[i*3+1]=bspArr[i*3+2]=0; }
  bspPts.geometry.attributes.position.needsUpdate = true;
  if(audio) boom(audio.ctx.currentTime);
  if(flashEl) flashEl.style.opacity = '0.9';
}
function updateBoom(dt){
  if(boomStart < 0) return;
  boomStart += dt; const e = boomStart;
  boomFlash.scale.setScalar(1 + e*11); boomFlash.material.opacity = Math.max(0, 1 - e/0.4);
  const rs = 1 + e*42; boomRing.scale.set(rs, rs, rs); boomRing.material.opacity = Math.max(0, 1 - e/1.4);
  const bp = bspPts.geometry.attributes.position.array;
  for(let i=0;i<BSP;i++){ bp[i*3]+=bspVel[i][0]*dt; bp[i*3+1]+=bspVel[i][1]*dt - 4*dt*e; bp[i*3+2]+=bspVel[i][2]*dt; }
  bspPts.geometry.attributes.position.needsUpdate = true;
  bspPts.material.opacity = Math.max(0, 1 - e/1.6);
  if(flashEl) flashEl.style.opacity = String(Math.max(0, 0.9 - e*3.5));
  if(e > 1.8){ boomGroup.visible = false; boomStart = -1; }
}
// LUL-1914: slice (a) burst -- 10 points biased upward (bird-lift), small lateral
// spread, ~0.9s rise-and-fade. Keyed by roost index, independent of boomGroup.
function triggerRoostBurst(i){
  const g = roostGroups[i], pts = g.userData.pts, arr = pts.userData.arr;
  const vel = roostBurstVel[i];
  vel.length = 0;
  for(let k=0;k<ROOST_BURST_PTS;k++){
    const a = Math.random()*Math.PI*2;
    vel.push([Math.cos(a)*1.2, 3 + Math.random()*2.5, Math.sin(a)*1.2]);
    arr[k*3] = arr[k*3+1] = arr[k*3+2] = 0;
  }
  pts.geometry.attributes.position.needsUpdate = true;
  pts.material.opacity = 1;
  g.visible = true;
  roostBurstStart[i] = 0;
}
function updateRoostBursts(dt){
  for(let i=0;i<roostGroups.length;i++){
    if(roostBurstStart[i] < 0) continue;
    roostBurstStart[i] += dt;
    const e = roostBurstStart[i];
    const pts = roostGroups[i].userData.pts, arr = pts.userData.arr, vel = roostBurstVel[i];
    for(let k=0;k<ROOST_BURST_PTS;k++){
      arr[k*3]   += vel[k][0]*dt;
      arr[k*3+1] += vel[k][1]*dt;
      arr[k*3+2] += vel[k][2]*dt;
    }
    pts.geometry.attributes.position.needsUpdate = true;
    pts.material.opacity = Math.max(0, 1 - e/0.9);
    if(e > 0.9){ roostGroups[i].visible = false; roostBurstStart[i] = -1; }
  }
}
// LUL-1914: positional wing-clatter -- modeled on scheduleBirdChirp's bandpass-noise
// graph, made positional via missionWaypointHum's own panner/falloff math (both
// referenced by file:line in the wiki proposal and CTO plan). 3-4 chirps in quick
// succession so it reads as a flock lifting, not one bird. Math.random(), not the
// seeded rng -- same scope-exemption the existing ambient bird chirp already has.
function roostFlushSound(x, z){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio;
  const dx = x - player.x, dz = z - player.z;
  const dist = Math.hypot(dx, dz);
  const near = Math.max(0, Math.min(1, 1 - dist / 140));
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx =  Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  const right = dx*rx + dz*rz, fwd = dx*fx + dz*fz;
  const panVal = Math.max(-1, Math.min(1, right / Math.max(1, Math.hypot(right, fwd))));
  const bursts = 3 + Math.floor(Math.random()*2);   // 3-4
  let delay = 0;
  for(let n=0;n<bursts;n++){
    delay += 0.04 + Math.random()*0.05;   // 40-90ms apart
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = noise(ctx, 0.08, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = 2200 + Math.random() * 1800; f.Q.value = 4;
    const pan = ctx.createStereoPanner(); pan.pan.value = panVal;
    const g = ctx.createGain();
    const peak = (0.05 + near * 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(f); f.connect(pan); pan.connect(g); g.connect(master); g.connect(conv);
    src.start(t);
  }
  if(captionsOn){
    const cnear = dist < 60 ? 'near' : 'far';
    const side = Math.abs(right) < Math.abs(fwd)*0.6 ? (fwd >= 0 ? 'ahead' : 'behind') : (right > 0 ? 'right' : 'left');
    pushState({ caption: `birds scatter · ${cnear} · ${side}`, captionId: ++captionSeq });
  }
}
function flushRoost(i){
  triggerRoostBurst(i);
  roostFlushSound(ROOSTS[i].x, ROOSTS[i].z);
}
const lookM = new THREE.Matrix4(), lookQ = new THREE.Quaternion();
function key3(time, keys){   // smoothstep-interpolated keyframes
  if(time <= keys[0][0]) return keys[0][1];
  for(let i=1;i<keys.length;i++){ if(time <= keys[i][0]){
    const [t0,v0]=keys[i-1], [t1,v1]=keys[i], u=(time-t0)/(t1-t0); return v0+(v1-v0)*(u*u*(3-2*u)); } }
  return keys[keys.length-1][1];
}

// (The death "getting eaten" moment is now a separate 2D cutscene overlay, not 3D geometry.)

// ---- Predators: wolf, bear, lion -----------------------------------------
// PSPEC_BASE (engine/tuning.js) is a module-level singleton shared across every
// init() call -- clone it fresh here so this call's speed assignment below can't
// leak into the next init() (LUL-1065/tuning-extraction.md).
const PSPEC = Object.fromEntries(Object.entries(PSPEC_BASE).map(([k, v]) => [k, { ...v }]));
// Size each animal's speed from its warning budget: from the moment it SEES you and you
// flee at top speed, the fastest (lion) still gives ≥4s, the bear ≥9s. All are faster than
// the player, so you can't simply outrun them — hiding is the real escape. Tune via CHASE_GAP.
// RUN stays declared here (not in engine/tuning.js) so it keeps tracking
// STAMINA_SPRINT_MUL by import rather than re-duplicating that literal --
// see LUL-1491 handoff comment for why this is a declared deviation from
// docs/specs/tuning-extraction.md's literal `CONFIG.walk * 1.8`.
const RUN = CONFIG.walk * STAMINA_SPRINT_MUL;
for(const k in PSPEC) PSPEC[k].speed = RUN + CHASE_GAP / PSPEC[k].budget;

let difficulty = 'night';
function makePredator(kind){
  const s = PSPEC[kind], g = new THREE.Group();
  const H = s.h, L = s.len, Wd = s.sz, bodyY = H*0.62;
  const skin = new THREE.MeshStandardMaterial({ color: s.body, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(s.body).multiplyScalar(0.7), roughness: 0.95 });
  const furMat = new THREE.MeshStandardMaterial({ color: 0x6e4a24, roughness: 1 });

  // torso: chest + midriff + haunch, overlapping and tapered
  const torso = new THREE.Group(); torso.position.y = bodyY; g.add(torso);
  const chest  = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), skin); chest.scale.set(Wd*0.9, H*0.5, L*0.5);  chest.position.set(0, 0.02*H, L*0.34);
  const midrib = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), skin); midrib.scale.set(Wd*0.82, H*0.46, L*0.55);
  const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), skin); haunch.scale.set(Wd*0.95, H*0.52, L*0.5); haunch.position.set(0, 0.02*H, -L*0.32);
  torso.add(chest, midrib, haunch);

  // neck + head with a snout
  const neck = new THREE.Group(); neck.position.set(0, bodyY + H*0.12, L*0.5); g.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14*Wd, 0.2*Wd, 0.4*H, 9), skin);
  neckMesh.position.y = 0.2*H; neckMesh.rotation.x = 0.5; neck.add(neckMesh);
  const head = new THREE.Group(); head.position.set(0, 0.34*H, 0.16*L); neck.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24*Wd, 12, 10), skin); skull.scale.set(1, 0.95, 1.1); head.add(skull);
  const snoutLen = 0.34*Wd*(kind==='bear' ? 0.85 : 1.4);
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.1*Wd, 0.16*Wd, snoutLen, 8), skin);
  snout.rotation.x = Math.PI/2; snout.position.set(0, -0.03*Wd, 0.18*Wd + snoutLen*0.4); head.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.055*Wd, 8, 6), dark);
  nose.position.set(0, -0.02*Wd, 0.18*Wd + snoutLen*0.9); head.add(nose);
  if(s.ears) [-1,1].forEach(d => { const ear=new THREE.Mesh(new THREE.ConeGeometry(0.08*Wd, 0.2*Wd, 5), skin); ear.position.set(0.12*Wd*d, 0.2*Wd, -0.02*Wd); head.add(ear); });
  else       [-1,1].forEach(d => { const ear=new THREE.Mesh(new THREE.SphereGeometry(0.07*Wd, 8, 6), skin);      ear.position.set(0.15*Wd*d, 0.19*Wd, -0.03*Wd); head.add(ear); });
  if(s.mane){ const n=12; for(let i=0;i<n;i++){ const a=i/n*Math.PI*2; const m=new THREE.Mesh(new THREE.SphereGeometry(0.12*Wd, 7, 6), furMat);
    m.position.set(Math.cos(a)*0.26*Wd, Math.sin(a)*0.26*Wd, -0.08*Wd); head.add(m); } }
  const eyeMat = new THREE.MeshBasicMaterial({ color: s.eye });
  [-1,1].forEach(d => { const e=new THREE.Mesh(new THREE.SphereGeometry(0.05*Wd, 8, 6), eyeMat); e.position.set(0.1*Wd*d, 0.03*Wd, 0.16*Wd); head.add(e); });

  // legs: hip → thigh, knee → shin + paw (so they can bend)
  const legs = [];
  for(const [lx, lz, fr] of [[Wd*0.34, L*0.42, 1], [-Wd*0.34, L*0.42, 1], [Wd*0.34, -L*0.4, -1], [-Wd*0.34, -L*0.4, -1]]){
    const hip = new THREE.Group(); hip.position.set(lx, bodyY, lz); g.add(hip);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.075*Wd, 0.06*Wd, bodyY*0.5, 7), dark); thigh.position.y = -bodyY*0.25; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -bodyY*0.5; hip.add(knee);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.055*Wd, 0.045*Wd, bodyY*0.45, 7), dark); shin.position.y = -bodyY*0.225; knee.add(shin);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.07*Wd, 8, 6), dark); paw.scale.set(1, 0.6, 1.35); paw.position.y = -bodyY*0.45; knee.add(paw);
    legs.push({ hip, knee, fr });
  }

  // tail (two segments so it can sway)
  const tail = new THREE.Group(); tail.position.set(0, bodyY + 0.04*H, -L*0.5); tail.rotation.x = 0.6; g.add(tail);
  const t1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05*Wd, 0.03*Wd, 0.34*L, 6), skin); t1.position.y = -0.17*L; tail.add(t1);
  const tail2 = new THREE.Group(); tail2.position.y = -0.34*L; tail.add(tail2);
  const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03*Wd, 0.015*Wd, 0.3*L, 6), skin); t2.position.y = -0.15*L; tail2.add(t2);
  if(s.mane){ const tuft=new THREE.Mesh(new THREE.SphereGeometry(0.09*Wd, 7, 6), furMat); tuft.position.y = -0.3*L; tail2.add(tuft); }

  scene.add(g);
  return { g, kind, spec:s, legs, neck, head, torso, tail, tail2, rad:s.rad,
    state:'roam', x:0, z:0, vx:0, vz:0, yaw:0, wpx:0, wpz:0,
    phase:rng()*6, spotted:false, callTimer:0,
    inv:'', sniffsLeft:0, sniffTimer:0, backX:0, backZ:0, standX:0, standZ:0,
    stuckT:0, trail:[], trailT:0, reroute:0, rrX:0, rrZ:0, hunt:false, alert:0, scentLock:0, scentCalls:0,
    packTimer:0, flankX:0, flankZ:0, sniffImmuneT:0,
    lkpX:0, lkpZ:0, lkpSweeps:0,
    charge:null, chargeDirX:0, chargeDirZ:0, chargeCooldown:0, inert:false, sightLock:null,
    noiseTarget:null, noiseTargetT:0 };
}
const predators = [];
// `speciesIdx` (0..2 within its species) is what LUL-26's `activePerSpecies`
// preset compares against -- fixed at creation so placePredators() doesn't
// need to re-derive array position every restart.
for(const k of ['wolf','bear','lion']) for(let i=0;i<3;i++){ const p = makePredator(k); p.speciesIdx = i; predators.push(p); }
let sinceClose = 0, huntTime = 0, spotFlash = 0, pianoTimer = 0;   // threat timers, spot flash, approach-note timer
let bearingPulseT = 0, bearingPulseSide = null;   // LUL-1308: screen-edge glow for off-screen predator bearing
let approachPianoActive = false;   // LUL-1620: QA-visible mirror of the piano gate below, no raw Web Audio exposure
let coverAmt = 0;   // LUL-144: eased 0..1 desaturation driven by the cover-feedback scan below
function placePredators(){
  // LUL-26: `night` (default) has activePerSpecies:3, so `p.inert` is false
  // for every predator and this loop draws exactly the RNG sequence it always
  // has -- the preset system is a no-op at the default. Lower presets only
  // diverge the stream when a player actually picks them.
  const preset = DIFFICULTY_PRESETS[difficulty];
  for(const p of predators){
    p.inert = p.speciesIdx >= preset.activePerSpecies;
    p.g.visible = !p.inert;
    if(p.inert){ p.x = p.z = -9999; continue; }   // parked off-map; both scan loops also skip on p.inert
    // LUL-395: the reject condition never checked the lake, so a predator
    // could spawn in or right at the edge of the water -- unlike the tree,
    // baby and cover spawn loops (generateMap()/generateCover()), which all
    // reject inLake() already. LUL-791/LUL-794 P1: `inLake(x,z)` must NOT
    // join this loop's own while-condition -- that would change how many
    // rng() draws this loop makes on any seed where a candidate lands in the
    // lake, and generateMap() calls placePredators() before generateCover()
    // against one shared rng stream, so a draw-count change here silently
    // reshuffles every prop generateCover() places afterward (reproduced the
    // LUL-491 canopy-overlap bug on a log, see
    // wiki:game/lul791-lake-predator-spawn-rng-shift). The retry loop below
    // is byte-for-byte the pre-LUL-791 loop (same conditions, same rng()
    // call count on every seed); the lake is handled entirely after it, by
    // the deterministic, non-rng pushOutOfLakeClearance() -- unconditionally,
    // not just when the retry budget exhausts.
    let x, z, tries = 0;
    do { const ang=rng()*Math.PI*2, d=half*(0.42+rng()*0.45); x=Math.cos(ang)*d; z=Math.sin(ang)*d; tries++; }
    while((x*x+z*z < 2500 || Math.hypot(x-baby.x, z-baby.z) < 34 || blockedR(x, z, p.rad+0.5)) && tries < 60);
    if(inLake(x,z)){ const pushed = pushOutOfLakeClearance(x, z, CONFIG.lake); x = pushed.x; z = pushed.z; }
    p.x=x; p.z=z; p.wpx=x; p.wpz=z; p.vx=0; p.vz=0; p.yaw=rng()*Math.PI*2;
    p.state='roam'; p.spotted=false; p.inv=''; p.sniffsLeft=0; p.sniffTimer=0; p.callTimer=0;
    p.stuckT=0; p.trail=[]; p.trailT=0; p.reroute=0; p.hunt=preset.startHunting; p.alert=0; p.scentLock=0; p.scentCalls=0;
    p.packTimer=0; p.flankX=0; p.flankZ=0; p.sniffImmuneT=0;
    p.lkpX=0; p.lkpZ=0; p.lkpSweeps=0;
    p.charge=null; p.chargeDirX=0; p.chargeDirZ=0; p.chargeCooldown=0;
    p.g.position.set(x, 0, z); p.g.rotation.set(0, p.yaw, 0);
  }
  mm.style.display = preset.minimap ? '' : 'none';
  sinceClose = 0; huntTime = 0; spotFlash = 0; bearingPulseT = 0; bearingPulseSide = null;
  activeCharges = 0; pushState({ chargeVisible: false });
}
// steer a desired direction around trees the predator would otherwise walk into
// LUL-593: the angle-fallback scan itself now lives in lib/game/cover.ts
// (pickAvoidDirection, unit tested there) -- this stays a thin wrapper that
// injects the engine's own tree/landmark `grid` closure state, same pattern
// as blockedR/blocked/hasLOS/findHideSpot above.
function avoidDir(p, dx, dz){ return pickAvoidDirection(p.x, p.z, p.rad, dx, dz, grid, coverGrid, CELL, undefined, undefined, WRAP_SPAN); }
// ---- Scent trail + wind (LUL-23) ------------------------------------------
// The player leaves scent while moving (see the deposit call in tick()'s
// movement block -- nothing is deposited while `hidden` or standing still, so
// holding still both stops laying new trail AND lets the old trail decay out
// from under you; that's the counterplay, not a HUD readout). Each point only
// remembers where and when it was laid. At query time its live radius shrinks
// with age and its effective position drifts downwind, so a predator can walk
// through a patch of forest well after the player has moved on and still find
// something there -- or, if it's upwind, never will. A roaming predator that
// crosses a still-live point converts straight to `chase`, the same state
// sight-spotting uses, so the existing chase→investigate→sniff loop (LUL-22
// spec: do not retune its timing) is exactly what handles losing it again.
//
// No second spatial hash: SCENT_LIFETIME / SCENT_DEPOSIT_INTERVAL bounds the
// array at a few dozen points (oldest pruned on every deposit), and it's only
// walked for predators in `roam`. A linear scan over that -- worst case ~9
// predators x ~45 points, once per frame -- is cheaper than building and
// maintaining a grid for a dataset this small, so the 8-unit tree hash is left
// alone rather than given a second, mostly-empty user.
//
// LUL-279: the decay curve, wind drift, and expiry/prune math (plus the
// named constants above the ticket refers to) now live in lib/game/scent.ts,
// unit tested there -- imported at the top of this file. This file keeps all
// the *state* (scentPoints, player, clock, wind) and calls the pure math
// back in.

let windX = 1, windZ = 0;   // unit vector; redrawn once per generateMap(), see generateWind()
function generateWind(){
  const a = rng() * Math.PI * 2;
  windX = Math.cos(a); windZ = Math.sin(a);
}

let scentPoints = [];   // {x,z,t0,radius}, oldest first (push-only, so index 0 is always oldest)

// LUL-2230: scent trail visual. Rendering state only -- nothing here is read
// by checkScent()/scentOnto()/depositScent(). The one-time caption that used
// to live right here is now the generic LUL-2307 hint registry below --
// 'scent' is just HINT_PRIORITY's first entry.
let scentTrailVisible = true;   // engine-owned setting, same shape as captionsOn
let scentLockEventCount = 0;   // bumped by scentOnto(); the 'scent' hint's dismiss-on-interaction signal
let scentTrailLastFrame = { settingOn: true, rendered: false, points: [], livePoints: 0,
  captionVisible: false, captionSeen: false, veilAmount: 0, windX: 1, windZ: 0 };   // qaProbeScentTrail() snapshot, refreshed every tick
function setScentTrailVisible(v){ scentTrailVisible = !!v; pushState({ scentTrailVisible }); }

// LUL-2307: generic first-encounter hint captions -- one small registry
// replaces LUL-2230's bespoke scent-only version (scentCaptionSeen/Active/
// StartT/scentLockCountAtCaptionStart). Same rules for every key: eligible
// only while entered && !hidden && !win && !death; starts the frame its
// anchor becomes available; ends after 8s or its own dismiss-on-interaction
// event, then persists "seen" under lullwood:hints:<key> so it never shows
// again this install. Losing eligibility mid-caption (hidden, win, death, the
// Show hints setting) stops it without marking seen -- it can still show
// later. Exactly one hint active at a time; HINT_PRIORITY order breaks ties
// when more than one becomes eligible+anchored the same frame (scent wins on
// a fresh install), and a higher-priority key preempts a lower-priority one
// already showing (stepFrame() below) -- not marked seen, so it can still
// show later. See docs/specs/lul-2307-first-encounter-hints.md.
const HINT_PRIORITY = ['scent','landmark','lake','bog','deepwater',
  'wolf','bear','lion','stamina','cover','caveImmune','throwable','veil'];
// 'wolf'/'bear'/'lion'/'cover'/'throwable' are world-anchored (a real 3D point,
// projected to a viewport fraction via projectToScreen() below, same math the
// scent-mote loop already used). The rest -- including 'landmark', whose trigger
// fires unconditionally on entry with no single object to point at (mirroring the
// old unconditional toast it replaces) -- are self/panel-anchored: no frustum
// requirement, positioned by a fixed CSS rule per key in GameCanvas.tsx instead of a
// per-frame x/y (the engine has no access to React-rendered DOM positions).
const WORLD_HINT_KEYS = { scent:1, wolf:1, bear:1, lion:1, cover:1, throwable:1 };
const HINT_TEXT = {
  scent:      'this is your scent trail — predators follow it',
  landmark:   'landmarks in the fog are safe to navigate by',
  lake:       'chest-deep water — half pace. predators wade too',
  bog:        'bog — half pace, but it masks your scent from wolves',
  deepwater:  'deepwater — reach the drowned car for a bonus payout on a run you survive',
  wolf:       "a wolf — faster than you. hide (H) or veil (F), don't outrun",
  bear:       'a bear — not fast, but it tracks your scent better than the others. hide (H) or veil (F)',
  lion:       "a lion — the fastest hunter here. hide (H) or veil (F), don't outrun",
  stamina:    'out of breath — walk to recover, running lays a wider scent trail',
  cover:      'hollow log — H to hide inside. predators lose sight of you',
  caveImmune: 'immune to detection for a short time',   // mirrors #caveImmunePanel's own copy, Hud.tsx
  throwable:  'a stone — E to pick up, throw to break a chase',
  veil:       "veil — F holds off what hunts you. limited; it refills when you don't use it",
};
const HINT_KEY_PREFIX = 'lullwood:hints:';
// LUL-2230's key, read (never written) as a migration fallback for the 'scent' entry
// only -- an install that already saw the old caption must not see it again just
// because it moved registries.
const LEGACY_SCENT_HINT_KEY = 'lullwood:scentTrailCaptionSeen';
// key -> true/false, lazily filled from localStorage. Caches the *negative* result too
// (not just "seen") -- the priority scan below calls hintSeen() on every not-yet-seen key
// every frame while that key hasn't claimed the active slot, so an uncached miss means one
// localStorage.getItem() per unseen key per frame for the entire run; on the QA rig's
// synchronous qaAdvance(hundreds-of-steps) loops that's thousands of synchronous
// localStorage round-trips in a tight loop -- slow enough to trip Chromium's hung-renderer
// detector (observed as "Target crashed" / page-closed failures across e2e/hints.spec.ts,
// LUL-2346). resetHints() below clears the whole cache (both true and false entries),
// forcing a fresh read next time.
const hintSeenCache = {};
function hintSeen(key){
  if(key in hintSeenCache) return hintSeenCache[key];
  let seen = false;
  try {
    if(localStorage.getItem(HINT_KEY_PREFIX + key) === '1'
      || (key === 'scent' && localStorage.getItem(LEGACY_SCENT_HINT_KEY) === '1')){
      seen = true;
    }
  } catch(e){}
  hintSeenCache[key] = seen;
  return seen;
}
function markHintSeen(key){
  hintSeenCache[key] = true;
  try { localStorage.setItem(HINT_KEY_PREFIX + key, '1'); } catch(e){}
}
let hintsEnabled = true;
try { const v = localStorage.getItem('lullwood:hintsEnabled'); if(v !== null) hintsEnabled = v === '1'; } catch(e){}
function setHintsEnabled(v){ hintsEnabled = !!v; pushState({ hintsEnabled }); }
function resetHints(){
  for(const k in hintSeenCache) delete hintSeenCache[k];
  hintActiveKey = null; hintActiveStartT = 0; hintDismissBaseline = 0;
  try {
    for(let i = localStorage.length - 1; i >= 0; i--){
      const k = localStorage.key(i);
      if(k && k.indexOf(HINT_KEY_PREFIX) === 0) localStorage.removeItem(k);
    }
    localStorage.removeItem(LEGACY_SCENT_HINT_KEY);
  } catch(e){}
  pushState({ hintVisible: false });
}
let hintActiveKey = null, hintActiveStartT = 0, hintDismissBaseline = 0;
const _hintProjVec = new THREE.Vector3();   // scratch, reused every frame -- avoid per-point GC
// Projects a world point to a clamped viewport fraction, or null if it's outside the
// camera frustum this frame. Generalizes the scent-mote projection math LUL-2230
// introduced (was inline in the scent-only caption block) for reuse across every
// world-anchored hint key.
function projectToScreen(x, y, z){
  _hintProjVec.set(x, y, z).project(camera);
  const inFrustum = _hintProjVec.x >= -1 && _hintProjVec.x <= 1 && _hintProjVec.y >= -1 && _hintProjVec.y <= 1 && _hintProjVec.z < 1;
  if(!inFrustum) return null;
  return {
    x: Math.max(0.08, Math.min(0.92, (_hintProjVec.x + 1) / 2)),
    y: Math.max(0.08, Math.min(0.92, (1 - _hintProjVec.y) / 2)),
  };
}

function depositScent(hot, againstWind){
  const base = hot ? SCENT_RADIUS_RUN : SCENT_RADIUS_WALK;
  const radius = againstWind ? base * WIND_AGAINST_RADIUS_MULTIPLIER : base;
  scentPoints.push({ x: player.x, z: player.z, t0: clock.elapsedTime, radius });
  while(scentPoints.length && isScentPastPruneCutoff(clock.elapsedTime - scentPoints[0].t0)) scentPoints.shift();
}
function checkScent(p){
  if(isCaveImmune(caveImmuneT)) return false;
  // LUL-1902: wolf-only nose reduction while the player's bog-mask is active.
  // Bears/lions and all sight-based detect() are untouched.
  const nose = p.kind === 'wolf' ? p.spec.nose * (1 - WOLF_BOG_MASK_STRENGTH * playerBogMask) : p.spec.nose;
  for(let i = scentPoints.length - 1; i >= 0; i--){
    const s = scentPoints[i], age = clock.elapsedTime - s.t0;
    if(isScentDetected(s, age, p.x, p.z, windX, windZ, nose, SCENT_LIFETIME, WRAP_SPAN)) return true;
  }
  return false;
}
// LUL-1904: walk-in trigger, no keybind -- mirrors arriveHome()'s own shape
// (a plain per-frame distance check in tick(), not the keypress-gated
// pickup()/grabThrowable() pattern), so touch parity is free: it reads
// player.x/z only, already unified across desktop-key and mobile-joystick
// input before this point in tick(). No new entry in components/MobileControls.tsx
// or EngineActions is needed.
function activateCavePower(){
  caveConsumed = true;
  caveImmuneT = CAVE_IMMUNITY_TIME;
  // A committed charge (p.charge, resolved by stepCharge()) is caught-or-dodged
  // purely positionally -- it does not re-check canSee()/effectiveDetect()
  // before resolving. Without this, a player ducking into immunity mid-
  // telegraph can still die with the immunity HUD active. There is no
  // existing "clear every predator's charge" helper to reuse -- other call
  // sites each clear exactly one predator's charge inline; this is a new
  // all-predators loop.
  for(const p of predators){
    if(p.charge){ p.charge = null; p.chargeCooldown = CHARGE_COOLDOWN; }
  }
  activeCharges = 0;
  pushState({ chargeVisible: false, caveImmuneActive: true, caveImmuneTimeLeft: CAVE_IMMUNITY_TIME });
  caveImmuneStartCue();
}
// Like spotOnto, but scent isn't "being watched": no roar / screen flash / rear-up
// freeze. Just a growl and a straight line toward you -- the tell is behavioural
// (a predator that was ambling suddenly moves with purpose, and the hunt music
// picks up even though nothing looked at you), which is what makes it learnable
// without a tutorial or a status readout.
function scentOnto(p){
  if(p.scentLock > 0) return;   // already tracking off a scent cue: don't re-trigger the roar
  p.alertedBy = null;   // LUL-1857: scent-driven, not the carried cry
  p.state = 'chase'; p.scentLock = SCENT_TRACK_TIME; p.callTimer = rnd(2.6,4.2);
  p.scentCalls++;               // QA-visible: e2e/scent.spec.ts asserts this stays low, not once-per-frame
  if(!p.spotted) p.spotted = true;
  predatorCall(p.kind, false, p);
  logChronicle('scent_lock', { kind: p.kind, landmark: nearestLandmarkName(p.x, p.z, LANDMARKS, CONFIG.home, CONFIG.lake) });
  scentLockEventCount++;   // LUL-2230: the trail caption dismisses itself on the first one of these
}

// ---- Sound: footstep noise as a third detection channel (LUL-39) ---------
// Weaker than sight (spotOnto: instant chase, alert rear-up, roar) and weaker
// than scent (scentOnto: instant chase, held by the scentLock leash
// exemption) -- noise instead drops a roaming predator straight into the
// existing investigate (approach -> sniff -> back) loop untouched by LUL-22,
// same state a chase already falls back to on losing sight. That loop is
// explicitly not to be retuned (see the block below), so this only adds a
// new *trigger* into it; the scentLock trap documented at
// [[game/lul23-scent-review]] doesn't apply here since investigate was never
// gated by the chase leash to begin with.
//
// No second broadphase: noise radius is a single number derived from the
// player's own speed each frame (tick()'s movement block), so checking it is
// one distance compare per predator per frame -- the same shape checkScent()
// already runs, just without a persisted point array. Nothing here touches
// the 8-unit tree hash (`grid`/`coverGrid`); there is nothing for it to help
// with when the query is "distance from the player," not "what's nearby."
// LUL-593: NOISE_RADIUS_WALK/RUN and the hear-roll predicate now live in
// lib/game/noise.ts, unit tested there -- imported at the top of this file.
function checkNoise(p, dist, noiseRadius, dt){ return isNoiseHeard(dist, noiseRadius, dt); }
// Commit to the investigate loop toward wherever the player currently is --
// same target the loop already uses when a chase loses sight (LUL-22: `desx,
// desz` there are recomputed from live player position every tick, not a
// stored point), so "last noisy position" falls out of that existing
// approach behavior for free.
function hearNoise(p){
  p.alertedBy = null;   // LUL-1857: footstep-driven, not the carried cry -- see triggerDeath(:1879)'s cause override
  p.state = 'investigate'; p.inv = 'approach'; p.sniffsLeft = rollSniffs(rng, 4);
  p.callTimer = rnd(2.6, 4.2);   // LUL-1610: callTimer was 0 on first noise-catch, causing instant roar on chase entry
  leafRustle(false);              // distinct from sight sting (spotSting) -- quieter rustle, not the big roar
  if(captionsOn){
    const b = bearingOf(p.x, p.z, player.x, player.z, player.yaw);
    const near = b.dist < 30 ? 'near' : 'far';
    pushState({ caption: `${p.kind} heard you · ${near} · ${b.side}`, captionId: ++captionSeq });
  }
}
// LUL-1623: same investigate/approach/sniff/back loop as hearNoise(), but the
// approach sub-phase targets the thrown object's landing point instead of the
// live player -- see the noiseTarget override in updatePredators()'s approach
// branch below. No new p.state/p.inv value; see spec §4.6 for the correctness
// fix this makes to the CTO plan's literal "reuse hearNoise() unchanged."
function hearThrowableNoise(p, tx, tz){
  p.state = 'investigate'; p.inv = 'approach'; p.sniffsLeft = rollSniffs(rng, 4);
  p.callTimer = rnd(2.6, 4.2);
  p.noiseTarget = { x: tx, z: tz };
  p.noiseTargetT = rnd(THROWABLE_INVESTIGATE_TIME[0], THROWABLE_INVESTIGATE_TIME[1]);
  if(captionsOn) pushState({ caption: `${p.kind} investigates a noise`, captionId: ++captionSeq });
}
// LUL-1255 (Ship 1 wayfinding S3): modeled on hearThrowableNoise() above, not
// hearNoise() -- this needs the point-target override (p.noiseTarget), not
// hearNoise()'s live-player commit. Unlike a thrown decoy's landing spot, the
// cry's source doesn't move and keeps sounding, so there is no timeout:
// p.noiseTargetT stays Infinity and only clears when stepApproach's own
// enterSniff fires (arrival), never by expiry reverting to the live player --
// an expiry-revert here would silently reintroduce the live-player-target bug
// this section exists to fix (see S3a of the wayfinding spec).
function hearCry(p){
  p.alertedBy = 'cry';   // LUL-1857 mitigation 4: lets triggerDeath(:1879) name "heard the child"
  p.state = 'investigate'; p.inv = 'approach'; p.sniffsLeft = rollSniffs(rng, 4);
  p.callTimer = rnd(2.6, 4.2);
  p.noiseTarget = { x: baby.x, z: baby.z };
  p.noiseTargetT = Infinity;
}

// LUL-1258: the mission waypoint's hum -- same tempo-carries-distance shape
// Ship 1 specs for the child's cry (docs/specs/lul-1255-wayfinding-ship1.md
// S3d), applied to the mission target instead of the baby. Deliberately NOT
// predator-audible (unlike the child's cry) -- this is a detour aid, not a
// second "wayfinding that makes the forest more dangerous" mechanic; scope
// per this ticket is the nav cue only, not a new detection surface (S4).
// LUL-1255 (Ship 1 wayfinding S3d): procedural cry, panned by bearing to the
// child's fixed spawn point. Same tempo/pitch-carries-distance shape as
// missionWaypointHum() below (LUL-1258 built that one by mirroring this
// unbuilt spec), just target = baby.x/z instead of a mission target, and a
// higher/brighter base frequency so the two cues stay distinguishable by ear.
function childCry(distToPlayer, srcX, srcZ){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const near = Math.max(0, Math.min(1, 1 - distToPlayer / 140));   // 0 far .. 1 close
  const pan = ctx.createStereoPanner();
  const dx = srcX - player.x, dz = srcZ - player.z;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx =  Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  const right = dx*rx + dz*rz, fwd = dx*fx + dz*fz;
  pan.pan.value = Math.max(-1, Math.min(1, right / Math.max(1, Math.hypot(right, fwd))));
  const o = ctx.createOscillator(); o.type = 'sine';
  const baseF = 420 + near * 90;   // higher/brighter than the mission hum (220 + near*60)
  o.frequency.setValueAtTime(baseF, t);
  o.frequency.exponentialRampToValueAtTime(baseF * 1.25, t + 0.22);
  o.frequency.exponentialRampToValueAtTime(baseF, t + 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.04 + near * 0.05, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  o.connect(g); g.connect(pan); pan.connect(master); pan.connect(conv);
  o.start(t); o.stop(t + 0.75);
  if(captionsOn){
    const cnear = distToPlayer < 30 ? 'near' : 'far';
    const side = Math.abs(right) < Math.abs(fwd)*0.6 ? (fwd >= 0 ? 'ahead' : 'behind') : (right > 0 ? 'right' : 'left');
    pushState({ caption: `a child crying · ${cnear} · ${side}`, captionId: ++captionSeq });
  }
}
function missionWaypointHum(m, distToPlayer){
  if(!audio || !soundOn || !m || m.status !== 'active') return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const near = Math.max(0, Math.min(1, 1 - distToPlayer / 140));   // 0 far .. 1 close
  const pan = ctx.createStereoPanner();
  const dx = m.target.x - player.x, dz = m.target.z - player.z;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx =  Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  const right = dx*rx + dz*rz, fwd = dx*fx + dz*fz;
  pan.pan.value = Math.max(-1, Math.min(1, right / Math.max(1, Math.hypot(right, fwd))));
  const o = ctx.createOscillator(); o.type = 'sine';
  const baseF = 220 + near * 60;   // lower/duller than the child's cry so the two cues stay distinguishable
  o.frequency.setValueAtTime(baseF, t);
  o.frequency.exponentialRampToValueAtTime(baseF * 1.25, t + 0.22);
  o.frequency.exponentialRampToValueAtTime(baseF, t + 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.04 + near * 0.05, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  o.connect(g); g.connect(pan); pan.connect(master); pan.connect(conv);
  o.start(t); o.stop(t + 0.75);
  if(captionsOn){
    const cnear = distToPlayer < 30 ? 'near' : 'far';
    const side = Math.abs(right) < Math.abs(fwd)*0.6 ? (fwd >= 0 ? 'ahead' : 'behind') : (right > 0 ? 'right' : 'left');
    pushState({ caption: `something metal, underwater · ${cnear} · ${side}`, captionId: ++captionSeq });
  }
}

// ---- Positional hiding / detection (LUL-43, LUL-22) -----------------------
// `hidden` (declared with the rest of player state below) is now purely the
// hold-still stance: it lowers eye height and silences footsteps, same as
// before, but no longer gates detection by itself. Detection is canSee(): a
// raycast for line of sight (against cover AABBs only, XZ-only like every
// other distance check in this file) combined with an effective detect range
// that shrinks the longer you've held still. It never reaches zero, so
// standing still in the open next to a predator still gets you caught.
//
// LUL-212: entering `hidden` in the first place is now gated on standing at
// a dedicated hiding-spot prop (findHideSpot(), below) -- this block's LOS
// math is otherwise untouched, so cover still blocks sight for anyone
// walking behind a rock or a tree exactly as before, hidden or not.
// LUL-425: hasLOS/findHideSpot (and segRayVsAABB, which only hasLOS used)
// now live in lib/game/cover.ts, unit-tested there. These are thin wrappers
// that inject the engine's own coverGrid closure state -- every call site
// below is unchanged.
//
// LUL-641: effectiveDetect()/canSee() now delegate to cover.ts's copy --
// the mist-veil ramp that used to force an engine-local fork (LUL-382:
// veilDetectMul(veilAmount) has no equivalent in the old lightDimmed/
// DIM_DETECT_MUL model) is now just another factor the caller folds into
// `detectMul` before calling, same as DIFFICULTY_PRESETS[difficulty]
// .detectMul already was. Stacks multiplicatively with stillness, same
// relationship as before: hiding still + veil is the strongest state.
// Sight only -- p.spec.scent is untouched, a deliberate scope choice (real
// mist/smoke obscures sightlines, not scent; genre precedent LUL-215
// search treats smoke/flare tools as breaking line-of-sight specifically) --
// a predator can still scent-lock you through the veil, keeping scent-trail
// play (LUL-23/LUL-65) meaningful.
function hasLOS(x0,z0,x1,z1){ return geoHasLOS(x0,z0,x1,z1,coverGrid,CELL,WRAP_SPAN); }
function findHideSpot(x,z){ return geoFindHideSpot(x,z,coverGrid,CELL,WRAP_SPAN); }
// LUL-27: fogTideDetectMul(fogTideAmountAt(p.x, p.z, ...)) stacks the same way
// veilDetectMul does -- multiplicatively, sight only. A player who's also
// holding the veil during a tide gets both cuts; that's intended, not a
// double-count bug (the two systems represent different things -- a spent
// resource vs. a free world event -- and nothing says they shouldn't
// compound). LUL-1486: the tide amount is now sampled at the predator's own
// position (D2), not a whole-world constant -- see lib/game/fogTide.ts.
function effectiveDetect(p){
  if(isCaveImmune(caveImmuneT)) return 0;
  return geoEffectiveDetect(p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmountAt(p.x, p.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)) * timeOfRunDetectMul(timeOfRun), { hidden, hideTime, carrying });
}
function canSee(p, dist){
  if(isCaveImmune(caveImmuneT)) return false;
  return geoCanSee(dist, p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmountAt(p.x, p.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)) * timeOfRunDetectMul(timeOfRun), { hidden, hideTime, carrying }, p.x, p.z, player.x, player.z, coverGrid, CELL, WRAP_SPAN, p.rad + CATCH_MARGIN);
}

// ---- Wolf pack coordination (LUL-24) ---------------------------------------
// Wolves only -- bears stay solitary (the contrast is the point) and lions'
// two-stage stalk/circle is reserved for after cover+scent mature further.
// Spec: the instant one wolf enters `chase` (the "point"), the other two path
// to points +-60deg off the player's live escape heading, at ~1.4x each
// flanker's own current distance from the player, and hold an investigate/sniff
// there instead of beelining the player -- the pack reads as a closing shape,
// not three animals converging on one spot.
// LUL-593: leader selection (nearest chaser to the player) and the flank
// -point rotation+clamp math now live in lib/game/pack.ts, unit tested
// there -- imported at the top of this file. FLANK_RECOMPUTE/FLANK_ARRIVE_R/
// FLANK_SPEED_MUL also come from there; FLANK_ANGLE/FLANK_DIST_MUL are used
// only inside flankTarget() now, so they don't need an engine-local copy.
function updateWolfPack(dt){
  const wolves = predators.filter(p => p.kind === 'wolf' && !p.inert);   // LUL-26: parked wolves don't flank
  for(const p of wolves) if(p.packTimer > 0) p.packTimer -= dt;

  const chasers = wolves.filter(p => p.state === 'chase' || p.hunt);
  if(!chasers.length){
    // nothing hunting: any wolf still mid-flank stands down rather than
    // finishing a pincer around a threat that no longer exists
    for(const p of wolves) if(p.state === 'flank'){ p.state = 'roam'; p.spotted = false; p.inv = ''; }
    return;
  }
  // orient the pincer on whichever chaser is actually closest to the player
  const leader = chasers[selectPackLeaderIndex(chasers, player.x, player.z)];

  let side = -1;   // alternate the two flankers to opposite sides of the escape heading
  for(const p of wolves){
    if(p === leader || chasers.includes(p)) continue;   // already hunting on its own -- not a flanker
    if(p.packTimer > 0) continue;                        // recompute cap
    const [fx, fz] = flankTarget(player.x, player.z, escX, escZ, side, p.x, p.z, { half, zMax }, WRAP_SPAN);
    side *= -1;
    p.flankX = fx; p.flankZ = fz;
    p.state = 'flank'; p.inv = ''; p.packTimer = FLANK_RECOMPUTE;
  }
}

// LUL-213: once a charge resolves (either way) the same predator can't
// immediately roll for another -- without this a wolf that just missed you
// would be back in telegraph two frames later, since dist and LOS are still
// exactly where they were. Long enough to read as "that's over," short
// enough that a second charge later in the same chase is still in play.

function updatePredators(dt, noiseRadius, cryNoiseRadius){
  const tt = clock.elapsedTime;
  updateWolfPack(dt);
  for(const p of predators){
    if(p.inert) continue;   // LUL-26: parked out for the current difficulty preset
    const dx = wrapDelta(player.x, p.x, WRAP_SPAN), dz = wrapDelta(player.z, p.z, WRAP_SPAN), dist = Math.hypot(dx, dz) || 0.0001;
    const ux = dx/dist, uz = dz/dist;
    // LUL-1309: predators wade too -- same per-position terrain sample the
    // player already gets at :3173/:3179, applied to this predator's own (x,z).
    // LUL-1861: bog component dropped here -- LUL-1483's speed *= bogSpeedMultiplier(biomeAt(...))
    // below already applies bog once, terminally; keeping it here too double-applies it.
    const pLakeMul = lakeSpeedMultiplier(inLakeWater(p.x, p.z, CONFIG.lake));
    let desx = 0, desz = 0, speed = 0, facePlayer = false;

    // ticks in every state, so a lock set during `chase` has actually
    // expired by the time `roam` re-checks it (see lib/game/predator.ts)
    const timers = tickTimers({ scentLock: p.scentLock, chargeCooldown: p.chargeCooldown }, dt);
    p.scentLock = timers.scentLock; p.chargeCooldown = timers.chargeCooldown;
    // LUL-437: post-sniff re-detection grace, same unconditional-every-state
    // decay as the timers above -- not folded into tickTimers() itself since
    // that helper's shape is deliberately pinned to scentLock/chargeCooldown
    // (see its own comment) and this field has nothing to do with either.
    if(p.sniffImmuneT > 0) p.sniffImmuneT -= dt;

    // LUL-213: an active charge owns movement outright until it resolves --
    // skips the roam/chase/investigate/flank chain below entirely, same as
    // the `hunt`/`alert` overrides already do, so it can't fight them for
    // desx/desz/speed.
    if(p.charge){
      const cs = stepCharge(p.charge, dt, jumpPressed);
      if(cs.phase === 'caught'){
        // LUL-421: persisted past the p.charge=null below so a QA hook can
        // still read it after resolution -- see qaChargePhase's fallback.
        p.lastCharge = { result: 'caught', overshootDuration: 0 };
        p.charge = null;
        endChargeHud();
        triggerDeath(p.kind, 'charge');   // LUL-1194: telegraphed charge, missed the dodge window
      } else if(cs.phase === 'cleared'){
        // stepCharge() (lib/game/charge.ts) zeroes overshootDuration on the
        // 'cleared' state it returns, so read it off the *old* p.charge
        // (still the value that governed this overshoot run) before it's
        // gone -- see qaChargePhase's fallback for why this is kept at all.
        p.lastCharge = { result: 'cleared', overshootDuration: p.charge.overshootDuration };
        p.charge = null; p.chargeCooldown = CHARGE_COOLDOWN;
        // "the animal continue... than continue normally": rejoin the
        // existing investigate/approach loop (LUL-22, not to be retuned)
        // rather than snapping straight back into a full chase mid-overshoot
        // -- it just sprinted past you and has to notice you again.
        p.state = 'investigate'; p.inv = 'approach'; p.sniffsLeft = rollSniffs(rng, 3);
        endChargeHud();
      } else {
        p.charge = cs;
        facePlayer = cs.phase === 'telegraph';
        if(cs.phase !== 'telegraph'){ desx = p.chargeDirX; desz = p.chargeDirZ; speed = chargeSpeed(cs.distance); }
      }
    }
    // LUL-1482 fix (review LUL-1728): this branch must run *before* the
    // generic `p.alert > 0` check below. It mirrors the tell's remaining
    // time into p.alert every frame it runs (for the shared rear-up
    // animation), which means the very next frame `p.alert > 0` would also
    // be true -- if that check came first (as originally written) it would
    // win priority, decrement p.alert on its own independent schedule, and
    // never call stepSightLock or re-check canSee() again until p.alert
    // decayed back to 0. Net effect measured in review: the tell took ~4.1s
    // to resolve instead of the spec's 0.35s (~12x), because `t` only
    // advanced by one frame's dt per ~20-frame detour through the alert
    // branch. Giving p.sightLock priority here means it owns facePlayer/
    // speed/alert every single frame while active, so stepSightLock (and
    // therefore the LOS re-check) runs every frame as intended.
    else if(p.sightLock){
      // LUL-1482: mid carry-only sight-acquisition tell (lib/game/sightLock.ts).
      // Frozen, facing the player -- reuses the alert>0 branch's own rear-up
      // animation for free (`alerting = p.alert > 0`, :1548) by mirroring the
      // tell's remaining time into p.alert every frame; there is no second
      // animation to build.
      facePlayer = true; speed = 0;
      const stillVisible = canSee(p, dist);
      p.sightLock = stepSightLock(p.sightLock, dt, stillVisible);
      p.alert = p.sightLock.phase === 'spotting' ? SIGHT_TELL_TIME - p.sightLock.t : 0;
      if(p.sightLock.phase === 'locked'){ p.sightLock = null; spotOnto(p, { skipAlert: true }); }
      else if(p.sightLock.phase === 'cancelled'){ p.sightLock = null; }
    }
    // spot "alert": brief rear-up + freeze the instant it locks on
    else if(p.alert > 0){
      p.alert -= dt; facePlayer = true; speed = 0;
      // (movement handled below; the rear is applied in the animation section)
    } else if(p.reroute > 0){                        // stuck → back up along its trail, then a different way
      p.reroute -= dt;
      const bx=p.rrX-p.x, bz=p.rrZ-p.z, bd=Math.hypot(bx,bz);
      if(bd > 0.4){ desx=bx/bd; desz=bz/bd; speed=p.spec.speed*0.7*pLakeMul; }
      if(p.reroute <= 0) p.stuckT = 0;
    } else if(p.hunt){                                // forced: comes straight for you while it can see you (no giving up otherwise)
      if(!canSee(p, dist)){
        // LUL-2246: a live force-hunt lock means this collapse is the 30s escalation
        // losing sight, not an ordinary hunt -- route into the existing scentLock blind-
        // chase path (`p.state === 'chase'`, :2037) at full species speed instead of the
        // 0.45x `approach` sub-phase (lib/game/predator.ts stepApproach()). Ordinary
        // (non-escalated) hunts, e.g. LUL-26 preset `startHunting`, still fall through to
        // the pre-existing investigate/approach collapse below, unchanged.
        if(p.scentLock > 0){ p.state='chase'; p.hunt=false; }
        else { p.state='investigate'; p.inv='approach'; p.sniffsLeft=rollSniffs(rng, 4); p.hunt=false; }
      }
      else {
        if(isCaught(dist, p.rad)) triggerDeath(p.kind, 'hunt');   // LUL-1194: the 30s force-hunt escalation caught up
        else { desx=ux; desz=uz; speed=p.spec.speed*pLakeMul; }
        if(dist < 8) p.hunt = false;                   // reached you → back to normal
        p.callTimer -= dt; if(p.callTimer <= 0){ predatorCall(p.kind, false, p); p.callTimer = rnd(2.6,4.6); }
      }
    } else if(p.state === 'roam'){
      // LUL-437: a predator lands in `roam` right on top of the scent point
      // that pulled it into investigate/flank in the first place (that's why
      // it was sniffing there) -- without this gate, giving up a sniff and
      // re-checking canSee/checkScent/checkNoise unconditionally the very
      // next tick reacquired near-instantly, reading as "sniffing always
      // ends in getting caught" rather than the predator actually losing you.
      // Wandering (the `else` block below) still runs during the immunity --
      // only re-detection is suppressed, so it isn't frozen in place.
      const sniffImmune = isSniffImmune(p.sniffImmuneT, hidden);
      if(!sniffImmune && canSee(p, dist)){
        if(carrying){ p.sightLock = startSightLock(); facePlayer = true; }
        else spotOnto(p);
      }
      else if(!sniffImmune && checkScent(p)){ scentOnto(p); }
      else if(!sniffImmune && checkNoise(p, dist, noiseRadius, dt)){ hearNoise(p); }
      // LUL-1255 (Ship 1 wayfinding S3): the cry is a second, independent
      // hearing check against the child's actual position, not the player's --
      // see S3 of the wayfinding spec for why this can't reuse
      // checkNoise/hearNoise's live-player target. Cry stays last since it's
      // the newest, lowest-priority-to-reach channel (sight, scent, footstep,
      // then cry).
      else if(!sniffImmune && !baby.taken && checkNoise(p, Math.hypot(baby.x - p.x, baby.z - p.z), cryNoiseRadius, dt)){
        hearCry(p);
      }
      else if(!sniffImmune && carrying && carriedCryPulse && dist < CARRIED_NOISE_FLOOR){
        // LUL-1857: pulse-fired, not a continuous isNoiseHeard() roll (mitigation 2)
        // -- deterministic proximity check at the moment the cry sounds, same shape
        // as checkThrowableNoise()'s one-shot design (lib/game/noise.ts). `dist` here
        // is already the live predator-to-*player* distance computed at the top of
        // this loop -- correct source position for the carry leg since the child
        // moves with the player and baby.x/z is not live during carry (see
        // childCry() fix above).
        hearNoise(p);   // commits to investigate/approach targeting the live player position -- exactly the carry-leg contract (the "noise source" moves with you)
        p.alertedBy = 'cry';   // LUL-1857 mitigation 4 (LUL-2194): tag the carry-leg cry channel too, same as hearCry()'s outbound-cry tagging below, so triggerDeath() can name "heard the child" on this catch path as well
      }
      else {
        let wx=p.wpx-p.x, wz=p.wpz-p.z; const wd=Math.hypot(wx,wz);
        if(wd < 2.5){
          const distFromLkp = Math.hypot(player.x - p.lkpX, player.z - p.lkpZ);
          const pick = pickRoamWaypoint(rng, p.x, p.z, p.lkpX, p.lkpZ, p.lkpSweeps, distFromLkp, half);
          p.lkpSweeps = pick.sweepsLeft;
          let nwx = Number.isFinite(WRAP_SPAN) ? wrapCoord(pick.x, WRAP_SPAN) : clamp(pick.x,-half+4,half-4);
          let nwz = Number.isFinite(WRAP_SPAN) ? wrapCoord(pick.z, WRAP_SPAN) : clamp(pick.z,-half+4,zMax-4);
          const kept = keepWaypointOffLake(nwx, nwz, CONFIG.lake);
          p.wpx = Number.isFinite(WRAP_SPAN) ? wrapCoord(kept.x, WRAP_SPAN) : clamp(kept.x,-half+4,half-4);
          p.wpz = Number.isFinite(WRAP_SPAN) ? wrapCoord(kept.z, WRAP_SPAN) : clamp(kept.z,-half+4,zMax-4); }
        else { desx=wx/wd; desz=wz/wd; speed=2.3; }
      }
    } else if(p.state === 'chase'){
      // While scentLock (LUL-23) holds, this chase was triggered by a stale
      // trail, not a live sighting -- scentOnto()'s contract is "a growl and a
      // straight line toward you", not "until I next lose sight of you".
      // Gating on canSee() unconditionally (LUL-22, for the spotted case)
      // froze every scent chase solid: a trail is by definition beyond detect
      // range when picked up, so canSee() is false the very next tick,
      // chase->investigate fires, and investigate bounces straight back to
      // chase since the player isn't hidden -- zero-speed forever. Keep
      // chasing blind while scentLock holds; once it expires, gate on sight
      // the same way a spotted chase always has.
      if(p.scentLock <= 0 && !canSee(p, dist)){ p.state='investigate'; p.inv='approach'; p.sniffsLeft = rollSniffs(rng, 4); }
      // LUL-213: wolf/lion only (bear stays the slow unavoidable threat --
      // contrast is the point, same call LUL-24 made for pack flanking).
      // canSee(p,dist) here (not just the enclosing branch, which also
      // allows a blind scentLock chase through) is "the predator sees you";
      // playerCanSee(p) is the founder's "always only when the user sees the
      // target" -- both have to hold or the telegraph never starts.
      else if((p.kind === 'wolf' || p.kind === 'lion') && p.chargeCooldown <= 0
              && canSee(p, dist) && playerCanSee(p) && shouldTriggerCharge(dist, dt)){
        // Commit to the heading right now, not a homing one -- a telegraphed
        // charge is dodgeable specifically *because* the animal has
        // committed to a line, same as the real thing.
        p.charge = startCharge(dist);
        p.chargeDirX = ux; p.chargeDirZ = uz;
        beginChargeHud();
      }
      else {
        // LUL-387: gate the kill on an actual sightline, not just distance --
        // see canCatchInChase()'s comment. Without this, a predator still
        // mid-blind-chase (scentLock > 0) can catch the player straight
        // through the cover prop breaking canSee() right now, since
        // predators never physically collide with cover (LUL-119/LUL-211).
        // LUL-1857 mitigation 4 (recommended): a chase this predator only entered because
        // it heard the carried child's cry gets a distinguishable death cause -- see
        // hearCry()/the carriedCryPulse branch below for where p.alertedBy is set, and
        // hearNoise()/scentOnto()/spotOnto() for where it's cleared by every other channel.
        if(canCatchInChase(canSee(p, dist), dist, p.rad)){ triggerDeath(p.kind, p.alertedBy === 'cry' ? 'heard' : 'chase'); }   // LUL-1194: run down mid-chase, in the open
        // LUL-2320 (D): contact was reached (isCaught) but the kill was refused because the
        // player is hidden and canSee() still reads false at that exact range -- e.g. (B)'s
        // contact-range exception only fires while the target point is inside a HIDE_KINDS
        // footprint (insideHideFootprint()); a hidden player who is otherwise concealed (a
        // blind scentLock chase closing through real, solid cover, LUL-387's original case)
        // can still reach literal contact range before canSee() ever reads true. Without
        // this, the `else` below keeps steering
        // `desx=ux;desz=uz` at full species speed directly at the player's exact position --
        // already in contact, so every subsequent tick re-aims at (near-)zero distance,
        // reading as the reported "stands on the player, pushes, jitters" glue. Drop straight
        // into the sniff loop's approach->standoff hand-off (LUL-1090) instead of waiting for
        // shouldGiveUpChase()'s distance/timer give-up below to eventually fire.
        else if(hidden && isCaught(dist, p.rad)){
          p.state = 'investigate'; p.inv = 'approach'; p.sniffsLeft = rollSniffs(rng, 4);
        }
        else { desx=ux; desz=uz; speed=p.spec.speed*pLakeMul; }
        if(shouldGiveUpChase(p.scentLock, dist, effectiveDetect(p))){ p.state='roam'; p.spotted=false; logChronicle('predator_gave_up', { kind: p.kind }); }
        p.callTimer -= dt; if(p.callTimer <= 0){ predatorCall(p.kind, false, p); p.callTimer = rnd(2.6,4.6); }
      }
    } else if(p.state === 'investigate'){
      // Deliberately still gated on `hidden` (hold-still), not canSee(): once a
      // predator has closed to sniff range it is often standing right next to
      // you, and cover only blocks LOS, not its movement, so canSee() would
      // flicker true the instant it steps past whatever broke LOS in the first
      // place. The re-escalation the sniff loop actually cares about is "did
      // you stop hiding" (move), which `hidden` already answers, and the
      // ticket is explicit: don't retune this loop's timing.
      //
      // LUL-562: restricted to the 'sniff'/'back' sub-phases this comment is
      // actually about (LUL-1090 added 'standoff' to that same set -- see
      // shouldRevertInvestigateToChase()'s comment for why it's safe there) --
      // a freshly-entered 'approach' (every chase->investigate transition sets
      // p.inv='approach') used to hit this same instant revert before its own
      // movement branch below ever ran, and chase's re-entry condition was
      // still true a frame later since nothing had moved -- volleying
      // chase<->investigate forever at zero velocity. See
      // shouldRevertInvestigateToChase()'s comment in lib/game/predator.ts and
      // wiki game/lul223-chase-investigate-livelock for the confirmed repro.
      if(shouldRevertInvestigateToChase(p.inv, hidden)){ p.state='chase'; }
      else if(p.inv === 'approach'){
        // LUL-658: always report this tick's movement, even when it's also the
        // tick that reaches sniff range -- see stepApproach()'s comment in
        // lib/game/predator.ts for why skipping movement on the transition tick
        // let the chase<->investigate/sniff bounce (LUL-562) freeze bear solid
        // at point-blank range instead of resolving into a real chase.
        facePlayer = true;
        // LUL-1623: while a thrown decoy is active, redirect the approach
        // target to its landing point instead of the live player -- ux/uz/dist
        // themselves (computed above, per-predator) are untouched and every
        // other branch/consumer keeps using live-player distance/direction
        // exactly as today. See spec §4.6 for why hearNoise()'s unmodified
        // approach (always live-player) would have made throwing a no-op.
        let aux = ux, auz = uz, adist = dist;
        if(p.noiseTarget){
          const ndx = p.noiseTarget.x - p.x, ndz = p.noiseTarget.z - p.z;
          adist = Math.hypot(ndx, ndz) || 0.0001;
          aux = ndx / adist; auz = ndz / adist;
        }
        const step = stepApproach(aux, auz, p.spec.speed*pLakeMul, adist, p.rad);
        desx = step.desx; desz = step.desz; speed = step.speed;
        if(step.enterSniff){
          // LUL-1090: a hidden player gets walked back to SNIFF_STANDOFF
          // before the predator settles into 'sniff' -- stepApproach() alone
          // stops at rad+SNIFF_APPROACH_MARGIN, only 2.5-3.2 units out. A
          // player caught in the open (not hidden) is unaffected: this
          // predator has them in the open and should still close.
          const standoff = hidden ? sniffStandoffPoint(p.x, p.z, aux, auz, adist, half, zMax) : null;
          if(standoff){ p.inv='standoff'; [p.standX, p.standZ] = standoff; }
          else { p.inv='sniff'; p.sniffTimer = rnd(1,5); sniff(); }
        }
        if(p.noiseTarget){
          p.noiseTargetT -= dt;
          if(p.noiseTargetT <= 0 || step.enterSniff) p.noiseTarget = null;
        }
      } else if(p.inv === 'standoff'){
        // LUL-1090: walk to the standoff point computed above, facing the
        // player the whole way (retreating from a threat while watching it),
        // then settle into the normal sniff loop unchanged.
        facePlayer = true;
        const sx=p.standX-p.x, sz=p.standZ-p.z, sd=Math.hypot(sx,sz);
        if(sd < 2){ p.inv='sniff'; p.sniffTimer = rnd(1,5); sniff(); }
        else { desx=sx/sd; desz=sz/sd; speed=p.spec.speed*0.45*pLakeMul; }
      } else if(p.inv === 'sniff'){
        facePlayer = true; p.sniffTimer -= dt;
        const sniffOutcome = stepSniffLoop(p.sniffTimer, p.sniffsLeft);
        if(sniffOutcome.done){
          p.sniffsLeft = sniffOutcome.sniffsLeft;
          p.sniffImmuneT = SNIFF_IMMUNITY_TIME;   // LUL-437: grace before re-detection, either transition
          if(sniffOutcome.next === 'back'){ p.inv='back'; const bd = 8 + rng()*8;
            [p.backX, p.backZ] = backOffPoint(p.x, p.z, ux, uz, bd, half, zMax, WRAP_SPAN); }
          else if(hidden && carrying){
            // LUL-1857 (carried-cry-fairness §A5): route the give-up through the
            // same backoff helper the mid-loop 'back' path uses, but land in 'roam'
            // on arrival (not 'approach' -- there's nothing left to sniff). Scoped to
            // hidden+carrying only, per the verdict's own scope (§A5) -- the ordinary
            // (non-carrying) give-up keeps its existing in-place behavior unchanged,
            // an intentional, not-yet-asked-for-elsewhere deviation from a uniform fix.
            const bd = 8 + rng()*8;
            [p.backX, p.backZ] = backOffPoint(p.x, p.z, ux, uz, bd, half, zMax, WRAP_SPAN);
            p.inv = 'leave';
          }
          else { p.lkpX=player.x; p.lkpZ=player.z; p.lkpSweeps=LKP_MAX_SWEEPS; p.state='roam'; p.spotted=false; logChronicle('predator_gave_up', { kind: p.kind }); }
        }
      } else if(p.inv === 'back'){
        const bx=p.backX-p.x, bz=p.backZ-p.z, bd=Math.hypot(bx,bz);
        if(bd < 2){ p.inv='approach'; } else { desx=bx/bd; desz=bz/bd; speed=p.spec.speed*0.5*pLakeMul; }
      } else if(p.inv === 'leave'){
        const bx=p.backX-p.x, bz=p.backZ-p.z, bd=Math.hypot(bx,bz);
        if(bd < 2){ p.lkpX=player.x; p.lkpZ=player.z; p.lkpSweeps=LKP_MAX_SWEEPS; p.state='roam'; p.spotted=false; p.inv=''; logChronicle('predator_gave_up', { kind: p.kind }); }
        else { desx=bx/bd; desz=bz/bd; speed=p.spec.speed*0.5*pLakeMul; }
      }
    } else if(p.state === 'flank'){
      // LUL-24: pack-ordered wolf, not independently hunting. Sight and scent
      // still work normally -- a flanker that stumbles onto the player still
      // spots/scents them -- this only replaces what it does with *no* signal.
      if(canSee(p, dist)){
        if(carrying){ p.sightLock = startSightLock(); facePlayer = true; }
        else spotOnto(p);
      }
      else if(checkScent(p)){ scentOnto(p); }
      else if(p.inv === 'hold'){
        // holding investigate *at the flank point*, deliberately not gated on
        // `hidden` like the sight-loss investigate loop above: this wolf never
        // had the player in sight to begin with, so "did they stop hiding" is
        // not a meaningful re-escalation signal here -- canSee()/checkScent()
        // above are the only way a hold converts to a real chase.
        p.sniffTimer -= dt;
        const holdOutcome = stepFlankHold(p.sniffTimer, p.sniffsLeft);
        if(holdOutcome.done){
          p.sniffsLeft = holdOutcome.sniffsLeft;
          p.sniffImmuneT = SNIFF_IMMUNITY_TIME;   // LUL-437: grace before re-detection, either transition
          if(holdOutcome.next === 'hold') p.sniffTimer = rnd(1,4);
          else { p.lkpX=player.x; p.lkpZ=player.z; p.lkpSweeps=LKP_MAX_SWEEPS; p.state='roam'; p.spotted=false; p.inv=''; logChronicle('predator_gave_up', { kind: p.kind }); }
        }
      } else {
        const fx=p.flankX-p.x, fz=p.flankZ-p.z, fd=Math.hypot(fx,fz);
        if(fd < FLANK_ARRIVE_R){ p.inv='hold'; p.sniffsLeft=rollSniffs(rng, 3); p.sniffTimer=rnd(1,4); sniff(); }
        else { desx=fx/fd; desz=fz/fd; speed=p.spec.speed*FLANK_SPEED_MUL*pLakeMul; }
      }
    }

    if(speed > 0 && (desx || desz)) [desx, desz] = avoidDir(p, desx, desz);

    // LUL-1483: wading, same as the player -- applied once here rather than
    // at each state branch above, since every one of them (hunt/chase/
    // investigate/flank/reroute/charge) already funnels into this one
    // `speed` read. Was previously player-only (bogSpeedMultiplier at
    // player-movement's maxSpd, above); predators waded at full land speed.
    speed *= bogSpeedMultiplier(biomeAt(p.x, p.z));

    // smooth velocity + collide with trees (axis-separated slide)
    const dvx = desx*speed, dvz = desz*speed, accel = speed > 0 ? 3.6 : 6;
    p.vx += (dvx - p.vx) * Math.min(1, dt*accel);
    p.vz += (dvz - p.vz) * Math.min(1, dt*accel);
    const px0 = p.x, pz0 = p.z;
    const nx = Number.isFinite(WRAP_SPAN) ? wrapCoord(p.x + p.vx*dt, WRAP_SPAN) : clamp(p.x + p.vx*dt, -half+2, half-2);
    const nz = Number.isFinite(WRAP_SPAN) ? wrapCoord(p.z + p.vz*dt, WRAP_SPAN) : clamp(p.z + p.vz*dt, -half+2, zMax-2);
    const blockedX = predatorBlocked(nx, p.z, p.rad), blockedZ = predatorBlocked(p.x, nz, p.rad);
    if(!blockedX) p.x = nx;
    if(!blockedZ) p.z = nz;
    if(blockedX || blockedZ) [p.vx, p.vz] = slideVelocity(p.vx, p.vz, blockedX, blockedZ);
    p.g.position.x = p.x; p.g.position.z = p.z;

    // trail + stuck detection (only while it actually wants to move)
    p.trailT -= dt;
    if(p.trailT <= 0){ p.trailT = 0.4; p.trail.push([p.x, p.z]); if(p.trail.length > 6) p.trail.shift(); }
    const moved = Math.hypot(p.x - px0, p.z - pz0);
    if(speed > 1 && p.reroute <= 0 && p.alert <= 0){
      if(moved < speed*dt*0.35) p.stuckT += dt; else p.stuckT = Math.max(0, p.stuckT - dt*2);
      if(p.stuckT > 3){                              // go back along the trail, then a different way
        const back = p.trail[0] || [p.x - ux*6, p.z - uz*6];
        p.rrX = back[0]; p.rrZ = back[1]; p.reroute = 1.4; p.stuckT = 0;
        // fresh, different waypoint (LUL-857: kept off the water same as the roam pick above)
        const freshx = Number.isFinite(WRAP_SPAN) ? wrapCoord(p.x + (rng()-0.5)*40, WRAP_SPAN) : clamp(p.x + (rng()-0.5)*40, -half+4, half-4);
        const freshz = Number.isFinite(WRAP_SPAN) ? wrapCoord(p.z + (rng()-0.5)*40, WRAP_SPAN) : clamp(p.z + (rng()-0.5)*40, -half+4, zMax-4);
        const freshKept = keepWaypointOffLake(freshx, freshz, CONFIG.lake);
        p.wpx = Number.isFinite(WRAP_SPAN) ? wrapCoord(freshKept.x, WRAP_SPAN) : clamp(freshKept.x, -half+4, half-4);
        p.wpz = Number.isFinite(WRAP_SPAN) ? wrapCoord(freshKept.z, WRAP_SPAN) : clamp(freshKept.z, -half+4, zMax-4);
      }
    }

    // smooth turning (toward heading, or toward you when facing), with a lean
    const vmag = Math.hypot(p.vx, p.vz);
    let targetYaw = p.yaw;
    if(facePlayer) targetYaw = Math.atan2(ux, uz);
    else if(vmag > 0.3) targetYaw = Math.atan2(p.vx, p.vz);
    let d = targetYaw - p.yaw; while(d > Math.PI) d -= 2*Math.PI; while(d < -Math.PI) d += 2*Math.PI;
    p.yaw += d * Math.min(1, dt*7);
    p.g.rotation.y = p.yaw;

    // ---- articulated animation ----
    const moving = vmag > 0.3;
    p.phase += dt * (moving ? vmag*0.9 : 1.4);
    const sniffing = (p.state==='investigate' && p.inv==='sniff') || (p.state==='flank' && p.inv==='hold');
    const alerting = p.alert > 0;
    // LUL-213: the readable tell -- stopped, tail up and wiggling, leaning
    // into the charge. Only true during the stationary half of the window
    // (see lib/game/charge.ts CHARGE_TELL_TIME); once it commits to
    // 'charging'/'overshoot' this goes false and the normal sprint gait
    // below (driven by vmag, now large from chargeSpeed()) takes over --
    // no separate charge-run animation needed.
    const telegraphing = !!p.charge && p.charge.phase === 'telegraph';
    // legs: diagonal gait (bend the knee on the forward swing)
    for(let i=0;i<p.legs.length;i++){
      const ph = p.phase + ((i===0||i===3) ? 0 : Math.PI);     // diagonal pairs
      const sw = moving ? Math.sin(ph)*0.5 : 0;
      p.legs[i].hip.rotation.x += (sw - p.legs[i].hip.rotation.x) * Math.min(1, dt*12);
      p.legs[i].knee.rotation.x += ((moving ? Math.max(0, Math.sin(ph+0.6))*0.7 : 0) - p.legs[i].knee.rotation.x) * Math.min(1, dt*12);
    }
    // body bob + gallop lean, torso sway, turn-lean
    const bob = moving ? Math.sin(p.phase*2)*0.05 : Math.sin(tt*1.5)*0.01;
    p.g.position.y = bob;
    p.torso.rotation.z += ((moving ? Math.sin(p.phase)*0.05 : 0) - p.torso.rotation.z) * Math.min(1, dt*8);
    p.g.rotation.z = clamp(-d*0.6, -0.22, 0.22);
    // neck/head: bob with gait, dip low to sniff, rear up when alerting, dip
    // forward into the lean when telegraphing a charge
    const neckTarget = telegraphing ? 0.1 : sniffing ? 0.9 : alerting ? -0.6 : (moving ? 0.5 + Math.sin(p.phase*2+1)*0.06 : 0.5);
    p.neck.rotation.x += (neckTarget - p.neck.rotation.x) * Math.min(1, dt*8);
    p.head.rotation.x += (((sniffing?0.5:0) + (alerting?-0.3:0)) - p.head.rotation.x) * Math.min(1, dt*6);
    // rear the whole body a touch when alerting; lean forward, front-loaded,
    // when telegraphing a charge (opposite sign and bigger than the alert
    // rear -- this is a wind-up, not a startle)
    const torsoLeanTarget = telegraphing ? 0.32 : (alerting ? -0.18 : 0);
    p.torso.rotation.x += (torsoLeanTarget - p.torso.rotation.x) * Math.min(1, dt*8);
    // tail sway -- raised and wiggling hard during the telegraph, normal
    // idle sway otherwise. rotation.x is only ever driven here (the mesh's
    // built-in 0.6 rad droop is a one-time creation-time pose), so it must
    // ease back to that baseline once telegraphing ends or the tail would
    // stay lifted forever.
    const tailLiftTarget = telegraphing ? -0.35 : 0.6;
    p.tail.rotation.x += (tailLiftTarget - p.tail.rotation.x) * Math.min(1, dt*8);
    const tailWiggleHz = telegraphing ? 14 : 3;
    const tailWiggleAmp = telegraphing ? 1.6 : 1;
    p.tail.rotation.z = Math.sin(tt*tailWiggleHz + p.phase)*0.18*tailWiggleAmp;
    p.tail2.rotation.z = Math.sin(tt*tailWiggleHz + p.phase + 0.8)*0.22*tailWiggleAmp;
  }

  // LUL-394: predator-vs-predator separation, second pass -- run after every
  // predator's own steering/movement above so this frame's positions are
  // final before checking overlap between them. updateWolfPack() (top of
  // this function) reads teammates' *state* for flank targeting, never
  // position, so ordering this pass last cannot fight it. Same
  // axis-separated "don't step into a blocked circle" guard the tree
  // collision above uses, just against another predator's circle instead of
  // a tree's.
  for(const p of predators){
    if(p.inert) continue;
    const others = predators.filter(q => q !== p && !q.inert);
    if(!others.length) continue;
    const [pushX, pushZ] = predatorSeparationPush(p.x, p.z, p.rad, others, WRAP_SPAN);
    if(!pushX && !pushZ) continue;
    const nx = Number.isFinite(WRAP_SPAN) ? wrapCoord(p.x + pushX, WRAP_SPAN) : clamp(p.x + pushX, -half+2, half-2);
    const nz = Number.isFinite(WRAP_SPAN) ? wrapCoord(p.z + pushZ, WRAP_SPAN) : clamp(p.z + pushZ, -half+2, zMax-2);
    if(!predatorBlocked(nx, p.z, p.rad)) p.x = nx;
    if(!predatorBlocked(p.x, nz, p.rad)) p.z = nz;
    p.g.position.x = p.x; p.g.position.z = p.z;
  }
}
// LUL-1914: slice (a), one-way feedback only. Reads p.x/p.z/p.state/p.inert on each
// active predator; writes nothing on any predator. Does not call effectiveDetect(),
// canSee(), or hearThrowableNoise() -- this is a spectator of predator state, not a
// participant. Cooldown array is reset in restart().
function updateRoosts(dt){
  updateRoostBursts(dt);
  for(let i=0;i<ROOSTS.length;i++){
    if(roostCooldown[i] > 0){ roostCooldown[i] -= dt; continue; }
    const r = ROOSTS[i];
    for(const p of predators){
      if(p.inert || p.state !== 'chase') continue;
      if(Math.hypot(p.x-r.x, p.z-r.z) < r.radius){
        flushRoost(i);
        roostCooldown[i] = ROOST_COOLDOWN;
        break;
      }
    }
  }
}
// lock onto the player: stinger, roar, screen flash, and a rear-up alert beat.
// `opts.skipAlert` (LUL-1482): true when this call is resolving a completed
// carry-only pre-lock tell (see the new p.sightLock branch in
// updatePredators()) -- the freeze+rear-up already played during the tell,
// so re-arming p.alert here would be a second, redundant freeze immediately
// after the first. Every other call site (outbound sight, scent, the 30s
// force-hunt escalation) omits opts and keeps today's behavior exactly.
function spotOnto(p, opts){
  const skipAlert = !!(opts && opts.skipAlert);
  p.alertedBy = null;   // LUL-1857: sight-driven, not the carried cry
  p.state='chase'; p.callTimer=rnd(2.6,4.2); if(!skipAlert) p.alert = 0.55;
  if(!p.spotted){ p.spotted=true; }
  predatorCall(p.kind, false, p); spotSting(); spotFlash = 1;
}

// ---- Player + input ------------------------------------------------------
const player = { x:0, z:0, yaw:0, pitch:-0.02 };
const keys = {};
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let entered = false, walk = CONFIG.walk, won = false, canPickup = false,
    dead = false, pickingUp = false, carrying = false, babySetDown = false, pickStart = 0, hidden = false, hideTime = 0, eyeH = CONFIG.eye,
    deathStart = 0, deathShown = false, pickBoomed = false, scentEmitT = 0, enteredAt = 0,
    hideKind = null,   // LUL-212: which hiding-spot kind the player is currently in ('bramble'), for the exit sound
    jumping = false, jumpElapsed = 0, jumpPressed = false,   // LUL-213: see beginJump() / tick()'s jumpY
    missionCanComplete = false,   // LUL-1258: recomputed every tick alongside canPickup, below
    secondaryCanComplete = false,   // LUL-1666: same shape, for the retrieval item
    canBuyVeilCharm = false;   // LUL-1210: recomputed every tick alongside canPickup, below
let heldThrowable = false;
let hideEventCount = 0;       // LUL-2307: bumped by enterHide() -- dismiss-on-interaction for the wolf/bear/lion/cover hints
let throwableGrabCount = 0;   // LUL-2307: bumped by grabThrowable() -- dismiss-on-interaction for the throwable hint
let carryDeathExplained = false;   // LUL-1438: first carry death per page load
// LUL-1103: The Run Chronicle. Flat {t, code, args} buffer, reset per-run in
// enter() (covers restart() too, which calls enter()). Handed to React once,
// in the same pushState() call as winVisible/deathVisible -- NOT streamed
// live, because pushState's patch-merge does a shallow `!==` compare and a
// fresh array is always "changed", so logging this every frame would re-emit
// to React every frame. lib/game/chronicle.ts's formatChronicle() (pure, no
// DOM/Three.js) turns it into display lines; this file only appends codes.
let chronicle = [];
function logChronicle(code, args){
  chronicle.push({ t: Math.max(0, clock.elapsedTime - enteredAt), code, args: args || null });
  if(chronicle.length > 40) chronicle.shift();   // hard cap -- formatChronicle() also caps what it renders
}
// LUL-1194: the death cutscene is full-length and unskippable exactly once --
// the player's first-ever death -- and skippable by any input after that.
// Persisted across sessions (not just page load, unlike carryDeathExplained
// above) so it stays a one-time thing rather than resetting on every reload.
const HAS_DIED_KEY = 'lullwood:hasDied';
let hasDiedBefore = false;
try { hasDiedBefore = localStorage.getItem(HAS_DIED_KEY) === '1'; } catch(e){}
let cutsceneSkippable = false;   // set fresh on every triggerDeath(), read by the skip listeners below
// LUL-1043: Embers. `maxDistFromHome` is the run's displacement high-water
// mark (not `dist` below, which is path length) -- reset in enter(), read by
// arriveHome()/triggerDeath() for the payout's `depth` term. `embers` is the
// engine's own copy of the cross-run balance/tiers, synced from
// components/Hud.tsx's localStorage read via setEmbers() once on mount (same
// pattern as setDifficulty/setRunMode/etc. -- see SettingsPanel.tsx) and
// mutated in place by arriveHome/triggerDeath/purchaseDeeperLungs.
let maxDistFromHome = 0, embers = freshEmbersState(), embersSpent = 0;
// LUL-596: `won`/`dead`/`pickingUp`/`carrying`/`baby.taken` above stay the
// engine's own mutable locals (lib/game/outcome.ts is pure and holds no
// state of its own) -- this snapshots them into the RunState shape the
// module's pure functions read, on demand, right before each call.
function runState(){
  return { entered, won, dead, pickingUp, carrying, setDown: babySetDown, babyTaken: baby.taken };
}
// LUL-24: last normalized heading the player actually moved along -- the "escape
// vector" the wolf pack flanks off of. Only updated while moving (see tick()'s
// movement block), so it holds the most recent flight direction while the
// player is stationary or hiding, instead of snapping to a stale default.
let escX = 0, escZ = -1;

// LUL-213: always available while actually playing, not gated behind being
// chased -- "add jump support all the time by pressing space" per the ticket.
// Kept a plain function (not inlined in the keydown handler below) so the
// qaTriggerCharge QA hook can also drive a jump without dispatching a real
// DOM event.
function beginJump(){
  if(jumping) return;
  jumping = true; jumpElapsed = 0;
}

// LUL-26: accessibility settings. `reduce` above is the OS-level media query
// (already wired to head-bob/dust); `reducedMotionSetting` is the in-game
// toggle for players whose OS doesn't expose the preference. `motionReduced()`
// is the one place both are combined, so every consumer stays in sync.
let runMode = 'hold', toggleRunOn = false, sensMul = 1, invertY = false,
    reducedMotionSetting = false, captionsOn = false, captionSeq = 0;
function motionReduced(){ return reduce || reducedMotionSetting; }

// LUL-1194: any input skips the death cutscene straight to revealLoss(), on every
// death after the player's first. Independent of `playing` (false while dead), and
// deliberately not e.repeat-gated -- a held key still counts as "an input" here.
function skipCutsceneIfAllowed(){ if(dead && !deathShown && cutsceneSkippable) revealLoss(); }
on(window, 'pointerdown', skipCutsceneIfAllowed);   // covers both mouse click and touch tap
on(window, 'keydown', e => {
  keys[e.code] = true;
  skipCutsceneIfAllowed();
  const playing = isPlaying(runState());
  if(e.code === 'Escape' && playing){ if(locked) document.exitPointerLock(); else setPaused(true); }
  // LUL-26: toggle-run edge-triggers off keydown (not keyup) so the very
  // press that would have started a hold-run also starts a toggle-run --
  // `e.repeat` guards the OS's own key-repeat from flipping it back and forth.
  if((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && runMode === 'toggle' && !e.repeat && playing && !paused){
    toggleRunOn = !toggleRunOn;
  }
  // LUL-1258: no new key -- mission completion reuses the interact action.
  // LUL-1815: set-down is a third arm of the same multiplex -- carrying is mutually
  // exclusive with canPickup (pickupAllowed requires !carrying), so ordering vs.
  // canPickup doesn't matter, but it must come before missionCanComplete/grabThrowable
  // since carrying is already true whenever this arm should fire.
  if(e.code === 'KeyE' && playing && !paused){
    if(canPickup) pickup();
    else if(carrying) setDown();
    else if(canBuyVeilCharm) buyVeilCharm();
    else if(missionCanComplete) completeMissionSequence();
    else if(secondaryCanComplete) completeSecondarySequence();
    else grabThrowable();
  }
  if(e.code === 'KeyH' && playing && !paused) toggleHidden();
  // LUL-213: jumping stands you up first (same as any movement key already
  // does via the moveKey-breaks-hide check in tick()) -- a charge can still
  // catch a hidden player (STILL_DETECT_CUT never reaches 1), and jump is the
  // only way out of one, so it can't be blocked by being crouched.
  // e.repeat is dropped so holding Space down doesn't spam a jump every OS
  // auto-repeat tick; JUMP_DURATION is the only real cooldown once airborne.
  if(e.code === 'Space' && playing && !paused && !e.repeat){
    if(hidden) exitHide();
    beginJump();
    jumpPressed = true;   // consumed by updatePredators() this frame, then cleared in tick()
  }
});
on(window, 'keyup', e => { keys[e.code] = false; });

// Look: free mouse-look via Pointer Lock, with click-and-drag as a fallback
let dragging = false, locked = false, paused = false;
const el = renderer.domElement;
function applyLook(dx, dy){
  const s = SENS * sensMul, dyEff = invertY ? -dy : dy;
  player.yaw -= dx*s;
  player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch - dyEff*s));
}
function requestLock(){ if(el.requestPointerLock) el.requestPointerLock(); }
// LUL-276: these listeners are the desktop mouse-look mechanism -- byte-
// identical to before (SENS, pointer lock, movementX/movementY, drag
// fallback), just bound only in desktop mode. In mobile mode `locked`/
// `dragging` simply stay false forever and nothing here ever runs, so a
// stray mousemove/pointerlockchange can't reach player.yaw/pitch alongside
// the touch stick.
if(mode === 'desktop'){
  on(document, 'pointerlockchange', () => {
    locked = document.pointerLockElement === el;
    if(locked){
      setPaused(false);
    }
    else if(isPlaying(runState())) setPaused(true);     // Esc / released lock -> menu
  });
  on(document, 'pointerlockerror', () => { locked = false; });
  on(el, 'mousedown', () => {
    if(paused){ setPaused(false); requestLock(); return; }   // click to look again
    if(!locked){ dragging = true; el.style.cursor = 'grabbing'; return; }
    if(locked && heldThrowable && isPlaying(runState())) throwThrowable();
  });
  on(window, 'mouseup', () => { dragging = false; el.style.cursor = 'default'; });
  on(window, 'mousemove', e => {
    if(locked) applyLook(e.movementX, e.movementY);
    else if(dragging) applyLook(e.movementX, e.movementY);
  });
}
// LUL-68: twin-stick touch input — populated by the React MobileControls
// component via the action functions returned below. The old free-drag-anywhere
// touch look is removed; right stick replaces it with a rate-based camera.
const touchMove = { x: 0, z: 0 };   // normalised direction [-1..1]
const touchLook = { x: 0, y: 0 };   // stick offset [-1..1] → yaw/pitch rate
let touchSprint = false;
// LUL-529: touch analogue of holding KeyF (mist veil) -- read every frame
// alongside keys['KeyF'] below, same "hold" semantics, fed by a hold-button
// in MobileControls rather than a synthesized KeyboardEvent.
let touchVeil = false;

// ---- Procedural audio (built on first entry) -----------------------------
let audio = null, started = false, soundOn = true;
function noise(ctx, sec, brown){
  const len = Math.floor(ctx.sampleRate*sec), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for(let i=0;i<len;i++){ const w = Math.random()*2-1;
    if(brown){ last = (last + 0.02*w)/1.02; d[i] = Math.max(-1, Math.min(1, last*3.2)); } else d[i] = w; }
  return b;
}
function impulse(ctx, sec, decay){
  const len = Math.floor(ctx.sampleRate*sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for(let c=0;c<2;c++){ const d = b.getChannelData(c); for(let i=0;i<len;i++) d[i] = (Math.random()*2-1)*Math.pow(1-i/len, decay); }
  return b;
}
function startAudio(){
  const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return;
  const ctx = new AC();
  // LUL-1112: iOS constructs AudioContext in suspended state regardless of user
  // activation. Explicit resume() is required inside the gesture, even though
  // resume() on an already-running context is a spec no-op, so this is safe
  // on desktop and fixes silent audio on iOS.
  const r = ctx.resume && ctx.resume();
  if(r && r.catch) r.catch(function(){});
  const master = ctx.createGain(); master.connect(ctx.destination);
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(soundOn ? 0.6 : 0.0001, ctx.currentTime + 2);

  const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 2.4, 3.0);
  const rev = ctx.createGain(); rev.gain.value = 0.5; conv.connect(rev); rev.connect(master);

  // wind bed — brown noise through a lowpass, opens up as you move
  const wind = ctx.createBufferSource(); wind.buffer = noise(ctx, 3, true); wind.loop = true;
  const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 340; wf.Q.value = 0.6;
  const wg = ctx.createGain(); wg.gain.value = 0.06 * TOD_AUDIO.windGainMul;
  wind.connect(wf); wf.connect(wg); wg.connect(master); wg.connect(conv); wind.start();

  // insect bed -- filtered noise loop, silent (gain 0) outside daylight/dusk states
  const insects = ctx.createBufferSource(); insects.buffer = noise(ctx, 3, false); insects.loop = true;
  const inf = ctx.createBiquadFilter(); inf.type = 'bandpass'; inf.frequency.value = 4800; inf.Q.value = 1.4;
  const ing = ctx.createGain(); ing.gain.value = TOD_AUDIO.insectsGain;
  insects.connect(inf); inf.connect(ing); ing.connect(master); ing.connect(conv); insects.start();

  // low ominous drone
  const dg = ctx.createGain(); dg.gain.value = 0.05 * TOD_AUDIO.droneGainMul; dg.connect(master); dg.connect(conv);
  [55, 82.5, 110].forEach((f, i) => { const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
    o.detune.value=(i-1)*6; const og = ctx.createGain(); og.gain.value = i===2 ? 0.35 : 1;
    o.connect(og); og.connect(dg); o.start(); });
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
  const lfg = ctx.createGain(); lfg.gain.value = 0.02; lfo.connect(lfg); lfg.connect(dg.gain); lfo.start();

  // hunt cue — dissonant + pulsing, silent until a predator gives chase
  const huntGain = ctx.createGain(); huntGain.gain.value = 0.0001; huntGain.connect(master); huntGain.connect(conv);
  const hf = ctx.createBiquadFilter(); hf.type='lowpass'; hf.frequency.value=560; hf.Q.value=1.2; hf.connect(huntGain);
  [55, 77.78, 110].forEach((f, i) => { const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f;   // tritone-ish cluster
    o.detune.value=(i-1)*9; const og=ctx.createGain(); og.gain.value = i===2 ? 0.14 : 0.2; o.connect(og); og.connect(hf); o.start(); });
  const pulse = ctx.createOscillator(); pulse.type='sine'; pulse.frequency.value=110;   // heartbeat throb
  const pulseGain = ctx.createGain(); pulseGain.gain.value=0.02; pulse.connect(pulseGain); pulseGain.connect(huntGain);
  const plfo = ctx.createOscillator(); plfo.type='sine'; plfo.frequency.value=2.7;
  const plfg = ctx.createGain(); plfg.gain.value=0.08; plfo.connect(plfg); plfg.connect(pulseGain.gain); pulse.start(); plfo.start();
  const shimmer = ctx.createOscillator(); shimmer.type='triangle'; shimmer.frequency.value=1245;   // unease up high
  const shg = ctx.createGain(); shg.gain.value=0.012; shimmer.connect(shg); shg.connect(huntGain); shimmer.start();

  audio = { ctx, master, wf, wg, dg, huntGain, plfo, conv, foot: 0, twinkle: rnd(1.5,4), footBuf: noise(ctx, 0.3, false) };
  if (TOD_AUDIO.birdsGain > 0) scheduleBirdChirp();
}
function footstep(vol){
  const { ctx, conv, master, footBuf } = audio, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = footBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 150 + Math.random()*100; f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t+0.005); g.gain.exponentialRampToValueAtTime(0.0001, t+0.18);
  src.connect(f); f.connect(g); g.connect(master); g.connect(conv); src.start(t); src.stop(t+0.22);
}
// LUL-1644: self-scheduling ambient bird-chirp layer, active only in
// daylight/dawn/dusk states (TOD_AUDIO.birdsGain > 0) -- see startAudio().
function scheduleBirdChirp(){
  if (!audio || TOD_AUDIO.birdsGain <= 0) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noise(ctx, 0.08, false);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass';
  f.frequency.value = 2200 + Math.random() * 1800; f.Q.value = 4;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(TOD_AUDIO.birdsGain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  src.connect(f); f.connect(g); g.connect(master); g.connect(conv); src.start();
  const nextMs = (0.4 + Math.random() * 1.6) / TOD_AUDIO.birdsChirpHz * 1000;
  later(scheduleBirdChirp, nextMs);
}
// LUL-25: bog footstep foley -- a noise burst through a lowpass sweep (bright
// slap of impact dropping to a dull glug as the ripple settles), same
// building blocks as the rest of this file's all-procedural audio. Deliberately
// louder than footstep() (see the bogNoiseMultiplier call site) -- the whole
// point of wading through the bog is that it costs you on the sound channel.
function splash(vol){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const nb = ctx.createBufferSource(); nb.buffer = noise(ctx, 0.22, false);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(220, t+0.24);
  lp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t+0.006); g.gain.exponentialRampToValueAtTime(0.0001, t+0.26);
  nb.connect(lp); lp.connect(g); g.connect(master); g.connect(conv); nb.start(t); nb.stop(t+0.28);
}
// LUL-1209: stamina low-charge audio cue -- breath/exertion sound when player
// nears full sprint drain. A short tone burst at ~200Hz (breath pitch).
function staminaExertionCue(){
  if(captionsOn) pushState({ caption: 'breathing hard', captionId: ++captionSeq });
  if(!audio || !soundOn) return;
  const { ctx, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t+0.08); g.gain.exponentialRampToValueAtTime(0.0001, t+0.25);
  o.connect(g); g.connect(master); o.start(t); o.stop(t+0.27);
}
// LUL-212: enter/exit foley for the two hiding-spot kinds. Bandpass-filtered
// noise bursts, same building blocks as footstep()/the rest of this file --
// no audio files, per the engine's existing all-procedural-WebAudio approach.
// Bush: a few quick high, bright bursts read as individual leaves brushing
// past -- the "something is hiding in the brush" cue that's a common
// foley convention for stealth/horror games.
function leafRustle(entering){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const bursts = entering ? 3 : 2;
  for(let i=0; i<bursts; i++){
    const d = i*0.07 + Math.random()*0.03;
    const src = ctx.createBufferSource(); src.buffer = noise(ctx, 0.12, false);
    const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value = 2200 + Math.random()*1800; bp.Q.value = 0.9;
    const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value = 1200;
    const g = ctx.createGain();
    const vol = (entering ? 0.16 : 0.11) * (1 - i*0.25);
    g.gain.setValueAtTime(0.0001, t+d);
    g.gain.exponentialRampToValueAtTime(vol, t+d+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t+d+0.1);
    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(master); g.connect(conv);
    src.start(t+d); src.stop(t+d+0.14);
  }
}
// LUL-1255 (Ship 1 wayfinding S5): home-fire crackle, panned by bearing to
// CONFIG.home -- a short bandpassed noise burst, timbrally close to a dry-
// wood knock but softer and unpitched, no sine thump. Density (call
// interval), not pan, rises as the player nears home -- see homeFireTimer's
// countdown in tick().
function homeFireCrackle(dist){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const near = Math.max(0, Math.min(1, 1 - dist / 140));
  const pan = ctx.createStereoPanner();
  const dx = CONFIG.home.x - player.x, dz = CONFIG.home.z - player.z;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx =  Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  const right = dx*rx + dz*rz, fwd = dx*fx + dz*fz;
  pan.pan.value = Math.max(-1, Math.min(1, right / Math.max(1, Math.hypot(right, fwd))));
  const nb = ctx.createBufferSource(); nb.buffer = noise(ctx, 0.1, false);
  const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value = 220; bp.Q.value = 6;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.15 + near * 0.1, t+0.008); ng.gain.exponentialRampToValueAtTime(0.0001, t+0.16);
  nb.connect(bp); bp.connect(ng); ng.connect(pan); pan.connect(master); pan.connect(conv);
  nb.start(t); nb.stop(t+0.18);
  if(captionsOn){
    const cnear = dist < 30 ? 'near' : 'far';
    const side = Math.abs(right) < Math.abs(fwd)*0.6 ? (fwd >= 0 ? 'ahead' : 'behind') : (right > 0 ? 'right' : 'left');
    pushState({ caption: `home fire crackling · ${cnear} · ${side}`, captionId: ++captionSeq });
  }
}
// The three call sites (KeyH, the touch Hide button, and tick()'s
// movement-breaks-cover check) all funnel through these so entering/exiting
// always agree on `hidden`/`hideTime`/`hideKind` and always play the right
// prop's sound -- no call site duplicates the bookkeeping. LUL-391: this is
// also the one place feature_engagement('hide') fires -- an earlier,
// shadowed toggleHidden() carried that track() call but was dead code (a
// later function declaration in the same scope wins in JS), so the event
// never fired. LUL-2311: bramble is the only HIDE_KINDS member now, so
// leafRustle() is the only hide sound -- the former per-kind dispatch
// (playHideSfx()) and its hollow-log knock (hollowLogSound()) are deleted,
// not kept, since nothing could call the log branch anymore.
function enterHide(spot){ hidden = true; hideTime = 0; hideKind = spot.kind; hideEventCount++; leafRustle(true); track({ event: 'feature_engagement', feature: 'hide', action: 'used', carrying }); logChronicle('hide', { kind: spot.kind }); }
function exitHide(){ if(!hidden) return; leafRustle(false); hidden = false; hideKind = null; }
function toggleHidden(){
  if(hidden){ exitHide(); return; }
  const spot = findHideSpot(player.x, player.z);
  if(spot) enterHide(spot);
}
function twinkle(vol, bright){
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const f = SCALE[Math.floor(Math.random()*SCALE.length)] * (bright ? 2 : 1);
  const o = ctx.createOscillator(); o.type='sine'; o.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type='sine'; o2.frequency.value = f*2.001;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t+0.01); g.gain.exponentialRampToValueAtTime(0.0001, t+1.6);
  const g2 = ctx.createGain(); g2.gain.value = 0.25;
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(master); g.connect(conv);
  o.start(t); o2.start(t); o.stop(t+1.7); o2.stop(t+1.7);
}
// LUL-2281: swelling warm cue for the pickup/ascend cinematic -- fires at
// pickStart (pickup()) so the ~7-10.5s swell builds through the ascend and
// resolves right as fireBoom() fires at e>=9.3 (git show 0e55c85^, the
// commit LUL-1307 reverted, called this playPickupMusic() at the same
// call site). LUL-1307 had moved this to arriveHome() for the carry-home
// leg; that leg is gone (LUL-2281), so this is back where the cinematic
// it was authored for actually happens -- calling it from finishPickup()
// (e>=11.3, after the boom and after winVisible is already pushed) left
// the fanfare resolving several seconds into a static win screen.
function playWinMusic(){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t0 = ctx.currentTime;
  audio.wg.gain.setTargetAtTime(0.015, t0, 0.6);   // duck wind + drone
  audio.dg.gain.setTargetAtTime(0.02, t0, 0.6);
  const bus = ctx.createGain(); bus.connect(master); bus.connect(conv);
  bus.gain.setValueAtTime(0.0001, t0);
  bus.gain.exponentialRampToValueAtTime(0.55, t0 + 3.5);
  bus.gain.setValueAtTime(0.55, t0 + 7);
  bus.gain.exponentialRampToValueAtTime(0.0001, t0 + 10.5);
  const chords = [[261.63,329.63,392.00],[196.00,293.66,392.00],[220.00,261.63,329.63],[174.61,261.63,349.23]];
  chords.forEach((ch, i) => {
    const s = t0 + i*2.5, e = s + 2.7;
    ch.forEach(f => {
      const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
      const o2 = ctx.createOscillator(); o2.type='triangle'; o2.frequency.value=f; o2.detune.value=5;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.12, s+0.8); g.gain.setValueAtTime(0.12, e-0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, e);
      o.connect(g); o2.connect(g); g.connect(bus);
      o.start(s); o2.start(s); o.stop(e+0.05); o2.stop(e+0.05);
    });
  });
  const rise = [392.00,440.00,523.25,587.33,659.25,783.99,880.00,1046.50];   // ascending as the fanfare resolves
  rise.forEach((f, i) => {
    const s = t0 + 3.5 + i*0.55;
    const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.14, s+0.02); g.gain.exponentialRampToValueAtTime(0.0001, s+1.4);
    o.connect(g); g.connect(bus); g.connect(conv); o.start(s); o.stop(s+1.5);
  });
  later(() => { if(audio){ audio.wg.gain.setTargetAtTime(0.05, audio.ctx.currentTime, 1); audio.dg.gain.setTargetAtTime(0.05, audio.ctx.currentTime, 1); } }, 11000);
}
// LUL-1635: mark the pickup->carry transition -- short weight-settling
// thump plus a soft rising two-note interval, reading as "the load is now
// in your arms," not a fanfare. Dead since LUL-2281 (the carry-home leg
// this scored is unreachable -- pickup() now wins outright) but left in
// place per Decision 2, same as the carrying state machine it announces.
function playCarryStartCue(){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime;
  const nb = ctx.createBufferSource(); nb.buffer = noise(ctx, 0.08, false);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 0.7;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.16, t+0.01); ng.gain.exponentialRampToValueAtTime(0.0001, t+0.12);
  nb.connect(lp); lp.connect(ng); ng.connect(master); ng.connect(conv); nb.start(t); nb.stop(t+0.14);

  const notes = [130.81, 164.81];   // C3 -> E3, soft rising third -- warm, not triumphant
  notes.forEach((f, i) => {
    const s = t + 0.05 + i*0.09;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.14, s+0.03); g.gain.exponentialRampToValueAtTime(0.0001, s+0.5);
    o.connect(g); g.connect(master); g.connect(conv); o.start(s); o.stop(s+0.55);
  });
}
// distinct voice per species so you can hear what's coming
// LUL-26: closed captions for the fully-procedural audio -- there is no other
// channel carrying predator warnings (every sound in this game is synthesized
// WebAudio, per the wave-1 audio notes), so without this a deaf/HoH player
// loses the entire warning system, not just flavor. Genre precedent (TLOU2's
// audio-cue glossary) is "describe the event + where it's coming from", not a
// literal onomatopoeia transcript, hence distance/direction instead of just
// "wolf howls". `p` is the calling predator when known (most call sites);
// deathAudio() calls this without one since the source is adjacent by then.
function announceCaption(kind, big, p){
  const verb = kind === 'wolf' ? 'howl' : 'roar';
  let where;
  if(!p){ where = 'right on you'; }
  else {
    const b = bearingOf(p.x, p.z, player.x, player.z, player.yaw);
    const near = b.dist < 30 ? 'near' : 'far';
    where = `${near} · ${b.side}`;
  }
  pushState({ caption: `${kind} ${verb}${big ? ' (close)' : ''} · ${where}`, captionId: ++captionSeq });
}
function predatorCall(kind, big, p){
  if(captionsOn) announceCaption(kind, big, p);
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime;
  const baseVol = big ? 1.0 : 0.6;
  const vol = p ? baseVol * callVolumeMul(Math.hypot(p.x - player.x, p.z - player.z)) : baseVol;
  if(kind === 'wolf'){                              // howl: gliding tone with vibrato
    const o=ctx.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(300,t); o.frequency.linearRampToValueAtTime(560,t+0.4);
    o.frequency.setValueAtTime(560,t+0.9); o.frequency.linearRampToValueAtTime(360,t+1.5);
    const vib=ctx.createOscillator(); vib.type='sine'; vib.frequency.value=6;
    const vibg=ctx.createGain(); vibg.gain.value=16; vib.connect(vibg); vibg.connect(o.frequency); vib.start(t); vib.stop(t+1.6);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=820; bp.Q.value=1.4;
    const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.22*vol,t+0.15);
    g.gain.setValueAtTime(0.22*vol,t+1.1); g.gain.exponentialRampToValueAtTime(0.0001,t+1.6);
    o.connect(bp); bp.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t+1.65);
  } else if(kind === 'bear'){                       // low guttural roar + noise
    [70,96].forEach(f => { const o=ctx.createOscillator(); o.type='sawtooth';
      o.frequency.setValueAtTime(f*1.2,t); o.frequency.exponentialRampToValueAtTime(f*0.8,t+0.9);
      const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=420; lp.Q.value=4;
      const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.28*vol,t+0.1);
      g.gain.setValueAtTime(0.28*vol,t+0.7); g.gain.exponentialRampToValueAtTime(0.0001,t+1.1);
      o.connect(lp); lp.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t+1.15); });
    const nb=ctx.createBufferSource(); nb.buffer=noise(ctx,1.0,false);
    const nf=ctx.createBiquadFilter(); nf.type='lowpass'; nf.frequency.value=520;
    const ng=ctx.createGain(); ng.gain.setValueAtTime(0.0001,t); ng.gain.exponentialRampToValueAtTime(0.12*vol,t+0.1); ng.gain.exponentialRampToValueAtTime(0.0001,t+0.9);
    nb.connect(nf); nf.connect(ng); ng.connect(master); nb.start(t); nb.stop(t+1.0);
  } else {                                          // lion: rasping roar (fast AM + filter sweep)
    const o=ctx.createOscillator(); o.type='sawtooth';
    o.frequency.setValueAtTime(220,t); o.frequency.exponentialRampToValueAtTime(150,t+1.1);
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.Q.value=3;
    lp.frequency.setValueAtTime(700,t); lp.frequency.linearRampToValueAtTime(1500,t+0.35); lp.frequency.linearRampToValueAtTime(520,t+1.1);
    const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.24*vol,t+0.12);
    g.gain.setValueAtTime(0.24*vol,t+0.8); g.gain.exponentialRampToValueAtTime(0.0001,t+1.2);
    const am=ctx.createOscillator(); am.type='sine'; am.frequency.value=30;
    const amg=ctx.createGain(); amg.gain.value=0.12*vol; am.connect(amg); amg.connect(g.gain); am.start(t); am.stop(t+1.25);
    o.connect(lp); lp.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t+1.25);
  }
}
// two quick snorts as it sniffs you out
function sniff(){
  if(!audio || !soundOn) return;
  const { ctx, master } = audio, t0 = ctx.currentTime;
  for(let i=0;i<2;i++){
    const t = t0 + i*0.22;
    const nb=ctx.createBufferSource(); nb.buffer=noise(ctx,0.18,false);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.Q.value=1.2;
    bp.frequency.setValueAtTime(650,t); bp.frequency.linearRampToValueAtTime(1700,t+0.12);
    const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.16,t+0.03); g.gain.exponentialRampToValueAtTime(0.0001,t+0.16);
    nb.connect(bp); bp.connect(g); g.connect(master); nb.start(t); nb.stop(t+0.18);
  }
}
// the bite hit
function chomp(when){
  if(!audio || !soundOn) return;
  const { ctx, master } = audio, ct = when;
  const nb=ctx.createBufferSource(); nb.buffer=noise(ctx,0.2,false);
  const nf=ctx.createBiquadFilter(); nf.type='bandpass'; nf.frequency.value=1800; nf.Q.value=0.8;
  const ng=ctx.createGain(); ng.gain.setValueAtTime(0.0001,ct); ng.gain.exponentialRampToValueAtTime(0.5,ct+0.006); ng.gain.exponentialRampToValueAtTime(0.0001,ct+0.14);
  nb.connect(nf); nf.connect(ng); ng.connect(master); nb.start(ct); nb.stop(ct+0.16);
  const thud=ctx.createOscillator(); thud.type='sine'; thud.frequency.setValueAtTime(120,ct); thud.frequency.exponentialRampToValueAtTime(40,ct+0.15);
  const tg=ctx.createGain(); tg.gain.setValueAtTime(0.0001,ct); tg.gain.exponentialRampToValueAtTime(0.4,ct+0.01); tg.gain.exponentialRampToValueAtTime(0.0001,ct+0.25);
  thud.connect(tg); tg.connect(master); thud.start(ct); thud.stop(ct+0.3);
}
// death: duck everything, the animal roars, then the bite lands (timed to the video)
function deathAudio(kind){
  // LUL-26: captions must fire even with sound off -- gating the whole
  // function on `!soundOn` used to also swallow the death caption, the one
  // moment captions matter most. predatorCall() already gates its own
  // audio-only half on soundOn/audio internally, so call it unconditionally.
  predatorCall(kind, true);
  if(!audio || !soundOn) return;
  const t = audio.ctx.currentTime;
  audio.huntGain.gain.setTargetAtTime(0.0001, t, 0.12);
  audio.wg.gain.setTargetAtTime(0.0001, t, 0.12);
  audio.dg.gain.setTargetAtTime(0.0001, t, 0.12);
  chomp(t + 1.35);
}
// sharp stinger the instant an animal locks onto you
function spotSting(){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime;
  [1200,1272,1900].forEach(f => { const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f;
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=f; bp.Q.value=7;
    const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.11,t+0.008); g.gain.exponentialRampToValueAtTime(0.0001,t+0.5);
    o.connect(bp); bp.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t+0.55); });
  const lo=ctx.createOscillator(); lo.type='sine'; lo.frequency.setValueAtTime(190,t); lo.frequency.exponentialRampToValueAtTime(48,t+0.3);
  const lg=ctx.createGain(); lg.gain.setValueAtTime(0.0001,t); lg.gain.exponentialRampToValueAtTime(0.42,t+0.01); lg.gain.exponentialRampToValueAtTime(0.0001,t+0.4);
  lo.connect(lg); lg.connect(master); lo.start(t); lo.stop(t+0.45);
}
// a dissonant piano note; caller raises pitch/volume as the animal gets nearer
// LUL-1308: `pan` (defaults to 0, center) feeds a single shared StereoPannerNode --
// one node total for the whole note, not one per oscillator/harmonic, per the
// design doc's "costs one node" budget. Only the dry path (`master`) is panned;
// the reverb send (`conv`) stays unpanned, same as before -- a convolution
// reverb's own diffuse character does the work there, panning it too would just
// smear the direct cue's localization.
function pianoNote(freq, vol, pan = 0){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime;
  const panner = ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(master);
  const parts = [[1,1],[2,0.5],[3,0.25],[4,0.12]];
  const play = (f, amp) => parts.forEach(([h,ha]) => { const o=ctx.createOscillator(); o.type='sine';
    o.frequency.value = f*h*(1+0.0007*h*h);
    const g=ctx.createGain(); const a=amp*ha*vol; g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(a, t+0.005); g.gain.exponentialRampToValueAtTime(0.0001, t+1.6);
    o.connect(g); g.connect(panner); g.connect(conv); o.start(t); o.stop(t+1.65); });
  play(freq, 0.12); play(freq*1.414, 0.05);   // + tritone shadow for dread
}
// big explosion when the child bursts into the sky
function boom(when){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = when;
  const o=ctx.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(120,t); o.frequency.exponentialRampToValueAtTime(28,t+1.2);
  const g=ctx.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.6,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+1.6);
  o.connect(g); g.connect(master); o.start(t); o.stop(t+1.7);
  const nb=ctx.createBufferSource(); nb.buffer=noise(ctx,1.4,false);
  const nf=ctx.createBiquadFilter(); nf.type='lowpass'; nf.frequency.setValueAtTime(3000,t); nf.frequency.exponentialRampToValueAtTime(200,t+1.2);
  const ng=ctx.createGain(); ng.gain.setValueAtTime(0.0001,t); ng.gain.exponentialRampToValueAtTime(0.4,t+0.02); ng.gain.exponentialRampToValueAtTime(0.0001,t+1.5);
  nb.connect(nf); nf.connect(ng); ng.connect(master); ng.connect(conv); nb.start(t); nb.stop(t+1.5);
  [0,0.08,0.16,0.26].forEach((d,i) => { const so=ctx.createOscillator(); so.type='sine'; so.frequency.value=1200+i*400;
    const sg=ctx.createGain(); sg.gain.setValueAtTime(0.0001,t+d); sg.gain.exponentialRampToValueAtTime(0.12,t+d+0.01); sg.gain.exponentialRampToValueAtTime(0.0001,t+d+0.7);
    so.connect(sg); sg.connect(master); sg.connect(conv); so.start(t+d); so.stop(t+d+0.75); });
}

// ---- HUD state (LUL-34: engine emits, React renders) ---------------------
// One-directional: the engine owns this object and pushes patches out via
// emitState(). Nothing reads it back in -- React never reaches into engine
// internals, it only calls the action functions returned by init() below.
//
// LUL-35 (pass 2): this object carries *data*, never presentation. It used to
// emit `fogDisplay: '.045'` -- a pre-formatted string, and a wrong one, since
// the scene actually starts at CONFIG.fog (0.04); the HUD opened by lying about
// the mist it was rendering. The engine now emits the number it really uses and
// components/Hud.tsx formats it, which also makes CONFIG the one source of
// truth for the slider positions instead of a third hand-written copy.
// `statusHiding` went the same way: it was only ever assigned `statusVisible`,
// so React derives the class from that instead of carrying two names for one
// fact.
let hudState = {
  entered: false,
  objectiveVisible: false, objectiveText: '', objectiveReady: false,
  statusVisible: false, statusText: '',
  winVisible: false, winRevealed: false,
  deathVisible: false, deathKind: 'wolf', deathCause: 'chase', lossRevealed: false,
  survivedSeconds: 0,
  pace: CONFIG.walk, fog: CONFIG.fog, soundOn: true,
  lightDimmed: false,
  // LUL-382: mist veil resource meter -- 1 is full charge, 0 is fully drained.
  veilCharge: 1, veilLocked: false,
  chargeVisible: false, chargeToken: 0,
  caveImmuneActive: false, caveImmuneTimeLeft: 0,
  // LUL-1089: contextual action prompts
  coverPromptVisible: false, coverPromptUrgent: false, coverPromptKind: null,
  veilPromptVisible: false, veilPromptUrgent: false,
  // LUL-1258: M2 Deepwater's minimal HUD panel -- null/null whenever no
  // mission is active or the player is carrying (see the tick() pushState).
  missionKind: null, missionStatus: null,
  // LUL-1666: secondary objectives (deepwater only, Phase 1). `missionUnlocks`
  // is cross-session like embersBalance above (Hud.tsx persists it).
  // `secondaryChoice` is the player's pre-run pick, reset only by
  // setSecondaryChoice() itself (i.e. it persists across restarts, matching
  // difficulty's own persistence). `secondaryKind`/`secondaryStatus`/
  // `secondaryProgress` describe the *active run's* secondary and are always
  // null/null/null when no secondary is attached to the current mission.
  missionUnlocks: { deepwater: false },
  secondaryChoice: null,
  secondaryKind: null, secondaryStatus: null, secondaryProgress: null,
  // LUL-26: difficulty + accessibility. Controlled the same way pace/fog
  // already are -- the engine is the source of truth, React only renders it
  // and persists it to localStorage (see components/Hud.tsx).
  difficulty: 'night', runMode: 'hold', sensitivity: 1, invertY: false,
  reducedMotion: false, captionsOn: false, caption: null, captionId: 0,
  // LUL-1043: Embers. `embersBalance`/`embersDeeperLungsTier` are the
  // cross-run economy state -- engine-owned like difficulty above, synced
  // from localStorage by components/Hud.tsx via setEmbers() once on mount.
  // `lastPayout` is the most recent win/death breakdown (null before the
  // first run ends this session), reset to null on restart().
  embersBalance: 0, embersDeeperLungsTier: 0, lastPayout: null,
  livePileEmbers: 0,   // LUL-1315: live unbanked depth+survival total, run-only
  // LUL-1623: throwable distractions -- heldThrowable gates the desktop/mobile
  // throw prompt (components/GameCanvas.tsx, components/MobileControls.tsx);
  // canGrabThrowable is the HUD gate for the "pick up stone" prompt, mirroring
  // canPickup/objectiveReady's role for the child.
  heldThrowable: false, canGrabThrowable: false,
  // LUL-2230: scent trail visual. `scentTrailVisible` is the persisted
  // Settings toggle (default on).
  scentTrailVisible: true,
  // LUL-2307: generic first-encounter hint captions (replaces LUL-2230's
  // scentCaptionVisible/X/Y -- 'scent' is now just one HINT_PRIORITY entry).
  // `hintsEnabled` is the persisted Settings toggle (default on);
  // `hintVisible`/`hintKey`/`hintText`/X/Y are pushed per-frame only while a
  // hint is on screen -- same per-frame-push pattern as veilCharge above.
  hintsEnabled: true,
  hintVisible: false, hintKey: null, hintText: '', hintX: 0.5, hintY: 0.5,
};
function pushState(patch){
  let changed = false;
  for(const k in patch){ if(hudState[k] !== patch[k]){ changed = true; break; } }
  if(!changed) return;
  hudState = Object.assign({}, hudState, patch);
  emitState(hudState);
}
emitState(hudState);   // initial sync, in case a listener mounted before init() ran

// ---- Predator charge: telegraph -> commit -> jump-or-catch (LUL-213) -----
// `activeCharges` lets more than one predator (rare, but two wolves in a pack
// could both qualify the same frame) show the same one HUD prompt without
// fighting over it -- the prompt only clears once every active charge has
// resolved. `chargeToken` only bumps on a 0->1 edge so an overlapping second
// charge doesn't restart the dodge-window CSS animation the HUD keys off it.
let activeCharges = 0, chargeToken = 0;
function beginChargeHud(){
  activeCharges++;
  if(activeCharges === 1) chargeToken++;
  pushState({ chargeVisible: true, chargeToken });
}
function endChargeHud(){
  activeCharges = Math.max(0, activeCharges - 1);
  if(activeCharges === 0) pushState({ chargeVisible: false });
}
// "always only when the user sees the target" (founder's own phrasing on this
// ticket): canSee(p, dist) already gates whether the *predator* can see the
// player (LOS raycast, LUL-22/43). This is the missing other half -- is the
// predator inside the *player's* forward view cone -- so the telegraph never
// starts off-screen or behind the player's back where it can't be reacted to.
// ~130deg total FOV: generous enough to not feel unfair, narrow enough that
// "behind you" really means behind you.
function playerCanSee(p){
  const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz) || 0.0001;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  return (dx/d)*fx + (dz/d)*fz > PLAYER_FOV_COS;
}

// ---- Gate + pause --------------------------------------------------------
const hint = document.getElementById('hint');
const pausePrompt = document.getElementById('pausePrompt');
// LUL-153: "options-menu open" per the analytics schema is this pause overlay
// -- the gate's own instructions call Esc "menu", and the tuning panel
// (#panel: pace/fog/sound/regen/fullscreen) is what stays reachable while
// paused. There is no separate modal settings surface today (LUL-70, still
// backlog); if one ships later, move this call site to its open handler.
function setPaused(p){
  if(p && !paused) track({ event: 'feature_engagement', feature: 'options_menu', action: 'opened' });
  paused = p; pausePrompt.style.display = p ? 'flex' : 'none';
}
function enter(){
  entered = true;
  // LUL-1255 (Ship 1 wayfinding S2) / LUL-2307: one-time nav tip -- used to fire
  // unconditionally as a toast on every enter() (including restarts); now the
  // 'landmark' hint (HINT_PRIORITY above), so it only actually shows once ever,
  // via the generic per-frame hint evaluation in stepFrame(), not from here.
  enteredAt = clock.elapsedTime;
  runElapsed = 0;
  maxDistFromHome = 0;   // LUL-1043: fresh run, fresh depth high-water mark
  veilReserve = false; embersSpent = 0;   // LUL-1210: fresh run, no charm banked or spent
  chronicle = [];   // LUL-1103: fresh run, fresh chronicle
  pushState({ entered: true, livePileEmbers: 0 });
  // LUL-1425: the real "a run begins" moment on both input modes -- enter() is
  // called by the gate click (Hud.tsx) and by restart(). Fires once per RUN, not
  // once per page load; see docs/specs. Previously lived in the desktop-only
  // pointerlockchange handler, so it never fired on mobile at all.
  track({ event: 'game_start', seed: currentSeed });
  setPaused(false);
  if(!started){ startAudio(); started = true; }
  if(audio){ audio.ctx.resume(); }
  // LUL-643: requestLock() is meaningless on a touch device and, worse, a
  // stray el.requestPointerLock() call still succeeds in a mobile-emulated
  // Chromium context -- it locked the canvas as the pointer target and
  // silently ate every later Playwright mouse-driven click (e.g. the
  // Settings button), which is what e2e/mobile/toggle-run.spec.ts caught.
  // Every other pointer-lock call site is already gated on `mode ===
  // 'desktop'` (LUL-276); this one was missed when that split happened.
  if(mode === 'desktop') requestLock();
  hint.style.opacity = '0.85';
  later(() => { hint.style.opacity = '0'; }, 5000);
}

// QA-only, opt-in (?qaHooks=1): the procedurally generated forest can wedge a
// straight-line walk against a tree cluster near spawn depending on seed/heading,
// which makes "walk to the child" an unreliable way to test the lift/win state
// machine itself (navigation, not the mechanic, would be under test). This drops
// the player next to the child so e2e/smoke.spec.ts can assert pickup -> win
// deterministically. Absent by default, so it does nothing for real players.
// player/baby are init()-local (LUL-17 closure), so this is exposed per-init,
// same lifetime as everything else window.ForestEngine hands out.
if(typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('qaHooks')){
  window.ForestEngine.qaTeleportNearBaby = function(){ player.x = baby.x + 2; player.z = baby.z; };

  // LUL-38: same rationale -- home is a fixed point (CONFIG.home, reuses
  // spawn) so there's no navigation-reliability reason to walk there in a
  // test; this lets e2e assert the carry -> arrive -> win transition without
  // depending on procedural-terrain pathing.
  window.ForestEngine.qaTeleportHome = function(){ player.x = CONFIG.home.x; player.z = CONFIG.home.z; };

  // LUL-2169: same rationale as qaTeleportNearBaby/qaTeleportHome above, but for
  // the death path -- the only way to reach a deterministic death otherwise is to
  // wait out a predator's real hunt/chase/charge timer, which is exactly the kind
  // of timing-dependent setup an e2e spec shouldn't depend on. Calls the real
  // triggerDeath() (never fake state), so canTriggerDeath()'s guards (!dead &&
  // !won && !pickingUp, lib/game/outcome.ts) still apply -- this is a
  // deterministic *trigger* of the real transition, not a state bypass.
  window.ForestEngine.qaTriggerDeath = function(kind = 'wolf', cause = 'chase'){ triggerDeath(kind, cause); };

  // LUL-25: sets difficulty for the *next* generateMap() call (restart/regen
  // -- the current map doesn't retroactively move the child). The real path
  // is setDifficulty('blackout') via the settings panel (LUL-372); this hook
  // lets a test pin the 'hard' baby-spawn seam directly, without also
  // pulling in the rest of the blackout preset (predator roster/detection).
  window.ForestEngine.qaSetDifficulty = function(mode){ babySpawnDifficulty = mode === 'hard' ? 'hard' : 'normal'; };
  // LUL-2225: both regenMap() and restart() draw a fresh Math.random() seed --
  // neither lets a test reproduce an exact layout after calling
  // qaSetDifficulty('hard'), which is what pinned-seed blackout-spawn
  // coverage needs (setDifficulty()'s own comment: "difficulty changes always
  // take effect on the next restart()"). Calls the real generateMap(seed),
  // the same function every other map-gen path calls -- not a fake state,
  // just a parameterized seed instead of a random one.
  window.ForestEngine.qaRegenerateMap = function(seed){ generateMap(seed >>> 0); };
  window.ForestEngine.qaProbeBaby = function(){
    return { x: baby.x, z: baby.z, distHome: Math.hypot(baby.x, baby.z), routeCrossesBog: routeCrossesBog(0, 0, baby.x, baby.z) };
  };
  // LUL-1093: exposes w2m()'s clamped output directly so a test can assert
  // "this world point stays on-canvas" for both the player arrow (which calls
  // w2m(player.x, player.z) in drawMinimap()) and the objective marker (which
  // calls w2m(baby.x, baby.z)) without needing to actually move either --
  // both draw calls go through this same function.
  window.ForestEngine.qaProbeMinimapPoint = function(x, z){ const [px, py] = w2m(x, z); return { px, py, mm: MM }; };
  // LUL-2248: per-landmark beacon sprite presence + fog-exemption, one entry
  // per LANDMARKS kind, so a test can assert the sprite exists and reads past
  // the fog line without a screenshot.
  window.ForestEngine.qaProbeLandmarkBeacons = function(){
    return landmarkData.filter(l => l.kind).map(l => ({
      kind: l.kind, x: l.x, z: l.z,
      visible: landmarkGroups[l.kind].children.some(c => c.isSprite),
      fog: landmarkGroups[l.kind].children.find(c => c.isSprite)?.material.fog ?? null,
    }));
  };
  // LUL-2225: bogginess and its two derived multipliers at an arbitrary
  // point, so a test can sample the patch's shape/edge directly (centre,
  // the inner/outer radii, home, the lake, every LANDMARKS/CAVE position)
  // without re-deriving lib/game/bog.ts's math from player position.
  window.ForestEngine.qaProbeBog = function(x, z){
    const bogginess = biomeAt(x, z);
    return { bogginess, speedMul: bogSpeedMultiplier(bogginess), noiseMul: bogNoiseMultiplier(bogginess) };
  };
  // LUL-2225: counts of the live map's own generated data that fall inside
  // the bog's keep-clear radius -- the "nothing else spawns inside it" half
  // of this ticket's acceptance criteria, read back from the real arrays
  // generateMap() populated (coverData/throwableData/treeData/landmarkData),
  // not re-derived. treesInsideCore intentionally counts only non-culled
  // trees strictly within BOG_INNER_RADIUS (sparse forest inside the patch
  // is the target, not zero) -- every other field is expected to be 0.
  window.ForestEngine.qaProbeBogKeepClear = function(){
    const coverInside = coverData.filter(c => c.kind !== 'tree' && c.kind !== 'reed' && bogKeepClear(c.x, c.z, 0)).length;
    const reedsInsideCore = coverData.filter(c => c.kind === 'reed' && Math.hypot(c.x - BOG_CENTER.x, c.z - BOG_CENTER.z) < BOG_INNER_RADIUS).length;
    const throwablesInside = throwableData.filter(t => bogKeepClear(t.x, t.z, 0)).length;
    const treesInsideCore = treeData.filter(t => !t.culled && Math.hypot(t.x - BOG_CENTER.x, t.z - BOG_CENTER.z) < BOG_INNER_RADIUS).length;
    const landmarksInside = landmarkData.filter(l => bogKeepClear(l.x, l.z, 0)).length;
    return { coverInside, reedsInsideCore, throwablesInside, treesInsideCore, landmarksInside };
  };
  // LUL-2225: generic teleport, for staging a position (e.g. the bog center)
  // that isn't already a fixed named landmark like qaTeleportHome/
  // qaTeleportNearBaby.
  window.ForestEngine.qaTeleportTo = function(x, z){ player.x = x; player.z = z; };
  window.ForestEngine.qaProbeBabyLight = function(){
    return { intensity: babyLight.intensity, distance: babyLight.distance,
             carrying, pickingUp, taken: baby.taken };
  };
  window.ForestEngine.qaProbeElapsedTime = function(){ return clock.elapsedTime; };

  // LUL-2205: reads back the live day/night pacing values in one call so a
  // test can assert the engine-visible effect directly (per this file's
  // "assert the effect, not the DOM node" rule), not just the HUD's
  // #timeOfRunClock text. Adds no new state -- timeOfRun, hemiLight, and
  // timeOfRunDetectMul/formatTimeOfRunClock are already in scope in init().
  window.ForestEngine.qaProbeTimeOfRun = function(){
    return { timeOfRun, fogDensity: scene.fog.density, hemiIntensity: hemiLight.intensity,
             detectMul: timeOfRunDetectMul(timeOfRun), clock: formatTimeOfRunClock(timeOfRun) };
  };

  // LUL-2071: deterministic test clock. qaSetFixedStep() parks the real RAF
  // loop (cancels the pending frame) so wall-clock jitter/GPU contention can
  // never inject an extra or partial frame on top of what the test drives.
  // qaAdvance() is then the *only* thing that moves simulation time, by
  // exactly dtSeconds per call, through the same stepFrame() the real RAF
  // loop calls -- fixed-step and real-time frames run identical game logic,
  // only the dt source differs. Advancing clock.elapsedTime directly (rather
  // than intercepting every read site) keeps both the dilated `+= dt`
  // category and the undilated `clock.elapsedTime`-diff category (see wiki
  // systems/dt-clamp-vs-walltime) correct with one change, since both derive
  // from this same shared THREE.Clock instance.
  window.ForestEngine.qaSetFixedStep = function(dtSeconds){
    qaFixedDt = dtSeconds;
    if(rafId !== null){ cancelAnimationFrame(rafId); rafId = null; }
  };
  window.ForestEngine.qaAdvance = function(steps = 1){
    if(qaFixedDt === null) throw new Error('qaAdvance: call qaSetFixedStep(dt) first');
    for(let i = 0; i < steps; i++){
      clock.elapsedTime += qaFixedDt;
      stepFrame(qaFixedDt, clock.elapsedTime);
    }
  };

  // LUL-1484: before/after perf baseline for the map-size growth (E3), and
  // the baseline E6's chunking work later has to justify itself against.
  // LUL-2257: when post-processing is active, renderer.info.render has already
  // been overwritten by the bloom/blur/composite blits by the time this reads
  // it -- use the snapshot renderPost() captured right after the real scene
  // render instead. Without post-processing there's only ever one render()
  // call per frame (the fallback branch below renderPost's warm-up call, see
  // the bottom of the file), so renderer.info.render is already the real
  // scene stats and reading it live is correct.
  window.ForestEngine.qaProbePerf = function(){
    const render = usePost ? lastScenePerf : renderer.info.render;
    return {
      calls: render.calls,
      triangles: render.triangles,
      elapsedTime: clock.elapsedTime,
    };
  };

  // LUL-1487 (E6), extended by LUL-2249: sanity check the chunked tree pool
  // retains exactly one instance per *live* tree -- no silent drop or
  // double-count in the chunk bucketing. `chunks`/`totalInstances` keep their
  // pre-streaming names for back-compat with any existing reader, but their
  // meaning narrowed from "every populated chunk" (true for all of them
  // before this ticket) to "every live (ring-limited) chunk" -- `instantiated`
  // is the same number under the ticket's own explicit name, `populated` is
  // the old "has tree data regardless of live state" count so a test can tell
  // the two apart, and `expected` now means "trees in a currently-live chunk"
  // (previously "every tree in the map", since every chunk used to be live --
  // no existing consumer asserted that equality, confirmed by repo-wide grep).
  window.ForestEngine.qaProbeTreeChunks = function(){
    const trios = treeChunkTrios.filter(Boolean);
    const populated = treeChunkBuckets.filter(b => b.length > 0).length;
    return {
      chunks: trios.length,
      instantiated: trios.length,
      populated,
      totalInstances: trios.reduce((n, t) => n + t[0].count, 0),
      expected: treeData.filter(t => liveChunks.has(treeChunkIndex(t.x, t.z))).length,
    };
  };

  // LUL-2249: liveChunks/cover/bog liveness + the player's own current chunk,
  // for e2e assertions that a chunk-change moved the live set (and that old
  // far chunks actually dropped) without reaching into module-private state.
  window.ForestEngine.qaProbeChunkStreaming = function(){
    return {
      liveChunks: Array.from(liveChunks).sort((a, b) => a - b),
      coverLive: coverChunkMeshes.reduce((n, m) => n + (m ? 1 : 0), 0),
      bogLive: bogChunkMeshes.reduce((n, m) => n + (m ? 1 : 0), 0),
      playerChunk: (function(){ const [cx, cz] = chunkXZ(player.x, player.z); return cx*TREE_CHUNKS_PER_AXIS + cz; })(),
    };
  };

  // LUL-2247: exposes the finished map's post-thin prop layout for e2e
  // assertions -- per-chunk counts by category (same categories
  // PROP_CHUNK_CAP keys), the minimum pairwise centre-to-centre distance
  // across every non-tree prop (cover/reed/bogTree/stone) regardless of
  // kind, and the total count. O(n^2) over the thinned (small) population --
  // test-only, never called per-frame.
  window.ForestEngine.qaProbePropDensity = function(){
    const perChunkMap = new Map();
    const bump = (chunk, cat) => {
      const e = perChunkMap.get(chunk) || { chunk, cover: 0, reed: 0, bogTree: 0, stone: 0 };
      e[cat]++; perChunkMap.set(chunk, e);
    };
    const all = [];
    let reedsInLakeClear = 0;
    for(const c of coverData){
      if(c.kind === 'tree') continue;
      const cat = c.kind === 'reed' ? 'reed' : 'cover';
      bump(treeChunkIndex(c.x, c.z), cat);
      all.push(c);
      // LUL-2247 review fix: mandatory assertion from the ticket -- no reed
      // may land inside CONFIG.lake.clear. inLake() is the exact check
      // generateReeds() now runs at generation time (see its comment);
      // reported here too so the e2e spec can assert the finished map
      // rather than trusting the generator never regresses silently.
      if(cat === 'reed' && inLake(c.x, c.z)) reedsInLakeClear++;
    }
    for(const b of bogTreeData){ bump(treeChunkIndex(b.x, b.z), 'bogTree'); all.push(b); }
    for(const t of throwableData){ bump(treeChunkIndex(t.x, t.z), 'stone'); all.push(t); }

    let minPairSpacing = Infinity;
    for(let i = 0; i < all.length; i++){
      for(let j = i+1; j < all.length; j++){
        const dx = all[i].x - all[j].x, dz = all[i].z - all[j].z;
        const d = Math.hypot(dx, dz);
        if(d < minPairSpacing) minPairSpacing = d;
      }
    }
    return {
      perChunk: Array.from(perChunkMap.values()),
      minPairSpacing: Number.isFinite(minPairSpacing) ? minPairSpacing : null,
      total: all.length,
      reedsInLakeClear,
    };
  };

  // LUL-83: proves resolveInitialSeed() actually drives the generated layout --
  // `?seed=N` should reproduce this byte-identically across loads, and no
  // `?seed=` should vary it. Trees/predators are read back from the same
  // arrays generateMap() populated, not re-derived.
  window.ForestEngine.qaProbeMapSeed = function(){
    return {
      seed: currentSeed,
      baby: { x: baby.x, z: baby.z },
      trees: treeData.map(function(t){ return { x: t.x, z: t.z }; }),
      predators: predators.map(function(p){ return { kind: p.kind, x: p.x, z: p.z }; }),
    };
  };

  // LUL-211: the cover-collision fix (coverBlockedR, folded into blocked())
  // was unprovable from a test -- nothing outside the closure could read where
  // the player ended up, so "you can walk through a boulder" could only ever be
  // reported by a human. These two hooks close that: stage the player facing a
  // prop of a given kind, hold W, then read the position back.
  window.ForestEngine.qaProbePlayer = function(){
    return { x: player.x, z: player.z, yaw: player.yaw };
  };

  // LUL-2187/LUL-2209: raw mission state, mirrors qaProbeBaby's shape. Cheap
  // sibling of qaTeleportNearMission (LUL-2123, :3966) -- that hook already
  // returns the same fields as a side effect of teleporting, this is for a
  // test that wants to read mission state without also moving the player.
  window.ForestEngine.qaProbeMission = function(){
    return mission && { kind: mission.target.kind, status: mission.status, x: mission.target.x, z: mission.target.z };
  };

  // LUL-2189/LUL-2207: exposes the module-scope wind unit vector (set once per
  // generateMap() by generateWind(), engine/forest-engine.js:1591/1594) so a test
  // can derive #windIndicator's expected rotation instead of hardcoding an angle.
  window.ForestEngine.qaProbeWind = function(){
    return { windX: windX, windZ: windZ };
  };

  // Drops the player `standoff` units on the -x side of the first reachable
  // cover prop of `kind` and points them straight at it (forward is
  // (-sin yaw, -cos yaw), so yaw = -PI/2 faces +x). Returns the prop's AABB and
  // rotation (ry) so the caller can assert the player never enters it. Skips
  // candidates whose standing spot or first forward step is already blocked --
  // LUL-267's canopyBlockedR can block movement even when the spawn point itself
  // is clear (player at a canopy edge), which would wedge the player and make the
  // "player never moved" assertion fire falsely.
  // LUL-288: props render rotated (c.ry), so a flat hx-based standoff can land
  // inside the prop's true rotated collision boundary when hz binds instead of
  // hx (see coverBlockedR() above). The player walks in +x with z pinned to
  // c.z, so in the prop's local frame dz=0 the whole way and the true first
  // blocked dx is -min((hx+pr)/|cos ry|, (hz+pr)/|sin ry|) -- same transform
  // coverBlockedR() itself uses, pr=0.6 to match blocked()'s hardcoded radius.
  // Standoff is that distance plus a 1-unit margin, not a flat offset.
  window.ForestEngine.qaStageWalkIntoCover = function(kind){
    for(const c of coverData){
      if(c.kind !== kind) continue;
      // LUL-388: tree cover entries carry no `ry` -- generateCover() only sets one
      // for log/rock/bramble; a tree's coverData row is a synthetic LOS-only square
      // (hx=hz=t.cr*1.4, see generateCover()) that coverBlockedR() explicitly skips
      // (`if(c.kind==='tree') continue`). A tree's real MOVEMENT collision is the
      // circular trunk radius t.cr via blockedR()'s own grid, unrelated to that
      // square. Feeding `c.ry` (undefined) into Math.cos/sin below silently produced
      // NaN positions for every caller of this hook with kind:'tree' -- caught by
      // this ticket's interaction-matrix sweep, never previously exercised (no spec
      // passed 'tree' before now). A circle needs no rotation at all, so this is a
      // genuinely simpler case, not a special-cased rotation.
      if(c.kind === 'tree'){
        const r = c.hx / 1.4;
        const standoff = r + 0.6 + 1;
        const px = c.x - standoff, pz = c.z;
        if(blocked(px, pz)) continue;
        player.x = px; player.z = pz; player.yaw = -Math.PI/2;
        return { prop: { x: c.x, z: c.z, hx: r, hz: r, ry: 0, kind: c.kind }, start: { x: px, z: pz } };
      }
      const co = Math.cos(c.ry), si = Math.sin(c.ry);
      const standoff = Math.min((c.hx + 0.6) / Math.abs(co), (c.hz + 0.6) / Math.abs(si)) + 1;
      const px = c.x - standoff, pz = c.z;
      if(blocked(px, pz)) continue;
      player.x = px; player.z = pz; player.yaw = -Math.PI/2;
      return { prop: { x: c.x, z: c.z, hx: c.hx, hz: c.hz, ry: c.ry, kind: c.kind }, start: { x: px, z: pz } };
    }
    return null;
  };

  // LUL-384: exposes the exact predicate real player movement gates on
  // (see the `blocked(nx, player.z)`/`blocked(player.x, nz)` calls in the
  // tick loop below). Lets a test assert a whole span is collision-free by
  // direct sampling instead of integrating real player movement over a fixed
  // wall-clock window -- the latter ties the assertion to how many animation
  // frames actually ran in that window, which is not stable under CI load
  // (same class of flake as LUL-421's charge-dodge wall-clock assertions,
  // wiki: systems/dt-clamp-vs-walltime). Movement is still driven by real
  // keyboard input elsewhere in this spec; this only replaces the "did we
  // travel far enough in 3 real seconds" assertion with something that
  // doesn't depend on render throughput.
  window.ForestEngine.qaProbeBlocked = function(x, z){ return blocked(x, z); };

  // Same idea for the death path. Reaching it naturally means standing still until
  // `sinceClose > 30` forces a hunt, then waiting for the animal to cross the map --
  // and both of those are measured in game time, which is not wall time: dt is
  // clamped to 0.05 in the render loop, so under software rendering at ~12 fps game
  // time accrues at ~63% of real time and a wall-clock test deadline quietly stops
  // meaning what it says. See wiki: systems/dt-clamp-vs-walltime.
  //
  // So this skips the waiting, not the mechanic: it drops the nearest predator a few
  // units away and sets the same `hunt` flag the 30s trigger would have set. The
  // approach, the catch test (`dist < p.rad + 1.3`) and triggerDeath all still run
  // for real -- the animal is placed outside catch range and closes it itself.
  window.ForestEngine.qaLurePredator = function(){
    let nearest = null, best = 1e9;
    for(const p of predators){
      const d = Math.hypot(player.x - p.x, player.z - p.z);
      if(d < best){ best = d; nearest = p; }
    }
    if(!nearest) return null;
    // +x is arbitrary; 6 units clears p.rad + 1.3 for every species (max rad 1.5)
    // while still being about a one-second approach.
    nearest.x = player.x + 6; nearest.z = player.z;
    nearest.vx = nearest.vz = 0;
    nearest.hunt = true;
    return nearest.kind;
  };

  // LUL-55: qaLurePredator above always takes whichever predator happens to be
  // nearest, so an e2e death test can only ever assert "some animal caught me" --
  // it cannot pin the death sequence to a specific species without hoping the
  // right one spawned closest. This is the same lure, filtered to a chosen kind,
  // so the suite can cover all three death sequences deterministically.
  window.ForestEngine.qaLurePredatorKind = function(kind){
    let nearest = null, best = 1e9;
    for(const p of predators){
      if(p.kind !== kind) continue;
      const d = Math.hypot(player.x - p.x, player.z - p.z);
      if(d < best){ best = d; nearest = p; }
    }
    if(!nearest) return null;
    nearest.x = player.x + 6; nearest.z = player.z;
    nearest.vx = nearest.vz = 0;
    nearest.hunt = true;
    return nearest.kind;
  };

  // LUL-65: seeds one synthetic scent point `age` game-seconds old at (player.x+dx,
  // player.z+dz) -- skips real walking and real-time aging so a test can place a
  // stale, distant trail deterministically. Same rationale as qaLurePredator
  // skipping the 30s idle-hunt wait: what's under test is the mechanic that
  // consumes the point (checkScent/scentOnto), not how the point got laid.
  window.ForestEngine.qaSeedScentPoint = function(dx, dz, age){
    scentPoints.push({ x: player.x + dx, z: player.z + dz, t0: clock.elapsedTime - age, radius: SCENT_RADIUS_WALK });
  };

  // LUL-65: places a named predator on the drifted position of the oldest still-live
  // scent point and drops it into `roam` so checkScent()/scentOnto() run for real on
  // the next tick, the same way a wandering predator would find it -- this is what
  // lets a test exercise "picks up a stale, distant trail" without waiting out
  // SCENT_LIFETIME in real time. Returns null if there is no live point (nothing laid
  // yet, or it already decayed) or the species isn't found.
  window.ForestEngine.qaProbeScentOnOldest = function(kind){
    if(!scentPoints.length) return null;
    const s = scentPoints[0], age = clock.elapsedTime - s.t0;
    if(isScentExpired(age)) return null;
    const p = predators.find(pp => pp.kind === kind);
    if(!p) return null;
    const drift = scentDriftDistance(age);
    p.x = s.x + windX*drift; p.z = s.z + windZ*drift;
    p.vx = 0; p.vz = 0; p.state = 'roam'; p.scentLock = 0; p.scentCalls = 0; p.spotted = false;
    p.g.position.x = p.x; p.g.position.z = p.z;
    return { age, dist: Math.hypot(player.x - p.x, player.z - p.z) };
  };

  // LUL-65: state + distance + the scentOnto() re-trigger count, for asserting a
  // scent-triggered chase actually closes distance (not the stutter this ticket
  // fixed) without re-roaring every frame.
  //
  // LUL-99: also returns `t`, the same clock.elapsedTime the render loop's dt
  // clamp (line ~1220) accumulates against. Below 20fps under this rig's
  // software rendering, that clock runs slower than wall time and never
  // catches up (wiki: systems/dt-clamp-vs-walltime) -- a test that samples this
  // probe twice and diffs `t` gets the actual game-time window the sim ran for,
  // instead of assuming it from a wall-clock wait.
  window.ForestEngine.qaProbePredatorState = function(kind){
    const p = predators.find(pp => pp.kind === kind);
    if(!p) return null;
    return { state: p.state, dist: Math.hypot(player.x - p.x, player.z - p.z), scentCalls: p.scentCalls, t: clock.elapsedTime };
  };
  // LUL-43 positional-hiding scaffolding. Both hooks place a specific predator
  // deterministically -- never "wherever the seed happened to spawn one" -- so
  // e2e/hide.spec.ts doesn't have to search the procedural map for a matching
  // case, and both return the predator's index into `predators` so the test
  // can poll its real state instead of racing a wall-clock sleep against the
  // dt clamp (wiki: systems/dt-clamp-vs-walltime).

  // Case 1: "hide in the open near a lion -> caught". Teleport the player to
  // the spawn clearing (`inSpawn`, r<~6.3) that every seed keeps tree- and
  // cover-free, so there is provably nothing between predator and player, and
  // put a lion a few units out with hunt=true. Even at full stillness this
  // must still catch you (STILL_DETECT_CUT never reaches 1).
  window.ForestEngine.qaOpenHideNearLion = function(){
    player.x = 0; player.z = 0;
    const idx = predators.findIndex(p => p.kind === 'lion');
    if(idx < 0) return null;
    const lion = predators[idx];
    lion.x = player.x + 4; lion.z = player.z;
    lion.vx = lion.vz = 0; lion.alert = 0; lion.reroute = 0; lion.stuckT = 0;
    lion.state = 'chase'; lion.hunt = true;
    return idx;
  };

  // Case 2: "hide behind cover -> predator sniffs -> backs off". LUL-212:
  // narrowed from "any dedicated cover prop (log/rock/bramble)" to only
  // HIDE_KINDS (bramble, LUL-2311 dropped log) -- rock is still LOS-blocking
  // cover but is no longer a place `hidden` can be entered, so a test
  // staged on a rock would press KeyH and get nothing, then hang waiting
  // for `investigate` to hold
  // (forest-engine.js: that loop re-escalates to `chase` every tick `!hidden`
  // holds). Not a tagged tree either: trees also sit in the movement
  // -collision grid, and placing a predator's direct approach straight
  // through one risks the same stuck/reroute path a normal chase can hit
  // against any tree -- fine in open play, a flaky thing to build a
  // deterministic test on. The chosen prop itself is never a movement
  // obstacle (LOS-only), but an unrelated real tree can still overlap the
  // predator's or the player's *own spawn point* for a given candidate, not
  // just the line between them -- found by tracing a stuck run where the
  // predator never moved a single unit from its placement: `blockedR` was
  // already true at (px,pz) itself, so every candidate step out of it also
  // read blocked and the reroute loop span forever without the trail ever
  // going anywhere. The interior-only sample (i=1..STEPS-1) that used to be
  // here never checked i=0 or i=STEPS, i.e. never checked the endpoints it
  // was about to commit to. Both endpoints are now checked explicitly before
  // the interior walk. The player lands `hideReach` from the prop's edge --
  // inside HIDE_RADIUS, so the immediately-following KeyH press actually
  // finds a hiding spot -- while the predator keeps the wider safety margin
  // against unrelated tree overlap. With COVER_PROPS=220 (~25% bramble,
  // LUL-2311 dropped log from HIDE_KINDS) some candidate is always clear.
  window.ForestEngine.qaHideBehindCover = function(){
    const idx = 0;
    const p = predators[idx];
    for(const c of coverData){
      if(!HIDE_KINDS[c.kind]) continue;
      const edge = Math.max(c.hx, c.hz), predReach = edge + 3, hideReach = edge + 1;
      const px = c.x - predReach, pz = c.z, qx = c.x + hideReach, qz = c.z;
      if(blockedR(px, pz, p.rad) || blocked(qx, qz)) continue;
      let clear = true;
      const STEPS = 12;
      for(let i = 1; i < STEPS; i++){
        const u = i / STEPS;
        if(blockedR(px + (qx-px)*u, pz + (qz-pz)*u, p.rad)){ clear = false; break; }
      }
      if(!clear) continue;
      p.x = px; p.z = pz;
      p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0; p.sightLock = null;
      p.state = 'chase'; p.hunt = false;
      player.x = qx; player.z = qz;
      return idx;
    }
    return null;
  };

  // LUL-121: species-specific cover hook. Same geometry as qaHideBehindCover
  // but picks the first predator of the requested kind so tests can pin each
  // species independently. Returns { idx, kind, playerX, playerZ } on success,
  // null on failure. LUL-242: playerX/playerZ (the player's placed position)
  // are exposed so a caller can compute an exact offset back to the predator
  // -- cover-clearance separation (driven by `predReach`/`hideReach`, which
  // vary per prop) is unrelated to and can exceed scent-pickup radius
  // (<=3.08 units at freshest/bear), so a test that wants a scent point near
  // the predator cannot derive it from a guessed constant offset; see wiki:
  // game/lul196-scent-behind-cover-geometry.
  window.ForestEngine.qaHideBehindCoverKind = function(kind){
    const idx = predators.findIndex(p => p.kind === kind);
    if(idx < 0) return null;
    const p = predators[idx];
    for(const c of coverData){
      if(!HIDE_KINDS[c.kind]) continue;
      const edge = Math.max(c.hx, c.hz), predReach = edge + 3, hideReach = edge + 1;
      const px = c.x - predReach, pz = c.z, qx = c.x + hideReach, qz = c.z;
      if(blockedR(px, pz, p.rad) || blocked(qx, qz)) continue;
      let clear = true;
      const STEPS = 12;
      for(let i = 1; i < STEPS; i++){
        const u = i / STEPS;
        if(blockedR(px + (qx-px)*u, pz + (qz-pz)*u, p.rad)){ clear = false; break; }
      }
      if(!clear) continue;
      p.x = px; p.z = pz;
      p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0; p.sightLock = null;
      p.state = 'chase'; p.hunt = false;
      player.x = qx; player.z = qz;
      return { idx, kind, playerX: qx, playerZ: qz };
    }
    return null;
  };

  // LUL-196: reset a predator to roam without moving it. Existing hooks that
  // exercise scent acquisition (checkScent/scentOnto) all teleport the predator,
  // destroying any cover staging. This hook lets a test position the predator
  // with qaHideBehindCoverKind, then call this to drop it back to roam so
  // checkScent() actually runs. Returns the predator's current {x,z} on success
  // so the caller can verify it was not relocated.
  window.ForestEngine.qaSetPredatorRoam = function(idx){
    const p = predators[idx];
    if(!p) return null;
    p.state = 'roam'; p.spotted = false; p.scentLock = 0; p.scentCalls = 0;
    p.hunt = false; p.alert = 0; p.sniffsLeft = 0; p.sightLock = null;
    return { x: p.x, z: p.z };
  };

  window.ForestEngine.qaGetPredatorLkp = function(idx){
    const p = predators[idx];
    if(!p) return null;
    return { lkpX: p.lkpX, lkpZ: p.lkpZ, lkpSweeps: p.lkpSweeps };
  };

  // LUL-1620: finds the given species, places it `dx/dz` from the player's
  // *current* position (does not move the player, so KeyH/hidden staging
  // done before this call survives it), and arms it one tick away from the
  // investigate/sniff give-up transition (:1520-1525). Driving the real
  // sniffsLeft/sniffTimer countdown to reach that transition is what
  // qaSetPredatorRoam's own comment warns off (destroys whatever staging a
  // test already set up) -- this hook manipulates state directly instead,
  // same philosophy. Clears the higher-priority branches (charge/sightLock/
  // alert/reroute/hunt) that would otherwise pre-empt the investigate/sniff
  // branch this tick. Returns the predator's index (for qaGetPredatorLkp)
  // and placed position, or null if the species doesn't resolve.
  window.ForestEngine.qaStagePredatorGiveUp = function(kind, dx, dz){
    const idx = predators.findIndex(p => p.kind === kind);
    if(idx < 0) return null;
    const p = predators[idx];
    p.x = player.x + dx; p.z = player.z + dz;
    p.vx = p.vz = 0; p.charge = null; p.sightLock = null; p.alert = 0; p.reroute = 0; p.stuckT = 0; p.hunt = false;
    p.state = 'investigate'; p.inv = 'sniff'; p.sniffsLeft = 1; p.sniffTimer = 0.001;
    return { idx, x: p.x, z: p.z };
  };

  // LUL-2246: places predator[kind] dx/dz from the player and parks every other spawned
  // predator far out of range, so it is guaranteed to be `nearP` (`:4811`). Sets
  // `sinceClose = 29.9` -- one real tick past this crosses the 30s force-hunt threshold
  // through updatePredators()'s own logic (`:4812`), not by setting hunt/scentLock directly,
  // so the assertion exercises the real escalation, not a synthetic stand-in for it. dx/dz
  // must put the predator beyond its detect radius (30-48u) for the escalation's collapse
  // branch (`:1981`) to actually run; the caller is responsible for that distance.
  window.ForestEngine.qaStageForceHuntApproach = function(kind, dx, dz){
    const idx = predators.findIndex(p => p.kind === kind);
    if(idx < 0) return null;
    for(const other of predators){ if(other !== predators[idx]){ other.x = player.x + 800; other.z = player.z + 800; } }
    const p = predators[idx];
    p.x = player.x + dx; p.z = player.z + dz;
    p.vx = p.vz = 0; p.charge = null; p.sightLock = null; p.alert = 0; p.reroute = 0; p.stuckT = 0;
    p.hunt = false; p.scentLock = 0; p.state = 'roam'; p.spotted = false;
    sinceClose = 29.9;
    return { idx, x: p.x, z: p.z };
  };

  // LUL-2320: places predator[kind] dx/dz from the player (player untouched, so KeyH staging
  // done before this call survives it) directly into `chase` with a scentLock held open, the
  // exact state the glue bug's root cause (#4 in the ticket) describes -- blind pursuit at
  // full species speed with no LOS requirement while scentLock > 0. dx/dz is the caller's
  // choice deliberately, not auto-placed at contact range, so a test can also exercise the
  // normal "closing distance" leg before the predator arrives. Clears every higher-priority
  // branch (charge/sightLock/alert/reroute/hunt) that would otherwise pre-empt `chase` this
  // tick, same set qaStageForceHuntApproach already clears. Returns `{idx,x,z}`, or null if
  // the species isn't spawned.
  window.ForestEngine.qaStageChaseAtContact = function(kind, dx, dz){
    const idx = predators.findIndex(p => p.kind === kind);
    if(idx < 0) return null;
    const p = predators[idx];
    p.x = player.x + dx; p.z = player.z + dz;
    p.vx = p.vz = 0; p.charge = null; p.sightLock = null; p.alert = 0; p.reroute = 0; p.stuckT = 0;
    p.hunt = false; p.state = 'chase'; p.scentLock = SCENT_TRACK_TIME; p.alertedBy = null;
    return { idx, x: p.x, z: p.z };
  };

  window.ForestEngine.qaIsApproachPianoActive = function(){
    return approachPianoActive;
  };

  // LUL-1620: teleports predator[idx] onto its own current roam waypoint so
  // the very next tick's `wd < 2.5` arrival check (engine/forest-engine.js
  // roam branch) fires immediately, running the real pickRoamWaypoint()
  // repick instead of waiting out the actual travel time -- lets a test
  // drive the bounded LKP_MAX_SWEEPS count down to exhaustion in a handful
  // of ticks instead of the ~10-20s of real navigation each sweep leg takes.
  window.ForestEngine.qaFastForwardPredatorToWaypoint = function(idx){
    const p = predators[idx];
    if(!p) return null;
    p.x = p.wpx; p.z = p.wpz;
    return { x: p.x, z: p.z };
  };

  // LUL-212: teleport the player to the first generated hiding spot
  // (bramble; LUL-2311 dropped log from HIDE_KINDS), or the first prop of
  // `kind` if given (LUL-2320, so a test can land on a specific non-hide
  // cover prop like 'log'), no predator involved -- e2e/hide.spec.ts only
  // needs a deterministic spot to press KeyH at, not a chase scenario.
  window.ForestEngine.qaTeleportToHideSpot = function(kind){
    const spot = kind ? coverData.find(c => c.kind === kind) : coverData.find(c => HIDE_KINDS[c.kind]);
    if(!spot) return null;
    player.x = spot.x; player.z = spot.z;
    return spot.kind;
  };

  // LUL-2311: teleport the player next to any cover prop of the given kind,
  // with no HIDE_KINDS check -- unlike qaTeleportToHideSpot above, this lets
  // a test position the player at a walkable-but-not-hide-eligible prop
  // (e.g. 'log') to assert KeyH is correctly a no-op there. Places the
  // player just outside the prop's edge (like qaHideBehindCover's hideReach),
  // not inside it, so a real KeyH press is the thing under test, not
  // whether the player can stand there at all.
  window.ForestEngine.qaTeleportNearCoverKind = function(kind){
    const spot = coverData.find(c => c.kind === kind);
    if(!spot) return null;
    const edge = Math.max(spot.hx, spot.hz);
    player.x = spot.x + edge + 1; player.z = spot.z;
    return spot.kind;
  };

  // LUL-1089: stage cover (findHideSpot() !== null) and a chasing, sighted
  // lion (canSee()) at once -- qaTeleportToHideSpot() followed by
  // qaOpenHideNearLion() does NOT do this, because qaOpenHideNearLion resets
  // player.x/z to the spawn clearing (0,0) to guarantee its own cover-free
  // scenario, clobbering the teleport. This hook places the player 0.5 units
  // outside the cover AABB's local-x edge (not at its center) so hasLOS()
  // does not find the player inside the prop and self-block the sightline --
  // both player and lion are on the same side of the OBB, sightline clear.
  //
  // LUL-2358: the lion standoff used to be 4 units -- inside a chasing lion's
  // own CATCH_MARGIN+rad contact range (2.3) after as little as (4-2.3)/9.2s
  // =~ 0.18s of real chase movement at the lion's tuning.js speed (9.2), so
  // every caller that advances game time past that (action-prompt.spec.ts's
  // qaSetFixedStep/qaAdvance(0.5s) cases, and even a plain real-time
  // page.waitForTimeout once LUL-1910's real GPU rendering stopped
  // dt-clamp-dilating wall time -- wiki systems/dt-clamp-vs-walltime) hits
  // triggerDeath() before the UI assertion ever runs, not a cover/veil bug.
  // LION_STANDOFF keeps the lion within COVER_URGENT_RANGE (22, lib/game/
  // cover.ts) so the urgent-tone premise still holds, while (LION_STANDOFF -
  // CATCH_MARGIN-rad)/9.2 =~ 1.3s stays comfortably ahead of every caller's
  // wait window.
  const LION_STANDOFF = 14;
  window.ForestEngine.qaOpenHideNearLionAtHideSpot = function(){
    const idx = predators.findIndex(p => p.kind === 'lion');
    if(idx < 0) return null;
    const lion = predators[idx];
    // LUL-2373: the first HIDE_KINDS spot found used to be taken unconditionally --
    // "clear sightline guaranteed" only followed from both endpoints sitting outside
    // the hide-spot's own footprint (true by construction below), but at
    // LION_STANDOFF=14 (LUL-2358) the ray can run 14+ units through open terrain and
    // clip an entirely unrelated tree/rock along the way, at whichever hide spot
    // happens to be coverData's first match for this seed. Try every HIDE_KINDS spot
    // in order and keep the first whose actual hasLOS() (not just "outside this one
    // box") comes back clear, instead of trusting the first candidate blind.
    for(const spot of coverData){
      if(!HIDE_KINDS[spot.kind]) continue;
      const ry = spot.ry ?? 0, co = Math.cos(ry), si = Math.sin(ry);
      // Place the player 0.5 units outside the prop's local +x edge (world frame).
      // Inverse rotation: (lx,lz) -> world offset (dx,dz) = (lx*co + lz*si, -lx*si + lz*co).
      const offset = spot.hx + 0.5;
      const px = spot.x + offset * co, pz = spot.z - offset * si;
      // Lion is LION_STANDOFF more units in the same local-x direction.
      const lx = spot.x + (offset + LION_STANDOFF) * co, lz = spot.z - (offset + LION_STANDOFF) * si;
      if(!geoHasLOS(lx, lz, px, pz, coverGrid, CELL, WRAP_SPAN)) continue;
      player.x = px; player.z = pz;
      lion.x = lx; lion.z = lz;
      lion.vx = lion.vz = 0; lion.alert = 0; lion.reroute = 0; lion.stuckT = 0;
      lion.state = 'chase'; lion.hunt = true;
      return { idx, kind: spot.kind };
    }
    return null;
  };

  // LUL-388: `dist`/`canSee` added. A caller racing this predator's blind-chase
  // window against wall-clock time (e.g. "is it still blind 300ms after I
  // staged it?") is racing the dt-clamp-vs-walltime hazard for no reason --
  // canSee(p,dist) is the exact live gate the engine itself checks before a
  // kill, so a test can just poll it directly and stop caring what wall time
  // maps to what game time.
  window.ForestEngine.qaPredatorState = function(idx){
    const p = predators[idx];
    if(!p) return null;
    const dist = Math.hypot(player.x-p.x, player.z-p.z) || 0.0001;
    // LUL-659: x/z added so a caller can trace lateral movement around a cover
    // prop (e.g. avoidDir() steering), not just closing distance.
    return { kind: p.kind, state: p.state, inv: p.inv, sniffsLeft: p.sniffsLeft, scentCalls: p.scentCalls, dist, canSee: canSee(p, dist), rad: p.rad, x: p.x, z: p.z, sightLock: p.sightLock ? { phase: p.sightLock.phase, t: p.sightLock.t } : null };
  };

  // LUL-213: forces a wolf/lion straight into a charge telegraph, deterministically
  // -- the real trigger is a probabilistic per-frame roll (shouldTriggerCharge),
  // which is exactly what a test can't wait on reliably. Places the predator due
  // +x of the player at the midpoint of the trigger band, in the open (spawn
  // clearing has no cover, same guarantee qaOpenHideNearLion relies on), and
  // faces the player +x so playerCanSee() would independently agree if re-checked.
  // Returns the predator's `predators` index, or null if that species isn't spawned.
  window.ForestEngine.qaTriggerCharge = function(kind){
    if(kind !== 'wolf' && kind !== 'lion') return null;
    const idx = predators.findIndex(p => p.kind === kind);
    if(idx < 0) return null;
    const p = predators[idx];
    const dist = (CHARGE_TRIGGER_MIN + CHARGE_TRIGGER_MAX) / 2;
    player.x = 0; player.z = 0; player.yaw = -Math.PI/2;   // forward = (-sin(yaw), -cos(yaw)) = (+1, 0), faces the predator below
    p.x = player.x + dist; p.z = player.z;
    p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0; p.hunt = false; p.sightLock = null;
    p.state = 'chase'; p.scentLock = 0; p.chargeCooldown = 0;
    p.charge = startCharge(dist);
    p.chargeDirX = -1; p.chargeDirZ = 0;
    beginChargeHud();
    return idx;
  };

  // LUL-373: exposes the live ChargeState.phase/t ('telegraph'/'charging'/
  // 'overshoot'/'caught'/'cleared', and seconds elapsed in that phase -- game
  // time, not wall time) for a predator mid-charge, or null if it has none.
  // Exists so a test can poll for "well into the charging sub-phase" against
  // the engine's own game-time clock instead of guessing a wall-clock wait --
  // see wiki systems/dt-clamp-vs-walltime for why a fixed ms wait doesn't
  // reliably land at the same game-time point across rigs of different frame
  // rates.
  //
  // LUL-421: also returns overshootDuration, and falls back to the most
  // recently resolved charge (p.lastCharge) once p.charge itself goes null
  // on resolution -- lets a test read the LUL-323 overshoot-tracking value
  // straight from engine state instead of inferring it from a wall-clock
  // gap around the #chargePrompt HUD, which is the dt-clamp-vs-walltime trap
  // this ticket exists to remove. `t` is 0 in the fallback case since the
  // resolved ChargeState itself isn't kept, only the two fields the spec
  // needs.
  window.ForestEngine.qaChargePhase = function(idx){
    const p = predators[idx];
    if(!p) return null;
    if(p.charge) return { phase: p.charge.phase, t: p.charge.t, overshootDuration: p.charge.overshootDuration };
    if(p.lastCharge) return { phase: p.lastCharge.result, t: 0, overshootDuration: p.lastCharge.overshootDuration };
    return null;
  };

  // LUL-275: snapshot of the player's transform and detected input mode -- proves
  // which input branch init() actually bound at runtime, not just which the test
  // requested. See wiki: game/lul274-input-mode-separation, game/lul275-spec-design.
  window.ForestEngine.qaPlayerState = function(){
    // LUL-529: jumping/paused/toggleRunOn/veilHeld appended so mobile e2e specs
    // can assert the engine-visible effect of a touch control (a button that
    // renders and is tappable but wired to nothing would still pass a
    // DOM-presence-only test) instead of only the transform fields above.
    //
    // LUL-224: `hidden` appended so a test that presses KeyH somewhere chosen
    // for an unrelated geometric property (e.g. qaOpenHideNearLion's
    // guaranteed-cover-free spawn clearing) can assert whether the press
    // actually entered the hold-still stance, instead of assuming it either
    // did or didn't from the placement alone -- LUL-212's HIDE_RADIUS gate on
    // enterHide() means "placed somewhere" no longer implies "KeyH works
    // here".
    return {
      x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch, mode: mode,
      jumping: jumping, paused: paused, toggleRunOn: toggleRunOn,
      veilHeld: (entered && !won && !dead && !pickingUp) && (!!keys['KeyF'] || touchVeil),
      hidden: hidden,
    };
  };

  // LUL-388: reproduces the exact LUL-387 regression shape live -- a predator
  // mid-blind-scent-chase (scentLock > 0, so the 'chase' branch never falls
  // through to the canSee()-gated investigate transition), within catch range
  // of the player, with a log/bramble cover prop's (WALKABLE_KINDS -- rock/
  // reed now collide with the predator, LUL-1643, so this hook is restricted
  // to the kinds that still don't; this is a walkability invariant, not a
  // hide invariant -- this hook never presses KeyH, so it stays on
  // WALKABLE_KINDS rather than the narrower post-LUL-2311 HIDE_KINDS) rotated
  // AABB sitting on the segment between them so canSee() is false. Pre-fix
  // this died instantly
  // (bare isCaught(dist, rad)); post-fix canCatchInChase() must keep gating
  // the kill on canSee() too. Existing hooks (qaHideBehindCover(Kind)) place
  // predator and player several units apart -- clear of the cover prop
  // entirely -- which is right for the investigate/sniff cover tests they
  // drive, but too far apart to ever reach isCaught()'s dist < rad+CATCH_MARGIN
  // threshold, so they can't exercise this branch. This hook instead places
  // both points close together, straddling only the prop's *thinner* local
  // axis (mirroring coverBlockedR()'s own rotation convention -- LUL-268's
  // localX = dx*co - dz*si, localZ = dx*si + dz*co, inverted here to go
  // local -> world) so the total separation stays inside catch range while
  // the prop still fully sits between the two points.
  // LUL-388: shared by qaStageBlindChaseThroughCover and
  // qaStageAndTraceBlindChase below -- see the latter's comment for why the
  // staging and the first observed frame must happen in one synchronous
  // call, not two separate page.evaluate() round trips.
  function stageBlindChaseThroughCover(kind){
    const idx = predators.findIndex(p => p.kind === kind);
    if(idx < 0) return null;
    const p = predators[idx];
    for(const c of coverData){
      if(!WALKABLE_KINDS[c.kind]) continue;
      const thin = Math.min(c.hx, c.hz);
      // Asymmetric on purpose: the predator (point A) never collides against
      // a log/bramble cover prop (WALKABLE_KINDS) -- rock/reed now collide
      // with the predator (LUL-1643), so this hook is restricted to the
      // kinds that still don't -- so it can sit right at the box's thin face. The
      // player (point B) very much does -- blocked()'s coverBlockedR(x,z,0.6)
      // call pads every prop by the player's own 0.6 radius -- so it needs
      // to clear thin+0.6, not just thin, or qaProbePlayer/blocked() would
      // reject its own staged position as "inside" the prop.
      const offA = thin + 0.1, offB = thin + 0.6 + 0.1;
      if(offA + offB >= p.rad + CATCH_MARGIN) continue;   // must land inside catch range
      const co = Math.cos(c.ry), si = Math.sin(c.ry);
      const thinIsZ = c.hz <= c.hx;
      const lxA = thinIsZ ? 0 : -offA, lzA = thinIsZ ? -offA : 0;
      const lxB = thinIsZ ? 0 : offB, lzB = thinIsZ ? offB : 0;
      const ax = c.x + lxA*co + lzA*si, az = c.z - lxA*si + lzA*co;
      const bx = c.x + lxB*co + lzB*si, bz = c.z - lxB*si + lzB*co;
      if(predatorBlocked(ax, az, p.rad) || blocked(bx, bz)) continue;
      p.x = ax; p.z = az;
      p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0; p.sightLock = null;
      // A charge in flight (or freshly cooled down and re-triggerable) resolves
      // on its own fixed 1s timer (stepCharge()'s 'caught' phase) with zero
      // distance/LOS check at all -- by design (LUL-213: "dodgeable because it
      // committed to a line"), but it would completely swamp this hook's own
      // scentLock/canSee scenario if one happened to be in flight (or newly
      // triggered en route, once the predator's approach re-enters the 7-16
      // trigger band) when a caller polls for the outcome. Force it off so
      // this hook tests exactly the branch it says it does.
      p.charge = null; p.chargeCooldown = 999;
      p.state = 'chase'; p.hunt = false; p.scentLock = SCENT_TRACK_TIME;
      player.x = bx; player.z = bz;
      // Isolate: the player is being relocated to wherever this cover prop
      // happens to be, which could easily land inside another (untouched)
      // predator's own detect range -- nine animals roam independently, and
      // `#deathKind` only reports species, not which individual caught you.
      // Measured hitting this for real while building this hook: a *different*
      // lion, not the staged one, legitimately spotted the relocated player
      // and killed it in the open a couple of ticks in, which read as an
      // apparent regression until traced back to the wrong animal. `inert`
      // (LUL-26's difficulty-preset parking flag) is the existing, cheap way
      // to take every other predator out of `updatePredators()`'s loop
      // entirely (`if(p.inert) continue;`) for the rest of this page's life.
      for(let i = 0; i < predators.length; i++) if(i !== idx) predators[i].inert = true;
      return { idx, kind, dist: Math.hypot(ax-bx, az-bz) };
    }
    return null;
  }
  window.ForestEngine.qaStageBlindChaseThroughCover = function(kind){
    return stageBlindChaseThroughCover(kind);
  };

  // LUL-388: records {t, dist, canSee, dead} once per rendered frame via its
  // own rAF loop, entirely inside the page, until `dead` or `maxMs` elapses.
  //
  // LUL-2373: the very first sample used to come from inside the first rAF
  // callback, i.e. after at least one real render-loop `stepFrame()` had
  // already run against wall-clock dt (up to DT_CLAMP_CEILING=0.05s). For a
  // predator staged only `thin+0.1` units past a thin walkable box's edge
  // (this function's own caller straddles it that tightly on purpose, to
  // land inside catch range), a fast species' single first-frame move can
  // cross the remaining buffer and step into the box's own footprint before
  // that first sample is ever taken -- hasLOS()'s walkable-box self-
  // occlusion skip (LUL-2320 rule A) then reads that box as non-occluding
  // for the predator's new position, even though most of the box still sits
  // between it and the player. The staged position itself is genuinely
  // blind (verified directly: canSee() reads false synchronously right
  // after staging, before any frame runs) -- this was always a trace-timing
  // gap, not a staging or hasLOS bug. Sampling once synchronously, before
  // the first requestAnimationFrame is even requested, closes it: trace[0]
  // is now truly the staged instant, matching this function's own stated
  // intent above ("the trace starts from the position this function itself
  // just set").
  function traceBlindChase(idx, maxMs){
    return new Promise(function(resolve){
      const trace = [];
      const t0 = performance.now();
      function sample(){
        const p = predators[idx];
        if(!p) return null;
        const d = Math.hypot(player.x-p.x, player.z-p.z) || 0.0001;
        return { t: performance.now()-t0, dist: d, canSee: canSee(p, d), dead: dead };
      }
      const first = sample();
      if(first === null){ resolve(trace); return; }
      trace.push(first);
      if(first.dead || performance.now()-t0 > maxMs){ resolve(trace); return; }
      function frame(){
        const s = sample();
        if(s === null){ resolve(trace); return; }
        trace.push(s);
        if(s.dead || performance.now()-t0 > maxMs){ resolve(trace); return; }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  // LUL-388: stages, then starts tracing, in one synchronous call -- calling
  // qaStageBlindChaseThroughCover and a separate trace hook as two
  // page.evaluate() calls measured broken: the predator (staged only a
  // little over a unit from the player, since it has to land inside catch
  // range, and never collides with cover -- LUL-119/211) closed the entire
  // gap into a genuine sightline during the wall-clock gap between the two
  // Playwright IPC round trips, so the trace's own first frame already read
  // canSee:true. Staging synchronously and requesting the first animation
  // frame in the same call stack (rAF always defers to the next frame no
  // matter when in the current one it's called) guarantees the trace starts
  // from the position this function itself just set, not from wherever the
  // predator ends up several ticks later.
  window.ForestEngine.qaStageAndTraceBlindChase = function(kind, maxMs){
    const staged = stageBlindChaseThroughCover(kind);
    if(staged === null) return Promise.resolve(null);
    return traceBlindChase(staged.idx, maxMs).then(function(trace){
      return { idx: staged.idx, kind: staged.kind, dist: staged.dist, trace: trace };
    });
  };

  // LUL-1461: regression coverage for LUL-1091 (PR #251, "predators path
  // around trees instead of grinding into them") at the engine-integration
  // level. lib/game/cover.test.ts already unit-tests pickAvoidDirection()/
  // slideVelocity() in isolation, but nothing before this proved
  // updatePredators() actually calls them, every tick, against a real tree
  // from the live spatial grid, for a predator that has to go all the way
  // around one to reach the player.
  //
  // Deliberately not qaLurePredator(Kind): its `hunt` flag requires canSee()
  // to keep chasing at all (`if(!canSee(p,dist)){ ...; p.hunt=false; }`
  // above) -- placed behind a tree, hunt would drop to investigate on the
  // very first tick, never touching the pathing code this ticket needs to
  // exercise. `chase` + a live scentLock instead keeps closing blind while
  // scentLock holds (LUL-23's contract), the same mechanism
  // qaStageAndTraceBlindChase above already relies on.
  //
  // Both staged points sit on the tree's own z, straddling its trunk
  // symmetrically along +/-x: since the trunk's collision circle is centred
  // on that exact line, it always intersects the straight segment between
  // predator and player regardless of `margin`, with no segment-vs-circle
  // math needed. The actual standoff is derived per-tree (t.cr + p.rad +
  // margin) rather than taking a caller-supplied distance directly -- a
  // fixed standoff large enough to satisfy every tree's radius (e.g. 6)
  // measured in practice (LUL-1461) as often putting 12 units of open field,
  // and any other trees that happen to sit in it, between predator and
  // player: the trace then measures open-field multi-obstacle navigation,
  // not the single-trunk case this hook exists to isolate, and timed out for
  // bear even on already-fixed code. Hugging the trunk as tightly as
  // collision allows keeps the scenario to exactly the one obstacle, and the
  // isolation check below rejects any tree with a neighbour close enough to
  // still crowd it.
  function stageBehindTree(kind, margin){
    const idx = predators.findIndex(p => p.kind === kind);
    if(idx < 0) return null;
    const p = predators[idx];
    outer: for(const t of treeData){
      const standoff = t.cr + p.rad + margin;
      const px = t.x - standoff, pz = t.z;
      const qx = t.x + standoff, qz = t.z;
      if(predatorBlocked(px, pz, p.rad) || blocked(qx, qz)) continue;
      // Reject any tree with a neighbour close enough to crowd the direct
      // line or a reasonable sidestep around it -- otherwise a far-apart
      // pair (large margin) can silently route through a second, third tree
      // and the trace measures multi-obstacle open-field navigation instead
      // of the single-trunk case this hook exists to isolate. Lane is a
      // generous box around the straight segment (standoff+3 half-width in
      // x, neighbour's own clearance + 2.5 in z).
      const laneHalfWidth = standoff + 3;
      for(const o of treeData){
        if(o === t) continue;
        const withinX = o.x > t.x - laneHalfWidth && o.x < t.x + laneHalfWidth;
        const withinZ = Math.abs(o.z - t.z) < (o.cr + p.rad + 2.5);
        if(withinX && withinZ) continue outer;
      }
      p.x = px; p.z = pz;
      p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0; p.sightLock = null;
      p.charge = null; p.chargeCooldown = 999;
      p.state = 'chase'; p.hunt = false; p.scentLock = SCENT_TRACK_TIME;
      player.x = qx; player.z = qz;
      // Isolate, same rationale as stageBlindChaseThroughCover above: nine
      // predators roam independently, and relocating the player next to a
      // tree can easily land it inside a different, untouched predator's
      // own detect range.
      for(let i = 0; i < predators.length; i++) if(i !== idx) predators[i].inert = true;
      return { idx, kind, treeX: t.x, treeZ: t.z, treeCr: t.cr, dist: Math.hypot(px-qx, pz-qz) };
    }
    return null;
  }
  window.ForestEngine.qaStageBehindTree = function(kind, margin){
    return stageBehindTree(kind, margin);
  };

  // LUL-1461: records {t, dist, state, reached} once per rendered frame via
  // its own rAF loop, staged and started in one synchronous call for the
  // same reason qaStageAndTraceBlindChase's comment gives (an IPC round trip
  // between staging and the first observed frame lets the predator move in
  // between).
  //
  // Originally resolved on an independently-computed isCaught(d, p.rad)
  // instead of the game's own `dead` flag. Measured live (2026-09-08): the
  // wolf case's in-page trace resolved fine (reached:true at t=2100ms) and
  // page.evaluate() returned the trace to Node, but the Playwright test then
  // hung to its own timeout anyway, and the next test (bear) failed
  // immediately at boot -- cross-test contamination. traceBlindChase()
  // (above) resolves on `dead` instead and blind-chase-cover.spec.ts passes
  // in CI today, including through a real death/video sequence, so the
  // independently-computed condition -- not the death/video sequence itself
  // -- is the difference. Matching that proven pattern here: resolve once
  // the real triggerDeath() (engine/forest-engine.js:1447) has actually
  // flipped `dead`, not one frame earlier on our own geometric guess.
  function traceApproach(idx, maxMs){
    return new Promise(function(resolve){
      const trace = [];
      const t0 = performance.now();
      function frame(){
        const p = predators[idx];
        if(!p){ resolve(trace); return; }
        const d = Math.hypot(player.x-p.x, player.z-p.z) || 0.0001;
        trace.push({ t: performance.now()-t0, dist: d, state: p.state, reached: dead });
        if(dead || performance.now()-t0 > maxMs){ resolve(trace); return; }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }
  window.ForestEngine.qaStageAndTraceBehindTree = function(kind, margin, maxMs){
    const staged = stageBehindTree(kind, margin);
    if(staged === null) return Promise.resolve(null);
    return traceApproach(staged.idx, maxMs).then(function(trace){
      return { idx: staged.idx, kind: staged.kind, dist: staged.dist, trace: trace };
    });
  };

  // LUL-69: camera.fov is closure-local (created fresh per init(), see
  // CAMERA_FOV above) -- nothing outside init() could otherwise confirm the
  // mobile/desktop FOV split actually took effect.
  window.ForestEngine.qaCameraFov = function(){ return camera.fov; };

  window.ForestEngine.qaProbeAudio = function(){
    return audio
      ? { state: audio.ctx.state, started: started, soundOn: soundOn, masterGain: audio.master.gain.value }
      : { state: null, started: started, soundOn: soundOn, masterGain: null };
  };

  // LUL-2121: deterministic lose-sequence trigger for the local QA tester.
  // Unlike qaTriggerDeath (LUL-2169, above), this validates kind/cause and
  // reports whether THIS call actually landed a fresh death, so a caller can
  // assert a rejection (before enter(), during pickingUp, after a win, or
  // while already dead) as well as a success. Goes through the real
  // triggerDeath so payout, pushState(deathVisible/deathKind/deathCause),
  // hasDied persistence, playDeathVideo and deathAudio all run -- never
  // fakes state.
  //
  // Deviation from the ticket's illustrative `triggerDeath(kind,cause);
  // return dead;`: canTriggerDeath() (lib/game/outcome.ts) does not gate on
  // `entered` at all (a real death is only unreachable pre-entry because
  // nothing drives the AI/player before the gate, not because the guard
  // checks it), and plain `return dead` reports `true` for the "already
  // dead" rejection case since `dead` was already true going in -- neither
  // matches this ticket's own acceptance criteria ("false ... before
  // enter() ... or when already dead"). Added an explicit `entered` check
  // and a before/after comparison so the return value means "this call
  // triggered a fresh death", which is false in all four rejection cases
  // and true only on an actual transition. triggerDeath/canTriggerDeath
  // themselves are untouched.
  window.ForestEngine.qaForceDeath = function(kind = 'wolf', cause = 'hunt'){
    if(!entered) return false;
    if(kind !== 'wolf' && kind !== 'bear' && kind !== 'lion') return null;
    if(cause !== 'hunt' && cause !== 'chase' && cause !== 'charge') return null;
    const wasDead = dead;
    triggerDeath(kind, cause);
    return dead && !wasDead;
  };
  window.ForestEngine.qaProbeDeath = function(){
    return {
      dead, deathShown, cutsceneSkippable,
      sinceDeath: dead ? clock.elapsedTime - deathStart : null,
      video: deathVideo ? { currentTime: deathVideo.currentTime, ended: deathVideo.ended,
                            paused: deathVideo.paused, readyState: deathVideo.readyState,
                            display: deathVideo.style.display } : null,
    };
  };
  // [QA-HOOK] put a throwable in hand so #throwPrompt (desktop) / the Throw button (mobile) render.
  // Uses grabThrowable() after teleporting next to the nearest untaken stone, so the real pickup
  // path and layoutThrowableMeshes() run. Returns the stone's position or null if none exist.
  window.ForestEngine.qaGrabThrowable = function(){
    let best = -1, bestD = Infinity;
    for(let i = 0; i < throwableData.length; i++){
      const t = throwableData[i]; if(t.taken) continue;
      const d = Math.hypot(t.x - player.x, t.z - player.z);
      if(d < bestD){ best = i; bestD = d; }
    }
    if(best < 0) return null;
    player.x = throwableData[best].x + 1; player.z = throwableData[best].z;
    grabThrowable();
    return heldThrowable ? { x: throwableData[best].x, z: throwableData[best].z } : null;
  };
  // [QA-HOOK] LUL-2202: stand within THROWABLE_PICKUP_RADIUS of the first untaken stone
  // WITHOUT grabbing it (unlike qaGrabThrowable above) -- e2e/throwables.spec.ts needs the
  // real KeyE/pickup() path under test, not a pre-grabbed hand. Mirrors qaTeleportNearBaby's
  // +2 offset along one axis. Returns the stone's position, or null if every stone is taken.
  window.ForestEngine.qaTeleportNearThrowable = function(){
    const t = throwableData.find(t => !t.taken);
    if(!t) return null;
    player.x = t.x + 2; player.z = t.z;
    return { x: t.x, z: t.z };
  };
  // [QA-HOOK] LUL-2202: places the first predator of `kind` a few units inside
  // THROWABLE_NOISE_RADIUS of where the player's *next* throw would land (same landing
  // formula as throwThrowable() below), reset to a plain roaming state (same fields
  // qaOpenHideNearLion zeroes) so a test can prove a thrown stone's noise redirects an
  // otherwise-roaming predator into 'investigate', not just that it was already hunting.
  // Returns its predators index, or null if that species didn't spawn this seed.
  window.ForestEngine.qaStagePredatorNearThrowLanding = function(kind){
    const idx = predators.findIndex(p => p.kind === kind);
    if(idx < 0) return null;
    const p = predators[idx];
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const landX = player.x + fx * THROWABLE_THROW_DISTANCE;
    const landZ = player.z + fz * THROWABLE_THROW_DISTANCE;
    p.x = landX + (THROWABLE_NOISE_RADIUS - 4); p.z = landZ;
    p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0;
    p.state = 'roam'; p.hunt = false;
    return { idx };
  };
  // [QA-HOOK] stand just outside the mission target's interactRadius so #missionPanel, the
  // mission prompt and the objective are all on screen at once. Returns the target or null.
  window.ForestEngine.qaTeleportNearMission = function(){
    if(!mission) return null;
    player.x = mission.target.x + mission.target.interactRadius + 1; player.z = mission.target.z;
    return { kind: mission.target.kind, x: mission.target.x, z: mission.target.z, status: mission.status };
  };

  // [QA-HOOK] LUL-2230: exactly what the last frame drew for the scent trail
  // visual, so a test can assert the picture without depending on Vector3
  // math in the page context. `points`/`livePoints` let a test cross-check
  // "the array decayed" against "the picture decayed" independently.
  window.ForestEngine.qaProbeScentTrail = function(){ return scentTrailLastFrame; };

  // [QA-HOOK] LUL-2230: sets the camera yaw directly (the same player.yaw
  // every look-input path writes, see camera.rotation.set(player.pitch,
  // player.yaw, 0) in the render loop) so a test can turn around and look at
  // its own scent trail without pointer lock. Read-only otherwise -- no
  // movement, no pitch change.
  window.ForestEngine.qaSetLookYaw = function(rad){ player.yaw = rad; };

  // [QA-HOOK] LUL-2230/LUL-2307: clears the persisted "seen" flag and the
  // in-memory one-time gate for the 'scent' hint only, so a single boot can
  // prove the caption is first-time-only twice in the same test (show it,
  // dismiss it, reset, show it again). Kept as a thin alias over the generic
  // registry -- no current spec calls it (e2e/scent.spec.ts and
  // e2e/mobile/scent-trail.spec.ts don't), but removing a QA hook silently is
  // worse than an unused one. Prefer qaResetHints() for new tests.
  window.ForestEngine.qaResetScentCaption = function(){
    hintSeenCache.scent = false;
    if(hintActiveKey === 'scent') hintActiveKey = null;
    try { localStorage.removeItem(HINT_KEY_PREFIX + 'scent'); localStorage.removeItem(LEGACY_SCENT_HINT_KEY); } catch(e){}
    pushState({ hintVisible: false });
  };

  // [QA-HOOK] LUL-2307: the active hint's key (null if none) and the full
  // seen-map by key, so a test can assert both "this hint showed" and "no
  // other hint has been marked seen yet" without racing the 8s/dismiss timer.
  window.ForestEngine.qaProbeHints = function(){
    const seen = {};
    for(const key of HINT_PRIORITY) seen[key] = hintSeen(key);
    return { activeKey: hintActiveKey, seen };
  };

  // [QA-HOOK] LUL-2307: clears every hint's persisted "seen" flag and the
  // in-memory gate (all keys, not just 'scent') -- the generic counterpart to
  // qaResetScentCaption, and what SettingsPanel.tsx's "Reset hints" button
  // calls in real play too (resetHints(), not a QA-only path).
  window.ForestEngine.qaResetHints = function(){ resetHints(); };

  // [QA-HOOK] LUL-2328: fixed, non-rng shape per cover kind -- rollCoverPropShape()
  // (lib/game/cover.ts) rolls a random size in these same ranges every real
  // generateCover() call; qaBuildScene() below is deliberately deterministic
  // (no rng draw, so it never perturbs the seeded stream), so each kind gets
  // one representative shape at the midpoint of rollCoverPropShape()'s own
  // range instead. 'log' always renders long along x; callers wanting the
  // other orientation pass ry = Math.PI/2.
  const QA_COVER_SHAPE = {
    log:     { hx: 1.85, hz: 0.475, y: 0.3 },
    rock:    { hx: 1.35, hz: 1.28,  y: 0.74 },
    bramble: { hx: 1.15, hz: 1.15,  y: 0.69 },
    reed:    { hx: 0.7,  hz: 0.7,   y: 0.875 },
  };
  // [QA-HOOK] LUL-2328: builds a minimal, exact scene for a test that doesn't
  // want a full procedurally-generated map -- child 2/2 of epic LUL-2324
  // migrates the hook-staged e2e specs onto this instead of a real
  // generateMap() boot. Deterministic and rng-free (every position/shape is
  // caller-given or a fixed constant above), so it never touches the seeded
  // rng stream and can be called after any generateMap(), any number of
  // times. Clears and replaces treeData/coverData/bogTreeData and every
  // predator's placement; landmarkData/throwableData/mission are left as
  // whatever the last generateMap() produced (out of scope here -- see the
  // spec's Out of scope section, docs/specs/lul-2328-qa-world-micro-hooks.md).
  // Player position is also left untouched -- use qaTeleportHome/
  // qaTeleportNearBaby or a hide-staging hook for that.
  //
  // `predators`: matched to the fixed 9-entry `predators` pool (3 per
  // species, see the `for(const k of ['wolf','bear','lion'])` pool build
  // above) by `kind`, in array order -- the Nth entry of a given kind claims
  // that species' speciesIdx (N-1) slot, so at most 3 of any one kind can be
  // placed; a 4th is silently dropped (documented limit, not a caller error
  // the hook can usefully signal). Every unclaimed predator is parked
  // `inert` exactly like placePredators()'s own inert branch (`x=z=-9999`,
  // `g.visible=false`) so it can't be seen or scented.
  window.ForestEngine.qaBuildScene = function(scene_){
    const opts = scene_ || {};
    // LUL-2249: rot/tint default to fixed values -- this synthetic path draws
    // no rng at all (every position/shape is caller-given), so there's
    // nothing to draw; ensureChunk() just needs the fields present
    // (undefined would write a NaN transform, silently invisible).
    treeData = (opts.trees || []).map(t => {
      const s = t.s ?? 1.2;
      return { x: t.x, z: t.z, s, cr: 0.35*s, crCanopy: canopyRadiusAtEye(s, CONFIG.eye, CANOPY_GEO), culled: false, rot: 0, tint: 1 };
    });

    coverData = (opts.props || [])
      .filter(p => QA_COVER_SHAPE[p.kind])
      .map(p => ({ x: p.x, z: p.z, kind: p.kind, ry: p.ry || 0, ...QA_COVER_SHAPE[p.kind] }));

    bogTreeData = [];

    // LUL-2249: same full reset generateMap() does at the end of every call --
    // drop whatever the previous scene left live (sized for different data),
    // rebucket this synthetic scene's data, and let coverGrid start empty so
    // it only ever reflects what streams back in below (real cross-check:
    // e2e/qa-world-micro.spec.ts's qaStageWalkIntoCover() proves the staged
    // prop is genuinely reachable through coverData/coverGrid after this).
    for(const c of liveChunks){ dropChunk(c); dropCoverChunk(c); dropBogChunk(c); }
    liveChunks = new Set();
    lastStreamChunkX = null; lastStreamChunkZ = null;
    coverGrid = new Map();
    if(!qaNoRender){
      bucketTreeChunks(treeData);
      bucketCoverChunks();
      bucketBogChunks();
      updateStreamedChunks(true);
    }

    buildGrid();

    const byKind = new Map();
    for(const spec of (opts.predators || [])){
      const n = byKind.get(spec.kind) || 0;
      if(n >= 3) continue;   // only 3 instances of any one kind exist -- see comment above
      byKind.set(spec.kind, n + 1);
      const p = predators.find(q => q.kind === spec.kind && q.speciesIdx === n);
      if(!p) continue;
      p.inert = false; p.g.visible = true;
      p.x = spec.x; p.z = spec.z; p.wpx = spec.x; p.wpz = spec.z; p.vx = 0; p.vz = 0; p.yaw = 0;
      p.state = spec.state || 'roam'; p.spotted = false; p.inv = ''; p.sniffsLeft = 0; p.sniffTimer = 0; p.callTimer = 0;
      p.stuckT = 0; p.trail = []; p.trailT = 0; p.reroute = 0; p.hunt = false; p.alert = 0; p.scentLock = 0; p.scentCalls = 0;
      p.packTimer = 0; p.flankX = 0; p.flankZ = 0; p.sniffImmuneT = 0;
      p.lkpX = 0; p.lkpZ = 0; p.lkpSweeps = 0;
      p.charge = null; p.chargeDirX = 0; p.chargeDirZ = 0; p.chargeCooldown = 0;
      p.g.position.set(spec.x, 0, spec.z); p.g.rotation.set(0, 0, 0);
    }
    for(const p of predators){
      const claimed = (byKind.get(p.kind) || 0) > p.speciesIdx;
      if(claimed) continue;
      p.inert = true; p.g.visible = false; p.x = p.z = -9999;
    }

    if(opts.child){
      baby.x = opts.child.x; baby.z = opts.child.z; baby.taken = false;
      babyGroup.visible = true; babyGroup.position.set(baby.x, 0, baby.z);
      placeBabyWisps();
    }
    if(opts.home){ CONFIG.home.x = opts.home.x; CONFIG.home.z = opts.home.z; }

    return {
      trees: treeData.length,
      props: coverData.length,
      predators: [...byKind.values()].reduce((a, b) => a + b, 0),
    };
  };

  // [QA-HOOK] LUL-2328: renderer.info.memory (geometry/texture object counts,
  // always available) plus performance.memory (Chrome-only -- Safari/Firefox
  // don't implement it, so this reads null there; document that caveat at
  // every call site rather than polyfilling a number that isn't real).
  window.ForestEngine.qaProbeMemory = function(){
    const perfMem = (typeof performance !== 'undefined' && performance.memory) ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    } : null;
    return {
      heap: perfMem,
      renderer: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    };
  };
}

// ---- Audio debug readout (LUL-1112, founder-reachable on real iPhone) ------
if(typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('audiodebug')){
  const audioDebugEl = document.createElement('div');
  audioDebugEl.style.cssText = 'position:fixed;top:10px;left:10px;background:rgba(0,0,0,0.7);color:#fff;padding:8px;font-family:monospace;font-size:12px;z-index:10000;pointer-events:none;';
  document.body.appendChild(audioDebugEl);
  setInterval(function(){
    let text = 'audio: ';
    if(audio){
      text += 'state=' + audio.ctx.state + ' ';
      text += 'gain=' + audio.master.gain.value.toFixed(4) + ' ';
      text += 'sound=' + (soundOn ? 'on' : 'off');
    } else {
      text += 'not started';
    }
    audioDebugEl.textContent = text;
  }, 100);
}

// ---- Objective, pickup cinematic, win / death ----------------------------
const spotFlashEl = document.getElementById('spotFlash');
const bearingPulseEl = document.getElementById('bearingPulse');
const deathVideo = document.getElementById('deathVideo');
if(deathVideo) on(deathVideo, 'ended', () => { if(dead) revealLoss(); });
function pickup(){
  const next = beginPickup(runState());
  if(next.pickingUp === pickingUp) return;   // rejected -- see pickupAllowed() in lib/game/outcome.ts
  baby.taken = next.babyTaken; pickingUp = next.pickingUp; babySetDown = next.setDown;
  pickStart = clock.elapsedTime; pickBoomed = false; hidden = false; lastHideSpot = null; coverProbeAccum = 0;
  bwisps.visible = false;   // LUL-38: the beacon wisps marked where the child was found; carrying starts now
  pushState({ objectiveVisible: false, statusVisible: false });
  if(locked) document.exitPointerLock();
  document.body.style.cursor = 'none';
  armsGroup.visible = true;
  playWinMusic();
}
function buyVeilCharm(){
  if(!canBuyVeilCharm) return;
  veilReserve = true;
  embersSpent += VEIL_CHARM_PRICE;
  pushState({ caption: 'a charm against the mist', captionId: ++captionSeq });
  // Reuse the same short cue-primitive family as the reserveFired tell above for a confirming sound.
  track({ event: 'feature_engagement', feature: 'veil_charm', action: 'purchased' });
}
function setDown(){
  const next = beginSetDown(runState());
  if(next.carrying === carrying) return;   // rejected -- see setDownAllowed() in lib/game/outcome.ts
  carrying = next.carrying; babySetDown = next.setDown;
  baby.x = player.x; baby.z = player.z;
  babyGroup.position.set(baby.x, 0, baby.z);
  babyGroup.visible = true; babyGroup.scale.setScalar(1);
  placeBabyWisps();         // re-seed the ring around the NEW baby.x/z -- see correction above
  bwisps.visible = true;    // LUL-38's beacon wisps, hidden by pickup() at :3355 -- back on so she's spottable through fog again
  // reset glow to the idle baseline finishPickup()/restart() also use (:3399/:3508) --
  // the per-frame idle-glow block (§3.7 below) takes over the animated curve from here.
  bundle.material.emissiveIntensity = babyHead.material.emissiveIntensity = 0.5;
}
function grabThrowable(){
  if(heldThrowable) return;
  let nearest = -1, nearestD = THROWABLE_PICKUP_RADIUS;
  for(let i = 0; i < throwableData.length; i++){
    const t = throwableData[i];
    if(t.taken) continue;
    const d = Math.hypot(t.x - player.x, t.z - player.z);
    if(canGrabThrowable(heldThrowable, d, THROWABLE_PICKUP_RADIUS) && d < nearestD){ nearest = i; nearestD = d; }
  }
  if(nearest < 0) return;
  throwableData[nearest].taken = true;
  heldThrowable = true;
  throwableGrabCount++;
  layoutThrowableMeshes();
}
function throwThrowable(){
  if(!canThrowThrowable(heldThrowable)) return;
  heldThrowable = false;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const landX = player.x + fx * THROWABLE_THROW_DISTANCE;
  const landZ = player.z + fz * THROWABLE_THROW_DISTANCE;
  leafRustle(false);   // landing thud reuses the existing percussive-hit primitive (CTO plan decision 7) -- player-audible, same call already used by hearNoise()
  for(const p of predators){
    if(p.inert) continue;
    const dist = Math.hypot(p.x - landX, p.z - landZ);
    if(checkThrowableNoise(dist, THROWABLE_NOISE_RADIUS)) hearThrowableNoise(p, landX, landZ);
  }
}
function finishPickup(){
  // LUL-2281: the cinematic's completion IS the win now (reverts LUL-1307,
  // which used to hand off into the carry-home leg here -- see wiki
  // decisions/lul-2281-pickup-is-the-win-2026-09-09 Decisions 1/3/4).
  // playWinMusic() already fired at pickStart (pickup()) and fireBoom()
  // already fired mid-cinematic at the e>=9.3 keyframe above (this is just
  // the win bookkeeping, moved here verbatim from arriveHome(), which is
  // now unreachable in real play but left in place per Decision 2).
  const next = completePickup(runState());
  pickingUp = next.pickingUp; won = next.won;
  armsGroup.visible = false;
  babyGroup.visible = false;
  if(locked) document.exitPointerLock();
  document.body.style.cursor = '';
  logChronicle('pickup');
  // LUL-1611: winRevealed used to fire off a wall-clock later(...,1900) timer,
  // which can outrun the dt-clamped boom burst (dt clamped to 0.05/frame,
  // wiki systems/dt-clamp-vs-walltime) on a sustained sub-20fps device -- the
  // reveal is polled against boomStart in tick() instead, so it fires exactly
  // when the burst itself retires (undilated mirror of revealLoss()'s
  // CUT_END poll on the death path).
  const survivedSeconds = Math.max(0, clock.elapsedTime - enteredAt);
  // LUL-303: updatePredators() (the only other place that clears the charge
  // HUD) stops running once `playing` goes false here, so a charge/telegraph
  // in flight at the exact moment of arrival would otherwise render on top
  // of the win screen forever -- clear it the same way placePredators() does
  // on restart.
  activeCharges = 0;
  // LUL-1043: bank the run's Embers -- carried+home only pay on a win.
  // LUL-1258: the mission bonus is win-only too -- forfeited on death exactly
  // like carried/home, since computeDeathPayout's signature is untouched.
  const missionBonus = mission?.status === 'complete' ? MISSION_DEEPWATER_REWARD : 0;
  // LUL-1666: secondary bonus is independent of missionBonus -- a player can
  // win the secondary without ever completing the deepwater baseline this
  // run (already unlocked from a prior run), or complete the baseline and
  // still miss the secondary. Never gates the win itself (see spec S1).
  const secondaryWon = mission ? secondaryComplete(mission, survivedSeconds) : false;
  const secondaryBonus = secondaryWon
    ? (mission.secondary.data.kind === 'retrieval' ? DEEPWATER_RETRIEVAL_BONUS : DEEPWATER_SPEEDRUN_BONUS)
    : 0;
  const payout = applySpend(computeWinPayout(maxDistFromHome, survivedSeconds, difficulty, missionBonus, secondaryBonus), embersSpent);
  // LUL-1666: unlock is keyed on the *baseline* completing, independent of
  // whether a secondary was even attempted this run -- guardrail is "complete
  // the mission once", not "complete a secondary once". Persisted by
  // components/Hud.tsx same as embersBalance below.
  if(mission?.status === 'complete' && !missionUnlocks[mission.target.kind]){
    missionUnlocks = { ...missionUnlocks, [mission.target.kind]: true };
    pushState({ missionUnlocks: { ...missionUnlocks } });
  }
  embers = applyPayout(embers, payout);
  logChronicle('win');
  pushState({ objectiveVisible: false, statusVisible: false, winVisible: true, chargeVisible: false, survivedSeconds,
    lastPayout: payout, embersBalance: embers.balance, chronicle: chronicle.slice(), difficulty });
  track({ event: 'win', time_survived_ms: Math.round(survivedSeconds * 1000), seed: currentSeed, payout: payout.total, balance: embers.balance, difficulty });
}
// LUL-1258: M2 Deepwater's completion sting -- a noise-burst + oscillator
// chain (same procedural building blocks used elsewhere, no new audio
// files) for a short, distinct "found it" cue instead of a footstep sound
// played out of context.
function missionCompleteSting(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const nb = ctx.createBufferSource(); nb.buffer = noise(ctx, 0.12, false);
  const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value = 800; bp.Q.value = 4;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.22, t+0.01); ng.gain.exponentialRampToValueAtTime(0.0001, t+0.2);
  nb.connect(bp); bp.connect(ng); ng.connect(master); ng.connect(conv); nb.start(t); nb.stop(t+0.22);

  const o = ctx.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(340, t); o.frequency.exponentialRampToValueAtTime(560, t+0.22);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.18, t+0.03); og.gain.exponentialRampToValueAtTime(0.0001, t+0.4);
  o.connect(og); og.connect(master); og.connect(conv); o.start(t); o.stop(t+0.42);
}
// LUL-1904: cave detection-immunity cues -- distinct register from
// missionCompleteSting() above and from every other cue in the game (veil is
// silent, dim + vignette only). Rising sweep on activation, falling sweep on
// expiry, so the two are audibly distinguishable from each other too.
function caveImmuneStartCue(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(660, t + 0.35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.24, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.55);
}
function caveImmuneEndCue(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.6);
}
// LUL-1258: no cinematic lock (unlike pickup's ~2.5s gather) -- this is a
// detour bonus, not the core objective, and stopping the player's clock here
// would undercut the risk this mission is supposed to cost.
function completeMissionSequence(){
  if(mission.status === 'complete') return;   // guards a same-frame double-fire (e.g. OS key-repeat while holding E), mirrors pickup()'s own rejection check
  mission = completeMission(mission);
  pushState({ caption: 'the drowned car -- found it', captionId: ++captionSeq });   // unconditional, matches the landmark first-run caption's precedent
  missionCompleteSting();
}
// LUL-1666: retrieval's completion -- mirrors completeMissionSequence()'s
// shape exactly (guard, pure-fn update, caption, sting), no cinematic lock,
// same rationale ("a detour bonus, not the core objective").
function completeSecondarySequence(){
  if(mission.secondary?.data.kind !== 'retrieval' || mission.secondary.data.retrieved) return;
  mission = completeRetrieval(mission);
  pushState({ caption: 'the radio mast -- retrieved', captionId: ++captionSeq });
  missionCompleteSting();
}
function arriveHome(){
  const next = outcomeArriveHome(runState());
  won = next.won; carrying = next.carrying;
  babyGroup.visible = false;
  if(locked) document.exitPointerLock();
  document.body.style.cursor = '';
  playWinMusic(); fireBoom(CONFIG.home.x, 2.2, CONFIG.home.z);   // LUL-1307: the win, not the midpoint
  // LUL-1611: winRevealed used to fire off a wall-clock later(...,1900) timer,
  // which can outrun the dt-clamped boom burst (dt clamped to 0.05/frame,
  // wiki systems/dt-clamp-vs-walltime) on a sustained sub-20fps device -- the
  // reveal is now polled against boomStart in tick() instead, so it fires
  // exactly when the burst itself retires (undilated mirror of revealLoss()'s
  // CUT_END poll on the death path).
  const survivedSeconds = Math.max(0, clock.elapsedTime - enteredAt);
  // LUL-303: updatePredators() (the only other place that clears the charge
  // HUD) stops running once `playing` goes false here, so a charge/telegraph
  // in flight at the exact moment of arrival would otherwise render on top
  // of the win screen forever -- clear it the same way placePredators() does
  // on restart.
  activeCharges = 0;
  // LUL-1043: bank the run's Embers -- carried+home only pay on a win.
  // LUL-1258: the mission bonus is win-only too -- forfeited on death exactly
  // like carried/home, since computeDeathPayout's signature is untouched.
  const missionBonus = mission?.status === 'complete' ? MISSION_DEEPWATER_REWARD : 0;
  // LUL-1666: secondary bonus is independent of missionBonus -- a player can
  // win the secondary without ever completing the deepwater baseline this
  // run (already unlocked from a prior run), or complete the baseline and
  // still miss the secondary. Never gates arriveHome() itself (see spec S1).
  const secondaryWon = mission ? secondaryComplete(mission, survivedSeconds) : false;
  const secondaryBonus = secondaryWon
    ? (mission.secondary.data.kind === 'retrieval' ? DEEPWATER_RETRIEVAL_BONUS : DEEPWATER_SPEEDRUN_BONUS)
    : 0;
  const payout = applySpend(computeWinPayout(maxDistFromHome, survivedSeconds, difficulty, missionBonus, secondaryBonus), embersSpent);
  // LUL-1666: unlock is keyed on the *baseline* completing, independent of
  // whether a secondary was even attempted this run -- guardrail is "complete
  // the mission once", not "complete a secondary once". Persisted by
  // components/Hud.tsx same as embersBalance below.
  if(mission?.status === 'complete' && !missionUnlocks[mission.target.kind]){
    missionUnlocks = { ...missionUnlocks, [mission.target.kind]: true };
    pushState({ missionUnlocks: { ...missionUnlocks } });
  }
  embers = applyPayout(embers, payout);
  logChronicle('win');
  pushState({ objectiveVisible: false, statusVisible: false, winVisible: true, chargeVisible: false, survivedSeconds,
    lastPayout: payout, embersBalance: embers.balance, chronicle: chronicle.slice(), difficulty });
  track({ event: 'win', time_survived_ms: Math.round(survivedSeconds * 1000), seed: currentSeed, payout: payout.total, balance: embers.balance, difficulty });
}
function triggerDeath(kind, cause){
  const next = outcomeTriggerDeath(runState());
  if(next.dead === dead) return;   // rejected -- see canTriggerDeath() in lib/game/outcome.ts
  dead = next.dead; hidden = false; lastHideSpot = null; coverProbeAccum = 0; deathStart = clock.elapsedTime; deathShown = false;
  if(locked) document.exitPointerLock();
  document.body.style.cursor = 'none';
  const survivedSeconds = Math.max(0, deathStart - enteredAt);
  // LUL-1043: the ground you covered is all you keep -- carried+home go out with you.
  const payout = applySpend(computeDeathPayout(
    maxDistFromHome,
    survivedSeconds,
    Math.hypot(baby.x - CONFIG.home.x, baby.z - CONFIG.home.z),
    difficulty,
  ), embersSpent);
  embers = applyPayout(embers, payout);
  // LUL-1638: mirror arriveHome()'s LUL-303 fix -- updatePredators() (the only
  // other place that clears the charge HUD) stops running once `playing` goes
  // false here, so a charge/telegraph in flight at the exact moment of death
  // would otherwise render on top of the death screen forever.
  activeCharges = 0;
  const deathCarrying = carrying && !carryDeathExplained;
  if(deathCarrying) carryDeathExplained = true;
  logChronicle('death', { kind, landmark: nearestLandmarkName(player.x, player.z, LANDMARKS, CONFIG.home, CONFIG.lake) });
  // LUL-1194: full-length + unskippable only on the player's first-ever death
  // (persisted, see HAS_DIED_KEY above) -- skippable by any input every death after.
  cutsceneSkippable = hasDiedBefore;
  if(!hasDiedBefore){ hasDiedBefore = true; try { localStorage.setItem(HAS_DIED_KEY, '1'); } catch(e){} }
  pushState({ deathVisible: true, deathKind: kind, deathCause: cause, lossRevealed: false, survivedSeconds,
    lastPayout: payout, embersBalance: embers.balance, chargeVisible: false, deathCarrying, chronicle: chronicle.slice() });
  track({ event: 'loss', predator_kind: kind, death_cause: cause, time_survived_ms: Math.round(survivedSeconds * 1000), seed: currentSeed, payout: payout.total, balance: embers.balance, carrying, difficulty });
  playDeathVideo();
  deathAudio(kind);
}
function playDeathVideo(){
  if(!deathVideo || !deathVideo.getAttribute('src')){ revealLoss(); return; }   // no video embedded → just show text
  deathVideo.style.display = 'block';
  try { deathVideo.currentTime = 0; } catch(e){}
  const pr = deathVideo.play();
  if(pr && pr.catch) pr.catch(() => {});     // muted autoplay is allowed; ignore any rejection
}
function revealLoss(){ deathShown = true; document.body.style.cursor = ''; pushState({ lossRevealed: true }); }
function restart(){
  pushState({ winVisible: false, winRevealed: false, deathVisible: false, lossRevealed: false });
  if(deathVideo){ deathVideo.pause(); deathVideo.style.display = 'none'; }
  const fresh = freshRunState();
  won = fresh.won; dead = fresh.dead; pickingUp = fresh.pickingUp; carrying = fresh.carrying; babySetDown = fresh.setDown; baby.taken = fresh.babyTaken;
  hidden = false; hideTime = 0; hideKind = null; lastHideSpot = null; coverProbeAccum = 0; eyeH = CONFIG.eye; deathShown = false;
  staminaCharge = 1; staminaLowCuePlayed = false; playerBogMask = 0;
  jumping = false; jumpElapsed = 0; jumpPressed = false;   // LUL-213: no mid-arc jump carrying into the new round
  heldThrowable = false;   // LUL-1623: not RunState (CTO plan decision 6) -- reset explicitly like the other non-RunState locals above
  armsGroup.visible = false; babyGroup.visible = true; babyGroup.scale.setScalar(1);
  bundle.material.emissiveIntensity = babyHead.material.emissiveIntensity = 0.5;
  pickBoomed = false; boomGroup.visible = false; boomStart = -1; if(flashEl) flashEl.style.opacity = '0';
  roostCooldown.fill(0); roostBurstStart.fill(-1); roostGroups.forEach(g => g.visible = false);
  document.body.style.cursor = '';
  coverAmt = 0; document.body.dataset.losCovered = '0'; el.style.filter = '';   // LUL-144: no stale desaturation into the new round
  generateMap((Math.random()*1e9) >>> 0);   // fresh forest, child, and predators
  enter();
}

// ---- Controls --------------------------------------------------------
// LUL-34: these are now the engine's public action API (returned by init()
// below) instead of DOM event listeners on elements the engine no longer owns.
function setPace(v){ walk = v; pushState({ pace: v }); }
// LUL-382: no longer writes scene.fog.density directly -- tick() is now the single
// writer (it ramps between fogBase and MIST_VEIL_FOG off veilAmount every frame), so
// this only updates the baseline the veil ramps from and back to.
function setFog(v){ fogBase = v; pushState({ fog: v }); }
function toggleSound(){
  soundOn = !soundOn;
  if(audio) audio.master.gain.setTargetAtTime(soundOn ? 0.6 : 0.0001, audio.ctx.currentTime, 0.1);
  pushState({ soundOn });
}
function regenMap(){ if(!canRegenMap(runState())) return; generateMap((Math.random()*1e9)>>>0); }

// LUL-26: difficulty + accessibility actions. Mirrors setPace/setFog above --
// the engine applies the change and echoes the new value back via pushState
// so React's controls stay driven by engine state, not a second local copy.
function setDifficulty(d){
  if(!DIFFICULTY_PRESETS[d]) return;
  difficulty = d;
  track({ event: 'feature_engagement', feature: 'difficulty', action: d });
  // LUL-372: thread the real difficulty choice down to LUL-25's hard-baby-
  // spawn seam -- 'blackout' (the hardest preset: full roster, already
  // hunting, no minimap) is the only tier that also pushes the child beyond
  // the bog; 'lantern'/'night' keep the child at its normal spawn.
  babySpawnDifficulty = d === 'blackout' ? 'hard' : 'normal';
  // Difficulty changes always take effect on the next restart(), which already
  // calls placePredators() and (via generateMap()) applyHardBabySpawn().
  // The pre-entry immediate-apply branch was dead code: #settingsBtn is fully
  // covered by the gate overlay while entered===false, so Settings can never
  // be opened before the first gate click (LUL-876).
  pushState({ difficulty: d });
}
function setRunMode(m){
  if(m !== 'hold' && m !== 'toggle') return;
  runMode = m; toggleRunOn = false;
  pushState({ runMode: m });
}
function setSensitivity(v){ sensMul = clamp(v, 0.25, 3); pushState({ sensitivity: sensMul }); }
function setInvertY(v){ invertY = !!v; pushState({ invertY }); }
function setReducedMotion(v){ reducedMotionSetting = !!v; pushState({ reducedMotion: reducedMotionSetting }); }
function setCaptions(v){ captionsOn = !!v; pushState({ captionsOn }); }
// LUL-1043: sync from components/Hud.tsx's localStorage read, once on mount --
// same "engine owns the state, React persists it" split as setDifficulty/
// setRunMode/etc. above (see SettingsPanel.tsx's identical apply-on-ready
// effect). Bypasses earn/spend logic entirely -- this only ever restores a
// prior balance, it never grants or charges Embers.
function setEmbers(balance, deeperLungsTier){
  const tier = Math.max(0, Math.min(DEEPER_LUNGS_MAX_TIER, Math.floor(deeperLungsTier) || 0));
  embers = { balance: Math.max(0, Math.floor(balance) || 0), tiers: { deeperLungs: tier } };
  pushState({ embersBalance: embers.balance, embersDeeperLungsTier: tier });
}
function purchaseDeeperLungs(){
  embers = economyPurchaseDeeperLungs(embers);
  pushState({ embersBalance: embers.balance, embersDeeperLungsTier: embers.tiers.deeperLungs });
}
// LUL-1666: sync from components/Hud.tsx's localStorage read, once on mount
// -- identical split to setEmbers() above (engine owns the state, React
// persists it). `unlocks` may be a partial/stale-shaped object (schema
// could predate a future mission); only known keys are trusted.
function setMissionUnlocks(unlocks){
  missionUnlocks = { deepwater: !!(unlocks && unlocks.deepwater) };
  pushState({ missionUnlocks: { ...missionUnlocks } });
}
// LUL-1666: player's pre-run menu pick for the *next* draw. No-ops outside
// the pre-run menu the same way setDifficulty tolerates a bad value -- an
// unrecognized kind is treated as 'none'. Deliberately does not re-roll the
// current mission's secondary mid-run; per GameMenu.tsx (S4/S5), the control
// itself is only rendered while `!state.entered`.
function setSecondaryChoice(kind){
  secondaryChoice = (kind === 'retrieval' || kind === 'speedrun') ? kind : null;
  pushState({ secondaryChoice });
}
on(window, 'resize', () => {
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  applyRes();
});

// ---- Minimap -------------------------------------------------------------
const mm = document.getElementById('minimap'), mmx = mm.getContext('2d'), MM = mm.width, mmS = MM/CONFIG.mapSize;
const mmStatic = document.createElement('canvas'); mmStatic.width = MM; mmStatic.height = MM;
const sx = mmStatic.getContext('2d');
// LUL-1093: clamped so a bog coordinate (z up to zMax=240, engine/tuning.js
// CONFIG.bogDepth) pins to the canvas edge instead of being drawn off it and
// vanishing. mmS is still one scalar for both axes -- splitting into mmSx/mmSz
// is E2's job once the world stops being a 240x360 rectangle (see LUL-1483's
// spec, specs/bigger-wrapping-world-e2-e6 in the wiki). This clamp is defence
// in depth only, not a geometry fix.
function w2m(x,z){
  return [ Math.max(0, Math.min(MM, (x+half)*mmS)), Math.max(0, Math.min(MM, (z+half)*mmS)) ];
}
function drawMinimapStatic(){
  sx.clearRect(0,0,MM,MM);
  sx.fillStyle = 'rgba(10,14,21,0.5)'; sx.fillRect(0,0,MM,MM);
  sx.strokeStyle = 'rgba(150,175,215,0.25)'; sx.lineWidth = 1; sx.strokeRect(1,1,MM-2,MM-2);
  sx.fillStyle = 'rgba(120,150,120,0.5)';
  for(let i=0;i<treeData.length;i+=12){ const [px,py] = w2m(treeData[i].x, treeData[i].z); sx.fillRect(px, py, 1.2, 1.2); }
  // LUL-1093: bogTreeData/landmarkData were never drawn here -- both are
  // populated by generateBogTrees()/placeLandmarks(), which used to run AFTER
  // this function was called from generateMap() (see the generateMap() edit
  // below), so both arrays were always empty at this point. Same subsample
  // stride and fill style as the forest-tree loop above; landmarks get a
  // bigger square (3x3 vs 1.2x1.2) so they read as distinct points -- this is
  // a minimal legibility choice for a bugfix, not a final art pass.
  for(let i=0;i<bogTreeData.length;i+=4){ const [px,py] = w2m(bogTreeData[i].x, bogTreeData[i].z); sx.fillRect(px, py, 1.2, 1.2); }
  // LUL-2248: colour each landmark by its beacon hue so the minimap square
  // maps unambiguously to a landmark kind. `cave` has no LANDMARK_BEACONS
  // entry (it never got a beacon sprite -- out of scope, see the spec), so it
  // falls back to the plain tree-dot fill instead of throwing.
  for(const l of landmarkData){
    const [px,py] = w2m(l.x, l.z);
    const beacon = LANDMARK_BEACONS[l.kind];
    sx.fillStyle = beacon ? ('#' + beacon.color.toString(16).padStart(6, '0')) : 'rgba(120,150,120,0.5)';
    sx.fillRect(px-1.5, py-1.5, 3, 3);
  }
  const [lx,ly] = w2m(CONFIG.lake.x, CONFIG.lake.z);
  sx.beginPath(); sx.arc(lx, ly, CONFIG.lake.r*mmS, 0, Math.PI*2); sx.fillStyle = 'rgba(134,184,255,0.55)'; sx.fill();
  // LUL-2225: the bog patch was never drawn here (LUL-1902 explicitly scoped
  // the minimap out) -- with a small, keep-clear patch there's finally a
  // single clean disc to draw, same pattern as the lake immediately above.
  // Blackout still hides the whole minimap (see the LUL-1505-era caller),
  // so this doesn't help blackout read the patch -- that's the point of it.
  const [bx,by] = w2m(BOG_CENTER.x, BOG_CENTER.z);
  sx.beginPath(); sx.arc(bx, by, BOG_OUTER_RADIUS*mmS, 0, Math.PI*2); sx.fillStyle = 'rgba(70,110,80,0.5)'; sx.fill();
  // LUL-2248: home as a warm stroked ring (not a filled disc, so it reads
  // distinctly from the lake/bog fills) -- a small fixed minimap radius since
  // CONFIG.home.r is a gameplay proximity radius, not a visual size.
  const [hx,hy] = w2m(CONFIG.home.x, CONFIG.home.z);
  sx.beginPath(); sx.arc(hx, hy, 4, 0, Math.PI*2);
  sx.strokeStyle = '#' + CONFIG.home.glow.toString(16).padStart(6, '0'); sx.lineWidth = 4; sx.stroke();
}
function drawMinimap(){
  mmx.clearRect(0,0,MM,MM); mmx.drawImage(mmStatic, 0, 0);
  const [px,py] = w2m(player.x, player.z);
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), a = Math.atan2(fz, fx);
  mmx.save(); mmx.translate(px, py); mmx.rotate(a);
  mmx.fillStyle = '#cfe0ff'; mmx.beginPath();
  mmx.moveTo(6,0); mmx.lineTo(-4,3.5); mmx.lineTo(-4,-3.5); mmx.closePath(); mmx.fill();
  mmx.restore();
}

// ---- Post-processing: bloom + filmic tone map + vignette + dither ---------
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FS_BRIGHT = `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float threshold;
void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(0.2126,0.7152,0.0722));
  gl_FragColor = vec4(c * smoothstep(threshold, threshold+0.28, l), 1.0); }`;
const FS_BLUR = `varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 dir; uniform vec2 texel;
void main(){ vec2 o = dir*texel; vec3 s = texture2D(tDiffuse, vUv).rgb*0.227027;
  s += texture2D(tDiffuse, vUv + o*1.3846).rgb*0.316216; s += texture2D(tDiffuse, vUv - o*1.3846).rgb*0.316216;
  s += texture2D(tDiffuse, vUv + o*3.2308).rgb*0.070270; s += texture2D(tDiffuse, vUv - o*3.2308).rgb*0.070270;
  gl_FragColor = vec4(s, 1.0); }`;
const FS_COMPOSITE = `varying vec2 vUv; uniform sampler2D tScene; uniform sampler2D tBloom;
uniform float bloomStrength; uniform float exposure; uniform float time;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec3 col = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * bloomStrength;
  col = pow(aces(col * exposure), vec3(1.0/2.2));
  float vig = 1.0 - smoothstep(0.35, 1.1, length(vUv-0.5)*1.3);
  col *= mix(0.72, 1.0, vig);
  col += (hash(gl_FragCoord.xy + time*60.0) - 0.5) / 255.0;   // dither kills banding in the dark
  gl_FragColor = vec4(col, 1.0);
}`;
let usePost = false, sceneRT, brightRT, blurA, blurB, fsScene, fsCam, fsQuad, matBright, matBlur, matComposite;
// LUL-2257: renderer.info.render resets on every renderer.render() call (autoReset
// defaults true), so by the time a frame finishes, it only reflects the last call --
// the final post-process blit (a 2-triangle full-screen quad), not the forest.
// Captured right after the real scene render in renderPost(), before the bloom/blur/
// composite blits overwrite it, so qaProbePerf() can read the real scene stats.
let lastScenePerf = { calls: 0, triangles: 0 };
const resLevels = [Math.min(devicePixelRatio,1.5), Math.min(devicePixelRatio,1.1), 0.8].filter((v,i,a)=>a.indexOf(v)===i);
let resIdx = 0, RES = resLevels[0];
function makeTargets(){
  renderer.setPixelRatio(RES); renderer.setSize(innerWidth, innerHeight);
  const W = Math.max(2, Math.floor(innerWidth*RES)), H = Math.max(2, Math.floor(innerHeight*RES));
  const full = { minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, format:THREE.RGBAFormat, type:THREE.UnsignedByteType };
  const half = { minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, format:THREE.RGBAFormat, type:THREE.UnsignedByteType, depthBuffer:false };
  [sceneRT, brightRT, blurA, blurB].forEach(rt => rt && rt.dispose());
  sceneRT = new THREE.WebGLRenderTarget(W, H, full);
  const hw = Math.max(1, W>>1), hh = Math.max(1, H>>1);
  brightRT = new THREE.WebGLRenderTarget(hw, hh, half);
  blurA = new THREE.WebGLRenderTarget(hw, hh, half);
  blurB = new THREE.WebGLRenderTarget(hw, hh, half);
  matBlur.uniforms.texel.value.set(1/hw, 1/hh);
}
function initPost(){
  try {
    fsScene = new THREE.Scene(); fsCam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), null); fsScene.add(fsQuad);
    matBright = new THREE.ShaderMaterial({ uniforms:{ tDiffuse:{value:null}, threshold:{value:0.60} }, vertexShader:VS, fragmentShader:FS_BRIGHT });
    matBlur = new THREE.ShaderMaterial({ uniforms:{ tDiffuse:{value:null}, dir:{value:new THREE.Vector2()}, texel:{value:new THREE.Vector2()} }, vertexShader:VS, fragmentShader:FS_BLUR });
    matComposite = new THREE.ShaderMaterial({ uniforms:{ tScene:{value:null}, tBloom:{value:null}, bloomStrength:{value:0.85}, exposure:{value:1.05}, time:{value:0} }, vertexShader:VS, fragmentShader:FS_COMPOSITE });
    makeTargets(); renderPost(0); usePost = true;   // warm-up render forces shader compile; throws fall back below
  } catch(err){ usePost = false; console.warn('Post-processing unavailable, using direct render.', err); }
}
function blit(mat, target){ fsQuad.material = mat; renderer.setRenderTarget(target || null); renderer.render(fsScene, fsCam); }
function renderPost(t){
  renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
  lastScenePerf = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  matBright.uniforms.tDiffuse.value = sceneRT.texture; blit(matBright, brightRT);
  let src = brightRT;
  for(let i=0;i<3;i++){
    matBlur.uniforms.tDiffuse.value = src.texture;  matBlur.uniforms.dir.value.set(1,0); blit(matBlur, blurA);
    matBlur.uniforms.tDiffuse.value = blurA.texture; matBlur.uniforms.dir.value.set(0,1); blit(matBlur, blurB);
    src = blurB;
  }
  matComposite.uniforms.tScene.value = sceneRT.texture;
  matComposite.uniforms.tBloom.value = blurB.texture;
  matComposite.uniforms.time.value = t;
  blit(matComposite, null);
  renderer.setRenderTarget(null);
}
initPost();
if(!usePost){                                   // fallback: let the renderer tone-map directly
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(RES); renderer.setSize(innerWidth, innerHeight);
}
// adaptive resolution: drop internal scale if frames get expensive, raise if they're cheap
let accT = 0, accN = 0, lastAdapt = 0;
function adaptResolution(dt, t){
  accT += dt; accN++;
  if(t - lastAdapt < 1.5 || accN < 12) return;
  const avg = accT/accN; accT = 0; accN = 0; lastAdapt = t;
  if(avg > 0.024 && resIdx < resLevels.length-1){ resIdx++; RES = resLevels[resIdx]; applyRes(); }
  else if(avg < 0.015 && resIdx > 0){ resIdx--; RES = resLevels[resIdx]; applyRes(); }
}
function applyRes(){ if(usePost) makeTargets(); else { renderer.setPixelRatio(RES); renderer.setSize(innerWidth, innerHeight); } }

// LUL-1709: maps timeOfRun (0..1) onto a plain hh:mm clock label, dawn (06:00) at
// timeOfRun=0 to full night (21:00) at timeOfRun=1 -- linear, matching every other
// ramp in this feature. Plain text only, no icon/color chrome (ticket's explicit
// MVP cap) -- that is Phase-2-adjacent polish, not this pass.
const TIME_OF_RUN_CLOCK_START_MIN = 6 * 60;
const TIME_OF_RUN_CLOCK_END_MIN = 21 * 60;
function formatTimeOfRunClock(t){
  const totalMin = TIME_OF_RUN_CLOCK_START_MIN + t * (TIME_OF_RUN_CLOCK_END_MIN - TIME_OF_RUN_CLOCK_START_MIN);
  const h24 = Math.floor(totalMin / 60) % 24;
  const m = Math.floor(totalMin % 60);
  const period = h24 < 12 ? 'AM' : 'PM';
  let h12 = h24 % 12; if(h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// ---- Build the first map, then run ---------------------------------------
generateMap(resolveInitialSeed());
const clock = new THREE.Clock();
let qaFixedDt = null;   // LUL-2071: non-null while a test has parked the RAF loop via qaSetFixedStep()
let bobPhase = 0;
let rafId = null;

function stepFrame(dt, t){
  // LUL-68: right stick look rate applied each frame before movement.
  // LUL-276: mobile-only -- in desktop mode this whole block is dead, not
  // merely fed zeroes, because setTouchLook is a no-op there (see below) and
  // this `if` never runs in the first place. YAW/PITCH halved-ish from the
  // original 2.2/1.5 (tuning call, tester+founder to confirm -- see wiki
  // game/lul274-input-mode-separation).
  let hasTouchMove = false;
  if(mode === 'mobile'){
    if(touchLook.x || touchLook.y){
      const YAW_SPEED = 1.1, PITCH_SPEED = 0.7;  // rad/s at full stick
      player.yaw -= touchLook.x * YAW_SPEED * dt;
      player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch - touchLook.y * PITCH_SPEED * dt));
    }
    hasTouchMove = Math.hypot(touchMove.x, touchMove.z) > 0.15;
  }

  // hiding: H toggles crouch at a hiding spot (LUL-212, see findHideSpot/
  // toggleHidden above), any movement key breaks it
  const moveKey = keys['KeyW']||keys['KeyS']||keys['KeyA']||keys['KeyD']||keys['ArrowUp']||keys['ArrowDown']||keys['ArrowLeft']||keys['ArrowRight'];
  if(hidden && (moveKey || hasTouchMove)) exitHide();
  hideTime = hidden ? hideTime + dt : 0;
  eyeH += ((hidden ? 1.05 : CONFIG.eye) - eyeH) * Math.min(1, dt*8);

  // LUL-213: advance in game time (dt is already clamped above -- see wiki
  // systems/dt-clamp-vs-walltime) so the arc can't drift relative to
  // predator movement/animation, which run off the same dt.
  if(jumping){ jumpElapsed += dt; if(jumpElapsed >= JUMP_DURATION){ jumping = false; jumpElapsed = 0; } }
  const jumpY = jumping ? jumpOffset(jumpElapsed) : 0;

  const playing = isPlaying(runState()) && !paused;

  if(playing) runElapsed += dt;
  timeOfRun = clamp(runElapsed / TIME_OF_RUN_DURATION_S, 0, 1);

  // LUL-40/LUL-382: hold KeyF for the mist veil. Read every frame like `running`
  // below rather than from the keydown/keyup handlers, so releasing F while e.g.
  // the pause menu is open (which stops updating `keys` mid-hold) can't strand
  // the veil active.
  const veilHeld = playing && (!!keys['KeyF'] || touchVeil);
  // LUL-1043: Deeper Lungs' lever -- 5s base, +1s per tier purchased.
  const veilStep = stepVeilCharge({ charge: veilCharge, locked: veilLocked, reserve: veilReserve }, veilHeld, dt, veilMaxHoldForTier(embers.tiers.deeperLungs));
  const reserveFired = veilReserve && !veilStep.reserve;   // LUL-1210: charm consumed this frame
  veilCharge = veilStep.charge; veilLocked = veilStep.locked; veilReserve = veilStep.reserve;
  if(reserveFired){
    pushState({ caption: 'the charm held', captionId: ++captionSeq });
    // Reuse whatever the nearest existing short one-shot cue primitive is (the same family as
    // missionCompleteSting() -- grep for its definition and mirror it) for an audible tell.
  }
  const dimmed = veilStep.active;
  if(dimmed !== lightDimmed){
    lightDimmed = dimmed;
    const cfg = dimmed ? LIGHT_DIMMED : LIGHT_NORMAL;
    playerLight.intensity = cfg.intensity;
    playerLight.distance = cfg.distance;
    pushState({ lightDimmed });
    // LUL-1317: mirrors enterHide's feature_engagement('hide') -- fires once per
    // activation (the rising edge), not every frame the veil is held.
    if(dimmed) track({ event: 'feature_engagement', feature: 'veil', action: 'used' });
  }
  dimAmount += ((lightDimmed ? 1 : 0) - dimAmount) * Math.min(1, dt*6);
  applyVignette(dimAmount);
  // LUL-382: mist ramp is deliberately slower than the vignette above (VEIL_RAMP
  // 1.6s vs. dimAmount's ~0.5s) -- the light pool reacts fast, the world's mist
  // visibly billows in behind it. effectiveDetect() reads veilAmount directly, so
  // the sight-detect cut ramps in step with what the player actually sees.
  veilAmount += ((lightDimmed ? 1 : 0) - veilAmount) * Math.min(1, dt / VEIL_RAMP);
  scene.fog.density = veilFogDensity(fogBase, MIST_VEIL_FOG, veilAmount) + fogTideFogBoost(fogTideAmountAt(player.x, player.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)) + timeOfRun * TIME_OF_RUN_FOG_DELTA;
  hemiLight.intensity = HEMI_BASE_INTENSITY * (1 - timeOfRun * 0.7);
  pushState({ veilCharge: Math.round(veilCharge * 100) / 100, veilLocked, staminaCharge: Math.round(staminaCharge * 100) / 100, timeOfRunClock: formatTimeOfRunClock(timeOfRun) });

  // LUL-27: Fog Tide. The clock only advances while `playing` -- same gate
  // the veil above reads -- so the pause menu freezes the cycle exactly like
  // it freezes everything else. Deterministic by construction: driven off
  // the dt-clamped game clock, not a new RNG draw (see lib/game/fogTide.ts
  // for why this deliberately doesn't touch the map's seeded rng() stream).
  if(playing) fogTideClock = (fogTideClock + dt) % FOG_TIDE_CONFIG.period;
  const fogTidePhaseNow = fogTidePhase(fogTideClock);
  // audio telegraph: no inertia baked into the raw signal (see
  // eventCycleBuildAmount's doc comment), so ease it here at its own rate --
  // faster than the world-effect ramp below, the drone should feel responsive.
  fogTideBuild += (fogTideBuildAmount(fogTideClock) - fogTideBuild) * Math.min(1, dt / FOG_TIDE_AUDIO_RAMP);
  // world effect: same "reacts fast, billows in behind it" relationship
  // VEIL_RAMP already has to dimAmount above, just slower (fog *thickens*).
  fogTideAmount += (fogTideActiveTarget(fogTideClock) - fogTideAmount) * Math.min(1, dt / FOG_TIDE_RAMP);
  if(fogTidePhaseNow === 'active' && !fogTideActive){
    fogTideActive = true;
    track({ event: 'feature_engagement', feature: 'fog_tide', action: 'start' });
    logChronicle('fog_tide_start');
  } else if(fogTidePhaseNow !== 'active' && fogTideActive){
    fogTideActive = false;
    track({ event: 'feature_engagement', feature: 'fog_tide', action: 'end' });
    logChronicle('fog_tide_end');
  }

  let spd = 0, dist = 0, running = false, noiseRadius = 0;
  const playerBogginess = biomeAt(player.x, player.z);   // LUL-1483: continuous 0..1, was a boolean z-band test
  playerBogMask = bogMaskLevel(playerBogginess, playerBogMask, dt);   // LUL-1902: decaying wolf-scent-mask, see checkScent()
  // LUL-791/LUL-392: the lake used to be pure render -- no collision, no slow,
  // walkable like dry ground. `inLakeWater` (the visible water radius `r`,
  // not the wider `clear` spawn-clearance ring the spawn checks use) so the
  // slow starts exactly where the water mesh does, not several units of dry
  // shore early. A wade-slow, not a wall, per the ticket: the lake reads as
  // an atmospheric hazard, and a hard invisible wall in a fog-heavy horror
  // game reads as a bug even when intentional -- and it plays into the core
  // hiding loop (risk the slow crossing, or go around).
  const playerInLake = inLakeWater(player.x, player.z, CONFIG.lake);
  if(playing && !hidden){
    running = runMode === 'toggle' ? (toggleRunOn || touchSprint) : (keys['ShiftLeft'] || keys['ShiftRight'] || touchSprint);
    staminaCharge = stepStamina({ charge: staminaCharge }, running, dt).charge;
    if(staminaCharge < 0.45 && !staminaLowCuePlayed) { staminaExertionCue(); staminaLowCuePlayed = true; }
    else if(staminaCharge > 0.55) staminaLowCuePlayed = false;
    const maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) * (carrying ? CONFIG.carryPaceMul : 1) * bogSpeedMultiplier(playerBogginess) * lakeSpeedMultiplier(playerInLake);
    let ix = 0, iz = 0;
    if(keys['KeyW'] || keys['ArrowUp'])    iz += 1;
    if(keys['KeyS'] || keys['ArrowDown'])  iz -= 1;
    if(keys['KeyD'] || keys['ArrowRight']) ix += 1;
    if(keys['KeyA'] || keys['ArrowLeft'])  ix -= 1;
    // LUL-68: merge touch left-stick direction (threshold 0.2 dead-zone)
    if(hasTouchMove){ ix += touchMove.x; iz += touchMove.z; }
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const rx =  Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    let mvx = fx*iz + rx*ix, mvz = fz*iz + rz*ix;
    const mag = Math.hypot(mvx, mvz);
    if(mag > 0){
      mvx /= mag; mvz /= mag; spd = maxSpd;
      escX = mvx; escZ = mvz;   // LUL-24: record the flight heading wolves flank off of
      const step = maxSpd*dt, lim = half - margin, zLim = zMax - margin;
      const nx = Number.isFinite(WRAP_SPAN)
        ? wrapCoord(player.x + mvx*step, WRAP_SPAN)
        : Math.max(-lim, Math.min(lim, player.x + mvx*step));
      const nz = Number.isFinite(WRAP_SPAN)
        ? wrapCoord(player.z + mvz*step, WRAP_SPAN)
        : Math.max(-lim, Math.min(zLim, player.z + mvz*step));
      if(!blocked(nx, player.z)){ dist += Math.abs(nx - player.x); player.x = nx; }  // slide along trunks
      if(!blocked(player.x, nz)){ dist += Math.abs(nz - player.z); player.z = nz; }
      // LUL-23: lay scent while actually moving -- holding still (or being hidden,
      // which already implies not moving) never adds to the trail.
      scentEmitT -= dt;
      if(scentEmitT <= 0){ depositScent(running, isMovingAgainstWind(mvx, mvz, windX, windZ)); scentEmitT = SCENT_DEPOSIT_INTERVAL; }
      // LUL-39: footsteps carry too -- same "moving = louder, still = silent"
      // shape as scent, sized off the same running flag rather than a new one.
      // LUL-25: splashing through the bog carries further than a dry footstep --
      // the sight-cover reeds give you costs you on the sound channel instead.
      noiseRadius = (running ? NOISE_RADIUS_RUN : NOISE_RADIUS_WALK) * bogNoiseMultiplier(playerBogginess);
    }
  }

  // LUL-2249: once per stepFrame(), after every player.x/player.z write this
  // function makes (confirmed by grepping every `player.x =`/`player.z =`
  // assignment in stepFrame() -- the pair above is the last one) -- not
  // nested inside the movement block above, so a position set directly by a
  // QA teleport hook (qaTeleportNearBaby/qaTeleportHome/qaTeleportTo) still
  // gets picked up on the very next frame even with zero movement input.
  // Cheap when the player's chunk hasn't changed (two Math.floor + a
  // compare) -- see updateStreamedChunks()'s own early return.
  updateStreamedChunks(false);

  // LUL-1043: Embers' `depth` term -- displacement from home, not path length
  // (that's `dist` above). Tracked every tick regardless of movement this
  // frame so it also holds correctly through the pickup cinematic and the
  // carry leg, not just while the movement block above is live.
  if(entered){
    const distFromHome = Math.hypot(player.x - CONFIG.home.x, player.z - CONFIG.home.z);
    if(distFromHome > maxDistFromHome) maxDistFromHome = distFromHome;
    if(!won && !dead){
      pushState({ livePileEmbers: computeDepth(maxDistFromHome) + computeSurvival(clock.elapsedTime - enteredAt) - embersSpent });
    }
  }

  if(pickingUp){
    const e = clock.elapsedTime - pickStart;
    // LUL-2281: restores the pre-LUL-1307 ascend/boom cinematic (git show
    // 0e55c85, the commit LUL-1307 reverted) -- arms rise into frame, gather
    // the child, lift, then release to the sky. LUL-1307 had shortened this
    // to a 2.5s gather-only curve because completing it used to just start
    // the carry-home leg; now completing it IS the win (see completePickup()
    // in lib/game/outcome.ts), so the full "child goes to the sky and
    // explodes" curve the founder asked for (LUL-2281) is what belongs here.
    const lift   = key3(e, [[0,-0.95],[1.5,-0.9],[3.5,-0.35],[6,-0.05],[8,0.1],[9.5,-0.5],[10,-0.95]]);
    const fwd    = key3(e, [[0,-0.5],[3.5,-0.72],[6,-0.78],[8,-0.72],[10,-0.5]]);
    const spread = key3(e, [[0,0.3],[3.5,0.1],[6,0.13],[8,0.32],[10,0.3]]);
    const pitchA = key3(e, [[0,0.2],[3.5,-0.35],[6,-0.8],[8,-1.05],[10,0.2]]);
    armL.position.set(-spread, lift, fwd); armL.rotation.set(pitchA, 0,  0.2);
    armR.position.set( spread, lift, fwd); armR.rotation.set(pitchA, 0, -0.2);
    // the child ascends, brightening as it goes
    const ay = key3(e, [[0,0],[3.5,0.25],[5,1.6],[7,12],[9,34],[10,55]]);
    const boomed = e >= 9.3;
    babyGroup.visible = !boomed; babyGroup.position.set(baby.x, ay, baby.z); babyGroup.rotation.y = e*0.6;
    halo.material.opacity = Math.min(0.5, 0.12 + e*0.05);
    bundle.material.emissiveIntensity = babyHead.material.emissiveIntensity = 0.5 + e*0.15;
    babyLight.intensity = boomed ? 0 : key3(e, [[0,1],[4,3.2],[7,2],[9,3.5]]);
    if(boomed && !pickBoomed){ pickBoomed = true; fireBoom(baby.x, ay, baby.z); }   // the child bursts into the sky -- the win moment's visual, finishPickup() below does the bookkeeping
    // camera holds position and tilts up to follow the child, then the burst --
    // LUL-26: under reduced motion, skip the tilt-to-follow slerp (exactly the
    // camera motion the setting exists to remove) and just hold the player's
    // own look direction instead.
    camera.position.set(player.x, CONFIG.eye, player.z);
    if(motionReduced()){
      camera.rotation.set(player.pitch, player.yaw, 0);
    } else {
      lookM.lookAt(camera.position, boomGroup.visible ? boomGroup.position : babyGroup.position, camera.up);
      lookQ.setFromRotationMatrix(lookM);
      camera.quaternion.slerp(lookQ, 0.06);
    }
    if(e >= 11.3) finishPickup();
  } else if(carrying){
    // LUL-38: carrying phase — child rides at the player's feet, glowing
    babyGroup.position.set(player.x, Math.sin(t*1.4)*0.04, player.z);
    babyGroup.rotation.y = t * 0.4;
    halo.material.opacity = carryHaloOpacity(t) * DIFFICULTY_PRESETS[difficulty].glowMul * fogTideGlowMul(fogTideAmountAt(player.x, player.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN));
    babyLight.intensity = carryGlowIntensity(t) * DIFFICULTY_PRESETS[difficulty].glowMul * fogTideGlowMul(fogTideAmountAt(player.x, player.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN));
    babyLight.distance = BABY_LIGHT_DISTANCE * fogTideGlowRangeMul(fogTideAmountAt(player.x, player.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN));
    camera.position.set(player.x, eyeH + jumpY, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    const dh = Math.hypot(player.x - CONFIG.home.x, player.z - CONFIG.home.z);
    // LUL-1255 (Ship 1 wayfinding S5): same tempo-carries-distance shape as
    // cryTimer (S3d) -- 5.5s far, 2s close, density rising as dh shrinks.
    homeFireTimer -= dt;
    if(homeFireTimer <= 0){
      homeFireCrackle(dh);
      const nearH = Math.max(0, Math.min(1, 1 - dh / 140));
      homeFireTimer = 5.5 - nearH * 3.5;
    }
    // LUL-1857: carry-leg cry pulse -- reuses cryTimer (LUL-1674 S3d) rather than a
    // second timer, so outbound and carry-leg cry cadence stay one clock (mitigation
    // 1: "one source, two consumers"). The outbound pulse block below (`if(!baby.taken
    // || babySetDown)`) is the exact logical negation of `carrying`, so the two never
    // both fire in the same frame -- safe to share the module-level cryTimer.
    cryTimer -= dt;
    if(cryTimer <= 0){
      childCry(0, player.x, player.z);   // in your arms: always "near" (near=1), centered (no pan)
      cryTimer = 2;                      // closest-tempo floor -- matches the outbound block's own near=1 case (5.5 - 1*3.5)
      carriedCryPulse = true;            // consumed by updatePredators() this same tick, cleared after
    }
    // LUL-596: canArriveHome() also requires !dead && !won -- this call site
    // used to be the only thing keeping a dead player from winning (positional
    // safety, not a precondition). Do not drop this guard.
    if(canArriveHome(runState(), dh, CONFIG.home.r)) arriveHome();
  } else if(dead){
    // the death "cutscene" is a real video overlay (see #deathVideo); just reveal the loss text at the end
    if((clock.elapsedTime - deathStart) >= CUT_END && !deathShown) revealLoss();
  } else {
    if(spd > 0 && !motionReduced()) bobPhase += dt * 9;
    const bob = spd > 0 && !motionReduced() ? Math.sin(bobPhase) * 0.06 : 0;
    camera.position.set(player.x, eyeH + bob + jumpY, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    // LUL-1611: reveal the win text once the boom burst itself retires
    // (boomStart resets to -1 in updateBoom() at e>1.8s) instead of a
    // wall-clock timer -- see arriveHome() for why. fireBoom() only ever
    // fires from arriveHome(), so boomStart<0 here unambiguously means the
    // win burst that just played has finished, not "no burst yet".
    if(hudState.winVisible && !hudState.winRevealed && boomStart < 0) pushState({ winRevealed: true });
  }

  // LUL-1255 (Ship 1 wayfinding S3c): cry radius is fog-tide-scaled at the
  // child's own position, same fogTideAmountAt() pattern as babyLight's other
  // two call sites (idle glow uses babyGroup position, carry uses player
  // position) -- the cry originates at the child, so it uses baby.x/z.
  const cryNoiseRadius = CRY_NOISE_RADIUS * fogTideGlowRangeMul(fogTideAmountAt(baby.x, baby.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN));
  if(playing) updatePredators(dt, noiseRadius, cryNoiseRadius);   // predators only hunt while you're actually playing
  if(playing) updateRoosts(dt);   // LUL-1914: roost feedback, same gate as predator AI
  carriedCryPulse = false;   // LUL-1857: one-tick pulse, consumed above -- clear so it isn't sticky
  jumpPressed = false;   // consumed for this frame's charge-dodge resolution above

  // ---- threat metrics: nearest predator + who's actively coming for you ----
  let nearDist = 1e9, nearP = null, approaching = false;
  // LUL-144: cover-state feedback. `canSee()` (the raycast that actually
  // gates detection, see the LUL-43 block above) never depended on `hidden`
  // -- walking behind a rock breaks it exactly as well as crouching -- but
  // nothing on screen ever reflected that. Scan every predator with the same
  // in-range + hasLOS() test canSee() uses, but keep going past the first hit
  // so "is anyone able to see me" and "is a nearby threat blocked by cover"
  // are both known, not just whichever predator the array reaches first.
  let exposedNow = false, coveredNow = false;
  if(playing){
    for(const p of predators){
      if(p.inert) continue;   // LUL-26: parked out for the current difficulty preset
      const dpd = Math.hypot(player.x - p.x, player.z - p.z);
      if(dpd < nearDist){ nearDist = dpd; nearP = p; }
      if(p.state==='chase' || p.hunt || (p.state==='investigate' && p.inv!=='back') || (p.state==='roam' && p.lkpSweeps > 0)) approaching = true;
      if(dpd < effectiveDetect(p)){
        if(hasLOS(p.x, p.z, player.x, player.z)) exposedNow = true; else coveredNow = true;
      }
    }
    // if nobody has been near for 30s, the closest one comes straight for you
    if(nearDist < 20) sinceClose = 0; else sinceClose += dt;
    if(sinceClose > 30 && nearP && !hidden){ nearP.hunt = true; nearP.scentLock = FORCE_HUNT_LOCK; nearP.sightLock = null; spotOnto(nearP); sinceClose = 12; }
    // approach piano note: quicker + higher the nearer it is
    if(approaching && nearDist < 46){
      approachPianoActive = true;
      pianoTimer -= dt;
      if(pianoTimer <= 0){
        const near01 = clamp(1 - nearDist/46, 0, 1);           // 0 far … 1 close
        pianoTimer = 1.3 - near01*0.95;                        // interval shortens as it nears
        const steps = [0,3,5,7,10,12][Math.min(5, Math.floor(near01*6))];
        // LUL-1308: bearing drives both the note's stereo pan and the screen-edge
        // glow. 'ahead' is skipped for the glow -- the player's own view already
        // covers it, see lib/game/bearing.ts's Bearing.side doc.
        const bearing = bearingOf(nearP.x, nearP.z, player.x, player.z, player.yaw);
        pianoNote(98 * Math.pow(2, steps/12), 0.5 + near01*0.6, bearingPan(bearing));
        if(bearing.side !== 'ahead'){ bearingPulseSide = bearing.side; bearingPulseT = 1; }
      }
    } else { pianoTimer = 0; approachPianoActive = false; }
  } else { sinceClose = 0; approachPianoActive = false; }

  // LUL-144: the player-facing half of the scan above. `covered` is the
  // instantaneous, un-eased signal (a real predator, in range, LOS blocked,
  // and nothing nearer has you spotted) -- exposed on the canvas element so
  // it's assertable without parsing the eased CSS filter string below.
  // `coverAmt` eases toward it (Conviction-style: no HUD chrome, the screen
  // itself desaturates while cover is actually working) at a faster rate
  // going in than coming out, so losing cover reads immediately while
  // regaining it doesn't flicker on a one-frame LOS gap.
  const covered = playing && coveredNow && !exposedNow;
  document.body.dataset.losCovered = covered ? '1' : '0';
  const coverTarget = covered ? 1 : 0;
  coverAmt += (coverTarget - coverAmt) * Math.min(1, dt * (coverTarget > coverAmt ? 3.5 : 2.2));
  if(coverAmt < 0.002) coverAmt = 0;
  el.style.filter = coverAmt > 0 ? `grayscale(${coverAmt.toFixed(3)})` : '';

  spotFlash = Math.max(0, spotFlash - dt*1.6);
  spotFlashEl.style.opacity = (spotFlash*0.55).toFixed(3);
  // LUL-1308: decays slower than spotFlash (1.6) -- spotFlash is a one-shot
  // "you were just spotted" event; this is a repeating ambient cue and should
  // linger a beat between piano notes rather than fully blink out.
  bearingPulseT = Math.max(0, bearingPulseT - dt*1.1);
  if(bearingPulseSide) bearingPulseEl.className = bearingPulseSide;
  bearingPulseEl.style.opacity = (bearingPulseT*0.5).toFixed(3);

  const distLake = Math.hypot(player.x - CONFIG.lake.x, player.z - CONFIG.lake.z);

  // objective + status HUD
  const distBaby = Math.hypot(player.x - baby.x, player.z - baby.z);
  canPickup = canPickUp(runState(), distBaby, 3.6);
  const distStoneMarker = Math.hypot(player.x - landmarkGroups.stoneMarker.position.x, player.z - landmarkGroups.stoneMarker.position.z);
  canBuyVeilCharm = !carrying && !veilReserve && distStoneMarker < VEIL_CHARM_INTERACT_RADIUS
    && computeDepth(maxDistFromHome) >= VEIL_CHARM_PRICE;
  // LUL-1623: nearest-throwable distance computed once per frame, reused only
  // for the HUD gate below -- grabThrowable() re-scans on its own discrete
  // keypress/tap event, not every frame.
  let nearestThrowableD = Infinity;
  for(let ti = 0; ti < throwableData.length; ti++){
    const t = throwableData[ti];
    if(t.taken) continue;
    const d = Math.hypot(t.x - player.x, t.z - player.z);
    if(d < nearestThrowableD) nearestThrowableD = d;
  }
  // LUL-1258: M2 Deepwater -- distance/completion gate for the mission target,
  // computed the same way canPickup is above.
  const distMission = mission ? distToMissionTarget(mission, player.x, player.z) : Infinity;
  missionCanComplete = mission ? canCompleteMission(mission, distMission) : false;
  const distSecondaryItem = (mission?.secondary?.data.kind === 'retrieval')
    ? Math.hypot(player.x - RETRIEVAL_ITEM.x, player.z - RETRIEVAL_ITEM.z)
    : Infinity;
  secondaryCanComplete = mission ? canCompleteRetrieval(mission, distSecondaryItem) : false;
  if(playing){
    let statusVisible = false, statusText = '';
    if(hidden){
      statusVisible = true;
      const sniffer = predators.some(p => p.state==='investigate' && Math.hypot(player.x-p.x, player.z-p.z) < SNIFF_STATUS_RANGE);
      statusText = sniffer ? 'Hidden · something is sniffing you — DON’T MOVE'
                            : 'Hidden · ' + hideTime.toFixed(1) + 's   (moving breaks cover)';
    }
    // LUL-1089: throttled cover probe at COVER_PROBE_HZ
    coverProbeAccum += dt;
    if(coverProbeAccum >= 1 / COVER_PROBE_HZ){
      coverProbeAccum = 0;
      lastHideSpot = !hidden ? geoFindHideSpot(player.x, player.z, coverGrid, CELL, WRAP_SPAN) : null;
    }
    // LUL-1089: contextual action prompts
    const coverPromptVisible = !hidden && lastHideSpot !== null;
    const coverPromptKind = coverPromptVisible ? (lastHideSpot.kind ?? null) : null;
    const coverPromptUrgent = coverPromptVisible && predators.some(function(p){ return p.state === 'chase' && Math.hypot(player.x-p.x, player.z-p.z) < COVER_URGENT_RANGE; });
    const veilActive = playing && !hidden && !veilHeld && !veilLocked
      && veilCharge > VEIL_PROMPT_MIN_CHARGE
      && predators.some(function(p){ return p.state === 'chase' && canSee(p, Math.hypot(player.x-p.x, player.z-p.z)); });
    const veilPromptVisible = veilActive && !coverPromptVisible;
    const veilPromptUrgent = veilPromptVisible;
    // LUL-1258: the mission's nav-cue hum, only while active and not carrying
    // (return leg is silent, same rule the mission panel follows below) --
    // reuses childCry's tempo-carries-distance shape (Ship 1 spec S3d).
    if(mission?.status === 'active' && !carrying){
      missionHumTimer -= dt;
      if(missionHumTimer <= 0){
        missionWaypointHum(mission, distMission);
        const near = Math.max(0, Math.min(1, 1 - distMission / 140));
        missionHumTimer = 5.5 - near * 3.5;   // 5.5s far, 2s close -- matches childCry's curve
      }
    }
    // LUL-1904: walk-in trigger -- single-use per round, sight+scent only.
    if(caveSpawned && !caveConsumed && caveData){
      const distCave = Math.hypot(player.x - caveData.x, player.z - caveData.z);
      if(distCave < CAVE.interactR) activateCavePower();
    }
    // Countdown decrements unconditionally while playing, same shape as the
    // existing per-predator sniffImmuneT/chargeCooldown decrements --
    // "never lapse silently": the >0 -> 0 edge fires a distinct end cue,
    // mirrored into the HUD in the same pushState below.
    let caveImmuneJustEnded = false;
    if(caveImmuneT > 0){
      caveImmuneT = Math.max(0, caveImmuneT - dt);
      if(caveImmuneT === 0) caveImmuneJustEnded = true;
    }
    if(caveImmuneJustEnded) caveImmuneEndCue();
    pushState({
      objectiveVisible: true, objectiveReady: canPickup || canBuyVeilCharm,
      // LUL-2281: collapsed to the single pre-carry prompt -- completePickup()
      // now wins outright (lib/game/outcome.ts), so `carrying`/`babySetDown`
      // never go true in real play and there is no carry/set-down state left
      // to prompt for (wiki decisions/lul-2281-pickup-is-the-win-2026-09-09
      // Decision 5).
      objectiveText: canPickup ? 'Press  E  to lift the child'
        : (canBuyVeilCharm ? 'Press  E  for a mist-charm  ·  15 embers'
           : (missionCanComplete ? 'Press  E  at the drowned car' : 'Find the lost child  ·  ' + Math.round(distBaby) + 'm')),
      statusVisible, statusText,
      coverPromptVisible, coverPromptUrgent, coverPromptKind,
      veilPromptVisible, veilPromptUrgent,
      heldThrowable, canGrabThrowable: canGrabThrowable(heldThrowable, nearestThrowableD, THROWABLE_PICKUP_RADIUS),
      // LUL-1258: mission HUD panel -- null/null while carrying so the panel
      // never renders on the return leg (decisions/missions-accepted-2026-09-01 §2).
      missionKind: mission && !carrying ? mission.target.kind : null,
      missionStatus: mission && !carrying ? mission.status : null,
      secondaryKind: mission && !carrying && mission.secondary ? mission.secondary.data.kind : null,
      secondaryStatus: mission && !carrying && mission.secondary
        ? (secondaryComplete(mission, clock.elapsedTime - enteredAt) ? 'complete' : 'active')
        : null,
      // LUL-1666: retrieval -> whole meters/distance for the Hud's progress
      // indicator; speedrun -> seconds remaining for its countdown. One field,
      // shape keyed by kind, mirrors lastPayout's discriminated-by-caller shape.
      secondaryProgress: mission && !carrying && mission.secondary
        ? (mission.secondary.data.kind === 'retrieval'
            ? { kind: 'retrieval', retrieved: mission.secondary.data.retrieved, distance: Math.round(distSecondaryItem) }
            : { kind: 'speedrun', remainingSeconds: Math.max(0, Math.round(mission.secondary.data.timeLimitSeconds - (clock.elapsedTime - enteredAt))) })
        : null,
      caveImmuneActive: caveImmuneT > 0,
      caveImmuneTimeLeft: caveImmuneT,
    });
  } else {
    pushState({ objectiveVisible: false, statusVisible: false, coverPromptVisible: false, coverPromptUrgent: false, coverPromptKind: null, veilPromptVisible: false, veilPromptUrgent: false, heldThrowable, canGrabThrowable: false, missionKind: null, missionStatus: null, secondaryKind: null, secondaryStatus: null, secondaryProgress: null, caveImmuneActive: false });
  }
  // the child's idle glow (outside the cinematic) -- also covers a set-down child (LUL-1815):
  // baby.taken stays true forever once first picked up, so babySetDown is the only signal
  // that she's back on the ground.
  if(!baby.taken || babySetDown){
    babyGroup.position.y = Math.sin(t*1.4) * 0.06;
    babyGroup.rotation.y = t * 0.4;
    halo.material.opacity = idleHaloOpacity(t) * DIFFICULTY_PRESETS[difficulty].glowMul * fogTideGlowMul(fogTideAmountAt(babyGroup.position.x, babyGroup.position.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN));
    babyLight.intensity = idleGlowIntensity(t) * DIFFICULTY_PRESETS[difficulty].glowMul * fogTideGlowMul(fogTideAmountAt(babyGroup.position.x, babyGroup.position.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN));
    babyLight.distance = BABY_LIGHT_DISTANCE * fogTideGlowRangeMul(fogTideAmountAt(babyGroup.position.x, babyGroup.position.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN));
    const bp = bwisps.geometry.attributes.position.array;
    for(let i=0;i<BW;i++){ bp[i*3+1] += dt*0.4; if(bp[i*3+1] > 3.4) bp[i*3+1] = 0.2; }
    bwisps.geometry.attributes.position.needsUpdate = true;
    // LUL-1255 (Ship 1 wayfinding S3d): same tempo-carries-distance shape
    // missionHumTimer mirrors -- 5.5s far, 2s close.
    const cryDist = Math.hypot(baby.x - player.x, baby.z - player.z);
    cryTimer -= dt;
    if(cryTimer <= 0){
      childCry(cryDist, baby.x, baby.z);
      const near = Math.max(0, Math.min(1, 1 - cryDist / 140));
      cryTimer = 5.5 - near * 3.5;
    }
  }
  // scary music plays ONLY while an animal actually sees you (chasing or bee-lining).
  // lose sight → it starts sniffing/searching and the music falls back to the calm bed;
  // it finds you again (investigate → chase) and the music returns.
  const hunting = playing && predators.some(p => !p.inert && (p.state === 'chase' || p.hunt));
  huntTime = hunting ? huntTime + dt : Math.max(0, huntTime - dt*0.5);
  if(audio && soundOn){
    const esc = clamp(huntTime/25 + (nearDist < 1e8 ? clamp(1 - nearDist/40, 0, 1)*0.5 : 0), 0, 1);
    audio.huntGain.gain.setTargetAtTime(hunting ? (0.5 + esc*0.5) : 0.0001, audio.ctx.currentTime, hunting ? 0.25 : 0.6);
    audio.plfo.frequency.setTargetAtTime(2.3 + esc*3.2, audio.ctx.currentTime, 0.4);   // throb speeds up
  }
  if(audio && soundOn && playing){
    const move01 = Math.min(1, spd / (walk*STAMINA_SPRINT_MUL)), now = audio.ctx.currentTime;
    if(hunting){                                     // calm bed drops out
      audio.wg.gain.setTargetAtTime(0.0001, now, 0.3);
      audio.dg.gain.setTargetAtTime(0.0001, now, 0.3);
    } else {
      // LUL-27: Fog Tide signposting -- the drone builds (fogTideBuild, off
      // the raw 10s-lead telegraph) before the tide is actually active, and
      // wind ducks as the tide itself ramps in, so "ambient falls to a low
      // drone" reads as the tide arriving, not the drone just getting louder.
      // Only applied in the calm bed, same as everything else in this branch --
      // a chase already wins the audio mix outright (see the `hunting` branch above).
      audio.wg.gain.setTargetAtTime((0.05 + move01*0.10) * fogTideWindGainMul(fogTideAmountAt(player.x, player.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)) * TOD_AUDIO.windGainMul, now, 0.3);
      audio.wf.frequency.setTargetAtTime(320 + move01*900, now, 0.3);
      audio.dg.gain.setTargetAtTime(0.05 * fogTideDroneGainMul(fogTideBuildAt(player.x, player.z, fogTideBuild, WRAP_SPAN, WRAP_SPAN)) * TOD_AUDIO.droneGainMul, now, 0.3);
      audio.twinkle -= dt;
      if(audio.twinkle <= 0){
        const near = distLake < CONFIG.lake.r*3;
        twinkle(near ? 0.10 : 0.05, near && Math.random() < 0.5);
        audio.twinkle = near ? rnd(0.5, 1.6) : rnd(2.5, 6);
      }
    }
    audio.foot += dist;                              // footsteps play in both states
    if(spd > 0.3 && audio.foot >= 1.9){
      audio.foot -= 1.9;
      if(playerBogginess > 0) splash(0.3); else footstep(0.12);   // LUL-1483: continuous field, splash whenever standing in any bog
    }
  }

  // home landmark breathes, gently (LUL-38)
  homeRing.material.opacity = 0.16 + Math.sin(t*0.9)*0.06;

  // LUL-1855/LUL-2248: every landmark's beacon glow pulses slowly, reads as a beacon not a glitch
  for(const kind in landmarkBeaconGlows){
    const cfg = LANDMARK_BEACONS[kind];
    landmarkBeaconGlows[kind].material.opacity = cfg.opacityBase + Math.sin(t * cfg.pulseHz) * cfg.opacityAmp;
  }

  // pool breathes; its wisps rise
  ring.material.opacity = 0.14 + Math.sin(t*0.8)*0.05;
  const lp = lwGeo.attributes.position.array;
  for(let i=0;i<LW;i++){ lp[i*3+1] += dt*0.25; if(lp[i*3+1] > 4.5) lp[i*3+1] = 0.2; }
  lwGeo.attributes.position.needsUpdate = true;

  // ambient dust follows you, drifting downwind (LUL-195, see setup above)
  const amp = motionReduced() ? 0.3 : 1, dp = dustGeo.attributes.position.array;
  const wdx = windX * dt * DUST_WIND_SPEED * amp, wdz = windZ * dt * DUST_WIND_SPEED * amp;
  for(let i=0;i<DUST;i++){
    dp[i*3]   += Math.sin(t*0.4 + i) * dt * 0.12 * amp + wdx;
    dp[i*3+1] += Math.sin(t*0.3 + i*1.7) * dt * 0.1 * amp;
    dp[i*3+2] += Math.sin(t*0.37 + i*2.3) * dt * 0.12 * amp + wdz;
    if(dp[i*3+2] > 4)   dp[i*3+2] -= 34; else if(dp[i*3+2] < -30) dp[i*3+2] += 34;
    if(dp[i*3] > 30)    dp[i*3] -= 60;  else if(dp[i*3] < -30)    dp[i*3] += 60;
  }
  dustGeo.attributes.position.needsUpdate = true;
  dust.position.copy(camera.position);

  // ---- Scent trail visual fill + one-time caption (LUL-2230) --------------
  // Reads scentPoints/windX/windZ/veilAmount, writes none of them -- purely
  // the picture, never the smell (checkScent()/scentOnto() are untouched).
  {
    let n = 0, firstFrustum = null;
    const framePoints = [];
    for(let i = 0; i < scentPoints.length && n < SCENT_TRAIL_MAX; i++){
      const s = scentPoints[i], age = t - s.t0;
      if(age < 0.6 || isScentExpired(age)) continue;   // the mote under the player's own feet
      const d = driftedScentPosition(s, age, windX, windZ);
      // Same wrapDelta() a wrapped-world checkScent() uses (lib/game/scent.ts's
      // isScentDetected), so a wrapped point renders as its nearest image to
      // the player instead of a line stretched across the whole torus.
      const rx = player.x + wrapDelta(d.x, player.x, WRAP_SPAN);
      const rz = player.z + wrapDelta(d.z, player.z, WRAP_SPAN);
      const ry = 0.22 + (motionReduced() ? 0 : 0.06 * Math.sin(t*2 + i));
      const alpha = Math.max(0, (1 - age/SCENT_LIFETIME) * (1 - 0.7*veilAmount) * (s.radius / SCENT_RADIUS_RUN));
      scentTrailPos[n*3] = rx; scentTrailPos[n*3+1] = ry; scentTrailPos[n*3+2] = rz;
      scentTrailCol[n*3]   = SCENT_TRAIL_COLOR.r * alpha;
      scentTrailCol[n*3+1] = SCENT_TRAIL_COLOR.g * alpha;
      scentTrailCol[n*3+2] = SCENT_TRAIL_COLOR.b * alpha;
      _scentProjVec.set(rx, ry, rz).project(camera);
      const inFrustum = _scentProjVec.x >= -1 && _scentProjVec.x <= 1 && _scentProjVec.y >= -1 && _scentProjVec.y <= 1 && _scentProjVec.z < 1;
      if(inFrustum && !firstFrustum) firstFrustum = { x: _scentProjVec.x, y: _scentProjVec.y };   // oldest visible mote only
      // rawX/rawZ (the undrifted deposit point) let a test recompute
      // driftedScentPosition() itself and compare, without a separate hook
      // to read windX/windZ.
      framePoints.push({ x: rx, z: rz, age, alpha, inFrustum, rawX: s.x, rawZ: s.z, radius: s.radius });
      n++;
    }
    scentTrailGeo.setDrawRange(0, n);
    scentTrailGeo.attributes.position.needsUpdate = true;
    scentTrailGeo.attributes.color.needsUpdate = true;
    const scentTrailRendered = scentTrailVisible && entered && !hudState.winVisible && !hudState.deathVisible;
    scentTrailPts.visible = scentTrailRendered;

    // LUL-2307: generic first-encounter hint captions. Same rule shape as the
    // old scent-only version above it: eligible only while the setting is on,
    // entered, not hidden, not win/death; a world-anchored key additionally
    // needs its object in the camera frustum to *start* (scent's own
    // firstFrustum, computed by the mote loop just above, or a fresh
    // projectToScreen() for everything else); ends after 8s or its own
    // dismiss-on-interaction event, then persists "seen" so it never shows
    // again this install. Losing eligibility mid-caption stops it without
    // marking seen. See docs/specs/lul-2307-first-encounter-hints.md.
    const baseHintEligible = hintsEnabled && entered && !hidden && !hudState.winVisible && !hudState.deathVisible;

    // Nearest untaken throwable that could actually be grabbed right now, plus
    // its own position for the anchor (distinct from the HUD's nearestThrowableD
    // above, which only needs the distance, not which stone or where it is).
    let throwableHintAnchor = null, throwableHintEligible = false;
    for(let ti = 0; ti < throwableData.length; ti++){
      const th = throwableData[ti];
      if(th.taken) continue;
      const d = Math.hypot(th.x - player.x, th.z - player.z);
      if(canGrabThrowable(heldThrowable, d, THROWABLE_PICKUP_RADIUS)){
        throwableHintEligible = true; throwableHintAnchor = { x: th.x, y: 1, z: th.z };
        break;
      }
    }
    const coverHintVisible = !hidden && lastHideSpot !== null;

    // key -> [eligible this frame, world anchor {x,y,z} | null]. Self/panel-anchored
    // keys (lake/bog/deepwater/stamina/caveImmune/veil) never need an anchor -- they're
    // positioned by fixed CSS in GameCanvas.tsx, not a per-frame world point.
    function hintCandidate(key){
      switch(key){
        case 'scent': return [scentTrailVisible, null];   // anchor handled separately below (firstFrustum)
        case 'landmark': return [true, null];
        case 'lake': return [playerInLake, null];
        case 'bog': return [playerBogginess > 0.05, null];
        case 'deepwater': return [!!mission && mission.target.kind === 'deepwater' && mission.status === 'active' && !carrying, null];
        case 'wolf': case 'bear': case 'lion': {
          for(const p of predators){
            if(p.inert || p.kind !== key) continue;
            const dx = wrapDelta(player.x, p.x, WRAP_SPAN), dz = wrapDelta(player.z, p.z, WRAP_SPAN);
            if(Math.hypot(dx, dz) < effectiveDetect(p)) return [true, { x: p.x, y: 1, z: p.z }];
          }
          return [false, null];
        }
        case 'stamina': return [staminaCharge <= 0, null];
        case 'cover': return [coverHintVisible, lastHideSpot ? { x: lastHideSpot.x, y: 1, z: lastHideSpot.z } : null];
        case 'caveImmune': return [caveImmuneT > 0, null];
        case 'throwable': return [throwableHintEligible, throwableHintAnchor];
        case 'veil': return [veilCharge < 0.3 && !veilLocked, null];
        default: return [false, null];
      }
    }
    function hintDismissedByEvent(key, baseline){
      switch(key){
        case 'scent': return scentLockEventCount > baseline;
        case 'wolf': case 'bear': case 'lion': case 'cover': return hideEventCount > baseline;
        case 'throwable': return throwableGrabCount > baseline;
        case 'caveImmune': return caveImmuneT <= 0;
        case 'deepwater': return missionCanComplete;
        case 'stamina': return staminaCharge > 0.6;
        case 'veil': return veilCharge > 0.3;
        default: return false;   // landmark, lake, bog: time-only
      }
    }
    function hintDismissBaselineFor(key){
      switch(key){
        case 'scent': return scentLockEventCount;
        case 'wolf': case 'bear': case 'lion': case 'cover': return hideEventCount;
        case 'throwable': return throwableGrabCount;
        default: return 0;
      }
    }
    // Resolves a world-anchored key's screen position this frame, or null if its
    // object exists but isn't in the camera frustum right now. 'scent' reuses the
    // mote loop's own firstFrustum (already a raw NDC coordinate) instead of
    // re-deriving it from scentPoints a second time.
    function hintWorldAnchor(key, anchor){
      if(key === 'scent'){
        return firstFrustum
          ? { x: Math.max(0.08, Math.min(0.92, (firstFrustum.x + 1) / 2)), y: Math.max(0.08, Math.min(0.92, (1 - firstFrustum.y) / 2)) }
          : null;
      }
      return anchor ? projectToScreen(anchor.x, anchor.y, anchor.z) : null;
    }

    // Scans HINT_PRIORITY up to (but not including) whatever's already active, so a
    // higher-priority key can preempt a lower-priority one already showing -- not just
    // win same-frame ties when the slot is empty. Needed because 'landmark' (index 1)
    // is unconditionally eligible from frame 1 and otherwise wins the slot for a full
    // 8s before 'scent' (index 0) ever gets a look, even though scent only becomes
    // eligible+anchored a couple seconds into a real run (walk, then face the trail) --
    // e2e/scent-trail.spec.ts's caption assertions land well inside that window and
    // must pass unchanged (LUL-2346). Preempting doesn't mark the interrupted key
    // seen -- same as any other loss of eligibility mid-caption, it can still show
    // later. activeIdx = HINT_PRIORITY.length when nothing's active, so this scans the
    // full list exactly like the old "slot is empty" case.
    {
      const activeIdx = hintActiveKey ? HINT_PRIORITY.indexOf(hintActiveKey) : HINT_PRIORITY.length;
      for(let i = 0; i < activeIdx; i++){
        const key = HINT_PRIORITY[i];
        if(hintSeen(key)) continue;
        const [eligible, anchor] = hintCandidate(key);
        if(!baseHintEligible || !eligible) continue;
        if(WORLD_HINT_KEYS[key] && !hintWorldAnchor(key, anchor)) continue;   // needs to be visible to *start*
        hintActiveKey = key; hintActiveStartT = t; hintDismissBaseline = hintDismissBaselineFor(key);
        break;
      }
    }
    if(hintActiveKey){
      const key = hintActiveKey;
      const elapsed = t - hintActiveStartT;
      // Check event/timeout dismissal before eligibility: for wolf/bear/lion/cover/
      // throwable/stamina the dismissing interaction itself (hide, grab, stamina
      // regen) also flips eligibility false in this same frame, so eligibility-loss
      // must not preempt marking the hint seen (LUL-2307 review fix).
      if(elapsed >= 8 || hintDismissedByEvent(key, hintDismissBaseline)){
        markHintSeen(key); hintActiveKey = null;
        pushState({ hintVisible: false });
      } else {
        const [eligible] = hintCandidate(key);
        if(!baseHintEligible || !eligible){
          hintActiveKey = null;
          pushState({ hintVisible: false });
        } else if(WORLD_HINT_KEYS[key]){
          const [, anchor] = hintCandidate(key);
          const pos = hintWorldAnchor(key, anchor);
          pushState(pos
            ? { hintVisible: true, hintKey: key, hintText: HINT_TEXT[key], hintX: pos.x, hintY: pos.y }
            : { hintVisible: true });   // out of frustum this frame -- keep last known anchor, LUL-2230 precedent
        } else {
          pushState({ hintVisible: true, hintKey: key, hintText: HINT_TEXT[key] });
        }
      }
    }

    scentTrailLastFrame = { settingOn: scentTrailVisible, rendered: scentTrailRendered, points: framePoints,
      livePoints: scentPoints.length, captionVisible: hintActiveKey === 'scent' && hudState.hintVisible,
      captionSeen: hintSeen('scent'), veilAmount, windX, windZ };
  }

  drawMinimap();
  if(!baby.taken){                       // pulsing objective marker on the minimap
    const [bx, bz] = w2m(baby.x, baby.z), r = 3 + Math.sin(t*4) * 1.2;
    mmx.beginPath(); mmx.arc(bx, bz, r, 0, Math.PI*2);
    mmx.fillStyle = 'rgba(255,205,150,0.9)'; mmx.fill();
    mmx.lineWidth = 1; mmx.strokeStyle = 'rgba(255,230,195,0.8)'; mmx.stroke();
  }

  // keep the sky centred on the player; moon billboards toward the camera
  stars.position.copy(camera.position);
  moonGroup.position.copy(camera.position).addScaledVector(moonDir, 300);
  moonGroup.quaternion.copy(camera.quaternion);

  updateBoom(dt);
  if(!dead){ if(usePost) renderPost(t); else renderer.render(scene, camera); }
  adaptResolution(dt, t);
}
function tick(){
  rafId = requestAnimationFrame(tick);
  const dt = clampDt(clock.getDelta()), t = clock.elapsedTime;
  stepFrame(dt, t);
}
tick();

  // ---- Teardown: undo everything the run above did ------------------------
  activeDispose = function dispose() {
    cancelAnimationFrame(rafId);
    timers.forEach(id => clearTimeout(id));
    cleanupFns.forEach(fn => fn());

    if(document.pointerLockElement === el) document.exitPointerLock();
    document.body.style.cursor = '';
    delete document.body.dataset.losCovered;   // LUL-144: don't leak this mount's signal into the next one

    // release every geometry/material/texture reachable from the scene graph
    scene.traverse(obj => {
      if(obj.geometry) obj.geometry.dispose();
      if(obj.material){
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          for(const k in m){ const v = m[k]; if(v && v.isTexture) v.dispose(); }
          m.dispose();
        });
      }
    });
    if(scene.background && scene.background.isTexture) scene.background.dispose();

    // post-processing: fullscreen quad + shader materials + render targets
    if(fsQuad){
      fsQuad.geometry.dispose();
      [matBright, matBlur, matComposite].forEach(m => m && m.dispose());
    }
    [sceneRT, brightRT, blurA, blurB].forEach(rt => rt && rt.dispose());

    // renderer + WebGL context (browsers cap live contexts; release it explicitly)
    renderer.domElement.remove();
    renderer.dispose();
    renderer.forceContextLoss();

    // AudioContext
    if(audio){ try { audio.ctx.close(); } catch(e){} }

    activeDispose = null;
  };

  // LUL-34: the public action API. GameCanvas wires these to React event
  // handlers (gate click, restart buttons, panel sliders/buttons) -- the only
  // direction React is allowed to reach into the engine, as opposed to state,
  // which only ever flows the other way via emitState().
  //
  // LUL-68: touch-stick setters. React's MobileControls component calls these
  // on every pointer move / pointer up. The engine reads them in tick().
  // LUL-276: no-ops outside mobile mode, so nothing can write touch state
  // for the desktop tick() to accidentally read (it never does today, since
  // the touchLook block itself is mode-gated, but this keeps the setters
  // themselves honest about what mode they're allowed to affect).
  function setTouchMove(x, z) { if(mode !== 'mobile') return; touchMove.x = x; touchMove.z = z; }
  function setTouchLook(x, y) { if(mode !== 'mobile') return; touchLook.x = x; touchLook.y = y; }
  function setTouchSprint(v)  { if(mode !== 'mobile') return; touchSprint = v; }
  // LUL-529: hold-button analogue of holding KeyF -- see touchVeil above.
  function setTouchVeil(v) { if(mode !== 'mobile') return; touchVeil = v; }
  function triggerTouchHide() {
    const playing = isPlaying(runState());
    if(playing && !paused) toggleHidden();
  }
  function triggerTouchInteract() {
    const playing = isPlaying(runState());
    if(!playing || paused) return;
    if(canPickup) pickup();
    else if(carrying) setDown();
    else if(canBuyVeilCharm) buyVeilCharm();
    else if(missionCanComplete) completeMissionSequence();
    else if(secondaryCanComplete) completeSecondarySequence();
    else grabThrowable();
  }
  function triggerTouchThrow() {
    const playing = isPlaying(runState());
    if(playing && !paused && heldThrowable) throwThrowable();
  }
  // LUL-529: touch analogue of the Space keydown handler (forest-engine.js
  // keydown listener above) -- same guards, same beginJump()/jumpPressed
  // sequence, minus the e.repeat check (a tap is already a single discrete
  // event). Per LUL-213, jump is the only way to clear a charging wolf/lion,
  // so this is survival-critical, not cosmetic.
  function triggerTouchJump() {
    const playing = entered && !won && !dead && !pickingUp;
    if(!playing || paused) return;
    if(hidden) exitHide();
    beginJump();
    jumpPressed = true;
  }
  // LUL-529: touch analogue of Escape. Desktop's Escape only ever pauses --
  // resuming happens by re-acquiring pointer lock (a mousedown handler that's
  // desktop-only, see the `mode === 'desktop'` block above), which has no
  // touch equivalent. So this toggles both directions: a phone player has no
  // other way back into a paused run.
  function triggerTouchPause() {
    const playing = entered && !won && !dead && !pickingUp;
    if(!playing) return;
    setPaused(!paused);
  }
  // LUL-529: touch analogue of the ShiftLeft/ShiftRight toggle-run edge in the
  // keydown handler above -- only meaningful when the accessibility setting
  // runMode === 'toggle' is on (MobileControls only renders the control in
  // that case). Without this, a mobile player who picked toggle-run for
  // accessibility reasons still had to hold the stick past the 0.75 sprint
  // threshold the whole time, same as hold-mode -- the setting did nothing.
  function triggerTouchToggleRun() {
    const playing = entered && !won && !dead && !pickingUp;
    if(runMode !== 'toggle' || !playing || paused) return;
    toggleRunOn = !toggleRunOn;
  }

  return { enter, restart, setPace, setFog, toggleSound, regenMap,
           setTouchMove, setTouchLook, setTouchSprint, setTouchVeil, triggerTouchHide, triggerTouchInteract,
           triggerTouchThrow,
           triggerTouchJump, triggerTouchPause, triggerTouchToggleRun,
           setDifficulty, setRunMode, setSensitivity, setInvertY, setReducedMotion, setCaptions,
           setEmbers, purchaseDeeperLungs,
           // LUL-2221: both were defined but never returned; Hud.tsx/GameMenu.tsx call them.
           setMissionUnlocks, setSecondaryChoice,
           setScentTrailVisible,
           // LUL-2307
           setHintsEnabled, resetHints };
}

function dispose() {
  if(activeDispose) activeDispose();
}

export { init, dispose };

// `window.ForestEngine` is no longer how the app reaches the engine -- GameCanvas
// imports init/dispose above. It stays as a deliberate debug/QA surface: the
// Playwright suite waits on it to know the engine mounted, and the `?qaHooks=1`
// teleport hook hangs off it (see the qaHooks block inside init). `threeRevision`
// is exposed because dropping the `window.THREE` global left the e2e suite no
// other way to assert the three@0.128 pin (decisions/0002-threejs-pin) from the
// browser.
if(typeof window !== 'undefined'){
  window.ForestEngine = { init: init, dispose: dispose, threeRevision: THREE.REVISION };
}
