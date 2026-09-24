// LUL-2123: qaGrabThrowable() / qaTeleportNearMission() -- the two hooks that
// let the tester put #throwPrompt and #missionPanel on screen. Neither state
// was reachable before: throwable stone positions are seed-derived (no fixed
// teleport target existed), and the mission's near-target state (panel +
// prompt + objective together, the likely HUD-overlap collision) needed a
// 100-unit walk. Desktop only -- see e2e/mobile/throwable-mission-hud.spec.ts
// for the touch-emulated half (repo convention: mobile-emulated specs live
// under e2e/mobile/, picked up by the `mobile` Playwright project's own
// testDir; see playwright.config.ts LUL-275).
import { test, expect } from './fixtures';
import { boot, enter, qaHook, trackConsoleErrors, expectNoConsoleErrors, expectRowVisible, expectRowHidden } from './helpers';

test.describe('#throwPrompt via qaGrabThrowable()', () => {
  test('grabbing the nearest stone shows #throwPrompt; restart clears it', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // Made to fail once on purpose: with no throwable held yet, the prompt must not be shown.
    // LUL-2312: #throwPrompt is one of #actionSlot's always-mounted rows now --
    // "not present" is data-visible="0", not absence from the DOM.
    await expectRowHidden(page, 'throwPrompt');

    const grabbed = await qaHook(page, 'qaGrabThrowable');
    expect(grabbed, 'qaGrabThrowable returned null -- no untaken stone at this seed').not.toBeNull();

    await expectRowVisible(page, 'throwPrompt');
    await expect(page.locator('#throwPrompt')).toContainText('click to throw');

    // heldThrowable itself isn't on qaPlayerState -- #throwPrompt's visibility
    // and copy above are the engine-visible effect: Hud.tsx renders this text
    // only while state.heldThrowable is true (components/Hud.tsx).

    expectNoConsoleErrors(errs);
  });

  test('restart() clears heldThrowable and hides #throwPrompt', async ({ page }) => {
    test.setTimeout(45_000);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    const grabbed = await qaHook(page, 'qaGrabThrowable');
    expect(grabbed).not.toBeNull();
    await expectRowVisible(page, 'throwPrompt');

    expect(await qaHook(page, 'qaForceDeath', 'wolf', 'hunt')).toBe(true);
    // "Try again" -- the only in-game restart() path (e2e/death-sequence.spec.ts's convention).
    await expect(page.locator('#deathText')).toHaveCSS('opacity', '1', { timeout: 10_000 });
    await page.locator('.restartBtn').evaluate((el) => (el as HTMLElement).click());

    await expectRowHidden(page, 'throwPrompt', 5_000);
  });
});

test.describe('#missionPanel via qaTeleportNearMission()', () => {
  test('teleporting near the mission target shows #missionPanel and enables completion', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaMissionKind: 'deepwater' }); // LUL-3010: this test asserts deepwater-specific behaviour; force it past the new eligibility gate
    await enter(page);

    const target = await qaHook(page, 'qaTeleportNearMission');
    expect(target, 'qaTeleportNearMission returned null -- no active mission').not.toBeNull();
    expect(target.kind).toBe('deepwater');
    expect(target.status).toBe('active');

    await page.waitForTimeout(250);
    const panel = page.locator('#missionPanel');
    await expect(panel).toBeVisible({ timeout: 3_000 });

    // missionCanComplete itself isn't on qaPlayerState -- it surfaces through
    // #objective's text (engine/forest-engine.js: `missionCanComplete ? 'Press
    // E at the fire tower' : ...`), which is also what the tester/player see.
    // Made to fail once on purpose: right outside interactRadius, it must not read that yet.
    await expect(page.locator('#objective')).not.toContainText('fire tower');

    // Walk 2 units toward the target -- acceptance criterion from the ticket.
    // Rotate to face the target first: player.yaw is only readable/writable
    // via the real mouse-look path (applyLook(), not a qa hook), so probe the
    // yaw-per-movementX ratio with one small nudge, then correct exactly.
    const before = await page.evaluate(() => window.ForestEngine!.qaPlayerState!());
    const desiredYaw = Math.atan2(-(target.x - before.x), -(target.z - before.z));
    const probeDx = 100;
    await page.evaluate(() => {
      document.querySelector('canvas:not(#minimap)')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await page.evaluate(
      (dx: number) => window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: 0, bubbles: true } as MouseEventInit)),
      probeDx,
    );
    const afterProbe = await page.evaluate(() => window.ForestEngine!.qaPlayerState!());
    const yawPerUnit = (afterProbe.yaw - before.yaw) / probeDx;
    expect(yawPerUnit, 'mouse-look must actually turn the player (locked pointer or drag-look active)').not.toBe(0);
    let yawError = desiredYaw - afterProbe.yaw;
    while (yawError > Math.PI) yawError -= 2 * Math.PI;
    while (yawError < -Math.PI) yawError += 2 * Math.PI;
    const correctionDx = yawError / yawPerUnit;
    await page.evaluate(
      (dx: number) => window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: 0, bubbles: true } as MouseEventInit)),
      correctionDx,
    );

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyW');

    await expect(page.locator('#objective'), 'missionCanComplete must become true after closing the remaining distance').toContainText('fire tower', { timeout: 3_000 });

    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);

    const status = await page.evaluate(() => window.ForestEngine?.qaTeleportNearMission?.());
    expect(status?.status).toBe('complete');

    expectNoConsoleErrors(errs);
  });
});

test.describe('#missionPanel via qaTeleportAtMissionTarget()', () => {
  test('teleporting inside the interactRadius completes the mission with no movement', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaMissionKind: 'deepwater' }); // LUL-3010: this test asserts deepwater-specific behaviour; force it past the new eligibility gate
    await enter(page);

    const target = await qaHook(page, 'qaTeleportAtMissionTarget');
    expect(target, 'qaTeleportAtMissionTarget returned null -- no active mission').not.toBeNull();
    expect(target.kind).toBe('deepwater');
    expect(target.status).toBe('active');

    await page.waitForTimeout(250);
    await expect(page.locator('#missionPanel')).toBeVisible({ timeout: 3_000 });

    // The hook's whole point (LUL-2884) is landing inside interactRadius
    // already, so unlike qaTeleportNearMission()'s test above this needs no
    // KeyW hold to close the gap -- #objective must read complete-ready
    // immediately off the teleport.
    await expect(page.locator('#objective')).toContainText('fire tower', { timeout: 1_000 });

    const before = await page.evaluate(() => window.ForestEngine!.qaPlayerState!());
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.ForestEngine!.qaPlayerState!());

    // No movement input was ever sent -- pin that qaTeleportAtMissionTarget()
    // itself did the work, not some incidental drift.
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.z).toBeCloseTo(before.z, 5);

    const status = await page.evaluate(() => window.ForestEngine?.qaTeleportAtMissionTarget?.());
    expect(status?.status).toBe('complete');

    expectNoConsoleErrors(errs);
  });
});

test.describe('#pickupPrompt via qaTeleportNearThrowable()', () => {
  test('nearing an un-grabbed stone shows #pickupPrompt; grabbing it swaps to #throwPrompt', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    await expectRowHidden(page, 'pickupPrompt');

    const near = await qaHook(page, 'qaTeleportNearThrowable');
    expect(near, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();

    await expectRowVisible(page, 'pickupPrompt');
    await expect(page.locator('#pickupPrompt')).toContainText('pick up the stone');

    await qaHook(page, 'qaGrabThrowable');

    await expectRowHidden(page, 'pickupPrompt');
    await expectRowVisible(page, 'throwPrompt');

    expectNoConsoleErrors(errs);
  });
});
