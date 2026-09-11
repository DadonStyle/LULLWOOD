// LUL-650: "admin mode" toggle in the settings dialog (reached via #settingsBtn,
// the founder's "menu in esc" -- see the LUL-650 ticket comment for why Escape
// itself doesn't open it directly). Follows the highContrast precedent exactly
// (components/SettingsPanel.tsx, components/GameCanvas.tsx's stylesheet):
// presentation-only, no engine action, a document.body dataset flag CSS keys
// off, persisted to the `lullwood:settings` localStorage blob.
//
// Default is OFF -- a fresh session with no persisted settings must already
// hide the pace/mist/sound/regen/fullscreen controls, not show today's full
// dev HUD until a player opts in.
//
// LUL-2309: the minimap got its own `showMinimap` setting, decoupled from
// admin mode (LUL-2248 turned it into a player-facing navigation aid, not a
// dev tool) -- its default-off/toggle coverage moved to e2e/minimap-setting.spec.ts.
//
// LUL-1085: #settingsBtn moved into GameMenu's hamburger panel (components/GameMenu.tsx)
// and only renders once that menu is opened -- not visible on boot the way it was
// pre-LUL-1085. Open it via the menuToggle testid first, same as e2e/mobile/admin-mode.spec.ts.
import { test, expect } from '@playwright/test';
import { boot, enter } from './helpers';

test.describe('admin mode', () => {
  test('defaults off: pace/mist panel is hidden, Settings stays reachable', async ({ page }) => {
    await boot(page);
    await enter(page);

    await expect(page.locator('#pace')).toBeHidden();
    await expect(page.locator('#fog')).toBeHidden();
    await expect(page.locator('#sound')).toBeHidden();
    await expect(page.locator('#regen')).toBeHidden();

    // LUL-1085 re-scoped #panel to dev-only monitoring with no exemptions --
    // #lightState/#veilState are #panel children like the rest, hidden by
    // default same as pace/fog/sound/regen above. Regression guard for the
    // PR #126 selector class of bug (see LUL-1824/game/lul1724-panel-dev-only-finding):
    // the real player-facing tell for veil/light is the in-world vignette + fog.
    await expect(page.locator('#lightState')).toBeHidden();
    await expect(page.locator('#veilState')).toBeHidden();

    // The one control that must survive admin-mode-off: without it a player
    // who never opts in has no way back into Settings at all. It lives inside
    // GameMenu's hamburger panel (LUL-1085), so open that first.
    const menuToggle = page.getByTestId('menuToggle');
    await expect(menuToggle).toBeVisible();
    await menuToggle.evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('#settingsBtn')).toBeVisible();
  });

  test('toggling on reveals the panel; toggling off hides it again', async ({ page }) => {
    await boot(page);
    await enter(page);

    // el.click(), not a real Playwright click/check -- see
    // wiki:systems/lul44-diagnosis-and-fix (HUD button/input clicks in this
    // rig can time out real actionability polling under load; confirmed here
    // when a real .check() timed out on "canvas intercepts pointer events"
    // even though document.elementFromPoint hits the checkbox correctly).
    // LUL-1085: settingsBtn lives inside GameMenu's hamburger panel, open it first.
    await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
    await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
    const toggle = page.getByLabel(/admin mode/i);
    await expect(toggle).not.toBeChecked();

    await toggle.evaluate((el) => (el as HTMLInputElement).click());
    await expect(toggle).toBeChecked();
    await expect(page.locator('#pace')).toBeVisible();
    await expect(page.locator('#fog')).toBeVisible();
    await expect(page.locator('#sound')).toBeVisible();
    await expect(page.locator('#regen')).toBeVisible();

    await toggle.evaluate((el) => (el as HTMLInputElement).click());
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('#pace')).toBeHidden();
  });
});
