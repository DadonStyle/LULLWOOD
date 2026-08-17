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
//    `chromium` project's plain default context). This is the regression this
//    ticket most needs pinned: an untouched desktop must never mount the
//    overlay, must bind desktop mode, and must never drift pitch on its own.
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
//    decision and the engine's own `mode`), which is the deeper fix FACT 2
//    actually needed.
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

    // Exact equality, not "close to": FACT 2's bug was a second listener set
    // writing player.pitch every frame, which is a continuous drift, not
    // rounding noise -- any nonzero delta here is that bug back.
    expect(pitchLater).toBe(pitchAfterLock);
  });
});

test.describe('touch-emulated desktop context (hasTouch: true)', () => {
  test.use({ hasTouch: true });

  test('is classified mobile consistently everywhere (no split-brain), and pitch does not drift with zero stick input', async ({
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

    const pitchAfterEnter = (await page.evaluate(() => window.ForestEngine?.qaPlayerState?.()))?.pitch;
    await page.waitForTimeout(500); // zero stick input in between
    const pitchLater = (await page.evaluate(() => window.ForestEngine?.qaPlayerState?.()))?.pitch;

    expect(pitchLater).toBe(pitchAfterEnter);
  });
});
