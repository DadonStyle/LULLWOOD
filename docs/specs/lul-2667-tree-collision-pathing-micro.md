# SPEC: LUL-2667 (5/6) Migrate tree collision + predator pathing e2e off @fullmap

**Ticket:** LUL-2667 child 5/6 · **Tier:** B — one small, additive `engine/forest-engine.js`
change (mirrors existing logic, runs only inside a QA-invoked hook, zero effect on any real
player code path) + two e2e spec files + the allowlist policy test. No gameplay behaviour
changes; CI green is the gate, no Code Reviewer hold, but flag on the PR for visibility since
it is an engine file.

**Written against:** `release/next` @ `c1b1938` (2026-09-22).

## Files

- `engine/forest-engine.js` — edited. `qaBuildScene` (`:5694-5764`) gains one loop mirroring
  `generateCover()`'s own large-tree LOS-cover synthesis.
- `e2e/tree-collision.spec.ts` — created. Ports the `tree` iteration of
  `e2e/lul211-founder-report.spec.ts`'s `@fullmap` loop (Part A).
- `e2e/lul211-founder-report.spec.ts` — edited. The entire `describe('LUL-211: cover props are
  solid @fullmap', ...)` block (`:133-191`) is deleted — `tree` was its last case (`rock`
  already left via LUL-2684, `log`/`bramble` via LUL-2685).
- `e2e/tree-pathing.spec.ts` — edited in place (not replaced). Boot switches to the default
  micro world; staging goes through a new `qaBuildScene` call before the existing
  `qaStageAndTraceBehindTree` call. The file's 42-line header (LUL-1091/1461/1597 history) is
  kept, with one paragraph appended for this migration (Part B).
- `lib/e2e-policy/world-policy.test.ts` — edited. Both files drop off `FULLMAP_ALLOWLIST`
  (`:31`, `:38`); the shrink assertion (`:110`) count drops from 14 to 12.
- `shared/local-qa/requests/lul-2667-tree-collision-pathing.md` — created (outside the repo,
  per `REQUESTING-A-TEST.md`, not part of this PR).

## Why this is not a pure mechanical swap (read before implementing)

`qaStageWalkIntoCover(kind)` (`engine/forest-engine.js:4334-4363`) reads `coverData`, not
`treeData`. For every other kind, `coverData` rows come from caller-given `qaBuildScene`
`props` directly. For `tree`, on a **real** map they come from `generateCover()`:

```js
// engine/forest-engine.js:737
for(const t of treeData) if(!t.culled && t.s > 1.4) coverData.push({ x: t.x, z: t.z, hx: t.cr*1.4, hz: t.cr*1.4, kind: 'tree' });
```

`qaBuildScene` (`:5694-5764`) builds `treeData` directly from `opts.trees` (`:5700-5703`) and
never calls `generateCover()` — it assigns `coverData` from `opts.props` only (`:5705-5707`).
A `qaBuildScene({ trees: [{x,z}] })` scene therefore has **zero** `coverData` rows with
`kind==='tree'`, so `qaStageWalkIntoCover('tree')` returns `null` unconditionally today. This
is the actual reason `tree` was left in the `@fullmap` loop when `rock` (LUL-2684) and
`log`/`bramble` (LUL-2685) moved — not because the collision itself needs the real seed.

The real movement collision against a tree trunk does **not** go through `coverData` at all —
it is the trunk's circular radius `t.cr` via `blockedR()`'s own spatial grid, built off
`treeData` directly (LUL-388's own comment at `:4340-4343` says this explicitly: *"A tree's
real MOVEMENT collision is the circular trunk radius t.cr via blockedR()'s own grid, unrelated
to that square"*). `qaBuildScene` already builds `treeData` and calls `buildGrid()`
(`:5728`), so **collision already works today** in a `qaBuildScene` micro scene — only the
staging hook's lookup is broken. The fix is additive and narrow: give `qaBuildScene` the same
`coverData` synthesis `generateCover()` does, for the same `s > 1.4` subset.

## Part A: player-vs-tree collision

### `engine/forest-engine.js` (edit)

Insert immediately after the existing `coverData = (opts.props || [])...` assignment
(`:5705-5707`):

```js
coverData = (opts.props || [])
  .filter(p => QA_COVER_SHAPE[p.kind])
  .map(p => ({ x: p.x, z: p.z, kind: p.kind, ry: p.ry || 0, ...QA_COVER_SHAPE[p.kind] }));
// LUL-2667 (child 5/6): mirror generateCover()'s own large-tree LOS-cover
// synthesis (:737 -- `if(!t.culled && t.s > 1.4) coverData.push({ x, z,
// hx: t.cr*1.4, hz: t.cr*1.4, kind: 'tree' })`) for qaBuildScene-placed
// trees. Without this, qaStageWalkIntoCover('tree') -- which reads
// coverData, not treeData -- can never find a synthetic tree. Real
// movement collision against the trunk goes through blockedR()'s grid off
// treeData directly and already worked before this change; only the
// staging hook's tree branch was unreachable in a qaBuildScene world.
for(const t of treeData) if(!t.culled && t.s > 1.4) coverData.push({ x: t.x, z: t.z, hx: t.cr*1.4, hz: t.cr*1.4, kind: 'tree' });
```

`!t.culled` is always true for a `qaBuildScene` tree (`:5702` hardcodes `culled: false`) — kept
for byte-for-byte parity with `generateCover()` rather than dropped as dead, in case a future
change ever makes `qaBuildScene` cull.

**Side effect to expect, not a bug:** `qaBuildScene`'s return value `props: coverData.length`
(`:5761`) now includes this synthetic row. A scene with one qualifying tree and zero explicit
`props` returns `{ trees: 1, props: 1, predators: 0 }`, not `props: 0`.

### `e2e/tree-collision.spec.ts` (new)

Same shape as `e2e/rock-collision.spec.ts` (LUL-2684) — ports the assertion body of
`lul211-founder-report.spec.ts:151-190` unchanged (byte-for-byte same face-math and
tolerances), staged via `qaBuildScene` instead of the real-seed search:

```ts
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

// LUL-2667 (child 5/6): migrates the 'tree' case of
// e2e/lul211-founder-report.spec.ts's "LUL-211: cover props are solid @fullmap"
// loop off the full map -- the last remaining case there (rock/log/bramble
// already migrated, LUL-2684/LUL-2685). Needs one extra step beyond that
// pattern: qaBuildScene's tree placement did not synthesize the LOS-cover
// entry qaStageWalkIntoCover('tree') reads from coverData (only
// generateCover() did, for real maps, gated on t.s > 1.4) -- added in this
// change (engine/forest-engine.js). See
// docs/specs/lul-2667-tree-collision-pathing-micro.md.
test.describe('LUL-211: cover props are solid (tree, qaWorld=micro)', () => {
  test('walking straight into a tree does not pass through it', async ({ page }) => {
    test.setTimeout(45_000);
    await boot(page, { qaHooks: true }); // qaWorld defaults to 'micro' (helpers.ts)
    await enter(page);

    // s: 1.5 (> 1.4) -- generateCover()'s own large-tree threshold for a
    // synthetic LOS-cover entry; qaBuildScene mirrors it.
    const built = await qaHook(page, 'qaBuildScene', { trees: [{ x: 10, z: 0, s: 1.5 }] });
    expect(built).toEqual({ trees: 1, props: 1, predators: 0 });

    const staged = await qaHook(page, 'qaStageWalkIntoCover', 'tree');
    expect(staged, 'no reachable tree to stage against').not.toBeNull();
    const { prop, start } = staged!;
    expect(start.x, 'staged start is already inside the prop').toBeLessThan(prop.x - prop.hx);

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(3_000);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(200);

    const end = await qaHook(page, 'qaProbePlayer');

    expect(end.x, 'the player never moved toward the prop').toBeGreaterThan(start.x + 0.3);
    // Tree's staged prop is a circle (hx===hz, ry=0) -- the general
    // rotated-rect face-math ported unchanged from the rock/log migrations
    // collapses correctly to the circular case (absCos=1, absSin clamped to
    // ~1e-6), same as the original full-map test relied on.
    const ry = prop.ry ?? 0;
    const absCos = Math.max(Math.abs(Math.cos(ry)), 1e-6);
    const absSin = Math.max(Math.abs(Math.sin(ry)), 1e-6);
    const faceDx = Math.max(-(prop.hx + 0.6) / absCos, -(prop.hz + 0.6) / absSin);
    const faceX = prop.x + faceDx;
    expect(
      end.x,
      `player reached x=${end.x.toFixed(2)}, past the tree face at x=${faceX.toFixed(2)} (prop centre ${prop.x.toFixed(2)}, hx ${prop.hx.toFixed(2)}, ry ${ry.toFixed(3)})`,
    ).toBeLessThan(faceX + 0.35);
  });
});
```

### `e2e/lul211-founder-report.spec.ts` (edit)

Delete the whole `describe('LUL-211: cover props are solid @fullmap', ...)` block
(`:133-191`) — `tree` was its last case. In the file's header comment block (`:14-32`, the
section documenting `rock`/`log`/`bramble`'s prior departures), add one more sentence noting
`tree`'s departure and pointing at this spec doc, following the exact pattern the LUL-2684/
LUL-2685 diffs already used there (append-a-sentence, do not restructure).

## Part B: predator-vs-tree pathing

`qaStageBehindTree`/`qaStageAndTraceBehindTree` (`engine/forest-engine.js:5325-5405`) read
`treeData` directly (`for(const t of treeData)`, `:5329`) — never `coverData` — so Part A's
engine change is irrelevant here; **no further engine change is needed for Part B.** The
hook's own neighbour-isolation check (`:5342-5347`, rejects any tree with a neighbour close
enough to crowd the lane) trivially passes on a single-tree scene: the loop over `treeData`
has nothing else to reject against.

### `e2e/tree-pathing.spec.ts` (edit in place)

Append to the existing 42-line header (keep it — LUL-1091/1461/1597 context, do not drop it):

```
// LUL-2667 (child 5/6, 2026-09-22): migrated off @fullmap. qaStageBehindTree's
// own tree search and neighbour-isolation math (engine/forest-engine.js:5325-
// 5361) are unchanged and don't care how treeData was populated -- a
// qaBuildScene single-tree scene satisfies the isolation check trivially (no
// second tree exists to crowd the lane). MARGIN/MAX_MS below were re-measured
// live against the synthetic scene (see this migration's PR description) and
// left unchanged: same per-tree standoff derivation, same physics: no
// real-seed trunk-cluster variance to absorb anymore, if anything a tighter
// worst case than the full-map measurement they were originally tuned
// against.
```

Change the boot + add a `qaBuildScene` call per test, immediately before the existing
`qaStageAndTraceBehindTree` call:

```diff
 test.describe('predator behind a tree reaches the player (LUL-1091 regression) @fullmap', () => {
+// -> 'predator behind a tree reaches the player (LUL-1091 regression, qaWorld=micro)'
   for (const kind of ['wolf', 'bear', 'lion'] as const) {
     test(`${kind}: staged directly behind a tree trunk, closes to contact range`, async ({ page }) => {
-      await boot(page, { qaWorld: 'full',  qaHooks: true });
+      await boot(page, { qaHooks: true }); // qaWorld defaults to 'micro' (helpers.ts)
       await enter(page);

+      const built = await page.evaluate(
+        ({ k }) => window.ForestEngine?.qaBuildScene?.({ trees: [{ x: 10, z: 0 }], predators: [{ kind: k, x: 0, z: 0 }] }),
+        { k: kind },
+      );
+      expect(built).toEqual({ trees: 1, props: 0, predators: 1 });
+
       const result = await page.evaluate(
         ({ k, margin, maxMs }) => window.ForestEngine?.qaStageAndTraceBehindTree?.(k, margin, maxMs) ?? null,
         { k: kind, margin: MARGIN, maxMs: MAX_MS },
       );
```

Everything after (the `result === null` guard, the `trace[0]`/`last.reached` assertions) is
untouched — `qaStageAndTraceBehindTree` overwrites the predator's and player's position itself
(`:5348-5352`), so the placeholder `x: 0, z: 0` given to `qaBuildScene` for the predator is
immaterial; only the `kind` claim matters (claims `speciesIdx: 0` for that kind so
`predators.findIndex(p => p.kind === kind)` in `stageBehindTree` finds an active, non-inert
instance — `:5746-5750` parks every unclaimed predator `inert` otherwise).

Also drop `test.setTimeout()` overrides if any were added since the file's own comment at
`:66-75` explaining why an explicit override is wrong here — none exist in the current file,
leave as-is.

Retitle the outer `describe` (drop `@fullmap` from the title, per the diff above) and remove
the `// fullmap-reason:` comment at `:45`.

**Live re-verification required before merge (do not skip):** run
`npx playwright test e2e/tree-pathing.spec.ts` against the migrated file and confirm all three
species (wolf/bear/lion) still resolve `reached: true` comfortably inside `MAX_MS=8_000`. If
any species times out, the fix is almost certainly `MARGIN` (the standoff derivation is
identical, so a timeout here would mean the synthetic single-tree scene's geometry differs
from what the tuned constants assumed — re-derive, do not just raise `MAX_MS` blindly per
`AGENTS.md`'s "a failing test is a finding" rule, applied here at spec-authoring time as much
as at QA time).

## `lib/e2e-policy/world-policy.test.ts` (edit)

Remove both allowlist entries:

```diff
-  'e2e/lul211-founder-report.spec.ts': "founder's walk-into-cover replays on the pinned full layout",
   'e2e/prop-density.spec.ts': 'per-chunk caps over the full 8x8 grid',
   ...
-  'e2e/tree-pathing.spec.ts': "go-around against the pinned seed's trunk clusters",
```

Update the shrink assertion (`:105-110`):

```diff
-  // LUL-2740 (2026-09-17): +1 for e2e/mission-landmark-sync.spec.ts, the one
-  // case this ticket's own CTO fix-direction requires -- promotes a manual
-  // request file that was timing out (shared/local-qa/requests/lul-2187-
-  // mission-panel-overlap.md) into real CI coverage of a full-map-only code
-  // path (mission target must sync to the landmark's real, unscaled placement).
-  assert.ok(Object.keys(FULLMAP_ALLOWLIST).length <= 14, 'the @fullmap allowlist may only shrink (14 on 2026-09-17, was 13 on 2026-09-11)');
+  // LUL-2740 (2026-09-17): +1 for e2e/mission-landmark-sync.spec.ts (see git
+  // blame for the full note). LUL-2667 child 5 (2026-09-22): -2, both
+  // lul211-founder-report.spec.ts (tree case migrated to
+  // e2e/tree-collision.spec.ts) and tree-pathing.spec.ts (migrated in place)
+  // -- first PR in this migration series to actually shrink the count
+  // (rock/log left lul211-founder-report.spec.ts on the list since tree
+  // still needed it).
+  assert.ok(Object.keys(FULLMAP_ALLOWLIST).length <= 12, 'the @fullmap allowlist may only shrink (12 on 2026-09-22, was 14 on 2026-09-17, 13 on 2026-09-11)');
```

## Verification

- `npx playwright test e2e/tree-collision.spec.ts` — new test passes on the default (micro)
  project.
- `npx playwright test e2e/tree-pathing.spec.ts` — all 3 species pass on the default (micro)
  project; **live re-verify timing**, see Part B note above.
- `npx playwright test e2e/lul211-founder-report.spec.ts` — remaining describe blocks
  (win/lose sequence, log/bramble already gone) still pass; the file no longer boots
  `qaWorld: 'full'` at all.
- `npm test` (node --test) — `lib/e2e-policy/world-policy.test.ts` green with the new count.
- `node --run lint` / `tsc` — clean.
- `node scripts/check-elements-citations.mjs` — clean; no `docs/ELEMENTS.md`-cited symbol
  touched (this is test-infra + a QA-hook-only engine addition, not a gameplay element).

## e2e

**Specs.** `e2e/tree-collision.spec.ts` — "walking straight into a tree does not pass through
it" (new, Part A). `e2e/tree-pathing.spec.ts` — "`${kind}`: staged directly behind a tree
trunk, closes to contact range" x3 (wolf/bear/lion, migrated in place, Part B).

**World.** micro (default) for both — `qaBuildScene({ trees: [{ x: 10, z: 0, s: 1.5 }] })` for
Part A (the `s: 1.5` is load-bearing, see above), `qaBuildScene({ trees: [{ x: 10, z: 0 }],
predators: [{ kind, x: 0, z: 0 }] })` for Part B (default `s`, tree only needs to exist —
LOS-cover synthesis is irrelevant to trunk-collision pathing).

**Hooks.** `qaBuildScene({...}): {trees,props,predators}` — existing, extended in this PR
(`engine/forest-engine.js:5694`, new tree→coverData loop). `qaStageWalkIntoCover(kind)` —
existing, unchanged (`:4334`). `qaProbePlayer()` — existing, unchanged. `qaStageBehindTree`/
`qaStageAndTraceBehindTree` — existing, unchanged (`:5362`, `:5399`). No new hook name; one
existing hook's behaviour extends (documented above), covered by the new spec assertions on
`built` (`{trees,props,predators}` shape) in both files.

**Tester scenario.** `shared/local-qa/requests/lul-2667-tree-collision-pathing.md`, filed
alongside this spec — spot-checks both the tree-collision fact and one species' pathing
directly against a build, beyond the nightly `e2e/` re-run.

**Not covered.** Feel/audio — none apply (pure collision-geometry and pathing-timing
assertions, no cue triple, matching the rock/log precedent). CI/real-device timing variance in
the wall-clock trace windows — pre-existing risk class (`wiki: systems/dt-clamp-vs-walltime`),
unchanged by this migration; if anything reduced (no real-seed neighbour-tree variance left to
absorb).

## Cues

Not applicable — test-infrastructure migration plus a QA-hook-only engine addition, no
player-visible state, no new render/HUD/audio/caption. Nothing in section A of
`docs/FEATURE_CHECKLIST.md` applies.

## Constraints

- Do not change the face-math, tolerances, `MARGIN`, or the standoff-derivation math ported
  from the originals — byte-for-byte equivalent, only the staging/boot mechanism changes.
- The `qaBuildScene` engine change is additive only: it must not alter behaviour for any
  caller that never passes `trees` with `s > 1.4`, and must not run in any code path a real
  player's session reaches (it already only runs inside a hook the `qaHooks` gate exposes).
- Do not touch `QA_COVER_SHAPE` (`:5667-5672`) — tree's LOS-cover shape is derived from `t.cr`
  per-tree, not a fixed constant like the other four kinds.
- Preserve `e2e/tree-pathing.spec.ts`'s header comment history (LUL-1091/1461/1597) — append,
  do not delete or rewrite.
- `MAX_MS` must not be raised to paper over a real timeout discovered during live
  re-verification — re-derive the standoff/margin instead, and say so in the PR if the
  constants needed to change (per this ticket's own "L" sizing: the size accounts for exactly
  this possibility).

## Out of scope

- The other 4 `@fullmap`-only elements under LUL-2667 (ground/terrain, time-of-day already
  done as child 4, wayfinding) — separate children (wayfinding is child 6, LUL-2667's own
  final split).
- Any change to `generateCover()` itself or real-map tree cover generation — untouched, this
  only adds a QA-hook mirror of its existing logic.
