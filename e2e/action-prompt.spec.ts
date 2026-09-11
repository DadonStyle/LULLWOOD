// LUL-2312 (absorbs LUL-1089's coverage + the stranded LUL-1778/1779/1780
// nightly failures): #actionPrompt is now one row (data-tone-driven, not
// class-driven) inside the single always-mounted #actionSlot grid --
// components/ActionPrompt.tsx / components/Hud.tsx / components/GameCanvas.tsx.
// Every row toggles `data-visible="0"|"1"` on the (never-unmounted) element
// instead of mounting/unmounting; `.urgent` became `data-tone="urgent"`;
// `#actionKey`/`#chargeKey`/`#throwKey` collapsed onto the shared
// `.actionPromptKey` class scoped per-row.
//
// Assertions:
// 1. Walk to a known bush → #actionPrompt is shown with the desktop-bramble calm string.
// 2. Stage a chase within COVER_URGENT_RANGE → #actionPrompt carries data-tone="urgent".
// 3. Cover and veil conditions both true → only cover string renders (precedence).
// 4. At a landscape mobile viewport, #actionPrompt's bounding box does not intersect
//    the mobile control root, and its scrollWidth <= clientWidth (no nowrap overflow).
// 5. With prefers-reduced-motion emulated, computed animation-name on the row's
//    .actionPromptKey is 'none'.
// 6. #actionSlot's five rows are always mounted, in the founder's stated
//    priority order (charge > objective > hide/veil > throwable > status),
//    regardless of which currently have content.
import { test, expect } from '@playwright/test';
import { boot, enter, trackConsoleErrors, expectNoConsoleErrors, qaHook, expectRowVisible, expectRowHidden } from './helpers';

// LUL-2107: the 3 cases below that stage a chasing predator (urgent
// cover-prompt class, the 390px nowrap/mobile-collision check, and reduced
// motion) drive the throttled cover probe (COVER_PROBE_HZ, engine/forest-
// engine.js ~4710) via qaSetFixedStep/qaAdvance instead of a real-wall-clock
// page.waitForTimeout -- that wait only reliably crossed the probe's 1/6s
// hand-accumulated `coverProbeAccum += dt` threshold (dilated at low FPS, see
// wiki systems/dt-clamp-vs-walltime) under swiftshader's incidental frame
// cadence, which real GPU rendering (LUL-1910) no longer guarantees. The
// calm-cover-prompt and cover-wins-over-veil cases above are not in this
// ticket's listed scope and stay on the real RAF loop.
const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

test.describe('#actionSlot — hide and veil contextual prompt row', () => {
  test('calm cover prompt: shown at a bramble bush', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // LUL-2329: build the exact bramble this test needs instead of relying on
    // the micro preset's own random cover generation -- no predator is used
    // anywhere in this test, so qaBuildScene's inert-every-unlisted-predator
    // side effect (see docs/specs/lul-2329-e2e-migrate-qaworld-micro.md) is a
    // no-op here.
    await qaHook(page, 'qaBuildScene', { props: [{ kind: 'bramble', x: 10, z: 0 }] });
    const kind = await page.evaluate(() => window.ForestEngine?.qaTeleportToHideSpot?.() ?? null);
    expect(kind, 'qaTeleportToHideSpot returned null — no hide spot at this seed').not.toBeNull();

    // Wait for the throttled 6Hz probe to fire (≤ 170ms)
    await page.waitForTimeout(250);

    await expectRowVisible(page, 'actionPrompt');
    const prompt = page.locator('#actionPrompt');

    const text = await prompt.textContent();
    // Should contain the desktop calm bramble string -- bramble is the only
    // hide-eligible cover kind since LUL-2311, so `kind` can only be 'bramble'.
    const noun = 'bush';
    // Desktop calm: "Press  H  to hide in the bush"
    expect(text, 'Calm prompt must name the noun and contain key H').toMatch(new RegExp(`H.*to hide in the ${noun}|to hide in the ${noun}`));

    // #actionPrompt must NOT carry tone="urgent" at this point (no chasing predator)
    await expect(prompt).not.toHaveAttribute('data-tone', 'urgent');

    expectNoConsoleErrors(errs);
  });

  // LUL-2311: log is walkable, LOS-blocking cover, but no longer hide-eligible
  // -- pressing H beside one must be a no-op, and #actionPrompt must never
  // show a "to hide in the ..." string for it.
  test('KeyH beside a log is a no-op -- log is no longer hide-eligible', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true });
    await enter(page);

    const kind = await page.evaluate(() => window.ForestEngine?.qaTeleportNearCoverKind?.('log') ?? null);
    expect(kind, 'qaTeleportNearCoverKind(\'log\') returned null — no log at this seed').toBe('log');

    await page.waitForTimeout(250); // let the throttled cover probe run, same as the calm-prompt case above

    await expectRowHidden(page, 'actionPrompt');

    await page.keyboard.press('KeyH');
    await page.waitForTimeout(100);

    const state = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
    expect(state?.hidden, 'KeyH beside a log must not enter the hidden stance').toBe(false);
    await expectRowHidden(page, 'actionPrompt');

    expectNoConsoleErrors(errs);
  });

  test('urgent cover prompt: data-tone="urgent" when predator chases within range', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // LUL-2358: qaOpenHideNearLion() (used here previously) resets player.x/z
    // to the spawn clearing to guarantee its own cover-free scenario, which
    // clobbers a prior qaTeleportToHideSpot() call -- the throttled cover
    // probe's next fire then finds no hide spot at the clearing and
    // coverPromptVisible never goes true (engine/forest-engine.js's
    // qaOpenHideNearLionAtHideSpot doc comment already flags this exact
    // composition). Worse, that combo also placed the lion only 4 units out
    // in 'chase'+hunt state -- inside its own catch range (rad+CATCH_MARGIN)
    // after ~0.18s at the lion's tuning.js speed (9.2), faster than even the
    // probe's own 1/6s period, so the player was caught and triggerDeath()
    // fired before data-tone could ever read "urgent". Use the hook built for
    // "cover + chasing, sighted lion at once, standoff far enough to not
    // catch" instead -- the same one "cover wins over veil" below relies on.
    const staged = await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLionAtHideSpot?.() ?? null);
    expect(staged, 'qaOpenHideNearLionAtHideSpot returned null — no hide spot or lion at this seed').not.toBeNull();

    // LUL-2107: park the real RAF loop and advance enough game time
    // (well over the probe's 1/6s threshold) to force the throttled cover
    // probe to fire and pushState to propagate, deterministically.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaAdvance', stepsFor(0.5));

    await expectRowVisible(page, 'actionPrompt');
    await expect(page.locator('#actionPrompt')).toHaveAttribute('data-tone', 'urgent');

    expectNoConsoleErrors(errs);
  });

  test('cover wins over veil — only cover string renders when both conditions hold', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // Place player 0.5 units outside the hide spot's AABB edge (not at center)
    // and a chasing lion LION_STANDOFF (14) units further in the same direction
    // -- both cover and veil conditions true at once, hasLOS() is unblocked by
    // the prop itself, and the lion is far enough out it can't close to catch
    // range before this test's own assertions run (LUL-2358).
    const staged = await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLionAtHideSpot?.() ?? null);
    expect(staged, 'qaOpenHideNearLionAtHideSpot returned null — no hide spot or lion at this seed').not.toBeNull();

    // Verify the premise: the lion must actually have line of sight to the player
    // right after staging. If this fails, the test's two-condition premise is broken
    // again (e.g. another cover prop blocked the sightline at this seed).
    const lionState = await page.evaluate(
      (idx: number) => window.ForestEngine?.qaPredatorState?.(idx) ?? null,
      staged!.idx
    );
    expect(lionState?.canSee, 'Staged lion must have line of sight to player (both conditions must hold)').toBe(true);

    await page.waitForTimeout(350);

    await expectRowVisible(page, 'actionPrompt');
    const text = await page.locator('#actionPrompt').textContent() ?? '';
    // Must contain 'H' (cover key), not 'F' or 'veil' (veil prompt)
    expect(text.toLowerCase(), 'Cover string must render, not veil string').not.toMatch(/for the.*veil|hold.*f|hunting you/i);
    expect(text, 'Cover key H must be present').toMatch(/H/);

    expectNoConsoleErrors(errs);
  });

  test('no nowrap overflow and no mobile-control collision (landscape mobile)', async ({ page }) => {
    // LUL-2379: this used to be a 390x844 *portrait* viewport, which two
    // things broke at once. (1) OrientationGate (components/OrientationGate.tsx,
    // LUL-69) blocks all portrait mobile viewports behind a full-screen
    // "rotate your device" overlay -- on a real phone this exact shape never
    // reaches gameplay at all, so the test's own premise was untestable.
    // (2) enter() clicks the hardcoded 1280x720 desktop centre (helpers.ts
    // VIEW_X/VIEW_Y), which lands outside a 390-wide page entirely, so the
    // entry gate never registered either. Use the same 727x393 landscape
    // size (clears OrientationGate) and viewport-relative entry click every
    // other mobile spec uses (e.g. e2e/mobile/hide.spec.ts) instead.
    await page.setViewportSize({ width: 727, height: 393 });
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await page.mouse.click(727 / 2, 393 / 2);
    await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)

    // LUL-2358: qaOpenHideNearLionAtHideSpot() stages cover + a chasing,
    // sighted lion together -- see the comment on the "urgent cover prompt"
    // test above for why qaTeleportToHideSpot()+qaOpenHideNearLion() (used
    // here previously) never reaches data-tone="urgent".
    await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLionAtHideSpot?.());
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaAdvance', stepsFor(0.5));

    await expectRowVisible(page, 'actionPrompt');

    // 1. No nowrap overflow
    const overflow = await page.evaluate(() => {
      const el = document.getElementById('actionPrompt');
      if (!el) return null;
      return el.scrollWidth > el.clientWidth;
    });
    expect(overflow, '#actionPrompt must not overflow (nowrap budget)').toBe(false);

    // 2. No collision with mobile controls
    const collision = await page.evaluate(() => {
      const prompt = document.getElementById('actionPrompt');
      // The mobile control root is the first child of the controls container — check against
      // MobileControls.tsx's fixed-position root (z-index 30, bottom: 24px + safe-area)
      // We look for the element with z-index 30 that covers the bottom area.
      const controls = document.querySelector('[style*="z-index: 30"]') ??
                       document.querySelector('[class*="controls"]');
      if (!prompt) return null;
      const pb = prompt.getBoundingClientRect();
      if (!controls) return false; // no controls rendered (desktop mode), not a collision
      const cb = controls.getBoundingClientRect();
      // Overlaps if neither is fully above/below the other
      return pb.bottom > cb.top && pb.top < cb.bottom;
    });
    expect(collision, '#actionPrompt must not overlap mobile control row').toBe(false);
  });

  test('reduced motion: animation-name is none on the urgent row\'s keycap when media query emulated', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // LUL-2358: see the comment on the "urgent cover prompt" test above for
    // why qaTeleportToHideSpot()+qaOpenHideNearLion() (used here previously)
    // never reaches data-tone="urgent".
    await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLionAtHideSpot?.());
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await qaHook(page, 'qaAdvance', stepsFor(0.5));

    await expectRowVisible(page, 'actionPrompt');
    await expect(page.locator('#actionPrompt')).toHaveAttribute('data-tone', 'urgent');

    const animName = await page.evaluate(() => {
      const el = document.querySelector('#actionPrompt .actionPromptKey');
      if (!el) return null;
      return window.getComputedStyle(el).animationName;
    });
    expect(animName, 'urgentFlash animation must be suppressed under reduced motion').toBe('none');

    expectNoConsoleErrors(errs);
  });
});

// LUL-2312: the founder's explicit requirement -- "stacked in a fixed
// priority order" -- pinned as a DOM-order check independent of any gameplay
// staging, so it can never silently drift if a future edit reorders the JSX
// inside #actionSlot (components/Hud.tsx).
test.describe('#actionSlot row order', () => {
  test('five rows are always mounted, top to bottom in priority order', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('#actionSlot > *')).map((el) => el.id));
    expect(ids).toEqual(['chargePrompt', 'objective', 'actionPrompt', 'throwPrompt', 'status']);

    // Every row exists (not conditionally mounted) even with nothing to show.
    for (const id of ids) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });
});
