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
} from '@/lib/game/outcome';
import {
  shouldTriggerCharge,
  startCharge,
  stepCharge,
  chargeSpeed,
  CHARGE_TRIGGER_MIN,
  CHARGE_TRIGGER_MAX,
} from '@/lib/game/charge';
import {
  clampDt,
  isScentDetected,
  isScentExpired,
  isScentPastPruneCutoff,
  scentDriftDistance,
  SCENT_DEPOSIT_INTERVAL,
  SCENT_LIFETIME,
  SCENT_RADIUS_WALK,
  SCENT_RADIUS_RUN,
  SCENT_TRACK_TIME,
} from '@/lib/game/scent';
import {
  coverKindBlocksPlayerMovement,
  distanceToCoverEdge,
  overlapsTreeCanopy,
  overlapsTreeTrunk,
  canopyRadiusAtEye,
  rollCoverPropShape,
  pickAvoidDirection,
  HIDE_KINDS,
  CELL,
  gridKey as key,
  blockedR as geoBlockedR,
  blocked as geoBlocked,
  hasLOS as geoHasLOS,
  findHideSpot as geoFindHideSpot,
  effectiveDetect as geoEffectiveDetect,
  canSee as geoCanSee,
} from '@/lib/game/cover';
import { isNoiseHeard, NOISE_RADIUS_WALK, NOISE_RADIUS_RUN } from '@/lib/game/noise';
import { selectPackLeaderIndex, flankTarget, FLANK_RECOMPUTE, FLANK_ARRIVE_R, FLANK_SPEED_MUL } from '@/lib/game/pack';
import {
  isInBog,
  bogSpeedMultiplier,
  bogNoiseMultiplier,
  pickHardBabyPosition,
  clearOfLandmarks,
} from '@/lib/game/bog';
import {
  backOffPoint,
  canCatchInChase,
  CATCH_MARGIN,
  isCaught,
  isSniffImmune,
  rollSniffs,
  shouldGiveUpChase,
  shouldRevertInvestigateToChase,
  SNIFF_IMMUNITY_TIME,
  stepApproach,
  stepFlankHold,
  stepSniffLoop,
  tickTimers,
} from '@/lib/game/predator';
import { stepVeilCharge, veilDetectMul, veilFogDensity } from '@/lib/game/veil';
import {
  inLakeWater,
  inLakeClearance,
  lakeSpeedMultiplier,
  pushOutOfLakeClearance,
} from '@/lib/game/lake';

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

// ---- Knobs ---------------------------------------------------------------
const CONFIG = {
  seed:    20260718,
  mapSize: 240,          // the forest is a fixed square this many units across
  bogDepth: 120,         // LUL-25: the bog band appended past the forest's +z edge
  trees:   1300,
  walk:    6,            // walking speed (units/s); Shift multiplies it
  fog:     0.04,
  eye:     2.2,          // eye height
  bg:      0x0a0e15,
  trunk:   0x171b20,
  foliage: 0x102420,
  ground:  0x0c1117,
  lake:    { x: 34, z: -28, r: 15, clear: 22, glow: 0x86b8ff },
  home:    { x: 0, z: 0, r: 3.6, glow: 0xffd9b0 },   // LUL-38: reuses the spawn point, no new rng draw
  carryPaceMul: 0.72,                                 // LUL-38: burden while carrying the child, not a cripple
};
const half = CONFIG.mapSize / 2;
const margin = 4;
// LUL-25: the world is a rectangle now, not a square -- `half` still bounds
// x symmetrically (and is the z coordinate the forest ends at), `zMax` is the
// new outer z edge, out past the bog. Every place that used to clamp z the
// same way it clamps x now clamps to [-half, zMax] instead of [-half, half].
const zMax = half + CONFIG.bogDepth;
function inBog(x, z){ return isInBog(z, { half, zMax }); }
// LUL-25: four fixed navigational landmarks, "visible over the fog line" so
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
const LANDMARKS = [
  { kind: 'fireTower',   x: -95, z: -95, clear: 12, cr: 1.6 },
  { kind: 'stoneMarker', x: 100, z: -75, clear: 9,  cr: 1.1 },
  { kind: 'oak',         x: -65, z: 135, clear: 10, cr: 1.3 },
  { kind: 'drownedCar',  x: 55,  z: 205, clear: 11, cr: 2.3 },
];

// ---- Seeded RNG (so a given map is a real, repeatable place) --------------
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
let rng = mulberry32(CONFIG.seed);
// LUL-153: the seed actually in play -- generateMap() below is called with a
// fresh random seed on every restart()/regenMap(), so CONFIG.seed alone only
// describes the very first map. Analytics events that carry `seed` read this.
let currentSeed = CONFIG.seed;
const rnd = (a=1,b) => b===undefined ? rng()*a : a + rng()*(b-a);
const clamp = (v,a,b) => v<a ? a : v>b ? b : v;

// ---- Scene / camera / renderer -------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.bg);
scene.fog = new THREE.FogExp2(0x0b1220, CONFIG.fog);

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

scene.add(new THREE.HemisphereLight(0x8fa8c8, 0x0a0d12, 0.55));
const moon = new THREE.DirectionalLight(0xbcd0ff, 0.5); moon.position.set(-6, 16, -4); scene.add(moon);
const rim = new THREE.DirectionalLight(0x24344f, 0.4); rim.position.set(4, 5, 9); scene.add(rim);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800),
  new THREE.MeshStandardMaterial({ color: CONFIG.ground, roughness: 1, metalness: 0 }));
ground.rotation.x = -Math.PI/2; scene.add(ground);

// ---- Night sky: gradient backdrop, stars, moon; soft fill on the player ---
(function(){
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0.0, '#05070d'); grd.addColorStop(0.55, '#080e18'); grd.addColorStop(1.0, '#0b1220');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; scene.background = tex;
})();
const STAR = 700, starArr = new Float32Array(STAR*3);
for(let i=0;i<STAR;i++){ const th = Math.random()*Math.PI*2, y = Math.random()*0.9 + 0.05, s = Math.sqrt(1-y*y), r = 300;
  starArr[i*3] = r*s*Math.cos(th); starArr[i*3+1] = r*y; starArr[i*3+2] = r*s*Math.sin(th); }
const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starArr, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.15,
  sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
scene.add(stars);
const moonDir = new THREE.Vector3(-6, 16, -4).normalize();
const moonGroup = new THREE.Group();
moonGroup.add(
  new THREE.Mesh(new THREE.CircleGeometry(34, 32), new THREE.MeshBasicMaterial({ color: 0x9fb6ff, transparent: true, opacity: 0.30, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })),
  new THREE.Mesh(new THREE.CircleGeometry(15, 40), new THREE.MeshBasicMaterial({ color: 0xeef3ff, fog: false }))
);
scene.add(moonGroup);
const playerLight = new THREE.PointLight(0x33456a, 0.7, 20, 2); camera.add(playerLight);
// LUL-40/LUL-382: hold KeyF for the mist veil. The founder rejected the original
// LUL-40 dim-only version as too small a lever (decisions/0012-feature-impact-bar) --
// the light cut is kept (still a smaller lit pool) but it's now one piece of a bigger,
// world-visible state: mist ramps to near-opaque (MIST_VEIL_FOG below) and predator
// sight range drops hard while it's up (veilDetectMul(), lib/game/veil.ts, used from
// effectiveDetect()). Binary hold, not a slider, for the same reason as before -- an
// every-second decision, not a set-once knob. `lightDimmed` now names "is the veil
// actually active" (it can be held down and denied by the charge meter -- see
// stepVeilCharge(), lib/game/veil.ts -- so it's not just "is F held").
const LIGHT_NORMAL = { intensity: 0.7, distance: 20 };
const LIGHT_DIMMED  = { intensity: 0.18, distance: 8 };
let lightDimmed = false;
// LUL-382: charge/lock state machine and the two multipliers it gates live in
// lib/game/veil.ts (pure, unit tested -- see wiki systems/unit-testing-standard).
// The engine only owns the rendering-side bits: how fast the mist visibly ramps
// (VEIL_RAMP), how thick it gets at full ramp (MIST_VEIL_FOG), and the mutable
// per-frame state itself.
const VEIL_RAMP = 1.6;            // seconds for mist/detect-cut to ease fully in or out
let veilCharge = 1, veilLocked = false, veilAmount = 0;
let fogBase = CONFIG.fog;         // last player-set "Mist" slider value; veil ramps up from this, not a hardcoded floor
const MIST_VEIL_FOG = 0.34;       // ~3x the manual Mist slider's own max (0.11) -- deliberately overshoots it so the veil reads as a distinct world state
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
const VIGNETTE_NORMAL = { inner: 45, outerAlpha: 0.60 };
const VIGNETTE_DIMMED  = { inner: 18, outerAlpha: 0.92 };
function applyVignette(amt){
  if (!vignetteEl) return;
  const inner = VIGNETTE_NORMAL.inner + (VIGNETTE_DIMMED.inner - VIGNETTE_NORMAL.inner) * amt;
  const outerAlpha = VIGNETTE_NORMAL.outerAlpha + (VIGNETTE_DIMMED.outerAlpha - VIGNETTE_NORMAL.outerAlpha) * amt;
  vignetteEl.style.background = `radial-gradient(120% 90% at 50% 44%, transparent ${inner}%, rgba(0,0,0,${outerAlpha}) 100%)`;
}

// ---- Trees: one instanced "master tree", positions fixed per map ---------
const CANOPY_R = 1.15;     // cone1Geo base radius, at its widest (near the ground)
const CONE1_HEIGHT = 2.5, CONE1_Y = 2.1;
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

const parts = [
  new THREE.InstancedMesh(trunkGeo, trunkMat,   CONFIG.trees),
  new THREE.InstancedMesh(cone1Geo, foliageMat, CONFIG.trees),
  new THREE.InstancedMesh(cone2Geo, foliageMat, CONFIG.trees),
];
parts.forEach(p => { p.frustumCulled = false; scene.add(p); });

// ---- Bog tree cover (LUL-25) -----------------------------------------------
// Same trunk/foliage geometry, own InstancedMesh trio sized much smaller than
// CONFIG.trees -- "thinner tree cover" per the ticket. A separate pool, not a
// bigger CONFIG.trees, so the original forest loop's rng draw count (and
// every draw after it) is untouched -- see generateBogTrees() below.
const BOG_TREES = 90;
const bogParts = [
  new THREE.InstancedMesh(trunkGeo, trunkMat,   BOG_TREES),
  new THREE.InstancedMesh(cone1Geo, foliageMat, BOG_TREES),
  new THREE.InstancedMesh(cone2Geo, foliageMat, BOG_TREES),
];
bogParts.forEach(p => { p.frustumCulled = false; scene.add(p); });

// ---- Cover props (LUL-43): brambles, fallen logs, rock shelves -----------
// Purely visual + line-of-sight-blocking (see canSee()/hasLOS() below) --
// deliberately NOT movement colliders. Trees already own movement collision
// via `grid`/blockedR below; giving these their own physical collision too
// would touch predator path/stuck-avoidance logic that this ticket has no
// budget to re-verify. Declared in the LUL-43 handoff; a fast-follow can add
// it if the founder wants these to be walls, not just visual/LOS cover.
const COVER_PROPS = 220;
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
const coverMeshes = {
  log: new THREE.InstancedMesh(logGeo, logMat, COVER_PROPS),
  rock: new THREE.InstancedMesh(rockGeo, rockMat, COVER_PROPS),
  bramble: new THREE.InstancedMesh(brambleGeo, brambleMat, COVER_PROPS),
  reed: new THREE.InstancedMesh(reedGeo, reedMat, COVER_PROPS),   // capacity reused, see layoutCoverMeshes()
};
Object.values(coverMeshes).forEach(m => { m.frustumCulled = false; scene.add(m); });

// ---- Hiding spots (LUL-212) -------------------------------------------
// Every cover prop still blocks line of sight the same way (see canSee()/
// hasLOS() below -- that math is untouched). What changed: the player's
// deliberate `hidden` stance (KeyH / touch Hide button) no longer works
// anywhere you can find LOS-blocking geometry. It now requires standing at
// one of two dedicated hiding-spot kinds -- researched against real-world
// stealth/horror foley convention (rustling leaves read as the universal
// "something is hiding in the brush" cue; a hollow log is the other classic
// natural forest hiding spot) -- bramble ("bush", leaf rustle) and log
// ("hollow log", a wood knock/creak). Rocks and tagged trees remain sight
// -blocking obstacles you can duck behind incidentally, exactly as before,
// but never a place you can formally "hide": no crouch, no stillness bonus,
// no sound. That is the ticket's whole ask -- "hiding will only be in
// specific places" -- narrowed to props that read as something a person
// could actually climb into or behind, not just stand near.
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
let grid = new Map();
let coverData = [];            // {x,z,hx,hz,kind} -- LOS-blocking AABBs (tagged trees + new props)
let coverGrid = new Map();     // same CELL keying as `grid`, built from coverData

function inLake(x,z){ return inLakeClearance(x, z, CONFIG.lake); }
function inSpawn(x,z){ return x*x+z*z < 40; }
// LUL-425: CELL and key() (now gridKey) live in lib/game/cover.ts, imported
// above -- single source of truth for the bucketing convention every
// grid-querying function in this file and in cover.ts now shares.

function addAllToGrid(arr){
  for(const t of arr){
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
// inject the engine's own `grid`/`coverGrid` closure state; every call site
// below (predators call blockedR() directly for their own movement, not
// blocked() -- see cover.ts's own comment on why that split is load-bearing)
// is unchanged. coverBlockedR/canopyBlockedR themselves stay in cover.ts
// (not wrapped here individually, only via the composite blocked()) --
// nothing outside blocked() called them directly. LUL-384's walkable-log
// skip (coverKindBlocksPlayerMovement(), imported above) is preserved inside
// cover.ts's own coverBlockedR(), so geoBlocked() below still treats 'log'
// as non-blocking, same as release/next did before this extraction.
function blockedR(x,z,pr){ return geoBlockedR(x,z,pr,grid); }
function blocked(x,z){ return geoBlocked(x,z,grid,coverGrid); }

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
// Deliberate consequence, not a bug: the new rejection branch below skips a
// candidate's `ry` rng() draw when it fires (same short-circuit shape the
// existing inLake()/inSpawn()/inBaby() check above already has). Tree/baby/
// predator positions are unaffected (this fix only touches generateCover()'s
// own stream, which runs after all of those per the comment above) -- but
// the exact set and layout of cover props for a given seed will shift from
// pre-fix `main` wherever a rejected overlap used to land. That is the fix
// working, not a regression.
function treesNear(x, z){
  const cx = Math.floor(x/CELL), cz = Math.floor(z/CELL);
  const nearby = [];
  for(let gx=cx-1; gx<=cx+1; gx++) for(let gz=cz-1; gz<=cz+1; gz++){
    const arr = grid.get(key(gx,gz)); if(arr) nearby.push(...arr);
  }
  return nearby;
}
function generateCover(){
  coverData = [];
  for(const t of treeData) if(t.s > 1.4) coverData.push({ x: t.x, z: t.z, hx: t.cr*1.4, hz: t.cr*1.4, kind: 'tree' });

  let tries = 0, placed = 0;
  while(placed < COVER_PROPS && tries < COVER_PROPS*25){
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(-half+margin, half-margin);
    if(inLake(x,z) || inSpawn(x,z) || inBaby(x,z)) continue;
    const roll = rng();
    const { kind, hx, hz, y } = rollCoverPropShape(roll, rng);   // LUL-425: lib/game/cover.ts
    if(overlapsTreeTrunk(x, z, Math.max(hx,hz), treesNear(x,z))) continue;
    if(!coverKindBlocksPlayerMovement(kind) && overlapsTreeCanopy(x, z, Math.max(hx,hz), treesNear(x,z))) continue;
    coverData.push({ x, z, hx, hz, kind, y, ry: rng()*Math.PI*2 });
    placed++;
  }
  buildCoverGrid();
}
function layoutCoverMeshes(){
  const counts = { log: 0, rock: 0, bramble: 0, reed: 0 };
  for(const c of coverData){
    if(c.kind === 'tree') continue;
    const i = counts[c.kind]++;
    dummy.position.set(c.x, c.y, c.z);
    dummy.rotation.set(0, c.ry, 0);
    dummy.scale.set(c.hx*2, c.y*2, c.hz*2);
    dummy.updateMatrix();
    coverMeshes[c.kind].setMatrixAt(i, dummy.matrix);
  }
  for(const k in coverMeshes){
    const m = coverMeshes[k];
    for(let i = counts[k]; i < COVER_PROPS; i++){
      dummy.position.set(0, -999, 0); dummy.scale.setScalar(0.0001); dummy.rotation.set(0,0,0);
      dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }
}

function nearLandmarks(x, z, pad){
  return !clearOfLandmarks(x, z, LANDMARKS, pad);
}
// LUL-375: shared by generateMap()'s forest-tree loop and generateBogTrees() --
// same scatter-and-instance shape, differing only in which parts/data/count
// triple they close over. Draw order per tree is rotation then brightness,
// matching what both inlined copies did, since this feeds the seeded rng
// stream (see the LUL-25 ordering comment above generateBogTrees()).
function layoutTreePool(meshParts, data, count){
  for(let i=0; i<count; i++){
    if(i < data.length){
      const t = data[i];
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, rng()*Math.PI*2, 0);
      dummy.scale.setScalar(t.s);
    } else { dummy.position.set(0, -999, 0); dummy.scale.setScalar(0.0001); dummy.rotation.set(0,0,0); }
    dummy.updateMatrix();
    for(const p of meshParts) p.setMatrixAt(i, dummy.matrix);
    const b = i < data.length ? 0.72 + rng()*0.5 : 1;
    tintCol.setRGB(b*0.92, b, b*0.86);
    meshParts[1].setColorAt(i, tintCol); meshParts[2].setColorAt(i, tintCol);
  }
  for(const p of meshParts) p.instanceMatrix.needsUpdate = true;
  if(meshParts[1].instanceColor) meshParts[1].instanceColor.needsUpdate = true;
  if(meshParts[2].instanceColor) meshParts[2].instanceColor.needsUpdate = true;
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
  while(bogTreeData.length < BOG_TREES && tries < BOG_TREES*25){
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(half+margin, zMax-margin);
    if(nearLandmarks(x, z, 2)) continue;
    const s = 0.6 + rng()*1.3;   // thinner cover -- same scatter shape, smaller sizes than the forest
    bogTreeData.push({ x, z, s, cr: 0.35*s, crCanopy: canopyRadiusAtEye(s, CONFIG.eye, CANOPY_GEO) });
  }
  layoutTreePool(bogParts, bogTreeData, BOG_TREES);
}
// Reeds: tall cover volumes, bog band only. Pushed into the same coverData
// array log/rock/bramble use (see coverMeshes.reed above) so canSee()'s LOS
// raycast and the player's coverBlockedR() movement check treat them exactly
// like any other prop, with zero changes to either function.
function generateReeds(){
  let tries = 0, placed = 0;
  while(placed < COVER_PROPS && tries < COVER_PROPS*25){
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(half+4, zMax-4);
    if(nearLandmarks(x, z, 3)) continue;
    const r = 0.5 + rng()*0.4, h = 1.3 + rng()*0.9;
    coverData.push({ x, z, hx: r, hz: r, y: h*0.5, kind: 'reed', ry: rng()*Math.PI*2 });
    placed++;
  }
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
    ? pickHardBabyPosition(rng, { half, zMax }, half, LANDMARKS)
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
  while(treeData.length < CONFIG.trees && tries < CONFIG.trees*25){
    tries++;
    const x = rnd(-half+margin, half-margin), z = rnd(-half+margin, half-margin);
    if(inLake(x,z) || inSpawn(x,z) || inBaby(x,z)) continue;
    const s = 0.7 + rng()*1.7;
    treeData.push({ x, z, s, cr: 0.35*s, crCanopy: canopyRadiusAtEye(s, CONFIG.eye, CANOPY_GEO) });
  }
  layoutTreePool(parts, treeData, CONFIG.trees);
  buildGrid();
  drawMinimapStatic();
  player.x = 0; player.z = 0; player.yaw = 0; player.pitch = -0.02;
  placePredators();
  generateCover(); layoutCoverMeshes();   // LUL-43: last rng consumer -- appends, doesn't reorder, the stream
  generateWind();   // LUL-23: appended after cover -- doesn't reorder either stream
  // LUL-25: everything below is new and runs last -- see the comment on
  // generateBogTrees() for why the ordering is load-bearing.
  generateBogTrees();
  generateReeds(); layoutCoverMeshes();
  buildGrid();   // picks up bogTreeData for blockedR()/canopyBlockedR()
  placeLandmarks();
  buildGrid();   // LUL-374: re-run now landmarkData is populated, so blockedR()/predators'
                  // own blockedR() calls treat the four landmark meshes as solid too
  applyHardBabySpawn();
  bwisps.visible = true;   // LUL-38: pickup() hides these; a fresh map/restart brings them back
}

// ---- Lake landmark (the thing to find) -----------------------------------
const water = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.lake.r, 48),
  new THREE.MeshStandardMaterial({ color: 0x0a1a2c, roughness: 0.35, metalness: 0.15 }));
water.rotation.x = -Math.PI/2; water.position.set(CONFIG.lake.x, 0.02, CONFIG.lake.z); scene.add(water);

const ring = new THREE.Mesh(new THREE.RingGeometry(CONFIG.lake.r*0.72, CONFIG.lake.r*1.05, 48),
  new THREE.MeshBasicMaterial({ color: CONFIG.lake.glow, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI/2; ring.position.set(CONFIG.lake.x, 0.06, CONFIG.lake.z); scene.add(ring);

const lakeLight = new THREE.PointLight(CONFIG.lake.glow, 1.3, 75, 2);
lakeLight.position.set(CONFIG.lake.x, 7, CONFIG.lake.z); scene.add(lakeLight);

// ---- Home landmark: where the child must be carried (LUL-38) -------------
// Deliberately minimal -- "reuse the spawn point" per the ticket's own scope,
// a lit waypoint rather than a new art pass. Static (no rng draw), so map
// generation stays byte-identical for existing seeds.
const homeLight = new THREE.PointLight(CONFIG.home.glow, 1.0, 24, 2);
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
  const light = new THREE.PointLight(0xff9a4a, 0.9, 26, 2); light.position.set(0, 9.6, 0); g.add(light);
  g.rotation.z = 0.13; g.rotation.x = 0.05;   // leaning
  return g;
}
function buildStoneMarker(){
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x565f68, roughness: 0.9 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.75, 5.5, 4), stoneMat);
  shaft.position.y = 2.75; shaft.rotation.y = 0.4; g.add(shaft);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.5, 0.6, 4), stoneMat);
  cap.position.y = 5.6; cap.rotation.y = 0.4; g.add(cap);
  const glow = new THREE.PointLight(0x9fd0ff, 0.55, 16, 2); glow.position.set(0, 3.2, 0); g.add(glow);
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
  const headlight = new THREE.PointLight(0xffcf7a, 0.35, 9, 2); headlight.position.set(2.0, 0.5, 0.6); g.add(headlight);
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
  const glow = new THREE.PointLight(0xcfe6ff, 0.4, 14, 2); glow.position.set(0, 6, 0); g.add(glow);
  return g;
}
const landmarkGroups = {
  fireTower: buildFireTower(),
  stoneMarker: buildStoneMarker(),
  drownedCar: buildDrownedCar(),
  oak: buildSplitOak(),
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
    landmarkData.push({ x, z, cr: l.cr });
  }
}

const LW = 50, lwArr = new Float32Array(LW*3);
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
const DUST_WIND_SPEED = 0.3;
const DUST = 350, dustArr = new Float32Array(DUST*3);
for(let i=0;i<DUST;i++){ dustArr[i*3]=(Math.random()*2-1)*30; dustArr[i*3+1]=Math.random()*12; dustArr[i*3+2]=(Math.random()*2-1)*30-3; }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustArr,3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xa8c2e8, size: 0.06,
  transparent: true, opacity: 0.5, depthWrite: false }));
dust.frustumCulled = false; scene.add(dust);

// ---- The lost child (the objective) --------------------------------------
const baby = { x: 60, z: 60, taken: false };
function inBaby(x,z){ const dx=x-baby.x, dz=z-baby.z; return dx*dx+dz*dz < 20; }   // ~4.5-unit clearing

const babyGroup = new THREE.Group();
const WARM = 0xffd9b0;
const bundle = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xf3d3c0, emissive: 0xffcaa0, emissiveIntensity: 0.5, roughness: 0.85 }));
bundle.scale.set(1, 0.8, 1); bundle.position.y = 0.42;
const babyHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xf7e2d4, emissive: 0xffd6b4, emissiveIntensity: 0.5, roughness: 0.85 }));
babyHead.position.y = 0.8;
const halo = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12),
  new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false }));
halo.position.y = 0.55;
const babyLight = new THREE.PointLight(WARM, 1.1, 28, 2); babyLight.position.set(0, 1.3, 0);
babyGroup.add(bundle, babyHead, halo, babyLight);
scene.add(babyGroup);

// warm beacon wisps so it can be spotted through the fog
const BW = 26, bwArr = new Float32Array(BW*3);
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
const BSP = 70, bspArr = new Float32Array(BSP*3), bspVel = [];
const bspPts = new THREE.Points(new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: 0xffe6b0, size: 0.7, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
bspPts.geometry.setAttribute('position', new THREE.BufferAttribute(bspArr, 3));
boomGroup.add(boomFlash, boomRing, bspPts);
let boomStart = -1;
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
const lookM = new THREE.Matrix4(), lookQ = new THREE.Quaternion();
function key3(time, keys){   // smoothstep-interpolated keyframes
  if(time <= keys[0][0]) return keys[0][1];
  for(let i=1;i<keys.length;i++){ if(time <= keys[i][0]){
    const [t0,v0]=keys[i-1], [t1,v1]=keys[i], u=(time-t0)/(t1-t0); return v0+(v1-v0)*(u*u*(3-2*u)); } }
  return keys[keys.length-1][1];
}

// (The death "getting eaten" moment is now a separate 2D cutscene overlay, not 3D geometry.)

// ---- Predators: wolf, bear, lion -----------------------------------------
const PSPEC = {
  // `nose` (LUL-23): scent-pickup radius multiplier. The bear gets the strongest
  // nose and the lion the weakest -- it hunts by stalking/sight, per LUL-24's
  // reserved two-stage stalk/circle behaviour -- so the three species stay
  // differentiated across both detection channels, not just sight.
  wolf: { body:0x565b63, sz:1.0, len:1.6, h:0.9,  mane:false, ears:true,  speed:8.5, detect:42, eye:0xadd8e6, rad:0.8, budget:6, nose:1.0 },
  bear: { body:0x3d2c22, sz:1.8, len:2.0, h:1.45, mane:false, ears:false, speed:6.8, detect:30, eye:0xff5a2a, rad:1.5, budget:9, nose:1.4 },
  lion: { body:0xc79a5b, sz:1.2, len:1.7, h:1.0,  mane:true,  ears:true,  speed:9.2, detect:48, eye:0xffcf3a, rad:1.0, budget:4, nose:0.75 },
};
// Size each animal's speed from its warning budget: from the moment it SEES you and you
// flee at top speed, the fastest (lion) still gives ≥4s, the bear ≥9s. All are faster than
// the player, so you can't simply outrun them — hiding is the real escape. Tune via CHASE_GAP.
const RUN = CONFIG.walk * 1.8, CHASE_GAP = 28;
for(const k in PSPEC) PSPEC[k].speed = RUN + CHASE_GAP / PSPEC[k].budget;

// LUL-26: difficulty presets. `night` is the existing tuning verbatim (every
// multiplier is a no-op) and stays default -- the ticket is explicit that
// tuning must not change. `activePerSpecies` trims the roster without
// touching PSPEC itself; `detectMul` scales the sight-detect radius at the
// one place that already reads it (effectiveDetect); `glowMul` scales the
// child's existing idle/carry glow values instead of new ones.
const DIFFICULTY_PRESETS = {
  lantern:  { activePerSpecies: 1, detectMul: 0.7, glowMul: 1.6, startHunting: false, minimap: true },
  night:    { activePerSpecies: 3, detectMul: 1,   glowMul: 1,   startHunting: false, minimap: true },
  blackout: { activePerSpecies: 3, detectMul: 1,   glowMul: 1,   startHunting: true,  minimap: false },
};
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
    phase:Math.random()*6, spotted:false, callTimer:0,
    inv:'', sniffsLeft:0, sniffTimer:0, backX:0, backZ:0,
    stuckT:0, trail:[], trailT:0, reroute:0, rrX:0, rrZ:0, hunt:false, alert:0, scentLock:0, scentCalls:0,
    packTimer:0, flankX:0, flankZ:0, sniffImmuneT:0,
    charge:null, chargeDirX:0, chargeDirZ:0, chargeCooldown:0, inert:false };
}
const predators = [];
// `speciesIdx` (0..2 within its species) is what LUL-26's `activePerSpecies`
// preset compares against -- fixed at creation so placePredators() doesn't
// need to re-derive array position every restart.
for(const k of ['wolf','bear','lion']) for(let i=0;i<3;i++){ const p = makePredator(k); p.speciesIdx = i; predators.push(p); }
let sinceClose = 0, huntTime = 0, spotFlash = 0, pianoTimer = 0;   // threat timers, spot flash, approach-note timer
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
    // reject inLake() already. Same bounded budget (tries<60) as before, the
    // lake check just joins the other reject reasons. If the budget still
    // exhausts on a lake candidate (every draw in the wedge landed in the
    // water), pushOutOfLakeClearance() deterministically relocates it just
    // past the lake's clearance ring rather than silently spawning it in the
    // water -- see lib/game/lake.ts.
    let x, z, tries = 0;
    do { const ang=rng()*Math.PI*2, d=half*(0.42+rng()*0.45); x=Math.cos(ang)*d; z=Math.sin(ang)*d; tries++; }
    while((x*x+z*z < 2500 || Math.hypot(x-baby.x, z-baby.z) < 26 || blockedR(x, z, p.rad+0.5) || inLake(x,z)) && tries < 60);
    if(inLake(x,z)){ const pushed = pushOutOfLakeClearance(x, z, CONFIG.lake); x = pushed.x; z = pushed.z; }
    p.x=x; p.z=z; p.wpx=x; p.wpz=z; p.vx=0; p.vz=0; p.yaw=rng()*Math.PI*2;
    p.state='roam'; p.spotted=false; p.inv=''; p.sniffsLeft=0; p.sniffTimer=0; p.callTimer=0;
    p.stuckT=0; p.trail=[]; p.trailT=0; p.reroute=0; p.hunt=preset.startHunting; p.alert=0; p.scentLock=0; p.scentCalls=0;
    p.packTimer=0; p.flankX=0; p.flankZ=0; p.sniffImmuneT=0;
    p.charge=null; p.chargeDirX=0; p.chargeDirZ=0; p.chargeCooldown=0;
    p.g.position.set(x, 0, z); p.g.rotation.set(0, p.yaw, 0);
  }
  mm.style.display = preset.minimap ? '' : 'none';
  sinceClose = 0; huntTime = 0; spotFlash = 0;
  activeCharges = 0; pushState({ chargeVisible: false });
}
// steer a desired direction around trees the predator would otherwise walk into
// LUL-593: the angle-fallback scan itself now lives in lib/game/cover.ts
// (pickAvoidDirection, unit tested there) -- this stays a thin wrapper that
// injects the engine's own tree/landmark `grid` closure state, same pattern
// as blockedR/blocked/hasLOS/findHideSpot above.
function avoidDir(p, dx, dz){ return pickAvoidDirection(p.x, p.z, p.rad, dx, dz, grid); }
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
function depositScent(hot){
  scentPoints.push({ x: player.x, z: player.z, t0: clock.elapsedTime, radius: hot ? SCENT_RADIUS_RUN : SCENT_RADIUS_WALK });
  while(scentPoints.length && isScentPastPruneCutoff(clock.elapsedTime - scentPoints[0].t0)) scentPoints.shift();
}
function checkScent(p){
  for(let i = scentPoints.length - 1; i >= 0; i--){
    const s = scentPoints[i], age = clock.elapsedTime - s.t0;
    if(isScentDetected(s, age, p.x, p.z, windX, windZ, p.spec.nose)) return true;
  }
  return false;
}
// Like spotOnto, but scent isn't "being watched": no roar / screen flash / rear-up
// freeze. Just a growl and a straight line toward you -- the tell is behavioural
// (a predator that was ambling suddenly moves with purpose, and the hunt music
// picks up even though nothing looked at you), which is what makes it learnable
// without a tutorial or a status readout.
function scentOnto(p){
  if(p.scentLock > 0) return;   // already tracking off a scent cue: don't re-trigger the roar
  p.state = 'chase'; p.scentLock = SCENT_TRACK_TIME; p.callTimer = rnd(2.6,4.2);
  p.scentCalls++;               // QA-visible: e2e/scent.spec.ts asserts this stays low, not once-per-frame
  if(!p.spotted) p.spotted = true;
  predatorCall(p.kind, false, p);
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
  p.state = 'investigate'; p.inv = 'approach'; p.sniffsLeft = rollSniffs(Math.random, 4);
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
function hasLOS(x0,z0,x1,z1){ return geoHasLOS(x0,z0,x1,z1,coverGrid); }
function findHideSpot(x,z){ return geoFindHideSpot(x,z,coverGrid); }
function effectiveDetect(p){
  return geoEffectiveDetect(p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount), { hidden, hideTime });
}
function canSee(p, dist){
  return geoCanSee(dist, p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount), { hidden, hideTime }, p.x, p.z, player.x, player.z, coverGrid);
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
    const [fx, fz] = flankTarget(player.x, player.z, escX, escZ, side, p.x, p.z, { half, zMax });
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
const CHARGE_COOLDOWN = 10;

function updatePredators(dt, noiseRadius){
  const tt = clock.elapsedTime;
  updateWolfPack(dt);
  for(const p of predators){
    if(p.inert) continue;   // LUL-26: parked out for the current difficulty preset
    const dx = player.x - p.x, dz = player.z - p.z, dist = Math.hypot(dx, dz) || 0.0001;
    const ux = dx/dist, uz = dz/dist;
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
        triggerDeath(p.kind);
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
        p.state = 'investigate'; p.inv = 'approach'; p.sniffsLeft = rollSniffs(Math.random, 3);
        endChargeHud();
      } else {
        p.charge = cs;
        facePlayer = cs.phase === 'telegraph';
        if(cs.phase !== 'telegraph'){ desx = p.chargeDirX; desz = p.chargeDirZ; speed = chargeSpeed(cs.distance); }
      }
    }
    // spot "alert": brief rear-up + freeze the instant it locks on
    else if(p.alert > 0){
      p.alert -= dt; facePlayer = true; speed = 0;
      // (movement handled below; the rear is applied in the animation section)
    } else if(p.reroute > 0){                        // stuck → back up along its trail, then a different way
      p.reroute -= dt;
      const bx=p.rrX-p.x, bz=p.rrZ-p.z, bd=Math.hypot(bx,bz);
      if(bd > 0.4){ desx=bx/bd; desz=bz/bd; speed=p.spec.speed*0.7; }
      if(p.reroute <= 0) p.stuckT = 0;
    } else if(p.hunt){                                // forced: comes straight for you while it can see you (no giving up otherwise)
      if(!canSee(p, dist)){ p.state='investigate'; p.inv='approach'; p.sniffsLeft=rollSniffs(Math.random, 4); p.hunt=false; }
      else {
        if(isCaught(dist, p.rad)) triggerDeath(p.kind);
        else { desx=ux; desz=uz; speed=p.spec.speed; }
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
      if(!sniffImmune && canSee(p, dist)){ spotOnto(p); }
      else if(!sniffImmune && checkScent(p)){ scentOnto(p); }
      else if(!sniffImmune && checkNoise(p, dist, noiseRadius, dt)){ hearNoise(p); }
      else {
        let wx=p.wpx-p.x, wz=p.wpz-p.z; const wd=Math.hypot(wx,wz);
        if(wd < 2.5){ const a=Math.random()*Math.PI*2, r=15+Math.random()*40;
          p.wpx=clamp(p.x+Math.cos(a)*r,-half+4,half-4); p.wpz=clamp(p.z+Math.sin(a)*r,-half+4,zMax-4); }
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
      if(p.scentLock <= 0 && !canSee(p, dist)){ p.state='investigate'; p.inv='approach'; p.sniffsLeft = rollSniffs(Math.random, 4); }
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
        if(canCatchInChase(canSee(p, dist), dist, p.rad)){ triggerDeath(p.kind); }
        else { desx=ux; desz=uz; speed=p.spec.speed; }
        if(shouldGiveUpChase(p.scentLock, dist, p.spec.detect)){ p.state='roam'; p.spotted=false; }
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
      // actually about -- a freshly-entered 'approach' (every chase->investigate
      // transition sets p.inv='approach') used to hit this same instant revert
      // before its own movement branch below ever ran, and chase's re-entry
      // condition was still true a frame later since nothing had moved --
      // volleying chase<->investigate forever at zero velocity. See
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
        const step = stepApproach(ux, uz, p.spec.speed, dist, p.rad);
        desx = step.desx; desz = step.desz; speed = step.speed;
        if(step.enterSniff){ p.inv='sniff'; p.sniffTimer = rnd(1,5); sniff(); }
      } else if(p.inv === 'sniff'){
        facePlayer = true; p.sniffTimer -= dt;
        const sniffOutcome = stepSniffLoop(p.sniffTimer, p.sniffsLeft);
        if(sniffOutcome.done){
          p.sniffsLeft = sniffOutcome.sniffsLeft;
          p.sniffImmuneT = SNIFF_IMMUNITY_TIME;   // LUL-437: grace before re-detection, either transition
          if(sniffOutcome.next === 'back'){ p.inv='back'; const bd = 8 + Math.random()*8;
            [p.backX, p.backZ] = backOffPoint(p.x, p.z, ux, uz, bd, half, zMax); }
          else { p.state='roam'; p.spotted=false; }
        }
      } else if(p.inv === 'back'){
        const bx=p.backX-p.x, bz=p.backZ-p.z, bd=Math.hypot(bx,bz);
        if(bd < 2){ p.inv='approach'; } else { desx=bx/bd; desz=bz/bd; speed=p.spec.speed*0.5; }
      }
    } else if(p.state === 'flank'){
      // LUL-24: pack-ordered wolf, not independently hunting. Sight and scent
      // still work normally -- a flanker that stumbles onto the player still
      // spots/scents them -- this only replaces what it does with *no* signal.
      if(canSee(p, dist)){ spotOnto(p); }
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
          else { p.state='roam'; p.spotted=false; p.inv=''; }
        }
      } else {
        const fx=p.flankX-p.x, fz=p.flankZ-p.z, fd=Math.hypot(fx,fz);
        if(fd < FLANK_ARRIVE_R){ p.inv='hold'; p.sniffsLeft=rollSniffs(Math.random, 3); p.sniffTimer=rnd(1,4); sniff(); }
        else { desx=fx/fd; desz=fz/fd; speed=p.spec.speed*FLANK_SPEED_MUL; }
      }
    }

    if(speed > 0 && (desx || desz)) [desx, desz] = avoidDir(p, desx, desz);

    // smooth velocity + collide with trees (axis-separated slide)
    const dvx = desx*speed, dvz = desz*speed, accel = speed > 0 ? 3.6 : 6;
    p.vx += (dvx - p.vx) * Math.min(1, dt*accel);
    p.vz += (dvz - p.vz) * Math.min(1, dt*accel);
    const px0 = p.x, pz0 = p.z;
    const nx = clamp(p.x + p.vx*dt, -half+2, half-2), nz = clamp(p.z + p.vz*dt, -half+2, zMax-2);
    if(!blockedR(nx, p.z, p.rad)) p.x = nx; else p.vx *= 0.2;
    if(!blockedR(p.x, nz, p.rad)) p.z = nz; else p.vz *= 0.2;
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
        p.wpx = clamp(p.x + (Math.random()-0.5)*40, -half+4, half-4);   // fresh, different waypoint
        p.wpz = clamp(p.z + (Math.random()-0.5)*40, -half+4, zMax-4);
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
}
// lock onto the player: stinger, roar, screen flash, and a rear-up alert beat
function spotOnto(p){
  p.state='chase'; p.callTimer=rnd(2.6,4.2); p.alert = 0.55;
  if(!p.spotted){ p.spotted=true; }
  predatorCall(p.kind, false, p); spotSting(); spotFlash = 1;
}

// ---- Player + input ------------------------------------------------------
const player = { x:0, z:0, yaw:0, pitch:-0.02 };
const keys = {};
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let entered = false, walk = CONFIG.walk, won = false, canPickup = false,
    dead = false, pickingUp = false, carrying = false, pickStart = 0, hidden = false, hideTime = 0, eyeH = CONFIG.eye,
    deathStart = 0, deathShown = false, pickBoomed = false, scentEmitT = 0, enteredAt = 0,
    hideKind = null,   // LUL-212: which hiding-spot kind the player is currently in ('bramble' | 'log'), for the exit sound
    jumping = false, jumpElapsed = 0, jumpPressed = false;   // LUL-213: see beginJump() / tick()'s jumpY
// LUL-596: `won`/`dead`/`pickingUp`/`carrying`/`baby.taken` above stay the
// engine's own mutable locals (lib/game/outcome.ts is pure and holds no
// state of its own) -- this snapshots them into the RunState shape the
// module's pure functions read, on demand, right before each call.
function runState(){
  return { entered, won, dead, pickingUp, carrying, babyTaken: baby.taken };
}
// LUL-153: `game_start` fires once per page-load (first real pointer-lock
// acquisition), not once per restart -- it feeds the page_view -> ... -> win
// funnel, which measures "did this visitor ever reach gameplay," not run count.
let gameStartFired = false;
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

on(window, 'keydown', e => {
  keys[e.code] = true;
  const playing = isPlaying(runState());
  if(e.code === 'Escape' && playing){ if(locked) document.exitPointerLock(); else setPaused(true); }
  // LUL-26: toggle-run edge-triggers off keydown (not keyup) so the very
  // press that would have started a hold-run also starts a toggle-run --
  // `e.repeat` guards the OS's own key-repeat from flipping it back and forth.
  if((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && runMode === 'toggle' && !e.repeat && playing && !paused){
    toggleRunOn = !toggleRunOn;
  }
  if(e.code === 'KeyE' && canPickup && playing && !paused) pickup();
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
const SENS = 0.0022;
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
      // LUL-153: the actual "gameplay begins" moment -- distinct from the gate
      // click (cta_start_clicked, fired in Hud.tsx), which only requests the
      // lock; this is the browser actually granting it.
      if(entered && !gameStartFired){ gameStartFired = true; track({ event: 'game_start', seed: currentSeed }); }
    }
    else if(isPlaying(runState())) setPaused(true);     // Esc / released lock -> menu
  });
  on(document, 'pointerlockerror', () => { locked = false; });
  on(el, 'mousedown', () => {
    if(paused){ setPaused(false); requestLock(); return; }   // click to look again
    if(!locked){ dragging = true; el.style.cursor = 'grabbing'; }
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
  const master = ctx.createGain(); master.connect(ctx.destination);
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(soundOn ? 0.6 : 0.0001, ctx.currentTime + 2);

  const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 2.4, 3.0);
  const rev = ctx.createGain(); rev.gain.value = 0.5; conv.connect(rev); rev.connect(master);

  // wind bed — brown noise through a lowpass, opens up as you move
  const wind = ctx.createBufferSource(); wind.buffer = noise(ctx, 3, true); wind.loop = true;
  const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 340; wf.Q.value = 0.6;
  const wg = ctx.createGain(); wg.gain.value = 0.06;
  wind.connect(wf); wf.connect(wg); wg.connect(master); wg.connect(conv); wind.start();

  // low ominous drone
  const dg = ctx.createGain(); dg.gain.value = 0.05; dg.connect(master); dg.connect(conv);
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
}
function footstep(vol){
  const { ctx, conv, master, footBuf } = audio, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = footBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 150 + Math.random()*100; f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t+0.005); g.gain.exponentialRampToValueAtTime(0.0001, t+0.18);
  src.connect(f); f.connect(g); g.connect(master); g.connect(conv); src.start(t); src.stop(t+0.22);
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
// LUL-212: enter/exit foley for the two hiding-spot kinds. Bandpass-filtered
// noise bursts, same building blocks as footstep()/the rest of this file --
// no audio files, per the engine's existing all-procedural-WebAudio approach.
// Bush: a few quick high, bright bursts read as individual leaves brushing
// past -- the "something is hiding in the brush" cue that's the universal
// foley convention for stealth/horror games (wiki: game/lul212-hiding-spots).
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
// Hollow log: a low resonant knock (short bandpassed noise burst + a falling
// sine thump, the same "hollow body" pairing a real knock on dead wood
// produces) plus, on entry only, a soft dry creak as the player settles in.
function hollowLogSound(entering){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const nb = ctx.createBufferSource(); nb.buffer = noise(ctx, 0.1, false);
  const bp = ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value = 220; bp.Q.value = 6;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(entering ? 0.3 : 0.2, t+0.008); ng.gain.exponentialRampToValueAtTime(0.0001, t+0.16);
  nb.connect(bp); bp.connect(ng); ng.connect(master); ng.connect(conv); nb.start(t); nb.stop(t+0.18);

  const o = ctx.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(90, t+0.2);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(entering ? 0.22 : 0.14, t+0.01); og.gain.exponentialRampToValueAtTime(0.0001, t+0.22);
  o.connect(og); og.connect(master); og.connect(conv); o.start(t); o.stop(t+0.24);

  if(entering){
    const cb = ctx.createBufferSource(); cb.buffer = noise(ctx, 0.3, true);
    const cf = ctx.createBiquadFilter(); cf.type='bandpass'; cf.frequency.setValueAtTime(500, t+0.05); cf.frequency.linearRampToValueAtTime(340, t+0.32); cf.Q.value = 3;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t+0.05); cg.gain.exponentialRampToValueAtTime(0.09, t+0.09); cg.gain.exponentialRampToValueAtTime(0.0001, t+0.34);
    cb.connect(cf); cf.connect(cg); cg.connect(master); cg.connect(conv); cb.start(t+0.05); cb.stop(t+0.36);
  }
}
function playHideSfx(kind, entering){ if(kind === 'log') hollowLogSound(entering); else leafRustle(entering); }
// The three call sites (KeyH, the touch Hide button, and tick()'s
// movement-breaks-cover check) all funnel through these so entering/exiting
// always agree on `hidden`/`hideTime`/`hideKind` and always play the right
// prop's sound -- no call site duplicates the bookkeeping. LUL-391: this is
// also the one place feature_engagement('hide') fires -- an earlier,
// shadowed toggleHidden() carried that track() call but was dead code (a
// later function declaration in the same scope wins in JS), so the event
// never fired.
function enterHide(spot){ hidden = true; hideTime = 0; hideKind = spot.kind; playHideSfx(spot.kind, true); track({ event: 'feature_engagement', feature: 'hide', action: 'used' }); }
function exitHide(){ if(!hidden) return; playHideSfx(hideKind, false); hidden = false; hideKind = null; }
function toggleHidden(){
  if(hidden){ exitHide(); return; }
  const spot = findHideSpot(player.x, player.z);
  if(spot) enterHide(spot);
}
const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 987.77];
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
// swelling warm cue for the 10s pickup cinematic
function playPickupMusic(){
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
  const rise = [392.00,440.00,523.25,587.33,659.25,783.99,880.00,1046.50];   // ascending as the child lifts
  rise.forEach((f, i) => {
    const s = t0 + 3.5 + i*0.55;
    const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.14, s+0.02); g.gain.exponentialRampToValueAtTime(0.0001, s+1.4);
    o.connect(g); g.connect(bus); g.connect(conv); o.start(s); o.stop(s+1.5);
  });
  later(() => { if(audio){ audio.wg.gain.setTargetAtTime(0.05, audio.ctx.currentTime, 1); audio.dg.gain.setTargetAtTime(0.05, audio.ctx.currentTime, 1); } }, 11000);
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
    const dx = p.x - player.x, dz = p.z - player.z, dist = Math.hypot(dx, dz);
    const near = dist < 30 ? 'near' : 'far';
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const rx =  Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    const fwd = dx*fx + dz*fz, right = dx*rx + dz*rz;
    const side = Math.abs(right) < Math.abs(fwd)*0.6 ? (fwd >= 0 ? 'ahead' : 'behind') : (right > 0 ? 'right' : 'left');
    where = `${near} · ${side}`;
  }
  pushState({ caption: `${kind} ${verb}${big ? ' (close)' : ''} · ${where}`, captionId: ++captionSeq });
}
function predatorCall(kind, big, p){
  if(captionsOn) announceCaption(kind, big, p);
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime, vol = big ? 1.0 : 0.6;
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
function pianoNote(freq, vol){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t = ctx.currentTime;
  const parts = [[1,1],[2,0.5],[3,0.25],[4,0.12]];
  const play = (f, amp) => parts.forEach(([h,ha]) => { const o=ctx.createOscillator(); o.type='sine';
    o.frequency.value = f*h*(1+0.0007*h*h);
    const g=ctx.createGain(); const a=amp*ha*vol; g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(a, t+0.005); g.gain.exponentialRampToValueAtTime(0.0001, t+1.6);
    o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t+1.65); });
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
  winVisible: false,
  deathVisible: false, deathKind: 'wolf', lossRevealed: false,
  survivedSeconds: 0,
  pace: CONFIG.walk, fog: CONFIG.fog, soundOn: true,
  lightDimmed: false,
  // LUL-382: mist veil resource meter -- 1 is full charge, 0 is fully drained.
  veilCharge: 1, veilLocked: false,
  chargeVisible: false, chargeToken: 0,
  // LUL-26: difficulty + accessibility. Controlled the same way pace/fog
  // already are -- the engine is the source of truth, React only renders it
  // and persists it to localStorage (see components/Hud.tsx).
  difficulty: 'night', runMode: 'hold', sensitivity: 1, invertY: false,
  reducedMotion: false, captionsOn: false, caption: null, captionId: 0,
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
const PLAYER_FOV_COS = Math.cos(65 * Math.PI/180);
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
  enteredAt = clock.elapsedTime;
  pushState({ entered: true });
  setPaused(false);
  if(!started){ startAudio(); started = true; }
  else if(audio){ audio.ctx.resume(); }
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

  // LUL-25: sets difficulty for the *next* generateMap() call (restart/regen
  // -- the current map doesn't retroactively move the child). The real path
  // is setDifficulty('blackout') via the settings panel (LUL-372); this hook
  // lets a test pin the 'hard' baby-spawn seam directly, without also
  // pulling in the rest of the blackout preset (predator roster/detection).
  window.ForestEngine.qaSetDifficulty = function(mode){ babySpawnDifficulty = mode === 'hard' ? 'hard' : 'normal'; };
  window.ForestEngine.qaProbeBaby = function(){ return { x: baby.x, z: baby.z, inBog: inBog(baby.x, baby.z) }; };

  // LUL-211: the cover-collision fix (coverBlockedR, folded into blocked())
  // was unprovable from a test -- nothing outside the closure could read where
  // the player ended up, so "you can walk through a boulder" could only ever be
  // reported by a human. These two hooks close that: stage the player facing a
  // prop of a given kind, hold W, then read the position back.
  window.ForestEngine.qaProbePlayer = function(){
    return { x: player.x, z: player.z, yaw: player.yaw };
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
  // HIDE_KINDS (bramble/log) -- rock is still LOS-blocking cover but is no
  // longer a place `hidden` can be entered, so a test staged on a rock would
  // press KeyH and get nothing, then hang waiting for `investigate` to hold
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
  // against unrelated tree overlap. With COVER_PROPS=220 (~65% bramble/log)
  // some candidate is always clear.
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
      p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0;
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
      p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0;
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
    p.hunt = false; p.alert = 0; p.sniffsLeft = 0;
    return { x: p.x, z: p.z };
  };

  // LUL-212: teleport the player to the nearest hiding spot (bramble/log),
  // no predator involved -- e2e/hide.spec.ts only needs a deterministic spot
  // to press KeyH at, not a chase scenario.
  window.ForestEngine.qaTeleportToHideSpot = function(){
    const spot = coverData.find(c => HIDE_KINDS[c.kind]);
    if(!spot) return null;
    player.x = spot.x; player.z = spot.z;
    return spot.kind;
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
    return { kind: p.kind, state: p.state, inv: p.inv, sniffsLeft: p.sniffsLeft, scentCalls: p.scentCalls, dist, canSee: canSee(p, dist), x: p.x, z: p.z };
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
    p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0; p.hunt = false;
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
    return {
      x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch, mode: mode,
      jumping: jumping, paused: paused, toggleRunOn: toggleRunOn,
      veilHeld: (entered && !won && !dead && !pickingUp) && (!!keys['KeyF'] || touchVeil),
    };
  };

  // LUL-388: reproduces the exact LUL-387 regression shape live -- a predator
  // mid-blind-scent-chase (scentLock > 0, so the 'chase' branch never falls
  // through to the canSee()-gated investigate transition), within catch range
  // of the player, with a real cover prop's rotated AABB sitting on the
  // segment between them so canSee() is false. Pre-fix this died instantly
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
      if(c.kind === 'tree') continue;
      const thin = Math.min(c.hx, c.hz);
      // Asymmetric on purpose: the predator (point A) never calls blocked()/
      // coverBlockedR() for its own movement (LUL-119/211 -- the whole point of
      // this hook), so it can sit right at the box's thin face. The player
      // (point B) very much does -- blocked()'s coverBlockedR(x,z,0.6) call pads
      // every prop by the player's own 0.6 radius -- so it needs to clear
      // thin+0.6, not just thin, or qaProbePlayer/blocked() would reject its own
      // staged position as "inside" the prop.
      const offA = thin + 0.1, offB = thin + 0.6 + 0.1;
      if(offA + offB >= p.rad + CATCH_MARGIN) continue;   // must land inside catch range
      const co = Math.cos(c.ry), si = Math.sin(c.ry);
      const thinIsZ = c.hz <= c.hx;
      const lxA = thinIsZ ? 0 : -offA, lzA = thinIsZ ? -offA : 0;
      const lxB = thinIsZ ? 0 : offB, lzB = thinIsZ ? offB : 0;
      const ax = c.x + lxA*co + lzA*si, az = c.z - lxA*si + lzA*co;
      const bx = c.x + lxB*co + lzB*si, bz = c.z - lxB*si + lzB*co;
      if(blockedR(ax, az, p.rad) || blocked(bx, bz)) continue;
      p.x = ax; p.z = az;
      p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0;
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
  function traceBlindChase(idx, maxMs){
    return new Promise(function(resolve){
      const trace = [];
      const t0 = performance.now();
      function frame(){
        const p = predators[idx];
        if(!p){ resolve(trace); return; }
        const d = Math.hypot(player.x-p.x, player.z-p.z) || 0.0001;
        trace.push({ t: performance.now()-t0, dist: d, canSee: canSee(p, d), dead: dead });
        if(dead || performance.now()-t0 > maxMs){ resolve(trace); return; }
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

  // LUL-69: camera.fov is closure-local (created fresh per init(), see
  // CAMERA_FOV above) -- nothing outside init() could otherwise confirm the
  // mobile/desktop FOV split actually took effect.
  window.ForestEngine.qaCameraFov = function(){ return camera.fov; };
}

// ---- Objective, pickup cinematic, win / death ----------------------------
const spotFlashEl = document.getElementById('spotFlash');
const deathVideo = document.getElementById('deathVideo');
const CUT_END = 3.7;   // death video length; reveal the loss text at the end
if(deathVideo) on(deathVideo, 'ended', () => { if(dead) revealLoss(); });
function pickup(){
  const next = beginPickup(runState());
  if(next.pickingUp === pickingUp) return;   // rejected -- see pickupAllowed() in lib/game/outcome.ts
  baby.taken = next.babyTaken; pickingUp = next.pickingUp;
  pickStart = clock.elapsedTime; hidden = false;
  bwisps.visible = false;   // LUL-38: the beacon wisps marked where the child was found; carrying starts now
  pushState({ objectiveVisible: false, statusVisible: false });
  if(locked) document.exitPointerLock();
  document.body.style.cursor = 'none';
  armsGroup.visible = true;
  pickBoomed = false;
  playPickupMusic();
}
function finishPickup(){
  // LUL-38: the burst above (fireBoom) is the moment of pickup, not the child
  // leaving -- winning now requires walking them to CONFIG.home. They ride
  // along small and glowing until you arrive; see arriveHome(). Reset the
  // glow properties the cinematic left mid-transition (the "boomed" branch
  // above forces babyLight to 0 every frame while pickingUp).
  const next = completePickup(runState());
  pickingUp = next.pickingUp; carrying = next.carrying;
  armsGroup.visible = false;
  document.body.style.cursor = '';
  babyGroup.visible = true; babyGroup.scale.setScalar(0.6);
  bundle.material.emissiveIntensity = babyHead.material.emissiveIntensity = 0.55;
  halo.material.opacity = 0.22; babyLight.intensity = 1.3;
}
function arriveHome(){
  const next = outcomeArriveHome(runState());
  won = next.won; carrying = next.carrying;
  babyGroup.visible = false;
  if(locked) document.exitPointerLock();
  document.body.style.cursor = '';
  const survivedSeconds = Math.max(0, clock.elapsedTime - enteredAt);
  // LUL-303: updatePredators() (the only other place that clears the charge
  // HUD) stops running once `playing` goes false here, so a charge/telegraph
  // in flight at the exact moment of arrival would otherwise render on top
  // of the win screen forever -- clear it the same way placePredators() does
  // on restart.
  activeCharges = 0;
  pushState({ objectiveVisible: false, statusVisible: false, winVisible: true, chargeVisible: false, survivedSeconds });
  track({ event: 'win', time_survived_ms: Math.round(survivedSeconds * 1000), seed: currentSeed });
}
function triggerDeath(kind){
  const next = outcomeTriggerDeath(runState());
  if(next.dead === dead) return;   // rejected -- see canTriggerDeath() in lib/game/outcome.ts
  dead = next.dead; hidden = false; deathStart = clock.elapsedTime; deathShown = false;
  if(locked) document.exitPointerLock();
  document.body.style.cursor = 'none';
  const survivedSeconds = Math.max(0, deathStart - enteredAt);
  pushState({ deathVisible: true, deathKind: kind, lossRevealed: false, survivedSeconds });
  track({ event: 'loss', predator_kind: kind, time_survived_ms: Math.round(survivedSeconds * 1000), seed: currentSeed });
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
  pushState({ winVisible: false, deathVisible: false, lossRevealed: false });
  if(deathVideo){ deathVideo.pause(); deathVideo.style.display = 'none'; }
  const fresh = freshRunState();
  won = fresh.won; dead = fresh.dead; pickingUp = fresh.pickingUp; carrying = fresh.carrying; baby.taken = fresh.babyTaken;
  hidden = false; hideTime = 0; hideKind = null; eyeH = CONFIG.eye; deathShown = false;
  jumping = false; jumpElapsed = 0; jumpPressed = false;   // LUL-213: no mid-arc jump carrying into the new round
  armsGroup.visible = false; babyGroup.visible = true; babyGroup.scale.setScalar(1);
  bundle.material.emissiveIntensity = babyHead.material.emissiveIntensity = 0.5;
  pickBoomed = false; boomGroup.visible = false; boomStart = -1; if(flashEl) flashEl.style.opacity = '0';
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
function regenMap(){ generateMap((Math.random()*1e9)>>>0); }

// LUL-26: difficulty + accessibility actions. Mirrors setPace/setFog above --
// the engine applies the change and echoes the new value back via pushState
// so React's controls stay driven by engine state, not a second local copy.
function setDifficulty(d){
  if(!DIFFICULTY_PRESETS[d]) return;
  difficulty = d;
  // LUL-372: thread the real difficulty choice down to LUL-25's hard-baby-
  // spawn seam -- 'blackout' (the hardest preset: full roster, already
  // hunting, no minimap) is the only tier that also pushes the child beyond
  // the bog; 'lantern'/'night' keep the child at its normal spawn.
  babySpawnDifficulty = d === 'blackout' ? 'hard' : 'normal';
  // Repositioning/parking predators mid-chase would be jarring and could pop
  // one in on top of the player, so a live difficulty change only re-applies
  // immediately before the player has entered; otherwise it takes effect on
  // the next restart() (which already calls placePredators() itself and,
  // via generateMap(), applyHardBabySpawn()).
  if(!entered) { placePredators(); applyHardBabySpawn(); }
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
on(window, 'resize', () => {
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  applyRes();
});

// ---- Minimap -------------------------------------------------------------
const mm = document.getElementById('minimap'), mmx = mm.getContext('2d'), MM = mm.width, mmS = MM/CONFIG.mapSize;
const mmStatic = document.createElement('canvas'); mmStatic.width = MM; mmStatic.height = MM;
const sx = mmStatic.getContext('2d');
function w2m(x,z){ return [ (x+half)*mmS, (z+half)*mmS ]; }
function drawMinimapStatic(){
  sx.clearRect(0,0,MM,MM);
  sx.fillStyle = 'rgba(10,14,21,0.5)'; sx.fillRect(0,0,MM,MM);
  sx.strokeStyle = 'rgba(150,175,215,0.25)'; sx.lineWidth = 1; sx.strokeRect(1,1,MM-2,MM-2);
  sx.fillStyle = 'rgba(120,150,120,0.5)';
  for(let i=0;i<treeData.length;i+=4){ const [px,py] = w2m(treeData[i].x, treeData[i].z); sx.fillRect(px, py, 1.2, 1.2); }
  const [lx,ly] = w2m(CONFIG.lake.x, CONFIG.lake.z);
  sx.beginPath(); sx.arc(lx, ly, CONFIG.lake.r*mmS, 0, Math.PI*2); sx.fillStyle = 'rgba(134,184,255,0.55)'; sx.fill();
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
  renderer.outputEncoding = THREE.sRGBEncoding;
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

// ---- Build the first map, then run ---------------------------------------
generateMap(CONFIG.seed);
const clock = new THREE.Clock();
let bobPhase = 0;
let rafId = null;

function tick(){
  rafId = requestAnimationFrame(tick);
  const dt = clampDt(clock.getDelta()), t = clock.elapsedTime;

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

  // LUL-40/LUL-382: hold KeyF for the mist veil. Read every frame like `running`
  // below rather than from the keydown/keyup handlers, so releasing F while e.g.
  // the pause menu is open (which stops updating `keys` mid-hold) can't strand
  // the veil active.
  const veilHeld = playing && (!!keys['KeyF'] || touchVeil);
  const veilStep = stepVeilCharge({ charge: veilCharge, locked: veilLocked }, veilHeld, dt);
  veilCharge = veilStep.charge; veilLocked = veilStep.locked;
  const dimmed = veilStep.active;
  if(dimmed !== lightDimmed){
    lightDimmed = dimmed;
    const cfg = dimmed ? LIGHT_DIMMED : LIGHT_NORMAL;
    playerLight.intensity = cfg.intensity;
    playerLight.distance = cfg.distance;
    pushState({ lightDimmed });
  }
  dimAmount += ((lightDimmed ? 1 : 0) - dimAmount) * Math.min(1, dt*6);
  applyVignette(dimAmount);
  // LUL-382: mist ramp is deliberately slower than the vignette above (VEIL_RAMP
  // 1.6s vs. dimAmount's ~0.5s) -- the light pool reacts fast, the world's mist
  // visibly billows in behind it. effectiveDetect() reads veilAmount directly, so
  // the sight-detect cut ramps in step with what the player actually sees.
  veilAmount += ((lightDimmed ? 1 : 0) - veilAmount) * Math.min(1, dt / VEIL_RAMP);
  scene.fog.density = veilFogDensity(fogBase, MIST_VEIL_FOG, veilAmount);
  pushState({ veilCharge: Math.round(veilCharge * 100) / 100, veilLocked });

  let spd = 0, dist = 0, running = false, noiseRadius = 0;
  const playerInBog = inBog(player.x, player.z);   // LUL-25: shallow water -- half speed, louder splash
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
    const maxSpd = (running ? walk*1.8 : walk) * (carrying ? CONFIG.carryPaceMul : 1) * bogSpeedMultiplier(playerInBog) * lakeSpeedMultiplier(playerInLake);
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
      const nx = Math.max(-lim, Math.min(lim, player.x + mvx*step));
      const nz = Math.max(-lim, Math.min(zLim, player.z + mvz*step));
      if(!blocked(nx, player.z)){ dist += Math.abs(nx - player.x); player.x = nx; }  // slide along trunks
      if(!blocked(player.x, nz)){ dist += Math.abs(nz - player.z); player.z = nz; }
      // LUL-23: lay scent while actually moving -- holding still (or being hidden,
      // which already implies not moving) never adds to the trail.
      scentEmitT -= dt;
      if(scentEmitT <= 0){ depositScent(running); scentEmitT = SCENT_DEPOSIT_INTERVAL; }
      // LUL-39: footsteps carry too -- same "moving = louder, still = silent"
      // shape as scent, sized off the same running flag rather than a new one.
      // LUL-25: splashing through the bog carries further than a dry footstep --
      // the sight-cover reeds give you costs you on the sound channel instead.
      noiseRadius = (running ? NOISE_RADIUS_RUN : NOISE_RADIUS_WALK) * bogNoiseMultiplier(playerInBog);
    }
  }

  if(pickingUp){
    const e = clock.elapsedTime - pickStart;
    // arms rise into frame, gather the child, lift, then release to the sky
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
    if(boomed && !pickBoomed){ pickBoomed = true; fireBoom(baby.x, ay, baby.z); }   // the child bursts into the sky
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
    halo.material.opacity = (0.20 + Math.sin(t*1.8)*0.04) * DIFFICULTY_PRESETS[difficulty].glowMul;
    babyLight.intensity = (1.2 + Math.sin(t*1.8)*0.2) * DIFFICULTY_PRESETS[difficulty].glowMul;
    camera.position.set(player.x, eyeH + jumpY, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    const dh = Math.hypot(player.x - CONFIG.home.x, player.z - CONFIG.home.z);
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
  }

  if(playing) updatePredators(dt, noiseRadius);   // predators only hunt while you're actually playing
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
      if(p.state==='chase' || p.hunt || (p.state==='investigate' && p.inv!=='back')) approaching = true;
      if(dpd < effectiveDetect(p)){
        if(hasLOS(p.x, p.z, player.x, player.z)) exposedNow = true; else coveredNow = true;
      }
    }
    // if nobody has been near for 30s, the closest one comes straight for you
    if(nearDist < 20) sinceClose = 0; else sinceClose += dt;
    if(sinceClose > 30 && nearP && !hidden){ nearP.hunt = true; spotOnto(nearP); sinceClose = 12; }
    // approach piano note: quicker + higher the nearer it is
    if(approaching && nearDist < 46 && !hidden){
      pianoTimer -= dt;
      if(pianoTimer <= 0){
        const near01 = clamp(1 - nearDist/46, 0, 1);           // 0 far … 1 close
        pianoTimer = 1.3 - near01*0.95;                        // interval shortens as it nears
        const steps = [0,3,5,7,10,12][Math.min(5, Math.floor(near01*6))];
        pianoNote(98 * Math.pow(2, steps/12), 0.5 + near01*0.6);   // low, scary; rises as it closes
      }
    } else pianoTimer = 0;
  } else { sinceClose = 0; }

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

  const distLake = Math.hypot(player.x - CONFIG.lake.x, player.z - CONFIG.lake.z);

  // objective + status HUD
  const distBaby = Math.hypot(player.x - baby.x, player.z - baby.z);
  canPickup = canPickUp(runState(), distBaby, 3.6);
  const distHome = Math.hypot(player.x - CONFIG.home.x, player.z - CONFIG.home.z);   // LUL-38
  if(playing){
    let statusVisible = false, statusText = '';
    if(hidden){
      statusVisible = true;
      const sniffer = predators.some(p => p.state==='investigate' && Math.hypot(player.x-p.x, player.z-p.z) < 6);
      statusText = sniffer ? 'Hidden · something is sniffing you — DON’T MOVE'
                            : 'Hidden · ' + hideTime.toFixed(1) + 's   (move to break cover)';
    }
    pushState({
      objectiveVisible: true, objectiveReady: canPickup,
      objectiveText: carrying
        ? 'Carry the child home  ·  ' + Math.round(distHome) + 'm'
        : (canPickup ? 'Press  E  to lift the child' : 'Find the lost child  ·  ' + Math.round(distBaby) + 'm'),
      statusVisible, statusText,
    });
  } else {
    pushState({ objectiveVisible: false, statusVisible: false });
  }
  // the child's idle glow (outside the cinematic)
  if(!baby.taken){
    babyGroup.position.y = Math.sin(t*1.4) * 0.06;
    babyGroup.rotation.y = t * 0.4;
    halo.material.opacity = (0.11 + Math.sin(t*1.8) * 0.05) * DIFFICULTY_PRESETS[difficulty].glowMul;
    babyLight.intensity = (1.0 + Math.sin(t*1.8) * 0.25) * DIFFICULTY_PRESETS[difficulty].glowMul;
    const bp = bwisps.geometry.attributes.position.array;
    for(let i=0;i<BW;i++){ bp[i*3+1] += dt*0.4; if(bp[i*3+1] > 3.4) bp[i*3+1] = 0.2; }
    bwisps.geometry.attributes.position.needsUpdate = true;
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
    const move01 = Math.min(1, spd / (walk*1.8)), now = audio.ctx.currentTime;
    if(hunting){                                     // calm bed drops out
      audio.wg.gain.setTargetAtTime(0.0001, now, 0.3);
      audio.dg.gain.setTargetAtTime(0.0001, now, 0.3);
    } else {
      audio.wg.gain.setTargetAtTime(0.05 + move01*0.10, now, 0.3);
      audio.wf.frequency.setTargetAtTime(320 + move01*900, now, 0.3);
      audio.dg.gain.setTargetAtTime(0.05, now, 0.3);
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
      if(playerInBog) splash(0.3); else footstep(0.12);   // LUL-25: same cadence, louder/wetter in the bog
    }
  }

  // home landmark breathes, gently (LUL-38)
  homeRing.material.opacity = 0.16 + Math.sin(t*0.9)*0.06;

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
    if(canPickup && playing && !paused) pickup();
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
           triggerTouchJump, triggerTouchPause, triggerTouchToggleRun,
           setDifficulty, setRunMode, setSensitivity, setInvertY, setReducedMotion, setCaptions };
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
