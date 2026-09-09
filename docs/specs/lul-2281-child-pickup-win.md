# SPEC: win trigger moves to child pickup (revert LUL-1307 carry-home leg)

**Ticket:** LUL-2281 (founder, critical/ASAP, human-authored: "revert 'lift up and lift
down' when reaching the child and pressing E... there should be the animation that the
child goes to sky explodes and end game screen. thats it.") / LUL-2282 (routing/scoping
child). **Tier: C** — win/lose sequencing (`engine/forest-engine.js` simulation).
Blocking review (`REVIEW: APPROVED`) required before merge; Game Tester is paused, see
"## e2e" below for the substitute play-verdict path.

**Written against:** `release/next` @ `f3fbe63` (2026-09-09). Implementation landed
directly alongside this spec (critical/ASAP timeline) — re-derive every `file:line` below
from the branch you're reviewing on if it has moved.

**Ruling (all judgment calls already resolved by the CTO):** wiki
`decisions/lul-2281-pickup-is-the-win-2026-09-09`. This spec matches that ruling exactly;
read it first for the "why" behind each decision below.

## The change

Reverts LUL-1307 (`git show 0e55c85`, "move win fanfare from pickup to arrive-home"):
completing the pickup cinematic used to hand off to a carry-home leg (`carrying=true`)
and reserve the win fanfare for arrival at `CONFIG.home`. LUL-2281 asks for the pre-1307
shape back — reach the child, press E, watch her ascend and explode into the sky, see the
win screen. No carry-home leg after.

### 1. `lib/game/outcome.ts` — `completePickup()` wins outright

```ts
export function completePickup(s: RunState): RunState {
  if (!s.pickingUp) return s;
  return { ...s, pickingUp: false, won: true };
}
```

Was `{ ...s, pickingUp: false, carrying: true }`. This is the one state-machine edit that
matters; every other change in this diff follows from it. `carrying` is deliberately left
`false` forever in real play — see Decision 2 below.

### 2. `carrying`/`setDown`/`arriveHome()` machinery: left in place, now dead code

`carrying` is read well beyond `outcome.ts` — predator detection/AI, the HUD
objective/mission-panel conditionals, the death payout's `deathCarrying` flag,
`canGrabThrowable`'s carry-leg comment. After edit 1, `completePickup` is the only call
site that used to set `carrying = true`, so `carrying` is now permanently `false` in real
play — every one of those call sites is inert, not broken. Given the critical/ASAP
timeline, **this machinery is not deleted in this PR**: `arriveHomeAllowed()`,
`canArriveHome()`, `arriveHome()` (`outcome.ts`), and the engine's `arriveHome()` function
and its `} else if(carrying){...}` tick branch are all untouched, just unreachable. A
follow-up cleanup ticket (unassigned, non-urgent) removes this across `outcome.ts` /
`engine/forest-engine.js` and updates `canGrabThrowable`'s stale comment.

### 3. `engine/forest-engine.js` — restore the pre-LUL-1307 ascend/boom cinematic

`tick()`'s `pickingUp` branch reverts to the full ~11.3s curve (gather 0-3.5s, ascend
3.5-9.3s to `ay≈55`, `fireBoom(baby.x, ay, baby.z)` once at `e>=9.3` via a reinstated
`pickBoomed` one-shot flag, hold to `e>=11.3`) instead of LUL-1307's shortened 2.5s
gather-only curve. `pickBoomed` is reinstated as a module-level `let` (reset in `pickup()`
and `restart()`, same three sites LUL-1307 removed it from).

`fireBoom()` fires at the child's ascended position (`baby.x, ay, baby.z`), never at
`CONFIG.home` — `arriveHome()`'s own `fireBoom(CONFIG.home.x, ...)` call site is now
unreachable per edit 2, left as-is.

### 4. `finishPickup()` absorbs `arriveHome()`'s win bookkeeping

At `e>=11.3`, `finishPickup()` is now the win moment: `won = next.won` (was
`carrying = next.carrying`), then the same sequence `arriveHome()` used to run —
`babyGroup.visible = false`, exitPointerLock/cursor reset, `playWinMusic()` (not
`fireBoom()` again — that already fired mid-cinematic per edit 3), payout via
`computeWinPayout(maxDistFromHome, survivedSeconds, difficulty, missionBonus,
secondaryBonus)`, mission/secondary bonus checks, `applyPayout`, `logChronicle('win')`
(kept alongside the existing `logChronicle('pickup')`), the `pushState({...,
winVisible: true, ...})` block, and the `track('win', ...)` call. `computeWinPayout` and
the `CARRIED`/`HOME` constants are unchanged — `maxDistFromHome` and `survivedSeconds` are
already tracked continuously through the pickup cinematic, so both terms are already
correct at this earlier win point with zero economy-module changes. Renaming/rebalancing
what the "doorstep" (`HOME`) bonus means with no carry-home leg is flagged as a follow-up
for the Game Economist, not a blocker here.

The now-unused `PICKUP_GLOW_PEAK`/`CARRY_GLOW_BASE`/`CARRY_HALO_BASE` imports from
`lib/game/childGlow` are dropped from `engine/forest-engine.js` (still exported from
`childGlow.ts`, still used by its own tests and by `carryGlowIntensity()`/
`carryHaloOpacity()`, which the dead `carrying` tick branch still calls). `playCarryStartCue()`
is left defined but uncalled, same "leave the dead machinery, don't rip it out" reasoning
as edit 2.

### 5. User-visible copy (real bugs if left stale, not deferred)

- HUD prompt string (`objectiveText` in `tick()`'s pushState block): collapsed from the
  `carrying`/`babySetDown`-branching ternary to the single `'Press  E  to lift the child'`
  prompt — there is no carry/set-down state left to prompt for.
- `app/page.tsx`: four passages rewritten away from "carry them home" framing to
  reach-and-lift-is-the-win framing (premise paragraph, how-to-play paragraph, the `E`
  control's description, the "what makes it different" paragraph).
- `lib/game/chronicle.ts`: the `'win'` case's line rewritten from `'you carried the child
  home.'` to `'you lifted her into the light.'` (`chronicle.test.ts` updated to match).
- `README.md` / `docs/HOW_IT_WORKS.md` / `docs/ELEMENTS.md`: same reach-and-lift framing;
  `ELEMENTS.md` also gets an explicit "dead code, kept on purpose" note pointing at the
  wiki decision doc, and its win-trigger description (`dh<CONFIG.home.r` proximity) is
  corrected to "fires off the pickup cinematic's own clock, not a distance threshold."
  Historical records (`QA_REGRESSION/`, `NOAM_MDS/`, `lib/devlog.ts`, superseded specs like
  `docs/specs/lul-1307-win-fanfare-arrive-home.md`) are untouched — they describe what was
  true at the time, not current behavior.

## e2e

Seven files assumed the carry-to-home flow and are updated in this same PR (per
"changing logic means changing its tests"):

- **`e2e/smoke.spec.ts`** — "only reaching home (not the pickup) shows the win screen"
  inverts to "only the cinematic finishing (not just pressing E) shows the win screen":
  presses `KeyE`, asserts `#winScreen` stays hidden for 2s (cinematic must actually run),
  then polls it visible (30s timeout, no more `qaTeleportHome()` step or "Carry the child
  home" text poll).
- **`e2e/win-persist.spec.ts`** / **`e2e/mobile/win-persist.spec.ts`** — same
  `qaTeleportHome()`/"Carry the child home" poll removed from both tests; win screen is
  now polled directly off `KeyE`.
- **`e2e/replay/win.spec.ts`** — same change, retitled ("reach the child and lift her into
  the light").
- **`e2e/lul211-founder-report.spec.ts`** — same change in the "winning shows YOU WON"
  test.
- **`e2e/mission-deepwater.spec.ts`** — the "#missionPanel absent ... while carrying" case
  is unreachable now (`carrying` never goes true from real input, per Decision 2).
  Reconstructed as the reachable equivalent: the panel disappears the instant the pickup
  cinematic starts (`isPlaying()` goes false the moment `pickingUp` does, independent of
  `carrying`) and stays gone through to the win screen.
- **`e2e/mobile/interact.spec.ts`** — the "picks up and carries" test's `carrying===true`
  poll + `qaTeleportHome()` step removed; now polls `#winScreen` directly after confirming
  `pickingUp` goes true. The "out of range does nothing" test is unchanged (still asserts
  `carrying` stays `false`, which remains true).

No new engine hooks were needed — `qaTeleportNearBaby`, `qaProbeBabyLight`, and
`readObjective`/`#objective`/`#winScreen` DOM state already covered everything this spec
needed to assert. `qaTeleportHome` is left defined (harmless, still exercises the
now-dead `arriveHome()` path if ever called) but no spec calls it anymore.

**Tester scenario.** Once the PR is open, drop
`shared/local-qa/requests/LUL-2281-child-pickup-win.md` asking the nightly tester to
confirm, on desktop and one mobile viewport, that reaching the child and pressing E plays
the ascend/explode cinematic straight into the win screen with no carry-home interstitial
and no stale "carry home" HUD text — the founder-sanctioned substitute for the paused Game
Tester's play verdict. Does not block merge by itself (nightly cadence); any FAIL it files
is a high-priority ticket per the GitHub-queue rule.

**What stays manual.** Cinematic feel (ascend timing, boom position/scale, audio
crossfade) is gameplay/VFX/audio correctness — unverified by this diff's author, no
browser in this environment. Say so explicitly in the handoff.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm test` (`node --test`) — clean, including two new/updated cases in
   `lib/game/outcome.test.ts` (`completePickup` hands off to `won`, not `carrying`; new
   golden-path case for `beginPickup -> completePickup`) and `lib/game/chronicle.test.ts`'s
   updated win-line expectations.
3. `npx eslint .` — clean, specifically no `no-unused-vars` on the dropped `childGlow`
   imports or the now-dead `distHome`/`playCarryStartCue`.
4. `node scripts/check-elements-citations.mjs` — clean; the engine edits shifted line
   numbers throughout the file, so drifted `L####` citations in `ELEMENTS.md` needed
   re-syncing (`setTouchVeil()`, `veilHeld`, the `arriveHome()`/`triggerDeath()` `track()`
   call sites) — same failure mode PR #556 hit on a smaller diff.
5. `next build` — not run in this environment; run before merge if not already covered by
   CI.

## Constraints

- `computeWinPayout`, `CARRIED`/`HOME` constants, `lib/game/economy.ts` — untouched.
- `carrying`/`setDown`/`arriveHome`/`canArriveHome`/`babySetDown` state machinery and the
  engine's dead `arriveHome()`/`} else if(carrying){` branch — untouched, not deleted.
- Map generation / RNG streams — untouched, this diff has zero rng() impact.

## Out of scope

- Deleting the now-dead carry-leg machinery (`outcome.ts`, `engine/forest-engine.js`,
  `canGrabThrowable`'s stale comment) — separate, non-urgent Tier C cleanup ticket.
- Renaming/rebalancing the `HOME` ("doorstep") Embers bonus now that there's no doorstep
  leg — Game Economist's lane, flagged as a follow-up.
- Cinematic curve retuning (timings, boom scale/color) beyond the pre-LUL-1307 shape this
  reverts to — a follow-up if playtesting asks for it.
