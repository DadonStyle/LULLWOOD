---
ticket: LUL-3264
title: leaderboard record line on the gate does not overlap or shift the gate layout (unconfigured build -> line hidden)
requested_by: Founding Engineer
branch: release/next
viewports: [desktop-1280x720, pixel5-landscape-727x393, iphone-se-landscape-667x375]
preconditions: []
hooks: []
steps:
  - boot qaHooks seed=20260718
  - dom "#gate" visible
  - snap gate-with-leaderboard
expected:
  - no-overlap gate-with-leaderboard
---

The tester's local build has no `LEADERBOARD_API_*` env, so `/api/leaderboard/current` answers
`{ unavailable: true }` and the line is hidden. This scenario guards the gate layout (no overlap, no
console error from the fetch) on the three viewports. The populated/empty/cached states and the
Blackout-only submit form are covered by `e2e/leaderboard-menu.spec.ts` and
`e2e/leaderboard-submit.spec.ts` with stubbed responses.
