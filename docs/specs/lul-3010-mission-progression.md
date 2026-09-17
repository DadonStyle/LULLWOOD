# SPEC: LUL-3010 Mission Progression -- graduated risk/reward, 2 variants

**Ticket:** LUL-3010 · **Tier:** C -- touches `engine/forest-engine.js` (`engine/` is
unconditional Tier C, `scripts/pr-tier.mjs:16`, first-match rule -- overrides the CTO's
Section 0 "Tier B, borderline" note, which didn't account for the engine-file rule being
mechanical/first-match rather than judged by size). Needs `REVIEW: APPROVED` from the Code
Reviewer before merge.

**Written against:** `release/next` @ `9917ae2` (2026-09-18). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

**Answers the Section 0 checklist** posted by the CTO on this ticket (comment
`6f53968c`, 2026-09-17T22:27Z). This spec follows those answers except where noted --
two corrections below (Tier, and Q12's "rig risk") because they turned out to already be
solved by existing infra, not new gaps.

## Background

`MISSION_POOL` (`lib/game/mission.ts:22-30`) has exactly one entry, `deepwater`
(`x:-95, z:46`, synced to the `drownedCar` landmark, `engine/tuning.js:81`) --
`Math.hypot(95,46)` ≈ **105.5m** from spawn, no timer, flat `MISSION_DEEPWATER_REWARD = 12`
(`lib/game/economy.ts:72`). The ticket's "15m"/"110m"/"60s" figures are illustrative; this
spec reuses the existing `deepwater` entry as the far/timed variant (its ~105.5m is already
the far class) and adds one new near/untimed entry rather than moving anything.

**Correction to Q12 ("rig risk, known and live").** The CTO's answer worried the far
variant's ~106m target repeats LUL-2990's micro-world-reachability gap. It does not:
`engine/forest-engine.js:1332-1335` already scales *whatever* `pickMission()` draws by
`CONFIG.missionScaleMul` (0.2 in the micro world, `engine/tuning.js:225`, LUL-2578) before
`generateMap()` finishes -- this runs for any `MISSION_POOL` entry, not just `deepwater`, and
`e2e/helpers.ts`'s `boot()` defaults to `qaWorld: 'micro'` (`e2e/helpers.ts:83`). Both variants
in this spec land inside the 96u micro world for free. No new scaling work, no `@fullmap` tag.

## Files

- `lib/game/mission.ts` -- new `MissionKind` member, `timeLimitSeconds` on `MissionTarget`,
  `'expired'` status, `checkMissionExpiry()`, `eligibleMissionPool()`, `pickMission()` takes
  an explicit pool.
- `lib/game/economy.ts` -- new reward constant, `MISSION_REWARDS` lookup map.
- `engine/forest-engine.js` -- draw from the eligible pool, per-tick expiry check +
  edge-triggered cue, `missionTimerSeconds` HUD field, `?qaMissionKind=` override,
  `qaShrinkMissionTimer()` hook, hint-system entries for the new kind, stale-copy fix.
- `engine/forest-engine.d.ts` -- widen `qaProbeMission`/`qaTeleportNearMission` return types.
- `components/Hud.tsx` -- `EngineHudState` fields, `MISSION_NAMES` entry, render the timer +
  the expired glyph.
- `docs/ELEMENTS.md` -- update the Missions section (also fixes the pre-existing stale
  coordinates flagged in Q6, `x:55,z:205` -> the real `x:-95,z:46`).
- `e2e/mission-progression.spec.ts` -- new.
- `shared/local-qa/requests/lul-3010-mission-progression.md` -- new.

## The change

### `lib/game/mission.ts`

Widen the kind union and target shape (`:6,7-19`):

```ts
export type MissionKind = 'deepwater' | 'oakHollow';

export interface MissionTarget {
  kind: MissionKind;
  x: number;
  z: number;
  zoneRadius: number;
  interactRadius: number;
  landmarkKind?: string;
  /** LUL-3010: wall-clock seconds from run start after which the mission can no
   * longer be completed (see checkMissionExpiry). Undefined = untimed, the
   * `deepwater` mission's original behaviour, still true for the near variant. */
  timeLimitSeconds?: number;
}
```

`MISSION_POOL` (`:22-30`) -- add the far variant's timer to the existing entry, add the new
near entry keyed to the `oak` landmark (`engine/tuning.js:80`, `x:22,z:4`, ≈22.4m from spawn,
placed unconditionally every round like `drownedCar`, and not referenced by any other mission
or mechanic -- confirmed via `grep -n "'oak'" engine/forest-engine.js`, the only hit is the
decorative beacon glow at `:1503`):

```ts
export const MISSION_POOL: readonly MissionTarget[] = [
  { kind: 'deepwater', x: -95, z: 46, zoneRadius: 20, interactRadius: 4, landmarkKind: 'drownedCar', timeLimitSeconds: 60 },
  { kind: 'oakHollow', x: 22, z: 4, zoneRadius: 10, interactRadius: 4, landmarkKind: 'oak' },
];
```

`MissionState.status` (`:32-36`) widens to `'active' | 'complete' | 'expired'`.
`canCompleteMission` (`:78-80`) needs **no change** -- it already requires
`status === 'active'`, which `'expired'` fails automatically.

New pure function, next to `completeMission()` (`:83-86`):

```ts
/** Mirrors completeMission's shape. No-ops (returns `mission` unchanged) once the mission
 * is already 'complete' or 'expired', or has no timeLimitSeconds (the near variant is never
 * expirable) -- callers don't need to pre-check. Flips 'active' -> 'expired' the instant
 * survivedSeconds reaches the limit; never un-expires. */
export function checkMissionExpiry(mission: MissionState, survivedSeconds: number): MissionState {
  if (mission.status !== 'active') return mission;
  const limit = mission.target.timeLimitSeconds;
  if (limit == null || survivedSeconds < limit) return mission;
  return { ...mission, status: 'expired' };
}
```

Progression gate (new constant + function, near the top of the file, after the imports):

```ts
import type { Progression } from './progression.ts';
import type { DifficultyTier } from './economy.ts';

/** LUL-3010: wins on the *current* difficulty tier before the far/timed variant can be
 * drawn at all -- cheap gate, reuses progression.ts's existing per-tier win counter
 * (lib/game/progression.ts:9), no new persisted field. Below the threshold, only the
 * near/untimed variant is eligible; at/above it, pickMission() draws uniformly between
 * both (still via rng(), same as today) -- a returning player who already has wins
 * recorded keeps seeing deepwater immediately on this deploy; a fresh player starts on
 * the safe variant. Retune the threshold here only. */
export const MISSION_FAR_UNLOCK_WINS = 3;

export function eligibleMissionPool(progression: Progression, difficulty: DifficultyTier): readonly MissionTarget[] {
  if (progression[difficulty].wins >= MISSION_FAR_UNLOCK_WINS) return MISSION_POOL;
  return MISSION_POOL.filter((m) => m.timeLimitSeconds == null);
}
```

`pickMission()` (`:41-48`) takes an explicit pool instead of always reading the module
constant, so it stays trivially unit-testable with a 1- or 2-element array and doesn't need
a `Progression` fixture in its own tests:

```ts
export function pickMission(
  rng: () => number,
  secondaryChoice: SecondaryKind | null = null,
  pool: readonly MissionTarget[] = MISSION_POOL,
): MissionState {
  const target = pool[Math.floor(rng() * pool.length)];
  const secondary = secondaryChoice && SECONDARY_SUPPORTED_MISSIONS.has(target.kind)
    ? freshSecondary(secondaryChoice)
    : null;
  return { target, status: 'active', secondary };
}
```

`SECONDARY_SUPPORTED_MISSIONS` (`:103`) is **unchanged** -- `oakHollow` gets no secondary in
this slice (Phase 1 scope ruling precedent, `decisions/lul-1666-scope-deepwater-only-2026-09-06`
already established "don't add a mission to the secondary table without its own reward-table
row"; same rule applies here).

### `lib/game/economy.ts`

Add next to `MISSION_DEEPWATER_REWARD` (`:72`):

```ts
// LUL-3010: oakHollow's completion bonus -- priced below MISSION_DEEPWATER_REWARD (12) since
// the detour itself is far cheaper (≈22m vs ≈106m round trip, no timer risk). Half, same
// "greed comes from depth, not the flat bonus" pricing rule as the original.
export const MISSION_OAKHOLLOW_REWARD = 6;

export const MISSION_REWARDS: Record<MissionKind, number> = {
  deepwater: MISSION_DEEPWATER_REWARD,
  oakHollow: MISSION_OAKHOLLOW_REWARD,
};
```

(Needs `import type { MissionKind } from './mission.ts';` at the top of `economy.ts` --
check this doesn't create an import cycle with `mission.ts`'s new `import type { DifficultyTier } from './economy.ts'` above; both are `import type`-only so it's erased at build time and cannot cycle at runtime, but confirm `tsc --noEmit` is clean.)

`computeWinPayout()`'s signature and callers are unchanged -- both call sites just switch
their literal constant for a lookup:

- `engine/forest-engine.js:5816`: `const missionBonus = mission?.status === 'complete' ? MISSION_REWARDS[mission.target.kind] : 0;`
- `engine/forest-engine.js:5959` (the dead `arriveHome()` leg, LUL-2281 Decision 2 -- kept in
  sync anyway, same as the original `MISSION_DEEPWATER_REWARD` reference there): same edit.

Import `MISSION_REWARDS` alongside the existing `MISSION_DEEPWATER_REWARD` import at
`engine/forest-engine.js:142` (keep `MISSION_DEEPWATER_REWARD`/`DEEPWATER_RETRIEVAL_BONUS`/
`DEEPWATER_SPEEDRUN_BONUS` too -- the secondary-bonus code paths still key off the literal
constants, unchanged).

### `engine/forest-engine.js`

**Draw site** (`:1330`, inside `generateMap()`), replace:

```js
mission = pickMission(rng, secondaryChoice);
```

with:

```js
// LUL-3010: ?qaMissionKind= (only under ?qaHooks=1, same gating style as ?qaHour=,
// LUL-2667) forces a single-kind pool so a test doesn't have to fight the progression
// gate + rng draw to land on a specific variant -- mirrors qaWorld picking a real map,
// not a faked one.
const pool = qaForcedMissionKind
  ? MISSION_POOL.filter((m) => m.kind === qaForcedMissionKind)
  : eligibleMissionPool(progression, difficulty);
mission = pickMission(rng, secondaryChoice, pool);
```

Import `eligibleMissionPool` alongside the existing `pickMission` import (`:155-165`).

Declare `qaForcedMissionKind` near the other `?qaHooks`-adjacent module state (next to
wherever `?qaHour=` -- LUL-2667, `engine/forest-engine.js:327` -- reads its param; land this
the same way: `const qaForcedMissionKind = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('qaMissionKind') : null;`, read once at module init, same lifetime as the other `?qa*=` boot overrides).

**Per-tick expiry + edge-triggered cue.** In `tick()`, right before the existing mission
distance/completion block (`:6769-6771`):

```js
if(mission){
  const wasActive = mission.status === 'active';
  mission = checkMissionExpiry(mission, clock.elapsedTime - enteredAt);
  if(wasActive && mission.status === 'expired'){
    pushState({ caption: 'the mission window has closed -- no bonus this run', captionId: ++captionSeq });
    missionExpiredSting();
  }
}
const distMission = mission ? distToMissionTarget(mission, player.x, player.z) : Infinity;
missionCanComplete = mission ? canCompleteMission(mission, distMission) : false;
```

Import `checkMissionExpiry` alongside the other `mission.ts` imports (`:155-165`).

**Fail cue**, next to `missionCompleteSting()` (`:5921-5926`) -- descending register, the
inverse shape of the existing rising "found it" sting, same precedent as
`caveImmuneStartCue()`/`caveImmuneEndCue()` (`:5895-5916`) being audibly distinguishable
opposites:

```js
function missionExpiredSting(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(560, t); o.frequency.exponentialRampToValueAtTime(220, t+0.3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t+0.03); g.gain.exponentialRampToValueAtTime(0.0001, t+0.45);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t+0.5);
}
```

**HUD push.** `hudState` init (`:3826`) add `missionTimerSeconds: null,` next to
`missionKind: null, missionStatus: null,`. In the per-tick `pushState()` mission block
(`:6841-6842`), add:

```js
missionTimerSeconds: mission && !carrying && mission.target.timeLimitSeconds != null
  ? Math.max(0, Math.round(mission.target.timeLimitSeconds - (clock.elapsedTime - enteredAt)))
  : null,
```

and in the `else` branch (`:6858`, the not-playing push) add `missionTimerSeconds: null,`.

**QA hook**, next to `qaTeleportAtMissionTarget` (`:5498-5502`):

```js
// [QA-HOOK] LUL-3010: shrinks the *current* mission's own timeLimitSeconds so the real
// per-tick checkMissionExpiry() trips on the next frame -- stages the scenario, does not
// set status directly (status is still flipped by the real expiry path, cue included).
// No-op (returns null) if the mission has no timer (near variant / already resolved).
window.ForestEngine.qaShrinkMissionTimer = function(seconds){
  if(!mission || mission.target.timeLimitSeconds == null) return null;
  mission = { ...mission, target: { ...mission.target, timeLimitSeconds: seconds } };
  return { kind: mission.target.kind, timeLimitSeconds: mission.target.timeLimitSeconds };
};
```

**Hint system** (Q6/stale-copy + parity for the new kind). `HINT_TEXT` (`:2179`), reword the
existing entry now that it carries a timer, and add the new key:

```js
deepwater:  'the drowned car -- a bonus payout, but only if you reach it within the time limit',
oakHollow:  'a hollow oak nearby -- a small bonus payout, no time limit',
```

`HINT_PRIORITY` (`:2164`), insert `'oakHollow'` next to `'deepwater'` (order between the two
never matters -- only one mission is ever active per run, so they're never simultaneously
eligible). `hintCandidate()`/`hintDismissedByEvent()` (`:7021-7050`) add a mirrored case:

```js
case 'oakHollow': return [!!mission && mission.target.kind === 'oakHollow' && mission.status === 'active' && !carrying, null];
// ...
case 'oakHollow': return missionCanComplete;
```

(`deepwater`'s two existing cases are unchanged.) Update the comment above `hintCandidate`
(`:7019-7020`) listing self/panel-anchored keys to include `oakHollow`.

### `engine/forest-engine.d.ts`

Widen the two hardcoded-`'deepwater'` QA hook signatures (`:468`, `:477`):

```ts
qaTeleportNearMission?: () => { kind: 'deepwater' | 'oakHollow'; x: number; z: number; status: 'active' | 'complete' | 'expired' } | null;
qaProbeMission?: () => { kind: 'deepwater' | 'oakHollow'; status: 'active' | 'complete' | 'expired'; x: number; z: number } | null;
qaShrinkMissionTimer?: (seconds: number) => { kind: 'deepwater' | 'oakHollow'; timeLimitSeconds: number } | null;
```

### `components/Hud.tsx`

`EngineHudState` (`:123-124`): `missionStatus: 'active' | 'complete' | 'expired' | null;`,
add `missionTimerSeconds: number | null;`. Default state object (`:276-278`): add
`missionTimerSeconds: null,`.

`MISSION_NAMES` (`:296-298`): add `oakHollow: 'Oak Hollow',`.

Render block (`:925-930`) -- timer is a sibling span inside the same panel (not a new
top-level element, per Q9's "no floating UI outside the established panel family"), and the
glyph gets a third state:

```tsx
{state.missionKind && state.missionStatus && !menuOpen && (
  <div id="missionPanel">
    {MISSION_NAMES[state.missionKind]}
    <span id="missionGlyph">
      {state.missionStatus === 'complete' ? '●' : state.missionStatus === 'expired' ? '✕' : '○'}
    </span>
    {state.missionTimerSeconds !== null && (
      <span id="missionTimer">{formatDuration(state.missionTimerSeconds)}</span>
    )}
  </div>
)}
```

`formatDuration` already exists (`:316-320`), same function the secondary speedrun countdown
uses (`:954`) -- no new formatting code.

### `docs/ELEMENTS.md`

Update the "Missions (detour objectives)" section (`:1737-1780`): fix the pre-existing stale
`x: 55, z: 205` to the real `x: -95, z: 46`, add a "Two variants (LUL-3010)" paragraph naming
`oakHollow` (near, untimed, `MISSION_OAKHOLLOW_REWARD`=6) vs `deepwater` (far, 60s timer,
`MISSION_DEEPWATER_REWARD`=12), the `MISSION_FAR_UNLOCK_WINS`=3 gate, and the `'expired'`
status forfeiting the bonus without failing the run.

## Verification

- `npx tsc --noEmit` -- clean (watch for the `mission.ts` <-> `economy.ts` `import type`
  pair above; should not error).
- `npm test -- mission economy` -- extend `lib/game/mission.test.ts` (new tests:
  `checkMissionExpiry` no-ops before the limit / on an untimed target / once already
  complete, flips exactly at the limit; `eligibleMissionPool` returns only oakHollow below
  the threshold and both at/above it; `pickMission` with an explicit 1-element pool always
  returns that entry) and `lib/game/economy.test.ts` (`MISSION_REWARDS` keys match
  `MissionKind`).
- `npm run lint` -- clean.
- `npx playwright test mission-progression` -- see `## e2e` below.

## e2e

**Specs.** `e2e/mission-progression.spec.ts` (new):
- "oakHollow (near/untimed): panel shows the name and glyph, no timer element, completes for
  the lower reward" -- boot with `?qaMissionKind=oakHollow`.
- "deepwater (far/timed): panel shows a ticking countdown via `#missionTimer`" -- boot with
  `?qaMissionKind=deepwater`, read `qaProbeMission()`, assert `#missionTimer` renders
  `formatDuration`-shaped text and decreases over a `waitForTimeout`.
- "timer expiry flips the glyph to '✕', fires the caption once, and forfeits the mission
  bonus at win" -- `?qaMissionKind=deepwater` + `qaShrinkMissionTimer(0.5)`, wait past it,
  assert `#missionGlyph` reads `✕`, `#captionToast` shows the expiry caption, then complete
  the real pickup path and assert the win payout does not include `MISSION_DEEPWATER_REWARD`
  (compare against `lib/game/economy.test.ts`'s existing payout-math pattern, or read
  `state.lastPayout` if exposed -- check `EngineHudState.lastPayout`'s shape before assuming).
- Extend `e2e/throwable-mission-hud.spec.ts`'s existing `#missionPanel` coverage: unaffected,
  no change needed (it doesn't force a variant, so whichever the default seed draws still
  renders identically for the fields it already asserts).

**World.** micro (default, per the Background correction above -- `boot()`'s default
`qaWorld: 'micro'` already scales both variants inside 96u via the existing
`missionScaleMul` mechanism, no `qaBuildScene` staging needed beyond the query params above).

**Hooks.** `qaProbeMission()` (existing, `engine/forest-engine.js:4233`, widened return type
above) · `qaTeleportNearMission()`/`qaTeleportAtMissionTarget()` (existing, unchanged
behaviour) · `qaShrinkMissionTimer(seconds)` (new, this spec) · `?qaMissionKind=` boot param
(new, this spec, gated under `?qaHooks=1` like `?qaHour=`).

**Tester scenario.** `shared/local-qa/requests/lul-3010-mission-progression.md` (new, written
with this spec) -- desktop + one mobile-landscape viewport, steps: boot with
`?qaMissionKind=oakHollow`, screenshot `#missionPanel` (no timer); boot with
`?qaMissionKind=deepwater`, screenshot `#missionPanel` with the timer visible;
`qaShrinkMissionTimer(0.5)`, wait, screenshot the `✕` glyph state. **Baseline check before
implementing:** query `~/.paperclip/shared/local-qa/state/e2e-baseline.json` for
`mission-deepwater.spec.ts`/`throwable-mission-hud.spec.ts` status (CTO's Q14 flagged this
as unpulled this run) -- if either is already red, this PR must not be blocked on making
them newly green, only on not making them redder.

**Not covered.** Real audio output (the sting/cue functions are asserted only via the
existing `qaXCueCount`-style counter idiom if the implementer adds one, mirroring
`qaVeilCharmReleaseCueCount` -- optional, not required by this spec since the caption+glyph
already give an observable, DOM-checkable tell). Real 60-second wall-clock waits (covered via
`qaShrinkMissionTimer` instead, per LUL-2377 token-hygiene precedent of not burning CI time
on real timers). Feel/tuning of `MISSION_FAR_UNLOCK_WINS`=3 and the two rewards -- flagged as
a first-cut number in-code, retunable without a spec change.

## Cues

**Visual.** `#missionTimer` countdown text inside `#missionPanel` while a timed mission is
active (`components/Hud.tsx`, this spec's render block above); `#missionGlyph` flips to `✕`
and stays until the run ends (win or death) once expired -- persistent tell, not a one-shot
flash, so a player who looks away doesn't need to catch the exact moment.
**Audio.** `missionExpiredSting()` (new, `engine/forest-engine.js`, next to
`missionCompleteSting()`) -- one-shot descending sweep, gated by `soundOn`, distinct register
from the existing rising completion sting.
**Explanation.** `'the mission window has closed -- no bonus this run'`, pushed via the
existing `#captionToast`/`captionId` system (`pushState({ caption, captionId: ++captionSeq })`,
same call convention as `completeMissionSequence()`'s own caption) the instant `checkMissionExpiry`
flips the status, gated by the existing captions system's own `captionsOn` check (unchanged,
whatever gates `#captionToast` today gates this too -- no new gate needed).
**Reduced motion.** Static text and a static glyph swap -- nothing here was ever animated, so
there is nothing to degrade under `reducedMotion`.

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- Pure functions in `lib/game/mission.ts`/`economy.ts` stay pure -- no `Date.now()`, no
  Three.js, no localStorage (mirrors the existing file-header rule in both files).
- `canCompleteMission`'s existing boundary contract (strict `<` at `interactRadius`) is
  untouched.
- No new `EngineActions` key -- completion still rides the existing interact (`KeyE`) path,
  same as the CTO's Section 0 answer already established (`engine-contract.ts` needs no edit).
- `missionUnlocks` (`engine/forest-engine.js:1681`, `components/Hud.tsx:127`) is untouched --
  `oakHollow` never enters `SECONDARY_SUPPORTED_MISSIONS`, so it never needs an unlocks key;
  confirm this stays true rather than silently growing scope into secondary-objective support
  for the new kind.
- A returning player's existing `progression` state (persisted, LUL-2558) means veterans keep
  seeing `deepwater` immediately on this deploy -- only fresh/reset progression starts on the
  gated near variant. This is an intentional, disclosed consequence of the gate design (see
  `eligibleMissionPool`'s doc comment above), not an oversight.

## Out of scope

- The full 2-5 variant pool from the parent Scout proposal (LUL-3007) -- CEO-accepted cheap
  slice is two variants only.
- A secondary objective (retrieval/speedrun) for `oakHollow` -- Phase 1 scope ruling precedent
  (`decisions/lul-1666-scope-deepwater-only-2026-09-06`) extends here unless a future ticket
  adds `oakHollow`'s own reward-table row.
- Retuning `MISSION_FAR_UNLOCK_WINS`, the two reward constants, or the 60s limit against real
  playtest data -- first-cut numbers, called out above.
- A cue-count QA counter for `missionExpiredSting()` (mirrors `qaVeilCharmReleaseCueCount`) --
  the caption+glyph already give e2e an observable tell without decoding WebAudio output;
  add one later only if a spec specifically needs to assert the sound fired.
