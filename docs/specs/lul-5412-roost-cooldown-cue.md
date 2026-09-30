# SPEC: LUL-5412 Roost cooldown cue

**Ticket:** LUL-5412 (carrier for LUL-5408, Feature Scout's accepted proposal) · **Tier:** C —
`engine/forest-engine.js` touched (`engine/**` is unconditionally Tier C per `pr-tier.mjs:68`,
no exception for additive HUD wiring). Needs `REVIEW: APPROVED` before merge.

**Written against:** `release/next` @ HEAD as of 2026-09-30 (LUL-5421/LUL-5420 backmerge era).

## Files

- `engine/forest-engine.js` — edited: per-frame nearest-roost-cooldown proximity check,
  two new HUD state fields (`roostCooldownActive`/`roostCooldownTimeLeft`), a new
  `roostFlushDeniedCue()` function, wired into `throwThrowable()`'s existing denial branch,
  and a `deniedCueCount` field added to the existing `qaProbeRoostState()` QA hook.
- `engine/forest-engine.d.ts` — edited: `qaProbeRoostState()`'s return type gains
  `deniedCueCount: number`.
- `components/Hud.tsx` — edited: `EngineHudState` gains `roostCooldownActive`/
  `roostCooldownTimeLeft`, initial state default, and a new `#roostCooldownPanel` sibling of
  `#caveImmunePanel`/`#chapelSanctuaryPanel`.
- `e2e/roost-cooldown-cue.spec.ts` — created.
- `docs/ELEMENTS.md` — edited: "Startled roosts" section gains the cooldown-cue paragraph.

## The change

`roostCooldown[i]` (`engine/forest-engine.js:1610`) was already shared by the ambient
predator-proximity path (`updateRoosts()`, `:3081-3097`) and the player-throw path
(`throwThrowable()`, `:6263-6281`), but no HUD field surfaced it and the throw path silently
no-op'd when the roost was already cooling down. This ticket adds the missing readout and
denial tell, following the caveImmune/rockClimb/chapelSanctuary precedent shape exactly —
no new engine system.

1. **Per-frame proximity** (`:7492-7499`): each frame, finds the nearest roost within
   `ROOST_TRIGGER_RADIUS` (6 units — the existing player-side flush-trigger radius, reused
   rather than adding a second roost-proximity constant) of the player and reads its live
   `roostCooldown[]` entry into `nearestRoostCooldownT`. Re-derived fresh every frame, same
   as `investigationDownwindActive` (LUL-5402) — no persisted per-roost flag to keep in sync.
2. **HUD push** (`:7663-7664`, and the `else`-branch reset at `:7686`): `roostCooldownActive:
   nearestRoostCooldownT > 0, roostCooldownTimeLeft: nearestRoostCooldownT`, same call
   convention as `caveImmuneActive`/`caveImmuneTimeLeft` immediately above it.
3. **Denial cue** (`roostFlushDeniedCue()`, `:6582-6592`): mirrors `rockClimbDeniedCue()`'s
   exact shape — square/100Hz/~0.17s buzz gated on `soundOn`, plus a caption ("that roost is
   still resettling from the last flush") gated on `captionsOn`, both fired unconditionally
   on every denied press. Wired at `:6278` — `throwThrowable()`'s existing `if(nearestRoost
   >= 0 && roostCooldown[nearestRoost] <= 0){...}` block gains an `else if(nearestRoost >=
   0)` branch that calls it, so a throw that would have hit a cooling-down roost gets a
   refusal tell instead of a silent no-op.
4. **QA visibility**: `qaProbeRoostState(i)` (`:5862-5864`) gains `deniedCueCount`, sourced
   from the new global `qaRoostFlushDeniedCueCount` — global, not per-roost, since the tell
   itself doesn't vary by which roost was targeted (same idiom as
   `qaVeilOverloadDeniedCueCount`/`qaRockClimbDeniedCueCount`).

**Q5 (first-encounter hint for the panel itself): skipped.** The denial cue's own caption
already carries the "why" tell the moment it matters (the throw attempt); a separate
first-encounter hint for the panel would duplicate that explanation before the player has
done anything wrong. No `HINT_PRIORITY` entry added.

## Verification

- `node --check engine/forest-engine.js` — no syntax errors.
- `npx tsc --noEmit` — clean except the pre-existing `app/layout.tsx` baseline error.
- `npx eslint engine/forest-engine.js engine/forest-engine.d.ts components/Hud.tsx` — clean.
- `npx playwright test e2e/roost-cooldown-cue.spec.ts` — all 5 tests pass.
- `node scripts/check-elements-citations.mjs` (or repo's equivalent) — 0 drifted citations.

## e2e

**Specs.** `e2e/roost-cooldown-cue.spec.ts` (new, 5 tests):
- "an ambient flush puts the mission roost on cooldown and shows #roostCooldownPanel with a
  countdown" — stages a real `state: 'chase'` wolf via `qaStagePredatorNearPlayer` +
  `qaSetPredatorChasing` next to the mission's target roost, asserts the panel renders and
  its countdown text changes over a further 3s window.
- "walking well away from the cooled-down roost hides the panel again" — proximity-gate
  proof (teleports to a roost >6u away).
- "a throw at the cooled-down mission roost is denied and does not complete the mission" —
  the opposing-system proof: `canCompleteFlush()` must never be reached (mission stays
  `'active'`), and `deniedCueCount` increments exactly once.
- "captionsOn=true: the denied throw fires a caption distinct from the roostThrowCue hint" —
  asserts the exact denial caption text and that it is NOT the pre-existing
  `roostThrowCue` hint string.
- "reducedMotion=true: the panel still renders and the denied throw still fires its audio
  tell (no motion to withhold)" — neither cue has an animated component, so `reducedMotion`
  must not suppress either.

**World.** micro (default). Stages one wolf via `qaStagePredatorNearPlayer('wolf', 5, 0)` +
`qaSetPredatorChasing('wolf')`, positioned via `qaTeleportNearRoost(0)` — same staging
`e2e/mission-flush.spec.ts`'s own ambient-chase-proximity test already uses. No
`@fullmap` — `qaMissionKind: 'flush'`/`qaRoostIndex: 0` pin the mission's target
deterministically.

**Hooks.** All existing: `qaTeleportNearRoost`, `qaStagePredatorNearPlayer`,
`qaSetPredatorChasing`, `qaProbeMission`, `qaTeleportNearThrowable`. One hook extended (not
new, no `.d.ts` new-entry beyond the return-type widening): `qaProbeRoostState(i)` gains
`deniedCueCount`.

**Tester scenario.** `shared/local-qa/requests/lul-5412-roost-cooldown-cue.md` (filed with
this spec, Q13) — checks `#roostCooldownPanel` renders with a countdown on mobile landscape
and that a denied throw shows no console errors.

**Not covered.** Feel/audio quality of the denial buzz, and whether the panel's placement
overlaps other HUD rows on every breakpoint (existing `#actionSlot`/panel-stacking
regression suite, not this ticket's scope) stay manual/local-qa's call.

## Cues

**Visual.** `#roostCooldownPanel` (`components/Hud.tsx:1096-1099`), sibling of
`#caveImmunePanel`/`#chapelSanctuaryPanel` outside `#panel` (stays visible with `adminMode`
off, Q3): "Roost quiet · Xs" countdown while `roostCooldownActive`.
**Audio.** `roostFlushDeniedCue()` (`engine/forest-engine.js:6582`) — square oscillator,
100Hz, ~0.17s, gated on `soundOn`.
**Explanation.** "that roost is still resettling from the last flush", fired every denied
press (not one-shot), gated on `captionsOn`, same call site as the audio cue.
**Reduced motion.** Static text, no animation to reduce — same as `#caveImmunePanel`/
`#chapelSanctuaryPanel`'s own countdown text, which also has no `reducedMotion` gating.

See `decisions/0015-cue-triple` on the wiki.

## Constraints

Tier C (`engine/forest-engine.js` touched) — needs Code Reviewer's blocking
`REVIEW: APPROVED` before merge. No change to `roostCooldown[]`'s existing semantics or to
either of the two triggers that set it (ambient/player-throw) — this ticket only adds a
readout and a denial tell for the existing shared state.

## Out of scope

The player-sprint noise trigger (LUL-2389 slice b) is a third path into the same
`roostCooldown[]` array but doesn't go through `throwThrowable()`, so it never hits the new
denial branch — sprinting into an already-cooling-down roost was already a silent no-op
before this ticket and stays one; the panel is the only tell for that path, same as for the
ambient path. Not touched: any change to `ROOST_COOLDOWN`'s duration, `ROOST_TRIGGER_RADIUS`,
or the roost sites themselves.
