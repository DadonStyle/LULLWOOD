# SPEC: LUL-4789 Cover Time-of-Day Visibility (cheap slice)

**Ticket:** LUL-4789 · **Tier:** B — touches `effectiveDetect(p)`/`canSee(p,dist)` in
`engine/forest-engine.js`, the shared multiplier composition every predator's sight check
reads every tick. Behavior-affecting, not a pure isolated addition, but additive (one more
multiplicative factor in an existing chain) with no new player input/state — merges on green
per Tier B, review lands after.

**Written against:** `release/next` @ `a7bf925` (2026-09-23). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

## Deviations from the proposal (verified this run, wiki `game/mechanics/cover-time-of-day-visibility` is stale on these)

1. **Function does not belong in `lib/game/cover.ts`.** The proposal says "Add
   `timeOfDayDetectMul()` to `lib/game/cover.ts`" and thread it in "at line 716". `cover.ts`'s
   `effectiveDetect()`/`canSee()` (`lib/game/cover.ts:707`, `:714`) are generic — they take an
   already-composed `detectMul` number and know nothing about veil, fog, time-of-run, or
   time-of-day (see the design-boundary comment at `lib/game/cover.ts:689-695`: "the caller
   composes whatever multipliers apply and hands over the single product"). Every existing
   per-system multiplier function (`veilDetectMul` in `lib/game/veil.ts`, `fogTideDetectMul`
   in `lib/game/fogTide.ts`, `timeOfRunDetectMul` in `lib/game/dayNight.ts`) lives in its own
   module and is composed by the engine, never inside `cover.ts`. `timeOfDayDetectMul()`
   follows that same pattern and lives in `lib/game/timeOfDay.ts` (the module that already
   owns `TimeOfDayState`/`timeOfDayFromHour()`), not `cover.ts`.
2. **Real thread points are `engine/forest-engine.js:2598` and `:2602`**, not `cover.ts:716`.
   Those are the engine's own `effectiveDetect(p)`/`canSee(p,dist)` wrapper functions
   (`:2596-2603`) where `DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount)
   * fogTideDetectMul(...) * timeOfRunDetectMul(timeOfRun) * CONFIG.detectScaleMul` is already
   composed before calling `cover.ts`'s generic functions. `timeOfDayDetectMul(timeOfDay)` is
   one more factor in that same product, at both call sites — `timeOfDay` is already a
   module-scope const (`:339`), no new state threading needed.
3. **A same-named-in-spirit system already exists and is NOT what this ticket touches —
   name it explicitly to prevent confusion.** `timeOfRunDetectMul(timeOfRun)`
   (`lib/game/dayNight.ts:17-19`, imported `forest-engine.js:199`) is a *within-session pacing
   clock* (0 at dawn of the run to 1 at "full night" of the run, `TIME_OF_RUN_DETECT_MUL =
   1.3` at full night — predators see *better* as a run drags on, i.e. the opposite valence
   from this ticket's night state). `timeOfDay` (`lib/game/timeOfDay.ts`) is the *wall-clock
   hour* system (LUL-1644/LUL-2667) driving sky/lighting/audio, currently never touching
   detection. Both are real, both will compose multiplicatively at the same two call sites
   after this change (matching the existing veil/fog/time-of-run stacking pattern) — that is
   intentional, not a duplicate (Feature Checklist Q7: two distinct trigger expressions,
   `timeOfRun` vs `timeOfDay`, no shared state). The new function's doc comment must say this
   explicitly so the next reader doesn't conflate "night" the wall-clock state with "night"
   the pacing-clock state.
4. **`qaProbePlayerDetectionRange()` does not exist** (the wiki's Day-1.5 note is
   self-contradicting — calls it "already-hooked" then says "add if missing"). Rather than a
   new top-level hook, add one field (`detectRange`) to the existing
   `qaPredatorState(idx)` hook (`engine/forest-engine.js:5052-5063`,
   `engine/forest-engine.d.ts:244-259`), which already computes and returns per-predator
   values every tick from the exact live `effectiveDetect(p)`/`canSee(p,dist)` call site —
   smaller surface than a standalone hook, same pattern `dist`/`canSee` already use there.
5. **`qaHideBehindCoverKind` does not take a cover kind.** Its parameter is a *predator*
   species (`'wolf'|'bear'|'lion'`) (`engine/forest-engine.d.ts:172-174`) and it restricts
   placement to a real hide-spot prop, which is bramble-only since LUL-2311
   (`engine/forest-engine.d.ts:169`). There is no hook that places the player/predator near a
   specific *cover* kind (rock/log/reed) — and this feature doesn't need one: `canSee()`'s
   range gate (`lib/game/cover.ts:742`) is evaluated before the `hasLOS()` geometry check
   (`:743`) and does not depend on nearby cover geometry at all. The e2e below stages two
   different cover props as *scenery* via `qaBuildScene`, at otherwise-identical player/
   predator positions, to prove the multiplier is uniform regardless of what's nearby
   (satisfying the ticket's ">=2 cover kinds" bullet meaningfully, not vacuously) — it does
   not use `qaHideBehindCoverKind`.
6. **Lookup table has an internal inconsistency in the proposal** — "Player Experience" names
   only night/noon as non-neutral, but "Cheap Slice / Day 1" also lists `afternoon +5%`. This
   spec uses the Day-1 numeric table as authoritative (it is the one with acceptance criteria
   attached); afternoon carries a small +5% not mentioned in the narrative summary.

## Files

- `lib/game/timeOfDay.ts` — add `timeOfDayDetectMul()` + its lookup table.
- `lib/game/timeOfDay.test.ts` — add unit coverage for the six states.
- `engine/forest-engine.js` — import `timeOfDayDetectMul`; thread into the two composed
  `detectMul` expressions; add `detectRange` to `qaPredatorState`'s return.
- `engine/forest-engine.d.ts` — add `detectRange: number` to `qaPredatorState`'s return type.
- `e2e/detection-time-of-day.spec.ts` — new.

## The change

### `lib/game/timeOfDay.ts` (append after the `TIME_OF_DAY_AUDIO` const, current EOF ~line 125)

```ts
// ---- detection multiplier (LUL-4789) -----------------------------------------
// Passive modifier composed into the engine's own detectMul product
// (engine/forest-engine.js:2598/:2602), alongside veilDetectMul/fogTideDetectMul/
// timeOfRunDetectMul -- same multiplicative-stacking pattern, one more factor.
//
// Do not confuse with timeOfRunDetectMul (lib/game/dayNight.ts) -- that is the
// within-session pacing clock (0 at run start -> 1 at "full night" of THIS run,
// detection goes UP to +30% as a run drags on). This multiplier is keyed on the
// wall-clock TimeOfDayState (lib/game/timeOfDay.ts, LUL-1644/LUL-2667) instead --
// orthogonal axis, opposite valence at "night": wall-clock night makes detection
// EASIER (-20%), not harder. Both compose at the same call sites; that's correct,
// not a duplicate.
const TIME_OF_DAY_DETECT_MUL: Record<TimeOfDayState, number> = {
  night: 0.8, 'early-morning': 1.0, morning: 1.0,
  noon: 1.15, afternoon: 1.05, evening: 1.0,
};

export function timeOfDayDetectMul(state: TimeOfDayState): number {
  return TIME_OF_DAY_DETECT_MUL[state];
}
```

### `lib/game/timeOfDay.test.ts` (append)

```ts
test('timeOfDayDetectMul has the documented six-state lookup', () => {
  assert.equal(timeOfDayDetectMul('night'), 0.8);
  assert.equal(timeOfDayDetectMul('early-morning'), 1.0);
  assert.equal(timeOfDayDetectMul('morning'), 1.0);
  assert.equal(timeOfDayDetectMul('noon'), 1.15);
  assert.equal(timeOfDayDetectMul('afternoon'), 1.05);
  assert.equal(timeOfDayDetectMul('evening'), 1.0);
});
```
(add `timeOfDayDetectMul` to the existing `import { ... } from './timeOfDay.ts'` at the top.)

### `engine/forest-engine.js`

Import (`:195-198`) — append to the existing `TIME_OF_DAY_AUDIO,` line rather than inserting a
new line. `docs/ELEMENTS.md` cites hundreds of `forest-engine.js:<line>` locations below this
point (the citation guard, `scripts/check-elements-citations.mjs`, re-verifies them against
current content every CI run) — inserting a whole new import line shifts every citation below
it by one and fails the guard for no reason when the same edit fits on one line:
```js
import {
  timeOfDayFromHour,
  TIME_OF_DAY_VISUALS,
  TIME_OF_DAY_AUDIO, timeOfDayDetectMul,
} from '@/lib/game/timeOfDay';
```

Two call sites (`:2598`, `:2602`) — insert `* timeOfDayDetectMul(timeOfDay)` into the composed
product, same position relative to `timeOfRunDetectMul(timeOfRun)` in both:

```js
function effectiveDetect(p){
  return geoEffectiveDetect(p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmountAt(p.x, p.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)) * timeOfRunDetectMul(timeOfRun) * timeOfDayDetectMul(timeOfDay) * CONFIG.detectScaleMul, { hidden, hideTime });
}
function canSee(p, dist){
  return geoCanSee(dist, p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmountAt(p.x, p.z, fogTideAmount, WRAP_SPAN, WRAP_SPAN)) * timeOfRunDetectMul(timeOfRun) * timeOfDayDetectMul(timeOfDay) * CONFIG.detectScaleMul, { hidden, hideTime }, p.x, p.z, player.x, player.z, coverGrid, CELL, WRAP_SPAN, p.rad + CATCH_MARGIN);
}
```

`qaPredatorState` (`:5052-5063`) — add one field to the returned object (insert after `dist`):
```js
window.ForestEngine.qaPredatorState = function(idx){
  const p = predators[idx];
  if(!p) return null;
  const dist = Math.hypot(player.x-p.x, player.z-p.z) || 0.0001;
  return { kind: p.kind, state: p.state, inv: p.inv, sniffsLeft: p.sniffsLeft, scentCalls: p.scentCalls, dist, detectRange: effectiveDetect(p), canSee: canSee(p, dist), rad: p.rad, moveRad: p.moveRad, x: p.x, z: p.z, gaveUpAt: p.gaveUpAt, sightLock: p.sightLock ? { phase: p.sightLock.phase, t: p.sightLock.t } : null, parked: p.parked, visible: p.g.visible, sightFlicker: p.sightFlicker };
};
```

### `engine/forest-engine.d.ts` (`:244-259`) — append to the `dist: number;` line rather than
inserting a new one (no citations point into this file today, `grep -c "forest-engine.d.ts:"
docs/ELEMENTS.md` is 0, but keep the same no-gratuitous-line-shift habit as the `.js` edit
above; it costs nothing and one future citation into this file is one less thing to break):

```ts
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
} | null;
```

## Verification

- `npx tsc --noEmit` — clean (new field flows through `EngineHudState`-adjacent hook types with
  no widening needed; this hook's type isn't in `ENGINE_ACTION_KEYS`/`EngineActions` — it's a
  `qaHooks`-only dev/test surface, not a React-facing engine action, so the LUL-1697 engine/
  React contract check does not apply here).
- `node --test lib/game/timeOfDay.test.ts` — 3 new assertions pass (six states covered).
- `npx playwright test e2e/detection-time-of-day.spec.ts` — 2 new tests pass.
- `npx playwright test e2e/hide.spec.ts e2e/cover-feedback.spec.ts e2e/positional-hiding.spec.ts` —
  must pass unchanged (existing detection-adjacent coverage, not touched by this diff's math
  since `timeOfDayDetectMul` defaults to a real-world hour at boot — these specs don't pass
  `?qaHour=`, so whatever the CI runner's wall-clock hour resolves to will apply a nonzero
  multiplier to their existing assertions; confirm none of them assert an exact absolute
  `dist`/`canSee` threshold that a ±20%/+15% swing could flip — `hide.spec.ts`/`cover-
  feedback.spec.ts` stage predators at fixed close range specifically to be unambiguously in
  or out of range regardless, but re-run them to be sure).
- `npx eslint .` — clean.

## e2e

**Specs.** `e2e/detection-time-of-day.spec.ts` (new):
- `'night (qaHour: 2) detection range is 20% shorter than noon (qaHour: 12), for a lion near a rock'`
- `'the same night/noon ratio holds for a lion near a bramble'` (proves the multiplier is
  cover-kind-agnostic, satisfying the ">=2 cover kinds" acceptance bullet without a hook that
  doesn't exist — see Deviation 5 above)

Both: boot micro world with `qaHooks: true`, `qaHour: <2|12>`; `enter(page)`; `qaBuildScene({
props: [{ kind: 'rock'|'bramble', x: 0, z: -8 }], predators: [{ kind: 'lion', x: 0, z: -15 }]
})` (player spawns at `(0,0)` per `engine/forest-engine.js:1309`; no ticks need to run —
`effectiveDetect(p)` is a pure read of current module state, not tick-accumulated). Read
`qaPredatorState(0).detectRange` once at `qaHour: 2`, reboot identically at `qaHour: 12`, read
again, assert `noonRange` is within 1% of `nightRange * (1.15 / 0.8)` — the ratio isolates
`timeOfDayDetectMul` alone since every other multiplicative factor (veil/fog/time-of-run/
difficulty/detectScaleMul) is identical between the two boots (same fresh-session defaults,
same predator position).
**World.** micro (`qaBuildScene`, as above). No `@fullmap`.
**Hooks.** `qaPredatorState` — existing (`engine/forest-engine.js:5052`), extended with one
field (`detectRange`) per this spec, not a new hook.
**Tester scenario.** None: not player-visible. No HUD readout, no new input, no visual/audio
change (Feature Checklist Q1/Q13 — `docs/CUES.md:5-6` passive/ambient-texture exemption
applies, this is a modifier to an already-invisible system). Coverage is the e2e spec above.
**Not covered.** Real predator chase behavior under a live time-of-day (a chasing lion
noticeably giving up sooner at night) — the cheap slice ships the math and an assertion-level
range check only; a scenario-level "does it feel different" pass is out of scope per the
ticket's stated deferrals (difficulty-tier scaling, audio feedback, caption, nightmare-mode
cycling).

## Cues

Per `docs/CUES.md:5-6`: passive/ambient world texture is out of scope for the cue-triple rule.
This ships as a modifier to an existing invisible system (detection), the same class as
`veilDetectMul`/`fogTideDetectMul`/`timeOfRunDetectMul`, none of which carry a cue triple
either. No new visual, audio, or explanation string is added in this pass.

## Constraints

- `timeOfDayDetectMul()` is a pure function (`TimeOfDayState -> number`), no side effects, not
  stored in `EngineHudState`, not added to `ENGINE_ACTION_KEYS`/`EngineActions` — this is not a
  React-facing engine action (LUL-1697 contract does not apply).
- Do not touch `timeOfRunDetectMul`/`lib/game/dayNight.ts` — orthogonal system, out of scope
  (see Deviation 3).
- Do not add a HUD readout, caption, or new setting in this pass — deferred per the ticket
  (full-feature caption/audio/difficulty-tier/nightmare-cycling are explicitly out of scope).
- No economy handshake for this cheap slice (ticket-stated; only needed if a difficulty-tier
  variant ships later, and only then to the Game Economist).

## Out of scope

- Difficulty-tier scaling of the night/noon percentages, audio feedback on spot, the optional
  `#windIndicatorHint` caption, and nightmare-mode time-of-day cycling — all named as deferred
  in the ticket and the accepted proposal; do not add them in this PR.
- `lib/game/dayNight.ts`/`timeOfRunDetectMul` — a real, already-shipped, differently-keyed
  detection multiplier; not touched, not renamed, not reconciled with this feature beyond the
  cross-reference comment in `timeOfDayDetectMul()`'s doc comment (Deviation 3).
- A hook or e2e coverage for cover kinds `log`/`reed` — two kinds (rock, bramble) already
  prove the mechanic is cover-agnostic; the acceptance bar is ">=2", not "all four".
