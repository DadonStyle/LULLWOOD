# SPEC: LUL-2224 — Wind hint always-on + scent trail visualization

Tier: **C** — item 2 touches `engine/forest-engine.js`'s per-frame render loop reading
`scentPoints`/`windX`/`windZ`/`veilAmount` (detection-adjacent, though presentation-only:
`checkScent`/`scentOnto`/`depositScent`/scent constants are untouched). Requires
`REVIEW: APPROVED` before merge.

This file did not exist when LUL-2230 (item 2) started; it is backfilled here per the
`## e2e` requirement (`shared/local-qa/REQUESTING-A-TEST.md`) since the ticket's own SPEC
pointer was never written. Item 1 (wind hint never fades) shipped separately in
`ce8ad11` (PR #536) and is not re-described here.

## Item 2 — render the player's scent trail + one-time explanation caption

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
- `e2e/scent-trail.spec.ts` — new, desktop. Tests: trail renders at the drifted
  position and fades with age; running motes brighter than walking, standing still
  decays the trail to zero; the one-time caption appears once, clears within 8s, and
  `qaResetScentCaption()` proves the gate is the persisted flag not luck; caption never
  shows over win/death; mist veil dims the picture without weakening detection
  (`qaSeedScentPoint`/`qaProbeScentOnOldest` cross-check); the Settings toggle hides the
  picture/caption only, `scentPoints` untouched, and the choice persists.
- `e2e/mobile/scent-trail.spec.ts` — new, Pixel 5 + iPhone SE landscape. Same
  render/caption/settings assertions via `touch-cdp.ts` movement, plus caption/settings
  checkbox clearance of the touch Hide/Veil/stick regions and `#windIndicatorHint`.
- `e2e/scent.spec.ts` — must pass unchanged (detection math untouched).

**Hooks** (new, inside the `?qaHooks=1` block, declared in `engine/forest-engine.d.ts`):
- `qaProbeScentTrail(): { settingOn, rendered, points: {x,z,age,alpha,inFrustum,rawX,rawZ,radius}[], livePoints, captionVisible, captionSeen, veilAmount, windX, windZ }` —
  exactly what the last frame drew; `points.length` equals the draw range used that tick.
- `qaSetLookYaw(rad: number): void` — sets `player.yaw` directly so a test can turn to
  face its own trail without pointer lock; read-only otherwise.
- `qaResetScentCaption(): void` — clears the persisted + in-memory "seen" flag so one
  boot can prove the one-time gate twice.

**Tester scenario.** Request file `shared/local-qa/requests/lul-2230-scent-trail.md`
(desktop 1280×720 + Pixel 5 landscape): walk, turn around, confirm the trail is visible
and fades, the caption appears once, veil dims it, and Settings hides it.

**Not covered.** Actual visual quality (mote size/color legibility against fog, whether
the caption text reads well) is unverified until a human or the tester's screenshot pass
confirms it — this PR claims code correctness only.
