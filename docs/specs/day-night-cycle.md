# SPEC — LUL-1709: Day/Night Cycle, Phase 1 (engine pacing layer)

Tier: **C** — touches `engine/forest-engine.js` predator-detection simulation
(`effectiveDetect`/`canSee`). `REVIEW: APPROVED` required before merge. No QA
play-verdict required while Game Tester is paused (AGENTS.md, 2026-09-04).

Plan doc: issue LUL-1709 `plan` document (CTO, 2026-09-06) — read it for the full
reasoning; this spec only restates what an executor needs, plus current line numbers
re-verified against the repo **after** LUL-1644 (PRs #352/#355) merged, which shifted
every line the plan cited by ~150-200 lines and renamed the anonymous `HemisphereLight`
setup around `TOD_VISUAL`. All line numbers below are current as of this spec's
writing (commit at HEAD of `release/next`, 2026-09-06). If they've drifted further,
find the block by its content/comment, not the number, and report the drift — do not
guess.

Scope is the ticket's MVP list only: `timeOfRun` 0→1 over 2 minutes, fog density ramp,
ambient-light ramp, predator detect-radius ramp, plain-text HUD clock. Out of scope:
color grading, pack-tactic changes, difficulty retuning, moon/rim lights, a distinct
hunt-entry-threshold constant, economy/psychology tuning (Phase 2, LUL-1710/LUL-1711,
already filed blocked-on-this).

**Naming: use `timeOfRun`/`TIME_OF_RUN_*` throughout. Never `TOD_*`/`timeOfDay*`** —
that prefix is LUL-1644's separate, unrelated static per-session snapshot system
(`lib/game/timeOfDay.ts`, `TOD_VISUAL`/`TOD_AUDIO` in this same file). The two systems
must stay visually distinct in the diff and must not collide on identifiers. LUL-1644
is a *snapshot computed once at load*; `timeOfRun` here is a *live value that changes
every frame during play*. They compose (this spec's ramps are additive/multiplicative
on top of whatever `TOD_VISUAL` baseline the session snapshot picked), not replace.

## Files

1. **`engine/forest-engine.js`** — edits only, at the exact locations below.
2. **`components/Hud.tsx`** — edits only, at the exact locations below.
3. **`docs/ELEMENTS.md`** — update the existing "Fog" and predator-detection
   sections to note the new `timeOfRun` term (Founding Engineer does this in the same
   PR per AGENTS.md's element-registry rule — Game Engineer: leave a `TODO(FE):
   ELEMENTS.md` comment in the PR description if you reach this file first, do not
   guess at its structure).

## 1. New module-scope state — `engine/forest-engine.js`

Add immediately after the existing `fogTideClock` declaration line (currently
`let fogTideClock = 0, fogTideAmount = 0, fogTideBuild = 0, fogTideActive = false;`,
found by searching for that exact string — this line sits right after the `fogBase`
declaration, itself right after the mode-setup block):

```js
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
```

Do not use `let` for `TIME_OF_RUN_DURATION_S`/`TIME_OF_RUN_FOG_DELTA` — they are
constants, matching the file's existing convention (e.g. `FOG_TIDE_CONFIG`, `VEIL_RAMP`
imported as `const`).

## 2. Advance and reset the clock — `tick()` and `enter()`

In `tick()`, immediately after the existing line
`const playing = isPlaying(runState()) && !paused;`, add:

```js
  if(playing) runElapsed += dt;
  timeOfRun = clamp(runElapsed / TIME_OF_RUN_DURATION_S, 0, 1);
```

This must run **before** the fog-density write later in the same `tick()` (the line
`scene.fog.density = veilFogDensity(...)`, see §3) since that line consumes
`timeOfRun`. Placing it right after `playing` is computed satisfies that ordering
and mirrors where the veil/fogTide blocks already sit relative to `playing`.

In `enter()`, immediately after the existing line `enteredAt = clock.elapsedTime;`,
add:

```js
  runElapsed = 0;
```

`enter()` is called both by the initial gate click and at the end of `restart()`
(`restart()` calls `enter()` as its last line), so this one reset point covers both
a fresh session and a run-over restart — do not add a second reset in `restart()`
itself.

## 3. Fog density — one-line edit to the existing writer

Find the existing line (inside `tick()`):

```js
  scene.fog.density = veilFogDensity(fogBase, MIST_VEIL_FOG, veilAmount) + fogTideFogBoost(fogTideAmount);
```

Change to:

```js
  scene.fog.density = veilFogDensity(fogBase, MIST_VEIL_FOG, veilAmount) + fogTideFogBoost(fogTideAmount) + timeOfRun * TIME_OF_RUN_FOG_DELTA;
```

Do not add a second writer anywhere else — `scene.fog.density` has exactly one
writer today (LUL-382) and this must stay true.

## 4. Ambient light — name the light, then ramp it

Find the existing line (inside `init()`, in the "Scene / camera / renderer" section):

```js
scene.add(new THREE.HemisphereLight(TOD_VISUAL.hemisphereSky, TOD_VISUAL.hemisphereGround, TOD_VISUAL.hemisphereIntensity * LEGACY_LIGHT_SCALE));
```

Change to:

```js
const HEMI_BASE_INTENSITY = TOD_VISUAL.hemisphereIntensity * LEGACY_LIGHT_SCALE;
const hemiLight = new THREE.HemisphereLight(TOD_VISUAL.hemisphereSky, TOD_VISUAL.hemisphereGround, HEMI_BASE_INTENSITY);
scene.add(hemiLight);
```

Do **not** touch the two lines immediately after it (`moon`/`rim` DirectionalLights)
— out of scope for this ticket.

Then, in `tick()`, in the same place you added the fog-density edit in §3 (same
line or immediately adjacent), add:

```js
  hemiLight.intensity = HEMI_BASE_INTENSITY * (1 - timeOfRun * 0.7);
```

This ramps ambient light from 1.0× at dawn (`timeOfRun = 0`) to 0.3× at full night
(`timeOfRun = 1`), composing multiplicatively on top of whichever `TOD_VISUAL`
session snapshot is active — a session that loaded at night starts already dim and
gets dimmer; one that loaded at noon starts bright and fades. This is intentional
composition between the two systems, not a bug.

## 5. Predator detect radius — two call sites, same pattern

Find the two existing lines:

```js
function effectiveDetect(p){
  return geoEffectiveDetect(p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmount), { hidden, hideTime, carrying });
}
function canSee(p, dist){
  return geoCanSee(dist, p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmount), { hidden, hideTime, carrying }, p.x, p.z, player.x, player.z, coverGrid);
}
```

Change the shared multiplier expression in **both** to add one more factor,
`(1 + timeOfRun * 0.3)`:

```js
function effectiveDetect(p){
  return geoEffectiveDetect(p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmount) * (1 + timeOfRun * 0.3), { hidden, hideTime, carrying });
}
function canSee(p, dist){
  return geoCanSee(dist, p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmount) * (1 + timeOfRun * 0.3), { hidden, hideTime, carrying }, p.x, p.z, player.x, player.z, coverGrid);
}
```

This is the entire predator-behavior change for this ticket. `spotOnto()` (the
roam/investigate → chase transition) is gated entirely through `canSee()`, so this
one multiplier is sufficient to make "predators hunt harder" as the run progresses.
**Do not add a separate hunt-entry-threshold constant** — that idea (hunt mode
10-15s earlier at dusk) is out of scope; the ticket caps this pass at "tune existing
states via time-based multipliers only." Do not touch `DIFFICULTY_PRESETS` or
`difficulty` — that is LUL-26's separate, unrelated axis; it composes multiplicatively
with `(1 + timeOfRun * 0.3)`, the two must not be conflated.

## 6. HUD clock — plain text, no new UI chrome

### 6a. `engine/forest-engine.js` — format and push the clock string

Add a small pure formatting function near the other formatting helpers in the file
(or directly above `tick()` — either is fine, executor's call, just keep it out of
the hot per-frame path itself):

```js
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
```

In `tick()`, find the existing line:

```js
  pushState({ veilCharge: Math.round(veilCharge * 100) / 100, veilLocked, staminaCharge: Math.round(staminaCharge * 100) / 100 });
```

Change to:

```js
  pushState({ veilCharge: Math.round(veilCharge * 100) / 100, veilLocked, staminaCharge: Math.round(staminaCharge * 100) / 100, timeOfRunClock: formatTimeOfRunClock(timeOfRun) });
```

This matches the existing convention on this exact line: numeric per-frame values
(`veilCharge`, `staminaCharge`) are already pushed every tick with no throttling, so
pushing the clock string alongside them is consistent, not a new pattern.

### 6b. `components/Hud.tsx` — new field + render

In `EngineHudState` (the interface starting `export interface EngineHudState {`),
add one field. Insert it next to `fog: number;` since both are engine-driven
environment readouts:

```ts
  fog: number;
  // LUL-1709: live time-of-run pacing clock, plain "h:mm AM/PM" text -- ticks from
  // dawn to full night over the run. Engine-driven like pace/fog above.
  timeOfRunClock: string;
```

In `INITIAL_HUD_STATE`, add the matching default next to `fog: 0.04,`:

```ts
  fog: 0.04,
  timeOfRunClock: '6:00 AM',
```

In the JSX, inside the existing `<div id="panel">` block, find the stamina readout:

```tsx
        <span id="staminaState">
          Stamina: {Math.round(state.staminaCharge * 100)}%
        </span>
```

Add a new span immediately after it (same panel, same visual tier — this is the
"clock fits in same HUD zone as stamina bar" requirement from the ticket, and since
`#panel` renders unconditionally for both `MobileControls` and `DesktopControls`
branches above it, this satisfies mobile parity with no separate mobile-specific
work needed):

```tsx
        {/* LUL-1709: plain-text day/night pacing clock, ticks from dawn to night
            over the run. Read-only readout, same one-directional engine->HUD
            pattern as lightState/veilState/staminaState above it. */}
        <span id="timeOfRunClock">Time: {state.timeOfRunClock}</span>
```

## Constraints

- No new predator state machine — §5's multiplier on existing states only.
- Do not add a hunt-entry-threshold constant.
- Do not touch `moon`/`rim` DirectionalLights.
- Do not touch `DIFFICULTY_PRESETS`/`difficulty`.
- `scene.fog.density` keeps exactly one writer (the line edited in §3).
- No mobile-specific code path — `#panel` already renders on both platforms
  identically, so no `EngineActions`/touch-affordance work applies (this feature is
  passive/visual+AI-tuning, not an input the player triggers).
- Pure `TIME_OF_RUN_DURATION_S`/`TIME_OF_RUN_FOG_DELTA` constants, no magic numbers
  duplicated at each call site.

## Out of scope

Color grading, pack-tactic retuning, difficulty retuning, moon/rim lights, a distinct
hunt-entry-threshold constant, Phase 2 economy (LUL-1710) / psychology (LUL-1711)
tuning.

## Verification

1. `cd` to the repo root, then:
   ```
   npx tsc --noEmit
   npx eslint .
   npx next build
   ```
   All three must pass clean. No console errors on load is unverifiable without a
   browser in this environment — say so explicitly in the handoff rather than
   implying it works because it compiles.
2. `node scripts/check-elements-citations.mjs --fix` after the `docs/ELEMENTS.md`
   edit, to keep citation line numbers correct (see AGENTS.md's "unit tests" CI
   guard note — this script runs in CI under the same check name as `npm test`).
3. `node scripts/check-duplicate-logic.mjs` — this diff adds no new
   `lib/game/*.ts` exports, so it should be a no-op, but confirm it stays green
   (new top-level `const`/`function` declared in `engine/forest-engine.js` in this
   diff: `TIME_OF_RUN_DURATION_S`, `TIME_OF_RUN_FOG_DELTA`, `runElapsed`, `timeOfRun`,
   `HEMI_BASE_INTENSITY`, `hemiLight`, `TIME_OF_RUN_CLOCK_START_MIN`,
   `TIME_OF_RUN_CLOCK_END_MIN`, `formatTimeOfRunClock` — none of these names exist
   in any `lib/game/*.ts` module today; if CI flags a collision anyway, that means a
   name changed upstream since this spec was written — rename, don't allowlist).
4. Manual read-through: confirm `timeOfRun` is declared once at module scope (not
   re-declared inside `tick()`), and that `runElapsed`/`timeOfRun` are reset to 0 in
   `enter()` (not left stale across restarts, which would make every run after the
   first start already partway into the night ramp).

Gameplay/visual correctness (whether the ramp *feels* right, whether the clock label
is legible against the HUD, whether predators actually feel harder to evade at
night) is **unverified** — that is Player Psychologist's Phase-2 territory
(LUL-1711) and, per AGENTS.md, requires the founder/tester to confirm, not asserted
by a clean build.
