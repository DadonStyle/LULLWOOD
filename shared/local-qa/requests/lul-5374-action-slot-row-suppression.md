---
ticket: LUL-5374
title: actionSlot short-landscape row suppression chain -- all 9 rows, no overlap
requested_by: Game Engineer
branch: release/next
viewports: [pixel5-landscape-727x393, iphone-se-landscape-667x375]
hooks:
  - qaSetFixedStep(dt): void                    # existing
  - qaAdvance(steps): void                      # existing
  - qaForceAllActionRows(): void                # existing, engine/forest-engine.js:6027
steps:
  - boot qaHooks seed=20260718
  - enter
  - hook qaSetFixedStep(0.02)
  - hook qaAdvance(1)
  - hook qaForceAllActionRows()
  - snap all-rows-forced
expected:
  - dom "#chargePrompt" visible
  - no-overlap all-rows-forced
  - no-console-errors
priority_if_fails: high
expires: 2026-12-31
status: open
---

LUL-5374 generalizes LUL-5246's single `#objective`-yields-to-`#actionPrompt` short-landscape
suppression rule (GameCanvas.tsx's `@media (max-height: 420px) ...` block) to all 9 regular
`#actionSlot` rows, per the priority order CTO decision on LUL-5373: chargePrompt > objective >
actionPrompt > veilOverloadPrompt > veilPrompt > throwPrompt > pickupPrompt > climbPrompt >
chapelSanctuaryPrompt > status. `qaForceAllActionRows()` forces every regular row's underlying
engine-state flag true at once (the worst case) -- by design, only the single
highest-priority currently-live row (`#chargePrompt`) should keep a visible `.actionPromptLine`
pill at this breakpoint after the suppression chain runs; every other row's line should collapse
to `display:none` while its own grid track stays reserved (no layout shift). `no-overlap` on the
`all-rows-forced` snapshot is this ticket's own regression gate: it must find zero intersecting
`.actionPromptLine` boxes on both viewports. See docs/specs/lul-5374-action-slot-full-row-
suppression.md for the full collision matrix and per-pair real-co-occurrence reasoning this fix
is built from, and e2e/action-prompt.spec.ts's own Playwright coverage (same assertion, run
headless in CI) for the mechanical proof this request re-verifies against a live nightly render.
