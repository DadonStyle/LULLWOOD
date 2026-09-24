---
ticket: LUL-5077
title: Cold Walk -- opt-in checkbox works, #coldWalkPanel reads "silent" legibly with no HUD overlap while walking, win-screen embers total reflects the bonus
requested_by: Game Engineer
branch: release/next
commit: TBD (update to the merge commit when the implementing PR lands)
viewports: [desktop-1280x720, pixel5-landscape-727x393]
preconditions:
  - localStorage lullwood:settings = {"coldWalkOptIn":true}
hooks:
  - qaBuildScene({predators}): void
  - qaTeleportNearBaby(): void
steps:
  - boot qaHooks seed=20260718
  - enter
  - hook qaBuildScene({predators: []})
  - snap cold-walk-silent
  - key KeyW hold 3000
  - hook qaTeleportNearBaby()
  - key KeyE
  - wait_for $('#winScreen') !== null within 20000
  - snap cold-walk-win
expected:
  - dom "#winScreen" visible
  - dom ".emberGain" visible
  - no-overlap cold-walk-silent
  - no-overlap cold-walk-win
  - no-console-errors
screenshots: [cold-walk-silent, cold-walk-win]
model_questions:
  - cold-walk-silent: "Does the HUD show a 'Cold Walk — silent' panel that is legible and does not overlap any other HUD element?"
  - cold-walk-win: "Is the win-screen embers total legible and does it look like a normal win screen (no layout break)?"
priority_if_fails: medium
expires: 2026-10-24
status: open
---

Nightly-vision backstop for LUL-4960 (M5 Cold Walk). Spec: `docs/specs/lul-4960-cold-walk.md`.

The e2e suite (`e2e/cold-walk.spec.ts`) proves the wiring: the panel stays absent with no
opt-in, reads "silent" then flips to "broken" the instant a real Shift-sprint fires and
stays sticky after release, a sprint held through the post-pickup cinematic still pays the
bonus (checked via the win-screen payout gap, since the panel itself is hidden for that
window -- `playing` excludes `pickingUp`, same as `#missionPanel`), and a silent leg pays
`COLD_WALK_REWARD` scaled by the tier multiplier while a broken one pays nothing extra. What
it cannot prove is whether `#coldWalkPanel` actually *reads* legibly under real WebGL without
overlapping the rest of the HUD (the new "Run modifiers" Settings checkbox and `#coldWalkPanel`
are both new player-visible surfaces, per the standing local-qa rule), and whether the
win-screen embers total looks right to a human eye once the bonus is folded into it.

**Not covered by this request.** `coldWalkBrokenCue()`'s audio (falling sine) is inaudible to
this rig (`--mute-audio`, per `QA_TESTER.md`) -- stays manual. The Settings checkbox itself
(clicking it, not just seeding `lullwood:settings` directly) is not driven here; the real
checkbox-click path has no HUD-overlap risk of its own (it's inside the existing
`#settingsPanel` scroll list) so it isn't worth a second nightly scenario.

`commit` above is a placeholder -- update it to the actual merge SHA once the implementing PR
lands; the nightly runner needs a real commit to build from.
