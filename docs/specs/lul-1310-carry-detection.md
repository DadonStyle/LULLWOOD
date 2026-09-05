# SPEC: carrying the child raises sight-detection

**Ticket:** LUL-1310 · **Tier: B** — touches `DetectionState`/`effectiveDetect()`
(detection *state*, not the predator AI/simulation core itself). Merge on green; open
the post-merge review child issue for the Code Reviewer afterward per the ticket's own
instruction (core-loop feel change). No blocking review, no pre-merge Game Tester verdict
required — Tier B, not C.

**Written against:** `origin/release/next` @ `a485dc0` (2026-09-02). Re-derive every
`file:line` below from the branch you actually implement on if it has moved.

## Background — do not re-derive this, it is already paid for

[[game/mechanics/carry-leg-inert]] (wiki, Feature Scout, 2026-09-02) found that picking
up the child changes four things — speed ×0.72, HUD string, a 28-unit warm `PointLight`
at the player's feet, beacon wisps switch off — and **none of them are perceivable by
predator sight detection**. `DetectionState` (`lib/game/cover.ts:419-422`) is `{ hidden,
hideTime }` only; the two places that construct it (`engine/forest-engine.js:1225,1228`)
never read `carrying`. [[decisions/scout-queue-2026-09-02]] ruled Option B (this ticket)
over Foxfire (Option A, not being built now) on 2026-09-02: *"carrying the child must
raise sight-detection by an amount a player notices without making cover useless."*

Genre research already done (cite, do not re-search): Silent Hill's flashlight, Amnesia's
lantern, and Alien: Isolation's torch/tracker all make the player's own light source the
thing that draws danger — the carried light already exists in Lullwood (`babyLight`,
`engine/forest-engine.js:3115-3120`), it just currently does nothing mechanically. This
spec wires it up.

## The number — finalized 2026-09-03

Shipped as a placeholder pending LUL-1311 (Game Economist) and LUL-1312 (Player
Psychologist). Both have since landed: LUL-1311 priced the detection multiplier at
**1.35** — the same value the placeholder used — and found it moves the return-leg win
rate from 0.850 to 0.795, inside the 0.75-0.90 bracket the tier multipliers (LUL-1043)
were solved over, with 1.5 as the hard ceiling before those need re-deriving (see wiki
`game/economy/carry-leg-detection-price`). LUL-1312 cleared the fairness read. **The
constant is unchanged; only the comment in `lib/game/cover.ts` moved from
"placeholder" to "priced."** No further tuning ticket is needed.

Why 1.35 specifically, so the follow-up tuning starts from a reasoned baseline rather
than an arbitrary one: `STILL_DETECT_CUT = 0.82` (`lib/game/cover.ts:417`) means full
stillness already cuts detect range by 82%. At 1.35×, a fully-still hidden player carrying
the child still gets cut to `1.35 × 0.18 ≈ 0.24` of base range — slightly *more* absolute
range than an empty-handed still player (`0.18`×), but cover and stillness remain
proportionally as effective as they always were (the cut is a fraction of whatever the
base range is, carry-inflated or not). That is the "without making cover useless" half of
the requirement; whether 1.35 clears the "amount a player notices" half is exactly what
LUL-1311/LUL-1312 are for.

## Files

### 1. `lib/game/cover.ts`

**a. `DetectionState` interface, `:419-422`** — add `carrying` as an **optional** field
(not required). Optional, not required, is deliberate: `lib/game/cover.test.ts` has ~20
existing `DetectionState` object literals of the shape `{ hidden, hideTime }` (first one
at `:570`) that must keep compiling and passing unmodified — see "Constraints" below.

```ts
export interface DetectionState {
  hidden: boolean;
  hideTime: number;
  carrying?: boolean;
}
```

**b. New constant, next to `STILL_RAMP`/`STILL_DETECT_CUT` (`:416-417`)** — add directly
below them:

```ts
export const CARRY_DETECT_MUL = 1.35; // PLACEHOLDER (LUL-1310): pending Game Economist's
                                       // number from LUL-1311 -- see docs/specs/lul-1310-carry-detection.md
```

**c. `effectiveDetect()`, `:424-427`** — multiply in the carry term. Current:

```ts
export function effectiveDetect(detect: number, detectMul: number, state: DetectionState): number {
  const stillness = state.hidden ? Math.min(1, state.hideTime / STILL_RAMP) : 0;
  return detect * (1 - stillness * STILL_DETECT_CUT) * detectMul;
}
```

New:

```ts
export function effectiveDetect(detect: number, detectMul: number, state: DetectionState): number {
  const stillness = state.hidden ? Math.min(1, state.hideTime / STILL_RAMP) : 0;
  const carryMul = state.carrying ? CARRY_DETECT_MUL : 1;
  return detect * (1 - stillness * STILL_DETECT_CUT) * detectMul * carryMul;
}
```

`canSee()` (`:431-442`) is unchanged — it already forwards `state` untouched into
`effectiveDetect()`, so it picks up the new term automatically.

### 2. `engine/forest-engine.js`

Both wrapper functions build the `DetectionState` object literal inline. Add `carrying`
(the module-level player-state local declared at `:1590`, already in scope at these two
call sites the same way `hidden`/`hideTime` already are — no new import, no new
parameter).

**`effectiveDetect(p)`, `:1224-1226`** — current:

```js
function effectiveDetect(p){
  return geoEffectiveDetect(p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmount), { hidden, hideTime });
}
```

New:

```js
function effectiveDetect(p){
  return geoEffectiveDetect(p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmount), { hidden, hideTime, carrying });
}
```

**`canSee(p, dist)`, `:1227-1229`** — current:

```js
function canSee(p, dist){
  return geoCanSee(dist, p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmount), { hidden, hideTime }, p.x, p.z, player.x, player.z, coverGrid);
}
```

New:

```js
function canSee(p, dist){
  return geoCanSee(dist, p.spec.detect, DIFFICULTY_PRESETS[difficulty].detectMul * veilDetectMul(veilAmount) * fogTideDetectMul(fogTideAmount), { hidden, hideTime, carrying }, p.x, p.z, player.x, player.z, coverGrid);
}
```

No other change to `forest-engine.js`. In particular, do not touch the LUL-144
cover-feedback scan at `:3157` (`if(dpd < effectiveDetect(p)){...}`) — it calls the
wrapper above, so it inherits the carry term for free, which is correct: the on-screen
"exposed/covered" feedback should reflect the same wider range predators actually use
while the child is being carried.

### 3. `lib/game/cover.test.ts`

Add new tests after the existing `effectiveDetect`/`canSee` block (after the last test in
that section, `:611-615`, before the `// ---- canSee (composition)` comment at `:617`).
Import `CARRY_DETECT_MUL` alongside the existing `STILL_RAMP, STILL_DETECT_CUT` import
(`:24-25`).

```ts
test('effectiveDetect: carrying=true, not hidden -> full CARRY_DETECT_MUL applied', () => {
  const state: DetectionState = { hidden: false, hideTime: 0, carrying: true };
  assert.equal(effectiveDetect(10, 1, state), 10 * CARRY_DETECT_MUL);
});

test('effectiveDetect: carrying omitted -> defaults to no boost (matches carrying=false)', () => {
  const withFalse: DetectionState = { hidden: false, hideTime: 0, carrying: false };
  const omitted: DetectionState = { hidden: false, hideTime: 0 };
  assert.equal(effectiveDetect(10, 1, omitted), effectiveDetect(10, 1, withFalse));
  assert.equal(effectiveDetect(10, 1, omitted), 10);
});

test('effectiveDetect: carrying stacks multiplicatively with full stillness -- cover still cuts range, proportionally the same as empty-handed', () => {
  const carryingStill: DetectionState = { hidden: true, hideTime: STILL_RAMP, carrying: true };
  const emptyHandedStill: DetectionState = { hidden: true, hideTime: STILL_RAMP, carrying: false };
  const carryRange = effectiveDetect(10, 1, carryingStill);
  const emptyRange = effectiveDetect(10, 1, emptyHandedStill);
  assert.equal(carryRange, 10 * (1 - STILL_DETECT_CUT) * CARRY_DETECT_MUL);
  // same proportional cut from stillness either way -- carrying inflates the
  // base range, it does not defeat the stillness discount
  assert.equal(carryRange / emptyRange, CARRY_DETECT_MUL);
});

test('canSee: carrying widens the range at which a predator in clear LOS spots the player', () => {
  const coverGrid = makeGrid<CoverAABB>([]);
  const notCarrying: DetectionState = { hidden: false, hideTime: 0, carrying: false };
  const carrying: DetectionState = { hidden: false, hideTime: 0, carrying: true };
  // pick a distance inside the carry-boosted range but outside the base range
  const dist = 10 * 1.1; // 11, inside [10, 10*CARRY_DETECT_MUL=13.5)
  assert.equal(canSee(dist, 10, 1, notCarrying, 0, 0, dist, 0, coverGrid), false);
  assert.equal(canSee(dist, 10, 1, carrying, 0, 0, dist, 0, coverGrid), true);
});
```

## Verification

```
npm test -- lib/game/cover.test.ts
npx tsc --noEmit
```

Passing means: all existing `cover.test.ts` tests (88 as of this spec, unmodified) still
green, the four new tests above green, and `tsc --noEmit` clean (the only interface
change, `DetectionState.carrying?`, is optional so no other `.ts`/`.tsx` file in the repo
needs updating — verified: `grep -rn "DetectionState\|{ hidden, hideTime" --include=*.ts
--include=*.tsx --include=*.js .` outside `node_modules` returns only `cover.ts` itself
and the two `forest-engine.js` call sites this spec updates).

This is Tier B: CI green is the merge gate. No Playwright/e2e run is required by this
spec — the change is a pure-function multiplier composed the same way `veilDetectMul`
and `STILL_DETECT_CUT` already are, and those ship on unit-test coverage alone
(`lib/game/cover.test.ts` is exactly this pattern for both). A full-loop e2e pass showing
a predator actually spot a carrying player sooner is optional and out of scope for this
spec — the tester's next Tier B pass can drive it manually per the standing "stop
verifying every build" directive, and desktop/mobile parity is free here (no new input,
no new HUD, per the ticket).

## Constraints

- Do not make `carrying` a required field on `DetectionState`. It must stay optional so
  `lib/game/cover.test.ts`'s ~20 pre-existing `{ hidden, hideTime }` literals keep
  compiling untouched — do not edit any existing test in that file.
- Do not touch `toggleHidden()`, `depositScent()`, or any other carrying-related call
  site named in [[game/mechanics/carry-leg-inert]] (speed, HUD text, `babyLight`, beacon
  wisps) — all four are out of scope; this spec's entire mechanical surface is the two
  `DetectionState` construction sites plus `effectiveDetect()`.
- Do not add a `carrying` gate to `findHideSpot()`/`toggleHidden()` — the requirement is
  explicitly "without making cover useless," i.e. hiding must keep working exactly as
  before while carrying, just against a larger detect range. `effectiveDetect()`'s
  multiplicative composition (stillness cut × carry mul, not carry mul replacing or
  bypassing the stillness cut) is what preserves this — do not change that order.
- `CARRY_DETECT_MUL` is now finalized at 1.35 (LUL-1311). Do not retune without a new
  Economist pricing pass — see the ceiling analysis in "The number" above.
- `DIFFICULTY_PRESETS[difficulty].detectMul` and the veil/fog-tide multipliers already
  in the wrapper functions are unchanged and untouched by this spec.

## Out of scope

- Foxfire (Option A) — not being built now, per [[decisions/scout-queue-2026-09-02]].
- The Economist's real tuning value (LUL-1311) and the Psychologist's fairness read
  (LUL-1312) — both land as follow-up tuning, not blocking this spec.
- Any new HUD affordance communicating the raised detection to the player (e.g. a UI
  cue distinct from the existing `babyLight` visual) — not asked for by the ticket or the
  wiki proposal; the requirement is a mechanical change the player *feels* through
  predator behavior, not a new indicator.
- `game/mechanics/ending-in-the-middle` and `game/mechanics/forest-grain` — adjacent
  carry-leg findings, explicitly filed as independent follow-ons in the wiki page, not
  part of this ticket.

## After this ships

File a follow-up ticket: swap `CARRY_DETECT_MUL` for the Game Economist's real number
once LUL-1311 lands, informed by the Player Psychologist's LUL-1312 fairness read. One-line
change (`lib/game/cover.ts`, the constant only), same Tier B. Also route the post-merge
Code Reviewer child issue per the parent ticket's instruction (flagged for a post-merge
look given this changes core-loop feel, even though it's Tier B not C).
