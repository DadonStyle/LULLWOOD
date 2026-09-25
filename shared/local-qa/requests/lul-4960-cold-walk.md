---
ticket: LUL-5077
title: Cold Walk -- opted-in player never sprints on the outbound leg, #coldWalkPanel reads silent throughout and the win-screen embers total reflects the bonus, on the real full map and mobile landscape
requested_by: Game Engineer
branch: release/next
viewports: [desktop-1280x720, pixel5-landscape-727x393]
preconditions:
  - localStorage lullwood:settings = {"coldWalkOptIn":true}
hooks:
  - qaTeleportNearBaby(): void
steps:
  - boot qaHooks seed=20260718
  - enter
  - dom "#coldWalkPanel" visible
  - snap cold-walk-silent
  - hook qaTeleportNearBaby()
  - sleep 300
  - key KeyE
  - wait_for $('#winScreen') within 30000
  - record cs('.emberGain').textContent as emberText
  - snap cold-walk-win
expected:
  - dom "#coldWalkPanel" text contains "silent"
  - var emberText differs from null
  - no-overlap cold-walk-silent
  - no-overlap cold-walk-win
  - no-console-errors
priority_if_fails: medium
expires: 2026-10-24
status: open
---

## Cold Walk scenario (LUL-4960 / LUL-5077)

Written with the implementation, per `docs/specs/lul-4960-cold-walk.md` and `docs/ELEMENTS.md`'s
"Cold Walk" entry. New player-visible panel (`#coldWalkPanel`) and Settings checkbox ("Run
modifiers" fieldset), filed per the standing local-qa rule for new player-visible surfaces.

The mechanical assertions (panel absent when not opted in, silent -> broken text swap on a real
sprint keypress, sticky-for-the-run, no break during the pickup cinematic, payout gap on win)
are already covered on the QA micro world by `e2e/cold-walk.spec.ts` (4 tests) run on every PR
-- this request is for the thing a micro-world headless assertion can't see: `#coldWalkPanel`
actually legible over the real terrain/fog/lighting on the full map, on both desktop and a real
mobile landscape viewport, and the win-screen embers total genuinely including the bonus.

**Also check** (manual, not part of the pass/fail assertion): `coldWalkBrokenCue()`'s falling
sine (320->140Hz) reading as audibly distinct from `rockClimbEndCue()`/`veilOverloadEndCue()`,
and the caption ("sprinted — the cold walk is broken") appearing with `captionsOn=true`.

**Also note**: `COLD_WALK_REWARD = 8` is an explicit placeholder, not final pricing (see the
SPEC's Design call) -- a follow-up Game Economist ticket owns the real number. This request is
about the mechanic working, not the value being correct.

Delete this file once LUL-5077 ships and the tester has reported PASS at least once.
