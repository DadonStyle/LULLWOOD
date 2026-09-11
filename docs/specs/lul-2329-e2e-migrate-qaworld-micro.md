# SPEC: LUL-2329 e2e -- migrate hook-staged specs to qaWorld=micro/qaBuildScene, tag full-map specs @fullmap, add memory-budget assertion

**Ticket:** LUL-2329 (child 2/2 of epic LUL-2324) · **Tier:** B -- test-file and thin
call-site changes only, no engine/simulation code touched. Spans ~30 files and
introduces a new nightly-run convention (`@fullmap`), which is why it needs this
plan despite the tier; no Code Reviewer blocking gate unless review surfaces a
Tier C concern.

**Written against:** `release/next` @ `c352ab9` (2026-09-11), which already includes
child 1/2 (LUL-2328, PR #568, merged) -- `?qaWorld=micro`, `?qaNoRender=1`,
`qaBuildScene(scene)`, `qaProbeMemory()` all exist in `engine/forest-engine.js`/
`.d.ts` and are documented in `docs/specs/lul-2328-qa-world-micro-hooks.md`.
Re-derive every `file:line` below from the branch you actually implement on if it
has moved.

## Ground truth re-verified against this branch (supersedes the ticket's own "re-verify" note)

- `bog-zone.spec.ts`, `prop-density.spec.ts`, `landmark-beacons.spec.ts`,
  `qa-probe-perf.spec.ts` all now exist (the ticket's own text already flagged
  that the founder's brief predates them). Each is classified below by reading
  its actual assertions, not by name-matching the founder's brief.
- `playwright.config.ts` still `workers: 1` (`:86`), `fullyParallel: false`
  (`:85`) -- peak memory is one page at a time; no `@fullmap`-style tag exists
  anywhere in the repo yet.
- `qaBuildScene(scene)` (`engine/forest-engine.js:4391`), when called, **parks
  every predator not named in `scene.predators` as `inert:true` at
  `(-9999,-9999)`** (`:4426-4430`) -- `updatePredators()`'s per-tick loop skips
  `inert` predators entirely, and no other hook in this file resets `inert` back
  to `false`. This is the load-bearing fact behind several "do not use
  qaBuildScene here" calls below: any spec that stages a cover prop via
  `qaBuildScene({props:[...]})` and *separately* expects a live predator
  (`qaOpenHideNearLion`, `qaHideBehindCoverKind`, `qaLurePredatorKind`,
  `qaStagePredatorGiveUp`, ...) to actually chase/investigate afterward would
  silently break that predator's AI tick unless the same `qaBuildScene` call
  also lists it under `predators`. `qa-world-micro.spec.ts`'s own third spec
  (`docs/specs/lul-2328-qa-world-micro-hooks.md` `## e2e`) already does this
  correctly (props and the one wolf in the same call).
- **Update, discovered empirically during this ticket's dev-sanity test runs**:
  `qaBuildScene`'s `predators` array is also the fix for a second, distinct
  problem -- under `qaWorld:'micro'`'s much smaller map, a predator-staging
  hook (`qaOpenHideNearLion`, `qaLurePredatorKind`) that only guarantees *one*
  named species is positioned correctly does not guarantee the other 8
  won't reach the player first (the wolf case in smoke.spec.ts's death test
  was observed dying to a lion instead). `qaBuildScene({predators:[{kind,x,z}]})`
  with no `props` key isolates the single relevant predator without touching
  cover generation at all -- used in smoke.spec.ts (3 tests),
  telemetry-transport.spec.ts (1 test), and positional-hiding.spec.ts (2
  tests) below. Tests that instead depend on a *natural* cover prop
  (`qaHideBehindCover(Kind)`, `qaTeleportToHideSpot`) over a long poll window
  still can't safely combine with `qaBuildScene` (it would wipe that natural
  cover) and are left on the full map instead -- see cover-feedback.spec.ts,
  predator-memory.spec.ts, scent.spec.ts's second describe.

## Files

- `e2e/action-prompt.spec.ts`, `hide.spec.ts`, `blind-chase-cover.spec.ts`,
  `smoke.spec.ts`, `telemetry-transport.spec.ts`, `throwable-mission-hud.spec.ts`,
  `win-persist.spec.ts`, `landmark-beacons.spec.ts` -- edited: every
  `boot(page, {...})` call gains `qaWorld: 'micro'` (see per-file table below
  for the call sites deliberately excluded).
- `e2e/scent-trail.spec.ts` -- **not edited, reverted from an earlier draft of
  this migration** (see per-file table): even after adding `qaBuildScene({})`
  predator isolation to every test, 4 of 6 still failed in repeated dev-sanity
  runs on a *pre-existing* flaky baseline (3 of 6 already fail on unmigrated
  `release/next`, unrelated to this ticket -- confirmed by running the
  unmigrated file directly). Root-causing that pre-existing flake is out of
  this Tier B, test-rig-only ticket's scope. Left on the full map entirely.
- `e2e/cover-feedback.spec.ts`, `positional-hiding.spec.ts`, `scent.spec.ts` --
  edited: only the test(s)/helper(s) named in the per-file table below gain
  `qaWorld: 'micro'` on their `boot()`; the rest of each file (the
  natural-cover-dependent test(s)) is left on the full map, per-file table has
  the reasoning for the split.
- `e2e/predator-memory.spec.ts` -- **not edited** (see per-file table): every
  test needs a real, naturally-generated hide-spot prop with no available
  predator isolation over its multi-second poll window; left on the full map
  in its entirety.
- `e2e/action-prompt.spec.ts` (calm-cover-prompt test only), `hide.spec.ts` --
  additionally edited to call `qaBuildScene({props:[{kind:'bramble',x:10,z:0}]})`
  right after `boot()`/`enter()`, replacing reliance on the micro preset's own
  random cover generation for the one hide-spot each needs. No predator
  assertions in either test, so `qaBuildScene`'s inert-everything-unlisted side
  effect is a no-op here.
- `e2e/positional-hiding.spec.ts` (2 of 4 tests), `smoke.spec.ts` (3 death
  tests), `telemetry-transport.spec.ts` (1 test) -- additionally edited to call
  `qaBuildScene({predators:[{kind,x,z}]})` right before the relevant
  `qaOpenHideNearLion`/`qaLurePredatorKind` call, parking every other predator
  `inert` so an unrelated species can't reach/kill the player first under the
  smaller micro map -- an interference risk confirmed empirically during this
  migration's own dev-sanity test runs, not present on the full 480-wide map.
  See per-file table.
- `e2e/lul211-founder-report.spec.ts` -- edited: first two `test.describe`
  blocks (`LUL-211: the canvas is actually...`, `LUL-211: winning shows YOU
  WON...`) get `qaWorld: 'micro'`. The other two (`LUL-211: cover props are
  solid`, `LUL-384/LUL-1642: log and bramble are walkable`) are untouched
  (stay full-map) and get `@fullmap` appended to their `test.describe` titles.
- `e2e/tree-pathing.spec.ts`, `e2e/bog-zone.spec.ts`, `e2e/map-seed.spec.ts`,
  `e2e/minimap.spec.ts`, `e2e/predator-determinism.spec.ts`, `e2e/layout.spec.ts`,
  `e2e/prop-density.spec.ts`, `e2e/qa-probe-perf.spec.ts` -- edited: `@fullmap`
  appended to every `test.describe`/`test` title in the file (all tests in each
  of these files stay full-map; see the per-file table for why). No `boot()`
  call in any of these files is touched.
- `e2e/throwable-mission-hud.spec.ts` -- the `#missionPanel via
  qaTeleportNearMission()` describe's `boot()` is deliberately **not** given
  `qaWorld: 'micro'` (see table) and is **not** tagged `@fullmap` either (it
  isn't a real-geometry regression test in the sense the other full-map specs
  are -- it is a UI/state test that happens to depend on the mission target's
  fixed absolute coordinate). It runs full-map as an ordinary member of the
  non-`@fullmap` pass.
- `e2e/qa-world-micro-budget.spec.ts` -- new. The memory-budget assertion
  (deliverable 3).
- `playwright.config.ts` -- edited: `chromium` project gets `grepInvert:
  /@fullmap/`; new `fullmap` project (`grep: /@fullmap/`, `dependencies:
  ['chromium']`) so a plain `npx playwright test` (what `bin/local-qa-run` on
  the founder's rig already runs, unchanged) executes every non-`@fullmap` test
  first and the `@fullmap` tests afterward, never concurrently, regardless of
  a future `workers` bump.

## The change

### 1. Tagging convention

`@fullmap` is appended to the `test.describe`/`test` title string itself (e.g.
`test.describe('minimap w2m stays on-canvas past the forest/bog seam @fullmap',
...)`), matching Playwright's own grep-tag convention (`--grep`/`grepInvert`
match against the full title string; no `{tag}` option needed given this
repo's `@playwright/test` version already supports plain string matching and
every other spec in this repo tags nothing, so introducing the newer `{ tag:
[...] }` object form here would be the only file using it). One tag per
file that needs it is enough since `grep`/`grepInvert` match substrings, not
per-test flags -- no need to tag every individual `test()` inside an already-
`@fullmap`-tagged `describe()`.

### 2. `playwright.config.ts` -- explicit two-phase ordering

```ts
projects: [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    testIgnore: ['**/replay/**', '**/mobile/**'],
    grepInvert: /@fullmap/,
  },
  {
    name: 'fullmap',
    testDir: './e2e',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    testIgnore: ['**/replay/**', '**/mobile/**'],
    grep: /@fullmap/,
    dependencies: ['chromium'],
  },
  // replay, mobile unchanged
]
```

`dependencies: ['chromium']` is Playwright's own mechanism for "do not start
this project's tests until every test in its dependency project has finished"
-- it is normally used for setup/teardown projects, but the guarantee it gives
(no overlap between the two projects' test execution, regardless of `workers`)
is exactly what the ticket asks for ("make the intent explicit so a future
worker-count change doesn't silently reintroduce the peak"). `workers: 1`
already serialized everything by accident; this makes the *ordering* and
*isolation* a first-class config fact instead of a side effect of an unrelated
setting. `bin/local-qa-run` (founder-owned, `shared/local-qa/`) runs plain
`CI=1 npx playwright test --reporter=json` with no `--project` filter, so this
change is transparent to it -- it now runs `chromium`, `fullmap`, `replay`
(unaffected, own testDir), and `mobile` (unaffected, own testDir + `@fullmap`
never appears there), in that dependency order, same total coverage as today.

### 3. Per-file classification

| File | Treatment | Why |
|---|---|---|
| action-prompt.spec.ts | `qaWorld:'micro'` on all 5 `boot()`; test 1 also gets `qaBuildScene` bramble | Test 1's `qaTeleportToHideSpot()` return is asserted `not.toBeNull()` -- guarantee it. Tests 2-5 either don't check the hide-spot hook's return (test 2, vestigial call already clobbered by the following `qaOpenHideNearLion()` player-reset in the *pre-existing* code) or only need the always-present predator pool (`qaOpenHideNearLion`/`qaOpenHideNearLionAtHideSpot`) plus the micro preset's own ~40 generated cover props (test 3-5), which include HIDE_KINDS members with very high probability and already throw a clear diagnostic if not. |
| hide.spec.ts | `qaWorld:'micro'` + `qaBuildScene` bramble | Return of `qaTeleportToHideSpot()` is asserted; no predator involved anywhere in the file, so `qaBuildScene`'s inert-everything-unlisted side effect is inert (pun intended) -- safe. |
| blind-chase-cover.spec.ts | `qaWorld:'micro'` only | `qaStageAndTraceBlindChase(kind)` needs a HIDE_KINDS prop thin enough that `offA+offB < p.rad+CATCH_MARGIN` (`forest-engine.js:4043`) -- real generation draws `rollCoverPropShape()`'s randomized dims per kind (not `qaBuildScene`'s fixed `QA_COVER_SHAPE` midpoints), so whether a placed `qaBuildScene` log would even qualify isn't guaranteed by inspection alone, while natural generation already has 3 species x a range of naturally-thin logs to draw from and the hook already throws a clear, non-silent diagnostic on failure. Left on natural generation rather than risk a wrong synthetic placement. |
| cover-feedback.spec.ts | Split: test 1 (`qaOpenHideNearLion`, no cover) -- `qaWorld:'micro'`. Test 2 (`qaHideBehindCover`) -- left on the full map. | Test 1 has no cover dependency, migrates cleanly. Test 2's `qaHideBehindCover` needs a real, naturally-generated non-tree cover prop and polls for up to 250 fixed steps with no isolation against the other 8 predators -- confirmed empirically (see positional-hiding/smoke below) that `qaWorld:'micro'`'s smaller map lets an unrelated predator interfere over windows that long, and `qaBuildScene` isolation would wipe the natural cover this hook depends on. Left as-is rather than risk a false pass/fail on cover fidelity. |
| positional-hiding.spec.ts | Split: test 1 (`qaOpenHideNearLion`) and the `qaLurePredatorKind('wolf')` death test -- `qaWorld:'micro'` **plus** `qaBuildScene({predators:[...]})` isolating the one relevant species. `qaHideBehindCoverKind` helper (used by 3 parametrized tests) -- left on the full map. | Empirically, under `qaWorld:'micro'` an *unrelated* predator can reach and interfere with the player before the intended one does (the map is small enough that all 9 predators start statistically close together) -- confirmed on this file's own death test and independently on smoke.spec.ts's equivalent case. `qaBuildScene({predators:[...]})` parks every unlisted predator `inert`, giving true single-predator isolation without needing a specific cover prop. The `qaHideBehindCoverKind` helper needs a real HIDE_KINDS prop and has no such isolation over its poll window; `qaBuildScene` would supply isolation but wipe the natural cover the helper depends on, so left on the full map instead. |
| predator-memory.spec.ts | Left on the full map, untouched. | `hidePlayer()` calls `qaTeleportToHideSpot()` (needs a real, naturally-generated hide-spot prop) then every test stages `qaStagePredatorGiveUp(kind,...)` and polls for several seconds with no isolation against the other 8 predators. `qaBuildScene` could supply isolation but would wipe the natural cover `qaTeleportToHideSpot` depends on -- same conflict as cover-feedback's test 2. Not migrated. |
| scent.spec.ts | Split: first describe's test (`qaSeedScentPoint`/`qaProbeScentOnOldest`, pure position math) -- `qaWorld:'micro'`. Second describe's test (`qaHideBehindCoverKind('bear')`) -- left on the full map. | First test has no map/cover dependency, migrates cleanly. Second needs a real, naturally-generated non-tree cover prop and has an up-to-15s retry loop with no predator isolation -- same natural-cover-vs-`qaBuildScene`-isolation conflict as cover-feedback's test 2 and predator-memory. Not migrated. |
| scent-trail.spec.ts | Not migrated -- reverted to the full map, untouched. | No `coverData` dependency (migrates cleanly on that axis), but each test's multi-second `qaAdvance()` walk with no predator isolation let a roaming predator reach and kill the player under `qaWorld:'micro'` (confirmed empirically: 6/6 tests failed). Adding `qaBuildScene({})` isolation (parks every predator inert) improved but did not fix it -- 4/6 still failed, and a control run of the *unmigrated* file showed 3/6 already fail on `release/next` today (unrelated pre-existing flake, likely the GPU-nondeterminism/timing class of issue `playwright.config.ts`'s own comments already flag for this rig). Chasing that down is out of this ticket's Tier B/test-rig-only scope -- left on the full map. |
| smoke.spec.ts | `qaWorld:'micro'` on all 4 `boot()` (the 'initial load' test's `boot()` also gains `qaHooks:true`, previously absent, so it can call the hook below); the 3 `qaLurePredatorKind(kind)` death tests additionally get `qaBuildScene({predators:[{kind,x:6,z:0}]})` right before the lure call, and the 'initial load' test additionally gets `qaBuildScene({})` right after `enter()`. | `qaTeleportNearBaby`/`qaLurePredatorKind` are position/predator-array based, no map-density dependency. The death tests confirmed empirically that an *unrelated* species can reach and kill the player before the lured one does under the smaller micro map (the wolf case was observed dying to a lion instead). The 'initial load' test has no staging at all -- just `enter()` then a 2.5s real-time `KeyW` hold -- and was observed dying to an unrelated roaming predator on ~60% of runs; `qaBuildScene({})` (no `predators` key, parks every predator inert) fixed it (4/4 clean repeats after the fix). In both cases `qaBuildScene`'s isolation doesn't affect this file's assertions (DOM text / position math only, no cover dependency). |
| telemetry-transport.spec.ts | `qaWorld:'micro'` on the 2 `boot()` calls that boot the engine (3rd test is a plain API request, no `boot()`); the `qaLurePredatorKind('wolf')` test additionally gets `qaBuildScene({predators:[{kind:'wolf',x:6,z:0}]})`, same as smoke.spec.ts's death tests. | Same hooks and same unrelated-predator-interference risk as smoke.spec.ts's death tests -- same fix. |
| throwable-mission-hud.spec.ts | `qaWorld:'micro'` on the `qaGrabThrowable()` describe only | `throwableData` is a fixed-capacity-90 pool "unaffected by qaWorld" per the child-1 spec's own note. The `qaTeleportNearMission()` describe is deliberately left full-map: `MISSION_POOL` (`lib/game/mission.ts:18-28`) has exactly one entry today (`deepwater`, so the hardcoded `target.kind === 'deepwater'` assertion is safe regardless of rng-stream reshuffling), but its target coordinate is a **fixed absolute position, `{x:-95, z:46}`**, calibrated for the 480-wide map -- at `mapSize:96` that point sits far outside the playable area, and the test's "walk 2 units toward it" step has not been verified to behave sanely out there (possible interaction with wrap/edge handling this spec never exercised before). Left on the full map rather than guess. |
| win-persist.spec.ts | `qaWorld:'micro'` on both `boot()` | Same `qaTeleportNearBaby` reasoning as smoke.spec.ts. |
| lul211-founder-report.spec.ts | Split by `describe`, see Files section | The first two describes are pure DOM/CSS and `qaTeleportNearBaby`-driven win-screen checks, no map dependency. The last two need a *specific* real prop (a large tree `s>1.4` for the `'tree'` case, a real log/bramble for the walkable-cover case) discovered from `coverData`/`treeData` directly (`qaStageWalkIntoCover`) -- migrating those to a synthetic single-prop `qaBuildScene` scene would change what regression the test actually exercises (real generation's collision fidelity vs. one hand-placed prop), which is a bigger behavioural change than "same assertions, different staging" authorizes. Tagged `@fullmap`, left exactly as they are otherwise. |
| tree-pathing.spec.ts | `@fullmap`, untouched otherwise | `qaStageAndTraceBehindTree` searches `treeData` for a real, neighbour-isolated tree (`forest-engine.js:4153-4189`) -- the test's entire purpose (LUL-1091 regression: predators path around trees from the *live spatial grid*) is about real generation's tree distribution, not an isolated synthetic obstacle. Whole file is this one concern -- no split needed. |
| bog-zone.spec.ts | `@fullmap`, untouched otherwise | Every test reads real, absolute-position geometry calibrated for `mapSize:480` -- `BOG_CENTER {x:-40,z:80}` (`lib/game/bog.ts`), `CONFIG.lake`, `LANDMARKS`, `CAVE` -- and one test (`blackout spawns the child beyond the bog`) asserts `distHome >= 192`, which the landed LUL-2328 spec itself already documents as **unsatisfiable at `mapSize:96`** ("Declared limitation" section, `docs/specs/lul-2328-qa-world-micro-hooks.md`). Confirms the founder brief's "bog-zone" full-map candidate was right; this file is exactly that spec under a different name than ground truth expected. |
| prop-density.spec.ts | `@fullmap`, untouched otherwise | Asserts real per-chunk density caps (`PROP_MIN_SPACING`/`PROP_CHUNK_CAP`) calibrated to the full map's `CONFIG.trees`/`coverProps` counts across 4 seeds -- meaningless at the micro preset's already-below-cap counts. Matches the founder brief's "prop-density" candidate. |
| qa-probe-perf.spec.ts | `@fullmap`, untouched otherwise | Asserts `triangles`/`totalInstances > 1000` -- the whole point is proving the real large scene's stats are read correctly; the micro preset's ~40 trees would make this assertion either meaningless or false. Matches the founder brief's "qa-probe-perf" candidate. |
| map-seed.spec.ts, minimap.spec.ts, predator-determinism.spec.ts, layout.spec.ts | `@fullmap`, untouched otherwise | Ticket's own explicit full-map list. `minimap.spec.ts` additionally confirmed by inspection: its z=150/z=200 clamp assertions are calibrated to the full map's bog seam (z=120) and `zMax=240`, meaningless at `mapSize:96`. `map-seed.spec.ts`/`predator-determinism.spec.ts` assert full-generation-order determinism. `layout.spec.ts` doesn't use `qaHooks` at all and its assertions are content-agnostic, but it boots the (default, full) map either way -- left exactly as the ticket lists it rather than second-guess the given list. |
| landmark-beacons.spec.ts | `qaWorld:'micro'` | `LANDMARKS` (`engine/tuning.js`) is a **fixed constant array**, not an rng-selected pool, and per the LUL-2328 spec is "placed unconditionally regardless of map size" -- the test only asserts each of the 6 static entries has a `visible`/`fog:false` beacon sprite, not its on-screen position or distance from spawn. No rng-stream-reshuffling or absolute-position risk applies here the way it does for bog-zone/mission. |

All other `e2e/*.spec.ts` files not named above (admin-mode, charge-dodge,
day-night-cycle, death-persist, death-sequence, force-hunt-closes, gate-credit,
input-mode, lifecycle, mission-deepwater, orientation-desktop, qa-fixed-clock,
returning-player, seo, stamina, suggestion-box, throwables, wind-hint,
wind-indicator, and everything under `e2e/mobile/`) are UI/state-only per the
ticket's own scoping and are left untouched.

### 4. New spec: `e2e/qa-world-micro-budget.spec.ts`

Two tests:
- `'micro world stays under the LUL-2324 memory budget'` -- `boot(page, {
  qaHooks: true, qaWorld: 'micro' })`, `qaProbeMemory()`, assert (when
  `heap` is non-null) `heap.usedJSHeapSize < 400 * 1024 * 1024`. Same budget
  number `qa-world-micro.spec.ts` already asserts for the boot-preset test
  itself (LUL-2328) -- this is a dedicated, clearly-named regression guard
  rather than relying on that other file's test not being weakened or deleted
  later.
- `'full QA-pinned-seed map stays under the LUL-2324 full-map budget'` --
  `boot(page, { qaHooks: true, seed: QA_PINNED_SEED })` (no `qaWorld`, i.e. the
  real 480-map default), `qaProbeMemory()`, assert (when `heap` is non-null)
  `heap.usedJSHeapSize < 1.5 * 1024 * 1024 * 1024`. Tagged `@fullmap` (it
  deliberately boots the expensive map on purpose -- belongs in the isolated,
  run-last-alone group like every other full-map spec, not mixed into the
  micro-dominated main pass).

Both skip the assertion (not fail) when `heap` is null, matching
`qa-world-micro.spec.ts`'s own Chromium-only caveat -- this rig runs Chromium
so `heap` is populated in practice, but the assertion must not force a false
failure on a browser that doesn't implement `performance.memory`.

## Verification

- `node --check` on every edited file is not applicable (TypeScript, not
  plain JS) -- `npx tsc --noEmit` covers it instead.
- `npx tsc --noEmit` -- clean; no `.d.ts` changes in this ticket, only call
  sites against the already-typed `qaWorld`/`qaBuildScene`/`qaProbeMemory`.
- `npm run lint` -- clean.
- `npx playwright test --grep-invert @fullmap` and `npx playwright test --grep
  @fullmap` run locally as a development sanity check (not the PR gate --
  e2e verification for PRs is the founder's local QA tester's job per the
  2026-09-09 rule; this is just catching an obviously broken migration before
  push).

## e2e

**Specs.** Every migrated file above keeps its existing `test()`/`test.describe()`
titles and assertions unchanged -- only the `boot()` call's `qaWorld` argument
and, where noted, one added `qaBuildScene()` call change. Old staging call ->
new staging call, per file:
- `e2e/action-prompt.spec.ts` ('calm cover prompt: shown at a bramble bush'):
  `boot(page,{qaHooks:true})` + bare `qaTeleportToHideSpot()` -> `boot(page,
  {qaHooks:true, qaWorld:'micro'})` + `qaBuildScene({props:[{kind:'bramble',
  x:10,z:0}]})` + `qaTeleportToHideSpot()`. Its other 4 tests and
  `hide.spec.ts` keep the same hook calls, only `qaWorld:'micro'` added to
  `boot()` (`hide.spec.ts` also gets the same `qaBuildScene` bramble call).
- `e2e/blind-chase-cover.spec.ts`, `throwable-mission-hud.spec.ts`
  (qaGrabThrowable describe only), `win-persist.spec.ts`,
  `landmark-beacons.spec.ts`: `boot(page,{qaHooks:true, ...})` ->
  `boot(page,{qaHooks:true, qaWorld:'micro', ...})`, no other change.
- `e2e/scent-trail.spec.ts`: unchanged -- migrated then reverted (see per-file
  table); still full-map `boot(page,{qaHooks:true})` on all 6 tests, identical
  to `main`.
- `e2e/smoke.spec.ts` (3 `qaLurePredatorKind(kind)` death tests),
  `e2e/telemetry-transport.spec.ts` (the `qaLurePredatorKind('wolf')` test),
  `e2e/positional-hiding.spec.ts` (the `qaOpenHideNearLion` test and the
  `qaLurePredatorKind('wolf')` death test): `boot(page,{qaHooks:true,...})` +
  bare hook call -> `boot(page,{qaHooks:true, qaWorld:'micro',...})` +
  `qaBuildScene({predators:[{kind,x:...,z:...}]})` + the same hook call
  unchanged -- the added `qaBuildScene` call isolates the one relevant
  predator so an unrelated species can't interfere under the smaller map (see
  the Ground truth section's "Update" note). Smoke's other 3 `boot()` calls
  and telemetry-transport's 2nd `boot()` call (not listed here) get plain
  `qaWorld:'micro'` with no `qaBuildScene`.
- `e2e/smoke.spec.ts` ('initial load' test): `boot(page,{qaWorld:'micro'})` ->
  `boot(page,{qaHooks:true, qaWorld:'micro'})` (gains `qaHooks:true`, needed
  to call the hook below) + `qaBuildScene({})` added right after `enter()`,
  before the 2.5s real-time walk -- isolates every predator; see per-file
  table.
- `e2e/cover-feedback.spec.ts`, `scent.spec.ts`: only the cover-independent
  test in each file gets `boot(page,{qaHooks:true})` -> `boot(page,
  {qaHooks:true, qaWorld:'micro'})`; the natural-cover-dependent test in each
  is unchanged (left on the full map -- see per-file table).
- `e2e/predator-memory.spec.ts`: unchanged (left on the full map in its
  entirety -- see per-file table).
- `e2e/lul211-founder-report.spec.ts`: first two describes get `qaWorld:'micro'`
  on their `boot()`; last two describes' titles gain ` @fullmap`, `boot()`
  unchanged.
- `e2e/tree-pathing.spec.ts`, `bog-zone.spec.ts`, `map-seed.spec.ts`,
  `minimap.spec.ts`, `predator-determinism.spec.ts`, `layout.spec.ts`,
  `prop-density.spec.ts`, `qa-probe-perf.spec.ts`: title(s) gain ` @fullmap`,
  no `boot()` change.
- `e2e/qa-world-micro-budget.spec.ts` (new, see "The change" section 4).

**Hooks.** All hooks used already exist (`qaWorld`, `qaBuildScene`,
`qaProbeMemory` from LUL-2328; every other hook pre-existing). No new hooks
declared or installed by this ticket.

**Tester scenario.** None: this ticket's own surface is the test rig's
memory footprint and CI/nightly wall-clock structure, not player-visible
behaviour -- no `shared/local-qa/requests/` file needed. The nightly tester's
own `bin/local-qa-run` invocation (plain `npx playwright test --reporter=json`,
no `--project` filter) is unaffected in what it covers, only in what order/
grouping it now runs tests -- covered by this spec's own local
`--grep`/`--grep-invert` sanity runs, not a tester request.

**Not covered.** Whether the `throwable-mission-hud.spec.ts` mission test
would actually behave correctly under `qaWorld:'micro'` is not resolved here
(left on the full map instead, see the per-file table) -- a follow-up ticket
if a future change wants it migrated too. Firefox/Safari's `performance.memory
=== null` path for the new budget spec is not exercised, same caveat as
`qa-world-micro.spec.ts` (Chromium-only suite).

## Constraints

- No spec's assertions change -- only how each spec's scene is staged (`boot()`
  params, plus an added `qaBuildScene()` call in some files). A reviewer
  diffing `expect(...)` lines against `main` should see zero changes there.
- `qaBuildScene({props:[...]})` (no `predators` key) is only added where the
  test has zero live-predator dependency (see the ground-truth note on
  `inert`) -- `action-prompt.spec.ts`'s calm-cover-prompt test, `hide.spec.ts`.
- `qaBuildScene({predators:[...]})` (no `props` key) is added where a test
  stages one named predator via a separate hook (`qaOpenHideNearLion`,
  `qaLurePredatorKind`) and needs the other 8 species parked `inert` so they
  can't interfere -- `smoke.spec.ts`, `telemetry-transport.spec.ts`,
  `positional-hiding.spec.ts` (see the Ground truth section's "Update" note
  and the per-file table). The staged predator is always listed in the same
  call's `predators` array. `props` and `predators` are never combined in the
  same `qaBuildScene` call anywhere in this ticket.
- `@fullmap`-tagged tests must still pass unmodified -- this ticket does not
  touch their assertions, only their title string and (via
  `playwright.config.ts`) their scheduling relative to everything else.

## Out of scope

- Migrating `throwable-mission-hud.spec.ts`'s mission describe, or any other
  spec judged too risky above, to `qaWorld:'micro'` -- flagged per-file, not
  silently dropped.
- LUL-2249 (streamed chunks, the real game's resident-set fix) and LUL-1768
  (boot-cost investigation) -- named out of scope by the ticket itself; this
  only reduces the test rig's footprint.
- Auditing every other `e2e/*.spec.ts` file not named in the ticket's lists or
  this spec's table for a possible `qaWorld:'micro'` opportunity -- out of
  scope; the ticket bounds this to the named hook-staged/full-map lists plus
  the four founder-named full-map candidates (prop-density, bog-zone,
  landmark, qa-probe-perf), all resolved above.
