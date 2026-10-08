---
ticket: LUL-5050
title: Slack Water -- #missionPanel reads "Slack Water" with the ○/● glyph convention across the pickup-during-active-fog-tide flow, on the real full map and mobile landscape
requested_by: Founding Engineer
branch: release/next
viewports: [desktop-1280x720, pixel5-landscape-727x393]
preconditions:
  - boot with ?qaMissionKind=slackWater so the pool draw is deterministic
hooks:
  - qaSetFogTideClock(seconds): void
  - qaTeleportNearBaby(): void
steps:
  - boot qaHooks seed=20260718 qaMissionKind=slackWater
  - enter
  - dom "#missionPanel" visible
  - dom "#missionPanel" text contains "Slack Water"
  - snap slack-water-active
  - hook qaSetFogTideClock(75)
  - hook qaTeleportNearBaby()
  - sleep 300
  - key KeyE
  - wait_for $('#winScreen') within 30000
  - record cs('#runRecap').textContent as recapText
  - snap slack-water-win
expected:
  - dom "#missionPanel" text contains "Slack Water"
  - var recapText differs from null
  - no-overlap slack-water-active
  - no-overlap slack-water-win
  - no-console-errors
priority_if_fails: medium
expires: 2026-10-24
status: open
---

## Slack Water scenario (LUL-4958 / LUL-5050)

Written per `docs/specs/lul-4958-slack-water.md`'s `## e2e` "Tester scenario" line, which named
this file but it was never actually created when the mission implemented (LUL-5050/PR#870) --
found and filed while closing LUL-4844 (which turned out to be a duplicate of the
already-shipped LUL-4958+LUL-5050 spec/implementation pair).

`#missionPanel` is not new HUD code -- `slackWater` inherits the same generic name+glyph
rendering `deepwater`/`oakHollow` already use (`components/Hud.tsx`, gated on
`state.missionKind && state.missionStatus`), so this request checks it reads legibly over the
real terrain/fog/lighting on the full map and a real mobile landscape viewport, same reasoning
`lul-4960-cold-walk.md`'s request uses for `#coldWalkPanel`.

The mechanical assertions (completion fires at `pickup()` acceptance not `finishPickup()`,
no completion outside the active window, no mission-nav hum for this kind, the +10 payout
delta) are already covered on the QA micro world by `e2e/mission-slack-water.spec.ts` (4 tests)
run on every PR -- this request is only for the full-map/mobile legibility check a headless
micro-world assertion can't see.

**Also note**: `MISSION_SLACKWATER_REWARD = 10` matches `game/economy/mission-rewards`'s
accepted number -- no placeholder-pricing caveat needed here, unlike Cold Walk's.

Delete this file once the tester has reported PASS at least once.
