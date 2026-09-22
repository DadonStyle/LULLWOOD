# SPEC: LUL-3149 Wind-Assisted Evasion

**Ticket:** LUL-3149 · **Tier:** C — engine simulation formula change to core movement speed
and noise-detection radius (both chase/evasion-balance-critical), spans
`engine/forest-engine.js` + `lib/game/stamina.ts` + `lib/game/noise.ts` +
`components/Hud.tsx`. Needs `REVIEW: APPROVED` (Code Reviewer) before merge.

**Written against:** `release/next` @ `76f645d` (2026-09-22). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

## Drift from the CTO's 2026-09-18 PLAN comment — read this first

The PLAN (posted 2026-09-18T06:37) assumed `movingAgainstWind` did not exist yet. It shipped
in the meantime as **LUL-3009 "Threat Beacon"** (merged before this SPEC was written). Three
consequences:

1. `movingAgainstWind` is already computed every frame (`engine/forest-engine.js:6611`,
   inside `stepFrame()`'s movement block) and already pushed to `EngineHudState`
   (`engine/forest-engine.js:6636`, `components/Hud.tsx:145`). **Do not recreate it.** This
   SPEC reuses the existing variable.
2. `#windIndicator` already pulses (`windIndicatorActive` class, `components/Hud.tsx:994`)
   whenever `movingAgainstWind` is true, at *any* speed — because LUL-3009 also ships a
   real, always-on gameplay effect on the same trigger: `WIND_AGAINST_RADIUS_MULTIPLIER`
   (`lib/game/scent.ts:116`, 0.8× scent-detection radius) applied in `depositScent()`
   (`engine/forest-engine.js:2318-2320`), unconditional on `running`. **This SPEC does not
   touch scent** — it adds two *new* effects (speed, noise) that only apply while
   `running && movingAgainstWind`, stacking on top of the always-on scent effect. The
   existing pulse is reused unchanged as this feature's visual tell too (see `## Cues`) —
   it already means "the wind is currently working for you"; sprinting into it just adds
   more to that same true statement.
3. The PLAN's companion `[QA-HOOK] qaProbePlayer() -> sprintWindBonusActive` ticket is
   **not needed**. `qaProbeWind()` (`engine/forest-engine.js:4313`,
   `engine/forest-engine.d.ts:201`) already exposes `movingAgainstWind` live, and the
   verification approach below (displacement-delta + a real staged wolf) doesn't need a
   speed/noise-specific probe. Do not file it.

## Files

- `lib/game/stamina.ts` — edited: add `WIND_ASSIST_SPEED_MUL`.
- `lib/game/noise.ts` — edited: add `NOISE_RADIUS_RUN_WIND`.
- `engine/forest-engine.js` — edited: apply both multipliers gated on `running &&
  movingAgainstWind`; dedup the double `isMovingAgainstWind()` call; add one `HINT_PRIORITY`
  entry + a rising/falling-edge audio cue pair; update `#windIndicatorHint` copy.
- `engine/forest-engine.d.ts` — edited: no signature changes (no new hooks — see drift note
  above), but the `qaProbeWind` doc comment at `:196-201` should gain one line noting the two
  new consumers of `movingAgainstWind`.
- `components/Hud.tsx` — edited: both wind-related copy strings live here, not the engine
  (corrects the earlier assumption in `## Drift`-adjacent planning — verified directly against
  `release/next` for this SPEC, see `## The change` §6).
- `docs/ELEMENTS.md` — edited: extend the existing `### LUL-3009: Threat Beacon` section
  (`:2460`) rather than adding a new heading — same trigger, same element, additive effects.
- `e2e/wind-assisted-evasion.spec.ts` — created.
- `shared/local-qa/requests/lul-3149-wind-assisted-evasion.md` — created by the
  implementation PR, not this SPEC PR (needs a real merged commit sha per every other
  request file's front matter — see `## e2e` below).

## The change

### 1. `lib/game/stamina.ts` — new constant

Next to `STAMINA_SPRINT_MUL` (`lib/game/stamina.ts:15`):

```ts
// Wind-Assisted Evasion (LUL-3149): flat bonus on top of sprintSpeedMul() while sprinting
// directly against the wind (isMovingAgainstWind(), lib/game/scent.ts:121) -- stacks
// multiplicatively with the stamina-charge-scaled sprint multiplier, same shape
// bogSpeedMultiplier/lakeSpeedMultiplier already stack at the call site
// (engine/forest-engine.js:6593). CEO-accepted magnitude (LUL-3034 proposal): +20%.
export const WIND_ASSIST_SPEED_MUL = 1.2;
```

### 2. `lib/game/noise.ts` — new constant

Next to `NOISE_RADIUS_RUN` (`lib/game/noise.ts:18`):

```ts
/** Wind-Assisted Evasion (LUL-3149): footstep radius while sprinting directly against the
 * wind -- quieter than a normal sprint because the wind carries the sound away from
 * whatever's behind you, same "against the wind" trigger Threat Beacon's scent multiplier
 * (WIND_AGAINST_RADIUS_MULTIPLIER, lib/game/scent.ts:116) uses. CEO-accepted magnitude
 * (LUL-3051 proposal): -30%, i.e. 0.7 * NOISE_RADIUS_RUN = 16.8. */
export const NOISE_RADIUS_RUN_WIND = NOISE_RADIUS_RUN * 0.7;
```

### 3. `engine/forest-engine.js` — apply both multipliers, dedup the wind check

Imports (`engine/forest-engine.js:88`, `:128`):

```js
import { isNoiseHeard, NOISE_RADIUS_WALK, NOISE_RADIUS_RUN, NOISE_RADIUS_RUN_WIND, checkThrowableNoise, THROWABLE_NOISE_RADIUS, CRY_NOISE_RADIUS, CARRIED_NOISE_FLOOR, HIDE_ALERT_RADIUS, COVER_RUSTLE_THRESHOLD_S, COVER_RUSTLE_INTERVAL_S } from '@/lib/game/noise';
...
import { stepStamina, sprintSpeedMul, STAMINA_SPRINT_MUL, WIND_ASSIST_SPEED_MUL } from '@/lib/game/stamina';
```

Movement block (`engine/forest-engine.js:6588-6630`), current shape:

```js
const maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) * (carrying ? CONFIG.carryPaceMul : 1) * bogSpeedMultiplier(playerBogginess) * lakeSpeedMultiplier(playerInLake);
let ix = 0, iz = 0;
... // :6594-6603, unchanged
let mvx = fx*iz + rx*ix, mvz = fz*iz + rz*ix;
const mag = Math.hypot(mvx, mvz);
if(mag > 0){
  mvx /= mag; mvz /= mag; spd = maxSpd;
  escX = mvx; escZ = mvz;
  movingAgainstWind = isMovingAgainstWind(mvx, mvz, windX, windZ);
  const step = maxSpd*dt, lim = half - margin, zLim = zMax - margin;
  ...
  scentEmitT -= dt;
  if(scentEmitT <= 0){ depositScent(running, isMovingAgainstWind(mvx, mvz, windX, windZ)); scentEmitT = SCENT_DEPOSIT_INTERVAL; }
  ...
  noiseRadius = (running ? NOISE_RADIUS_RUN : NOISE_RADIUS_WALK) * bogNoiseMultiplier(playerBogginess);
}
```

`maxSpd` is computed *before* `mvx`/`mvz` exist, so the speed bonus can't be folded into it
directly — it has to apply to the step derived from it, after `movingAgainstWind` is known.
Minimal restructure, same block:

```js
const maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) * (carrying ? CONFIG.carryPaceMul : 1) * bogSpeedMultiplier(playerBogginess) * lakeSpeedMultiplier(playerInLake);
let ix = 0, iz = 0;
... // :6594-6603, unchanged
let mvx = fx*iz + rx*ix, mvz = fz*iz + rz*ix;
const mag = Math.hypot(mvx, mvz);
if(mag > 0){
  mvx /= mag; mvz /= mag;
  escX = mvx; escZ = mvz;
  movingAgainstWind = isMovingAgainstWind(mvx, mvz, windX, windZ);
  // LUL-3149: Wind-Assisted Evasion -- +20%/-30% speed+noise while sprinting directly
  // against the wind, stacks on top of Threat Beacon's always-on scent reduction
  // (depositScent() below, unconditional on `running`). movingAgainstWind is already
  // known by this point in the frame (line above) -- reuse it, don't re-derive.
  const windAssist = (running && movingAgainstWind);
  spd = maxSpd * (windAssist ? WIND_ASSIST_SPEED_MUL : 1);
  const step = spd*dt, lim = half - margin, zLim = zMax - margin;
  ...
  scentEmitT -= dt;
  if(scentEmitT <= 0){ depositScent(running, movingAgainstWind); scentEmitT = SCENT_DEPOSIT_INTERVAL; }   // dedup: was a second isMovingAgainstWind() call, no behavior change
  ...
  noiseRadius = (windAssist ? NOISE_RADIUS_RUN_WIND : (running ? NOISE_RADIUS_RUN : NOISE_RADIUS_WALK)) * bogNoiseMultiplier(playerBogginess);
}
```

Every other reference to `maxSpd`/`step` in this block (the `nx`/`nz` wrap/clamp math using
`step`) is unchanged — `step` already carries the bonus through since it's now derived from
`spd` instead of `maxSpd` directly.

### 4. `engine/forest-engine.js` — first-encounter caption (`HINT_PRIORITY`)

Add `'windAssist'` to the array (`engine/forest-engine.js:2224-2225`), placed after
`'stamina'` — a movement/exertion-state hint, lower priority than every danger hint
(`wolf`/`bear`/`lion`/`cover`) so it never preempts one, higher than `'caveImmune'` (an
already-safe state) since teaching a new evasion tool matters more once than a status
you're already protected by:

```js
const HINT_PRIORITY = ['scent','landmark','lake','bog','deepwater','oakHollow',
  'wolf','bear','lion','stamina','windAssist','cover','caveImmune','throwable','veil'];
```

`HINT_TEXT` (`:2234-2248`), one new entry:

```js
windAssist: 'sprinting into the wind moves you faster and quieter',
```

`hintCandidate()` (`engine/forest-engine.js:7158-7178`), one new case, self/panel-anchored
(no world position — same shape as `'stamina'`):

```js
case 'windAssist': return [running && movingAgainstWind, null];
```

No `hintDismissedByEvent` or `hintDismissBaselineFor` case needed — same as `'landmark'`/
`'lake'`/`'bog'`, this is time-only (8s) or eligibility-loss (handled by the existing outer
`else` branch when `running && movingAgainstWind` goes false), per the comment at
`:7187-7188` ("landmark, lake, bog: time-only"). Not added to `WORLD_HINT_KEYS`
(`:2232`) — same reason.

### 5. `engine/forest-engine.js` — rising/falling-edge audio cue

New module-scope state next to `caveImmuneT` (`engine/forest-engine.js:620`):

```js
let windAssistActive = false;   // LUL-3149: previous frame's (running && movingAgainstWind), for edge-triggered start/end cues
```

New cue pair next to `caveImmuneStartCue`/`caveImmuneEndCue` (`engine/forest-engine.js:6022-6040`),
same "distinct register, rising sweep on start / falling sweep on end" shape but a shorter,
quieter pair (this is a continuous per-sprint bonus the player will trigger often, not a rare
pickup event like cave immunity — a loud/long cue would be fatiguing):

```js
function windAssistStartCue(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(440, t); o.frequency.exponentialRampToValueAtTime(660, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.2);
}
function windAssistEndCue(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(440, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.2);
}
```

Trigger, right after `pushState({ movingAgainstWind })` (`engine/forest-engine.js:6636`) —
edge-detect on the *combined* `running && movingAgainstWind`, not `movingAgainstWind` alone
(walking against the wind must stay silent on this cue; only the sprint bonus gets one):

```js
pushState({ movingAgainstWind });
const windAssistNowActive = running && movingAgainstWind;
if(windAssistNowActive && !windAssistActive) windAssistStartCue();
else if(!windAssistNowActive && windAssistActive) windAssistEndCue();
windAssistActive = windAssistNowActive;
```

Reset alongside the other per-run state at `engine/forest-engine.js:1636` (`caveImmuneT = 0;`
sits in the same restart block): add `windAssistActive = false;`.

### 6. `components/Hud.tsx` — wind copy (checklist Q6)

Both strings are hardcoded directly in the component, not engine-owned. Update both to name
all three effects now live on the same trigger:

`components/Hud.tsx:995` (the `#windIndicator` element's `title` attribute):

```diff
- title="Wind direction -- move into the arrow to reduce your scent trail"
+ title="Wind direction -- move into the arrow to mask your scent; sprint into it for extra speed and quiet"
```

`components/Hud.tsx:1003` (`#windIndicatorHint`, the always-visible caption):

```diff
- <div id="windIndicatorHint">wind — move into the arrow to lower your scent trail</div>
+ <div id="windIndicatorHint">wind — move into the arrow to mask your scent; sprint into it for extra speed and quiet</div>
```

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint lib/game/stamina.ts lib/game/noise.ts engine/forest-engine.js` — clean.
- `npx vitest run lib/game/stamina.test.ts lib/game/noise.test.ts` — extend both with a case
  for the new constant (value + "stacks multiplicatively" shape, mirroring the existing
  `sprintSpeedMul`/`bogNoiseMultiplier` tests in the same files).
- `node scripts/check-elements-citations.mjs` — clean after the `docs/ELEMENTS.md` edit.
- `npx playwright test e2e/wind-assisted-evasion.spec.ts e2e/wind-indicator.spec.ts e2e/scent-wind.spec.ts e2e/wind-hint.spec.ts` — the last three must pass unchanged (no behavior
  change to the pulse itself or the high-wind-speed scent-lifetime mechanic, which is a
  distinct, unrelated wind system — see `e2e/scent-wind.spec.ts`'s own header comment).

## e2e

**Specs.** `e2e/wind-assisted-evasion.spec.ts` (new):
- `'sprinting against the wind covers more ground than sprinting with it, over a fixed
  window'` — displacement-delta via `qaProbePlayer()`, existing hook, no new hook needed.
- `'sprinting against the wind keeps a wolf at 20u from ever hearing you, where the same
  sprint without wind assist is heard'` — the real opposing system (`updatePredators` →
  `checkNoise` → `isNoiseHeard`), staged with `qaBuildScene`. Distance 20 sits strictly
  between `NOISE_RADIUS_RUN_WIND` (16.8, out of range — `isNoiseHeard` returns `false`
  unconditionally, no RNG roll, 100% deterministic) and `NOISE_RADIUS_RUN` (24, in range —
  `isNoiseHeard` rolls `Math.random() < 0.5*dt` every frame; over 8 sim-seconds at
  `FIXED_DT=0.02` the cumulative miss probability is `(1-0.5*0.02)^400 ≈ e^-4 ≈ 1.8%` — an
  accepted, standard-precedent flake budget, not a hook gap). Predator starts `state:'roam'`
  (never `hearNoise`'d before the window starts) so the assertion is "did `p.state` change
  away from `'roam'`" at the end of the window, not a hardcoded final state name.
- `'walking against the wind does not trigger the sprint speed or noise bonus, only the
  existing scent reduction'` — regression guard for the drift note's stacking design: holds
  `KeyW` only (no `ShiftLeft`/toggle-run), asserts displacement matches unassisted walk speed
  and the wolf-hears-you distance behaves like unassisted `NOISE_RADIUS_WALK`, while
  `qaProbeWind().movingAgainstWind` is still `true` (scent-only benefit, from LUL-3009,
  unchanged).
- `'#windIndicatorHint and #windIndicator's title both read the updated three-effect copy'` —
  text-content assertion on both strings (checklist Q6 fix landing).
- `'the windAssist hint caption appears once while sprinting against the wind, and not
  again after being marked seen'` — same `localStorage` `markHintSeen` pattern every other
  `HINT_PRIORITY` entry's first-encounter test uses (see `e2e/scent.spec.ts` or
  `e2e/wind-hint.spec.ts` for the exact reload-and-recheck shape); asserts `#hintCaption`
  text equals `HINT_TEXT.windAssist` while active, then absent on a second trigger after
  `markHintSeen`.

**World.** micro (`qaBuildScene({ predators: [{ kind: 'wolf', x: 0, z: -20, state: 'roam' }] })`
— player spawns at `(0,0)`, `yaw:0`, forward `(0,-1)` (`engine/forest-engine.js:3193`,`:1303`),
so `z:-20` is directly ahead, and `qaSetWindDirection(0, 1)` (wind blowing `+Z`) makes that
heading dot-negative against the wind, same setup `e2e/wind-indicator.spec.ts:67` already
uses). No reason to go `@fullmap` — every assertion is a controlled distance from a single
staged predator.

**Hooks.** All existing, no new hooks:
- `qaBuildScene` (`engine/forest-engine.d.ts:547`) — stage the wolf.
- `qaSetWindDirection`, `qaSetFixedStep`, `qaAdvance` — existing, used identically to
  `e2e/wind-indicator.spec.ts`.
- `qaProbePlayer()` (`engine/forest-engine.js:195` in the `.d.ts`) — displacement-delta for
  the speed assertion.
- `qaProbeWind()` (`:201`) — `movingAgainstWind` for the walking-vs-running regression guard.

**Tester scenario.** New request file `shared/local-qa/requests/lul-3149-wind-assisted-evasion.md`
(written by the implementation PR, once a real branch/commit sha exists to cite — this SPEC PR
carries no code change) — nightly confirmation that a full-map run with a real predator
chase shows the speed/noise delta outside the micro-world's controlled conditions. Not one of
the existing named nightly checks (`shared/local-qa/QA_TESTER.md`), since this is a new
mechanic with no prior nightly coverage to extend.

**Not covered.** The `WIND_ASSIST_SPEED_MUL`/`NOISE_RADIUS_RUN_WIND` *magnitudes* "feeling
right" in a real chase (balance/feel) — that's the request file's job, not e2e's. Whether the
`windAssistStartCue`/`EndCue` tone pair is audibly distinct enough from
`caveImmuneStartCue`/`EndCue` and the rest of the cue palette — manual, flagged in the local-qa
request's "listen for" section.

## Cues

**Visual.** Reuse `#windIndicator`'s existing `windIndicatorActive` pulse
(`components/Hud.tsx:988-997`) — no new element (checklist Q7/Q9: the trigger,
`movingAgainstWind`, is unchanged; this feature adds effects on top of an existing tell, not
a new tell). The pulse already fires correctly for the new sprint-bonus window since it's a
strict superset condition (`running && movingAgainstWind` implies `movingAgainstWind`).

**Audio.** `windAssistStartCue()`/`windAssistEndCue()` (new, `engine/forest-engine.js`, next
to `caveImmuneStartCue`/`EndCue` per `## The change` §5), gated by `soundOn` (both cues check
`if(!audio || !soundOn) return;`, same as every other cue in the file).

**Explanation.** First time: one-shot caption `'sprinting into the wind moves you faster and
quieter'` via the new `HINT_PRIORITY` entry (`## The change` §4), gated by the existing hint
system's own `captionsOn`/`hintsEnabled` plumbing (`engine/forest-engine.js:7158` onward —
same gate every other `HINT_TEXT` entry uses, no new gate to add). Every time: the always-on
`#windIndicatorHint` copy (`## The change` §6) names all three effects, visible whenever
`#windIndicator` itself is (i.e. whenever `state.entered && !winVisible && !deathVisible`,
`components/Hud.tsx:1002`) regardless of `captionsOn`.

**Reduced motion.** `windIndicatorActive`'s pulse animation is already withheld under
`reducedMotion` (`components/Hud.tsx:994`, LUL-3009, `e2e/wind-indicator.spec.ts`'s fourth
test) — this feature doesn't change that gate, it only adds non-visual effects (speed, noise,
audio) on the same trigger, none of which are motion. The one-shot caption text and
`windAssistStartCue`/`EndCue` audio are unaffected by `reducedMotion` (that flag only ever
gates animation, never audio or text — no precedent in this codebase for `reducedMotion`
silencing a cue).

## Constraints

- `depositScent()`'s call site dedup (`## The change` §3) must not change its observed
  behavior — same two arguments, same values, just sourced from the already-computed
  `movingAgainstWind` var instead of a second `isMovingAgainstWind()` call. `e2e/scent-wind.spec.ts`
  and `e2e/scent.spec.ts` must pass unchanged.
- `WIND_ASSIST_SPEED_MUL`/`NOISE_RADIUS_RUN_WIND` apply *only* when `running &&
  movingAgainstWind` — never at walk speed (that's Threat Beacon's existing, unrelated scent
  effect, `## Drift` note above) and never when moving *with* or across the wind.
- No change to `WIND_AGAINST_RADIUS_MULTIPLIER`, `depositScent()`'s existing scent-radius
  math, or anything in `lib/game/scent.ts` — out of scope, already correct, already covered.
- Tier C: this PR needs `REVIEW: APPROVED` from the Code Reviewer before merge (both new
  multipliers change chase/evasion balance).

## Out of scope

- Any change to `#windIndicator`'s rotation, arrow rendering, or its always-visible/gated
  behavior around `adminMode`/win/death screens — untouched, already correct
  (`docs/ELEMENTS.md:1247-1268`).
- A dedicated numeric HUD readout for the speed/noise bonus magnitude (e.g. "+20%
  speed") — the existing pulse-as-tell precedent (checklist Q2 note: this is a boolean
  "active/not," not a rationed quantity the player must count, so no `2/3`-style readout is
  owed here, unlike throwables reserve).
- Reworking `HINT_PRIORITY`'s ordering beyond inserting the one new key — the existing order
  and preemption logic (`engine/forest-engine.js:7216-7229`) is untouched.
- The `[QA-HOOK] qaProbePlayer() -> sprintWindBonusActive` companion ticket from the original
  PLAN — superseded, see `## Drift` note. Do not file it.
