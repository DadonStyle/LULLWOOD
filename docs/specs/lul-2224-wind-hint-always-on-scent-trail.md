# SPEC: LUL-2224 wind hint always-on + scent trail visualization

**Ticket:** LUL-2224 · **Tier:** B — item 1 is a CSS/markup-only change (no engine logic, no
new state); item 2 (below, not yet implemented) touches `engine/forest-engine.js` render/tick
and `hudState`, and would be Tier C on its own.

**Written against:** `release/next` @ `8385924` (2026-09-09).

This ticket has two independent work items from the founder's brief. **Item 1 ships in this
PR.** Item 2 is specified below for a follow-up PR (LUL-2230) — it is a substantially larger
change (new engine render state, a new HUD element, new QA hooks) and does not block item 1.

## Item 1 — the wind hint text must never fade (this PR)

### Files

- `components/GameCanvas.tsx` — edited: remove `windHintFade` animation from `#windIndicatorHint`.
- `docs/ELEMENTS.md` — edited: update the wind-indicator paragraph to describe the always-on hint.
- `e2e/wind-hint.spec.ts` — created.
- `e2e/mobile/wind-hint.spec.ts` — created.

### The change

`components/GameCanvas.tsx:326-330` (`#windIndicatorHint` rule) previously had
`animation: windHintFade 7s ease forwards;` plus the `@keyframes windHintFade` rule that
animated opacity 1 → 0 over 7s and pinned the final frame (`forwards`). Both are removed; the
rule now sets `opacity: 1` directly. No other property on `#windIndicatorHint` changes —
position (`top:64px`/`top:228px` admin, `right:8px`, `width:76px`), font, and z-index (12) are
untouched, so the LUL-1933/LUL-2057 overlap fixes for this corner still hold.

`components/Hud.tsx:756-758` (the mount condition, `state.entered && !state.winVisible &&
!state.deathVisible`, LUL-2131) is unchanged — the hint was always mounted for the whole run;
only the CSS animation hid it after 7s.

`docs/ELEMENTS.md:976-978` rewritten from "a static one-time label ... that fades out after 7s
via CSS animation" to describe the always-on behaviour and cite LUL-2224 for the removal.

### Verification

- `npx next typegen && npx tsc --noEmit` — clean.
- `npx eslint .` (via `npm run lint`) — clean (one pre-existing unrelated warning in
  `lib/game/bog.test.ts`, not touched by this change).
- `npm test` — 1016 pass, 0 fail (no unit-level logic changed by this item; count unaffected).
- `node scripts/check-elements-citations.mjs` — 0 drifted.
- `npx next build` — succeeds.

## e2e

**Specs.**
- `e2e/wind-hint.spec.ts` — 'wind hint text stays visible for the whole run, in default and
  admin mode' (new). Desktop (1280x720): enters the run, asserts `#windIndicatorHint` contains
  "wind" and "scent trail", waits 9s wall-clock (past the old fade's 7s completion), asserts
  computed `opacity === '1'` and `animationName === 'none'`, asserts no bounding-box overlap
  with `#windIndicator`, asserts the hint is fully inside the viewport — then repeats the
  opacity/overlap/viewport checks after toggling admin mode on via the real Settings UI.
- `e2e/mobile/wind-hint.spec.ts` — 'wind hint stays visible and clear of the touch controls,
  default and admin mode' (new), run at both Pixel 5 landscape (851x393) and iPhone SE
  landscape (667x375). Same opacity/viewport checks, plus no-overlap checks against
  `[data-testid=touchHide]`, `[data-testid=touchVeil]`, `[data-testid=rightStick]` (the
  bottom-right touch-control column geometry the ticket flagged as the one worth measuring in
  admin mode), in both default and admin mode.
- `e2e/scent.spec.ts`, `e2e/admin-mode.spec.ts`, `e2e/mobile/admin-mode.spec.ts` — must pass
  unchanged (not touched by this item).

**Hooks.** None new — item 1 is presentation-only, no engine state involved.

**Tester scenario.** Covered by the two new Playwright specs above (nightly QA tester runs the
full `e2e/` suite per `shared/local-qa/QA_TESTER.md`); no separate request file needed since
every assertion maps to an existing hook/selector (no `NEEDS-HOOK` risk).

**Not covered.** Real-device rendering/legibility of the 10px hint text at native mobile DPI —
this rig asserts layout geometry and computed CSS, not perceived readability; a human or the
nightly tester's vision-model check is the source of truth for "is this actually easy to read."

### Constraints (item 1)

- `#hint` (engine-owned movement-controls hint, `components/GameCanvas.tsx:50-64`) keeps its
  own 5s fade — untouched.
- No change to `EngineHudState`, `EngineActions`, or any `hudState` field — this item has zero
  engine surface.
- No position/size change to `#windIndicator` or `#windIndicatorHint` beyond removing the fade.

## Item 2 — show the player their own scent trail, with a one-time caption (follow-up PR)

**Not implemented in this PR.** Filed as LUL-2230 (child of LUL-2224), assigned to Game
Engineer, scoped exactly as the founder's brief on LUL-2224 specifies:

- **Engine render:** a `THREE.Points`/`PointsMaterial` trail (`scentTrailPts`, additive
  blending, `depthWrite:false`, preallocated for `SCENT_TRAIL_MAX` vertices) filled every
  `tick()` from live `scentPoints`, positioned via the existing `driftedScentPosition()`
  (`lib/game/scent.ts:70-78`) so the visual matches what a predator actually smells, alpha by
  remaining life and dimmed (not zeroed) while veiled — veil must keep having zero effect on
  the underlying `checkScent()`/`scentOnto()` detection math (`docs/ELEMENTS.md:865-866`).
- **Setting:** `scentTrailVisible` (default on), engine-owned, same shape as `setCaptions`
  (`engine/forest-engine.js:4118-4119`), a new `SettingsPanel.tsx` checkbox, persisted via
  `PersistedSettings`.
- **One-time caption:** `#scentTrailCaption` in `components/Hud.tsx`, positioned from a
  per-frame `scentCaptionX/Y` push while the first visible mote is in the camera frustum,
  shown for ≤8s or until the first `scent_lock` event, gated on `!winVisible && !deathVisible`,
  persisted "seen" flag (`lullwood:scentTrailCaptionSeen`, same pattern as `HAS_DIED_KEY`).
- **New QA hooks (`engine/forest-engine.d.ts` + the `?qaHooks` block):**
  `qaProbeScentTrail(): {...}`, `qaSetLookYaw(rad: number): void`, `qaResetScentCaption(): void`.
- **New specs:** `e2e/scent-trail.spec.ts` (desktop) and `e2e/mobile/scent-trail.spec.ts`
  (Pixel 5 + iPhone SE landscape) — count/alpha/drift/veil-dim/caption/settings-toggle
  assertions per the founder brief; `e2e/scent.spec.ts` must stay green unchanged.
- Full acceptance criteria, exact math, and file:line citations: the founder's brief on
  LUL-2224 (quoted verbatim into LUL-2230's description) — re-derive line numbers from the
  branch actually implemented on before starting, per this template's own instruction, since
  `engine/forest-engine.js` moves fast.

### Out of scope (both items)

- Scent detection math/constants (`lib/game/scent.ts`, `depositScent`/`checkScent`/`scentOnto`
  in the engine) — read-only for both items, never modified.
- `generateWind()` and the seeded RNG stream — no new `rng()` draws in either item (pinned-seed
  e2e depend on the exact draw count/order).
- The carry/arrive-home/win flow — untouched by either item.
