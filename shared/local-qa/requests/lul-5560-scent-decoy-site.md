---
ticket: LUL-5566
title: Scent Decoy Site -- red glow ring visible while inside, first-encounter caption reads correctly, no HUD collision
requested_by: Game Engineer
branch: release/next
viewports: [desktop-1280x720, pixel5-landscape-727x393]
hooks:
  - qaProbeDecoyScentSite(): {index: number, sites: {id, x, z, radius}[], exitCueCount: number}
  - qaTeleportTo(x, z): void
  - qaSetLookYaw(rad): void
steps:
  - boot qaHooks seed=20260718
  - enter
  - hook qaTeleportTo(-30, 28)   # DECOY_SCENT_SITES[0] (hollowNW, -150,140) scaled 0.2x under this harness's qaWorld=micro boot
  - hook qaSetLookYaw(0)
  - wait_for FE.qaProbeDecoyScentSite().index === 0 within 2000
  - snap decoy-glow
  - wait_for $('#hintCaption[data-hint-key="decoyScent"]') within 2000
  - snap decoy-caption
expected:
  - dom "#hintCaption[data-hint-key=\"decoyScent\"]" visible
  - dom "#hintCaption[data-hint-key=\"decoyScent\"]" text contains "scent-decoy site"
  - no-overlap decoy-glow
  - no-overlap decoy-caption
  - no-console-errors
screenshots: [decoy-glow, decoy-caption]
model_questions:
  - decoy-glow: "Is there a faint reddish/rust-orange colored glow ring visible on the ground near the player, distinct from any teal/amber colored glow seen elsewhere in this game?"
priority_if_fails: low
expires: 2026-10-30
status: open
---
Filed alongside LUL-5566 (cheap slice, plan LUL-5560, proposal LUL-5555 accepted -- wiki
game/mechanics/scent-decoy-site). One fixed site (`DECOY_SCENT_SITES`, `lib/game/decoyScentSites.ts`)
that redirects any non-inert predator off the player's live trail and onto the site itself the
moment the player leaves it, via `hearThrowableNoise()`'s `noiseTarget` override (NOT a push into
`checkScent()`'s `scentPoints` array, which carries no location and cannot redirect anything -- see
the LUL-5560 plan's corrected-mechanism writeup and `docs/ELEMENTS.md`'s "Scent-Decoy Site" section).

`e2e/scent-decoy-site.spec.ts` already asserts the mechanical claim headlessly (real code path: a
`qaBuildScene`-staged wolf already mid-`'chase'` gets its `noiseTarget` overridden to the site's
coordinates on exit, and its live position trends toward the site over the following frames, not
the player; a site on cooldown does not redirect twice). What that suite cannot see is the actual
rendered picture: is the glow ring (`DECOY_SCENT_GLOW_COLOR = 0xc9432f`, a red/rust tone chosen to
stay visually distinct from the teal/amber Scent-Masking Sites glow) visually legible against real
terrain/lighting, does the first-encounter caption pill (`data-hint-key="decoyScent"`, text "a
scent-decoy site -- leave it behind you and nearby predators will investigate it instead of you")
land somewhere sane on both viewports while the player stands inside the site, and does anything
else on screen collide with it -- the visual/HUD-collision check the headless suite is
structurally blind to, same split as every other `## e2e` + local-qa-request pair in this codebase
(e.g. LUL-5493's Scent-Masking Sites request).

Not requested: audio (the exit-cue's falling 180->90Hz sawtooth from `decoyScentExitCue()` is a
headless frequency assertion, already covered by `qaProbeDecoyScentSite().exitCueCount` in the
e2e spec, not something this harness's local CPU vision model can judge) or a predator-redirect
visual (a wolf visibly turning toward the site) -- that needs a second predator-staging step this
harness's request-file verb grammar does not support (`qaBuildScene` is exercised by the e2e spec
directly, not part of the `hook <name>(<json args>)` allowlist as written here); the mechanical
redirect is fully covered by the e2e spec instead. This request is purely the static
in-site visual/HUD check.

Superseded/incorrect earlier drafts of this same request (wrong hint-key text substring, and a
`popCueCount`/`poolT`/`cooldownT` hook shape that was never implemented -- the shipped hook is
`exitCueCount` only, see `qaProbeDecoyScentSite()` at `engine/forest-engine.js:6154-6161`) were
removed; this is the corrected version checked against the actual shipped code on PR #946.
