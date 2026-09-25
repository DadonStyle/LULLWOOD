---
ticket: LUL-4900
title: two new mission variants (stoneMarker, radioMast) render, tick, and expire correctly in #missionPanel
requested_by: Founding Engineer
branch: release/next
viewports: [desktop-1280x720, mobile-727x393-landscape]
preconditions:
  - localStorage clear
hooks:
  - qaProbeMission(): {kind,status,x,z}|null
  - qaTeleportAtMissionTarget(): {kind,x,z,status}|null
  - qaShrinkMissionTimer(seconds): {kind,timeLimitSeconds}|null
steps:
  - boot qaHooks qaMissionKind=stoneMarker
  - enter
  - hook qaProbeMission() as stoneMission
  - snap stone-marker-panel-timer
  - hook qaTeleportAtMissionTarget() as stoneTarget
  - wait 300
  - key KeyE
  - wait 300
  - hook qaProbeMission() as stoneComplete
  - snap stone-marker-complete-glyph
  - boot qaHooks qaMissionKind=radioMast
  - enter
  - hook qaProbeMission() as radioMission
  - snap radio-mast-panel-timer
  - hook qaShrinkMissionTimer(0.5) as shrunk
  - wait 1000
  - hook qaProbeMission() as radioExpired
  - snap radio-mast-expired-glyph
expected:
  - var stoneMission.kind = "stoneMarker"
  - var stoneMission.status = "active"
  - var stoneTarget.kind = "stoneMarker"
  - var stoneComplete.status = "complete"
  - var radioMission.kind = "radioMast"
  - var radioMission.status = "active"
  - var shrunk.kind = "radioMast"
  - var radioExpired.status = "expired"
  - no-console-errors
screenshots: [stone-marker-panel-timer, stone-marker-complete-glyph, radio-mast-panel-timer, radio-mast-expired-glyph]
model_questions:
  - stone-marker-panel-timer: "Does #missionPanel show 'Stone Marker' with a hollow-circle glyph AND a ticking m:ss countdown next to it?"
  - stone-marker-complete-glyph: "Has the glyph next to 'Stone Marker' changed to a filled dot?"
  - radio-mast-panel-timer: "Does #missionPanel show 'Radio Mast' with a hollow-circle glyph AND a ticking m:ss countdown next to it?"
  - radio-mast-expired-glyph: "Has the glyph next to 'Radio Mast' changed to an X/cross mark?"
priority_if_fails: medium
expires: 2026-10-25
status: open
---
Written with the implementation, ticket LUL-4900 (both LUL-4646 cheap-slice missions,
wiki decisions/stone-marker-radio-mast-accepted-2026-09-23). Both missions reuse 100% of the
existing mission UI/completion/audio -- no new EngineHudState fields, no new HUD elements, no
new inputs -- so the mechanical assertions (panel presence, glyph state, timer text shape,
completion, expiry status transition, win payout with/without the forfeited bonus) are already
covered end-to-end by e2e/mission-stone-marker.spec.ts and e2e/mission-radio-mast.spec.ts, run
on every PR. This request is for the one thing a headless assertion can't see: whether the two
new mission names/glyphs/timers actually *read* right to a human at a glance, on both desktop
and one mobile-landscape viewport -- same convention as lul-3010-mission-progression.md's
original request for oakHollow/deepwater.

The `*-expired-glyph` screenshot is taken ~1s after qaShrinkMissionTimer(0.5) -- the real
per-tick checkMissionExpiry() trips on the next frame once survived time passes the shrunk
0.5s limit, same real-path mechanism the e2e specs' own expiry tests drive (no status is set
directly by the hook).

Delete this file once LUL-4900 ships and the tester has reported PASS at least once.
