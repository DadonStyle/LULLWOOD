# SPEC: extract tuning constants -> engine/tuning.js

**Ticket:** LUL-1340 (spec), implementing LUL-1065 · **Tier: C** — `engine/forest-engine.js`
is Tier C by path regardless of diff content (simulation file). Blocking review
(`REVIEW: APPROVED`) is required before merge, per the severity rubric. This spec author
confirms Tier C explicitly here, per the spec-architecture directive. No Game Tester play
verdict should be needed beyond the standard Tier C gate — this is a byte-for-byte value
move, not a design change — but the reviewer/tester decide that, not this spec.

**Written against:** branch `lul-1192-depth-cap` @ committed HEAD
`632fe995d6afdfd43c52b3e1046e387657ddec3d`. **Caveat, read before trusting any line number
below:** the working tree this spec was written from also had an *uncommitted*,
unrelated audio-unlock diff on top of that commit (LUL-1331/LUL-1112 — `startAudio()`
resume() fix, a `qaProbeAudio` hook, and a debug HUD overlay near `tick()`), which was
still present when the line numbers below were captured. If that diff lands as a commit
before this ticket is implemented, every citation at or after `startAudio()` (`:1727`
in this spec) will be off by roughly a dozen lines, growing to ~20+ past `tick()`. **Do
not trust these line numbers blindly — locate each symbol by name/content if the number
doesn't match what you see.** This is the same caveat the stamina spec
(`docs/specs/player-stamina.md`) states for the same reason; re-derive, don't copy forward.

## Sequencing — do not implement yet

**CTO directive (wiki `game/lul1065-tuning-extraction`):** the stamina cluster
(LUL-1113 / PR #255, LUL-1144, LUL-1188) is mid-flight on some of the exact same constants
this spec moves — `RUN = CONFIG.walk * 1.8` (`:974` below), `CONFIG.walk` itself, and the
sprint multiplier `STAMINA_SPRINT_MUL` PR #255 introduces in `lib/game/stamina.ts`. PR #255
was last observed as `REVIEW: CHANGES REQUESTED` (wiki `game/lul1113-stamina-review-changes-requested`,
2026-09-01) — **implementation of this spec must not start until PR #255 has merged to
`release/next`.** A full-file extraction landing on top of an in-review engine PR would
force a large, needless conflict resolution onto whoever re-approves #255. Check PR #255's
state before opening the Game Engineer implementation child; if it's still open, wait.

This spec itself (a doc, Tier A to write) is not blocked by that — writing it now conflicts
with nothing, per the CTO's own note.

## What this is

A **mechanical, value-preserving move**: pure numeric/color/table constants currently
declared at the top of `init()`'s closure in `engine/forest-engine.js` move to a new
`engine/tuning.js`, imported back via the existing `@/*` path alias (matching every other
import already in this file — see `:13-119`). **No value changes. No behaviour changes.**
If executing this spec produces a diff that changes what any constant evaluates to, or
changes *when* something is created (e.g. per-init() vs. module-singleton) in a way that is
externally observable, stop — that's a spec bug or an implementation mistake, not a
judgment call to make silently.

## Classification

The CTO's carve-out: **move** pure numeric/feel constants; **leave** anything
simulation-embedded (a constant whose value can't be relocated without also moving the
branch logic built around it). Below is every top-level, once-per-`init()` named constant
in the file, classified. Line numbers are current per the caveat above.

### MOVE — 27 named constants, `engine/tuning.js`

| Constant | Line | Section |
|---|---|---|
| `CONFIG` | `:157` | Knobs (14 fields: seed, mapSize, bogDepth, trees, walk, fog, eye, bg, trunk, foliage, ground, lake, home, carryPaceMul) |
| `LANDMARKS` | `:194` | Navigational landmarks |
| `LEGACY_LIGHT_SCALE` | `:275` | Lighting |
| `LIGHT_NORMAL`, `LIGHT_DIMMED` | `:316-317` | Lighting (mist veil light cut) |
| `VEIL_RAMP` | `:324` | Mist veil |
| `MIST_VEIL_FOG` | `:327` | Mist veil |
| `VIGNETTE_NORMAL`, `VIGNETTE_DIMMED` | `:349-350` | Vignette overlay |
| `CANOPY_R`, `CONE1_HEIGHT`, `CONE1_Y` | `:359-360` | Tree canopy geometry |
| `BOG_TREES` | `:410` | Population counts |
| `COVER_PROPS` | `:425` | Population counts |
| `STAR` | `:292` | Population counts (star particles) |
| `LW` | `:849` | Population counts (lake wisps) |
| `DUST_WIND_SPEED` | `:864` | Ambient dust |
| `DUST` | `:865` | Population counts (dust particles) |
| `WARM` | `:877` | Child glow color |
| `BABY_LIGHT_DISTANCE` | `:887` | Child glow |
| `BW` | `:893` | Population counts (beacon wisps) |
| `BSP` | `:924` | Population counts (win burst particles) |
| `PSPEC` | `:962` | Predator per-species table |
| `RUN`, `CHASE_GAP` | `:974` | Predator speed formula (RUN derived from CONFIG.walk — see Files section) |
| `DIFFICULTY_PRESETS` | `:983` | Difficulty tiers |
| `CHARGE_COOLDOWN` | `:1274` | Predator charge |
| `SENS` | `:1666` | Mouse look sensitivity |
| `SCALE` | `:1854` | Twinkle audio cue frequencies |
| `PLAYER_FOV_COS` | `:2110` | Player forward-view cone for charge telegraphs |
| `CUT_END` | `:2685` | Death cutscene length |

### STAY — named, with reason

| Constant | Line | Why it stays |
|---|---|---|
| `half`, `zMax` | `:173,179` | **Derived**, not literal (`CONFIG.mapSize/2`, `half + CONFIG.bogDepth`). Nothing to move — they're computed locally from the (now-imported) `CONFIG` at every collision/spawn/clamp call site across the file. |
| `margin` | `:174` | A bare literal (`4`), but every use is woven directly into the same clamp expressions as `half`/`zMax` (`half-margin`, `zMax-margin`, spawn/waypoint bounds). Splitting it into a different module than the derived values it's always paired with buys nothing and risks the two silently drifting apart later. Left together. |
| `CAMERA_FOV` | `:239` | Not a pure literal — `mode === 'mobile' ? 85 : 70` depends on the closure-local `mode` parameter of `init()`. Extracting it means inventing two new named constants (`CAMERA_FOV_DESKTOP`/`CAMERA_FOV_MOBILE`) and moving the ternary logic too — a small decomposition, not a pure move. Leave it; if `tuning.js` should own render-feel constants like this, that's a follow-up ticket with its own naming decision, not folded silently into a "no value changes" spec. |
| `CONE1_APEX_Y` | `:389` | Derived (`CONE1_Y + CONE1_HEIGHT/2`), not a literal. Stays as a local computed from the two imported constants. |
| `CANOPY_GEO` | `:394` | Derived object assembled from `CANOPY_R`/`CONE1_HEIGHT`/`CONE1_APEX_Y`. Stays, rebuilt from the imports. |
| `YAW_SPEED`, `PITCH_SPEED` | `:2964` | Not top-level — declared *inside* `tick()`, inside the mobile-only touch-look block, re-evaluated every animation frame. Outside this spec's "top-level, once-per-init()" scope by construction, and the existing comment at that line already flags them as still being live-tuned ("tuning call, tester+founder to confirm") — actively unsettled, not a stable value to relocate right now. |
| `resLevels`, `RES` (`:2887-2888`) | `:2887` | Not a pure literal — computed from `devicePixelRatio`, a browser global read at module-eval time, and immediately entangled with `renderer.setPixelRatio`/`WebGLRenderTarget` sizing in the same function. Moving the *expression* would mean exporting a function, not a constant — out of scope. |
| Bloom/tone-map uniform literals (`threshold: 0.60`, `bloomStrength: 0.85`, `exposure: 1.05`, `:2906-2908,2930`) | `:2906-2930` | Never hoisted to a named top-level constant in the current code — they're inline literals inside `THREE.ShaderMaterial` uniform objects. Naming them would be introducing new abstraction, not moving an existing one. Out of scope; a legitimate follow-up if `tuning.js` later wants to own render-feel knobs too. |
| `VS`, `FS_BRIGHT`, `FS_BLUR`, `FS_COMPOSITE` | `:2865-2885` | GLSL shader source strings — code, not numeric/feel constants. |

Everything else with a magic number in the file (the `20`/`30`/`46` thresholds in the
threat-metrics block around `:3159-3177`, `YAW_SPEED`/`PITCH_SPEED` above, per-branch
tuning inside `updatePredators()`, etc.) was never a standalone top-level named constant to
begin with — those are inline literals embedded in simulation branches, exactly the shape
the CTO's carve-out describes, and are not part of this move by construction (nothing
named to extract without also inventing a name and relocating the branch it lives in).

## Files

### 1. `engine/tuning.js` — new file

Plain `.js` (matching `forest-engine.js` itself, not `.ts` like `lib/game/*` — this is
engine-local presentation/feel data, not gameplay logic pulled out for unit testing). No
Three.js, no DOM, no imports at all — every value here is self-contained or derived only
from another constant in this same file.

Comment policy: **never delete an existing comment.** Where a constant has its own
dedicated explanatory comment (a block immediately above it that is specifically about
that constant), copy it verbatim into `tuning.js` alongside the constant. Do not also
delete it from `forest-engine.js` if the surrounding context there still reads naturally
without it — when in doubt, leave the original in place too and let it read as
slightly redundant rather than risk losing rationale. Trailing single-line comments that
are purely about the constant's own value move with no duplicate needed.

Full content, in the same order and grouping as the original file:

```js
// Pure numeric/feel constants extracted from engine/forest-engine.js (LUL-1065,
// docs/specs/tuning-extraction.md). Mechanical move -- values are unchanged from
// what forest-engine.js used to declare inline. No Three.js/DOM dependency.

// ---- Knobs ---------------------------------------------------------------
export const CONFIG = {
  seed:    20260718,   // QA-pinned reference layout only -- see resolveInitialSeed(); not the default in-play seed since LUL-83.
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

// LUL-25: four fixed navigational landmarks, "visible over the fog line" so
// the player can orient without the minimap (which stays scaled to the
// original 240x240 forest -- see w2m()/drawMinimap() in forest-engine.js).
// Fixed constants, not an rng draw, same treatment as CONFIG.lake/CONFIG.home.
// `cr` is the movement-collision radius (LUL-374) -- deliberately much
// smaller than `clear` (which only keeps trees/cover from generating too
// close to the landmark's nudge target).
export const LANDMARKS = [
  { kind: 'fireTower',   x: -95, z: -95, clear: 12, cr: 1.6 },
  { kind: 'stoneMarker', x: 100, z: -75, clear: 9,  cr: 1.1 },
  { kind: 'oak',         x: -65, z: 135, clear: 10, cr: 1.3 },
  { kind: 'drownedCar',  x: 55,  z: 205, clear: 11, cr: 2.3 },
];

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
export const BOG_TREES = 90;
export const COVER_PROPS = 220;

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
// Size each animal's speed from its warning budget: from the moment it SEES you and you
// flee at top speed, the fastest (lion) still gives >=4s, the bear >=9s. All are faster
// than the player, so you can't simply outrun them -- hiding is the real escape.
export const RUN = CONFIG.walk * 1.8;
export const CHASE_GAP = 28;

// LUL-26: difficulty presets. `night` is the existing tuning verbatim (every
// multiplier is a no-op) and stays default. `activePerSpecies` trims the roster
// without touching PSPEC itself; `detectMul` scales the sight-detect radius;
// `glowMul` scales the child's existing idle/carry glow values.
export const DIFFICULTY_PRESETS = {
  lantern:  { activePerSpecies: 1, detectMul: 0.7, glowMul: 1.6, startHunting: false, minimap: true },
  night:    { activePerSpecies: 3, detectMul: 1,   glowMul: 1,   startHunting: false, minimap: true },
  blackout: { activePerSpecies: 3, detectMul: 1,   glowMul: 1,   startHunting: true,  minimap: false },
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
```

### 2. `engine/forest-engine.js` — edit

**Import** — add one new import alongside the existing `@/lib/game/...` block (after the
`fogTide` import ending `:119`, before `THREE.ColorManagement.enabled = false;` at `:129`):

```js
import {
  CONFIG, LANDMARKS, LEGACY_LIGHT_SCALE, LIGHT_NORMAL, LIGHT_DIMMED, VEIL_RAMP,
  MIST_VEIL_FOG, VIGNETTE_NORMAL, VIGNETTE_DIMMED, CANOPY_R, CONE1_HEIGHT, CONE1_Y,
  STAR, LW, DUST, BW, BSP, BOG_TREES, COVER_PROPS, DUST_WIND_SPEED, WARM,
  BABY_LIGHT_DISTANCE, PSPEC as PSPEC_BASE, RUN, CHASE_GAP, DIFFICULTY_PRESETS,
  CHARGE_COOLDOWN, SENS, SCALE, PLAYER_FOV_COS, CUT_END,
} from '@/engine/tuning';
```

`PSPEC` is aliased on import — see the clone note below for why.

**Delete** every one of the 27 `const`/multi-`const` declaration lines listed in the MOVE
table above from inside `init()`'s body (`:157-172` CONFIG object, `:194-199` LANDMARKS,
`:239`†, `:275`, `:292`†, `:316-317`, `:324`, `:327`, `:349-350`, `:359-360`, `:410`,
`:425`, `:849`†, `:864-865`, `:877`, `:887`, `:893`†, `:924`†, `:962-970` PSPEC, `:974`,
`:983-987`, `:1274`, `:1666`, `:1854`, `:2110`, `:2685`). († = these lines also declare a
derived array alongside the constant, e.g. `const STAR = 700, starArr = new
Float32Array(STAR*3);` — only the constant itself (`STAR`) moves; keep `starArr = new
Float32Array(STAR*3)` as its own local `const` line, now reading the imported `STAR`.
Same pattern for `LW`/`lwArr`, `DUST`/`dustArr`, `BW`/`bwArr`, `BSP`/`bspArr,bspVel`,
`CANOPY_R`'s neighbors are unaffected since they don't share a line.)

**`PSPEC` clone** — this is the one non-trivial edit. `forest-engine.js:974-975` currently
mutates `PSPEC` in place every `init()` call:

```js
const RUN = CONFIG.walk * 1.8, CHASE_GAP = 28;
for(const k in PSPEC) PSPEC[k].speed = RUN + CHASE_GAP / PSPEC[k].budget;
```

Before this move, `PSPEC` was a fresh object literal created inside `init()`, so this
mutation only ever touched that call's own private copy. After the move, the imported
`PSPEC_BASE` binding is a **module-level singleton** shared across every `init()` call
(e.g. React StrictMode's dev-only double-invoke, or a mode switch that calls
`dispose()`/`init()` again) — mutating it in place would leak one call's write into the
next. The mutation itself is idempotent (same `RUN`/`CHASE_GAP`/`budget` every time, so it
would happen to produce the same result even shared), but do not rely on that — rebuild a
fresh local copy every `init()` call so the behavior is identical to before, not just
coincidentally equivalent:

```js
const PSPEC = Object.fromEntries(Object.entries(PSPEC_BASE).map(([k, v]) => [k, { ...v }]));
for(const k in PSPEC) PSPEC[k].speed = RUN + CHASE_GAP / PSPEC[k].budget;
```

Place this immediately where the old `:962-975` block was. `RUN`/`CHASE_GAP` themselves
come straight from the import — do not redeclare them locally.

**Leave in place, unedited** (per the STAY table): `half`, `margin`, `zMax` (`:173-174,179`,
now computed from the imported `CONFIG`), `CAMERA_FOV` (`:239`), `CONE1_APEX_Y` (`:389`,
now computed from imported `CONE1_Y`/`CONE1_HEIGHT`), `CANOPY_GEO` (`:394`, now assembled
from imported `CANOPY_R`/`CONE1_HEIGHT` + local `CONE1_APEX_Y`), `YAW_SPEED`/`PITCH_SPEED`
(`:2964`), `resLevels`/`RES` (`:2887-2888`), the bloom/tone-map uniform literals
(`:2906-2930`), and the `VS`/`FS_BRIGHT`/`FS_BLUR`/`FS_COMPOSITE` shader strings
(`:2865-2885`).

**Every other reference to a moved constant stays exactly as it is written today**
(`CONFIG.walk`, `PSPEC[kind]`, `DIFFICULTY_PRESETS[difficulty]`, `LIGHT_DIMMED`, etc.) —
only the declaration site moves; every read site is unchanged, since the imported binding
has the same name as the old local one.

### 3. No other files change

`engine/forest-engine.d.ts` declares the `window.ForestEngine` QA surface, not the tuning
values — nothing in this move touches it. No `components/*.tsx` file reads these constants
directly (they only ever reach React via `pushState()`/`emitState()`), so nothing there
changes either.

## Verification

```
npx tsc --noEmit && npm run lint && npm run build
```

All three clean — `tuning.js` is plain JS but `allowJs` + `strict` in `tsconfig.json`
still typechecks it, and Next's build will bundle it like any other module under `@/*`.

```
npx playwright test
```

The full smoke suite (same command as `.github/workflows/version-cut.yml`'s "playwright
smoke suite" step — this repo's Tier-A/B gate per the review-tiers directive, and the
closest thing to an end-to-end behavioral check this file has). **Pass condition: every
spec green, identically to a run against the pre-move `forest-engine.js`.** This is a value
move — if any spec's assertions shift (predator speed, detect range, veil timing, hide
sound, minimap, death-video timing, anything), that means a value or a mutation-timing
detail changed during the move and the diff is wrong, not the test.

`npm run test` (the `node --test` unit suite) is unaffected by this move — it exercises
`lib/game/*.ts`, none of which import from `engine/tuning.js` — but run it anyway as a
cheap sanity check that nothing else broke.

## Constraints

- **Pure move. No value changes, no behaviour changes.** Every constant's value in
  `tuning.js` must be byte-identical to what it replaced in `forest-engine.js`.
- **Tier C.** Needs `REVIEW: APPROVED` before merge per the severity rubric — this file
  touches `engine/forest-engine.js`'s simulation setup, which is Tier C by path regardless
  of the diff being value-preserving.
- **Do not implement before PR #255 (LUL-1113 stamina) merges to `release/next`.** See
  Sequencing above.
- **The `PSPEC` clone-per-`init()` pattern is required, not optional** — see the dedicated
  note above. Do not simplify it to a direct mutation of the imported binding.
- **Comment policy:** never delete an existing comment; prefer duplicating a constant's
  own rationale into `tuning.js` over losing it. See the Files section's comment policy.
- Every constant in the MOVE table keeps its exact original name on both sides of the
  import (no renaming), except `PSPEC` which is imported as `PSPEC_BASE` specifically so
  the local, cloned, mutated working copy can still be called `PSPEC` everywhere the rest
  of the file already references it.

## Out of scope

- Any of the STAY-table items. Do not "finish the job" by inventing new constant names for
  `CAMERA_FOV`, the bloom uniforms, or anything else flagged as a decomposition rather than
  a pure move — each is a separate, smaller ticket if wanted.
- Retuning any value. If a number looks wrong while doing this (e.g. a stale comment,
  a value that seems off), do not fix it here — file it separately and leave the value
  exactly as found.
- `lib/game/*.ts` — none of those modules' own constants (`VEIL_DETECT_MUL`,
  `SCENT_LIFETIME`, `FLANK_RECOMPUTE`, etc.) are touched or moved. This ticket is scoped to
  `engine/forest-engine.js` only, per LUL-1065.
- The magic-number literals embedded inside `tick()`/`updatePredators()`/branch logic
  (threat-metric thresholds, animation easing rates, etc.) — never named top-level
  constants to begin with, and extracting them would require inventing names and
  relocating branch logic, which is a different and much larger ticket.
