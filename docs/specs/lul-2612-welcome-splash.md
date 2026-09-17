# SPEC: LUL-2612 first-visit marketing welcome splash

**Ticket:** LUL-2612 · **Tier:** B — `components/**` only, no `engine/forest-engine.js`
touch, no persistence/secrets/auth. Player-visible.

**Directive (founder, via Founding Engineer handoff):** a marketing splash shown once,
only on a player's first visit, gated by a localStorage boolean. Content: "Welcome to
Lullwood", an explanation that this is a horror game, and a bold, very noticeable studio
credit line — "Build by independence AI studio!" (rendered as "Built by Independence AI
Studio!") plus more about the studio, stack and goal. Explicitly: no new agent, quick
research only.

## Files

- `components/WelcomeSplash.tsx` — new. Self-contained overlay, `lullwood:welcomeSeen`
  localStorage gate, no engine/HUD-state dependency.
- `components/GameCanvas.tsx` — edited: render `<WelcomeSplash />`, add `#welcomeSplash`/
  `#welcomeSplashDismiss` CSS to `OVERLAY_STYLE` (z-index 60, above every other overlay).
- `e2e/helpers.ts` — edited: `boot()` gains `seedWelcomeSplashSeen` (default `true`),
  seeding `lullwood:welcomeSeen` via `addInitScript` so the rest of the suite is unaffected.
- `e2e/mobile/ui-hygiene.spec.ts` — edited: its local `boot()` (doesn't import
  `../helpers`) gets the same seed directly.
- `e2e/welcome-splash.spec.ts`, `e2e/mobile/welcome-splash.spec.ts` — new.
- `docs/ELEMENTS.md` — edited in the same PR (founder rule 2026-09-09): new "Welcome
  splash" entry under HUD / UI surfaces.

## Why a boot()-level change, not an engine qa hook

This feature has no engine or `EngineHudState` surface at all — it is a plain React
component gated on `window.localStorage`, mounted before the engine's own overlay markup.
The "no hook, no spec" rule's hook mechanism (`?qaHooks=1` block in `engine/forest-engine.js`
`init()`) exists to reach engine *simulation* state from Playwright; there is no simulation
state here to reach. The equivalent risk for this feature is that every existing spec in
the suite boots into a fresh Playwright browser context (no localStorage), so a splash that
covers the whole viewport at `z-index: 60` would intercept the click every other spec sends
to `#gate`. `boot()`'s new `seedWelcomeSplashSeen: true` default is the fix, and it is
exercised the same way an engine hook would be — the two new specs explicitly pass `false`
to prove the un-seeded, real first-visit path still renders correctly.

## Cues

- Visual: the splash itself — full-screen, high-contrast card, impossible to miss.
- Audible: none. This is a one-time marketing screen, not a gameplay verb; there is no
  existing precedent for an audio cue on `#gate` itself either.
- Caption / reduced-motion: no animation, no timed auto-dismiss, so `reducedMotion`/
  `captionsOn` settings have nothing to interact with here.

## e2e

- `e2e/welcome-splash.spec.ts`
  - `'a first-time visitor sees the welcome splash before the gate, and dismissing it
    persists'` — boots with `seedWelcomeSplashSeen: false`, asserts `#welcomeSplash` is
    visible with the exact heading and bold studio-credit text, dismisses it, asserts the
    localStorage key is `'1'` and the element is gone, then confirms `#gate` is clickable
    afterward.
  - `'a returning visitor (welcome already seen) never sees the splash'` — default `boot()`
    (seeded), asserts `#welcomeSplash` has count 0 and `#gate` is immediately visible.
- `e2e/mobile/welcome-splash.spec.ts` — same two scenarios, viewport-relative tap (727×393
  landscape), mirroring `e2e/mobile/hide.spec.ts`'s pattern.
- Both run in the micro world (`boot()`'s default `qaWorld: 'micro'`) — no map/engine state
  is involved, so there is nothing that requires `@fullmap`.
- Regression check: `e2e/returning-player.spec.ts`, `e2e/mobile/ui-hygiene.spec.ts` and a
  handful of other specs that click `#gate` immediately after `boot()` — these must keep
  passing unmodified (they rely on the new seed-by-default behaviour). Live-verified as part
  of this change; see the journal for the exact list run.
- Nothing stays manual — this is pure DOM/localStorage, no visual/audio judgment call to
  defer to a human.
