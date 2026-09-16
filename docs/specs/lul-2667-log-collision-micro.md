# SPEC: LUL-2685 Migrate log (and bramble) walkability e2e off @fullmap to qaWorld=micro

**Ticket:** LUL-2685 · **Tier:** A — new micro-world spec file + removing an existing
`@fullmap` describe block; no engine/HUD/persistence change, no new hook.

**Written against:** `release/next` @ `b6adda8` (2026-09-16, after LUL-2684/PR #675).

## Files

- `e2e/log-collision.spec.ts` — created. New `qaWorld=micro` test replacing the entire
  `LUL-384/LUL-1642: log and bramble are walkable @fullmap` describe block of
  `e2e/lul211-founder-report.spec.ts` (both `log` and `bramble` iterations — see below).
- `e2e/lul211-founder-report.spec.ts` — edited. Delete the `LUL-384/LUL-1642` describe
  block (lines ~192-282) entirely and its `for (const kind of ['log', 'bramble'] as const)`
  loop; update the file-header comment's pointer to it. The `'LUL-211: cover props are
  solid @fullmap'` describe block (now `['tree']`-only per LUL-2684) is untouched.
- `shared/local-qa/requests/lul-2685-log-collision.md` — created (outside the repo, filed
  directly per `REQUESTING-A-TEST.md`, not part of this PR).

## The change

### Why bramble comes along, not just log

The ticket's gap is the `log` iteration, but the describe block's `for (const kind of
['log', 'bramble'] as const)` loop is one parametrized test body, not two copies (LUL-1642
unified them deliberately — see the file's own header comment: "LUL-1642 ... extended the
same walkable exemption from `log` alone to every WALKABLE_KINDS entry, so bramble now
matches log exactly for movement"). Splitting the loop to migrate only `log` and leave a
one-item `['bramble']` loop behind under `@fullmap` would preserve zero test value (nothing
about `bramble`'s walkability needs the full map either — same `coverKindBlocksMovement()`
predicate, same `qaBuildScene` support (`QA_COVER_SHAPE.bramble`, `engine/forest-engine.js
:5241`)) while doubling the maintenance surface. So this PR migrates both kinds in the new
file and deletes the old describe block outright — bramble is un-fullmap-tagged as a side
effect of this ticket, not left behind. (Contrast with LUL-2684/rock: that migration kept
`tree` behind under `@fullmap` because `tree` is a *different* describe block — `'cover
props are solid'`, not this one — owned by a separate LUL-2667 child.)

`e2e/lul211-founder-report.spec.ts` therefore keeps only the `'LUL-211: cover props are
solid @fullmap'` describe block under `@fullmap` (now `tree`-only) after this PR — it stays
on `FULLMAP_ALLOWLIST` for that reason, unchanged from LUL-2684's PR.

### `e2e/log-collision.spec.ts` (new)

Ports the assertion body of `lul211-founder-report.spec.ts:192-282` unchanged (same
face-math, same `blocked()` sampling sweep, same tolerances) but stages each case with
`qaBuildScene` + `qaStageWalkIntoCover` instead of `qaStageWalkIntoCover` searching the real
procedurally-generated seed — the only thing that required `qaWorld: 'full'` in the
original. `qaBuildScene` already places exact `log`/`bramble` props with no rng
(`engine/forest-engine.js:5265`, `QA_COVER_SHAPE.log = { hx: 1.85, hz: 0.475, y: 0.3 }` /
`QA_COVER_SHAPE.bramble = { hx: 1.15, hz: 1.15, y: 0.69 }` at `:5239-5241`), and
`qaStageWalkIntoCover` reads back through `coverData`/`coverGrid` regardless of how a prop
got there (`engine/forest-engine.js:4123`) — already proven safe under `qaWorld=micro` for
`bramble` in `e2e/qa-world-micro.spec.ts:120-146`, and now proven for `rock` in
`e2e/rock-collision.spec.ts` (LUL-2684). The function under test is
`coverKindBlocksMovement()` (`lib/game/cover.ts:215-217`) — `log`/`bramble` are
`WALKABLE_KINDS` members, so it returns `false` for both, which is exactly what the
`blocked()` sampling sweep below asserts across each prop's full footprint.

```ts
// e2e/log-collision.spec.ts
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

// LUL-2685 (child 2/6 of LUL-2667): migrates the entire
// e2e/lul211-founder-report.spec.ts "LUL-384/LUL-1642: log and bramble are
// walkable @fullmap" describe block off the full 480u map. The @fullmap
// dependency there was never a mechanic requirement -- only
// qaStageWalkIntoCover()'s search for a reachable prop in the real seed
// needed it. qaBuildScene() places exact log/bramble props with no rng, so
// the search is replaced with a fixed placement. Both kinds migrate here
// together (LUL-1642 unified their walkability under one predicate,
// coverKindBlocksMovement() -- lib/game/cover.ts:215), leaving nothing
// behind for the old describe block. See
// docs/specs/lul-2667-log-collision-micro.md.
test.describe('LUL-384/LUL-1642: log and bramble are walkable (qaWorld=micro)', () => {
  for (const kind of ['log', 'bramble'] as const) {
    test(`walking straight into a ${kind} passes over it instead of stopping at its face`, async ({
      page,
    }) => {
      test.setTimeout(45_000);
      await boot(page, { qaHooks: true }); // qaWorld defaults to 'micro' (helpers.ts)
      await enter(page);

      const built = await qaHook(page, 'qaBuildScene', { props: [{ kind, x: 10, z: 0 }] });
      expect(built).toEqual({ trees: 0, props: 1, predators: 0 });

      // Same staging hook as rock-collision.spec.ts -- it computes the
      // standoff a *blocking* prop of this footprint would need, which still
      // works fine as a starting point for a walkable kind: it just means
      // the walk below starts at (and then crosses) where a wall would have
      // been.
      const staged = await qaHook(page, 'qaStageWalkIntoCover', kind);
      expect(staged, `no reachable ${kind} to stage against`).not.toBeNull();
      const { prop, start } = staged!;
      expect(start.x, 'staged start is already inside the prop').toBeLessThan(prop.x - prop.hx);

      // Mirror of the solid-prop face-boundary math: the near face is at
      // prop.x + faceDx (faceDx <= 0), so the far face is the same offset
      // reflected through the centre.
      const ry = prop.ry ?? 0;
      const absCos = Math.max(Math.abs(Math.cos(ry)), 1e-6);
      const absSin = Math.max(Math.abs(Math.sin(ry)), 1e-6);
      const faceDx = Math.max(-(prop.hx + 0.6) / absCos, -(prop.hz + 0.6) / absSin);
      const nearFaceX = prop.x + faceDx;
      const farFaceX = prop.x - faceDx;

      // A short real walk still proves actual keyboard-driven movement
      // engages the approach (a genuinely wedged player would fail this weak
      // bar too) -- see rock-collision.spec.ts for the same 0.3-unit floor.
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(1_000);
      await page.keyboard.up('KeyW');
      await page.waitForTimeout(200);
      const midway = await qaHook(page, 'qaProbePlayer');
      expect(midway.x, `the player never moved toward the ${kind}`).toBeGreaterThan(start.x + 0.3);

      // The definitive "no collision bug on this prop" claim is checked by
      // sampling blocked() -- the exact predicate real movement gates on --
      // directly across the prop's full footprint, near face to far face and
      // a margin past it (same LUL-554 rationale as the original: one
      // in-page evaluate() sweep instead of N sequential round-trips).
      const sampleFromX = nearFaceX - 0.5;
      const sampleToX = farFaceX + 0.5;
      const step = 0.2;
      const blockedSamples = await page.evaluate(
        ({ fromX, toX, step, z }) => {
          const samples: { x: number; blocked: boolean }[] = [];
          for (let x = fromX; x <= toX; x += step) {
            samples.push({ x, blocked: !!window.ForestEngine?.qaProbeBlocked?.(x, z) });
          }
          return samples;
        },
        { fromX: sampleFromX, toX: sampleToX, step, z: prop.z },
      );
      const firstBlocked = blockedSamples.find((s) => s.blocked);
      expect(
        firstBlocked,
        `blocked(x=${firstBlocked?.x.toFixed(2)}, z=${prop.z.toFixed(2)}) is true somewhere across the ${kind}'s span (near face x=${nearFaceX.toFixed(2)}, far face x=${farFaceX.toFixed(2)}) -- LUL-384/LUL-1642 require the whole ${kind} to be collision-free for the player`,
      ).toBeUndefined();
    });
  }
});
```

Notes for the implementer:
- `x: 10, z: 0` matches the coordinate `qa-world-micro.spec.ts:120` and `rock-collision
  .spec.ts` already use — known clear of the player's micro-world spawn and of the map edge.
- `qaProbePlayer`/`qaProbeBlocked` already exist and need no `.d.ts` change.
- `built.predators` is `0` for both kinds (no `predators` key passed to `qaBuildScene`).

### `e2e/lul211-founder-report.spec.ts` (edit)

Delete the entire `LUL-384/LUL-1642: log and bramble are walkable @fullmap` describe block
(the `for (const kind of ['log', 'bramble'] as const) { ... }` loop and its wrapping
`test.describe`). Update the file-header comment's pointer (currently "... bramble now
matches log exactly for movement -- see the second describe block below, which covers
both.") to point at the new file instead of a block that no longer exists in this file:

```diff
- entry, so bramble now matches log exactly for movement -- see the
- second describe block below, which covers both. LUL-2311 later removed
+ entry, so bramble now matches log exactly for movement -- migrated to
+ e2e/log-collision.spec.ts (LUL-2685), which covers both. LUL-2311 later removed
```

Add a one-line pointer comment where the deleted describe block used to sit, matching the
LUL-2684 pattern of a comment-only trace of what moved and where (do not leave the deletion
silent):

```ts
// LUL-2685 (LUL-2667 child 2/6): the 'LUL-384/LUL-1642: log and bramble are
// walkable' describe block that used to live here (both the 'log' and
// 'bramble' iterations) migrated to e2e/log-collision.spec.ts
// (qaWorld=micro) -- see docs/specs/lul-2667-log-collision-micro.md for why
// bramble moved too instead of leaving a one-item @fullmap loop behind.
```

No change to `FULLMAP_ALLOWLIST` (`lib/e2e-policy/world-policy.test.ts:29`) — the file's
one remaining `@fullmap` case (`tree`, in the other describe block) still needs it, per
LUL-2684.

## Verification

- `npx playwright test e2e/log-collision.spec.ts` — both new tests (`log`, `bramble`) pass
  on the default (micro) project.
- `npx playwright test e2e/lul211-founder-report.spec.ts` — the remaining `tree`-only
  `'cover props are solid'` case still passes under `E2E_FULLMAP=1` (or confirm unchanged if
  the local sandbox can't run `@fullmap` — LUL-2377's host-freeze risk note; nothing in this
  PR touches that describe block's code).
- `npm test` (node --test) — `lib/e2e-policy/world-policy.test.ts` stays green;
  `log-collision.spec.ts` boots micro by default so it needs no allowlist entry.
- `node --run lint` / `tsc` — clean.
- `node scripts/check-elements-citations.mjs` — clean; this change adds no
  `docs/ELEMENTS.md`-cited symbol and touches no cited line.

## e2e

**Specs.** `e2e/log-collision.spec.ts` — "walking straight into a log/bramble passes over it
instead of stopping at its face" (new, both kinds). `e2e/lul211-founder-report.spec.ts` —
unaffected `'LUL-211: cover props are solid @fullmap'` / `tree` case must still pass
unchanged.

**World.** micro (default) for the new spec — `qaBuildScene({ props: [{ kind, x: 10, z: 0
}] })` per kind, no trees/predators/child/home.

**Hooks.** `qaBuildScene({...}): {trees,props,predators}` — existing
(`engine/forest-engine.js:5265`). `qaStageWalkIntoCover(kind): {prop,start}|null` — existing
(`engine/forest-engine.js:4123`). `qaProbePlayer(): {x,z,...}` — existing. `qaProbeBlocked(x,
z): boolean` — existing (`engine/forest-engine.js:4165`). No new hook.

**Tester scenario.** `shared/local-qa/requests/lul-2685-log-collision.md`, filed alongside
this spec — the nightly `e2e/` re-run already covers this once the PR merges, but the
request file also spot-checks the same walkability fact directly against a build.

**Not covered.** Feel/audio — none apply (pure collision-geometry assertion, no cue triple).
Real-device timing variance in the 1s `keydown`-hold window — same as the original
full-map test, pre-existing and unrelated to this migration.

## Cues

Not applicable — this is a test-infrastructure migration with no player-visible state, no
new render/HUD/audio/caption. Nothing in section A of `docs/FEATURE_CHECKLIST.md` applies
(no new state is introduced).

## Constraints

- Do not change the face-math, the `blocked()` sampling sweep, or tolerances ported from
  `lul211-founder-report.spec.ts:192-282` — the assertion must stay byte-for-byte
  equivalent, only the staging mechanism changes.
- Do not touch the `'cover props are solid'` describe block (`tree` case) or the
  `FULLMAP_ALLOWLIST` entry for `lul211-founder-report.spec.ts` — those belong to LUL-2667
  child 5.
- No new engine code, no new `qaHooks` entry, no `docs/ELEMENTS.md` edit (no new cited
  symbol).

## Out of scope

- The `tree` iteration of the separate `'cover props are solid'` describe block — LUL-2667
  child 5, removes the `FULLMAP_ALLOWLIST` entry once it also migrates.
- The other 4 `@fullmap`-only elements under LUL-2667 (ground, ToD, wayfinding — rock and
  log/bramble are children 1 and 2, done by this point).
