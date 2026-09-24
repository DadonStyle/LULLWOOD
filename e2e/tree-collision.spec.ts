// LUL-2667 (child 5/6): migrates the 'tree' case of
// e2e/lul211-founder-report.spec.ts's "LUL-211: cover props are solid @fullmap"
// loop off the full map -- the last remaining case there (rock/log/bramble
// already migrated, LUL-2684/LUL-2685). Needs one extra step beyond that
// pattern: qaBuildScene's tree placement did not synthesize the LOS-cover
// entry qaStageWalkIntoCover('tree') reads from coverData (only
// generateCover() did, for real maps, gated on t.s > 1.4) -- added in this
// change (engine/forest-engine.js). See
// docs/specs/lul-2667-tree-collision-pathing-micro.md.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

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
