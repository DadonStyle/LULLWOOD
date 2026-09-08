# SPEC: escape waypoint bias toward home

**Ticket:** LUL-1627 (spec), implementing LUL-1622 (CEO-approved 2026-09-05, Scout proposal:
wiki `game/mechanics/waypoint-encounters`) · **Tier: C** — `engine/forest-engine.js` predator
roaming simulation. Blocking review (`REVIEW: APPROVED`) required before merge to
`release/next`. No Game Tester play-verdict required under the current QA-paused directive,
but the PR body must flag the felt-fairness question explicitly since Tester isn't in this
loop right now.

**Written against:** `origin/release/next` @ `02b8b1d5fc356b7c3c44aab963bdb53a34910232`.
As always, re-derive every line citation below by content if it doesn't match — do not
trust the numbers blindly.

## Deviation from the LUL-1627 plan — read this before implementing

The plan this spec is written from (issue LUL-1627's description) was accurate against an
**earlier** snapshot of `origin/main`, but two things have shipped since and materially
changed the target:

1. **The tuning-extraction spec (LUL-1065/LUL-1340) has now landed.** The plan said
   `engine/tuning.js` did not exist yet and warned not to write to it. It exists now
   (`engine/tuning.js:40` has `CONFIG.home = { x: 0, z: 0, r: 3.6, glow: 0xffd9b0 }`,
   `engine/tuning.js:98` has `ROAM_STEP_FRAC`). This doesn't change the plan's *file target*
   (`lib/game/predator.ts`, unaffected by the extraction) but it does mean `CONFIG` is now
   imported into `engine/forest-engine.js` from `@/engine/tuning` (forest-engine.js:166),
   not from wherever it lived when the plan was written.
2. **The call site the plan quotes verbatim no longer exists.** LUL-1573/LUL-1620
   (last-known-position return sweep) replaced the plan's inline
   `a=rng()*Math.PI*2, r=15+rng()*40` calc with a call to a helper function —
   **also named `pickRoamWaypoint`** — in `lib/game/predator.ts:190-205`. The plan's own
   "no collision" section claimed LUL-1573's return-sweep logic "lives entirely in the
   chase/investigate states, never touches the roam branch this plan changes." That claim
   is no longer true: the roam re-pick block (`engine/forest-engine.js:1767-1779`) now runs
   LKP-sweep logic (`p.lkpSweeps`, `p.lkpX/lkpZ`) directly, and the plan's proposed new
   function name is already taken by a real, tested, shipped function that does something
   different (search around a remembered last-seen point, not a home-bias escape pick).

**Resolution (this spec's design decision, not the plan's):** do not add a second function
named `pickRoamWaypoint`. Instead, **extend the existing `pickRoamWaypoint`** in
`lib/game/predator.ts` with an optional trailing parameter carrying the home-bias inputs,
applied **only** on the `sweepsLeft === 0` branch (the uniform "no live memory" pick — the
direct descendant of the calc the original plan targeted). The `sweepsLeft > 0` ring-search
branch is untouched: LKP sweep is a search behavior over the last-known player position;
home-bias-while-carrying is an escape behavior over the predator's own current position.
They are orthogonal in effect and this keeps them orthogonal in code, which is what the
plan's "no collision" section was trying to establish in the first place — it just named
the wrong mechanism to prove it with.

This is a declared deviation from LUL-1627's plan per the studio's "deviations from a
recorded decision must be declared" rule. File a one-line ticket noting the plan's
"no collision" section is stale (LUL-1573/1620 do now share the roam branch, just not in a
way that conflicts) so whoever next touches predator-memory docs sees it.

## Player mechanic (unchanged from the plan)

When `carrying === true`, a roaming predator's **fresh** waypoint re-pick (no live
last-known-position memory) occasionally biases toward a bearing that reduces distance to
home, instead of pure uniform-random. Roaming only — does not touch chase/investigate/
flank, and does not touch the LKP ring-search branch either (see deviation above).

## Files

### 1. `lib/game/predator.ts` — edit

Add two tuning constants near the existing LKP block (after `LKP_REPEAT_RADIUS`,
`predator.ts:174`):

```ts
// ---- escape waypoint home bias (LUL-1622) ----------------------------------------
// Scout proposal (wiki game/mechanics/waypoint-encounters): while carrying the baby,
// a fresh roam re-pick occasionally biases toward home instead of pure uniform-random.
// Both values are placeholders pending sign-off: LUL-1625 (Game Economist, bias
// frequency + death-cost interaction) and LUL-1626 (Player Psychologist, felt-fairness
// of frequency/cone). Do not treat these as final; Tier C review should treat those two
// open tickets as a real gate at review time if still unresolved when this PR lands.
export const ESCAPE_WAYPOINT_BIAS_FREQUENCY = 0.3; // 0-1, roll chance of a biased pick
export const ESCAPE_WAYPOINT_BIAS_CONE = 30;       // degrees, half-angle around the home bearing
```

Add an interface for the bias input, and extend `pickRoamWaypoint`'s signature with an
optional trailing parameter (existing 7-arg call shape — including every existing call in
`predator.test.ts` — must keep compiling and behaving identically when the new parameter is
omitted):

```ts
export interface EscapeWaypointBias {
  carrying: boolean;
  homeX: number;
  homeZ: number;
  frequency: number; // ESCAPE_WAYPOINT_BIAS_FREQUENCY in production; injectable for tests
  coneDeg: number;    // ESCAPE_WAYPOINT_BIAS_CONE in production; injectable for tests
}

export function pickRoamWaypoint(
  rng: () => number,
  px: number, pz: number,
  lkpX: number, lkpZ: number, sweepsLeft: number,
  playerDistFromLkp: number,
  half: number,
  bias?: EscapeWaypointBias,
): RoamWaypointPick {
  if (sweepsLeft > 0) {
    const a = rng() * Math.PI * 2;
    const r = LKP_RING_RADIUS + rng() * LKP_RING_JITTER;
    const continues = sweepsLeft - 1 > 0 && playerDistFromLkp <= LKP_REPEAT_RADIUS;
    return { x: lkpX + Math.cos(a) * r, z: lkpZ + Math.sin(a) * r, sweepsLeft: continues ? sweepsLeft - 1 : 0 };
  }
  const r = half * (ROAM_STEP_FRAC.min + rng() * ROAM_STEP_FRAC.range);
  let a = rng() * Math.PI * 2;
  if (bias?.carrying && rng() < bias.frequency) {
    const homeBearing = Math.atan2(bias.homeZ - pz, bias.homeX - px);
    const coneRad = (bias.coneDeg * Math.PI) / 180;
    a = homeBearing + (rng() * 2 - 1) * coneRad;
  }
  return { x: px + Math.cos(a) * r, z: pz + Math.sin(a) * r, sweepsLeft: 0 };
}
```

**rng() draw-order note:** the uniform (non-biased) path must keep drawing `r` before `a`
in the same two-call order the existing LUL-1808 test
(`predator.test.ts:431-439`, "reproduces the LUL-1808 map-size-scaled uniform pick")
asserts against a scripted `calls = [0.25, 0.5]` rng — that test passes `bias` as
`undefined`, so it exercises the `bias?.carrying` false branch and must keep returning
byte-identical output. Do not reorder the two draws when refactoring; the code above
preserves the original order (`r` first, using the first queued value, then `a` using the
second) — check this against the actual diff before submitting, since the inline example
above swapped the *variable declaration* order for readability but must not swap the
*draw* order. If a mechanical transcription would draw `a` first, keep it as `r` first to
match the existing test.

When `bias.carrying` is true and the frequency roll passes, this consumes one extra `rng()`
call (the frequency roll) plus, only on a pass, one more for the cone offset — both after
the existing two draws, so the LUL-1808 byte-identical test (called with `bias` omitted)
is unaffected either way.

### 2. `engine/forest-engine.js` — edit

Call site at `engine/forest-engine.js:1771` (`p.state === 'roam'`'s re-pick block, inside
the `if(wd < 2.5)` branch — see `forest-engine.js:1767-1779`). Current:

```js
const pick = pickRoamWaypoint(rng, p.x, p.z, p.lkpX, p.lkpZ, p.lkpSweeps, distFromLkp, half);
```

Change to pass the bias object, gated on the module-level `carrying` flag
(`forest-engine.js:2061`, already in scope inside `updatePredators()` exactly as the
original plan noted) and `CONFIG.home` (`engine/tuning.js:40`, imported at
`forest-engine.js:161`):

```js
const pick = pickRoamWaypoint(rng, p.x, p.z, p.lkpX, p.lkpZ, p.lkpSweeps, distFromLkp, half, {
  carrying,
  homeX: CONFIG.home.x,
  homeZ: CONFIG.home.z,
  frequency: ESCAPE_WAYPOINT_BIAS_FREQUENCY,
  coneDeg: ESCAPE_WAYPOINT_BIAS_CONE,
});
```

Add `ESCAPE_WAYPOINT_BIAS_FREQUENCY` and `ESCAPE_WAYPOINT_BIAS_CONE` to the existing
`lib/game/predator` import block at `forest-engine.js:91-105` (alongside the existing
`LKP_MAX_SWEEPS`, `pickRoamWaypoint`, etc., alphabetically).

**Angle convention (unchanged from the plan, still correct):** this call site's waypoint
math uses standard math angle convention (`a=0` points `+x`), not the yaw/heading
convention used elsewhere in this file (`Math.atan2(p.vx, p.vz)`, x first). The bearing
calc inside `pickRoamWaypoint` above (`Math.atan2(bias.homeZ - pz, bias.homeX - px)`)
already matches the correct convention for this call site — do not swap the atan2 argument
order to match the yaw convention, that would bias 90 degrees off target.

**No other call site changes.** The separate "fresh waypoint after stuck/reroute" block
elsewhere in `updatePredators()` (the `stuckT>3` branch, roughly `forest-engine.js:1959` —
it calls `keepWaypointOffLake` directly on a `freshx`/`freshz` pair, not through
`pickRoamWaypoint`) is a different escape-hatch for a physically-stuck predator, out of
scope, do not touch it.

### 3. `lib/game/predator.test.ts` — edit

All existing `pickRoamWaypoint` tests (`predator.test.ts:429-472`) call it with the
original 7 positional arguments and no `bias` — these must keep passing unmodified,
proving the new parameter is additive. Add new tests alongside them (import
`ESCAPE_WAYPOINT_BIAS_FREQUENCY`, `ESCAPE_WAYPOINT_BIAS_CONE` too):

- **Biased path taken:** scripted rng where the frequency roll passes (`rng()` sequence:
  `r`-draw, `a`-draw, frequency-roll-draw < frequency, cone-offset-draw) and
  `bias.carrying === true`. Assert the resulting angle from `(px,pz)` falls within
  `bias.coneDeg` of the true bearing to `(homeX,homeZ)` — compute the bearing with the same
  `Math.atan2(homeZ - pz, homeX - px)` and check the angular delta, not exact float
  equality (the offset is randomized within the cone).
- **Frequency roll fails → uniform path:** scripted rng where the frequency-roll draw is
  `>= frequency`; assert the result matches the plain uniform formula (same as the
  existing LUL-1808 test), proving a failed roll produces byte-identical uniform output
  even with `bias` present.
- **`carrying: false` → uniform path, no frequency roll consumed:** assert behavior (and,
  if practical, rng call count) matches the `bias` omitted case — carrying-false must not
  spend the frequency-roll draw, since `bias?.carrying &&` short-circuits before it.
- **`sweepsLeft > 0` with `bias` present → LKP path unaffected:** assert the ring-search
  result is identical whether or not `bias` is passed, proving the two mechanisms stay
  orthogonal in code as well as design.

This satisfies the Tier C "logic diff with no test diff" P1-blocker rubric.

## Verification

```bash
npx tsc --noEmit
node --experimental-strip-types --test lib/game/predator.test.ts
```

Both must be clean/green. `tsc --noEmit` catches the signature change against any other
caller; the `predator.test.ts` run must show all pre-existing tests still passing plus the
new bias tests passing.

## Constraints

- Do not touch chase, investigate, or flank states.
- Do not touch the `sweepsLeft > 0` LKP ring-search branch's behavior or its existing
  tests' expected outputs.
- Do not touch the stuck/reroute waypoint block.
- `ESCAPE_WAYPOINT_BIAS_FREQUENCY` / `ESCAPE_WAYPOINT_BIAS_CONE` are explicitly
  placeholders (see comment in the code block above) — do not treat their values as final
  design intent, and do not remove the "pending sign-off" comment.
- Keep the existing two-draw order (`r` then `a`) on the uniform path unconditionally, so
  the `bias`-omitted case stays byte-identical to current `release/next` behavior.

## Out of scope

- LUL-1625 (Game Economist bias-frequency/death-cost tuning) and LUL-1626 (Player
  Psychologist felt-fairness review) — advisory, not blockers on this spec, per the
  original plan. Flag both as open in the PR body.
- Any change to `engine/tuning.js` (the tuning-extraction landing is why `CONFIG` is
  imported from `@/engine/tuning` now, but this spec adds no new tuning constants there —
  the two new constants live in `lib/game/predator.ts` alongside their consuming function,
  matching the `FLANK_ARRIVE_R`/`SNIFF_IMMUNITY_TIME` precedent).
### 4. `docs/ELEMENTS.md` — edit (required, not out of scope)

`docs/ELEMENTS.md:276-284` ("What they can do (shared)") already documents the roam/
return-sweep behavior this spec extends, citing `pickRoamWaypoint()` by name. This spec
changes that same function's interactions, so the entry must be updated in the same PR
per the studio's "update ELEMENTS.md in the same PR" rule. Append to the existing bullet
(`ELEMENTS.md:277-284`), after the LUL-1573/LUL-1620 sentence:

```
  While carrying the baby, a fresh (no live memory) roam re-pick also has a chance
  (`ESCAPE_WAYPOINT_BIAS_FREQUENCY`, `lib/game/predator.ts`) to bias the new waypoint
  toward a bearing within `ESCAPE_WAYPOINT_BIAS_CONE` degrees of home instead of pure
  uniform-random (LUL-1622). Does not affect the LKP ring-search branch above.
```

## Routing after this spec

Game Engineer implements from this spec. Code Reviewer blocks on Tier C review per the
standing gate; explicitly check the "no collision with LKP sweep" claim above against the
actual diff, since that claim is this spec's own correction of a stale plan and deserves a
second set of eyes.
