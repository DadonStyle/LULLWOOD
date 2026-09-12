// LUL-2230 (LUL-2224 item 2): the player's own scent trail is now rendered --
// a THREE.Points cloud (engine/forest-engine.js's scentTrailPts) filled every
// tick from the live `scentPoints` array at driftedScentPosition(), the exact
// position checkScent() queries, so the picture never shows the trail
// somewhere safer than it really is -- plus a one-time caption explaining it.
// See docs/specs/lul-2224-wind-hint-always-on-scent-trail.md's "Item 2"
// section for the full math this pins down.
//
// Driven via qaSetFixedStep/qaAdvance (docs/specs/lul-2071-deterministic-qa-
// clock.md), same as e2e/scent.spec.ts, so "2.5s of walking" and "15s
// standing still" are game-time budgets, not wall-clock waits subject to
// this rig's dt-clamp-vs-walltime hazard (wiki: systems/dt-clamp-vs-walltime).
import { test, expect, type Page } from '@playwright/test';
import { boot, enter, qaHook, assertInViewport } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

/**
 * Bounding-box intersection check, matching the LUL-2224 wind-hint spec's
 * helper. `.boundingBox()` on a locator that currently matches zero elements
 * waits out the full actionability timeout instead of returning null (only a
 * matched-but-invisible element resolves to null quickly), so `.count()` must
 * be checked first or this hangs for 150s on every call.
 * LUL-2312: `#status`/`#objective`/`#actionPrompt` are three of #actionSlot's
 * always-mounted rows now (never absent, so `.count()` alone no longer skips
 * them) -- an empty row's `.actionPromptRow` has no content, so its content
 * box collapses to zero width (`justify-items: center` sizes it to content,
 * not the grid track); a zero-area box is also treated as nothing to overlap.
 */
async function assertNoOverlap(page: Page, selA: string, selB: string) {
  const locA = page.locator(selA), locB = page.locator(selB);
  if ((await locA.count()) === 0 || (await locB.count()) === 0) return;
  const a = await locA.boundingBox();
  const b = await locB.boundingBox();
  if (!a || !b || a.width === 0 || a.height === 0 || b.width === 0 || b.height === 0) return; // nothing to overlap
  const overlaps =
    a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
  expect(overlaps, `${selA} (${JSON.stringify(a)}) must not overlap ${selB} (${JSON.stringify(b)})`).toBe(false);
}

/** Walks forward for `seconds` of game time (fixed-step, KeyW held throughout). */
async function walkForward(page: Page, seconds: number) {
  await page.keyboard.down('KeyW');
  await qaHook(page, 'qaAdvance', stepsFor(seconds));
  await page.keyboard.up('KeyW');
}

test.describe('scent trail visual (LUL-2230)', () => {
  test('walking lays a fading trail at the drifted position a predator actually smells', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await walkForward(page, 2.5);

    const probe = await qaHook(page, 'qaProbeScentTrail');
    expect(probe.settingOn).toBe(true);
    expect(probe.rendered).toBe(true);
    expect(probe.points.length).toBeGreaterThanOrEqual(5);
    expect(probe.points.length).toBeLessThanOrEqual(probe.livePoints);

    for (const p of probe.points) {
      expect(p.alpha, `point at age ${p.age} must have positive alpha`).toBeGreaterThan(0);
      expect(p.alpha).toBeLessThanOrEqual(1);
    }
    // Alpha is non-increasing as age increases (fades out, never back in).
    const byAge = [...probe.points].sort((a, b) => a.age - b.age);
    for (let i = 1; i < byAge.length; i++) {
      expect(byAge[i].alpha, 'alpha must not increase with age').toBeLessThanOrEqual(byAge[i - 1].alpha + 1e-6);
    }

    // Drifted position: the oldest point's rendered (x,z) must equal its raw
    // deposit position plus the same wind drift checkScent() uses --
    // min(WIND_DRIFT_CAP, WIND_STRENGTH*age) downwind (lib/game/scent.ts).
    const oldest = byAge[0];
    const WIND_STRENGTH = 3.2, WIND_DRIFT_CAP = 9;
    const drift = Math.min(WIND_DRIFT_CAP, WIND_STRENGTH * oldest.age);
    const expectedX = oldest.rawX + probe.windX * drift;
    const expectedZ = oldest.rawZ + probe.windZ * drift;
    expect(Math.abs(oldest.x - expectedX)).toBeLessThan(0.05);
    expect(Math.abs(oldest.z - expectedZ)).toBeLessThan(0.05);
  });

  test('running lays bigger, brighter points than walking (matches the alpha formula exactly), and standing still lets the trail decay to nothing', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    // LUL-2539: this test's alpha formula and decay-to-nothing check both hardcode the base
    // (no-wind) SCENT_LIFETIME=14 -- force wind off so the new 50/50 windHighSpeed roll can't
    // make it flaky.
    await qaHook(page, 'qaSetWindHighSpeed', false);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await walkForward(page, 1);
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    await qaHook(page, 'qaAdvance', stepsFor(1));
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');

    const probe = await qaHook(page, 'qaProbeScentTrail');
    expect(probe.points.length).toBeGreaterThan(0);

    const SCENT_LIFETIME = 14, SCENT_RADIUS_RUN = 3.6;
    for (const p of probe.points) {
      const expected = Math.max(0, (1 - p.age / SCENT_LIFETIME) * (1 - 0.7 * probe.veilAmount) * (p.radius / SCENT_RADIUS_RUN));
      expect(Math.abs(p.alpha - expected), `alpha must match the documented formula for age=${p.age} radius=${p.radius}`).toBeLessThan(1e-4);
    }

    // Running must actually have deposited a bigger radius than walking did --
    // the mechanism the formula above turns into "brighter", not an assumption.
    const radii = probe.points.map((p: { radius: number }) => p.radius);
    expect(Math.max(...radii), 'a running-sized point must exist').toBeGreaterThan(Math.min(...radii) * 1.1);

    // Standing still: no new points, and the existing ones decay out of both
    // the picture and the array over SCENT_LIFETIME (14s).
    await qaHook(page, 'qaAdvance', stepsFor(15));
    const decayed = await qaHook(page, 'qaProbeScentTrail');
    expect(decayed.points.length, 'the picture must decay, not just stop growing').toBe(0);
    expect(decayed.livePoints, 'the underlying array must actually decay too').toBe(0);
  });

  test('the one-time caption appears once, is gone within 8s, and the persisted gate resets on demand', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await walkForward(page, 2.5);
    const { yaw } = await qaHook(page, 'qaProbePlayer');
    await qaHook(page, 'qaSetLookYaw', yaw + Math.PI); // turn around to face the trail laid behind us
    await qaHook(page, 'qaAdvance', stepsFor(0.1)); // one frame is enough for the frustum check to see it

    let probe = await qaHook(page, 'qaProbeScentTrail');
    expect(probe.points.some((p: { inFrustum: boolean }) => p.inFrustum), 'turning around must put a mote in frustum').toBe(true);
    expect(probe.captionVisible).toBe(true);

    const caption = page.locator('#scentTrailCaption');
    await expect(caption).toBeVisible();
    await expect(caption).toContainText('this is your scent trail — predators follow it');
    await assertInViewport(caption, page, '#scentTrailCaption');
    await assertNoOverlap(page, '#scentTrailCaption', '#objective');
    await assertNoOverlap(page, '#scentTrailCaption', '#windIndicatorHint');
    await assertNoOverlap(page, '#scentTrailCaption', '#status');
    await assertNoOverlap(page, '#scentTrailCaption', '#actionPrompt');

    // Gone within 8s.
    await qaHook(page, 'qaAdvance', stepsFor(8.1));
    probe = await qaHook(page, 'qaProbeScentTrail');
    expect(probe.captionVisible).toBe(false);
    expect(probe.captionSeen).toBe(true);
    await expect(caption).toHaveCount(0);

    // Does not show again without an explicit reset -- walk and turn again.
    await walkForward(page, 2.5);
    await qaHook(page, 'qaSetLookYaw', yaw + Math.PI);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    probe = await qaHook(page, 'qaProbeScentTrail');
    expect(probe.captionVisible, 'a caption already marked seen must not reappear').toBe(false);

    // qaResetScentCaption() proves the one-time gate is the persisted flag, not luck.
    await qaHook(page, 'qaResetScentCaption');
    await qaHook(page, 'qaSetLookYaw', yaw + Math.PI);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    probe = await qaHook(page, 'qaProbeScentTrail');
    expect(probe.captionVisible, 'resetting the gate must let the caption show again').toBe(true);
    expect(probe.captionSeen).toBe(false);
  });

  test('the caption never overlaps the reserved action-slot region when anchored near the y-clamp ceiling (LUL-2532)', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    // A close, ground-level (ry~0.22) point directly ahead projects far down
    // in the frame, pushing hintY (engine/forest-engine.js's hintWorldAnchor)
    // to HINT_Y_MAX (0.78) -- confirmed empirically (a 1-world-unit offset
    // lands --hint-top at exactly 78% on this viewport) as the exact geometry
    // the nightly QA rig's "play-again" repro hit, landing #scentTrailCaption's
    // lifted box inside #actionSlot's #objective row ("Find the lost child").
    // qaSeedScentPoint places the point in world space, so it's offset along
    // the player's own current forward vector (matches the fx/fz formula the
    // engine itself uses, e.g. forest-engine.js:1607).
    const { yaw } = await qaHook(page, 'qaProbePlayer');
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    await page.evaluate(([dx, dz]) => {
      window.ForestEngine?.qaSeedScentPoint?.(dx, dz, 1);
    }, [fx * 1, fz * 1]);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));

    const probe = await qaHook(page, 'qaProbeScentTrail');
    expect(probe.points.some((p: { inFrustum: boolean }) => p.inFrustum), 'the seeded close point must be in frustum').toBe(true);
    expect(probe.captionVisible).toBe(true);
    const caption = page.locator('#scentTrailCaption');
    await expect(caption).toBeVisible();
    await assertInViewport(caption, page, '#scentTrailCaption');
    await assertNoOverlap(page, '#scentTrailCaption', '#objective');
    await assertNoOverlap(page, '#scentTrailCaption', '#actionPrompt');
  });

  test('never shows over the win or death screen', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await walkForward(page, 2.5);
    const { yaw } = await qaHook(page, 'qaProbePlayer');
    await qaHook(page, 'qaSetLookYaw', yaw + Math.PI);
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    expect((await qaHook(page, 'qaProbeScentTrail')).captionVisible).toBe(true);

    await qaHook(page, 'qaForceDeath', 'wolf', 'chase');
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    await expect(page.locator('#scentTrailCaption')).toHaveCount(0);
    const afterDeath = await qaHook(page, 'qaProbeScentTrail');
    expect(afterDeath.rendered, 'the trail itself must also stop rendering over the death screen').toBe(false);
  });

  test('the mist veil dims the trail (presentation) without weakening scent detection (mechanic)', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await walkForward(page, 2.5);
    const before = await qaHook(page, 'qaProbeScentTrail');
    expect(before.veilAmount).toBeLessThan(0.05);

    await page.keyboard.down('KeyF');
    let after = before;
    for (let i = 0; i < 10 && after.veilAmount <= 0.9; i++) {
      after = await (async () => {
        await qaHook(page, 'qaAdvance', stepsFor(0.5));
        return qaHook(page, 'qaProbeScentTrail');
      })();
    }
    expect(after.veilAmount, 'veilAmount must ramp past 0.9 within the polled window').toBeGreaterThan(0.9);

    // Compare matched points by their stable raw (undrifted) identity -- x/z
    // drift and age both keep advancing between snapshots, so only rawX/rawZ
    // reliably names "the same point" across the two probes.
    let compared = 0;
    for (const b of before.points) {
      const match = after.points.find((p: { rawX: number; rawZ: number }) => p.rawX === b.rawX && p.rawZ === b.rawZ);
      if (!match) continue; // decayed out of the window between snapshots -- not this check's concern
      compared++;
      // Natural decay over the elapsed time only makes this ratio smaller
      // (more dimmed), never larger, so <=0.36 (vs. the spec's 0.3
      // veil-only factor) is a safe upper bound, not a loose one.
      expect(match.alpha / b.alpha, 'veil must dim this point to <=~0.35x its pre-veil alpha').toBeLessThanOrEqual(0.36);
    }
    expect(compared, 'at least one point must have survived both snapshots to compare').toBeGreaterThan(0);
    await page.keyboard.up('KeyF');

    // The smell itself is untouched: a predator seeded onto the trail while
    // still veiled still enters chase (pattern per e2e/scent.spec.ts).
    const seeded = await page.evaluate(() => {
      window.ForestEngine?.qaSeedScentPoint?.(-60, 0, 4);
      return window.ForestEngine?.qaProbeScentOnOldest?.('bear') ?? null;
    });
    expect(seeded).not.toBeNull();
    let reachedChase = false;
    for (let i = 0; i < 20; i++) {
      await qaHook(page, 'qaAdvance', stepsFor(0.5));
      const s = await qaHook(page, 'qaProbePredatorState', 'bear');
      if (s?.state === 'chase') { reachedChase = true; break; }
    }
    expect(reachedChase, 'the veil must not suppress checkScent()/scentOnto() -- it only dims the picture').toBe(true);
  });

  test('the Settings toggle hides the picture and caption without touching the array, and persists', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await walkForward(page, 2.5);

    const before = await qaHook(page, 'qaProbeScentTrail');
    expect(before.rendered).toBe(true);
    const livePointsBefore = before.livePoints;

    const openSettings = async () => {
      await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
      await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
    };
    // el.click(), not a real Playwright click -- the WebGL canvas intercepts
    // real pointer-actionability polling in this rig (wiki:
    // systems/lul44-diagnosis-and-fix), same workaround every other spec that
    // clicks a HUD control over the canvas already uses.
    const closeSettings = () =>
      page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());

    await openSettings();
    const toggle = page.getByLabel(/show my scent trail/i);
    await expect(toggle).toBeChecked();
    await toggle.evaluate((el) => (el as HTMLInputElement).click());
    await expect(toggle).not.toBeChecked();
    await closeSettings();

    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    const off = await qaHook(page, 'qaProbeScentTrail');
    expect(off.settingOn).toBe(false);
    expect(off.rendered).toBe(false);
    expect(off.livePoints, 'turning the picture off must not touch the detection array').toBe(livePointsBefore);
    await expect(page.locator('#scentTrailCaption')).toHaveCount(0);

    await openSettings();
    await expect(toggle).not.toBeChecked();
    await toggle.evaluate((el) => (el as HTMLInputElement).click());
    await expect(toggle).toBeChecked();
    await closeSettings();
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    expect((await qaHook(page, 'qaProbeScentTrail')).rendered).toBe(true);

    // Turn it off again and reload -- the *off* state must be what survives.
    await openSettings();
    await toggle.evaluate((el) => (el as HTMLInputElement).click());
    await expect(toggle).not.toBeChecked();
    await closeSettings();

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.ForestEngine));
    await enter(page);
    await openSettings();
    await expect(page.getByLabel(/show my scent trail/i), 'the unchecked state must persist across reload').not.toBeChecked();
  });
});
