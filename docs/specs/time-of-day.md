# SPEC — LUL-1644: real-world time-of-day system (visual + audio)

Tier: **B** — `engine/**` visual/audio tuning constants + a new `lib/game/**` pure module.
Confirmed NOT Tier C: nothing here touches `DIFFICULTY_PRESETS`, `detectMul`, `glowMul`,
predator AI, hiding, scent, or win/lose logic (see Constraints).

Plan doc: issue LUL-1644 `plan` document. Research input (Ollama `--websearch`,
request id `lul1644-time-of-day-research`): dawn = pink/orange sky + birdsong + mist;
morning = golden light + birdsong/insects + long shadows; noon = bright white/blue +
cicadas + harsh shadows; afternoon = amber + cicadas + dappled light; evening =
orange-pink + crickets/owls + fireflies; night = deep blue/black + owls/wind. Used
below to ground the per-state color and ambient-layer choices — do not re-derive it.

## Design decision this spec makes (not the plan's)

**Time-of-day is a per-session snapshot, computed once from `new Date().getHours()`
when the engine module loads, not a live clock re-evaluated during play.** A play
session runs minutes, not hours, so a mid-session state change would never actually
happen in practice and isn't worth the transition-easing complexity it would demand.
This also makes the whole visual/audio surface trivial to keep deterministic for
tests (pure function of an hour, called once at one site). If the founder wants a
live-ticking cycle later, that is a new ticket, not a hidden add-on here.

## Files

1. **`lib/game/timeOfDay.ts`** — new pure module.
2. **`lib/game/timeOfDay.test.ts`** — new, `node --test`.
3. **`engine/forest-engine.js`** — edits only, at the exact line ranges below (line
   numbers as of commit `654146f`; if they've drifted, find the block by its content,
   not the number, and report the drift — do not guess).
4. **`docs/ELEMENTS.md`** — new "Time of day" subsection (placed after the existing
   "### Fog" section, i.e. after line 650 `---`), same doc-registry requirement as
   every element-affecting PR.

## 1. `lib/game/timeOfDay.ts` — exact content

```ts
// LUL-1644: real-world time-of-day -> in-game sky/lighting/audio state. Pure
// data + a pure hour->state function, no wall-clock read in this file (the
// engine reads new Date().getHours() at its own single call site so this
// module stays trivially unit-testable, same split as veil.ts/fogTide.ts).
//
// Snapshot, not a live clock: computed once per session at engine init (see
// engine/forest-engine.js), not re-evaluated during play. Sessions run
// minutes, not hours, so a mid-session transition would never actually be
// seen -- see docs/specs/time-of-day.md for the full reasoning.

export type TimeOfDayState =
  | 'night'
  | 'early-morning'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening';

interface Boundary { state: TimeOfDayState; startHour: number; }

// Ascending startHour; the LAST boundary whose startHour <= hour wins, so
// 'night' (startHour 0) is the fallback for the pre-dawn tail (0-3) and is
// re-entered at 20 for the post-dusk half of the day -- one state, two
// disjoint hour ranges, which is why it appears twice here.
const BOUNDARIES: Boundary[] = [
  { state: 'night', startHour: 0 },
  { state: 'early-morning', startHour: 4 },
  { state: 'morning', startHour: 6 },
  { state: 'noon', startHour: 11 },
  { state: 'afternoon', startHour: 14 },
  { state: 'evening', startHour: 17 },
  { state: 'night', startHour: 20 },
];

/** `hour` is 0-23 (or any real number; fractional/out-of-range values wrap). */
export function timeOfDayFromHour(hour: number): TimeOfDayState {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  let result: TimeOfDayState = 'night';
  for (const b of BOUNDARIES) if (h >= b.startHour) result = b.state;
  return result;
}

export interface TimeOfDaySkyConfig {
  /** 3-stop vertical gradient, top/mid/bottom, CSS hex strings (canvas 2D fillStyle). */
  skyTop: string; skyMid: string; skyBottom: string;
  fogColor: number;             // THREE.Color hex, scene.fog
  hemisphereSky: number; hemisphereGround: number; hemisphereIntensity: number;
  rimColor: number; rimIntensity: number;
  sunMoonColor: number;         // DirectionalLight + disc core color
  sunMoonHaloColor: number;     // disc halo (outer additive circle) color
  sunMoonIntensity: number;     // DirectionalLight intensity (pre LEGACY_LIGHT_SCALE)
  sunMoonHaloOpacity: number;   // halo circle material.opacity -- bigger/brighter reads as "sun" vs "moon"
  starOpacity: number;          // stars Points material.opacity, 0 in full daylight
}

export const TIME_OF_DAY_VISUALS: Record<TimeOfDayState, TimeOfDaySkyConfig> = {
  night: {
    skyTop: '#05070d', skyMid: '#080e18', skyBottom: '#0b1220',
    fogColor: 0x0b1220,
    hemisphereSky: 0x8fa8c8, hemisphereGround: 0x0a0d12, hemisphereIntensity: 0.55,
    rimColor: 0x24344f, rimIntensity: 0.4,
    sunMoonColor: 0xbcd0ff, sunMoonHaloColor: 0x9fb6ff, sunMoonIntensity: 0.5,
    sunMoonHaloOpacity: 0.30, starOpacity: 0.85,
  },
  'early-morning': {
    skyTop: '#0d1526', skyMid: '#3a2f42', skyBottom: '#c98a6b',
    fogColor: 0x2a2436,
    hemisphereSky: 0xffb37a, hemisphereGround: 0x1a1220, hemisphereIntensity: 0.5,
    rimColor: 0x5a3a2a, rimIntensity: 0.3,
    sunMoonColor: 0xffd9a0, sunMoonHaloColor: 0xffb066, sunMoonIntensity: 0.55,
    sunMoonHaloOpacity: 0.40, starOpacity: 0.25,
  },
  morning: {
    skyTop: '#3a6ea8', skyMid: '#a9c9e8', skyBottom: '#eef1d8',
    fogColor: 0xcdd7e0,
    hemisphereSky: 0xbcd4ff, hemisphereGround: 0x3a4a30, hemisphereIntensity: 0.85,
    rimColor: 0x7a8fae, rimIntensity: 0.35,
    sunMoonColor: 0xfff2c0, sunMoonHaloColor: 0xffe28a, sunMoonIntensity: 0.9,
    sunMoonHaloOpacity: 0.45, starOpacity: 0,
  },
  noon: {
    skyTop: '#2f6fd6', skyMid: '#7fb0f0', skyBottom: '#dff0ff',
    fogColor: 0xdfeaf5,
    hemisphereSky: 0xd8ecff, hemisphereGround: 0x445533, hemisphereIntensity: 1.0,
    rimColor: 0x9fc0e0, rimIntensity: 0.3,
    sunMoonColor: 0xffffff, sunMoonHaloColor: 0xfff6d8, sunMoonIntensity: 1.1,
    sunMoonHaloOpacity: 0.50, starOpacity: 0,
  },
  afternoon: {
    skyTop: '#3f6fae', skyMid: '#a9c3d8', skyBottom: '#f2d9a0',
    fogColor: 0xe8dcc0,
    hemisphereSky: 0xffe0b0, hemisphereGround: 0x3a3020, hemisphereIntensity: 0.85,
    rimColor: 0x8a6a44, rimIntensity: 0.35,
    sunMoonColor: 0xffdca0, sunMoonHaloColor: 0xffb060, sunMoonIntensity: 0.85,
    sunMoonHaloOpacity: 0.45, starOpacity: 0,
  },
  evening: {
    skyTop: '#182140', skyMid: '#5a3a52', skyBottom: '#e8815a',
    fogColor: 0x3a2a3a,
    hemisphereSky: 0xff9a6a, hemisphereGround: 0x140f1e, hemisphereIntensity: 0.6,
    rimColor: 0x4a2a3a, rimIntensity: 0.3,
    sunMoonColor: 0xffb37a, sunMoonHaloColor: 0xff7a4a, sunMoonIntensity: 0.6,
    sunMoonHaloOpacity: 0.40, starOpacity: 0.15,
  },
};

export interface TimeOfDayAudioConfig {
  windGainMul: number;     // multiplies startAudio()'s wind-bed gain (wg, base 0.06)
  droneGainMul: number;    // multiplies startAudio()'s ominous-drone gain (dg, base 0.05)
  birdsGain: number;       // 0 = no bird-chirp layer; else target chirp burst gain
  birdsChirpHz: number;    // average chirps/second when birdsGain > 0
  insectsGain: number;     // cicada/cricket bed gain, 0 = no layer
}

// night: every multiplier is 1 and every new-layer gain is 0 -- this state must
// be bit-for-bit identical to today's audio (the game's default/majority mood),
// zero regression risk for the common case.
export const TIME_OF_DAY_AUDIO: Record<TimeOfDayState, TimeOfDayAudioConfig> = {
  night:           { windGainMul: 1.0, droneGainMul: 1.0, birdsGain: 0,     birdsChirpHz: 0,    insectsGain: 0 },
  'early-morning': { windGainMul: 0.8, droneGainMul: 0.3,  birdsGain: 0.05, birdsChirpHz: 0.8,  insectsGain: 0.01 },
  morning:         { windGainMul: 0.7, droneGainMul: 0.15, birdsGain: 0.04, birdsChirpHz: 0.5,  insectsGain: 0.02 },
  noon:            { windGainMul: 0.6, droneGainMul: 0.08, birdsGain: 0.015,birdsChirpHz: 0.15, insectsGain: 0.03 },
  afternoon:       { windGainMul: 0.7, droneGainMul: 0.12, birdsGain: 0.02, birdsChirpHz: 0.25, insectsGain: 0.03 },
  evening:         { windGainMul: 0.9, droneGainMul: 0.5,  birdsGain: 0.015,birdsChirpHz: 0.15, insectsGain: 0.025 },
};
```

## 2. `lib/game/timeOfDay.test.ts` — exact content

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  timeOfDayFromHour,
  TIME_OF_DAY_VISUALS,
  TIME_OF_DAY_AUDIO,
  type TimeOfDayState,
} from './timeOfDay.ts';

const STATES: TimeOfDayState[] = ['night', 'early-morning', 'morning', 'noon', 'afternoon', 'evening'];

test('every boundary hour maps to the expected state', () => {
  assert.equal(timeOfDayFromHour(0), 'night');
  assert.equal(timeOfDayFromHour(3), 'night');
  assert.equal(timeOfDayFromHour(4), 'early-morning');
  assert.equal(timeOfDayFromHour(5), 'early-morning');
  assert.equal(timeOfDayFromHour(6), 'morning');
  assert.equal(timeOfDayFromHour(10), 'morning');
  assert.equal(timeOfDayFromHour(11), 'noon');
  assert.equal(timeOfDayFromHour(13), 'noon');
  assert.equal(timeOfDayFromHour(14), 'afternoon');
  assert.equal(timeOfDayFromHour(16), 'afternoon');
  assert.equal(timeOfDayFromHour(17), 'evening');
  assert.equal(timeOfDayFromHour(19), 'evening');
  assert.equal(timeOfDayFromHour(20), 'night');
  assert.equal(timeOfDayFromHour(23), 'night');
});

test('wraps out-of-range and fractional hours', () => {
  assert.equal(timeOfDayFromHour(24), 'night');   // wraps to 0
  assert.equal(timeOfDayFromHour(-1), 'night');   // wraps to 23
  assert.equal(timeOfDayFromHour(6.9), 'morning'); // floors, does not round up to 7's state (still morning anyway)
});

test('every state has a visual and an audio config with no missing fields', () => {
  for (const s of STATES) {
    assert.ok(TIME_OF_DAY_VISUALS[s], `missing visuals for ${s}`);
    assert.ok(TIME_OF_DAY_AUDIO[s], `missing audio for ${s}`);
  }
});

test('night audio is a true no-op (bit-for-bit today\'s behaviour)', () => {
  const a = TIME_OF_DAY_AUDIO.night;
  assert.equal(a.windGainMul, 1);
  assert.equal(a.droneGainMul, 1);
  assert.equal(a.birdsGain, 0);
  assert.equal(a.insectsGain, 0);
});

test('daylight states (noon/afternoon/morning) duck the drone below night\'s baseline', () => {
  for (const s of ['morning', 'noon', 'afternoon'] as const) {
    assert.ok(TIME_OF_DAY_AUDIO[s].droneGainMul < 1, `${s} should duck the ominous drone`);
  }
});

test('daylight states have zero star opacity; night and the dawn/dusk pair do not', () => {
  assert.equal(TIME_OF_DAY_VISUALS.noon.starOpacity, 0);
  assert.equal(TIME_OF_DAY_VISUALS.morning.starOpacity, 0);
  assert.equal(TIME_OF_DAY_VISUALS.afternoon.starOpacity, 0);
  assert.ok(TIME_OF_DAY_VISUALS.night.starOpacity > 0);
});
```

## 3. `engine/forest-engine.js` — exact edits

**3a. Import** — add to the existing fogTide import block (currently
`engine/forest-engine.js:111-123`, `} from '@/lib/game/fogTide';`). Add a new,
separate import statement immediately after that closing `}` line:

```js
import {
  timeOfDayFromHour,
  TIME_OF_DAY_VISUALS,
  TIME_OF_DAY_AUDIO,
} from '@/lib/game/timeOfDay';
```

**3b. Compute the session snapshot once** — insert immediately before the
`// ---- Scene / camera / renderer` comment (`engine/forest-engine.js:231`):

```js
// LUL-1644: time-of-day is a per-session snapshot of the player's real
// wall-clock hour at load, not a live clock during play -- see
// docs/specs/time-of-day.md for why. Consumed by the sky/lighting block
// below and by startAudio().
const timeOfDay = timeOfDayFromHour(new Date().getHours());
const TOD_VISUAL = TIME_OF_DAY_VISUALS[timeOfDay];
const TOD_AUDIO = TIME_OF_DAY_AUDIO[timeOfDay];
```

**3c. Fog color** — `engine/forest-engine.js:234`, change:
```js
scene.fog = new THREE.FogExp2(0x0b1220, CONFIG.fog);
```
to:
```js
scene.fog = new THREE.FogExp2(TOD_VISUAL.fogColor, CONFIG.fog);
```

**3d. Hemisphere/moon/rim lights** — `engine/forest-engine.js:280-282`, change:
```js
scene.add(new THREE.HemisphereLight(0x8fa8c8, 0x0a0d12, 0.55 * LEGACY_LIGHT_SCALE));
const moon = new THREE.DirectionalLight(0xbcd0ff, 0.5 * LEGACY_LIGHT_SCALE); moon.position.set(-6, 16, -4); scene.add(moon);
const rim = new THREE.DirectionalLight(0x24344f, 0.4 * LEGACY_LIGHT_SCALE); rim.position.set(4, 5, 9); scene.add(rim);
```
to:
```js
scene.add(new THREE.HemisphereLight(TOD_VISUAL.hemisphereSky, TOD_VISUAL.hemisphereGround, TOD_VISUAL.hemisphereIntensity * LEGACY_LIGHT_SCALE));
const moon = new THREE.DirectionalLight(TOD_VISUAL.sunMoonColor, TOD_VISUAL.sunMoonIntensity * LEGACY_LIGHT_SCALE); moon.position.set(-6, 16, -4); scene.add(moon);
const rim = new THREE.DirectionalLight(TOD_VISUAL.rimColor, TOD_VISUAL.rimIntensity * LEGACY_LIGHT_SCALE); rim.position.set(4, 5, 9); scene.add(rim);
```
Do **not** rename the `moon`/`moonGroup`/`moonDir`/`stars` identifiers even for
daylight states — they are file-local (grep confirms no external references),
renaming them only inflates the diff for no behavioural gain.

**3e. Sky gradient, star opacity, disc colors** — `engine/forest-engine.js:288-309`
is the `// ---- Night sky: ...` IIFE + star field + moon group. Replace the
hardcoded literals with `TOD_VISUAL` fields, keeping every other line (geometry,
counts, positions) unchanged:

- Gradient stops: `grd.addColorStop(0.0, '#05070d')` -> `grd.addColorStop(0.0, TOD_VISUAL.skyTop)`;
  `addColorStop(0.55, '#080e18')` -> `addColorStop(0.55, TOD_VISUAL.skyMid)`;
  `addColorStop(1.0, '#0b1220')` -> `addColorStop(1.0, TOD_VISUAL.skyBottom)`.
- Stars material: `opacity: 0.85` -> `opacity: TOD_VISUAL.starOpacity`.
- Moon group meshes (halo then core): `color: 0x9fb6ff, ... opacity: 0.30` ->
  `color: TOD_VISUAL.sunMoonHaloColor, ... opacity: TOD_VISUAL.sunMoonHaloOpacity`;
  `color: 0xeef3ff` (core disc) -> `color: TOD_VISUAL.sunMoonColor`.
- Update the block's own leading comment from `// ---- Night sky: ...` to
  `// ---- Sky: gradient backdrop, stars, sun/moon disc (per TOD_VISUAL); soft fill on the player ---`.

**3f. Audio** — inside `startAudio()` (`engine/forest-engine.js:1747-1790`):

- Wind gain init, currently `const wg = ctx.createGain(); wg.gain.value = 0.06;`
  (`:1766`) -> `wg.gain.value = 0.06 * TOD_AUDIO.windGainMul;`.
- Drone gain init, currently `const dg = ctx.createGain(); dg.gain.value = 0.05; ...`
  (`:1770`) -> `dg.gain.value = 0.05 * TOD_AUDIO.droneGainMul;`.
- Add an insect bed, modeled on the existing wind-bed pattern (`:1764-1767`),
  inserted right after that block: brown-noise-free (use `noise(ctx, 3, false)`,
  i.e. the non-brown/white variant already defined at `:1735`) through a
  bandpass filter centered ~4-6kHz (cicada/cricket register), looped, gain
  `TOD_AUDIO.insectsGain`:
  ```js
  // insect bed -- filtered noise loop, silent (gain 0) outside daylight/dusk states
  const insects = ctx.createBufferSource(); insects.buffer = noise(ctx, 3, false); insects.loop = true;
  const inf = ctx.createBiquadFilter(); inf.type = 'bandpass'; inf.frequency.value = 4800; inf.Q.value = 1.4;
  const ing = ctx.createGain(); ing.gain.value = TOD_AUDIO.insectsGain;
  insects.connect(inf); inf.connect(ing); ing.connect(master); ing.connect(conv); insects.start();
  ```
- Add a bird-chirp layer as a self-scheduling helper, defined at module scope
  (near `footstep()`/other one-shot helpers, e.g. right after `footstep()`
  around `:1806`) and started from `startAudio()` only when `TOD_AUDIO.birdsGain > 0`:
  ```js
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
  ```
  and at the end of `startAudio()`, after the existing `audio = { ... };` line
  (`:1789`): `if (TOD_AUDIO.birdsGain > 0) scheduleBirdChirp();`.
  `later()` is this file's existing setTimeout-wrapper helper already used
  elsewhere in the audio code (e.g. `:1936`) — reuse it, do not add a new timer
  mechanism.

## Constraints

- Do not touch `DIFFICULTY_PRESETS`, `detectMul`, `glowMul`, `effectiveDetect`,
  `canSee`, predator roster/AI, hiding, scent, or win/lose logic. Grep the diff
  for those identifiers before opening the PR — any hit is out of scope.
- Do not touch `lib/game/fogTide.ts`, `lib/game/veil.ts`, or `lib/game/eventScheduler.ts`
  — Fog Tide and the mist veil stack their own multipliers independently; this
  feature must not interact with them at all.
- `timeOfDayFromHour` and both config tables must have zero side effects and zero
  wall-clock reads — the one `new Date().getHours()` call lives only at the
  engine call site (3b).
- Mobile: this is ambient/visual/audio only, no new input or control surface —
  no `EngineActions` change needed, no touch affordance required. State this
  explicitly in the PR body per the mobile-parity directive (nothing to add on
  mobile because nothing here is interactive).
- `night`'s audio config must remain a true no-op (all multipliers 1, all new
  gains 0) — this is asserted by the test file above; do not change those five
  numbers without updating the test in the same commit.

## Out of scope

- Any live/ticking time-of-day transition during a single play session (see
  Design decision above) — future ticket if wanted.
- New audio/image asset files — everything here stays inside the existing
  synthesized-WebAudio and canvas-texture techniques already in the file.
- Any change to `DIFFICULTY_PRESETS`, gameplay difficulty, or detection math.
- Flying-bird visual models/animation (the ticket's "flying birds" mention) —
  the sound layer is in scope per the spec above; a visual bird mesh/flock is a
  separate, larger ticket (new geometry + animation, not a tuning constant) and
  is NOT part of this diff.
- Sun/moon disc *movement* across the sky during a session (arcing with time) —
  out of scope per the snapshot decision; the disc is positioned once, same as
  today's static moon.

## Verification

```bash
node --test lib/game/timeOfDay.test.ts
npx tsc --noEmit
npx next build
```
Passing = all three exit 0. `node --test` output must show the new test file
with 0 failures. No console errors on load is unverifiable in this environment
(no browser) — say so explicitly in the handoff per the "you assert code
correctness only" rule; visual/audio correctness needs a Game Tester or human
pass in a real browser.

Also run, since this diff adds a new top-level `startAudio()`-local
`scheduleBirdChirp` and touches `engine/forest-engine.js` broadly:
```bash
node scripts/check-elements-citations.mjs --fix
node scripts/check-duplicate-logic.mjs
```
(see AGENTS.md's "two guards that can fail 'unit tests' for reasons unrelated
to your diff" — `scheduleBirdChirp`/`TOD_VISUAL`/`TOD_AUDIO` are new engine-local
names, not `lib/game` exports, so `check-duplicate-logic.mjs` should not flag
them, but confirm rather than assume.)

## docs/ELEMENTS.md addition

Add a new subsection after the existing "### Fog" section (after its closing
`---` at line 651), before "### Follow-light...":

```markdown
### Time of day

**What it can do**
- Set the sky gradient, fog color, hemisphere/directional-light color and
  intensity, sun/moon disc color, and star-field opacity for the whole session,
  based on the player's real wall-clock hour at load
  (`timeOfDayFromHour()`, `lib/game/timeOfDay.ts`; applied once in
  `engine/forest-engine.js` before scene setup — see `docs/specs/time-of-day.md`).
- Set a per-state ambient audio profile in `startAudio()`: duck or restore the
  existing wind/drone beds, and add bird-chirp and insect layers for
  early-morning through evening states.
- Six states: `night`, `early-morning`, `morning`, `noon`, `afternoon`,
  `evening` — see `TIME_OF_DAY_VISUALS`/`TIME_OF_DAY_AUDIO` for exact values.

**What it CANNOT do**
- Does not change at all during a single play session — computed once at load
  from the real clock, not a live in-game cycle (unlike Fog Tide, below/above,
  which does tick during play).
- Has zero effect on predator detection, hiding, scent, or difficulty — purely
  atmospheric. `effectiveDetect()`/`DIFFICULTY_PRESETS` are untouched by this
  system.
- Does not add a flying-bird visual/mesh — audio only for birds; no new
  geometry.

**Behaviours & logic**
- Pure hour->state mapping and both config tables live in `lib/game/timeOfDay.ts`
  (unit tested, `lib/game/timeOfDay.test.ts`) with no wall-clock read inside
  that module — the engine reads `new Date().getHours()` at exactly one call
  site and passes the result in.

**Collision & physics profile**
- N/A — not a spatial object, has no position or collider.

---
```

## Handoff

Routing: Game Engineer implements per this spec (per the routing table's
"Design/multi-file/`engine/` simulation" row — Founding Engineer wrote the
spec, does not implement). Branch: `lul-1644-time-of-day`. PR body must state
`Tier: B — engine/forest-engine.js, lib/game/timeOfDay.ts`.
