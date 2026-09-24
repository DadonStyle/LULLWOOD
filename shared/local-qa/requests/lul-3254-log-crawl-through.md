---
ticket: LUL-4994
title: Log Crawl-Through -- crouch/camera-drop reads as a crawl, first-encounter caption renders without HUD overlap, desktop and Pixel 5 landscape
requested_by: Game Engineer
branch: release/next
commit: TBD (update to the merge commit when the implementing PR lands)
viewports: [desktop-1280x720, pixel5-landscape-727x393]
preconditions:
  - localStorage clear                 # first crawl this browser -> hintSeen('logCrawl') caption must fire
hooks:
  - qaBuildScene({props, predators}): void
  - qaTeleportTo(x, z): void
  - qaPlayerState(): {x:number, z:number, inLogCrawl:boolean, logCrawlExitX:number, logCrawlExitZ:number}
steps:
  - boot qaHooks seed=20260924
  - enter
  - hook qaBuildScene({props: [{kind: 'log', x: 10, z: 0, ry: 0}], predators: []})
  - hook qaTeleportTo(6.15, 0)
  - key KeyD down
  - wait_for FE.qaPlayerState().inLogCrawl === true within 3000
  - snap log-crawl-active
  - wait_for FE.qaPlayerState().inLogCrawl === false within 5000
  - snap log-crawl-exit
  - key KeyD up
expected:
  - dom #captionToast visible
  - no-overlap log-crawl-active
  - no-overlap log-crawl-exit
  - no-console-errors
screenshots: [log-crawl-active, log-crawl-exit]
model_questions:
  - log-crawl-active: "Does the camera sit noticeably lower than a normal standing view, reading as a crouch/crawl through the log, and is the caption text at the bottom legible and not overlapping the HUD?"
  - log-crawl-exit: "Has the camera returned to its normal standing height, with no crawl caption or crouch effect lingering after the log?"
priority_if_fails: medium
expires: 2026-10-24
status: open
---

Nightly-vision backstop for LUL-4527 (Log Crawl-Through). Spec:
`docs/specs/lul-4527-log-crawl-through.md`.

The e2e suite (`e2e/log-crawl.spec.ts`) proves the wiring: `inLogCrawl` flips true on approach
and false at the far mouth, scent deposit is suppressed for the whole crossing (checked directly
against `qaProbeScentTrail().livePoints`, the raw deposit count — sight/noise are untouched by
this feature and a nearby predator during the crossing would confound the check, see the spec's
file header), and a predator staged close once the player re-emerges picks up the resumed trail.
What it cannot prove is
whether the eye-height crouch actually *reads* as a crawl under real WebGL, and whether the
first-encounter caption ("Crawling through the log -- you can't sprint or turn until you're
through.") renders legibly without overlapping the rest of the HUD -- both are exactly the
kind of real-rendering questions software WebGL in the Playwright rig can silently get wrong
even when the underlying state is correct.

**Not covered by this request.** The enter/exit scrape cues (`logCrawlEnterCue()` /
`logCrawlExitCue()`) and the sprint-refusal tell (`logCrawlDeniedCue()`) are inaudible to this
rig -- it runs `--mute-audio` (per `QA_TESTER.md`) and can only check `qaProbeAudio().state`,
not whether a cue is audible or timbrally distinct from `thornSnagSound()`. That check stays
manual, per the SPEC's own "Not covered" section.

`commit` above is a placeholder -- update it to the actual merge SHA once the implementing PR
lands; the nightly runner needs a real commit to build from.
