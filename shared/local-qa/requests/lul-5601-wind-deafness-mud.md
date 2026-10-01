---
ticket: LUL-5605
title: a roaming wolf standing in a Mud Zone hears through the wind-assisted sprint discount, on the real browser
requested_by: Game Engineer
branch: release/next
commit: d7897e55c3bbaa6472d5c12bea8206b5d42f0c1d
viewports: [desktop-1280x720]
preconditions: []
hooks:
  - qaSetFixedStep(dt): void
  - qaBuildScene(scene): {trees:number, props:number, predators:number}
  - qaStageWalkIntoCover(kind): {prop:{...}, start:{x:number,z:number}} | null
  - qaSetWindDirection(x, z): void
  - qaAdvance(steps, skipFinalRender): void
  - qaProbePlayer(): {x:number, z:number, yaw:number, sprintWindBonusActive:boolean}
  - qaStagePredatorNearPlayer(kind, dx, dz): {idx:number, x:number, z:number} | null
  - qaProbePredatorState(kind): {state:string, ...}
steps:
  - boot qaHooks seed=20260718
  - enter
  - hook qaSetFixedStep(0.02)
  - hook qaBuildScene({"predators":[{"kind":"wolf","x":0,"z":-20,"state":"roam"}],"props":[{"kind":"rock","x":2.95,"z":0}],"mudZones":[{"x":0,"z":-20,"r":5}]})
  - hook qaStageWalkIntoCover('rock') as staged
  - hook qaSetWindDirection(-1, 0)
  - key ShiftLeft down
  - key KeyW down
  - hook qaAdvance(1, true)
  - hook qaProbePlayer() as sprintState
  - poll (FE.qaStagePredatorNearPlayer('wolf', -staged.start.x, -20 - staged.start.z), FE.qaAdvance(1, true), window.__wolfState = FE.qaProbePredatorState('wolf').state) every 20 until window.__wolfState !== 'roam' within 8000
  - key KeyW up
  - key ShiftLeft up
  - record window.__wolfState as wolfState
  - snap post-mud-hearing-state
expected:
  - var sprintState differs from null
  - expr sprintState.sprintWindBonusActive is true
  - var wolfState differs from null
  - var wolfState = "investigate"
  - no-console-errors
screenshots: [post-mud-hearing-state]
priority_if_fails: medium
expires: 2026-10-30
status: open
---

Filed with LUL-5605 (CTO-corrected plan on the ticket, mechanism LUL-5596). The mechanical claim
-- a roaming predator standing in a Mud Zone (LUL-5564) overrides the player's Wind-Assisted
Evasion (LUL-3149) footstep discount back to the plain `NOISE_RADIUS_RUN`, because
`updatePredators()`'s footstep channel checks `(predInMud && windAssist) ? NOISE_RADIUS_RUN :
noiseRadius` (`engine/forest-engine.js:2914`) -- is already covered end-to-end, deterministically,
by `e2e/wind-deafness-mud.spec.ts`: both the positive case (wolf in mud hears a 20u wind-assisted
sprint) and the companion negative case (the identical sprint at the same 20u offset, wolf outside
any mud zone, never heard) run on every PR against the QA micro world, same split as every other
`## e2e` + local-qa-request pair in this codebase (e.g. LUL-3149's own wind-assisted-evasion
request above this file in the same directory).

This request covers only the positive (in-mud) case, not the full-boot's doubled scenario, since
the per-tick repeated `qaStagePredatorNearPlayer`/`qaAdvance`/probe loop needed for the 8-second,
probabilistic-hearing-roll window (the same `(1-0.5*0.02)^400 ~= 1.8%` flake budget
`e2e/wind-assisted-evasion.spec.ts` already documents) is encoded here as a single `poll` step with
a compound expression, not an unrollable fixed step sequence -- a second `poll` block for the
negative case would just be the inverse assertion (`wolfState = "roam"` after the same window)
proving the same mud-gate the e2e spec's own negative test already proves deterministically, with
no additional visual/HUD surface to check. There is no player-visible state here at all (predator-
internal only, per the ticket's own Q15/cue-triple answer: "not player-initiated, the founder's
cue-triple rule doesn't apply") -- `post-mud-hearing-state` is a plain third-person screenshot for
a human glance at the staged scene (wolf, mud-zone-adjacent terrain, player frozen against the
rock), not something a vision-model question can usefully judge; no `model_questions` are set.

Delete this file once LUL-5605 ships and the tester has reported PASS at least once.
