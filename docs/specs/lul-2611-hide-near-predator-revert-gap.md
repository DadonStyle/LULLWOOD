# SPEC: LUL-2611 fix the investigate/approach revert gap that lets a player who un-hides near a predator stay uncatchable, plus an isolation fix for cover-feedback's flaky/timing-out full-scan test

**Ticket:** LUL-2611 (founder report: "the hiding seems to not work near predator") · **Tier:**
C — real design decision in the predator state machine (`engine/forest-engine.js`'s
`updatePredators()` + `lib/game/predator.ts`'s `shouldRevertInvestigateToChase()`), needs
`REVIEW: APPROVED` before merge.

**Written against:** `release/next` @ `4252c560` (2026-09-15). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

## Root cause (confirmed live via `node --test` + an instrumented Playwright run, not just
read from the source)

`qaLurePredatorKind()` (`engine/forest-engine.js:4156`) sets `nearest.hunt = true` without
touching `nearest.state`, so a lured predator runs the `p.hunt` branch
(`engine/forest-engine.js:2616-2630`), not `p.state==='chase'`. When the player is hidden and
out of contact range at t=0, `canSee()` is false, so the branch immediately collapses:
`p.state='investigate'; p.inv='approach'` (`:2625`) — well before any real-time wait. The
`'investigate'` state's `'approach'` sub-phase performs no `canSee()`-gated kill check at all
(`:2739-2830`); it only walks at 0.45x speed toward the player. The only path back to a
kill-capable state is `shouldRevertInvestigateToChase(inv, hidden)`
(`lib/game/predator.ts:274-276`, pre-fix): `!hidden && (inv==='sniff'||inv==='back'||inv==='standoff')`
— `'approach'` was deliberately excluded to avoid resurrecting the LUL-658 livelock (a
same-tick chase->investigate/approach collapse where `hidden` is already `false` at entry
would otherwise instant-revert and volley forever). Net effect: a player who un-hides while
the predator is still in `'approach'` (plausible at 6+ units out, closing at 0.45x speed) has
no revert path at all — exactly the founder's report.

## Files

- `lib/game/predator.ts` — edited: `shouldRevertInvestigateToChase()` gains a third,
  optional `approachEnteredHidden` param.
- `lib/game/predator.test.ts` — edited: 3 new unit tests for the new param.
- `engine/forest-engine.js` — edited: a new `p.approachEnteredHidden` field, edge-stamped
  `hidden` at every one of the 8 call sites that set `p.inv = 'approach'`; the
  `shouldRevertInvestigateToChase()` call site passes it through; `qaHideBehindCover()`
  parks every other predator inert (isolation fix for cover-feedback, see below).
- `e2e/cover-feedback.spec.ts` — edited: stale `LUL-2329`/"left on the full map" comment
  corrected (the `boot()` default has been `qaWorld:'micro'` since LUL-2377; this test was
  never actually full-map).

## The change

### 1. `lib/game/predator.ts:274` — `shouldRevertInvestigateToChase`

```ts
export function shouldRevertInvestigateToChase(
  inv: string, hidden: boolean, approachEnteredHidden?: boolean,
): boolean {
  return !hidden && (inv === 'sniff' || inv === 'back' || inv === 'standoff'
    || (inv === 'approach' && approachEnteredHidden === true));
}
```

`approachEnteredHidden` distinguishes "player was hidden the moment this predator entered
'approach', and has since un-hidden" (should revert) from "'approach' was freshly entered
this exact tick with `hidden` already `false`" (the LUL-658 case — must not revert). Omitting
the third arg preserves every existing caller's behaviour (`undefined !== true`), so no
existing call site needed updating except the one live caller.

### 2. `engine/forest-engine.js` — stamp `p.approachEnteredHidden` at every `p.inv='approach'` site

All 8 sites, each gains `p.approachEnteredHidden = hidden;` (or `= true`/whatever `hidden`
resolves to in that closure at that exact line) right next to the existing `p.inv = 'approach'`
assignment:

- `:2290` `hearNoise()`
- `:2305` `hearThrowableNoise()`
- `:2321` `hearCry()`
- `:2567` charge-dodge -> investigate/approach rejoin
- `:2625` the `p.hunt` branch's collapse (the founder's actual bug's entry point)
- `:2693` blind-chase scentLock expiry -> investigate/approach
- `:2733` point-blank catch -> investigate/approach hand-off
- `:2830` `'back'` -> `'approach'` loop-around

### 3. `engine/forest-engine.js:2763` — the call site

```js
if(shouldRevertInvestigateToChase(p.inv, hidden, p.approachEnteredHidden) && p.chargeRecoveryT <= 0){ p.state='chase'; }
```

### 4. `engine/forest-engine.js:4289` `qaHideBehindCover()` — isolation fix (cover-feedback)

Separately root-caused: this hook only ever placed `predators[0]`, leaving every other
predator live. `tick()`'s cover-state-feedback scan (`coveredNow`/`exposedNow`,
`:6228-6268`) ORs in *every* non-inert predator within detect range, so an unrelated
predator elsewhere on the map could silently flip `exposedNow=true`, reading as "not
covered" even though the one predator the hook staged was correctly LOS-blocked — a pure
isolation gap, not a hang (the "30s timeout" in the ticket was Playwright's outer
`test.setTimeout`, not a real hang). Fix: park every predator except the one the hook is
placing as `inert`/off-map, the same shape `qaBuildScene()`'s own unclaimed-predator parking
already uses (`:5222-5224`) — `updatePredators()` already skips `p.inert` predators outright.

## Verification

- `node --test --experimental-test-module-mocks lib/game/predator.test.ts` — 90/90 pass,
  including 3 new cases for `approachEnteredHidden`.
- `node --test --experimental-test-module-mocks` (full unit suite) — 1118/1118 pass.
- `npx tsc --noEmit` — clean except one pre-existing, unrelated `app/layout.tsx` error (missing
  generated `LayoutProps`, present before this change, not touched by this diff).
- `npx eslint lib/game/predator.ts lib/game/predator.test.ts engine/forest-engine.js e2e/cover-feedback.spec.ts` — clean.
- `npx playwright test e2e/positional-hiding.spec.ts e2e/cover-feedback.spec.ts e2e/hide-alert.spec.ts`
  — run live against a production build. **Result: `cover-feedback.spec.ts` now passes
  (isolation fix confirmed). `positional-hiding.spec.ts`'s "dies within 5s of moving" and
  `hide-alert.spec.ts` still fail** — see "Second gap found live" below for
  `positional-hiding`; `hide-alert` is unchanged/untouched by this diff (see "Not covered").

## Second gap found live (positional-hiding still red — fix #1 is necessary, not sufficient)

An instrumented run (per-second `qaPredatorState()` polling across the whole 11s scenario)
shows `approachEnteredHidden` working exactly as designed — but exposes a **second, separate,
pre-existing gap** that stops the kill from landing inside the test's 5s window regardless:

1. On this seed, the lured lion actually reaches sniff range and **fully gives up
   (`state='roam'`, `p.gaveUpAt` set) 1-2s before the test ever presses KeyW** — the "stay
   hidden" 5s window is longer than this predator's own sniff-then-give-up cycle at this
   distance. So the revert this ticket fixes is not even the mechanism that re-engages the
   predator on this exact seed.
2. What actually re-engages it is unrelated to any of this ticket's code: a **giveup-state
   predator's ordinary roam-state sight detection** (`spotOnto()`, `engine/forest-engine.js:3015`)
   re-spots the player the instant they move (confirmed: `state` flips straight to `'chase'`,
   `canSee:true`, one second after the KeyW press).
3. That chase does not hold: `spotOnto()` **sets no `p.scentLock`**, unlike its scent-triggered
   sibling `scentOnto()` (`:2255`, `p.scentLock = SCENT_TRACK_TIME`). The very next momentary
   `canSee()` false (plausible at this range — the player is moving away past the same bramble
   they were just standing in) drops the predator straight back into `'investigate'/'approach'`
   at 0.45x speed, with `approachEnteredHidden` correctly `false` this time (player was already
   unhidden at that exact re-entry tick, so LUL-658's protection correctly holds and this
   ticket's fix correctly does *not* re-revert) — but nothing else brings it back to full chase
   speed, and a 0.45x-speed predator cannot reliably close on a normal-speed player who is
   actively moving away. Confirmed live: distance climbed 5.7 -> 7.3 -> 10.4 -> 14.7 units over
   the next 4 seconds instead of closing.

**This is a distinct, pre-existing design gap** — "a sight-spotted chase gets zero grace
against a momentary LOS loss, unlike a scent-triggered one" — not introduced by this diff and
not scoped by the CTO's PLAN comment on this ticket. The precedented shape of a fix (give
`spotOnto()` a brief `p.scentLock`, mirroring `scentOnto()`) is a **global detection-difficulty
change** affecting every sight-based chase in the game, not a narrow revert-path fix, so it
needs its own design sign-off rather than being guessed at inside this Tier C diff — see the
ticket comment bouncing this specific question to the CTO.

## Second commit (0cf6799): chase LOS-flicker tolerance + QA pursuit-speed fix

CTO decision (2026-09-15, on this ticket) for the "Second gap found live" question above:
give `spotOnto()`-triggered chases a short, separate LOS grace instead of reusing `scentLock`
(reusing `scentLock` would widen the blind-chase-through-cover exemption, the give-up distance
math, and the charge-trigger gate everywhere `scentLock` is checked — a global
detection-difficulty change, not a fix for this one edge case). Two independent changes landed
in the same commit:

1. **`p.sightFlicker` / `SIGHT_FLICKER_TIME` / `shouldDowngradeChase()`
   (`lib/game/predator.ts`, wired at `engine/forest-engine.js`'s `chase` state's
   canSee()-loses-sight gate) — a real, always-on production gameplay change.** Every
   sight-triggered chase now tolerates a 0.4s line-of-sight flicker before downgrading to
   `investigate`/`approach`, where before it downgraded on the very next tick that `canSee()`
   went false. `p.sightFlicker` refreshes to `SIGHT_FLICKER_TIME` every tick `canSee()` is
   true and decays unconditionally every tick regardless of state (same shape as
   `p.sniffImmuneT`); see `docs/ELEMENTS.md`'s "Chase LOS-flicker tolerance" bullet (Wolf /
   Bear / Lion section) for the full mechanic writeup — added in this same PR after
   LUL-2712/LUL-2703 flagged this commit shipped with zero mention of it anywhere (PR body,
   comments, or this doc).
2. **`pPursuitMul`, the two `desx=ux;desz=uz;speed=p.spec.speed*pPursuitMul` lines in
   `updatePredators()`'s `chase`/`hunt` branches.** QA-only in effect: `CONFIG.speedScaleMul`
   defaults to 1 (no-op) and is only `0.2` under `applyQaWorldMicroPreset()`
   (`engine/tuning.js:22,218`), the mandatory micro-QA-world preset (LUL-2377). Fixes a
   pursuit-speed bug the sightFlicker work surfaced live: `speedScaleMul` was folded into
   every state's `pLakeMul` (LUL-2422), including `chase`/`hunt`'s full-species-speed lines —
   at the micro world's 0.2 factor a lion's full chase speed (9.2*0.2=1.84u/s) could never
   catch a walking player (6u/s, unscaled), independent of state-machine correctness.
   `pPursuitMul` is water-only (no `speedScaleMul`), used only at those two full-speed lines;
   every other state keeps `pLakeMul` unchanged. No production effect (`speedScaleMul` is 1 on
   the full map).

## e2e

**Specs.**
- `e2e/positional-hiding.spec.ts` — "lion: hiding inside a bramble footprint in the open
  survives at range, dies within 5s of moving (LUL-2320)" — **still fails**; this diff is a
  real, necessary, unit-tested fix for the revert gap the founder reported, but is not
  sufficient to turn this specific assertion green alone (see "Second gap found live" above).
- `e2e/cover-feedback.spec.ts` — "a chasing predator blocked by real cover reads as covered,
  with no H press needed" — **now passes** (isolation fix confirmed live; no assertion
  touched).
- `lib/game/predator.test.ts` — 3 new unit cases for `shouldRevertInvestigateToChase`'s new
  param (see Verification).
- `e2e/sight-flicker.spec.ts` (LUL-2712, new) — "a sight-triggered chase tolerates a sub-0.4s
  LOS break, then downgrades past it" — drives a real chase in the micro world against a solid
  `rock` cover prop, breaks LOS for 15 ticks (0.3s, under `SIGHT_FLICKER_TIME`) and asserts
  `state` stays `chase`, then breaks LOS for 5 more ticks (0.4s cumulative) and asserts it
  downgrades to `investigate`/`approach` — closing the LUL-2377 gap the ticket named: proves
  `p.sightFlicker` is actually set/decremented and consulted at the live `canSee(p,dist)` call
  site (`updatePredators()`), not just correct in isolation the way
  `lib/game/predator.test.ts`'s pure-function unit tests already did. Uses solid cover
  (`rock`), not the walkable kind (`bramble`/`log`) the rest of this doc's specs use — a
  walkable prop lets a blind-chasing predator physically walk into its own footprint well
  inside 0.4s, which `hasLOS()`'s LUL-2320(A) hiding exemption then reads as an unconditional
  clear sightline (confirmed live while writing this spec), a different mechanism than the one
  under test here.

**World.** micro (default, unchanged by this diff — both specs already ran on `qaWorld:'micro'`,
`positional-hiding` via the default, `cover-feedback` via the same default despite its own
stale comment, now corrected; `sight-flicker.spec.ts` also default-micro).

**Hooks.** `qaHideBehindCover()` (`engine/forest-engine.js:4289`, existing) gains isolation as
an internal behaviour change only — its signature and return value are unchanged.
`qaPredatorState()` (`engine/forest-engine.js:4688`, existing) gains one new field,
`sightFlicker: p.sightFlicker`, for `e2e/sight-flicker.spec.ts` above to assert against
directly instead of only inferring the value from `state` transitions.

**Tester scenario.** None: this is a state-machine/test-isolation fix with existing e2e
coverage already asserting the exact behaviour (see Specs above); no new player-visible
surface. The existing nightly `local-qa-request: lul-2611-hiding-near-predator` scenario
(narrower, visual, already passing) is unaffected and continues to run. The sightFlicker
grace (0cf6799) is also engine-internal only — no new HUD element, copy, or cue — so no
`shared/local-qa/requests/` file is filed for it either; `e2e/sight-flicker.spec.ts` above is
its only coverage.

**Not covered.** `hide-alert.spec.ts`'s "the first-hide caption shows once and does not
repeat" failure (LUL-2611's third listed spec) — investigated but not root-caused with the
same confidence as the two above in this pass; the `HINT_PRIORITY`/`hintSeen()`/
`markHintSeen()` gate at `enterHide()` (`engine/forest-engine.js:3399-3401`) reads correct by
inspection (in-memory cache persists across the exit/re-enter within one test), and the
`LUL-2457`/`LUL-2632` citation the CTO's PLAN pointed at (`:6161-6186`) is the predator-memory
parking loop, not the hint/caption system — that citation looks stale, not re-derived here.
Left as a named follow-up (see ticket comment) rather than guessed at.

## Cues

No new player-visible state, HUD element, or copy. This is a pure engine state-machine
correction (predator behavior a player already expects: un-hiding near a predator makes you
catchable again) plus an internal test-hook isolation fix. Section 0 of
`docs/FEATURE_CHECKLIST.md` does not apply — no new state/readout/cue is introduced.

## Constraints

- Must not change any existing `shouldRevertInvestigateToChase()` caller's behavior for
  `sniff`/`back`/`standoff` (unchanged; only `approach` gains a case).
- Must not reintroduce the LUL-658 chase<->investigate livelock: a same-tick fresh
  `'approach'` entry with `hidden` already `false` must still not revert
  (`approachEnteredHidden` is `false` in that case; covered by the new unit test).
- Must not weaken or skip any of the three specs named in the ticket.

## Out of scope

- `hide-alert.spec.ts`'s failure (see "Not covered" above) — needs its own root-cause pass.
- The broader `LUL-2329` full-map->micro-world migration for `qaHideBehindCoverKind()`'s
  callers (`positional-hiding.spec.ts`, `scent.spec.ts` — both still explicitly left on the
  full map per that spec's own per-file table) — this ticket only fixes `qaHideBehindCover()`
  (no `Kind` suffix), the one hook `cover-feedback.spec.ts`'s failing test actually uses.
- `LUL-2570` (cover degradation) stays gated behind all three of this ticket's specs going
  green, per that ticket's own text and this one's Ask #3 — `hide-alert` not yet confirmed
  green, so LUL-2570 must not start yet.
