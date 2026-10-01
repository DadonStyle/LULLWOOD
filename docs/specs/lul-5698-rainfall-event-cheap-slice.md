# SPEC: LUL-5698 Rainfall Event — Cheap Slice

**Ticket:** LUL-5698 (LUL-5653 proposal, accepted `decisions/lul-5653-rainfall-event-accepted-2026-10-01`)
**Tier:** C — new module-level per-frame accumulator in the main tick, and a new multiplier
threaded into `updatePredators()`'s detection path. `REVIEW: APPROVED` from Code Reviewer is
required before merge.

**Written against:** `release/next` @ `8138ce6` (2026-10-01).

## Three corrections to the accepted proposal

The proposal (wiki `game/mechanics/rainfall-event.md`) and the CTO's plan comment on this
ticket describe the cheap slice in terms of a "fog bloom particle effect" and a "rainfall hum
sample." Neither exists in this codebase's actual architecture. Re-derive from what's really
there, not from the proposal's wording, if this spec and the live tree have diverged further
by the time you implement:

1. **No particle system.** `scene.fog` is a single `THREE.FogExp2` (`engine/forest-engine.js:377`)
   — one color set once at init, one density number recomputed every tick
   (`engine/forest-engine.js:7557`). Fog Tide's own "fog bloom" is exactly this: an additive term
   on that one density number (`fogTideFogBoost()`, `lib/game/fogTide.ts:91-93`). There is no
   particle emitter, bloom shader, or per-effect tint anywhere to reuse or extend. "Visual: fog
   bloom" in this spec means "density-only `scene.fog.density` increment," full stop — the CTO's
   PR comment already caught the color-tint half of this; this spec drops "particles" too.
2. **No EngineHudState field needed.** Fog Tide pushes nothing to React state for its own visual
   — `fogTideAmount`/`fogTideClock`/`fogTideActive` never appear in `components/Hud.tsx` or
   `engine/forest-engine.d.ts` (grep confirms zero hits). The fog density mutation is pure
   engine-side Three.js, no React round-trip. Rainfall's visual follows the same path: zero new
   `EngineHudState` fields, zero `Hud.tsx`/`GameCanvas.tsx` edits for the fog term. The caption
   (see Cues below) is carried entirely by the existing `HINT_PRIORITY`/`pushState({hintVisible,
   hintKey, hintText})` registry, which Hud.tsx already renders generically — no new field there
   either. This satisfies Q10 ("no field pushed without a render site") by not introducing an
   unread field in the first place, which is simpler than threading one through.
3. **No audio sample.** There is no `decodeAudioData`/`.wav`/`.mp3` anywhere in
   `engine/forest-engine.js` — every ambient bed (`wind`, `insects`, the drone `dg`) is
   procedural noise built once at audio init (`engine/forest-engine.js:3704-3721`,
   `noise(ctx, seconds, stereo)` buffers) with its gain continuously modulated afterward (see
   Fog Tide's `fogTideDroneGainMul`/`fogTideWindGainMul` doing exactly that modulation). "Rainfall
   hum" in this spec means a new procedural noise bed built the same way as `wind`/`insects`, not
   a loaded sample — loading real audio assets is out of scope and would be its own ticket.

## Files

- `lib/game/rainfallEvent.ts` — new. Pure cycle math, mirrors `lib/game/fogTide.ts`'s shape.
- `engine/forest-engine.js` — edited. New accumulators, tick-phase advance, noise-radius
  multiplier threaded into `updatePredators()`, fog density term, procedural rain noise bed,
  hint registry entry, one new QA hook.
- `engine/forest-engine.d.ts` — edited. Declare the new QA hook.
- `e2e/rainfall-event.spec.ts` — new.
- `shared/local-qa/requests/lul-5653-rainfall-event.md` — new.
- `docs/ELEMENTS.md` — edited. New entry in the style of the existing `LUL-27` Fog Tide entries
  (e.g. around `docs/ELEMENTS.md:248`).

No `components/Hud.tsx`, `components/GameCanvas.tsx`, or `lib/engine-contract.ts` changes —
see correction 2 above. No `ENGINE_ACTION_KEYS` entry — this adds no callable `EngineActions`
method, only internal engine state (CTO already confirmed this reading of the 2026-09-09
engine/React contract rule).

## The change

### 1. `lib/game/rainfallEvent.ts` (new)

Mirror `lib/game/fogTide.ts:28-32`'s config shape exactly:

```ts
import { type EventCycleConfig } from './eventScheduler.ts';

export const RAINFALL_CONFIG: EventCycleConfig = {
  period: 80,
  activeDuration: 20,
  leadIn: 10,
};

export const RAINFALL_NOISE_MUL = 0.65; // -35% footstep/breathing noise radius at full rain, same magnitude as Fog Tide's FOG_TIDE_DETECT_MUL (lib/game/fogTide.ts:62)
export const RAINFALL_RAMP = 4;        // seconds -- world-effect ease, same rate as FOG_TIDE_RAMP (lib/game/fogTide.ts:65)
export const RAINFALL_AUDIO_RAMP = 2;  // seconds -- audio telegraph ease, same rate as FOG_TIDE_AUDIO_RAMP (lib/game/fogTide.ts:66)
export const RAINFALL_FOG_BOOST = 0.08; // additive scene.fog.density at full rain -- slightly less than FOG_TIDE_FOG_BOOST (0.1, lib/game/fogTide.ts:69) since rain's primary tell is audio/noise-radius, not visual

/** `rainAmount` is the caller's own eased 0..1 ramp toward the active target
 * (same relationship fogTideDetectMul has to tideAmount, lib/game/fogTide.ts:72-74). */
export function rainfallNoiseScalar(rainAmount: number): number {
  return 1 - rainAmount * (1 - RAINFALL_NOISE_MUL);
}

export function rainfallFogBoost(rainAmount: number): number {
  return rainAmount * RAINFALL_FOG_BOOST;
}
```

Import `eventCyclePhase`, `eventCycleBuildAmount`, `eventCycleActiveTarget` from
`./eventScheduler.ts` directly at call sites in `forest-engine.js` (same as Fog Tide does,
`engine/forest-engine.js:185-198` import block) rather than re-exporting wrapped names — Fog
Tide re-exports `fogTidePhase`/`fogTideBuildAmount`/`fogTideActiveTarget` as thin wrappers
(`lib/game/fogTide.ts:75-83`) purely so call sites read `fogTidePhase(cycleT)` instead of
`eventCyclePhase(cycleT, FOG_TIDE_CONFIG)`. Do the same here for consistency: add
`rainfallPhase(cycleT)`, `rainfallBuildAmount(cycleT)`, `rainfallActiveTarget(cycleT)` thin
wrappers in `rainfallEvent.ts` closing over `RAINFALL_CONFIG`, exactly mirroring
`lib/game/fogTide.ts:75-83`'s three functions.

No sites, no `RAINFALL_SITES`, no `fogTideAmountAt`-style spatial sampling — this is a
whole-map event for the cheap slice (full feature's site-local scoping is explicitly deferred,
per the accepted decision doc).

### 2. `engine/forest-engine.js`

**Import** (new block, same style as `engine/forest-engine.js:184-198`):
```js
import {
  RAINFALL_CONFIG,
  RAINFALL_RAMP,
  RAINFALL_AUDIO_RAMP,
  rainfallPhase,
  rainfallBuildAmount,
  rainfallActiveTarget,
  rainfallNoiseScalar,
  rainfallFogBoost,
} from '@/lib/game/rainfallEvent';
```

**Module-level accumulators** — add immediately after the `fogTideClock` declaration
(`engine/forest-engine.js:515`), same four-variable shape:
```js
let rainfallClock = 0, rainfallAmount = 0, rainfallBuild = 0, rainfallActive = false;
```

**Tick advance** — add immediately after the Fog Tide block
(`engine/forest-engine.js:7566-7582`), same structure, own `track()`/`logChronicle()` event
names:
```js
if(playing) rainfallClock = (rainfallClock + dt) % RAINFALL_CONFIG.period;
const rainfallPhaseNow = rainfallPhase(rainfallClock);
rainfallBuild += (rainfallBuildAmount(rainfallClock) - rainfallBuild) * Math.min(1, dt / RAINFALL_AUDIO_RAMP);
rainfallAmount += (rainfallActiveTarget(rainfallClock) - rainfallAmount) * Math.min(1, dt / RAINFALL_RAMP);
if(rainfallPhaseNow === 'active' && !rainfallActive){
  rainfallActive = true;
  track({ event: 'feature_engagement', feature: 'rainfall', action: 'start' });
  logChronicle('rainfall_start');
} else if(rainfallPhaseNow !== 'active' && rainfallActive){
  rainfallActive = false;
  track({ event: 'feature_engagement', feature: 'rainfall', action: 'end' });
  logChronicle('rainfall_end');
}
```
Place this right after the existing Fog Tide block ends (after `engine/forest-engine.js:7582`'s
closing brace), before the next statement in `tick()`.

**Fog density** — extend the existing composite at `engine/forest-engine.js:7557` by adding one
term (do not touch the other three terms):
```js
scene.fog.density = veilFogDensity(fogBase, MIST_VEIL_FOG, veilAmount)
  + fogTideFogBoost(fogTideAmountAt(player.x, player.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN))
  + rainfallFogBoost(rainfallAmount)
  + timeOfRun * TIME_OF_RUN_FOG_DELTA;
```

**Noise-radius scaling** — at the `checkNoise()` call site, `engine/forest-engine.js:2947`,
multiply the final resolved radius by a `rainfallNoiseMul` parameter threaded into
`updatePredators()` (match the existing `windAssist`-param style, per the CTO's plan):
```js
function updatePredators(dt, noiseRadius, cryNoiseRadius, windAssist, rainfallNoiseMul){
  ...
  else if(!sniffImmune && checkNoise(p, dist, ((predInMud && windAssist) ? NOISE_RADIUS_RUN : noiseRadius) * rainfallNoiseMul, dt)){ hearNoise(p); }
  ...
}
```
Deliberately scoped to the footstep channel only — leave the `cryNoiseRadius` check two lines
below (`engine/forest-engine.js:2955`) untouched. The accepted proposal's cue is about the
player's own footsteps/breathing being masked by rain, not the child's cry; scaling the cry
channel too is a second, separate design decision the proposal never makes and this spec does
not introduce it.

Call site, `engine/forest-engine.js:7887`:
```js
if(playing) updatePredators(dt, noiseRadius, cryNoiseRadius, windAssistNowActive, rainfallNoiseScalar(rainfallAmount));
```

**Rain noise bed** — in the audio-init function (same function that builds `wind`/`insects`/`dg`,
`engine/forest-engine.js:3704-3721`), add one more procedural bed immediately after the
`insects` block:
```js
// rain bed -- filtered white noise, silent until Rainfall Event (LUL-5698) ramps it in
const rain = ctx.createBufferSource(); rain.buffer = noise(ctx, 3, true); rain.loop = true;
const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 2000; rf.Q.value = 0.8; // ~2kHz band, matches the proposal's "rainfall hum" register without a sample
const rg = ctx.createGain(); rg.gain.value = 0.0001;
rain.connect(rf); rf.connect(rg); rg.connect(master); rg.connect(conv); rain.start();
```
Return `rg` from the audio-init function alongside `wind`/`dg` (the object the function returns
is destructured as `audio` elsewhere, e.g. `audio.wg`/`audio.dg` at
`engine/forest-engine.js:4075-4076`) as `audio.rg`.

In the tick's Fog Tide/Rainfall block, after computing `rainfallBuild`/`rainfallAmount`, ramp
`rg`'s gain the same way `dg` is modulated by Fog Tide's build signal
(`engine/forest-engine.js:8236` pattern, `fogTideDroneGainMul`/`fogTideBuildAt`) — gated on
`soundOn` the same way every other diegetic sound in this file is (the `if(!audio || !soundOn)
return;` pattern at `engine/forest-engine.js:4133`, here applied as: only touch `audio.rg` inside
the same `if(audio){ ... }` block the Fog Tide `wg`/`dg` ramping already lives in near
`engine/forest-engine.js:8225-8236`; no separate `soundOn` check needed since `master`'s own gain
is already ramped to `0.0001` when `soundOn` is false (`engine/forest-engine.js:3698-3699`), so
anything routed through `master` is already silent when sound is off):
```js
audio.rg.gain.setTargetAtTime(0.04 * rainfallBuild, now, 0.3);
```

**Hint registry** — add a `rainfall` key, self/panel-anchored (no world point), to
`HINT_PRIORITY` (`engine/forest-engine.js:2290`) — append at the end of the array (lowest
priority; it's an ambient atmosphere note, not a threat/mechanic the player needs urgently) —
and to `HINT_TEXT` (`engine/forest-engine.js:2300-2325`):
```js
rainfall: "rain masks footsteps — predators' noise detection drops",
```
Add to the `hintCandidate(key)` switch (`engine/forest-engine.js:8400-8417` region):
```js
case 'rainfall': return [rainfallActive, null];
```
Add to `hintDismissedByEvent(key, baseline)` (`engine/forest-engine.js:8420-8435`), same shape
as `caveImmune`/`veilOverload`'s "dismiss when the state that made it eligible goes false again"
pattern:
```js
case 'rainfall': return !rainfallActive;
```
No `hintDismissBaselineFor` entry needed (default `0`, unused by this dismiss check, same as
`caveImmune`/`veilOverload`).

**QA hook** — inside the `?qaHooks` block (`engine/forest-engine.js:4496` opens it), add one
hook mirroring `qaSetFogTideClock` exactly (`engine/forest-engine.js:4761-4767`):
```js
// [QA-HOOK] LUL-5698: directly sets the rainfall cycle accumulator for deterministic e2e
// staging -- same rationale as qaSetFogTideClock immediately above: the real cycle is an
// 80s game-clock loop (lib/game/rainfallEvent.ts RAINFALL_CONFIG), too slow to drive through
// qaAdvance() one real dt-step at a time. Takes effect on the next tick's rainfallPhase()
// re-evaluation, same as a real elapsed-time crossing would.
window.ForestEngine.qaSetRainfallClock = function(seconds){
  rainfallClock = Math.max(0, seconds % RAINFALL_CONFIG.period);
};
```
This single hook replaces both QA-hook ideas the proposal named (`qaBuildScene({weather:
'rain-passive'})` and a standalone `qaSetRainfallPhase(phase)`) — `qaSetFogTideClock` is the
exact existing precedent for this exact situation (a slow recurring cycle an e2e test needs to
fast-forward) and should be copied, not reinvented. No `qaBuildScene` changes.

### 3. `engine/forest-engine.d.ts`

Declare next to `qaSetFogTideClock` (`engine/forest-engine.d.ts:606-607`):
```ts
      /** See engine/forest-engine.js's qaSetRainfallClock for the full rationale. */
      qaSetRainfallClock?: (seconds: number) => void;
```

### 4. `docs/ELEMENTS.md`

Add an entry in the style of the existing `LUL-27` Fog Tide entries (`docs/ELEMENTS.md:248-267`,
`:944`) — cite every new symbol by `file:line` the way those entries do. Game Engineer writes
the exact wording; this spec requires the entry exists in the same PR, not its literal text.

## Verification

- `npx tsc --noEmit` — no new type errors (the one `.d.ts` addition is optional/typed).
- `npx eslint lib/game/rainfallEvent.ts engine/forest-engine.js components/Hud.tsx` — clean
  (note: `components/Hud.tsx` is untouched by this spec; only lint it to confirm that's true).
- `npx next build` — green.
- `npx playwright test e2e/rainfall-event.spec.ts` — green, micro world, no `@fullmap`.
- Full existing suite not expected to regress — this only adds a new multiplicative term
  (`rainfallNoiseMul`, default `1` outside the active phase) to one call site; `1 *
  <anything> === <anything>`, so behavior is unchanged whenever rainfall isn't active.

## e2e

**Specs.** `e2e/rainfall-event.spec.ts` — *"a roaming lion hears a running footstep at 18u
outside rainfall, and does not hear the same footstep at 18u during active rainfall"* (new).
Template: `e2e/wind-deafness-mud.spec.ts` (near-identical shape — stages a predator at a fixed
offset via `qaStagePredatorNearPlayer`, re-pins every tick via `qaAdvance(1, true)`, probes
`qaProbePredatorState`). Geometry: 18u sits strictly between `NOISE_RADIUS_RUN *
RAINFALL_NOISE_MUL` (24 * 0.65 = 15.6, out of range — `isNoiseHeard` returns false
unconditionally, no roll) and `NOISE_RADIUS_RUN` (24, in range — probabilistic roll, same 8s
window and ~1.8% flake budget `e2e/wind-deafness-mud.spec.ts`'s own header documents). Stage a
lion (not a wolf) since the proposal's own Q11 names a lion. No wind, no mud — isolate the
rainfall multiplier alone. Drive the real cycle via `qaSetRainfallClock(seconds)` (set to
`RAINFALL_CONFIG.period - RAINFALL_CONFIG.activeDuration` to land in `active` immediately) —
not a QA-hook force of `rainfallActive` or `rainfallAmount` directly, so the real phase
transition and `rainfallNoiseScalar(rainfallAmount)` ramp both actually run.

**World.** micro — `qaBuildScene({ predators: [{ kind: 'lion', x: 0, z: -18, state: 'roam' }]
})`, no props needed (no mud/cover in this test). No `@fullmap`.

**Hooks.** `qaSetRainfallClock(seconds): void` — new, declared above, installed in the
`?qaHooks` block. `qaBuildScene`, `qaAdvance`, `qaProbePredatorState`, `qaStagePredatorNearPlayer`
— existing (`engine/forest-engine.js`, see `e2e/wind-deafness-mud.spec.ts` for exact call
shapes).

**Tester scenario.** `shared/local-qa/requests/lul-5653-rainfall-event.md` (new, see below).

**Not covered.** The rain noise bed's actual audible timbre/mix (real-device audio feel) stays
manual — no automated check can assert "sounds like rain," only that `soundOn` gates it and the
gain gets non-zero during the active phase (covered by the e2e spec's predator-hearing
assertion as an indirect proxy; a direct `audio.rg.gain.value` probe is optional, add one only
if the Game Engineer finds `qaProbeAudio`-style precedent elsewhere in the file to extend).

## Cues

**Visual.** `scene.fog.density` gains the `rainfallFogBoost(rainfallAmount)` additive term,
`engine/forest-engine.js:7557` (edited line). No particle system — see correction 1 above.
**Audio.** New procedural noise bed `rg`, gain ramped by `rainfallBuild` in the same tick block
Fog Tide's `wg`/`dg` ramping lives in (near `engine/forest-engine.js:8225-8236`). Gated on
`soundOn` transitively via `master`'s own gain ramp (`engine/forest-engine.js:3698-3699`) — see
correction 3 above; no sample.
**Explanation.** `"rain masks footsteps — predators' noise detection drops"`, shown once per
install via the `HINT_PRIORITY`/`hintCandidate('rainfall')` entry
(`engine/forest-engine.js:2290`, `:8400` region), gated on `captionsOn` the same way every other
`HINT_PRIORITY` entry already is (the registry's own `baseHintEligible` gate,
`engine/forest-engine.js:2282-2289`'s doc comment).
**Reduced motion.** The fog density change is a continuous scalar on an exponential-fog
material property, not an animated geometry or particle system — nothing to reduce (same as Fog
Tide's own `fogTideFogBoost`, which is not gated on `motionReduced()` either,
`engine/forest-engine.js:7557`). The caption pill itself is static text, also nothing to reduce.

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- `rainfallNoiseScalar(rainAmount)` and `rainfallFogBoost(rainAmount)` must stay pure functions
  of their single input, no side effects, same as every `fogTide*` function they mirror — keep
  all mutable state (`rainfallClock`/`rainfallAmount`/`rainfallBuild`/`rainfallActive`) in
  `engine/forest-engine.js`, not in `lib/game/rainfallEvent.ts`.
- Do not touch the `cryNoiseRadius` channel (`engine/forest-engine.js:2955`) — out of scope, see
  the noise-radius-scaling note above.
- Do not add a `components/Hud.tsx` `EngineHudState` field, a `GameCanvas.tsx` render site, or
  an `ENGINE_ACTION_KEYS` entry for this slice — see corrections above. If implementation turns
  up a reason one is actually needed, stop and bounce back to this spec rather than inventing
  one ad hoc.
- Tier C: `REVIEW: APPROVED` required before merge.

## Out of scope

- `RAINFALL_SITES` / spatial site-local scoping (`fogTideAmountAt`-style) — Full Feature,
  deferred to player-test signal per the accepted decision doc. This slice is whole-map.
- `DIFFICULTY_PRESETS` overrides of `RAINFALL_CONFIG` (`engine/tuning.js:321`) — Full Feature.
- Rain-specific particle geometry / color tint — doesn't exist for Fog Tide either; not invented
  here (correction 1).
- Any new player-facing setting, keybind, or `EngineActions` method — none needed; rainfall is a
  passive ambient event with no new input, so the mobile-parity "every feature lands with its
  touch affordance" rule is satisfied vacuously (nothing to touch).
