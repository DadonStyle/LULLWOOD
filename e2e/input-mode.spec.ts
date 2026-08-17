// LUL-275: regression coverage for LUL-274/LUL-276 (input-mode separation).
//
// FACT 1 was `navigator.maxTouchPoints > 0` mounting the mobile stick overlay
// on top of ordinary desktop mouse-look on real hybrid hardware (a touchscreen
// laptop that *also* has a mouse/trackpad). FACT 2 was the mouse and that
// wrongly-mounted stick both writing player.yaw/pitch in the same frame.
//
// Two scenarios, two tests below:
//
// 1. The actual "ordinary desktop" case (no touch signal at all -- the
//    `chromium` project's plain default context). An untouched desktop must
//    never mount the overlay and must bind desktop mode. Its pitch-stability
//    check is a baseline sanity check only, *not* a FACT 2 regression gate:
//    with no overlay mounted, touchLook is structurally unreachable here --
//    both the tick's touch-look block and the exposed `setTouchLook` action
//    independently early-return unless `mode === 'mobile'`, and there is no
//    UI or QA hook in desktop mode to drive it around those guards. Reverting
//    FACT 2's fix would not make this test go red; test 2 below is where that
//    guard is actually exercised, because only there is `mode` 'mobile'.
//
// 2. `hasTouch: true` layered onto that same desktop project. This was meant
//    to reproduce FACT 1's exact trigger condition per the original spec plan
//    (wiki: game/lul275-spec-design) -- but empirically it does not: measured
//    directly (see the comment above that test), Chromium's headless touch
//    emulation reports `(any-pointer: fine)` as *false*, i.e. it models a
//    touch-ONLY device with no coexisting mouse, not the hybrid
//    touch-laptop-with-a-mouse hardware FACT 1 was about. There is no
//    Playwright API in this rig to assert "touch present AND a fine pointer
//    also present" simultaneously -- headless Chromium's emulated pointer
//    capabilities are one full profile, not independently-settable axes. So
//    `isMobile() === true` under `hasTouch: true` is *correct*, not a
//    regression; the useful thing left to assert is that the app agrees with
//    itself about it everywhere (no split-brain between the HUD's mount
//    decision and the engine's own `mode`), and -- because `mode` really is
//    'mobile' here -- this is the test that can and does gate FACT 2 for
//    real: it drives the right stick (including a lost pointerup) and proves
//    a real mouse event has zero effect on pitch while classified mobile.
//
// The mobile-only half of this regression (FACT 3: stick-up must move the
// player forward, not backward) lives in e2e/mobile/input-mode.spec.ts --
// see that file for why it needs a real mobile-emulated project.
//
// See wiki: game/lul274-input-mode-separation, game/lul275-spec-design.
import { test, expect } from '@playwright/test';
import { boot, enter } from './helpers';

test.describe('ordinary desktop, no touch signal (LUL-274 FACT 1 / FACT 2 regression)', () => {
  test('mobile stick overlay never mounts, mode is desktop, and pitch is stable across pointer-lock acquisition', async ({
    page,
  }) => {
    await boot(page, { qaHooks: true });

    await expect(page.getByTestId('mobileControls')).toHaveCount(0);

    const preEnter = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
    expect(preEnter?.mode).toBe('desktop');

    await enter(page); // clicks the gate, requests pointer lock, waits for settle

    const pitchAfterLock = (await page.evaluate(() => window.ForestEngine?.qaPlayerState?.()))?.pitch;
    expect(typeof pitchAfterLock).toBe('number');

    await page.waitForTimeout(500); // zero input in between

    const pitchLater = (await page.evaluate(() => window.ForestEngine?.qaPlayerState?.()))?.pitch;

    // Baseline sanity only (see file header): nothing in desktop mode ever
    // writes pitch without input, so this can't distinguish fixed from
    // reverted -- it just guards against an unrelated idle-drift bug here.
    // The real FACT 2 regression gate is the mouse-vs-stick test below.
    expect(pitchLater).toBe(pitchAfterLock);
  });
});

test.describe('touch-emulated desktop context (hasTouch: true)', () => {
  test.use({ hasTouch: true });

  test('is classified mobile consistently everywhere (no split-brain), the stick alone drives pitch (including a lost pointerup), and the mouse never also writes it', async ({
    page,
  }) => {
    await boot(page, { qaHooks: true });

    // Not a regression assertion (see file header): under this rig's touch
    // emulation there is no fine pointer at all, so isMobile() correctly
    // returning true, and the overlay correctly mounting, is expected.
    await expect(page.getByTestId('mobileControls')).toHaveCount(1);

    const preEnter = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
    // The load-bearing assertion: the HUD's mount decision (overlay present)
    // and the engine's own `mode` binding must agree. FACT 2's actual root
    // cause was these two disagreeing -- one part of the app thinking desktop,
    // another thinking mobile, both writing player state in the same frame.
    expect(preEnter?.mode).toBe('mobile');

    await enter(page);

    // REVIEW (PR #47): the previous version of this test only sampled pitch
    // across an idle window with no input at all, so it could not go red
    // against a revert of forest-engine.js's `if(mode === 'desktop')` guard
    // around the mouse-look listeners -- touchLook was {0,0} throughout and
    // nothing was ever exercised. Below actually drives both input paths.

    // Phase 1: the right stick alone must drive pitch, including the
    // documented "lost pointerup" trigger (game/lul274-input-mode-separation)
    // -- drag it and deliberately withhold pointerup so the stick reads as
    // still held while we sample.
    const rightStick = page.getByTestId('rightStick');
    await expect(rightStick).toBeVisible();
    const box = await rightStick.boundingBox();
    if (!box) throw new Error('rightStick has no bounding box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };

    const pitchBeforeStick = (await page.evaluate(() => window.ForestEngine?.qaPlayerState?.()))?.pitch;
    await rightStick.dispatchEvent('pointerdown', { ...pointerOpts, clientX: cx, clientY: cy });
    await rightStick.dispatchEvent('pointermove', { ...pointerOpts, clientX: cx, clientY: cy - 30 }); // push up, above the dead zone
    await page.waitForTimeout(300); // stuck "held" -- pointerup deliberately not sent yet
    const pitchWhileStuck = (await page.evaluate(() => window.ForestEngine?.qaPlayerState?.()))?.pitch;
    expect(typeof pitchBeforeStick).toBe('number');
    expect(pitchWhileStuck).not.toBe(pitchBeforeStick); // the touch path is actually live

    // Release the stick before isolating the mouse's contribution below.
    await rightStick.dispatchEvent('pointerup', { ...pointerOpts, clientX: cx, clientY: cy - 30 });
    await page.waitForTimeout(200); // let touchLook settle back to {0,0}

    // Phase 2: the actual FACT 2 regression gate -- with mode classified
    // mobile, a real mouse event must have zero effect on pitch. Pre-fix
    // (or with the `if(mode === 'desktop')` guard reverted) the desktop
    // mouse-look listeners bind unconditionally, so this dispatch would move
    // pitch; post-fix they are never registered in mobile mode at all.
    const pitchBeforeMouse = (await page.evaluate(() => window.ForestEngine?.qaPlayerState?.()))?.pitch;
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas:not(#minimap)');
      canvas?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: 400, movementY: 400, bubbles: true } as MouseEventInit));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const pitchAfterMouse = (await page.evaluate(() => window.ForestEngine?.qaPlayerState?.()))?.pitch;

    expect(pitchAfterMouse).toBe(pitchBeforeMouse);
  });
});
