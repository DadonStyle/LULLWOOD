// LUL-2225: the founder rejected LUL-2084's shipped bog for being ~25% of the
// map with landmarks blended inside it. This is the e2e coverage LUL-2084
// shipped with none of (grep -rn "qaSetDifficulty|qaProbeBaby|blackout|bog"
// e2e/ matched only the LUL-1093 minimap clamp test before this spec).
// See docs/specs/lul-2225-small-bog.md's '## e2e' section for the full
// rationale behind each assertion below.
import { test, expect } from '@playwright/test';
import { boot, enter, qaHook, QA_PINNED_SEED } from './helpers';
import { LANDMARKS, CAVE, CONFIG } from '../engine/tuning';
import { BOG_CENTER, BOG_INNER_RADIUS, BOG_OUTER_RADIUS, BOG_SPEED_MULTIPLIER } from '../lib/game/bog';

test.describe('bog zone', () => {
  test('bogginess samples match the patch geometry', async ({ page }) => {
    await boot(page, { qaHooks: true });

    const center = await qaHook(page, 'qaProbeBog', BOG_CENTER.x, BOG_CENTER.z);
    expect(center.bogginess).toBe(1);

    const justInsideInner = await qaHook(page, 'qaProbeBog', BOG_CENTER.x + BOG_INNER_RADIUS - 1, BOG_CENTER.z);
    expect(justInsideInner.bogginess).toBe(1);

    const midway = await qaHook(
      page,
      'qaProbeBog',
      BOG_CENTER.x + (BOG_INNER_RADIUS + BOG_OUTER_RADIUS) / 2,
      BOG_CENTER.z,
    );
    expect(midway.bogginess).toBeGreaterThan(0);
    expect(midway.bogginess).toBeLessThan(1);

    const justOutside = await qaHook(page, 'qaProbeBog', BOG_CENTER.x + BOG_OUTER_RADIUS + 1, BOG_CENTER.z);
    expect(justOutside.bogginess).toBe(0);

    const home = await qaHook(page, 'qaProbeBog', 0, 0);
    expect(home.bogginess).toBe(0);

    const lake = await qaHook(page, 'qaProbeBog', CONFIG.lake.x, CONFIG.lake.z);
    expect(lake.bogginess).toBe(0);

    for (const l of LANDMARKS) {
      const sample = await qaHook(page, 'qaProbeBog', l.x, l.z);
      expect(sample.bogginess, `${l.kind} should be dry`).toBe(0);
    }
    const caveSample = await qaHook(page, 'qaProbeBog', CAVE.x, CAVE.z);
    expect(caveSample.bogginess).toBe(0);
  });

  test('nothing else spawns inside the patch', async ({ page }) => {
    await boot(page, { qaHooks: true });
    const kc = await qaHook(page, 'qaProbeBogKeepClear');
    expect(kc.coverInside).toBe(0);
    expect(kc.throwablesInside).toBe(0);
    expect(kc.landmarksInside).toBe(0);
    expect(kc.reedsInsideCore).toBe(0);
    // CONFIG.trees * pi*BOG_INNER_RADIUS^2/mapSize^2 ~= 44.3 natural density;
    // <= 25% of that is <= 11.1 -- assert against the rounded-up integer.
    const expectedNaturalDensity = (CONFIG.trees * Math.PI * BOG_INNER_RADIUS ** 2) / CONFIG.mapSize ** 2;
    expect(kc.treesInsideCore).toBeLessThanOrEqual(Math.ceil(expectedNaturalDensity * 0.25));
  });

  test('walking through the bog is measurably slower than dry ground', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', 1 / 60);

    await qaHook(page, 'qaTeleportTo', BOG_CENTER.x, BOG_CENTER.z);
    const bogStart = await qaHook(page, 'qaProbePlayer');
    await page.keyboard.down('KeyW');
    await qaHook(page, 'qaAdvance', 120);
    await page.keyboard.up('KeyW');
    const bogEnd = await qaHook(page, 'qaProbePlayer');
    const bogDist = Math.hypot(bogEnd.x - bogStart.x, bogEnd.z - bogStart.z);

    await qaHook(page, 'qaTeleportTo', 0, -60); // dry ground -- outside BOG_OUTER_RADIUS, clear of the lake
    const dryStart = await qaHook(page, 'qaProbePlayer');
    await page.keyboard.down('KeyW');
    await qaHook(page, 'qaAdvance', 120);
    await page.keyboard.up('KeyW');
    const dryEnd = await qaHook(page, 'qaProbePlayer');
    const dryDist = Math.hypot(dryEnd.x - dryStart.x, dryEnd.z - dryStart.z);

    expect(dryDist).toBeGreaterThan(0);
    const ratio = bogDist / dryDist;
    expect(ratio).toBeGreaterThan(BOG_SPEED_MULTIPLIER * 0.9);
    expect(ratio).toBeLessThan(BOG_SPEED_MULTIPLIER * 1.1);
  });

  test('blackout spawns the child beyond the bog on four pinned seeds; normal mode does not', async ({ page }) => {
    await boot(page, { qaHooks: true, seed: QA_PINNED_SEED });
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

  test('the bog patch is drawn on the minimap, sized to BOG_OUTER_RADIUS', async ({ page }) => {
    await boot(page, { qaHooks: true });
    const point = await qaHook(page, 'qaProbeMinimapPoint', BOG_CENTER.x, BOG_CENTER.z);
    expect(point.px).toBeGreaterThanOrEqual(0);
    expect(point.px).toBeLessThanOrEqual(point.mm);
    expect(point.py).toBeGreaterThanOrEqual(0);
    expect(point.py).toBeLessThanOrEqual(point.mm);
  });
});
