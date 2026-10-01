# SPEC: LUL-5707 Firefly Swarms (ambient dusk/night glow clusters)

**Ticket:** LUL-5707 · **Tier:** A — pure ambient visual, no input/HUD/save/economy change;
touches only a new `lib/game/` data file, `engine/tuning.js`'s existing scale-mul knob set,
and `engine/forest-engine.js` tick/init additions. No Code Reviewer gate required.

**Written against:** `release/next` @ `995bda4` (2026-10-01).

## Files

- `lib/game/fireflyClusters.ts` — new. `FIREFLY_CLUSTERS` static site array (6 fixed
  positions, `EventSite`-shaped), `FIREFLY_CLUSTER_RADIUS`, `FIREFLY_MOBILE_CLUSTER_COUNT`.
- `engine/tuning.js` — edited. New `CONFIG.fireflyScaleMul` knob (same "scale the read, not
  the source" shape as `roostScaleMul`/`scentMaskScaleMul`/`decoyScaleMul`), set to `0.2` in
  `applyQaWorldMicroPreset()`.
- `engine/forest-engine.js` — edited. Import, `scaledFireflyClusters()` helper, module-scope
  `activeFireflyClusters`/`fireflyClusterMotes` build (gated on `timeOfDay`), tick()
  proximity-falloff + idle-drift loop, `qaProbeFireflyClusters` hook.
- `engine/forest-engine.d.ts` — edited. `qaProbeFireflyClusters` type declaration.
- `e2e/firefly-swarms.spec.ts` — new.
- `shared/local-qa/requests/lul-5707-firefly-swarms.md` — new.

## The change

`FIREFLY_CLUSTERS: readonly FireflyCluster[]` — 6 fixed `{ id, kind: 'firefly', x, z, radius:
45, moteCount }` entries (`moteCount` 4-8), positions picked clear of `ROOSTS`
(`lib/game/roostSites.ts`), `SCENT_MASK_SITES`, `DECOY_SCENT_SITES`, `CAVE`/`LANDMARKS`
(`engine/tuning.js`). Mobile renders `FIREFLY_MOBILE_CLUSTER_COUNT` (4) entries, desktop all 6
(`mode`, `engine/forest-engine.js:246`).

Gating: `timeOfDay` (`engine/forest-engine.js:~360`, resolved once at init per LUL-1644, see
`docs/specs/time-of-day.md`) — active when `timeOfDay === 'evening' || timeOfDay === 'night'`
(the engine's `TimeOfDayState` union has no literal `'dusk'`; `'evening'` is the dusk window,
`lib/game/timeOfDay.ts:11-17`). One `THREE.PointLight` per mote, built once at init, scattered
around each cluster's scaled center with a deterministic (non-`rng()`) sunflower-seed layout so
building this feature cannot shift any other system's seeded draw sequence for the same seed.

Distance falloff reuses `decoyScentGlowWeight()` (`lib/game/decoyScentSites.ts`, generic over
any `EventSite`-shaped object) verbatim in the tick loop, same recipe as the existing
scent-mask/decoy-site proximity brightening (`engine/forest-engine.js:~8320-8336`). Idle drift
is a small per-mote sine/cosine offset, degrading to static under `motionReduced()`.

`CONFIG.fireflyScaleMul` (new, default `1`, `0.2` under `applyQaWorldMicroPreset()`) scales
`FIREFLY_CLUSTERS`' `x`/`z` at every engine read, same "scale the read, not the source" shape
as `roostScaleMul`/`scentMaskScaleMul`/`decoyScaleMul` — without it every cluster sits
100-280u from the micro map's origin spawn, outside `FIREFLY_CLUSTER_RADIUS` (45, left
unscaled, same precedent as `ROOST_TRIGGER_RADIUS`), so the e2e "visible at night" assertion
could never pass on the default QA world (founder rule LUL-2377).

## Verification

- `npm run typecheck` — no new errors (new `.ts` file + `.d.ts` field).
- `npx eslint .` — clean.
- `npx playwright test e2e/firefly-swarms.spec.ts e2e/time-of-day.spec.ts` — green, micro
  world, fast.
- `npx next build` — green.

## e2e

**Specs.** `e2e/firefly-swarms.spec.ts` — new: `'firefly clusters are present and visible at
night'` (`?qaHour=2`), `'... at dusk (evening)'` (`?qaHour=18`), `'... are absent at noon'`
(`?qaHour=11`), `'... are absent in the morning'` (`?qaHour=8`).
**World.** micro (default `boot()`) — no `qaBuildScene` staging needed; the gate is
module-scope (`timeOfDay`), not map geometry, so the micro world is sufficient and
`@fullmap` is not warranted.
**Hooks.** `window.ForestEngine.qaProbeFireflyClusters(): { clusterCount: number; anyVisible:
boolean }` — new, declared in `engine/forest-engine.d.ts`, installed inside the `?qaHooks`
block next to `qaProbeTimeOfDay`. Reused: `qaProbeTimeOfDay` (confirms the `timeOfDay` state
under test but exposes no scene-graph info, hence the new hook) and `?qaHour=` (existing,
`e2e/time-of-day.spec.ts`).
**Tester scenario.** `shared/local-qa/requests/lul-5707-firefly-swarms.md` (new) — desktop +
mobile viewports, `?qaHour=2` boot, read `qaProbeFireflyClusters`, expect
`clusterCount>0 && anyVisible`.
**Not covered.** Visual color/brightness correctness and the idle-drift feel are feel/visual
items confirmed only by a human or the nightly tester's screenshot, not by this suite.

## Cues

Ambient/passive-texture: exempt from the cue-triple requirement per `docs/CUES.md:1-6`'s
scope-out, same ruling as `decisions/lul-2431-fire-tower-embers-cue-triple-exempt-2026-09-11`
(re-affirmed for this feature in `decisions/lul-5704-firefly-swarms-accepted-2026-10-01`, all
17 Section-0 checklist questions answered there). No visual/audio/caption/reduced-motion triple
required; reduced motion degrades the idle drift to a static light (see "The change" above).

## Constraints

No new input, HUD field, persisted setting, save state, or economy hook. No
`EngineActions`/`ENGINE_ACTION_KEYS` change (this is a QA-hook-only addition under
`window.ForestEngine`, not part of `init()`'s React-facing return object). Pure visual/no
side effects outside the new `THREE.PointLight` objects and their own tick-loop mutation.

## Out of scope

HUD readout of cluster proximity (none specified or needed — Q3/Q10 N/A per the accepted
proposal, the pixels are the 3D scene objects themselves). Per-mote (vs. per-cluster)
distance falloff — intensity is computed once per cluster, matching the "wide ambient
falloff" framing in the ticket, not an 8u interaction radius. Full-map manual visual
QA — tracked by the local-qa request file above, not by this suite.
