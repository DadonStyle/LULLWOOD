// LUL-211 — the three bugs the founder reported by hand, each pinned from the
// outside so a human never has to be the one who notices them again.
//
// Why these are not already covered by smoke.spec.ts: every one of them is a
// thing the existing suite passes *through* without looking at.
//
//  1. "main tag still hides the canvas" — smoke asserts the canvas exists and
//     that clicks reach it, which stays true when the canvas is painted UNDER
//     the SSR content shell (`main.about`): the shell is 100vh down the page,
//     so a centre-point click still lands on the canvas while the player stares
//     at flat page background. The real assertion is a stacking one --
//     `elementFromPoint` across the viewport must never return the shell, and
//     the canvas's computed z-index must not be negative (negative z puts it in
//     CSS painting step 2, below in-flow block boxes in step 3).
//
//  2. "after the win the YOU WIN doesn't show, it starts a new game" — smoke
//     asserts `#winScreen` is visible the instant it appears and then ends the
//     test. A win screen that shows and is then torn down by a restart one
//     second later passes that. This holds the assertion open instead.
//
//  3. "the new boulders and logs have no collision" — nothing outside the
//     engine closure could read the player's position, so this was unprovable
//     until the qaProbePlayer / qaStageWalkIntoCover hooks (added with this
//     spec, ?qaHooks=1 only).
import { test, expect } from '@playwright/test';
import { boot, enter, readObjective } from './helpers';

test.describe('LUL-211: the canvas is actually the thing you are looking at', () => {
  test('no viewport point resolves to the SSR content shell, and the canvas is not painted below it', async ({
    page,
  }) => {
    await boot(page);

    // The WebGL canvas is the one the engine appends to <body>; the minimap
    // canvas ships inside the overlay markup and is deliberately z-index 10.
    const canvasZ = await page.evaluate(() => {
      const c = document.querySelector('body > canvas') as HTMLCanvasElement | null;
      if (!c) return null;
      const s = getComputedStyle(c);
      return { zIndex: s.zIndex, position: s.position, rect: c.getBoundingClientRect().toJSON() };
    });
    expect(canvasZ, 'the engine never appended its canvas to <body>').not.toBeNull();
    expect(canvasZ!.position).toBe('fixed');
    // The regression was z-index: -1. Anything negative reintroduces it.
    expect(Number(canvasZ!.zIndex), `canvas z-index ${canvasZ!.zIndex} is negative`).toBeGreaterThanOrEqual(0);
    expect(canvasZ!.rect.width).toBeGreaterThan(1000);
    expect(canvasZ!.rect.height).toBeGreaterThan(600);

    // Sweep the viewport rather than trusting the centre alone: the shell is a
    // 640px-wide centred column, so an off-centre-only overlap would hide
    // behind a single centre-point check.
    const hits = await page.evaluate(() => {
      const out: { x: number; y: number; tag: string }[] = [];
      for (let fx = 1; fx <= 9; fx++) {
        for (let fy = 1; fy <= 9; fy++) {
          const x = Math.round((window.innerWidth * fx) / 10);
          const y = Math.round((window.innerHeight * fy) / 10);
          const el = document.elementFromPoint(x, y);
          out.push({ x, y, tag: el ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className) : ''}` : 'null' });
        }
      }
      return out;
    });
    const shellHits = hits.filter((h) => h.tag.includes('about'));
    expect(shellHits, `SSR shell (main.about) is on top at ${JSON.stringify(shellHits.slice(0, 5))}`).toHaveLength(0);

    // ...and it is off-screen where it belongs (margin-top: 100vh), not merely
    // click-transparent via pointer-events: none.
    const shellTop = await page.evaluate(() => document.querySelector('main.about')!.getBoundingClientRect().top);
    expect(shellTop, 'main.about is inside the first viewport').toBeGreaterThanOrEqual(page.viewportSize()!.height);
  });
});

test.describe('LUL-211: winning shows YOU WON and stays there', () => {
  test('the win screen appears, sits inside the viewport, and is not replaced by a fresh run', async ({ page }) => {
    test.setTimeout(60_000);
    await boot(page, { qaHooks: true });
    await enter(page);

    await page.evaluate(() => window.ForestEngine?.qaTeleportNearBaby?.());
    await page.waitForTimeout(300);
    expect(await readObjective(page), 'qaTeleportNearBaby did not land within pickup range').toContain('Press');

    await page.keyboard.press('KeyE');
    await expect
      .poll(() => readObjective(page), { message: 'pickup never handed off to carry-home', timeout: 30_000 })
      .toContain('Carry the child home');

    await page.evaluate(() => window.ForestEngine?.qaTeleportHome?.());

    const win = page.locator('#winScreen');
    await expect(win).toBeVisible({ timeout: 5_000 });
    await expect(win.locator('h1')).toHaveText('YOU WON');

    // LUL-177's blind spot: `toBeVisible` is satisfied by an element parked
    // off-screen. Assert it is really in front of the player.
    const box = (await win.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.y, 'win screen is above the viewport').toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, 'win screen is below the viewport').toBeLessThanOrEqual(vp.height + 1);
    // ...and nothing is painted over it.
    const onTop = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return Boolean(el?.closest('#winScreen'));
    });
    expect(onTop, 'something is stacked on top of the win screen at the viewport centre').toBe(true);

    // The founder's actual complaint: it "starts a new game for some reason".
    // A restart tears the win screen down and re-arms the objective banner, so
    // watch both for long enough to catch it.
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(500);
      await expect(win, `win screen disappeared ${(i + 1) * 500}ms after winning`).toBeVisible();
    }
    await expect(page.locator('#objective'), 'a new run started behind the win screen').toBeHidden();
    await expect(page.locator('#gate'), 'the entry gate came back after winning').toBeHidden();
  });
});

test.describe('LUL-211: cover props are solid', () => {
  // LUL-388: 'tree' added -- qaStageWalkIntoCover('tree') was reachable but had
  // never actually been driven by a spec (only rock/log/bramble were), and it
  // turned out to be broken (NaN positions, fixed in the same change that added
  // this case -- see the hook's own LUL-388 comment in forest-engine.js). Large
  // trees (coverData's `s>1.4` subset) are the one element the interaction
  // matrix (docs/ELEMENTS.md) marks C+LOS same as rock, so player-vs-tree
  // collision belongs in this exact loop, not a separate spec.
  for (const kind of ['rock', 'log', 'bramble', 'tree'] as const) {
    test(`walking straight into a ${kind} does not pass through it`, async ({ page }) => {
      test.setTimeout(45_000);
      await boot(page, { qaHooks: true });
      await enter(page);

      const staged = await page.evaluate((k) => window.ForestEngine?.qaStageWalkIntoCover?.(k), kind);
      expect(staged, `no reachable ${kind} to stage against`).not.toBeNull();
      const { prop, start } = staged!;
      expect(start.x, 'staged start is already inside the prop').toBeLessThan(prop.x - prop.hx);

      // Hold W and let the engine's own movement integrate against blocked().
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(3_000);
      await page.keyboard.up('KeyW');
      await page.waitForTimeout(200);

      const end = (await page.evaluate(() => window.ForestEngine?.qaProbePlayer?.()))!;

      // Moved toward the prop at all -- otherwise the test proves nothing
      // (a wedged player also never enters the box).
      expect(end.x, 'the player never moved toward the prop').toBeGreaterThan(start.x + 0.3);
      // ...and stopped at its face. blocked() uses a 0.6 player radius. The player
      // approaches in +x with dz=0, so the collision boundary in world-X depends on
      // the prop's rotation (ry). In prop-local frame the player stops when BOTH
      // |lx| < hx+0.6 AND |lz| < hz+0.6; since lx = dx*cos(ry) and lz = dx*sin(ry)
      // (with dz_world=0), the first-blocked dx is
      //   max(-(hx+0.6)/|cos(ry)|, -(hz+0.6)/|sin(ry)|)
      // (clamp denominators away from zero). Allow one 0.05s-clamped step of slack.
      const ry = prop.ry ?? 0;
      const absCos = Math.max(Math.abs(Math.cos(ry)), 1e-6);
      const absSin = Math.max(Math.abs(Math.sin(ry)), 1e-6);
      const faceDx = Math.max(-(prop.hx + 0.6) / absCos, -(prop.hz + 0.6) / absSin);
      const faceX = prop.x + faceDx;
      expect(
        end.x,
        `player reached x=${end.x.toFixed(2)}, past the ${kind} face at x=${faceX.toFixed(2)} (prop centre ${prop.x.toFixed(2)}, hx ${prop.hx.toFixed(2)}, ry ${ry.toFixed(3)})`,
      ).toBeLessThan(faceX + 0.35);
    });
  }
});
