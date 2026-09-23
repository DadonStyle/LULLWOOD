---
ticket: LUL-3066
title: hide reposition (KeyR / touch Shuffle) shifts the player within the same cover footprint, silent upwind, noisy + alert-inducing downwind
requested_by: Founding Engineer
branch: release/next
viewports: [desktop-1280x720, pixel5]
preconditions: []
hooks:
  - qaBuildScene(props): void
  - qaTeleportToHideSpot(kind): {x:number, z:number}|null
  - qaSetWindDirection(x, z): void
  - qaStagePredatorNearPlayer(kind, dx, dz): void
  - qaProbePredatorState(kind): {state:string}|null
steps:
  - boot qaHooks seed=20260923
  - enter
  - hook qaBuildScene({props:[{kind:'bramble',x:10,z:0}]})
  - hook qaTeleportToHideSpot('bramble') as spot
  - key KeyH
  - hook qaSetWindDirection(1, 0)
  - hook qaStagePredatorNearPlayer('wolf', 5, 0) as staged
  - key KeyW
  - key KeyR
  - dom "#status" visible
  - snap shuffle-upwind
  - hook qaProbePredatorState('wolf') as afterUpwind
  - hook qaSetWindDirection(0, 1)
  - hook qaStagePredatorNearPlayer('wolf', 5, 0)
  - key KeyR
  - snap shuffle-downwind
  - hook qaProbePredatorState('wolf') as afterDownwind
expected:
  - var spot differs from null
  - var staged differs from null
  - var afterUpwind differs from null
  - expr afterUpwind.state == "roam"
  - var afterDownwind differs from null
  - expr afterDownwind.state != "roam"
  - no-overlap shuffle-upwind
  - no-overlap shuffle-downwind
  - no-console-errors
screenshots: [shuffle-upwind, shuffle-downwind]
priority_if_fails: medium
expires: 2026-10-23
status: open
---
LUL-3066 (CEO revival 2026-09-18, Section-0 answered via `suggest_tasks`): Hide Reposition /
Wind-Gated Shuffle. `KeyR` while hidden shifts the player within the same cover footprint —
silent and undetected upwind, noisy and alert-inducing to nearby roam-state predators
downwind, on a `SHUFFLE_COOLDOWN_S` cooldown. Full design: `docs/specs/lul-3066-hide-
reposition.md`.

This request checks the real full-map render/overlap surface (rustle-flash vignette, the
transient "Shifted position" / "Shifted position — noisy" caption toast, no HUD overlap) at
both a desktop and a mobile viewport, which the repo's own micro-world `e2e/hide.spec.ts`
cases (upwind/downwind/cooldown/mobile-button, deterministic, headless) don't cover.

**Needs `qaSetWindDirection`/`qaStagePredatorNearPlayer`/`qaProbePredatorState`, all already
landed** — this request should run clean once the implementation PR
(`shuffleHide()`/`triggerTouchShuffle()`) merges; will report `NEEDS-HOOK` on any nightly
run before then only if the implementer's chosen position-probe hook name differs from what
the merged `e2e/hide.spec.ts` cases end up using (this file predates that choice — re-check
the `steps` list against the merged spec if it reports `NEEDS-GRAMMAR`).
