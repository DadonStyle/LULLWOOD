---
ticket: LUL-5558
title: mud zone slows the player, raises their footstep noise, shows #mudPrompt, and lets a roaming wolf hear a walk it could not hear on dry ground
requested_by: Game Engineer
branch: release/next
viewports: [desktop-1280x720, pixel5-landscape-727x393]
preconditions: []
hooks:
  - qaSetFixedStep(dt): void
  - qaBuildScene(scene): {trees:number, props:number, predators:number}
  - qaTeleportTo(x, z): void
  - qaPlayerState(): {x:number, z:number, inMudZone:boolean, ...}
  - qaStagePredatorNearPlayer(kind, dx, dz): {idx:number, x:number, z:number} | null
  - qaProbePredatorState(kind): {state:string, ...}
  - qaAdvance(steps, skipFinalRender): void
steps:
  - boot qaHooks seed=20260718
  - enter
  - hook qaSetFixedStep(0.02)
  - hook qaBuildScene({"predators":[{"kind":"wolf","x":17.5,"z":0,"state":"roam"}],"mudZones":[{"x":0,"z":0,"r":10}]})
  - hook qaTeleportTo(50, 50)
  - hook qaAdvance(1, true)
  - record FE.qaPlayerState().inMudZone as outsideMud
  - snap outside-mud
  - hook qaTeleportTo(0, 0)
  - hook qaAdvance(1, true)
  - record FE.qaPlayerState().inMudZone as insideMud
  - snap in-mud
  - key KeyW down
  - poll (FE.qaTeleportTo(0, 0), FE.qaStagePredatorNearPlayer('wolf', 17.5, 0), FE.qaAdvance(1, true), window.__wolfState = FE.qaProbePredatorState('wolf').state) every 20 until window.__wolfState !== 'roam' within 8000
  - key KeyW up
  - record window.__wolfState as wolfState
  - snap wolf-heard
expected:
  - var outsideMud = false
  - var insideMud = true
  - dom "#mudPrompt" attr data-visible = "1"   # final state: the wolf-detection steps below re-teleport the player back into the zone every poll tick, so the DOM is still mid-mud at evaluation time
  - dom "#mudPrompt" text contains "In mud"
  - var wolfState differs from null
  - expr wolfState = "investigate"
  - no-overlap in-mud
  - no-overlap wolf-heard
  - no-console-errors
screenshots: [outside-mud, in-mud, wolf-heard]
priority_if_fails: medium
expires: 2026-10-30
status: open
---
Filed with LUL-5558/LUL-5565 (Game Engineer split 2/2 of the Mud Zone terrain hazard;
LUL-5564 landed the engine core on 2026-09-30, PR#945). The mechanical claims this request
covers end-to-end, deterministically: (1) `qaPlayerState().inMudZone` flips across the zone
boundary (`isInMudZone()`, `lib/game/mud.ts:22`); (2) `#mudPrompt` (the 11th `#actionSlot`
row, `components/Hud.tsx:1415`) tracks it with `adminMode` off; (3) a roaming wolf staged
17.5u away -- strictly between `NOISE_RADIUS_WALK=14` (inaudible on dry ground) and
`NOISE_RADIUS_WALK * MUD_NOISE_MUL=21` (audible once mud's 1.5x applies) -- transitions out
of `roam` while the player walks in place inside the zone. `isNoiseHeard()`'s per-tick
probabilistic roll (same shape as `e2e/wind-deafness-mud.spec.ts`'s own 20u case) gives this
an ~1.8% flake budget over the 8s poll window, not a hook gap.

The same scenario, plus the first-mud-entry caption (one-shot, `hintSeen('mudZone')`-gated)
and the companion no-mud control case, already runs deterministically on every PR via
`e2e/mud-zone.spec.ts` (micro world, no `@fullmap`) -- this request exists for the one thing
the repo's e2e suite cannot see: the real mud-texture ground patch and `#mudPrompt` pill
actually rendering correctly together on a real landscape-phone screen, not just the DOM
attributes the Playwright assertions check.
