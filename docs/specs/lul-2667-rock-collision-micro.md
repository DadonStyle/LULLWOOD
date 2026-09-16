# SPEC: LUL-2684 Migrate rock collision e2e off @fullmap to qaWorld=micro

**Ticket:** LUL-2684 · **Tier:** A — new micro-world spec file + a one-line loop-array edit
in an existing `@fullmap` file; no engine/HUD/persistence change, no new hook.

**Written against:** `release/next` @ `569bc47e` (2026-09-16).

## Files

- `e2e/rock-collision.spec.ts` — created. New `qaWorld=micro` test replacing the `rock`
  iteration of `e2e/lul211-founder-report.spec.ts`'s `@fullmap` loop.
- `e2e/lul211-founder-report.spec.ts` — edited. Drop `'rock'` from the `for (const kind of
  ['rock', 'tree'] as const)` loop at line 150, leaving only `'tree'` (LUL-2667 child 5 owns
  migrating that one and then deleting the now-empty loop).
- `shared/local-qa/requests/lul-2684-rock-collision.md` — created (outside the repo, filed
  directly per `REQUESTING-A-TEST.md`, not part of this PR).

## The change

### `e2e/rock-collision.spec.ts` (new)

Ports the assertion body of `lul211-founder-report.spec.ts:151-190` unchanged (same face-math,
same tolerances) but stages the case with `qaBuildScene`+`qaStageWalkIntoCover` instead of
`qaStageWalkIntoCover` searching the real procedurally-generated seed — the only thing that
required `qaWorld: 'full'` in the original. `qaBuildScene` already places exact `rock` props
with no rng (`engine/forest-engine.js:5265`, `QA_COVER_SHAPE.rock = { hx: 1.35, hz: 1.28, y:
0.74 }` at `:5240`), and `qaStageWalkIntoCover` reads back through `coverData`/`coverGrid`
regardless of how a prop got there (`engine/forest-engine.js:4123`) — already proven safe under
`qaWorld=micro` for the `bramble` kind in `e2e/qa-world-micro.spec.ts:120-146`. `ry` defaults to
`0` when omitted (`forest-engine.js:5278`, `ry: p.ry || 0`), so the placed rock is axis-aligned;
the ported face-math still handles the general rotated case (it collapses correctly at `ry=0`)
so it does not need trimming down to the axis-aligned special case.

```ts
// e2e/rock-collision.spec.ts
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

// LUL-2684 (child 1/6 of LUL-2667): migrates the 'rock' case of
// e2e/lul211-founder-report.spec.ts's "LUL-211: cover props are solid @fullmap"
// loop off the full 480u map. The @fullmap dependency there was never a
// mechanic requirement -- only qaStageWalkIntoCover()'s search for a reachable
// rock in the real seed needed it. qaBuildScene() places an exact rock with no
// rng, so the search is replaced with a fixed placement. See
// docs/specs/lul-2667-rock-collision-micro.md.
test.describe('LUL-211: cover props are solid (rock, qaWorld=micro)', () => {
  test('walking straight into a rock does not pass through it', async ({ page }) => {
    test.setTimeout(45_000);
    await boot(page, { qaHooks: true }); // qaWorld defaults to 'micro' (helpers.ts)
    await enter(page);

    const built = await qaHook(page, 'qaBuildScene', { props: [{ kind: 'rock', x: 10, z: 0 }] });
    expect(built).toEqual({ trees: 0, props: 1, predators: 0 });

    const staged = await qaHook(page, 'qaStageWalkIntoCover', 'rock');
    expect(staged, 'no reachable rock to stage against').not.toBeNull();
    const { prop, start } = staged!;
    expect(start.x, 'staged start is already inside the prop').toBeLessThan(prop.x - prop.hx);

    // Hold W and let the engine's own movement integrate against blocked().
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(3_000);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(200);

    const end = await qaHook(page, 'qaProbePlayer');

    // Moved toward the prop at all -- otherwise the test proves nothing
    // (a wedged player also never enters the box).
    expect(end.x, 'the player never moved toward the prop').toBeGreaterThan(start.x + 0.3);
    // Same face-math as lul211-founder-report.spec.ts:170-186 (ported unchanged).
    // blocked() uses a 0.6 player radius. The player approaches in +x with dz=0,
    // so the collision boundary in world-X depends on the prop's rotation (ry).
    // In prop-local frame the player stops when BOTH |lx| < hx+0.6 AND
    // |lz| < hz+0.6; since lx = dx*cos(ry) and lz = dx*sin(ry) (with
    // dz_world=0), the first-blocked dx is
    //   max(-(hx+0.6)/|cos(ry)|, -(hz+0.6)/|sin(ry)|)
    // (clamp denominators away from zero). Allow one 0.05s-clamped step of slack.
    const ry = prop.ry ?? 0;
    const absCos = Math.max(Math.abs(Math.cos(ry)), 1e-6);
    const absSin = Math.max(Math.abs(Math.sin(ry)), 1e-6);
    const faceDx = Math.max(-(prop.hx + 0.6) / absCos, -(prop.hz + 0.6) / absSin);
    const faceX = prop.x + faceDx;
    expect(
      end.x,
      `player reached x=${end.x.toFixed(2)}, past the rock face at x=${faceX.toFixed(2)} (prop centre ${prop.x.toFixed(2)}, hx ${prop.hx.toFixed(2)}, ry ${ry.toFixed(3)})`,
    ).toBeLessThan(faceX + 0.35);
  });
});
```

Notes for the implementer:
- `x: 10, z: 0` matches the coordinate `qa-world-micro.spec.ts:120` already uses for `bramble`
  — known clear of the player's micro-world spawn and of the map edge (micro world is 96u,
  `engine/tuning.js` `applyQaWorldMicroPreset()`).
- `qaProbePlayer` (used instead of the full-map test's identically-named hook) already exists
  and needs no `.d.ts` change — it is declared once and used the same way in
  `lul211-founder-report.spec.ts:167`.
- `built.predators` is `0` here (no `predators` key passed to `qaBuildScene`), unlike the
  `bramble` example in `qa-world-micro.spec.ts` which also stages a wolf — this test needs no
  predator, so the return shape omits it as `0`, matching `qaBuildScene`'s
  `[...byKind.values()].reduce(...)` on an empty map.

### `e2e/lul211-founder-report.spec.ts` (edit)

```diff
- for (const kind of ['rock', 'tree'] as const) {
+ // LUL-2684: 'rock' migrated to e2e/rock-collision.spec.ts (qaWorld=micro) --
+ // this loop's @fullmap boot is kept only for 'tree' (LUL-2667 child 5).
+ for (const kind of ['tree'] as const) {
```

The surrounding comment block (lines 133-149) already documents `log`/`bramble`'s exclusion
from this loop by the same pattern (a comment above the loop, not a loop-body change) — add one
more sentence there noting `rock`'s removal and pointing at the new file, do not restructure the
existing comment.

The file stays on the `FULLMAP_ALLOWLIST` in `lib/e2e-policy/world-policy.test.ts:29` — its
reason ("founder's walk-into-cover replays on the pinned full layout") is still true for the
remaining `tree` case, so no allowlist edit is needed. **Do not remove the allowlist entry in
this PR.**

## Verification

- `npx playwright test e2e/rock-collision.spec.ts` — new test passes on the default (micro)
  project.
- `npx playwright test e2e/lul211-founder-report.spec.ts` — `'tree'`-only loop still passes
  under `E2E_FULLMAP=1` (or confirm unchanged if the local sandbox can't run `@fullmap` — see
  LUL-2377's host-freeze risk note; the byte-identical face-math carried over means no new
  failure mode is possible here).
- `npm test` (node --test) — `lib/e2e-policy/world-policy.test.ts` stays green; `rock-collision
  .spec.ts` boots micro by default so it needs no allowlist entry.
- `node --run lint` / `tsc` — clean.
- `node scripts/check-elements-citations.mjs` (or whatever the current invocation is) — clean;
  this change adds no `docs/ELEMENTS.md`-cited symbol and touches no cited line.

## e2e

**Specs.** `e2e/rock-collision.spec.ts` — "walking straight into a rock does not pass through
it" (new). `e2e/lul211-founder-report.spec.ts` — "LUL-211: cover props are solid @fullmap" /
"walking straight into a tree does not pass through it" (must pass unchanged, loop narrowed to
`['tree']`).

**World.** micro (default) for the new spec — `qaBuildScene({ props: [{ kind: 'rock', x: 10, z:
0 }] })`, no trees/predators/child/home. The narrowed `lul211-founder-report.spec.ts` loop stays
`@fullmap` for its one remaining case (`tree`), reason unchanged in the allowlist.

**Hooks.** `qaBuildScene({...}): {trees,props,predators}` — existing
(`engine/forest-engine.js:5265`). `qaStageWalkIntoCover(kind): {prop,start}|null` — existing
(`engine/forest-engine.js:4123`). `qaProbePlayer(): {x,z,...}` — existing (already used by
`lul211-founder-report.spec.ts:167`). No new hook.

**Tester scenario.** `shared/local-qa/requests/lul-2684-rock-collision.md`, filed alongside this
spec — the nightly `e2e/` re-run already covers this once the PR merges, but the request file
also spot-checks the same collision fact directly against a build.

**Not covered.** Feel/audio — none apply (this is a pure collision-geometry assertion, no cue
triple). Real-device timing variance in the 3s `keydown`-hold window — same as the original
full-map test, pre-existing and unrelated to this migration.

## Cues

Not applicable — this is a test-infrastructure migration with no player-visible state, no new
render/HUD/audio/caption. Nothing in section A of `docs/FEATURE_CHECKLIST.md` applies (no new
state is introduced).

## Constraints

- Do not change the face-math or tolerances ported from `lul211-founder-report.spec.ts:170-186`
  — the assertion must stay byte-for-byte equivalent, only the staging mechanism changes.
- Do not touch the `tree` iteration, its comment block, or the `FULLMAP_ALLOWLIST` entry for
  `lul211-founder-report.spec.ts` — those belong to LUL-2667 child 5.
- No new engine code, no new `qaHooks` entry, no `docs/ELEMENTS.md` edit (no new cited symbol).

## Out of scope

- The `tree` iteration of the same loop — LUL-2667 child 5, sequenced after this one, removes
  the allowlist entry once it also migrates.
- `log`/`bramble` walkable-cover behaviour (`lul211-founder-report.spec.ts`'s separate
  `LUL-384/LUL-1642` describe block) — untouched, unrelated mechanic (those props are explicitly
  *not* solid).
- The other 5 `@fullmap`-only elements under LUL-2667 (ground, ToD, wayfinding, tree, log) —
  separate children.
