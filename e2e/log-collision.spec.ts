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
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook } from './helpers';

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
