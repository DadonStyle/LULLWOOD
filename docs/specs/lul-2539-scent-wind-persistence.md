# SPEC: reduce scent-trail persistence 20% at high wind

**Ticket:** LUL-2539 (Scout proposal LUL-2485's CEO-accepted cheap slice).
**Decision:** [[decisions/lul-2485-scent-wind-tuning-accepted-2026-09-12]] — cheap tuning-only
slice accepted; the full updraft mechanic (VFX/audio/cost-gate) is deferred pending the
Economist's scent-point-economy measurement work (LUL-1413/1449/2461/2499).
**Spec owner:** Founding Engineer, per CTO's PLAN comment on LUL-2539 (2026-09-12T07:57Z).
**Implementer:** Game Engineer — this spec is written so no further exploration is needed.
**Tier:** C — `engine/forest-engine.js` simulation change (a real gameplay-balance dial, not a
bug fix). Requires `REVIEW: APPROVED` from Code Reviewer before merge, no `[ship]`.
**Read at:** `origin/release/next @ a841c08` (2026-09-12).
**Branch:** `lul-2539-scent-wind`, off `release/next`.

## What "high wind" means today (resolves the CTO's plan ambiguity)

The engine has no wind-*speed* concept — only a per-run wind *direction* unit vector
(`windX`/`windZ`, rolled once in `generateWind()`, `engine/forest-engine.js:1810-1813`). The
full LUL-2485 mechanic implies spatial wind-exposure geometry; that's the deferred part. This
slice adds the minimal thing that makes "high wind" exist: a per-run boolean, `windHighSpeed`,
rolled 50/50 alongside the direction roll.

**Roll it from an independent one-shot seeded generator**, not the shared `rng` stream:
`generateWind()` is the last `rng()` consumer before `generateBogTrees()`
(`engine/forest-engine.js:1108`, comment "appended after cover — doesn't reorder either
stream"). Adding a draw to the *shared* stream would shift every later map-gen roll for the
same seed — silent drift for `QA_PINNED_SEED`-based tests/screenshots. Use
`mulberry32(currentSeed ^ WIND_HIGH_SPEED_SEED_XOR)()` (`mulberry32` at
`engine/forest-engine.js:281`, `currentSeed` set at `engine/forest-engine.js:1062`) — a fresh,
disposable generator seeded off the map seed, so it's still deterministic per seed without
touching the shared stream at all. Pick any fixed non-zero constant for
`WIND_HIGH_SPEED_SEED_XOR` (e.g. `0x57494e44`) and name it so the intent ("perturb, don't
reuse") is obvious at the call site.

## Existing collision to avoid: `effectiveScentLifetime` is already taken

**Do not add a function named `effectiveScentLifetime` to `lib/game/scent.ts`.** That exact
name is already exported from `lib/game/economy.ts:171` — the Quiet Step embers-upgrade tier
math (`QUIET_STEP_LIFETIME_SECONDS`, 20%-faster-per-tier, compounding) — and is already
imported into `engine/forest-engine.js` (import block ending `engine/forest-engine.js:141`)
and called at six call sites as `effectiveScentLifetime(tierOf(embers, 'quietStep'))`. A
second export of the same name from a different module doesn't fail to compile by itself, but
this file already imports the economy one under that exact identifier — a same-name import
from `scent.ts` would collide on the existing import statement. Two independent multiplicative
knobs (embers-tier and wind) on the same base number is exactly what "compose, don't merge"
means here: wind wraps the *result* of the tier calc, economy.ts stays wind-ignorant.

### `lib/game/scent.ts` — new export

```ts
// Sibling to WIND_AGAINST_RADIUS_MULTIPLIER above (LUL-1724, same "-20% at wind" shape, but on
// lifetime rather than deposit radius). LUL-2539/2485 cheap slice.
export const WIND_HIGH_SPEED_LIFETIME_MULTIPLIER = 0.8; // CEO-accepted: 20% reduction

/** Wraps an already-tier-adjusted lifetime (economy.ts's `effectiveScentLifetime(tier)`) with
 * the high-wind reduction. Two independent multiplicative knobs stack here, not merge --
 * economy.ts's Quiet Step math stays wind-ignorant, this only ever receives its output. */
export function scentLifetimeWithWind(
  baseLifetime: number,
  highWind: boolean,
  multiplier: number = WIND_HIGH_SPEED_LIFETIME_MULTIPLIER,
): number {
  return highWind ? baseLifetime * multiplier : baseLifetime;
}
```

Place both right after the existing `WIND_AGAINST_RADIUS_MULTIPLIER` block
(`lib/game/scent.ts:116`) — same wind-tuning neighborhood.

### `lib/game/scent.test.ts` — new unit tests

Next to the existing `isMovingAgainstWind` block:
1. `scentLifetimeWithWind(14, false)` → `14` (default multiplier, unaffected).
2. `scentLifetimeWithWind(14, true)` → `11.2` (default multiplier applied).
3. `scentLifetimeWithWind(11.2, true)` → `8.96` — composition case: feeding in an
   already-tier-reduced lifetime (Quiet Step tier 1's `11.2`) proves the two knobs stack
   multiplicatively rather than one overriding the other.
4. Explicit `multiplier` param override (e.g. `0.5`) is honored, matching the existing
   `isScentDetected`-style default-param test pattern in this file.

## `engine/forest-engine.js` changes

**A. Import** — add `scentLifetimeWithWind` to the existing `@/lib/game/scent` import block
(`engine/forest-engine.js:42-56`), alphabetical, next to `isMovingAgainstWind`.

**B. New module state** — next to `windX`/`windZ` (`engine/forest-engine.js:1809`):
```js
let windHighSpeed = false;   // LUL-2539: rolled once per generateMap(), see generateWind()
```

**C. `generateWind()`** (`engine/forest-engine.js:1810-1813`) — roll it independently of `rng`:
```js
function generateWind(){
  const a = rng() * Math.PI * 2;
  windX = Math.cos(a); windZ = Math.sin(a);
  // LUL-2539: independent one-shot generator, NOT the shared `rng` stream -- generateWind()
  // is the last rng() consumer before generateBogTrees() (:1108), and drawing from the shared
  // stream here would shift every later map-gen roll for the same seed (QA_PINNED_SEED drift).
  windHighSpeed = mulberry32(currentSeed ^ 0x57494e44)() < 0.5;
}
```

**D. Six call sites** — every occurrence of `effectiveScentLifetime(tierOf(embers,
'quietStep'))` becomes `scentLifetimeWithWind(effectiveScentLifetime(tierOf(embers,
'quietStep')), windHighSpeed)`. Exact locations (grep the literal string to catch all —
line numbers will drift as earlier edits in this same diff shift them):
1. `:1938` — `depositScent()`'s prune-loop cutoff.
2. `:1947` — `checkScent()`'s per-point detection call.
3. `:3870` — `qaProbeScentOnOldest()`'s expiry gate.
4. `:4698` — the existing `qaProbeScentLifetime()` QA hook (see note below — do not add a
   *new* hook here, extend this one's already-correct purpose).
5. `:5981` — render-loop trail-point skip (`isScentExpired` guard).
6. `:5989` — render-loop trail alpha calc (`1 - age/effectiveScentLifetime(...)`).

Do not introduce a cached/hoisted variable for the wrapped call — the existing code already
repeats the bare `effectiveScentLifetime(tierOf(embers, 'quietStep'))` call inline at all six
sites rather than caching it once per frame; match that style exactly rather than refactoring
it as part of this change.

**E. `qaProbeWind()`** (`engine/forest-engine.js:3736-3738`) — add the new field to the existing
return object (cheap, matches the existing `windX`/`windZ` sibling shape; also fix the stale
`:1591/1594` line citation in its comment, which has drifted from earlier diffs to the real
`:1810/1812`):
```js
window.ForestEngine.qaProbeWind = function(){
  return { windX: windX, windZ: windZ, windHighSpeed: windHighSpeed };
};
```

**F. New QA hook — `qaSetWindHighSpeed(v)`** — place directly above `qaProbeScentLifetime`
(`:4698`), since that's the hook a test reads the effect through:
```js
// [QA-HOOK] LUL-2539: forces the high-wind scent-lifetime roll directly, bypassing the 50/50
// generateWind() draw -- a test can't rely on a coin flip for a deterministic assertion.
window.ForestEngine.qaSetWindHighSpeed = function(v){ windHighSpeed = !!v; };
```

**Deliberately not changed:**
- `pushState({windX, windZ})` (`:1109`) / the `EngineHudState`/`Hud.tsx` wind fields — no HUD
  consumer exists for `windHighSpeed` and the decision doc is explicit that this slice ships
  "no VFX/audio, no HUD caption, no cost gate — pure tuning knob." Adding an unread field to
  the pushed state and its React type would be speculative; skip it.
- `scentTrailLastFrame`/`qaProbeScentTrail()` snapshot — not needed for this feature's test
  coverage; `qaProbeScentLifetime()` already proves the wired-in effect on the exact number
  both detection and rendering consume.
- `economy.ts`'s `effectiveScentLifetime(tier)` — untouched; wind wraps its output, never its
  internals (see collision note above).

## `engine/forest-engine.d.ts` changes

- `qaProbeWind` return type (`engine/forest-engine.d.ts:151`): add `windHighSpeed: boolean;`.
- New entry, `qaSetWindHighSpeed?: (v: boolean) => void;`, next to `qaProbeScentLifetime`
  (`engine/forest-engine.d.ts:369`), with a one-line doc comment matching the existing style.

## Regression risk: two existing e2e specs assume a fixed 14s lifetime

Once `windHighSpeed` is wired into `qaProbeScentLifetime()`/`checkScent()`/the render loop,
any existing spec that reads or times against the *base* (tier-0, no-wind) `SCENT_LIFETIME`
without forcing wind off becomes a ~50%-flaky test the moment the natural roll lands "high
wind" on whatever seed the QA rig happens to boot. Confirmed sites (grepped against
`origin/release/next`, none of these are testing wind and forcing it off is the correct
minimal-risk default for all of them):

- **`e2e/embers-shop.spec.ts:52`** — `expect(await qaHook(page, 'qaProbeScentLifetime')).toBeCloseTo(14 * 0.8, 5)` after buying Quiet Step tier 1. Add `await qaHook(page, 'qaSetWindHighSpeed', false);` once, right after `boot()`/`enter()`, before any assertion in this test.
- **`e2e/scent-trail.spec.ts:101-103`** — hardcodes a local `SCENT_LIFETIME = 14` constant and computes expected alpha against it. Add the same `qaSetWindHighSpeed(false)` call in this spec's shared setup (wherever `boot`/`enter` is centralized for the file — check for a `test.beforeEach` or repeat per-test if there isn't one).
- **`e2e/scent.spec.ts`** and **`e2e/chase-gap-instrumentation.spec.ts`** — both seed/read scent points (`qaSeedScentPoint`/`qaProbeScentOnOldest`) without asserting an exact lifetime number today, so a shortened lifetime wouldn't fail these outright, but add `qaSetWindHighSpeed(false)` to their setup too as the same cheap, consistent insurance — none of these four files are the place LUL-2539's own behavior should be exercised.

## New e2e coverage — `e2e/scent-wind.spec.ts` (new file, micro world per LUL-2377)

```ts
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

test.describe('high-wind scent persistence (LUL-2539)', () => {
  test('qaSetWindHighSpeed toggles the effective scent lifetime by exactly 20%', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetWindHighSpeed', false);
    expect(await qaHook(page, 'qaProbeScentLifetime')).toBeCloseTo(14, 5);
    await qaHook(page, 'qaSetWindHighSpeed', true);
    expect(await qaHook(page, 'qaProbeScentLifetime')).toBeCloseTo(14 * 0.8, 5);
  });

  test('qaProbeWind reports the forced windHighSpeed flag', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    await qaHook(page, 'qaSetWindHighSpeed', true);
    expect((await qaHook(page, 'qaProbeWind')).windHighSpeed).toBe(true);
    await qaHook(page, 'qaSetWindHighSpeed', false);
    expect((await qaHook(page, 'qaProbeWind')).windHighSpeed).toBe(false);
  });

  test('a scent point ages out sooner under high wind than under normal wind', async ({ page }) => {
    // age=12: below the 14s normal-wind lifetime (still live) but past the
    // 14*0.8=11.2s high-wind lifetime (already expired). No predator species
    // requirement beyond whatever the micro world spawns -- reuse the pattern
    // from e2e/scent.spec.ts's qaSeedScentPoint + qaProbeScentOnOldest pair.
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);
    const kind = /* first species qaBuildScene's micro world spawns, per e2e/scent.spec.ts */;

    await qaHook(page, 'qaSetWindHighSpeed', true);
    await qaHook(page, 'qaSeedScentPoint', -5, 0, 12);
    expect(await qaHook(page, 'qaProbeScentOnOldest', kind)).toBeNull();

    await qaHook(page, 'qaSetWindHighSpeed', false);
    await qaHook(page, 'qaSeedScentPoint', -5, 0, 12);
    expect(await qaHook(page, 'qaProbeScentOnOldest', kind)).not.toBeNull();
  });
});
```

Fill in `kind` from whatever `e2e/scent.spec.ts` uses for its micro-world species (it already
solves this exact "which species spawns in the micro world" question — copy its answer rather
than re-deriving it).

## Test plan / verification

```bash
node --test lib/game/scent.test.ts
npx tsc --noEmit
npm run lint
npx playwright test e2e/scent-wind.spec.ts e2e/embers-shop.spec.ts e2e/scent-trail.spec.ts e2e/scent.spec.ts e2e/chase-gap-instrumentation.spec.ts e2e/wind-indicator.spec.ts e2e/wind-hint.spec.ts
```
Console-on-load: no new JS errors (unchanged requirement).

## `docs/ELEMENTS.md` updates (same PR)

- Next to the existing `WIND_AGAINST_RADIUS_MULTIPLIER` bullet (`docs/ELEMENTS.md:93-99`,
  which documents wind's *radius* effect at deposit time), add a sibling bullet for the
  *lifetime* effect: `windHighSpeed` rolled 50/50 per run in `generateWind()` from an
  independent seeded generator (not the shared `rng` stream, to avoid perturbing
  `QA_PINNED_SEED` map-gen reproducibility), reducing the effective scent lifetime by
  `WIND_HIGH_SPEED_LIFETIME_MULTIPLIER` (0.8, -20%) via `scentLifetimeWithWind()` — stacks
  multiplicatively with the Quiet Step tier reduction, not a replacement for it. No player-
  facing indicator; pure tuning knob per [[decisions/lul-2485-scent-wind-tuning-accepted-2026-09-12]].
- Next to the existing Quiet Step bullet (`docs/ELEMENTS.md:1423-1425`), add a one-line
  cross-reference to the new wind bullet so the two multiplicative knobs on the same number
  are discoverable from either description.
- Run `node scripts/check-elements-citations.mjs` after finishing the diff and fix every
  citation-line drift it reports, the same way the last several PRs in this repo have (a
  6-line insertion in the middle of `forest-engine.js` shifts every citation below it by a
  uniform offset — fix them as one pass at the end, not incrementally).

## `## e2e` section (for the local-qa / Code Reviewer gate)

New file `e2e/scent-wind.spec.ts` (micro world, `qaWorld: 'micro'`) directly exercises the new
`qaSetWindHighSpeed`/extended `qaProbeWind`/extended `qaProbeScentLifetime` hooks: toggling the
flag changes the effective lifetime by exactly 20% (pure-math proof) and changes whether a
12s-old seeded scent point is still detectable (mechanic-level proof, via the existing
`qaSeedScentPoint`/`qaProbeScentOnOldest` pair). Four pre-existing specs
(`embers-shop.spec.ts`, `scent-trail.spec.ts`, `scent.spec.ts`,
`chase-gap-instrumentation.spec.ts`) get one `qaSetWindHighSpeed(false)` call added to their
setup so the new 50/50 roll can't make them flaky — see "Regression risk" above. No new manual/
local-qa request needed: this is a pure balance-tuning change with a QA hook covering both the
math and the mechanic; nothing renders differently for a human to eyeball.
