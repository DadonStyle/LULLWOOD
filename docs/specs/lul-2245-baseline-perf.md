# LUL-2245 -- baseline perf numbers before map-epic changes

Tier: **A** -- instrumentation/measurement only, no engine behaviour change.
Rollout step 1/6 of parent epic LUL-2223 ("stream a bigger map with real
hunters"). This doc exists so step 6 of that epic can compare its
post-streaming numbers against a real pre-streaming baseline instead of the
"E3/E6 numbers were never recorded" gap the epic calls out.

Measured against commit `6d29f6b7e7eeb2742abae159e9248163fbdc786c`
(`origin/release/next` tip at the time this branch was cut, 2026-09-09) --
no code changes on top of it.

## Method

`next dev` on port 3111, driven with Playwright (chromium, `--use-gl=angle
--use-angle=gl-egl`, same GPU launch args as `playwright.config.ts` on this
host). Navigated to `/?qaHooks=1&seed=<QA_PINNED_SEED>` (`e2e/helpers.ts:35`,
`QA_PINNED_SEED = 20260718`), `waitUntil: 'networkidle'`. Boot time below is
wall-clock from `page.goto()` start to the `networkidle` resolution (not
including the subsequent `window.ForestEngine` two-canvas readiness wait,
which `e2e/helpers.ts`'s `boot()` also does separately).

At each viewport, called `window.ForestEngine.qaProbePerf()`
(`engine/forest-engine.js:3184`) twice:

1. **At spawn** -- immediately after the engine-ready wait (canvas count ==
   2), plus a 300ms settle for a couple of real frames to render.
2. **Near child** -- after `window.ForestEngine.qaTeleportNearBaby()`
   (`engine/forest-engine.js:3113`), plus another 300ms settle.

Desktop viewport: 1280x720, default Chrome emulation (matches the
`chromium` Playwright project). Mobile viewport: 727x393 (landscape phone,
matches `e2e/mobile/*.spec.ts`'s `test.use({ viewport: { width: 727, height:
393 } })`), `devices['Pixel 5']` emulation (touch, coarse pointer -- drives
`isMobile()` true and `CAMERA_FOV = 85` per `engine/forest-engine.js:294`,
vs. 70 on desktop).

## Numbers

| Viewport | Boot-to-networkidle (ms) | Point | calls | triangles | clock.elapsedTime (s) |
|---|---|---|---|---|---|
| Desktop 1280x720 | 1381 | at spawn | 1 | 2 | 0.94 |
| Desktop 1280x720 | 1381 | near child | 1 | 2 | 1.24 |
| Mobile 727x393 (Pixel 5 emu) | 854 | at spawn | 1 | 2 | 0.37 |
| Mobile 727x393 (Pixel 5 emu) | 854 | near child | 1 | 2 | 0.67 |

## Known limitation -- these `calls`/`triangles` numbers do not reflect scene complexity

`qaProbePerf()` reads `renderer.info.render.{calls,triangles}` directly.
`WebGLRenderer.info.autoReset` defaults to `true`
(`node_modules/three/src/renderers/webgl/WebGLInfo.js:65`), so `info.render`
is reset and repopulated on *every* `renderer.render()` call and only ever
reflects the **most recent** one within the frame.

`renderPost()` (`engine/forest-engine.js:4419-4433`, active whenever
`usePost` is true, which is the normal path -- see the `initPost()`
try/catch at `engine/forest-engine.js:4415-4416`) calls `renderer.render()`
multiple times per frame: once for the real scene into `sceneRT`, then one
`blit()` (itself a `renderer.render()` of a 2-triangle full-screen quad) per
bloom/blur pass, ending with the final composite `blit(matComposite, null)`.
That last call is what `info.render` holds when `qaProbePerf()` reads it --
**a full-screen quad, not the forest**. Confirmed live: at spawn on this
seed, `qaProbeTreeChunks()` (`engine/forest-engine.js:3195`) reports 5200
tree instances in 64 chunks in the scene at the same instant `qaProbePerf()`
reports `calls: 1, triangles: 2`.

Net effect: **`calls`/`triangles` are constant (1 / 2) regardless of map
size or player position** -- they only ever measure the final post-process
blit. This is a pre-existing property of the hook, not something this
instrumentation-only ticket changed or is in scope to fix. It matters here
because it means these two fields, as currently defined, **cannot** be used
by LUL-2223 step 6 to prove or disprove a streaming win -- they will read
`1`/`2` before and after regardless of what the epic changes. Filed
LUL-2257 to fix `qaProbePerf()` (read `sceneRT`'s render stats before the
post-process passes overwrite them) before step 6 depends on this metric;
`clock.elapsedTime` and boot-to-networkidle are unaffected by this and are
usable as-is.

## Post-streaming numbers (LUL-2250, epic step 6/6 -- closes LUL-2223)

Measured against commit `0d584613a9effc93f37e1a2c153df2c848fd5924`
(`origin/release/next` tip after PR #620 merged, 2026-09-15), same method as
above (`next dev`, same seed, same two probe points, same two viewports).
LUL-2257's `qaProbePerf()` fix has landed, so `calls`/`triangles` below are
real scene stats, not the constant post-process-blit artifact the baseline
recorded.

| Viewport | Boot-to-networkidle (ms) | Point | calls | triangles | clock.elapsedTime (s) |
|---|---|---|---|---|---|
| Desktop 1280x720 | 1151 | at spawn | 143 | 70,294 | 0.50 |
| Desktop 1280x720 | 1151 | near child | 138 | 78,276 | 0.80 |
| Mobile 727x393 (Pixel 5 emu) | 983 | at spawn | 147 | 72,464 | 0.40 |
| Mobile 727x393 (Pixel 5 emu) | 983 | near child | 139 | 80,244 | 0.70 |

Boot-to-networkidle is in the same range as the pre-streaming baseline
(1381ms/854ms) -- both numbers are dominated by `next dev`'s on-demand page
compile on the very first request of a fresh server process, not by map
size; the epic's real boot-time criterion (LUL-2249, "well below 58.7s")
was already verified separately against a production build. `calls`/
`triangles` are not comparable to the baseline row (that row's `1`/`2` was
the known-broken post-process-blit read, not a real measurement of a
smaller scene) -- these are the first real numbers recorded for this
metric, both well within `qaProbePerf()`'s own render budget and consistent
with only the ~5x5 streaming ring (not the whole map) being instantiated at
once.
