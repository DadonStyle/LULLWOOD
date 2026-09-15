# SPEC: LUL-2664 mist veil detection-cut has zero e2e coverage

**Ticket:** LUL-2664 · **Tier:** C — `engine/forest-engine.js` + `engine/forest-engine.d.ts` are
edited (a new `?qaHooks` hook); `scripts/pr-tier.mjs` tiers all of `engine/**` as C
unconditionally, QA-hook-only or not. Needs `REVIEW: APPROVED` from the Code Reviewer before
merge. `e2e/veil.spec.ts` and `e2e/mobile/veil.spec.ts` are Tier A in isolation but the engine
edit dominates.

**Written against:** `release/next` @ `5448a14b` (2026-09-15). Re-derive every `file:line` below
from the branch you actually implement on if it has moved.

## Background

`e2e/mobile/veil.spec.ts` (the only veil test in the repo, 36 lines) asserts
`qaPlayerState().veilHeld` flips on `touchVeil` pointerdown/up — that the input is wired, not
that the veil does anything. There is no desktop `e2e/veil.spec.ts`. The veil's entire gameplay
purpose is `veilDetectMul(veilAmount)` (`lib/game/veil.ts:77`) feeding the detect multiplier
`canSee()` uses (`engine/forest-engine.js:2438`) — that multiplier has never been exercised by a
test with a predator in it. Split from LUL-2613 (founder audit of `e2e/hide.spec.ts:25`'s own
"no predator is used anywhere in this file" admission); this ticket is the same shape applied to
the veil.

## The scenario, and why these exact numbers

The test needs a predator that can see the player before the veil is held and provably cannot
after, with the flip caused *only* by `veilDetectMul` — no cover, no stillness, no charge, and no
chase movement closing the gap mid-hold (which would silently substitute "the lion got closer"
for "the veil worked").

**Math (QA micro world, the e2e default per LUL-2377 — `CONFIG.detectScaleMul = 0.2`,
`engine/tuning.js:216`):**

- `canSee()` → `lib/game/cover.ts:721-750`: `false` if `dist >= effectiveDetect(...)`, else a
  `hasLOS` check.
- `effectiveDetect()` → `lib/game/cover.ts:713-717`: `detect * (1 - stillness*STILL_DETECT_CUT) *
  detectMul * carryMul`. Not hiding → `stillness = 0`. Not carrying → `carryMul = 1`.
- Lion `detect = 48` (`engine/tuning.js:255`). Default difficulty `'night'`
  (`engine/forest-engine.js:1860`) → `detectMul = 1` (`engine/tuning.js:299`).
- Pre-veil: `veilDetectMul(0) = 1` (`lib/game/veil.ts:77`, confirmed by the existing comment at
  `engine/forest-engine.js:4568`: "micro world CONFIG.detectScaleMul shrinks effective detect to
  ~9.6"). `fogTideDetectMul`/`timeOfRunDetectMul` are both `1` with no fog tide or time-of-run
  event running. So **pre-veil effectiveDetect ≈ 48 × 1 × 1 × 1 × 1 × 0.2 = 9.6**.
- Full ramp: `VEIL_DETECT_MUL = 0.35` (`lib/game/veil.ts` const), `veilDetectMul(v) = 1 - v×0.65`
  (`lib/game/veil.ts:77`). At `veilAmount = 0.9` (LUL-2471's measured ~3.68s continuous-hold
  point, `VEIL_RAMP = 1.6` — `engine/tuning.js:152`, exponential ramp
  `engine/forest-engine.js:5974`): `veilDetectMul(0.9) = 1 - 0.585 = 0.415`. **Post-veil
  effectiveDetect ≈ 9.6 × 0.415 ≈ 3.98**.
- **Fixed test distance: 6 units.** `6 < 9.6` (canSee true pre-veil, 38% margin) and
  `6 ≥ 3.98` (canSee false at veilAmount ≥ 0.9, 34% margin). Both margins are comfortable and on
  opposite sides of 0.9 — not racing the ramp's asymptote, and stopping the poll at 0.9 rather
  than 0.95+ keeps ~1.3s of buffer before `VEIL_MAX_HOLD = 5s` (`lib/game/veil.ts`) would start
  draining the veil to a lockout.
- **6 units is inside the guaranteed-clear spawn disc** (`inSpawn`, `r < ~6.32`,
  `e2e/positional-hiding.spec.ts:38` / `engine/forest-engine.js:4229`) that `generateCover()`
  keeps free of cover. Player at `(0,0)`, predator at `(6,0)` are both inside that disc, and the
  disc is convex, so the whole line-of-sight segment between them is guaranteed clear too —
  `hasLOS` is a non-issue, not something to poll for.
- **No chase drift:** placing the predator in `state: 'chase', hunt: true` and then holding it
  for several seconds would let the real chase-movement code close the gap while canSee is still
  true early in the ramp, corrupting the fixed distance. Pin it in place using the same trick
  `qaHideBehindCover` already uses (`engine/forest-engine.js:4316`'s own comment): `p.reroute > 0`
  is checked *before* the `hunt`/`state` branch chain in `updatePredators()`, so a live
  `p.reroute` holds the predator's position (and skips `shouldTriggerCharge` entirely) without
  touching `canSee()` — `qaPredatorState()`'s `canSee(p, dist)` call is a pure, independent
  computation off live `veilAmount` at query time, not a cached per-frame field, so freezing
  movement does not freeze the value under test.

## Files

- `engine/forest-engine.js` — add `qaOpenVeilTarget(kind)` hook, placed directly after
  `qaOpenHideNearLion` (ends `engine/forest-engine.js:4253`, before the `// Case 2:` comment at
  `:4256`).
- `engine/forest-engine.d.ts` — declare the new hook next to `qaOpenHideNearLion` (`:143`).
- `e2e/veil.spec.ts` — new file, desktop KeyF-hold test.
- `e2e/mobile/veil.spec.ts` — add a second test alongside the existing pointerdown/up one,
  exercising `touchVeil` through the same detection assertion.

## The change

### `engine/forest-engine.js`, inserted after line 4253 (end of `qaOpenHideNearLion`)

```js
// LUL-2664: places a named predator 6 units out in the spawn clearing --
// no cover, not hiding, no charge, pinned in place (see docs/specs/
// lul-2664-veil-detection-e2e.md for the full derivation) -- so a test can
// isolate veilDetectMul()'s cut to canSee() from every other variable.
// Distinct from qaOpenHideNearLion's dist=4 (tuned so "even full stillness
// must still catch you", not a veil-flip margin) and qaTriggerCharge's
// dist=11.5 (mid-CHARGE_TRIGGER band, and it actually starts a charge
// sequence -- this hook must not, a charge resolving on its own game-time
// clock mid-hold would corrupt the test). `reroute` pins the predator the
// same way qaHideBehindCover does (see that hook's own comment,
// engine/forest-engine.js:4316): reroute>0 is checked before hunt/state in
// updatePredators(), so the predator never approaches and never rolls
// shouldTriggerCharge while it's set, but qaPredatorState()'s canSee(p,dist)
// stays a live computation off the real veilAmount -- only movement freezes,
// not the value under test. Returns the predator's `predators` index, or
// null if that species isn't spawned.
window.ForestEngine.qaOpenVeilTarget = function(kind){
  const idx = predators.findIndex(p => p.kind === kind);
  if(idx < 0) return null;
  const target = predators[idx];
  for(const p of predators){
    if(p === target) continue;
    if(p.charge){ p.charge = null; endChargeHud(); }
    p.hunt = false;
  }
  player.x = 0; player.z = 0;
  target.x = 6; target.z = 0;
  target.vx = target.vz = 0; target.alert = 0; target.stuckT = 0; target.sightLock = null;
  target.state = 'chase'; target.hunt = true; target.alertedBy = null; target.charge = null; target.scentLock = 0;
  target.reroute = 10; target.rrX = target.x; target.rrZ = target.z;
  return idx;
};
```

### `engine/forest-engine.d.ts`, inserted after the `qaOpenHideNearLion` declaration (`:143`)

```ts
/** LUL-2664: places predator `kind` 6 units out in the spawn clearing, in the open,
 * pinned via `reroute` so it cannot close the gap mid-veil-hold -- isolates
 * veilDetectMul()'s canSee() cut from cover/stillness/chase-drift. Returns the
 * predator's `predators` index, or null if that species isn't spawned. */
qaOpenVeilTarget?: (kind: 'wolf' | 'bear' | 'lion') => number | null;
```

### `e2e/veil.spec.ts` (new file)

```ts
// LUL-2664: e2e/mobile/veil.spec.ts only asserts qaPlayerState().veilHeld flips
// on touchVeil pointerdown/up -- that the input is wired, not the veil's actual
// gameplay purpose. That purpose is entirely veilDetectMul(veilAmount)
// (lib/game/veil.ts:77) feeding canSee()'s detect multiplier
// (engine/forest-engine.js:2438), which had zero e2e coverage before this file
// -- a regression here would pass every existing test, the same shape as the
// hiding-test gap LUL-2613 audited (e2e/hide.spec.ts:25's own "no predator is
// used anywhere in this file"). See docs/specs/lul-2664-veil-detection-e2e.md
// for the distance/threshold derivation.
//
// Driven via qaSetFixedStep/qaAdvance (docs/specs/lul-2071-deterministic-qa-
// clock.md) instead of a wall-clock wait for the ramp to climb -- LUL-2471
// measured VEIL_RAMP=1.6s exponential (engine/tuning.js:152), ~3.68s
// continuous hold to cross veilAmount=0.9; a real-time wait races swiftshader
// frame-time variance for no reason once F is held and dt is fixed.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const POLL_STEPS = 10;       // 0.2s game-time per poll
const MAX_STEPS = 250;       // 5s ceiling -- ramp should cross 0.9 by ~3.68s (184 steps)
const VEIL_THRESHOLD = 0.9;  // matches LUL-2471's measured point; see spec doc for margin math

test('holding the veil (KeyF) cuts a lion\'s sight range enough to lose the player, with no cover, stillness or chase drift involved', async ({ page }) => {
  await boot(page, { qaHooks: true });
  await enter(page);

  const idx = await qaHook(page, 'qaOpenVeilTarget', 'lion');
  expect(idx, 'qaOpenVeilTarget("lion") must find a spawned lion').not.toBeNull();

  const before = await qaHook(page, 'qaPredatorState', idx);
  expect(before?.canSee, 'lion must see the player before the veil is held').toBe(true);
  expect(before?.dist, 'test distance must be the fixed 6 units the spec derives its margins from').toBeCloseTo(6, 1);

  await qaHook(page, 'qaSetFixedStep', FIXED_DT);
  await page.keyboard.down('KeyF');

  let veilAmount = 0;
  let steps = 0;
  while (veilAmount < VEIL_THRESHOLD && steps < MAX_STEPS) {
    await qaHook(page, 'qaAdvance', POLL_STEPS);
    steps += POLL_STEPS;
    const trail = await qaHook(page, 'qaProbeScentTrail');
    veilAmount = trail?.veilAmount ?? 0;
  }
  expect(veilAmount, `veilAmount must cross ${VEIL_THRESHOLD} within ${MAX_STEPS * FIXED_DT}s of holding F`).toBeGreaterThanOrEqual(VEIL_THRESHOLD);

  const after = await qaHook(page, 'qaPredatorState', idx);
  expect(after?.dist, 'the pinned predator must not have drifted during the hold').toBeCloseTo(6, 1);
  expect(after?.canSee, 'a ramped veil must cut the lion\'s sight range enough to lose a player it could see a moment ago, purely off the veil multiplier').toBe(false);

  await page.keyboard.up('KeyF');
});
```

### `e2e/mobile/veil.spec.ts` (append inside the existing `test.use({ viewport })` block, after
the current pointerdown/up test)

```ts
// LUL-2664: the existing test above only proves touchVeil drives the same
// veilHeld boolean the F key drives -- it never holds long enough for the
// ramp to matter. This proves the touch path reaches the same detection cut
// the desktop e2e/veil.spec.ts proves for KeyF, via the identical
// qaOpenVeilTarget/qaSetFixedStep/qaAdvance staging (see
// docs/specs/lul-2664-veil-detection-e2e.md for the distance/threshold math).
test('holding the Veil button cuts a lion\'s sight range the same way the F key does', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  const veilBtn = page.getByTestId('touchVeil');
  await expect(veilBtn).toBeVisible();

  const idx = await qaHook(page, 'qaOpenVeilTarget', 'lion');
  expect(idx, 'qaOpenVeilTarget("lion") must find a spawned lion').not.toBeNull();

  const before = await qaHook(page, 'qaPredatorState', idx);
  expect(before?.canSee, 'lion must see the player before the veil is held').toBe(true);

  await qaHook(page, 'qaSetFixedStep', 0.02);
  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await veilBtn.dispatchEvent('pointerdown', pointerOpts);

  let veilAmount = 0;
  let steps = 0;
  const MAX_STEPS = 250;
  while (veilAmount < 0.9 && steps < MAX_STEPS) {
    await qaHook(page, 'qaAdvance', 10);
    steps += 10;
    const trail = await qaHook(page, 'qaProbeScentTrail');
    veilAmount = trail?.veilAmount ?? 0;
  }
  expect(veilAmount, `veilAmount must cross 0.9 within ${MAX_STEPS * 0.02}s of holding the Veil button`).toBeGreaterThanOrEqual(0.9);

  const after = await qaHook(page, 'qaPredatorState', idx);
  expect(after?.canSee, 'a ramped veil must cut the lion\'s sight range enough to lose the player, same as the desktop F-hold path').toBe(false);

  await veilBtn.dispatchEvent('pointerup', pointerOpts);
});
```

This needs `qaHook` added to that file's existing `import { boot } from '../helpers';` →
`import { boot, qaHook } from '../helpers';` (strictly better than the file's existing raw
`page.evaluate(() => window.ForestEngine?.x?.())` optional-chaining style, which silently
no-ops on a missing hook instead of failing loud — wiki: `game/qa-hooks-silent-noop`). Leave the
existing first test's style untouched; only the new test uses `qaHook`.

## Verification

- `npx playwright test e2e/veil.spec.ts` — new desktop test passes.
- `npx playwright test e2e/mobile/veil.spec.ts` — both tests (existing + new) pass.
- `npx tsc --noEmit` — the `.d.ts` addition type-checks against the new hook's actual signature.
- `npx eslint engine/forest-engine.js e2e/veil.spec.ts e2e/mobile/veil.spec.ts`

## e2e

**Specs.** `e2e/veil.spec.ts` — "holding the veil (KeyF) cuts a lion's sight range enough to
lose the player, with no cover, stillness or chase drift involved" (new). `e2e/mobile/veil.spec.ts`
— "holding the Veil button cuts a lion's sight range the same way the F key does" (new, appended;
the existing pointerdown/up test is unmodified and must still pass).
**World.** micro (default, LUL-2377). No `qaBuildScene` needed — `qaOpenVeilTarget` stages
entirely inside the always-present spawn clearing and the always-spawned lion (`activePerSpecies:
3` at `'night'`, unaffected by `applyQaWorldMicroPreset()`).
**Hooks.** `window.ForestEngine.qaOpenVeilTarget(kind): number | null` — new, declared in
`engine/forest-engine.d.ts`, installed in the `?qaHooks` block in `init()` right after
`qaOpenHideNearLion`. Existing hooks reused unchanged: `qaSetFixedStep`/`qaAdvance`
(`engine/forest-engine.js:3904/3908`), `qaPredatorState` (`:4612`), `qaProbeScentTrail`
(`:5101`).
**Tester scenario.** None: not player-visible. This ticket adds test coverage and one QA-only
hook; it changes no gameplay, HUD, or copy a player can see.
**Not covered.** Feel (how "foggy" the mist visually reads while holding F) stays manual —
this spec only proves the detect-multiplier math, not the fog-density visual (`veilFogDensity`,
already separately unit-tested per `lib/game/veil.ts`'s own header comment on why it was lifted
out testable).

## Cues

N/A — this spec adds no player-visible state, copy, or HUD element. The veil's existing cues
(fog density ramp, `#veilCharge`-style HUD if any) are unchanged; nothing here is new surface
per the Founder rule 2026-09-13 feature checklist Q1–Q16 (this is test infrastructure, not a
feature).

## Constraints

- `qaOpenVeilTarget` must not call `startCharge()` or otherwise put the target predator into a
  charge sequence — that resolves on its own game-time clock and would corrupt the fixed-distance
  test the same way un-pinned chase movement would.
- The 6-unit distance and 0.9 veil-amount threshold are load-bearing (see the margin math above);
  do not "round" them without recomputing the margins against whatever `CONFIG.detectScaleMul`
  and difficulty preset are live in the micro world at merge time.
- Do not touch the existing `e2e/mobile/veil.spec.ts` pointerdown/up test — it stays exactly as
  is, this only appends a second test to the file.

## Out of scope

- Wolf/bear coverage of the same veil-flip scenario — the ticket and LUL-2613's audit both scope
  this to "the mist veil" generically; lion is the species every other open-clearing QA hook in
  this file already uses (`qaOpenHideNearLion`, `qaTriggerCharge`'s common case), so reusing it
  keeps this spec's math traceable against existing comments. `qaOpenVeilTarget` takes `kind` as
  a parameter specifically so a future ticket can extend species coverage without a new hook.
- Veil charge/lockout mechanics (`stepVeilCharge`, `VEIL_MAX_HOLD`, the Stone Marker reserve) —
  already unit-tested per `lib/game/veil.ts`'s own scope note; this spec only needs the charge to
  stay above zero through the ~3.68s hold, which it comfortably does.
- Fog-tide / time-of-run compounding multipliers on top of the veil cut — out of scope for
  isolating the veil's own contribution; those already have (or need) their own coverage
  separately.
