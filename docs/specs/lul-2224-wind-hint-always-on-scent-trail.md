# SPEC: LUL-2224 wind hint always-on + scent trail visualization

**Ticket:** LUL-2224 · **Tier:** B for item 1 (CSS/markup-only, no engine logic, no new
state); item 2 (below) touches `engine/forest-engine.js`'s per-frame render loop reading
`scentPoints`/`windX`/`windZ`/`veilAmount` and is **Tier C** on its own — presentation-only,
but detection-adjacent code. Requires `REVIEW: APPROVED` before merge.

**Written against:** `release/next` @ `8385924` (2026-09-09, item 1); item 2 implemented on
`lul-2230-scent-trail-visualization` off `fbb84c5` — re-derive line numbers from that branch,
not this doc's prose.

This ticket has two independent work items from the founder's brief. **Item 1 shipped in
PR #536 (`ce8ad11`).** **Item 2 ships in LUL-2230**, described below.

## Item 1 — the wind hint text must never fade (shipped, PR #536)

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

### Constraints (item 1)

- `#hint` (engine-owned movement-controls hint, `components/GameCanvas.tsx:50-64`) keeps its
  own 5s fade — untouched.
- No change to `EngineHudState`, `EngineActions`, or any `hudState` field — this item has zero
  engine surface.
- No position/size change to `#windIndicator` or `#windIndicatorHint` beyond removing the fade.

## Item 2 — render the player's scent trail + one-time explanation caption (LUL-2230)

### What shipped

- `engine/forest-engine.js`: `scentTrailPts` (`THREE.Points`, additive blending,
  `depthWrite:false`, preallocated `SCENT_TRAIL_MAX` vertices) rendered every `tick()`
  from the live `scentPoints` array at each point's `driftedScentPosition()` — the same
  position `checkScent()` queries, so the picture never lies about where a predator will
  find the trail. Alpha = remaining life (`1 - age/SCENT_LIFETIME`) × veil dim (×0.3 at
  full veil, presentation only) × radius ratio (run motes brighter than walk motes).
  Wrapped with the same `wrapDelta()`/`WRAP_SPAN` handling `isScentDetected` uses.
- One-time caption: once per install, when the setting is on, the player isn't hidden,
  and the oldest visible mote enters the camera frustum (`Vector3.project`), the HUD
  shows "this is your scent trail — predators follow it" anchored to that mote's screen
  position; gone after 8s or the first `scent_lock` chronicle event, whichever is first;
  persisted via `localStorage['lullwood:scentTrailCaptionSeen']`.
- Setting: `scentTrailVisible` (engine-owned, default on), `setScentTrailVisible()`,
  exposed through `EngineActions`, `ENGINE_ACTION_KEYS` (`lib/engine-contract.ts`, new
  file — the type-level half of the founder's engine/React contract rule; the runtime
  `assertEngineContract()` call site the rule also describes does not exist anywhere in
  this repo yet and is flagged here rather than invented inside this ticket's diff,
  since it's cross-cutting infra any future `EngineActions` addition depends on), and a
  "Show my scent trail" checkbox in `components/SettingsPanel.tsx`, persisted in
  `PersistedSettings`.
- `docs/ELEMENTS.md`: new bullet under the scent-trail/wind section.

### What did not change

`lib/game/scent.ts` (constants, `isScentDetected`, `driftedScentPosition`,
`scentPickupRadius`), `depositScent`/`checkScent`/`scentOnto` in the engine,
`generateWind()`/the seeded RNG stream, and the one-time `windX`/`windZ` push. Veil
continues to have zero effect on scent detection — the dim is purely visual.

## e2e

**Specs.**
- `e2e/wind-hint.spec.ts` — 'wind hint text stays visible for the whole run, in default and
  admin mode' (item 1, shipped). Desktop (1280x720): enters the run, asserts
  `#windIndicatorHint` contains "wind" and "scent trail", waits 9s wall-clock (past the old
  fade's 7s completion), asserts computed `opacity === '1'` and `animationName === 'none'`,
  asserts no bounding-box overlap with `#windIndicator`, asserts the hint is fully inside the
  viewport — then repeats the opacity/overlap/viewport checks after toggling admin mode on via
  the real Settings UI.
- `e2e/mobile/wind-hint.spec.ts` — 'wind hint stays visible and clear of the touch controls,
  default and admin mode' (item 1, shipped), Pixel 5 landscape (851x393) and iPhone SE
  landscape (667x375). Same opacity/viewport checks, plus no-overlap checks against
  `[data-testid=touchHide]`, `[data-testid=touchVeil]`, `[data-testid=rightStick]`, in both
  default and admin mode.
- `e2e/scent-trail.spec.ts` — new, desktop (item 2). Tests: trail renders at the drifted
  position and fades with age; running motes brighter than walking, standing still
  decays the trail to zero; the one-time caption appears once, clears within 8s, and
  `qaResetScentCaption()` proves the gate is the persisted flag not luck; caption never
  shows over win/death; mist veil dims the picture without weakening detection
  (`qaSeedScentPoint`/`qaProbeScentOnOldest` cross-check); the Settings toggle hides the
  picture/caption only, `scentPoints` untouched, and the choice persists.
- `e2e/mobile/scent-trail.spec.ts` — new, Pixel 5 + iPhone SE landscape (item 2). Same
  render/caption/settings assertions via `touch-cdp.ts` movement, plus caption/settings
  checkbox clearance of the touch Hide/Veil/stick regions and `#windIndicatorHint`.
- `e2e/scent.spec.ts`, `e2e/admin-mode.spec.ts`, `e2e/mobile/admin-mode.spec.ts` — must pass
  unchanged.

**Hooks.**
- Item 1: none — presentation-only, no engine state involved.
- Item 2 (new, inside the `?qaHooks=1` block, declared in `engine/forest-engine.d.ts`):
  - `qaProbeScentTrail(): { settingOn, rendered, points: {x,z,age,alpha,inFrustum,rawX,rawZ,radius}[], livePoints, captionVisible, captionSeen, veilAmount, windX, windZ }` —
    exactly what the last frame drew; `points.length` equals the draw range used that tick.
  - `qaSetLookYaw(rad: number): void` — sets `player.yaw` directly so a test can turn to
    face its own trail without pointer lock; read-only otherwise.
  - `qaResetScentCaption(): void` — clears the persisted + in-memory "seen" flag so one
    boot can prove the one-time gate twice.

**Tester scenario.**
- Item 1: covered by the two Playwright specs above (nightly QA tester runs the full
  `e2e/` suite); no separate request file needed.
- Item 2: request file `shared/local-qa/requests/lul-2230-scent-trail.md` (desktop
  1280×720 + Pixel 5 landscape) — walk, turn around, confirm the trail is visible and
  fades, the caption appears once, veil dims it, and Settings hides it.

**Not covered.**
- Item 1: real-device rendering/legibility of the 10px hint text at native mobile DPI —
  this rig asserts layout geometry and computed CSS, not perceived readability.
- Item 2: mote size/color legibility against fog and caption readability — unverified
  until a human or the tester's vision-model pass confirms it. This PR claims code
  correctness only.

### Out of scope (both items)

- Scent detection math/constants (`lib/game/scent.ts`, `depositScent`/`checkScent`/`scentOnto`
  in the engine) — read-only for both items, never modified.
- `generateWind()` and the seeded RNG stream — no new `rng()` draws in either item (pinned-seed
  e2e depend on the exact draw count/order).
- The carry/arrive-home/win flow — untouched by either item.
