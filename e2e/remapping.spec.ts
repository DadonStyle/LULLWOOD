// LUL-5805: keybind remapping, cheap slice (movement only -- LUL-5804 accepted the
// Cheap Slice option, decisions/lul-5804-keybind-remapping-accepted-2026-10-02).
// `keyMap` (engine/forest-engine.js) holds the live KeyboardEvent `code` for each of
// the 4 movement verbs; the 3 WASD-reading call sites (shuffleHide, log-crawl, main
// movement in stepFrame()) all read through it, with Arrow keys kept as a permanent
// hardcoded fallback so a bad remap can never lock the player out of movement.
//
// Micro world (qaBuildScene default), no @fullmap -- this is an input-binding
// change, not map geometry (same reasoning as e2e/beacon-hunter-deepwater-
// mission.spec.ts's own header).
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;

test.describe('keybind remapping -- movement cheap slice (LUL-5805)', () => {
  test('defaults: WASD moves the player forward', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const before = await qaHook(page, 'qaPlayerState');
    await page.keyboard.down('KeyW');
    await qaHook(page, 'qaAdvance', 30);
    await page.keyboard.up('KeyW');
    const after = await qaHook(page, 'qaPlayerState');

    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    expect(moved, 'default KeyW must move the player').toBeGreaterThan(0.1);
  });

  test('remapping forward via the real Settings UI changes which key moves the player, with a staged predator in the scene', async ({
    page,
  }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    // A staged (non-inert) predator, same qaBuildScene shape every other
    // micro-world spec uses -- this is not a stealth mechanic, but a remap
    // that silently broke movement mid-chase would be the real-world failure
    // mode, so the scene isn't "nothing hunting you" empty.
    await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 0, z: -90 }] });

    // Real UI path, not fake state: open Settings, click "Remap" for Move
    // forward, then press the new key -- exactly what a player does.
    await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
    await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
    await page.getByText('Move forward').locator('xpath=following-sibling::button').click();
    await page.keyboard.press('KeyI');

    const keyMap = await qaHook(page, 'qaProbeKeyMap');
    expect(keyMap?.forward).toBe('KeyI');

    await page.locator('#settingsPanel button[aria-label="Close settings"]').click();

    // Old key no longer moves the player forward...
    const beforeOld = await qaHook(page, 'qaPlayerState');
    await page.keyboard.down('KeyW');
    await qaHook(page, 'qaAdvance', 30);
    await page.keyboard.up('KeyW');
    const afterOld = await qaHook(page, 'qaPlayerState');
    expect(Math.hypot(afterOld.x - beforeOld.x, afterOld.z - beforeOld.z)).toBeLessThan(0.05);

    // ...but the new key does.
    const beforeNew = await qaHook(page, 'qaPlayerState');
    await page.keyboard.down('KeyI');
    await qaHook(page, 'qaAdvance', 30);
    await page.keyboard.up('KeyI');
    const afterNew = await qaHook(page, 'qaPlayerState');
    expect(Math.hypot(afterNew.x - beforeNew.x, afterNew.z - beforeNew.z)).toBeGreaterThan(0.1);
  });

  test('a remap persists across reload via lullwood:settings', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
    await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
    await page.getByText('Move forward').locator('xpath=following-sibling::button').click();
    await page.keyboard.press('KeyI');
    // Give the persist effect (SettingsPanel.tsx) a tick to write localStorage.
    await page.waitForTimeout(100);

    const raw = await page.evaluate(() => window.localStorage.getItem('lullwood:settings'));
    expect(JSON.parse(raw ?? '{}').keyMap?.forward).toBe('KeyI');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.ForestEngine) && document.querySelectorAll('canvas').length === 2);
    await enter(page);
    const keyMap = await qaHook(page, 'qaProbeKeyMap');
    expect(keyMap?.forward).toBe('KeyI');
  });
});
