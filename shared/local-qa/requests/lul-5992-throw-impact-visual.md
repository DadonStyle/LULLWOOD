---
ticket: LUL-5992
title: throwing a stone shows a landed-stone + dust-burst visual at the landing point, and it decays within ~1.5s
requested_by: Game Engineer
branch: release/next
viewports: [desktop-1280x720]
preconditions: []
hooks:
  - qaTeleportNearThrowable(): {x:number, z:number} | null
  - qaProbeThrowImpact(): {active:boolean, elapsedS:number}
steps:
  - boot qaHooks seed=20261013
  - enter
  - hook qaTeleportNearThrowable() as stone
  - key KeyE
  - click canvas
  - record FE.qaProbeThrowImpact().active as impactActiveOnThrow
  - snap throw-moment
  - poll (window.__ti = FE.qaProbeThrowImpact()) every 100 until window.__ti.active === false within 3000
  - record window.__ti.active as impactActiveAfterDecay
  - snap post-decay
expected:
  - var stone differs from null
  - var impactActiveOnThrow is truthy
  - var impactActiveAfterDecay is falsy
  - no-overlap throw-moment
  - no-overlap post-decay
  - no-console-errors
screenshots: [throw-moment, post-decay]
model_questions:
  - throw-moment: "Is there a small stone with a dust puff sitting on the ground near the player, and does it read as dust/debris rather than an explosion or a flash of light?"
priority_if_fails: medium
expires: 2026-10-30
status: open
---

Filed with LUL-5993 (cheap slice of LUL-5992's research), decision
`decisions/lul-5992-throw-impact-visual-accepted-2026-10-13`. Closes the one real gap the
decision found in the Throwable cue-triple: a thrown stone's landing point had audio
(`leafRustle(false)`) and explanation (`#throwPrompt`) but no visual tell at all.

Desktop only, on purpose. Triggering a throw is device-specific -- desktop fires it from a
real `mousedown` on the canvas while pointer-locked (`mode === 'desktop'`-gated,
`engine/forest-engine.js`), mobile fires it from the on-screen `touchThrow` button
(`triggerTouchThrow()`); `DesktopControls`/`MobileControls` are mutually exclusive, exactly
one ever mounts (`components/MobileControls.tsx:5-7`), so no single step sequence in this
grammar can trigger a throw on both viewports. That split is not a parity gap for this
ticket specifically: `triggerThrowImpact(landX, landZ)` is called once, unconditionally,
inside the single shared `throwThrowable()` (`engine/forest-engine.js`) that both input
paths already funnel through -- there is no mobile-specific code path for this visual to
break independently of the desktop one already covered by `e2e/throwables.spec.ts`'s new
`'throwing shows the landing visual and it decays'` test. Mobile's own tap-driven
grab/throw UI flow (unrelated to this new visual) already has deterministic, unmodified
coverage in `e2e/mobile/throwables.spec.ts`, which this ticket does not touch.

What this request exists for: the one thing the repo's e2e suite cannot see -- whether the
stone mesh + dust `Points` actually read as "a stone landed here, with some dust" rather
than noise, on a real rendered frame, not just the DOM/engine-state assertions
`qaProbeThrowImpact()` already lets `e2e/throwables.spec.ts` make deterministically.

Delete this file once LUL-5993 ships and the tester has reported PASS at least once.
