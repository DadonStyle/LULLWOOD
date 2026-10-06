// LUL-5805: keybind remapping, cheap slice (movement only -- LUL-5804 accepted the
// Cheap Slice option, decisions/lul-5804-keybind-remapping-accepted-2026-10-02).
// `keyMap` (engine/forest-engine.js) holds the live KeyboardEvent `code` for each of
// the 4 movement verbs; the 3 WASD-reading call sites (shuffleHide, log-crawl, main
// movement in stepFrame()) all read through it, with Arrow keys kept as a permanent
// hardcoded fallback so a bad remap can never lock the player out of movement.
//
// LUL-5828: full-scope follow-up (decisions/lul-5806-keybind-full-scope-accepted-
// 2026-10-02) widens `keyMap` to the 7 action verbs too (interact/veilOverload/
// scentVeil/hide/climb/shuffleHide/jump) and adds a reject-on-collision guard to
// setKeyMap() -- see the second describe block below.
//
// Micro world (qaBuildScene default), no @fullmap -- this is an input-binding
// change, not map geometry (same reasoning as e2e/beacon-hunter-deepwater-
// mission.spec.ts's own header).
import { test, expect } from './fixtures';
import { boot, enter, qaHook, expectRowVisible, expectRowHidden } from './helpers';

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

test.describe('keybind remapping -- action verbs, full scope (LUL-5828)', () => {
  test('remapping interact via the real Settings UI changes which key grabs a throwable', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    // LUL-5859: without a pinned clock, canGrabThrowable's per-frame recompute (read by
    // #throwPrompt below) depends on the real RAF loop landing at least one frame inside
    // expectRowHidden/expectRowVisible's real 3s timeout -- same real-time-vs-simulated-
    // time race class LUL-5046 diagnosed for e2e/tree-pathing.spec.ts, just surfacing here
    // as a starved frame on a contended rig instead of a wandering predator. Same remedy
    // as the sibling 'forward' remap test above: park the RAF loop and drive a known
    // number of deterministic steps after each key press instead of racing real time.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
    await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
    await page.getByText('Interact / pick up').locator('xpath=following-sibling::button').click();
    await page.keyboard.press('KeyJ');

    const keyMap = await qaHook(page, 'qaProbeKeyMap');
    expect(keyMap?.interact).toBe('KeyJ');

    await page.locator('#settingsPanel button[aria-label="Close settings"]').click();

    // Stage a real, live throwable -- the same real-play consuming system
    // e2e/throwables.spec.ts uses -- and prove the OLD key no longer grabs it.
    const stone = await qaHook(page, 'qaTeleportNearThrowable');
    expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();
    await page.keyboard.press('KeyE');
    await qaHook(page, 'qaAdvance', 1);
    await expectRowHidden(page, 'throwPrompt');

    // ...but the new key does: heldThrowable flips and #throwPrompt appears.
    await page.keyboard.press('KeyJ');
    await qaHook(page, 'qaAdvance', 1);
    await expectRowVisible(page, 'throwPrompt');
  });

  test('remapping a verb onto an already-bound key is rejected: keyMap unchanged, collision tell renders', async ({
    page,
  }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
    await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
    // veilOverload defaults to KeyQ; attempt to rebind it onto KeyW, already
    // bound to `forward`.
    await page.getByText('Veil overload (panic burn)').locator('xpath=following-sibling::button').click();
    await page.keyboard.press('KeyW');

    const keyMap = await qaHook(page, 'qaProbeKeyMap');
    expect(keyMap?.veilOverload, 'rejected assignment must leave keyMap unchanged').toBe('KeyQ');
    expect(keyMap?.forward, 'the row that already owned the key must be untouched too').toBe('KeyW');

    // Q5: the refusal needs a positive tell, not silence -- rendered inline
    // under the offending row (SettingsPanel.tsx), not a toast or console log.
    await expect(page.getByText(/is already used by another action/i)).toBeVisible();
  });

  test('a remapped interact key is reflected in the templated pickupPrompt copy, with adminMode off', async ({
    page,
  }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    // LUL-5859: qaAdvance() below requires qaSetFixedStep() to run first (engine/
    // forest-engine.js throws otherwise) -- this test never called it, so the qaAdvance()
    // below could never have passed.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    const adminMode = await page.evaluate(() => document.body.dataset.adminMode);
    expect(adminMode, 'this assertion is only meaningful with the default (off) admin mode').toBe('0');

    await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
    await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
    await page.getByText('Interact / pick up').locator('xpath=following-sibling::button').click();
    await page.keyboard.press('KeyJ');
    await page.locator('#settingsPanel button[aria-label="Close settings"]').click();

    const stone = await qaHook(page, 'qaTeleportNearThrowable');
    expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();
    await qaHook(page, 'qaAdvance', 1);

    await expectRowVisible(page, 'pickupPrompt');
    await expect(page.locator('#pickupPrompt')).toContainText('Press  J  to pick up the stone');
    await expect(page.locator('#pickupPrompt')).not.toContainText('Press  E');
  });
});
