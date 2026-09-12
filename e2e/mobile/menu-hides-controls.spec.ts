// LUL-2231: components/MobileControls.tsx's sticks/buttons (z-index 30/31)
// sat over components/GameMenu.tsx's open menuPanel (z-index 21) -- neither
// unmounted for the other, so the E/Jump/Hide/Veil buttons and both `Stick`s
// covered the "Sound: on"/"Settings..." rows and ate their taps. Separately,
// both `Stick`s rendered unconditionally (only the button rows were gated on
// `entered`), so they also sat over the pre-entry gate screen's instructions.
// This mirrors LUL-2131's end-screen fix: unmount rather than hide.
import { test, expect } from '@playwright/test';
import { boot, qaHook } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

test('mobile controls are absent while the game menu is open', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  await expect(page.getByTestId('mobileControls')).toBeVisible();

  const menuToggle = page.getByTestId('menuToggle');
  await expect(menuToggle).toBeVisible();
  await menuToggle.click();
  await expect(page.locator('.menuPanel')).toBeVisible();

  await expect(page.getByTestId('mobileControls')).toBeHidden();
  await expect(page.getByTestId('mobilePauseWrapper')).toBeHidden();

  // Closing the menu brings the controls back.
  await menuToggle.click();
  await expect(page.locator('.menuPanel')).toBeHidden();
  await expect(page.getByTestId('mobileControls')).toBeVisible();
});

test('sticks are absent before entering, and appear once entered', async ({ page }) => {
  await boot(page, { qaHooks: true });

  // Pre-entry: the gate screen is up, nothing has been tapped yet.
  await expect(page.locator('#gate')).toBeVisible();
  await expect(page.getByTestId('leftStick')).toBeHidden();
  await expect(page.getByTestId('rightStick')).toBeHidden();

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  await expect(page.getByTestId('leftStick')).toBeVisible();
  await expect(page.getByTestId('rightStick')).toBeVisible();
});

// LUL-2442: the QA layout audit caught [data-testid=menuFullscreen] overlapping
// #missionPanel on mobile-pixel5-landscape/mobile-iphone-se-landscape -- the open
// .menuPanel's top:56px (inside #gameMenu's own top:16px) lands right on
// #missionPanel's top:76px/left:16px corner (GameCanvas.tsx). Same `menuOpen`
// gate as this file's other test, applied to #missionPanel (components/Hud.tsx).
test('#missionPanel is absent while the game menu is open, on mobile', async ({ page }) => {
  await boot(page, { qaHooks: true });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle

  const mission = await qaHook(page, 'qaProbeMission');
  expect(mission, 'qaProbeMission returned null -- no mission drawn this run').not.toBeNull();
  await expect(page.locator('#missionPanel')).toBeVisible({ timeout: 3_000 });

  await page.getByTestId('menuToggle').click();
  await expect(page.locator('.menuPanel')).toBeVisible();
  await expect(page.locator('#missionPanel')).toHaveCount(0);

  await page.getByTestId('menuToggle').click();
  await expect(page.locator('.menuPanel')).toBeHidden();
  await expect(page.locator('#missionPanel')).toBeVisible();
});
