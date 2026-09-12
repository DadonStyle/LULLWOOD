// Pure numeric/feel constants extracted from engine/forest-engine.js (LUL-1065,
// docs/specs/tuning-extraction.md). Mechanical move -- values are unchanged from
// what forest-engine.js used to declare inline. No Three.js/DOM dependency.
//
// NOTE (LUL-1491 deviation, declared on the ticket): RUN is NOT here. The spec's
// literal `CONFIG.walk * 1.8` predates the stamina merge (LUL-1113), which
// replaced that literal with `CONFIG.walk * STAMINA_SPRINT_MUL` (imported from
// lib/game/stamina.ts) specifically to kill a duplicate-constant P1 finding.
// Moving RUN here as a bare literal would silently resurrect that duplicate;
// importing lib/game/stamina.ts here would violate this file's own "no imports"
// design (tuning.js is meant to be engine-local presentation/feel data with no
// cross-module coupling). RUN stays declared in forest-engine.js, right next to
// PSPEC, still built from the imported CHASE_GAP below.

// ---- Knobs ---------------------------------------------------------------
export const CONFIG = {
  seed:    20260718,   // QA-pinned reference layout only -- see resolveInitialSeed(); not the default in-play seed since LUL-83.
  mapSize: 480,          // the forest is a fixed square this many units across
  detectScaleMul: 1,     // LUL-2407: predator detect-radius multiplier; applyQaWorldMicroPreset()
                          // scales this down to match the shrunk map so spawn distance keeps the
                          // same safety margin against detect radius. 1 = full-map, no-op default.
  speedScaleMul: 1,       // LUL-2422: predator movement-speed multiplier (folded into pLakeMul in
                          // the main predator loop, forest-engine.js). detectScaleMul alone wasn't
                          // enough -- a full-speed predator can still wander/chase into a scripted
                          // QA teleport target well within a scenario's ~8s window on the shrunk
                          // map. applyQaWorldMicroPreset() scales this down too. 1 = full-map default.
  wrapEnabled: false,    // LUL-1485: seam math is live everywhere but inert until a
                          // Game Tester seam-walk flips this true (fast-follow ticket)
  trees:   5200,
  // LUL-2328: coverProps/bogTrees/bogReeds moved onto CONFIG (were standalone
  // COVER_PROPS/BOG_TREES/BOG_REEDS exports) so applyQaWorldMicroPreset()
  // below can override them the same proven way it already overrides
  // mapSize/trees -- a property mutation on this one shared object, not a
  // second `let`-export live-binding mechanism. See that function's comment.
  coverProps: 880,
  bogTrees: 30,
  bogReeds: 120,
  walk:    6,            // walking speed (units/s); Shift multiplies it
  fog:     0.04,
  eye:     2.2,          // eye height
  bg:      0x0a0e15,
  trunk:   0x171b20,
  foliage: 0x102420,
  ground:  0x0c1117,
  // LUL-874: keep this well clear of the map edge (half = mapSize/2 = 240).
  // updatePredators()'s waypoint-pick sites clamp to map bounds, call
  // keepWaypointOffLake() (lib/game/lake.ts) -- which can push a waypoint out
  // to `r + margin` (~17 units) from the lake's center -- then clamp to
  // bounds *again*. If the lake ever sat within that push distance of an
  // edge, the second clamp could silently snap the waypoint back into the
  // water, reopening the bug PR #183 fixed, with no test or CI signal since
  // nothing currently asserts this. Today's (34,-28) is ~206 units from the
  // nearest edge, comfortably clear -- re-check this distance before moving
  // the lake or shrinking mapSize (wiki game/lul857-review-pr183).
  lake:    { x: 34, z: -28, r: 15, clear: 22, glow: 0x86b8ff },
  home:    { x: 0, z: 0, r: 3.6, glow: 0xffd9b0 },   // LUL-38: reuses the spawn point, no new rng draw
  carryPaceMul: 0.72,                                 // LUL-38: burden while carrying the child, not a cripple
};

// LUL-25: six fixed navigational landmarks, "visible over the fog line" so
// the player can orient without the minimap (which stays scaled to the
// original 240x240 forest -- see w2m()/drawMinimap() in forest-engine.js).
// Fixed constants, not an rng draw, same treatment as CONFIG.lake/CONFIG.home.
// `cr` is the movement-collision radius (LUL-374) -- deliberately much
// smaller than `clear` (which only keeps trees/cover from generating too
// close to the landmark's nudge target).
// LUL-1782: radioMast/chapelSteeple added when the map grew to 480x480
// (LUL-1484) left everything past radius ~134 without a landmark, and the
// child now spawns at radius 120-192 -- beyond the original four entirely.
// Placed at radius ~178-179, in the two widest angular gaps between the
// original four (the empty arc through `oak` at ~10 deg, and the empty arc
// between `fireTower` at 225 deg and `stoneMarker` at 323 deg).
export const LANDMARKS = [
  { kind: 'fireTower',     x: -95, z: -95, clear: 12, cr: 1.6 },
  { kind: 'stoneMarker',   x: 100, z: -75, clear: 9,  cr: 1.1 },
  { kind: 'oak',           x: 22,  z: 4,   clear: 10, cr: 1.3 },
  { kind: 'drownedCar',    x: -95, z: 46,  clear: 11, cr: 2.3 },
  { kind: 'radioMast',     x: 30,  z: 175, clear: 10, cr: 1.0 },
  { kind: 'chapelSteeple', x: 20,  z: -178, clear: 11, cr: 1.8 },
];

// LUL-1914: startled roosts, slice (a) -- fixed canopy sites that flush when a
// predator passes through at speed. Same "static list, no rng() draw" contract
// as LANDMARKS immediately above -- generateMap() stays byte-identical per seed.
export const ROOSTS = [
  { kind: 'canopyNE', x: 110,  z: 90,   radius: 20 },
  { kind: 'canopyN',  x: 55,   z: 135,  radius: 20 },
  { kind: 'canopyW',  x: -140, z: 15,   radius: 20 },
  { kind: 'canopyS',  x: -30,  z: -140, radius: 20 },
  { kind: 'canopyE',  x: 150,  z: -25,  radius: 20 },
];
export const ROOST_COOLDOWN = 32;   // seconds a roost stays quiet after firing

// LUL-1210: Stone Marker veil-charm interact radius -- same shape as
// MISSION_POOL's interactRadius (lib/game/mission.ts).
export const VEIL_CHARM_INTERACT_RADIUS = 4;

// LUL-1904: the cave -- spawns in ~50% of rounds (coin-flip drawn in
// generateMap(), see forest-engine.js), a fixed candidate slot like every
// LANDMARKS entry above, but NOT pushed into LANDMARKS itself -- that array
// is placed unconditionally every round (placeLandmarks(), forest-engine.js:1061-1069).
// `interactR` is the walk-in trigger radius (distinct from `cr`, the movement
// collider) -- deliberately larger, matching the scale of the other entries'
// `clear`.
export const CAVE = { kind: 'cave', x: -70, z: 130, clear: 12, cr: 1.6, interactR: 6 };

// LUL-1855: fog-exempt beacon glow, originally the radio mast only -- a small
// additive sprite, separate from the mast's existing PointLight (which FogExp2
// erases by ~43 units at default density regardless of intensity -- see wiki
// game/mechanics/landmarks-below-the-fog-line). Deliberately dim: a bearing,
// not a light source. LUL-2248: generalised to all six LANDMARKS[].kind so
// every landmark reads as a bearing beacon, not just the radio mast -- same
// scale/opacityBase/opacityAmp/pulseHz for every entry, only `color` varies
// (a distinct hue per kind so a beacon maps unambiguously to a landmark kind).
// `radioMast` keeps its exact original hue (0xff2a2a) -- that beacon already
// shipped and isn't being restyled.
export const LANDMARK_BEACONS = {
  fireTower:     { color: 0xff9a3a, scale: 1.4, opacityBase: 0.4, opacityAmp: 0.15, pulseHz: 0.5 },
  stoneMarker:   { color: 0x8fd1ff, scale: 1.4, opacityBase: 0.4, opacityAmp: 0.15, pulseHz: 0.5 },
  oak:           { color: 0x7ee08a, scale: 1.4, opacityBase: 0.4, opacityAmp: 0.15, pulseHz: 0.5 },
  drownedCar:    { color: 0xc9a6ff, scale: 1.4, opacityBase: 0.4, opacityAmp: 0.15, pulseHz: 0.5 },
  radioMast:     { color: 0xff2a2a, scale: 1.4, opacityBase: 0.4, opacityAmp: 0.15, pulseHz: 0.5 },
  chapelSteeple: { color: 0xffe066, scale: 1.4, opacityBase: 0.4, opacityAmp: 0.15, pulseHz: 0.5 },
};

// LUL-1808: roam waypoint step, expressed as a fraction of `half` the same way
// child spawn radius (half*(0.5+rng()*0.3), forest-engine.js:788) and predator
// spawn radius (half*(0.42+rng()*0.45), forest-engine.js:1204) already scale
// with map size. LUL-1484 grew mapSize 240->480 (half 120->240) but this step
// stayed a hardcoded 15-55 units, so predators shuffled a ~70-unit patch of
// their own spawn point against a map twice as wide (wiki
// game/mechanics/empty-outbound-leg). 15/120=0.125, 40/120=1/3 reproduces
// today's 15-55 range exactly at half=120, and gives ~30-110 at the current
// half=240.
export const ROAM_STEP_FRAC = { min: 0.125, range: 1 / 3 };

// ---- Lighting --------------------------------------------------------------
// LUL-975: r155 dropped the `Math.PI` "artist-friendly" scaling factor that used to
// sit between a light's `intensity` and the render output. Every light intensity in
// forest-engine.js is multiplied by this to read the same as it did pre-r155 --
// see wiki systems/three-r185-upgrade.
export const LEGACY_LIGHT_SCALE = 5;

// LUL-40/LUL-382: hold KeyF for the mist veil -- these are the player-light
// intensity/distance pair tick() swaps between as the veil ramps in/out.
export const LIGHT_NORMAL = { intensity: 0.7, distance: 20 };
export const LIGHT_DIMMED = { intensity: 0.18, distance: 8 };

// LUL-382: how fast the mist visibly ramps (VEIL_RAMP) and how thick it gets
// at full ramp (MIST_VEIL_FOG) -- the veil charge/lock state machine itself
// lives in lib/game/veil.ts, not here.
export const VEIL_RAMP = 1.6;            // seconds for mist/detect-cut to ease fully in or out
export const MIST_VEIL_FOG = 0.34;       // ~3x the manual Mist slider's own max (0.11) -- deliberately overshoots it so the veil reads as a distinct world state

export const VIGNETTE_NORMAL = { inner: 45, outerAlpha: 0.60 };
export const VIGNETTE_DIMMED = { inner: 18, outerAlpha: 0.92 };

// ---- Tree canopy geometry --------------------------------------------------
// Feeds both the tree meshes AND lib/game/cover.ts's canopyRadiusAtEye() (movement
// collision) -- see forest-engine.js's own CANOPY_GEO assembly, which stays there.
export const CANOPY_R = 1.15;     // cone1Geo base radius, at its widest (near the ground)
export const CONE1_HEIGHT = 2.5;
export const CONE1_Y = 2.1;

// ---- Population counts ------------------------------------------------------
export const STAR = 700;          // starfield points
export const LW = 50;             // lake wisps
export const DUST = 350;          // ambient dust particles
export const BW = 26;             // baby beacon wisps
export const BSP = 70;            // win-burst particles
// LUL-2225: shrunk from 360 alongside the patch itself (BOG_OUTER_RADIUS
// 135 -> 45, lib/game/bog.ts) so tree density inside the small patch stays
// comparable to before, not "the same forest plus more trees" on a quarter
// as much ground. LUL-2328: value now lives at CONFIG.bogTrees -- see that
// property's comment.
//
// LUL-2225: reeds get their own budget, no longer CONFIG.coverProps -- they're
// placed only in the ring between BOG_INNER_RADIUS and BOG_OUTER_RADIUS
// (they ARE the boundary a player reads), which is a much smaller target
// area than the old 135-unit disc coverProps was tuned against. LUL-2328:
// value now lives at CONFIG.bogReeds.

// LUL-2328: boots a small, cheap world for QA/e2e specs that don't care about
// map scale -- full-map software-GL boots were measured at 3.5-9 GB and
// repeatedly OOM-killed the nightly QA host (epic LUL-2324). Reassigns this
// module's own shared CONFIG object -- the same mutable-property mechanism
// CONFIG.mapSize/CONFIG.trees already use at their real call sites
// (engine/forest-engine.js:225 `half = CONFIG.mapSize/2`, :1066 the forest
// tree loop) -- so every existing reader downstream (half/margin,
// TREE_CHUNKS_PER_AXIS, the cover/bog generator loops, minimap scaling)
// picks up the smaller values automatically, with no second code path per
// constant. Must run before `const half = CONFIG.mapSize / 2` (near the top
// of init()) -- every value here is read again after that point, never
// before it, so ordering this as the very first statement in init() is
// sufficient; see engine/forest-engine.js's qaWorld read site.
//
// LUL-2225's bog patch (BOG_CENTER {x:-40,z:80}, lib/game/bog.ts) is a fixed
// absolute position, not derived from CONFIG.mapSize -- at mapSize:96 its
// BOG_OUTER_RADIUS (45) would partially overlap the map's own edge, so
// bogTrees/bogReeds are zeroed explicitly rather than relying on geometry to
// exclude every candidate (which would instead spend each loop's full try
// budget rejecting points, wastefully but harmlessly). LANDMARKS/CAVE/
// CONFIG.lake are deliberately left untouched -- tuning.js's own LANDMARKS
// comment already documents they're placed unconditionally regardless of map
// size, so at this scale they simply sit at or past the map edge; not worth
// a special case for six fixed props.
//
// Idempotent: always assigns the same target values (never scales off the
// current value), so calling it more than once in one page life is safe.
export function applyQaWorldMicroPreset(){
  CONFIG.mapSize = 96;
  CONFIG.trees = 40;
  CONFIG.coverProps = 40;
  CONFIG.bogTrees = 0;
  CONFIG.bogReeds = 0;
  CONFIG.detectScaleMul = 0.2;   // LUL-2407: same 96/480 ratio the map itself shrinks by --
                                  // restores the full map's spawn-distance-to-detect-radius margin.
  CONFIG.speedScaleMul = 0.2;    // LUL-2422: same 96/480 ratio -- keeps a predator's crossing time
                                  // across the shrunk map proportional to the full map, so scripted
                                  // qaTeleportNear*/staged scenarios keep the same safety window.
}

// LUL-2247: flat centre-to-centre minimum spacing enforced between ANY two
// non-tree generated props (cover/reed/bogTree/stone), regardless of kind,
// as a post-filter over the finished map -- independent of and in addition
// to the tighter, kind-specific overlap checks each generator already runs
// at rng-draw time (overlapsTreeTrunk/overlapsTreeCanopy/overlapsExistingCover).
export const PROP_MIN_SPACING = 3.5;

// LUL-2247: per-60x60-chunk ceiling per prop category (same chunk grid as
// TREE_CHUNK_SIZE, forest-engine.js's treeChunkIndex()). 'cover' covers
// log/rock/bramble together (generateCover()'s non-reed, non-tree output);
// reed/bogTree/stone (== throwableData) are their own categories since each
// has its own generator and its own visual density expectation.
export const PROP_CHUNK_CAP = { cover: 12, reed: 24, bogTree: 12, stone: 3 };

// LUL-195: wind silently decides scent outcomes; the ambient dust drift is the
// only player-visible tell. Speed is tuned for legibility, not to match
// lib/game/scent.ts's own wind-driven scent math.
export const DUST_WIND_SPEED = 0.3;

export const WARM = 0xffd9b0;   // the child's warm glow color
// LUL-27: named so Fog Tide's "glow carries further" can scale it at runtime.
export const BABY_LIGHT_DISTANCE = 28;

// ---- Predators --------------------------------------------------------------
// `nose` (LUL-23): scent-pickup radius multiplier. The bear gets the strongest
// nose and the lion the weakest -- it hunts by stalking/sight -- so the three
// species stay differentiated across both detection channels, not just sight.
// `speed` below is a placeholder immediately overwritten (see RUN/CHASE_GAP) --
// forest-engine.js's own PSPEC[k].speed assignment loop is what actually sets it.
export const PSPEC = {
  wolf: { body:0x565b63, sz:1.0, len:1.6, h:0.9,  mane:false, ears:true,  speed:8.5, detect:42, eye:0xadd8e6, rad:0.8, budget:6, nose:1.0 },
  bear: { body:0x3d2c22, sz:1.8, len:2.0, h:1.45, mane:false, ears:false, speed:6.8, detect:30, eye:0xff5a2a, rad:1.5, budget:9, nose:1.4 },
  lion: { body:0xc79a5b, sz:1.2, len:1.7, h:1.0,  mane:true,  ears:true,  speed:9.2, detect:48, eye:0xffcf3a, rad:1.0, budget:4, nose:0.75 },
};
// LUL-1902: wolf-only nose-multiplier reduction while the player's bog-mask
// (lib/game/bog.ts bogMaskLevel()) is active. 0.7, not 1.0 -- the decision
// doc explicitly rejects a hard safe-room, so a wolf already close/fresh on
// the trail can still catch a masked scent, just at reduced range. Bears and
// lions are untouched -- see checkScent() in the engine.
export const WOLF_BOG_MASK_STRENGTH = 0.7;
// Size each animal's speed from its warning budget: from the moment it SEES you and you
// flee at top speed, the fastest (lion) still gives >=4s, the bear >=9s. All are faster
// than the player, so you can't simply outrun them -- hiding is the real escape.
// RUN itself is NOT exported here -- see the note at the top of this file.
export const CHASE_GAP = 28;

// LUL-2246: how long a force-hunt escalation (30s-no-contact -> straight for you) keeps
// chasing blind once it loses sight, via the existing scentLock leash (LUL-23) below --
// 25s at the bear's full species speed (13.9 u/s, the slowest of the three) covers 348u,
// enough to cross the 480x480 map once. Deliberately not tied to SCENT_TRACK_TIME (8s,
// lib/game/scent.ts) -- a force-hunt is a much stronger signal than a stale scent point.
export const FORCE_HUNT_LOCK = 25;

// LUL-26: difficulty presets. `night` is the existing tuning verbatim (every
// multiplier is a no-op) and stays default. `activePerSpecies` trims the roster
// without touching PSPEC itself; `detectMul` scales the sight-detect radius;
// `glowMul` scales the child's existing idle/carry glow values.
//
// LUL-1440: blackout's `detectMul` dropped 1 -> 0.7 (lantern's own value).
// Game Economist's hazard model (wiki game/economy/tier-reward-multipliers
// §3/§5, `decisions/economy-horizon-2026-09-03`) is `encounter rate proportional
// to active predators x detectMul^2` -- blackout shared night's exact
// activePerSpecies/detectMul (9-predator, full-radius hazard = night's 6.1x
// lantern) on top of a ~3.2x longer route and `startHunting`, and no reward
// multiplier can reach parity against that without breaking one-sitting pacing
// or opening a farm. 0.7^2 = 0.49, roughly halving the per-second lethality
// term of that product while route length (entangled with the LUL-1790
// farm-guard depth math, out of scope here) and activePerSpecies (the
// predator-count "swarm" identity) are left untouched. Thematically
// consistent too: blackout is the low-visibility tier, so predators seeing
// less far individually reads in-fiction, not just as a balance knob.
// activePerSpecies stays 3 and startHunting/minimap stay unchanged so
// blackout remains recognizably the hardest tier (still ~1.6x night's
// hazard-seconds by the same model, from the unchanged longer route alone).
export const DIFFICULTY_PRESETS = {
  lantern:  { activePerSpecies: 1, detectMul: 0.7, glowMul: 1.6, startHunting: false, minimap: true },
  night:    { activePerSpecies: 3, detectMul: 1,   glowMul: 1,   startHunting: false, minimap: true },
  blackout: { activePerSpecies: 3, detectMul: 0.7, glowMul: 1,   startHunting: true,  minimap: false },
};

// LUL-213: once a charge resolves (either way) the same predator can't
// immediately roll for another. Long enough to read as "that's over," short
// enough that a second charge later in the same chase is still in play.
export const CHARGE_COOLDOWN = 10;

// ---- Player feel -------------------------------------------------------------
export const SENS = 0.0022;   // mouse-look sensitivity base

// "always only when the user sees the target": the player's forward view cone
// a predator's charge telegraph must be inside to start. ~130deg total FOV --
// generous enough to not feel unfair, narrow enough that "behind you" really
// means behind you.
export const PLAYER_FOV_COS = Math.cos(65 * Math.PI/180);

// ---- Audio --------------------------------------------------------------------
export const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 987.77];   // twinkle() cue notes

// ---- Death cutscene -------------------------------------------------------------
export const CUT_END = 3.7;   // death video length; reveal the loss text at the end
