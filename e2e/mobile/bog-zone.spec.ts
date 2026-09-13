// LUL-2225 mobile half -- see ../bog-zone.spec.ts for the desktop spec and
// the full writeup, and docs/specs/lul-2225-small-bog.md's '## e2e' section
// for the rationale. Bogginess/keep-clear/blackout-spawn assertions don't
// depend on input mode at all (they read engine state directly), so this
// only re-drives the one input-dependent check (the slow-walk effect)
// through the real left stick, same pattern as ../mobile/scent-trail.spec.ts.
import { test, expect, type Page } from '@playwright/test';
import { boot, qaHook, QA_PINNED_SEED } from '../helpers';
import { LANDMARKS, CAVE, CONFIG } from '../../engine/tuning';
import { BOG_CENTER, BOG_INNER_RADIUS, BOG_OUTER_RADIUS, BOG_SPEED_MULTIPLIER } from '../../lib/game/bog';
// fullmap-reason: the bog is zeroed in the micro preset; this spec measures the real bog patch on a phone viewport (LUL-2377: the QA rig never runs @fullmap; run locally with E2E_FULLMAP=1)

test.use({ viewport: { width: 727, height: 393 } });

const FIXED_DT = 1 / 60;

async function enterMobile(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (no pointer-lock on mobile)
}

/** Push the left stick forward and hold it for `steps` qaAdvance ticks, same pattern as ../mobile/scent-trail.spec.ts. */
async function walkForward(page: Page, steps: number) {
  const stick = page.getByTestId('leftStick');
  await expect(stick).toBeVisible();
  const box = await stick.boundingBox();
  if (!box) throw new Error('leftStick has no bounding box');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await stick.dispatchEvent('pointerdown', { ...pointerOpts, clientX: cx, clientY: cy });
  await stick.dispatchEvent('pointermove', { ...pointerOpts, clientX: cx, clientY: cy - 30 }); // up = forward
  await qaHook(page, 'qaAdvance', steps);
  await stick.dispatchEvent('pointerup', { ...pointerOpts, clientX: cx, clientY: cy - 30 });
}

test.describe('bog zone (mobile) @fullmap', () => {
  test('bogginess samples match the patch geometry', async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true });

    const center = await qaHook(page, 'qaProbeBog', BOG_CENTER.x, BOG_CENTER.z);
    expect(center.bogginess).toBe(1);

    const justOutside = await qaHook(page, 'qaProbeBog', BOG_CENTER.x + BOG_OUTER_RADIUS + 1, BOG_CENTER.z);
    expect(justOutside.bogginess).toBe(0);

    const home = await qaHook(page, 'qaProbeBog', 0, 0);
    expect(home.bogginess).toBe(0);

    for (const l of LANDMARKS) {
      const sample = await qaHook(page, 'qaProbeBog', l.x, l.z);
      expect(sample.bogginess, `${l.kind} should be dry`).toBe(0);
    }
    const caveSample = await qaHook(page, 'qaProbeBog', CAVE.x, CAVE.z);
    expect(caveSample.bogginess).toBe(0);
  });

  test('nothing else spawns inside the patch', async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true });
    const kc = await qaHook(page, 'qaProbeBogKeepClear');
    expect(kc.coverInside).toBe(0);
    expect(kc.throwablesInside).toBe(0);
    expect(kc.landmarksInside).toBe(0);
    expect(kc.reedsInsideCore).toBe(0);
    // See ../bog-zone.spec.ts for why 40%, not the nominal 25% target -- the
    // per-seed count is a counter over however many trees actually land in
    // BOG_INNER_RADIUS for this seed, so it lands near (not exactly at) 25%.
    const expectedNaturalDensity = (CONFIG.trees * Math.PI * BOG_INNER_RADIUS ** 2) / CONFIG.mapSize ** 2;
    expect(kc.treesInsideCore).toBeLessThanOrEqual(Math.ceil(expectedNaturalDensity * 0.4));
  });

  test('walking through the bog via the left stick is measurably slower than dry ground', async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true });
    await enterMobile(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await qaHook(page, 'qaTeleportTo', BOG_CENTER.x, BOG_CENTER.z);
    const bogStart = await qaHook(page, 'qaProbePlayer');
    await walkForward(page, 120);
    const bogEnd = await qaHook(page, 'qaProbePlayer');
    const bogDist = Math.hypot(bogEnd.x - bogStart.x, bogEnd.z - bogStart.z);

    // Dry ground, verified clear of any obstacle for 10+ units in the -z travel
    // direction at QA_PINNED_SEED -- see ../bog-zone.spec.ts for why this point
    // specifically, not a nearer/rounder-looking coordinate.
    await qaHook(page, 'qaTeleportTo', 0, -80);
    const dryStart = await qaHook(page, 'qaProbePlayer');
    await walkForward(page, 120);
    const dryEnd = await qaHook(page, 'qaProbePlayer');
    const dryDist = Math.hypot(dryEnd.x - dryStart.x, dryEnd.z - dryStart.z);

    expect(dryDist).toBeGreaterThan(0);
    const ratio = bogDist / dryDist;
    expect(ratio).toBeGreaterThan(BOG_SPEED_MULTIPLIER * 0.9);
    expect(ratio).toBeLessThan(BOG_SPEED_MULTIPLIER * 1.1);
  });

  test('blackout spawns the child beyond the bog on four pinned seeds; normal mode does not', async ({ page }) => {
    await boot(page, { qaWorld: 'full',  qaHooks: true, seed: QA_PINNED_SEED });
    await qaHook(page, 'qaSetDifficulty', 'hard');

    for (const seed of [QA_PINNED_SEED, 1, 2, 3]) {
      await qaHook(page, 'qaRegenerateMap', seed);
      const baby = await qaHook(page, 'qaProbeBaby');
      expect(baby.distHome, `seed ${seed}: distHome`).toBeGreaterThanOrEqual(192);
      expect(baby.routeCrossesBog, `seed ${seed}: routeCrossesBog`).toBe(true);
    }

    await qaHook(page, 'qaSetDifficulty', 'normal');
    await qaHook(page, 'qaRegenerateMap', QA_PINNED_SEED);
    const normalBaby = await qaHook(page, 'qaProbeBaby');
    expect(normalBaby.distHome).toBeGreaterThanOrEqual(120);
    expect(normalBaby.distHome).toBeLessThanOrEqual(192);
  });
});
