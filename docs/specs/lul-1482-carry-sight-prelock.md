# SPEC: LUL-1482 — carry-only pre-lock sight-acquisition beat

**Ticket:** LUL-1482, item 3 of LUL-1438 (CEO's ruling on LUL-1414,
[[game/psychology/carry-detection-fairness]]). **Tier: C** — `engine/forest-engine.js`
predator simulation. Requires `REVIEW: APPROVED` before merge. Per the current standing
Tier rubric (AGENTS.md, "Test" role, 2026-09-05), the Game Tester play-verdict that this
ticket's own description asks for is **not currently a merge gate** — QA is paused and
Playwright is not treated as a verdict for any tier right now. If Game Tester is
reactivated before this lands, get a play session; if not, blocking code review is the
gate, same as any other Tier C ticket right now. Do not let this stall on a verdict path
that does not currently exist.

**Written against:** `origin/release/next` @ `6f03c94` (2026-09-06). Every `file:line`
below was re-derived from that tip this run — this chain has drifted twice already
(see the correction table in wiki `specs/carry-leg-fairness-fixes`); if your branch has
moved, re-derive, don't trust these.

**Intended implementer:** Game Engineer.

## What you are building, in one paragraph (do not go read the wiki for this)

Today, `canSee(p, dist)` turning true and `spotOnto(p)` (the roar/flash/chase lock) are
**the same statement** — `if(canSee(p, dist)){ spotOnto(p); }` — in both the `roam` and
`flank` predator states. That is fine outbound: the player spends the whole ~60s walk out
learning the real sight radius and it never moves. On the carry leg, `CARRY_DETECT_MUL`
(`lib/game/cover.ts:475`, `= 1.35`) silently widens that same radius 35% the instant the
child is picked up, so the binary the player just spent a minute calibrating is now wrong,
and nothing warns them before it kills them. This ticket adds one thing: **while carrying,
a predator that spots you by sight gets `SIGHT_TELL_TIME` (0.35s) to keep seeing you before
the lock actually happens.** It freezes, faces you, and rears up — reusing the existing
`p.alert`-driven animation verbatim, no new asset — instead of instantly roaring and
chasing. Break line of sight or step out of range during that window and it cancels
silently: no roar, no flash, no state change, the same "you got away with it" the outbound
leg has always had. Scent is untouched — `scentOnto()` still fires on the same frame it
always has, in every state, carrying or not.

## Why the cheap alternative (item 3's own suggestion) is not enough, and this stays Tier C

The ticket asks me to compare the real pre-lock state against the free alternative: a flare
on the `covered`→`exposedNow` transition (`engine/forest-engine.js:3309-3318`), which needs
no predator state at all because it reuses the LUL-144 cover scan every frame already
computes.

**It doesn't deliver what the requirement asks for, because it isn't earlier — it's the
same frame.** `exposedNow` is set by exactly the same two primitives `canSee()` composes,
`effectiveDetect(p)` (range) and `hasLOS()` (line of sight) — for whichever predator has
you at that instant. The scan runs once per frame *after* `updatePredators()` has already
run `canSee()`→`spotOnto()` for every predator this same tick (`updatePredators(dt,
noiseRadius)` is called at `:3297`, the cover scan starts at `:3309`). So a predator that
acquires you by sight sets `exposedNow` true and calls `spotOnto()` in the same frame,
sub-frame order aside (<16ms, not a "perceptible interval" by any reading of the
requirement). It's a good *ambient* cue — "something out there can see you right now" — but
it is coincident with the lock, not a warning before it, and dressing it up as the pre-lock
beat would be answering a different, easier question than the one the Player Psychologist
asked. **Recommendation: build the real state (below).** This remains Tier C.

## Engagement with the "is the carry leg meant to be unescapable" open question

[[game/mechanics/carry-leg-unescapable]] §2–4 found that a carry-leg chase against a wolf
or lion cannot be outrun (`carryPaceMul=0.72` drops the player below both species' speed)
and that `shouldGiveUpChase` reads the raw, un-boosted `p.spec.detect` so the leash never
scales with `CARRY_DETECT_MUL` — meaning once a chase locks in, running does not work as an
exit. That ruling is still open and is not mine to make here.

**This mechanic does not need that ruling to be useful, either way it goes.** The pre-lock
beat's value is not "helps you escape a chase" — it's "helps you avoid ever starting one":
a player who sees the freeze-and-rear-up has a real ~0.35s window to duck behind the nearest
cover or simply stop moving (breaking `hasLOS()`) *before* the roar. If the carry-leg chase
is ruled unescapable-by-design, this beat becomes **more** valuable, not less — avoiding the
trigger becomes the only lever left on that leg. If it's ruled a defect and fixed later
(pace or leash), this beat is still correct and needs no rework. I'm not blocking on that
ruling and neither should the implementer.

## Interaction with LUL-1480 (light curve) and the LUL-1311 ceiling

- This spec touches no light, glow, or halo code. `babyGlow.ts`'s carry/idle curves
  (LUL-1438 item 1, already merged) are untouched, so there's no risk of duplicating that
  signal — this is a predator-animation-timing change, not a visual one.
- `CARRY_DETECT_MUL` (`lib/game/cover.ts:475`) is **not changed**. The tell reuses the
  existing `canSee(p, dist)` engine wrapper (`engine/forest-engine.js:1258-1260`) verbatim,
  which already folds in `carryMul` via the closure `carrying` variable — the ceiling
  analysis in `game/economy/carry-leg-detection-price` (≤1.54) is untouched by this change.

## Files

| # | Path | Action |
|---|---|---|
| 1 | `lib/game/sightLock.ts` | **create** |
| 2 | `lib/game/sightLock.test.ts` | **create** |
| 3 | `engine/forest-engine.js` | edit (9 sites, listed below) |
| 4 | `docs/ELEMENTS.md` | edit (1 site) |

---

## 1. CREATE `lib/game/sightLock.ts`

Pure state machine, same shape as `lib/game/charge.ts`'s `ChargeState`/`stepCharge` — that
module is the named precedent for both the pattern and the duration class.

```ts
// LUL-1482: carry-only pre-lock sight-acquisition tell. Today canSee()->
// spotOnto() is one statement in both the roam and flank predator states
// (engine/forest-engine.js) -- there is no interval between a predator
// acquiring the player by sight and the chase actually starting. That's fine
// outbound: the player learns the real sight radius over the ~60s walk out
// and the rule never changes underneath them. On the carry leg
// CARRY_DETECT_MUL (lib/game/cover.ts) silently widens that same radius 35%
// the instant the child is picked up, so the same binary is an ambush there
// (wiki game/psychology/carry-detection-fairness). This module is the fix --
// carrying only, sight only (scent is untouched: scentOnto still fires on the
// same frame it always has, in every state) -- a predator that spots you gets
// SIGHT_TELL_TIME seconds to keep seeing you before the lock happens. Look
// away or break LOS during that window and it cancels silently: no roar, no
// flash, no state change -- the same "you got away with it" the outbound leg
// has always had, extended across the one frame that today has none.

export type SightLockPhase = 'spotting' | 'locked' | 'cancelled';

export interface SightLockState {
  phase: SightLockPhase;
  /** seconds elapsed since the tell started. 0 once resolved (locked/cancelled). */
  t: number;
}

// Duration class matches CHARGE_TELL_TIME (lib/game/charge.ts, = 0.35) by
// design -- LUL-1482 asks the pre-lock beat to "feel like the same
// vocabulary" players already read for a charge tell. This is its own
// constant, not an import of CHARGE_TELL_TIME: the two are allowed to
// diverge on a future retune without one silently moving the other.
export const SIGHT_TELL_TIME = 0.35;

export function startSightLock(): SightLockState {
  return { phase: 'spotting', t: 0 };
}

/** Advances an in-progress tell by one frame. `stillVisible` is this frame's
 * canSee(p, dist) result, re-evaluated by the caller every tick -- same
 * contract as stepCharge()'s `jumped` parameter. Terminal states are no-ops
 * so a caller that reads the resolution one frame late can't double-resolve. */
export function stepSightLock(state: SightLockState, dt: number, stillVisible: boolean): SightLockState {
  if (state.phase !== 'spotting') return state;
  if (!stillVisible) return { phase: 'cancelled', t: 0 };
  const t = state.t + dt;
  if (t >= SIGHT_TELL_TIME) return { phase: 'locked', t: 0 };
  return { phase: 'spotting', t };
}
```

## 2. CREATE `lib/game/sightLock.test.ts`

`node:test` + `node:assert/strict`, same shape/imports as `lib/game/charge.test.ts`
(`import { ... } from './charge.ts'` style — import from `'./sightLock.ts'`). Six tests:

1. **`startSightLock begins spotting at t=0`** — `assert.deepEqual(startSightLock(), { phase: 'spotting', t: 0 })`.
2. **`stepSightLock stays spotting before SIGHT_TELL_TIME elapses, while still visible`** —
   `stepSightLock(startSightLock(), SIGHT_TELL_TIME - 0.01, true).phase === 'spotting'`.
3. **`stepSightLock resolves to locked exactly at SIGHT_TELL_TIME (boundary inclusive), while still visible`** —
   `stepSightLock(startSightLock(), SIGHT_TELL_TIME, true).phase === 'locked'`.
4. **`stepSightLock cancels the instant visibility is lost, regardless of elapsed time`** — both
   `stepSightLock(startSightLock(), 0.01, false).phase === 'cancelled'` and
   `stepSightLock({ phase: 'spotting', t: SIGHT_TELL_TIME - 0.001 }, 0.0005, false).phase === 'cancelled'`
   (i.e. losing visibility one frame before it would have locked still cancels, never locks).
5. **`stepSightLock is a no-op on terminal states`** — feeding a `{ phase: 'locked', t: 0 }` or
   `{ phase: 'cancelled', t: 0 }` state back in (any `dt`/`stillVisible`) returns the identical
   state unchanged (`assert.deepEqual`), mirroring `stepCharge`'s terminal no-op contract.
6. **`SIGHT_TELL_TIME matches CHARGE_TELL_TIME's value`** — import `CHARGE_TELL_TIME` from
   `./charge.ts` and assert `SIGHT_TELL_TIME === CHARGE_TELL_TIME`. This pins the "same
   vocabulary" decision as a real invariant rather than a comment two files apart; if the
   Psychologist or Economist later wants the carry tell to diverge from the charge tell,
   this test is the thing that makes that an intentional, visible edit.

Do not assert anything about `engine/forest-engine.js` from this file — it's a pure module
test, no DOM, no Three.js, matching every other `lib/game/*.test.ts`.

---

## 3. EDIT `engine/forest-engine.js` — nine sites

**a. Import.** After the `charge` import block (`:26-33`, ends `} from '@/lib/game/charge';`),
add, before the existing `scent` import at `:34`:

```js
import { startSightLock, stepSightLock, SIGHT_TELL_TIME } from '@/lib/game/sightLock';
```

**b. `makePredator()`'s returned object, `:1064-1066`.** Add one field to the existing
literal (next to `charge:null`):

```js
    stuckT:0, trail:[], trailT:0, reroute:0, rrX:0, rrZ:0, hunt:false, alert:0, scentLock:0, scentCalls:0,
    packTimer:0, flankX:0, flankZ:0, sniffImmuneT:0,
    charge:null, chargeDirX:0, chargeDirZ:0, chargeCooldown:0, inert:false, sightLock:null};
```

(Only the trailing `inert:false` → `inert:false, sightLock:null` changes; everything else on
that line is unchanged.)

**c. `spotOnto()`, `:1611-1616`.** Add an optional second parameter so a caller that just
finished the pre-lock tell can skip re-arming the freeze — the tell already played it, and
stacking a second one back-to-back would read as two separate freezes instead of one
notice-then-commit beat:

```js
// lock onto the player: stinger, roar, screen flash, and a rear-up alert beat.
// `opts.skipAlert` (LUL-1482): true when this call is resolving a completed
// carry-only pre-lock tell (see the new p.sightLock branch in
// updatePredators()) -- the freeze+rear-up already played during the tell,
// so re-arming p.alert here would be a second, redundant freeze immediately
// after the first. Every other call site (outbound sight, scent, the 30s
// force-hunt escalation) omits opts and keeps today's behavior exactly.
function spotOnto(p, opts){
  const skipAlert = !!(opts && opts.skipAlert);
  p.state='chase'; p.callTimer=rnd(2.6,4.2); if(!skipAlert) p.alert = 0.55;
  if(!p.spotted){ p.spotted=true; }
  predatorCall(p.kind, false, p); spotSting(); spotFlash = 1;
}
```

**d. The `roam` state's sight check, `:1385`.** Current:
```js
      if(!sniffImmune && canSee(p, dist)){ spotOnto(p); }
```
becomes:
```js
      if(!sniffImmune && canSee(p, dist)){
        if(carrying){ p.sightLock = startSightLock(); facePlayer = true; }
        else spotOnto(p);
      }
```
(`facePlayer = true` on the initiation frame only — the new top-level branch in site `f`
below takes over facing/freezing from the next frame on; without it the predator would face
its old heading for exactly one frame before snapping to face the player.)

**e. The `flank` state's sight check, `:1480`.** Current:
```js
      if(canSee(p, dist)){ spotOnto(p); }
```
becomes:
```js
      if(canSee(p, dist)){
        if(carrying){ p.sightLock = startSightLock(); facePlayer = true; }
        else spotOnto(p);
      }
```
Note this state's check has no `sniffImmune` gate today (unlike `roam`'s) — preserve that
exactly, don't add one.

**f. New top-level branch in `updatePredators()`'s per-predator `if/else if` chain.** Insert
between the `p.hunt` branch (ends `:1374`) and the `p.state === 'roam'` branch (`:1375`), so
the full priority order becomes `p.charge` → `p.alert>0` → `p.reroute>0` → `p.hunt` →
**`p.sightLock`** → `p.state==='roam'|'chase'|'investigate'|'flank'`. This placement matters:
it must sit after `p.hunt` (a forced-hunt predator ignores sight-acquisition nuance entirely,
same as it already ignores everything else) and before the state chain (so a `roam`/`flank`
predator with an in-progress tell doesn't also re-run its normal per-state logic that same
frame):

```js
    } else if(p.sightLock){
      // LUL-1482: mid carry-only sight-acquisition tell (lib/game/sightLock.ts).
      // Frozen, facing the player -- reuses the alert>0 branch's own rear-up
      // animation for free (`alerting = p.alert > 0`, :1548) by mirroring the
      // tell's remaining time into p.alert every frame; there is no second
      // animation to build.
      facePlayer = true; speed = 0;
      const stillVisible = canSee(p, dist);
      p.sightLock = stepSightLock(p.sightLock, dt, stillVisible);
      p.alert = p.sightLock.phase === 'spotting' ? SIGHT_TELL_TIME - p.sightLock.t : 0;
      if(p.sightLock.phase === 'locked'){ p.sightLock = null; spotOnto(p, { skipAlert: true }); }
      else if(p.sightLock.phase === 'cancelled'){ p.sightLock = null; }
    } else if(p.state === 'roam'){
```

(The last line duplicates the existing `:1375` — this is showing the seam, not a second
change; only the new block above it is added.)

**g–k. Five QA test-hook reset sites.** Each of these directly force-sets a predator into a
specific state for a deterministic e2e scenario and already resets `p.alert = 0` among other
fields — add `p.sightLock = null;` next to each, so a hook that teleports/re-tasks a
predator can't leave a stale tell in place that then wins the priority chain on the next
tick ahead of whatever state the hook just forced:

- `:2501` — inside `qaHideBehindCover`: `p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0;` → add `p.sightLock = null;`
- `:2536` — inside `qaHideBehindCoverKind`: same line shape, same addition
- `:2554` — inside `qaSetPredatorRoam`: `p.hunt = false; p.alert = 0; p.sniffsLeft = 0;` → add `p.sightLock = null;`
- `:2626` — inside `qaTriggerCharge`: `p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0; p.hunt = false;` → add `p.sightLock = null;`
- `:2727` — inside the blind-chase staging hook: `p.vx = p.vz = 0; p.alert = 0; p.reroute = 0; p.stuckT = 0;` → add `p.sightLock = null;`

Each is a straight append to an existing reset line — do not restructure the surrounding
function, and do not add `p.sightLock = null` anywhere these lines don't already reset
`p.alert`.

**l. `qaPredatorState`, `:2608`.** Add the tell's live phase so a future test (or a manual
devtools check) can assert the timing directly instead of guessing from `state`/`canSee`
alone. Current:
```js
    return { kind: p.kind, state: p.state, inv: p.inv, sniffsLeft: p.sniffsLeft, scentCalls: p.scentCalls, dist, canSee: canSee(p, dist), x: p.x, z: p.z };
```
becomes:
```js
    return { kind: p.kind, state: p.state, inv: p.inv, sniffsLeft: p.sniffsLeft, scentCalls: p.scentCalls, dist, canSee: canSee(p, dist), x: p.x, z: p.z, sightLock: p.sightLock ? { phase: p.sightLock.phase, t: p.sightLock.t } : null };
```

---

## 4. EDIT `docs/ELEMENTS.md` — predator registry, `:252-256`

Current bullet:
```
- Detect the player through three independent channels: **sight**
  (`canSee()`, LOS raycast + shrinking-with-stillness range),
  **scent** (`checkScent()`, radius+wind, no LOS check at all),
  and **noise** (`checkNoise()`, pure distance + per-second chance while the
  player moves). Any one channel alone triggers a chase.
```
Add a new bullet immediately after it:
```
- **Carrying the child only:** sight acquisition no longer locks into a chase
  on the same frame `canSee()` turns true. A `SIGHT_TELL_TIME` (0.35s,
  `lib/game/sightLock.ts`) freeze-and-face-the-player tell plays first,
  reusing the existing alert rear-up animation; break line of sight or leave
  range before it elapses and the tell cancels with no roar, no flash, no
  state change (LUL-1482). Scent and noise acquisition are unaffected in
  every state, carrying or not.
```

---

## Verification

```bash
cd /home/noam/lullwood
node --test lib/game/sightLock.test.ts    # new tests green in isolation first
npm test                                   # full suite, must include the new file, zero failures
npx tsc --noEmit                           # clean
npm run lint                               # 0 errors
```

Passing looks like: `sightLock.test.ts`'s 6 cases green, then the full `npm test` total
(check the count on your branch tip; do not hardcode last-known-good) plus your 6, zero
failures, clean `tsc`, clean lint.

**Two CI guards can fail the `unit tests` check for reasons unrelated to this diff — read
the actual log before assuming a regression** (AGENTS.md, "unit tests CI check" section):
`scripts/check-elements-citations.mjs` (run `--fix` first if `docs/ELEMENTS.md` line numbers
drifted) and `scripts/check-duplicate-logic.mjs` (should be a non-issue here: `sightLock.ts`'s
three exports are imported into the engine by their exact original names, which the script
explicitly allows).

**Manual check worth the two minutes it takes** (not a merge gate — Game Tester is paused,
see the Tier note at the top of this spec): start a run with `?qaHooks=1`, pick up the
child, and either let a predator approach in the open or use `qaLurePredator`/
`qaLurePredatorKind`. Confirm you see the predator freeze and rear up *before* the roar/
flash/chase, for roughly a third of a second, and confirm ducking behind cover during that
freeze cancels it silently (no roar). Then confirm the **outbound** leg (before pickup) is
completely unchanged: sight acquisition there should still roar/flash/chase on the very
first frame `canSee()` is true, with zero delay. `qaPredatorState(idx)`'s new `sightLock`
field (site `l` above) is the fastest way to confirm the timing without eyeballing frames.

## Constraints

- **Carry-only, sight-only.** Do not add a tell to `checkScent()`/`scentOnto()` in any
  state, and do not add one to the outbound (non-carrying) sight path. If `carrying` is
  false, behavior at every touched call site must be byte-identical to today.
- **`CARRY_DETECT_MUL` does not change** (`lib/game/cover.ts:475`, stays `1.35`). This
  ticket is a timing/legibility change, not a rebalance; the Economist's ≤1.54 ceiling
  (LUL-1311) is untouched.
- **No new asset, no new input, no new UI/HUD element.** The tell is entirely the existing
  `p.alert`-driven rear-up animation (`engine/forest-engine.js` render section, `alerting =
  p.alert > 0`), retimed. Mobile parity is free here: nothing about this changes with input
  scheme, so there is no mobile-specific work in this diff — say so in the PR body per the
  mobile-parity directive, don't leave it unstated.
- **`lib/game/sightLock.ts` must stay pure** — no `three`, no `Date`/`performance`, no
  DOM, no imports from `engine/`. Same discipline as `charge.ts`/`predator.ts`.
- The 30s "nobody's been near" force-hunt escalation (`spotOnto(nearP)` inside `tick()`,
  currently `:3322`) is **not** touched and does **not** get a pre-lock tell — it's a
  distinct forced-escalation trigger, not organic sight acquisition, and the ticket's own
  finding is specifically about the `roam`/`flank` `canSee()`→`spotOnto()` statement. Adding
  a tell there is out of scope (see below), not an oversight.
- Do not reformat, re-indent, or "tidy" surrounding engine code. Nine sites, named above,
  nothing else.

## Out of scope — named so you do not improvise into them

- The 30s force-hunt escalation call site (see Constraints above).
- Anything about `carryPaceMul`, the chase give-up leash (`shouldGiveUpChase` reading raw
  `p.spec.detect`), or whether the carry-leg chase is escapable at all
  ([[game/mechanics/carry-leg-unescapable]] §2–4). Real, open question; a different ticket;
  engaged with above but not resolved or acted on here.
- The light/glow curve (LUL-1438 item 1, already shipped) and the death-screen carry clause
  (LUL-1438 item 4, already shipped). Both are done; this ticket does not touch either file.
- A new Playwright e2e spec. Not required for this PR (Tier C gate is blocking review, not
  a Playwright verdict, per current standing policy). Nothing stops a later ticket from
  adding one against the `qaPredatorState` `sightLock` field this spec adds.
- Any change to `checkScent`, `checkNoise`, `hearNoise`, or the wolf pack flank-point math.

## If the spec and the code disagree

Stop and report on LUL-1482 — do not reconcile it yourself. A line number that drifted is
fine to re-derive against the tip named above; a symbol that isn't where this spec says it
is (e.g. `spotOnto`'s signature, the `roam`/`flank` branch shapes, or `p.alert`'s
`alerting` render wiring) means the tree has changed in a way that invalidates this plan,
which is my error to fix, not yours to work around.
