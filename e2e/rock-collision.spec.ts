// LUL-2684 (child 1/6 of LUL-2667): migrates the 'rock' case of
// e2e/lul211-founder-report.spec.ts's "LUL-211: cover props are solid @fullmap"
// loop off the full 480u map. The @fullmap dependency there was never a
// mechanic requirement -- only qaStageWalkIntoCover()'s search for a reachable
// rock in the real seed needed it. qaBuildScene() places an exact rock with no
// rng, so the search is replaced with a fixed placement. See
// docs/specs/lul-2667-rock-collision-micro.md.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

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
    // Same face-math as lul211-founder-report.spec.ts (ported unchanged). blocked()
    // uses a 0.6 player radius. The player approaches in +x with dz=0, so the
    // collision boundary in world-X depends on the prop's rotation (ry). In
    // prop-local frame the player stops when BOTH |lx| < hx+0.6 AND |lz| < hz+0.6;
    // since lx = dx*cos(ry) and lz = dx*sin(ry) (with dz_world=0), the
    // first-blocked dx is
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
