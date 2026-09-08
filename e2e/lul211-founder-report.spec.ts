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
//
//     LUL-384 deliberately narrows this for `log` specifically: a fallen log
//     is no longer solid to the *player's* movement (coverKindBlocksMovement(),
//     lib/game/cover.ts) so walking/running over one feels natural, while LOS,
//     hide-spot eligibility and predator catch are all untouched -- a log is
//     still not a safe zone. That is an intentional, scoped exception, not a
//     regression of this bug: rock is still fully solid to the player. LUL-1642
//     (2026-09-06) extended the same walkable exemption from `log` alone to
//     every HIDE_KINDS entry, so bramble now matches log exactly -- see the
//     second describe block below, which covers both.
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
  // 'log' deliberately excluded here as of LUL-384, and 'bramble' as of
  // LUL-1642 (2026-09-06, unified bramble with log's walkable-cover
  // exemption -- see the file header) -- see the 'LUL-384/LUL-1642: walkable
  // cover' describe block below, which pins the new, intended behaviour for
  // both instead of the old one. Leaving 'bramble' in this loop is what
  // produced LUL-2072's ~0.92-unit "overshoot": the player wasn't sliding
  // past a face by extra frame slack, it was walking straight through a prop
  // that stopped blocking movement three days earlier and only halting at
  // whatever obstacle came next.
  for (const kind of ['rock', 'tree'] as const) {
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

test.describe('LUL-384/LUL-1642: log and bramble are walkable', () => {
  // LUL-1642 (2026-09-06) extended LUL-384's log-only walkable exemption to
  // every HIDE_KINDS entry (coverKindBlocksMovement(), lib/game/cover.ts), so
  // bramble now gets the exact same treatment as log. Parametrized rather
  // than a second copy-pasted test -- the two kinds share one predicate.
  for (const kind of ['log', 'bramble'] as const) {
  test(`walking straight into a ${kind} passes over it instead of stopping at its face`, async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await boot(page, { qaHooks: true });
    await enter(page);

    // Same staging hook as the solid-props test above -- it computes the
    // standoff a *blocking* prop of this footprint would need, which still
    // works fine as a starting point for a walkable kind: it just means the
    // walk below starts at (and then crosses) where a wall would have been.
    const staged = await page.evaluate((k) => window.ForestEngine?.qaStageWalkIntoCover?.(k), kind);
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

    // A short real walk still proves actual keyboard-driven movement engages
    // the approach (a genuinely wedged player would fail this weak bar too)
    // -- see the solid-props loop above for the same 0.3-unit floor.
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1_000);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(200);
    const midway = (await page.evaluate(() => window.ForestEngine?.qaProbePlayer?.()))!;
    expect(midway.x, `the player never moved toward the ${kind}`).toBeGreaterThan(start.x + 0.3);

    // The definitive "no collision bug on this prop" claim is checked by
    // sampling blocked() -- the exact predicate real movement gates on --
    // directly across the prop's full footprint, near face to far face and a
    // margin past it. This is deterministic and independent of how many
    // animation frames actually ran during the walk above, unlike asserting
    // a specific end position reached within a fixed wall-clock window
    // (LUL-384 found that this specific window undershoots under CI's
    // rendering load -- same class of flake as LUL-421's charge-dodge
    // wall-clock assertions, wiki: systems/dt-clamp-vs-walltime).
    //
    // LUL-554: this used to be N *sequential, awaited* page.evaluate() calls,
    // one per 0.2-unit step. Each round-trip pays the full CDP cost of
    // waiting for the page's main thread (mid-render of the WebGL scene) to
    // go idle -- fine in isolation, but on the combined release/next+main
    // merge tree, two new spec files from main (blind-chase-cover.spec.ts,
    // charge-dodge.spec.ts) run alphabetically before this one in the same
    // single-worker, non-parallel session (playwright.config.ts: workers: 1,
    // fullyParallel: false) and load the renderer enough that N sequential
    // round-trips blew this test's explicit 45s budget -- confirmed by
    // reproducing the actual merge tree locally (identical log candidate,
    // same near/far face values as the original CI failure) and observing
    // the failure only manifests under that heavier combined-suite ordering,
    // not against release/next alone. Sampling inside a single evaluate()
    // pays the round-trip cost once, independent of step count or session
    // load, without changing what's being asserted.
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
