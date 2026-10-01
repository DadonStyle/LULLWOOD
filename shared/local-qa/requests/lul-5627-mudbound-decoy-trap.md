---
ticket: LUL-5627
title: a decoy-lured predator crosses the guaranteed overlapping mud zone and the mudbound-decoy hint renders over it
requested_by: Game Engineer
branch: release/next
commit: 7cd238b
viewports: [desktop-1280x720]
preconditions:
  - localStorage lullwood:hints:scent = "1"
  - localStorage lullwood:hints:landmark = "1"
  - localStorage lullwood:hints:deepwater = "1"
  - localStorage lullwood:hints:oakHollow = "1"
  - localStorage lullwood:hints:beaconEvasion = "1"
  - localStorage lullwood:hints:skyCompassNavigation = "1"
  - localStorage lullwood:hints:wolf = "1"
  - localStorage lullwood:hints:bear = "1"
  - localStorage lullwood:hints:lion = "1"
  - localStorage lullwood:hints:beaconHunter = "1"
  - localStorage lullwood:hints:stamina = "1"
  - localStorage lullwood:hints:windAssist = "1"
hooks:
  - qaSetFixedStep(dt): void
  - qaBuildScene(scene): {trees:number, props:number, predators:number}
  - qaTeleportTo(x, z): void
  - qaAdvance(steps, skipFinalRender): void
  - qaProbePredatorState(kind): {state:string, noiseTarget:{x:number,z:number}|null, x:number, z:number}
steps:
  - boot qaHooks seed=20260718
  - enter
  - hook qaSetFixedStep(0.02)
  - hook qaBuildScene({"predators":[{"kind":"wolf","x":-15,"z":28,"state":"chase"}],"mudZones":[{"x":-30,"z":28,"r":8}]})
  - hook qaTeleportTo(-30, 28)
  - hook qaAdvance(1)
  - hook qaTeleportTo(-20, 28)
  - hook qaAdvance(1)
  - hook qaProbePredatorState('wolf') as afterRedirect
  - poll FE.qaAdvance(1,true) every 50 until Math.hypot(FE.qaProbePredatorState('wolf').x - (-30), FE.qaProbePredatorState('wolf').z - 28) < 6 within 8000
  - record qaProbePredatorState('wolf') as inMudState
  - hook qaTeleportTo(-30, 28)
  - hook qaAdvance(1)
  - snap mudbound-decoy-trap
expected:
  - var afterRedirect differs from null
  - expr afterRedirect.state = "investigate"
  - expr afterRedirect.noiseTarget.x = -30
  - expr afterRedirect.noiseTarget.z = 28
  - var inMudState differs from null
  - expr inMudState.state = "investigate"
  - dom "#hintCaption" visible
  - dom "#hintCaption" attr data-hint-key = "mudTrapDecoy"
  - dom "#hintCaption" text contains "mudbound decoy"
  - no-console-errors
screenshots: [mudbound-decoy-trap]
model_questions:
  - mudbound-decoy-trap: "Is the caption text at the bottom of the screen readable, and does it mention a muddy decoy trap?"
priority_if_fails: medium
expires: 2026-10-30
status: open
---

Filed with LUL-5627 (cheap slice of the accepted LUL-5622 proposal, decision
`decisions/lul-5622-mudbound-decoy-accepted-2026-10-01`). `generateMudZones()`
(`engine/forest-engine.js`) now reserves its first of five draws to land within
`(r-1)` of the Decoy Scent Site every game, guaranteeing that a predator redirected
onto the decoy by `hearThrowableNoise()` has to cross mud to reach it.

Mud Zones have no ground-level visual tell at all (no mesh, no texture -- confirmed
by grep; see `docs/ELEMENTS.md`'s Mud Zone section). That means the `mudTrapDecoy`
hint caption is the *only* player-visible surface this feature has -- the predator
slowdown itself and the redirect are both purely mechanical. This request therefore
stages the full chain (wolf mid-chase -> exit the site -> redirect onto the site's
own point -> wolf crosses into the now-guaranteed-overlapping mud zone) and checks
both the mechanical assertions (`afterRedirect`/`inMudState` via `qaProbePredatorState`)
and the one real on-screen tell (`#hintCaption` text/attribute), rather than relying
on the screenshot alone to prove anything about the mud slowdown -- same split
`shared/local-qa/requests/lul-5601-wind-deafness-mud.md` uses for its own
no-visual-tell predator-internal mechanic.

Forced-geometry staging here (`qaBuildScene`'s `mudZones` override) mirrors
`e2e/mudbound-decoy-trap.spec.ts`'s own mechanic test -- this request is not meant
to re-prove the reachability guarantee itself (that a *real*, non-forced
`generateMudZones()` draw lands near the site every seed), which is deterministic,
has no RNG-dependent visual component for a human/vision-model glance to add value
over, and is already covered exhaustively (8 seeds) by
`e2e/mudbound-decoy-reachability.spec.ts` on every PR.

Delete this file once LUL-5627 ships and the tester has reported PASS at least once.
