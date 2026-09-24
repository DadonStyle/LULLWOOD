---
ticket: LUL-5005
title: chapel sanctuary -- a full 15s dwell at the chapel steeple grants veilReserve for free on the real full map, with the interact prompt and countdown panel visible throughout, mobile tap parity included
requested_by: Game Engineer
branch: release/next
viewports: [desktop-1280x720, pixel5-landscape-727x393]
preconditions: []
hooks:
  - qaTeleportNearChapel(): {x:number, z:number}
  - qaProbeChapelSanctuary(): {chapelSanctuaryActive:boolean, chapelSanctuaryChargeT:number, chapelSanctuaryUsedThisRun:boolean, promptVisible:boolean, startCueCount:number, deniedCueCount:number, earlyExitCueCount:number}
  - qaProbeVeil(): {charge:number, locked:boolean, reserve:boolean, releaseCueCount:number}
  - qaSetFixedStep(dt): void
  - qaAdvance(steps): void
steps:
  - boot qaHooks seed=20260718
  - enter
  - hook qaProbeVeil() as veil0
  - hook qaTeleportNearChapel() as chapel
  - dom "#chapelSanctuaryPrompt" visible
  - key KeyE
  - hook qaProbeChapelSanctuary() as mid
  - dom "#chapelSanctuaryPanel" visible
  - snap chapel-sanctuary-active
  - hook qaSetFixedStep(0.02)
  - hook qaAdvance(775)
  - hook qaProbeChapelSanctuary() as after
  - hook qaProbeVeil() as veil1
  - snap chapel-sanctuary-granted
expected:
  - var chapel differs from null
  - expr veil0.reserve is false
  - var mid differs from null
  - expr mid.chapelSanctuaryActive is true
  - expr mid.startCueCount == 1
  - var after differs from null
  - expr after.chapelSanctuaryActive is false
  - expr after.chapelSanctuaryUsedThisRun is true
  - var veil1 differs from null
  - expr veil1.reserve is true
  - no-overlap chapel-sanctuary-active
  - no-overlap chapel-sanctuary-granted
  - no-console-errors
priority_if_fails: medium
expires: 2026-10-24
status: open
---

## Chapel Sanctuary scenario (LUL-5005)

Written with the implementation, per `game/mechanics/chapel-sanctuary.md`'s cheap-slice code
diff (State & Engine items 1-10) and `docs/ELEMENTS.md`'s "Chapel Sanctuary" entry. Retargeted
2026-09-24 (CEO ruling, `decisions/chapel-sanctuary-retarget-veilreserve-2026-09-24`) from an
earlier `veilCharge` premise that was false -- this feature grants `veilReserve = true` for
free, one-shot-per-run, a second route to the same resource the Stone Marker charm
(`buyVeilCharm()`) already sells for Embers.

The mechanical assertions above (dwell start on `KeyE`, prompt/panel visibility, full-dwell
grant, one-shot gate closing) are already covered on the QA micro world by
`e2e/chapel-sanctuary.spec.ts` (6 scenarios: full-dwell grant, early-exit-grants-nothing,
denied-cue-after-already-granted, HUD countdown, `captionsOn=true` entry caption,
`reducedMotion=true` grant-cue-still-fires, plus a mobile `touchInteract` tap-parity test) run
on every PR -- this request is for the thing a micro-world headless assertion can't see: the
same start/grant/HUD sequence holding up on the real 480u map at the chapel's actual placement
(`x:20, z:-178`, deep in the outer ring), with `#chapelSanctuaryPrompt`/`#chapelSanctuaryPanel`
actually legible over the real terrain, fog and lighting, on both desktop and a real mobile
landscape viewport.

`qaAdvance(775)` = 775 * 0.02s = 15.5s of fixed-dt sim time, 0.5s past
`CHAPEL_SANCTUARY_DURATION` (15s, `engine/tuning.js`) with margin for the frame the edge fires on.

**Also listen for** (manual, not part of the pass/fail assertion): the grant cue
(`embersPurchaseCue()`, reused from `buyVeilCharm()`) reading identically to a real Stone Marker
purchase, and the entry cue (`chapelSanctuaryStartCue()`) reading as audibly distinct from both
the grant cue and `rockClimbStartCue()`, the closest existing analog -- same class of
manual-only check as LUL-3150's veil-overload cue note.

**Also check** (manual): the early-exit path (leave the chapel's radius mid-dwell) is not
exercised on the real map by the `steps:` above -- covered structurally in the e2e spec's
"leaving the radius before the dwell completes" test, not visually here. If a tester wants to
confirm it live: walk into the chapel, press E, walk away before 15s, and watch for the quiet
"nothing happened" tell instead of the grant cue.

Delete this file once LUL-5005 ships and the tester has reported PASS at least once.
