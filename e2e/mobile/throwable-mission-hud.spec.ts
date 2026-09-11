// LUL-2123: mobile half of qaGrabThrowable()/qaTeleportNearMission() -- see
// ../throwable-mission-hud.spec.ts for the desktop half and the full "why".
// Same engine-visible-effect discipline as the rest of e2e/mobile: assert
// qaPlayerState()/#missionPanel content, not just that a button renders.
import { test, expect } from '@playwright/test';
import { boot, qaHook, expectRowVisible } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } });

test('qaGrabThrowable() shows #throwPrompt (mobile copy) and mounts the Throw button', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  // Made to fail once on purpose: the Throw button only mounts while holding a stone.
  await expect(page.getByTestId('mobileControls').getByText('Throw')).toHaveCount(0);

  const grabbed = await qaHook(page, 'qaGrabThrowable');
  expect(grabbed, 'qaGrabThrowable returned null -- no untaken stone at this seed').not.toBeNull();

  const prompt = page.locator('#throwPrompt');
  await expectRowVisible(page, 'throwPrompt');
  await expect(prompt).toContainText('tap');

  const throwBtn = page.getByTestId('mobileControls').getByText('Throw');
  await expect(throwBtn).toBeVisible({ timeout: 3_000 });

  const player = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(player?.mode).toBe('mobile');
});

test('qaTeleportNearMission() shows #missionPanel', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  const target = await qaHook(page, 'qaTeleportNearMission');
  expect(target, 'qaTeleportNearMission returned null -- no active mission').not.toBeNull();
  expect(target.kind).toBe('deepwater');

  await page.waitForTimeout(250);
  await expect(page.locator('#missionPanel')).toBeVisible({ timeout: 3_000 });
});
