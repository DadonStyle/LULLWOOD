---
ticket: LUL-5166
title: #actionSlot's JUMP (chargePrompt) row stays fully onscreen with every forceable row live at once -- desktop, Pixel 5 landscape, iPhone SE landscape
requested_by: Game Engineer
branch: release/next
viewports: [desktop-1280x720, pixel5-landscape-727x393, iphone-se-landscape-667x375]
preconditions: []
hooks:
  - qaSetFixedStep(dt): void
  - qaAdvance(steps): void
  - qaForceAllActionRows(): void
steps:
  - boot qaHooks seed=20260718
  - enter
  - hook qaSetFixedStep(0.02)
  - hook qaForceAllActionRows()
  - hook qaAdvance(1)
  - snap all-rows-forced
expected:
  - dom "#chargePrompt" visible
  - no-overlap all-rows-forced
  - no-console-errors
screenshots: [all-rows-forced]
priority_if_fails: high
expires: 2026-10-25
status: open
---

## #actionSlot row-count regression check (LUL-5166)

Original finding (local-qa-fingerprint `layout-a9ddf9368c`): on `mobile-pixel5-landscape`, in the
`charge` state, `span.actionPromptKey "JUMP"` (the `#chargePrompt` keycap) rendered fully above
`y=0` -- offscreen. Root cause: `#actionSlot`'s `grid-template-rows`/`--action-slot-height`
(`components/GameCanvas.tsx`) declared 6 tracks (1 charge + 5 regular) while `Hud.tsx` actually
mounts 10 `<ActionPrompt>` rows (1 charge + 9 regular) -- `veilOverloadPrompt`, `veilPrompt`,
`climbPrompt` and `chapelSanctuaryPrompt` were each added in later PRs with no matching grid-track
update. The unaccounted rows fell into implicit content-sized tracks, growing the (bottom-anchored)
slot taller than assumed and pushing its topmost row off the top of a short viewport once enough
rows were simultaneously live.

Fixed by extending the grid to 10 tracks and re-solving the `max-height:420px` row/gap shrink for
the same total footprint. Also extended the existing `qaForceAllActionRows()` QA hook and
`e2e/action-prompt.spec.ts`'s micro-world overlap assertion from 5 to 9 of the 10 rows (was
missing exactly the three rows implicated here) -- that spec runs on every PR and is the permanent
regression gate; this request is for the thing the micro world can't see: the real grid CSS
computing a box that still fits inside the real, tighter mobile viewports this bug was reported on.

`no-overlap all-rows-forced` is the direct re-check of the reported condition -- all 9 forceable
rows (everything except `pickupPrompt`, mutually exclusive with `throwPrompt`) live at once is a
superset of the "charge + hide/veil + climb" combination the original audit caught, on the exact
viewport (`pixel5-landscape-727x393`) it was caught on, plus the tighter `iphone-se-landscape` and
a desktop sanity check.

Delete this file once LUL-5166 ships and the tester has reported PASS at least once.
