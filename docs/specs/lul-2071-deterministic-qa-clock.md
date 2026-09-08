# LUL-2071 -- deterministic QA test clock (engine hook, Part 1)

Tier: **C** -- touches `engine/forest-engine.js` simulation clock. Requires
`REVIEW: APPROVED` before merge.

Root cause and full context: wiki `systems/e2e-post-gpu-nondeterminism`,
`systems/dt-clamp-vs-walltime`, `systems/qa-rig-gpu-headless-chromium`. Do not
re-derive that investigation -- it's already written up; this spec only covers
the fix.

## Scope of this spec (Part 1 only)

This spec adds the engine-side test-hook API. It does **not** rewrite any of
the ~10 wall-clock-tuned spec files (`action-prompt.spec.ts`,
`charge-dodge.spec.ts`, `cover-feedback.spec.ts`, `positional-hiding.spec.ts`,
`scent.spec.ts`, `lul211-founder-report.spec.ts`, `map-seed.spec.ts`,
`predator-determinism.spec.ts`) -- that is a separate follow-up ticket per
file/group, to be spec'd once this hook exists and is merged. See "Out of
scope" below.

## Files

- `engine/forest-engine.js` -- edit only.
- `e2e/qa-fixed-clock.spec.ts` -- new file (verification for this hook itself).

## The change

### 1. Add fixed-step state next to the clock

At `engine/forest-engine.js:3934` (`const clock = new THREE.Clock();`), add
one line directly after it:

```js
const clock = new THREE.Clock();
let qaFixedDt = null;   // LUL-2071: non-null while a test has parked the RAF loop via qaSetFixedStep()
```

### 2. Extract `tick()`'s body into `stepFrame(dt, t)`

`tick()` currently spans `engine/forest-engine.js:3938` to `:4432`, body:

```js
function tick(){
  rafId = requestAnimationFrame(tick);
  const dt = clampDt(clock.getDelta()), t = clock.elapsedTime;
  ... (full existing body, unchanged, ~490 lines) ...
  updateBoom(dt);
  if(!dead){ if(usePost) renderPost(t); else renderer.render(scene, camera); }
  adaptResolution(dt, t);
}
tick();
```

Change to (pure mechanical extraction -- **do not alter any line inside the
body**, only move it into a new wrapper and change how `dt`/`t` reach it):

```js
function stepFrame(dt, t){
  ... (the exact, unmodified existing body of tick(), everything that was
       between the `const dt = ...` line and the closing `}` -- i.e. every
       line from the old `:3941` through `:4431` inclusive) ...
  updateBoom(dt);
  if(!dead){ if(usePost) renderPost(t); else renderer.render(scene, camera); }
  adaptResolution(dt, t);
}
function tick(){
  rafId = requestAnimationFrame(tick);
  const dt = clampDt(clock.getDelta()), t = clock.elapsedTime;
  stepFrame(dt, t);
}
tick();
```

`tick()` itself is otherwise untouched: it still reads the real
`clock.getDelta()` every real animation frame, exactly as today. Nothing about
normal (non-`qaHooks`) gameplay changes.

### 3. Add the two hooks inside the existing `qaHooks`-gated block

Inside the existing `if(typeof window !== 'undefined' && new
URLSearchParams(window.location.search).has('qaHooks')){` block
(`engine/forest-engine.js:2863`), add near the existing
`qaProbeElapsedTime` hook (`:2889`):

```js
// LUL-2071: deterministic test clock. qaSetFixedStep() parks the real RAF
// loop (cancels the pending frame) so wall-clock jitter/GPU contention can
// never inject an extra or partial frame on top of what the test drives.
// qaAdvance() is then the *only* thing that moves simulation time, by
// exactly dtSeconds per call, through the same stepFrame() the real RAF
// loop calls -- fixed-step and real-time frames run identical game logic,
// only the dt source differs. Advancing clock.elapsedTime directly (rather
// than intercepting every read site) keeps both the dilated `+= dt`
// category and the undilated `clock.elapsedTime`-diff category (see wiki
// systems/dt-clamp-vs-walltime) correct with one change, since both derive
// from this same shared THREE.Clock instance.
window.ForestEngine.qaSetFixedStep = function(dtSeconds){
  qaFixedDt = dtSeconds;
  if(rafId !== null){ cancelAnimationFrame(rafId); rafId = null; }
};
window.ForestEngine.qaAdvance = function(steps = 1){
  if(qaFixedDt === null) throw new Error('qaAdvance: call qaSetFixedStep(dt) first');
  for(let i = 0; i < steps; i++){
    clock.elapsedTime += qaFixedDt;
    stepFrame(qaFixedDt, clock.elapsedTime);
  }
};
```

Notes for the executor:
- `qaAdvance` does **not** call `clampDt()` on the injected dt. This is
  deliberate: the whole point is the test controls dt precisely. A spec
  choosing an unrealistic dt (e.g. `> 0.05`) gets exactly that dt, uncapped --
  don't "helpfully" clamp it.
- `qaSetFixedStep`/`qaAdvance` live in the *same* `qaHooks`-gated block as
  every other test hook -- they do not exist at all unless the page was
  loaded with `?qaHooks=1`, matching every other hook in this file.
- Do not add a "resume real time" hook. Every consumer of this API is a
  short-lived Playwright page that gets torn down at the end of the test;
  there is no scenario in scope where a test needs to hand control back to
  the real RAF loop mid-run. If a future ticket needs that, it can add it
  then -- don't build it speculatively here.

## Verification

1. `npm run build` (or `next build`, per repo convention) passes.
2. `npx playwright test e2e/qa-fixed-clock.spec.ts` passes (new file, below).
3. Spot-check no existing behavior moved: `npx playwright test e2e/smoke.spec.ts`
   passes (this spec never touches `qaHooks`, so it exercises the untouched
   `tick()` real-RAF path and is a cheap regression check that the extraction
   didn't change ordering or drop a line).

### New file: `e2e/qa-fixed-clock.spec.ts`

Write a Playwright spec with two cases:

- **"qaAdvance moves game time by exactly the requested amount, not wall
  time"**: navigate with `?qaHooks=1`, call
  `page.evaluate(() => window.ForestEngine.qaSetFixedStep(0.02))`, then
  `page.evaluate(() => window.ForestEngine.qaAdvance(50))` (50 steps x
  0.02s = 1.0s game time), then read
  `page.evaluate(() => window.ForestEngine.qaProbeElapsedTime())` and assert
  it increased by `~1.0` (`Math.abs(after - before - 1.0) < 1e-6` -- exact,
  not a tolerance band, since this path has no float accumulation beyond
  plain repeated addition).
- **"parking the RAF loop actually stops it -- no real-time drift"**: after
  the above `qaSetFixedStep` call, record `qaProbeElapsedTime()`, wait
  `600` wall-clock ms (`page.waitForTimeout(600)`) with **no** further
  `qaAdvance()` call, then read `qaProbeElapsedTime()` again and assert it
  is unchanged (`toBe`, exact) -- proving the real RAF loop is genuinely
  parked, not just slowed.

Use `test.describe` / existing spec conventions in this file's sibling specs
(e.g. `e2e/smoke.spec.ts`) for boilerplate (page navigation URL, viewport,
etc.) -- read one existing spec for the navigation boilerplate only, don't
invent a new pattern.

## Constraints

- **Zero behavior change on the non-`qaHooks` path.** `tick()`'s real-RAF
  branch must compute `dt`/`t` exactly as before and call `stepFrame` with
  them; nothing about normal play (desktop or mobile) may change.
- The `stepFrame` extraction must be a pure move -- every line of the
  existing `tick()` body goes into `stepFrame` verbatim, same order, same
  logic. If you find yourself wanting to change anything inside that body
  to make the extraction work, stop and report it as a spec bug rather than
  reconciling it yourself (per the "when spec and code disagree" rule).
- Do not touch any of the ~10 e2e spec files listed in "Scope" above.
- Do not touch `lib/game/scent.ts`'s `clampDt`/`DT_CLAMP_CEILING` -- they are
  unrelated to this change and already correct.
- Update `docs/ELEMENTS.md` only if this diff changes any element's verbs,
  collision, or interactions -- it does not (this is test-only
  infrastructure, gated behind `qaHooks`, with no gameplay-visible effect),
  so no `ELEMENTS.md` edit is expected. State that explicitly in the PR body
  rather than silently skipping it.

## Out of scope (follow-up tickets, not this one)

- Rewriting `action-prompt.spec.ts`, `charge-dodge.spec.ts`,
  `cover-feedback.spec.ts`, `positional-hiding.spec.ts`, `scent.spec.ts`,
  `lul211-founder-report.spec.ts` to drive timing via `qaSetFixedStep` +
  `qaAdvance` instead of wall-clock waits/polls.
- Rewriting `map-seed.spec.ts` and `predator-determinism.spec.ts` to drive
  both concurrently-booted pages with an identical, lockstep
  `qaAdvance` sequence (e.g. `Promise.all([page1, page2].map(p =>
  p.evaluate(() => window.ForestEngine.qaAdvance(N))))`) instead of two
  independent real-time polls.
- A "resume real time" escape hatch (see note above -- not needed by any
  known consumer).

## PR body

State the tier (`Tier: C -- engine/forest-engine.js`) and that this is Part 1
of LUL-2071 (hook only, no spec rewrites), matching this file.
