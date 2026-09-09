# LUL-2257 -- qaProbePerf() reads scene stats, not the post-process blit

Tier: **B** -- touches `engine/forest-engine.js`, but this is a QA-only hook
(`window.ForestEngine.qaProbePerf`, not part of `EngineActions`/`init()`'s
return object -- no engine/React contract implications) and changes no
gameplay behaviour. Follow-up to LUL-2245 (baseline perf recording, PR #547),
which documented this as a "Known limitation" in
`docs/specs/lul-2245-baseline-perf.md` and filed this ticket.

## Problem

`qaProbePerf()` (`engine/forest-engine.js:3184`) read
`renderer.info.render.{calls,triangles}` live. `WebGLRenderer.info.autoReset`
defaults to `true`, so `info.render` only ever reflects the **last**
`renderer.render()` call in the frame. `renderPost()` (active whenever
`usePost` is true -- the normal path once `initPost()` succeeds) renders the
real scene into `sceneRT` first, then does several full-screen-quad blits
(bloom/blur passes + final composite), ending on `blit(matComposite, null)` --
a single 2-triangle quad. That last call is what `qaProbePerf()` read:
`calls: 1, triangles: 2`, constant, regardless of map size or player
position -- useless for LUL-2223 step 6, which needs to compare real
before/after scene stats to prove a streaming win.

## Fix

`renderPost()` (`engine/forest-engine.js:4432`) now captures
`renderer.info.render.{calls,triangles}` into a module-level `lastScenePerf`
snapshot immediately after `renderer.render(scene, camera)` into `sceneRT`,
before the bloom/blur/composite blits overwrite `info.render`.
`qaProbePerf()` (`:3184`) reads `lastScenePerf` when `usePost` is true, and
`renderer.info.render` live when it's false.

The `usePost === false` fallback path (`engine/forest-engine.js:5089`, direct
`renderer.render(scene, camera)` with no follow-up render calls that frame)
is unchanged -- `info.render` already held real scene stats there, and still
does; `qaProbePerf()` just reads it live in that branch same as before.

## e2e

**Specs.** `e2e/qa-probe-perf.spec.ts` -- 'qaProbePerf() reports real scene
stats, not the constant post-process blit' (new).
**Hooks.** No new hook -- `qaProbePerf()` and `qaProbeTreeChunks()`
(`engine/forest-engine.js:3184`, `:3195`) both already exist and are already
QA-only (`?qaHooks=1`); this ticket only changes what `qaProbePerf()` reads
internally, so no new install site or `.d.ts` entry (both hooks were already
untyped in `forest-engine.d.ts`, same as `qaProbeElapsedTime` --
`e2e/qa-fixed-clock.spec.ts`'s comment notes the same pattern -- so the test
reads them via `as any`, consistent with that spec).
**Tester scenario.** None: not player-visible, QA-instrumentation only. No
nightly local-qa coverage needed -- the new Playwright spec above is the
verification.
**Not covered.** The `usePost === false` fallback branch (post-processing
unavailable, e.g. shader compile failure) is not separately exercised --
there is no hook to force that branch, and Playwright's `--use-gl=angle
--use-angle=gl-egl` launch args (`playwright.config.ts`) make post-processing
succeed in CI same as everywhere else this suite runs. That branch is
unchanged by this diff (confirmed by inspection: still reads
`renderer.info.render` live, still the only `renderer.render()` call that
frame) -- covering it would need new test-only engine surface, out of scope
for this instrumentation fix per the ticket.

## Verification

Before the fix, at `?seed=20260718` (`QA_PINNED_SEED`), `qaProbePerf()`
reported `calls: 1, triangles: 2` at spawn while `qaProbeTreeChunks()`
reported 5200 tree instances in the same frame (recorded in
`docs/specs/lul-2245-baseline-perf.md`'s "Known limitation" section). After
the fix, `qaProbePerf()`'s `triangles` reflects the real scene (thousands,
not 2) at the same instant.
