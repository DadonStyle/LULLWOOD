# LUL-5442: Roost Sprint Cooldown Denial Cue

Accepted cheap slice of LUL-5439. See wiki
`decisions/lul-5439-roost-sprint-denial-cue-accepted-2026-09-30` and
`game/mechanics/roost-sprint-denial-cue` for Section 0 answers.

## Gap

Throw-into-cooling-roost gets an audio+caption denial via `roostFlushDeniedCue()`
(LUL-5412, `engine/forest-engine.js:6603`). Sprint-into-cooling-roost only got the
silent `#roostCooldownPanel` countdown — no audio/caption tell when the player is
actively refused.

## Fix

`updateRoosts()` (`engine/forest-engine.js:3093-3102`): the early-continue branch for
a roost already on cooldown now checks, when `running` is true and the player is
within `ROOST_TRIGGER_RADIUS` of that roost, whether the denial cue has already
played for this approach (`roostSprintDeniedPlayed[i]`, a new `Uint8Array` debounce
flag mirroring the existing `staminaLowCuePlayed` hysteresis pattern). If not, it
calls the same `roostFlushDeniedCue()` used by the throw path. The flag resets to 0
the moment the player leaves the radius or stops sprinting, so a fresh approach fires
the cue again. No new state is rendered — `roostCooldownActive`/`roostCooldownTimeLeft`
(LUL-5412) already covers the visible readout for both trigger paths.

Reset in `restart()` alongside `roostCooldown` (`engine/forest-engine.js:6766`).

## Cues

- **Audio**: `roostFlushDeniedCue()`'s existing square/100Hz/~0.17s buzz — unchanged,
  reused verbatim.
- **Caption**: `roostFlushDeniedCue()`'s existing "that roost is still resettling from
  the last flush" caption — unchanged, reused verbatim, gated on `captionsOn` same as
  the throw path.
- **Visual**: none added — `#roostCooldownPanel`'s countdown (LUL-5412) is the
  persistent-state surface; this ticket only adds the edge-triggered refusal tell.

## e2e

`e2e/roost-flush.spec.ts` — new `describe('roost flush -- sprint-into-cooldown denial
cue (LUL-5442)')` block, 3 tests, all staging a wolf predator via `qaBuildScene` (kept
passive/`roam`, out of noise range, so it never itself triggers a flush — the point is
the player's own repeated-sprint denial path per FEATURE_CHECKLIST Q11/Q12):

1. Sprint flushes and starts cooldown, leave/return, sprint again inside cooldown →
   `qaProbeRoostState(i).deniedCueCount` increments by exactly 1 (edge-triggered).
2. Holding sprint inside the radius for several seconds after the initial flush does
   not refire the cue per tick (debounce holds while continuously true).
3. Sprinting into a cooling roost from outside `ROOST_TRIGGER_RADIUS` does not fire
   the cue (distance-gated).

All three run on the micro world via `qaBuildScene`/`qaTeleportTo`, no `@fullmap`.

## What stays manual

Audible buzz timbre and caption legibility — confirmed by the existing LUL-5412
QA request precedent; this ticket's own request file covers the sprint path
specifically.
