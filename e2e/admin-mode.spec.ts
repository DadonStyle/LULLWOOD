// LUL-650: "admin mode" toggle in the settings dialog (reached via #settingsBtn,
// the founder's "menu in esc" -- see the LUL-650 ticket comment for why Escape
// itself doesn't open it directly). Follows the highContrast precedent exactly
// (components/SettingsPanel.tsx, components/GameCanvas.tsx's stylesheet):
// presentation-only, no engine action, a document.body dataset flag CSS keys
// off, persisted to the `lullwood:settings` localStorage blob.
//
// Default is OFF -- a fresh session with no persisted settings must already
// hide the pace/mist/sound/regen/fullscreen controls and the minimap, not
// show today's full dev HUD until a player opts in.
import { test, expect } from '@playwright/test';
import { boot, enter } from './helpers';

test.describe('admin mode', () => {
  test('defaults off: pace/mist panel and minimap are hidden, Settings stays reachable', async ({ page }) => {
    await boot(page);
    await enter(page);

    await expect(page.locator('#minimap')).toBeHidden();
    await expect(page.locator('#pace')).toBeHidden();
    await expect(page.locator('#fog')).toBeHidden();
    await expect(page.locator('#sound')).toBeHidden();
    await expect(page.locator('#regen')).toBeHidden();

    // The one control that must survive admin-mode-off: without it a player
    // who never opts in has no way back into Settings at all.
    await expect(page.locator('#settingsBtn')).toBeVisible();
  });

  test('toggling on reveals the panel and minimap; toggling off hides them again', async ({ page }) => {
    await boot(page);
    await enter(page);

    // el.click(), not a real Playwright click/check -- see
    // wiki:systems/lul44-diagnosis-and-fix (HUD button/input clicks in this
    // rig can time out real actionability polling under load; confirmed here
    // when a real .check() timed out on "canvas intercepts pointer events"
    // even though document.elementFromPoint hits the checkbox correctly).
    await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
    const toggle = page.getByLabel(/admin mode/i);
    await expect(toggle).not.toBeChecked();

    await toggle.evaluate((el) => (el as HTMLInputElement).click());
    await expect(toggle).toBeChecked();
    await expect(page.locator('#minimap')).toBeVisible();
    await expect(page.locator('#pace')).toBeVisible();
    await expect(page.locator('#fog')).toBeVisible();
    await expect(page.locator('#sound')).toBeVisible();
    await expect(page.locator('#regen')).toBeVisible();

    await toggle.evaluate((el) => (el as HTMLInputElement).click());
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('#minimap')).toBeHidden();
    await expect(page.locator('#pace')).toBeHidden();
  });
});
