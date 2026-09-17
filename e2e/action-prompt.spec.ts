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
// 7. LUL-2336: qaForceAllActionRows() puts all five rows live with real
//    content at once (no real playthrough state does) -- none of their
//    bounding boxes intersect, at 1280x720 and at a narrow mobile landscape
//    width.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { boot, enter, trackConsoleErrors, expectNoConsoleErrors, qaHook, expectRowVisible, expectRowHidden } from './helpers';

// LUL-2107: the cases below that stage a chasing predator (urgent
// cover-prompt class, the 390px nowrap/mobile-collision check, and reduced
// motion) drive the throttled cover probe (COVER_PROBE_HZ, engine/forest-
// engine.js ~4710) via qaSetFixedStep/qaAdvance instead of a real-wall-clock
// page.waitForTimeout -- that wait only reliably crossed the probe's 1/6s
// hand-accumulated `coverProbeAccum += dt` threshold (dilated at low FPS, see
// wiki systems/dt-clamp-vs-walltime) under swiftshader's incidental frame
// cadence, which real GPU rendering (LUL-1910) no longer guarantees.
// LUL-2804: "cover wins over veil" below joined that group (it also stages a
// chase) -- migrated off its 350ms page.waitForTimeout, same reasons. The
// calm-cover-prompt case does not stage a predator at all, so it stays on the
// real RAF loop with its own plain page.waitForTimeout.
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
    //
    // LUL-2804: qaSetFixedStep() must be called *before* this hook, not after
    // -- same hazard LUL-2283 already fixed for predator-determinism.spec.ts/
    // map-seed.spec.ts. qaOpenHideNearLionAtHideSpot() flips the lion into
    // 'chase'+hunt=true synchronously; as long as the real RAF loop is still
    // running (it only parks once qaSetFixedStep() cancels the pending
    // frame), every real-wall-clock frame between this call and that one
    // moves the lion at its real tuning.js speed, off LION_STANDOFF's
    // closing-time budget entirely. Locally negligible under fast GPU
    // rendering, but under CI's swiftshader path (slower frames, slower CDP
    // round trips) enough real frames land in that gap to close most of the
    // 14-unit standoff before the "controlled" 0.5s window even starts --
    // confirmed live (CI=1): pre-qaSetFixedStep distance already down to
    // ~5-7 units, ending the test's 0.5s qaAdvance with the player caught
    // and #deathScreen up, never reading data-tone="urgent". Parking first
    // makes staging itself deterministic, same as the two precedents above.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    const staged = await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLionAtHideSpot?.() ?? null);
    expect(staged, 'qaOpenHideNearLionAtHideSpot returned null — no hide spot or lion at this seed').not.toBeNull();

    // LUL-2107: advance enough game time (well over the probe's 1/6s
    // threshold) to force the throttled cover probe to fire and pushState to
    // propagate, deterministically.
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
    //
    // LUL-2804: this test was deliberately left on the real RAF loop by
    // LUL-2107 (see the top-of-file note) with a 350ms page.waitForTimeout --
    // the same wall-clock-vs-game-time gap the "urgent cover prompt" test
    // above was just fixed for (LUL-2283 pattern: qaSetFixedStep() before any
    // hook that starts a chase, not after). Under CI's swiftshader path that
    // wait is both too short (dt-clamp dilation, wiki systems/dt-clamp-vs-
    // walltime) to reliably cross the cover probe's 1/6s threshold *and*
    // exposed to the same uncontrolled real-time chase progress between
    // staging and the wait actually starting -- migrate to qaSetFixedStep/
    // qaAdvance like every neighboring case this file already uses.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
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

    await qaHook(page, 'qaAdvance', stepsFor(0.5));

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
    //
    // LUL-2804: qaSetFixedStep() before the staging hook, not after -- same
    // LUL-2283 ordering fix as the "urgent cover prompt" test above; this
    // test carries the identical live CI=1 failure otherwise.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLionAtHideSpot?.());
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

  test('LUL-2410: #hint stays hidden at a short landscape viewport, clear of #objective', async ({ page }) => {
    // Same 667x375 iPhone SE landscape shape the local QA tester flagged --
    // #actionSlot's --action-slot-bottom: 190px override (short-landscape
    // media query above) pushes its rows, including #objective, up near the
    // very top of the screen, into #hint's flat top: 64px band. See the
    // LUL-2410 comment on that media query in components/GameCanvas.tsx.
    await page.setViewportSize({ width: 667, height: 375 });
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await page.mouse.click(667 / 2, 375 / 2);
    await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock)

    // enter() sets hint.style.opacity = '0.85' synchronously -- the fix must
    // beat that inline write via !important, not just win a fade race. Check
    // display (not just opacity) so #hint's box actually collapses to
    // nothing instead of merely becoming invisible -- see the LUL-2410
    // comment in components/GameCanvas.tsx for why a geometric collapse is
    // required, not just an opacity fade.
    const display = await page.evaluate(() => {
      const el = document.getElementById('hint');
      return el ? window.getComputedStyle(el).display : null;
    });
    expect(display, '#hint must be display: none at this viewport, not merely faded').toBe('none');

    await expectRowVisible(page, 'objective');
    const collision = await page.evaluate(() => {
      const hint = document.getElementById('hint');
      const objective = document.getElementById('objective');
      if (!hint || !objective) return null;
      const hb = hint.getBoundingClientRect();
      const ob = objective.getBoundingClientRect();
      return hb.left < ob.right && hb.right > ob.left && hb.top < ob.bottom && hb.bottom > ob.top;
    });
    expect(collision, '#hint must not overlap #objective').toBe(false);
  });

  test('reduced motion: animation-name is none on the urgent row\'s keycap when media query emulated', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // LUL-2358: see the comment on the "urgent cover prompt" test above for
    // why qaTeleportToHideSpot()+qaOpenHideNearLion() (used here previously)
    // never reaches data-tone="urgent".
    //
    // LUL-2804: qaSetFixedStep() before the staging hook, not after -- same
    // LUL-2283 ordering fix as the "urgent cover prompt" test above; this
    // test carries the identical live CI=1 failure otherwise.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLionAtHideSpot?.());
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

// LUL-2336: the five rows this hook forces -- deliberately excludes
// pickupPrompt/winVisible/deathVisible, which qaForceAllActionRows doesn't
// touch (pickupPrompt is mutually exclusive with throwPrompt by
// construction, per Hud.tsx's own comment on that row).
const FORCED_ROW_IDS = ['chargePrompt', 'objective', 'actionPrompt', 'throwPrompt', 'status'] as const;

/** One evaluate() round-trip: each forced row's data-visible flag, trimmed
 * text content and viewport-relative bounding box, read together so the
 * layout can't shift between reads. */
async function readActionRows(page: Page) {
  return page.evaluate((ids: readonly string[]) => {
    return ids.map((id) => {
      const el = document.getElementById(id);
      const rect = el?.getBoundingClientRect() ?? null;
      return {
        id,
        visible: el?.getAttribute('data-visible') ?? null,
        text: (el?.textContent ?? '').trim(),
        rect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null,
      };
    });
  }, FORCED_ROW_IDS);
}

function rectsOverlap(a: { left: number; right: number; top: number; bottom: number },
                       b: { left: number; right: number; top: number; bottom: number }) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Shared body for both viewport sizes below: force all five rows, assert
 * each is visible with real (non-empty) content, then assert no two of
 * their boxes intersect. */
async function assertAllFiveRowsNonOverlapping(page: Page) {
  await qaHook(page, 'qaForceAllActionRows');

  const rows = await readActionRows(page);
  for (const row of rows) {
    expect(row.visible, `#${row.id} must be forced visible`).toBe('1');
    expect(row.rect, `#${row.id} must be mounted with a real box`).not.toBeNull();
    expect(row.text.length, `#${row.id} must render real (non-empty) content, not an empty pill`).toBeGreaterThan(0);
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      expect(rectsOverlap(a.rect!, b.rect!), `#${a.id} and #${b.id} must not overlap when all five rows are live`).toBe(false);
    }
  }
}

test.describe('#actionSlot — all five rows forced live at once (LUL-2336)', () => {
  test('1280x720 desktop: no two rows overlap with real content in every row', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // LUL-2107: freeze the real RAF loop first -- qaForceAllActionRows's own
    // doc comment requires this so the next real stepFrame() tick doesn't
    // immediately recompute the five flags back from live game state
    // (coverPromptVisible/heldThrowable/statusVisible would all revert to
    // false at this empty patch of the micro world).
    await qaHook(page, 'qaSetFixedStep', 0.02);
    await qaHook(page, 'qaAdvance', 1); // one real frame so objectiveText is the live computed string, not the boot default

    await assertAllFiveRowsNonOverlapping(page);
    expectNoConsoleErrors(errs);
  });

  test('narrow mobile landscape (844x390): no two rows overlap with real content in every row', async ({ page }) => {
    // LUL-2410/LUL-2379 precedent in this file: OrientationGate
    // (components/OrientationGate.tsx) blocks all portrait viewports at or
    // under the isMobile() max-width:768px breakpoint, so "390px" here means
    // the standard iPhone 12/13 mini *portrait* width (390) rotated into its
    // landscape shape (844x390) -- same convention as this file's existing
    // "Pixel 5 landscape, 851x393" / "iPhone SE landscape, 667x375" cases.
    await page.setViewportSize({ width: 844, height: 390 });
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await page.mouse.click(844 / 2, 390 / 2);
    await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)

    await qaHook(page, 'qaSetFixedStep', 0.02);
    await qaHook(page, 'qaAdvance', 1);

    await assertAllFiveRowsNonOverlapping(page);
    expectNoConsoleErrors(errs);
  });
});

// LUL-2312: the founder's explicit requirement -- "stacked in a fixed
// priority order" -- pinned as a DOM-order check independent of any gameplay
// staging, so it can never silently drift if a future edit reorders the JSX
// inside #actionSlot (components/Hud.tsx).
test.describe('#actionSlot row order', () => {
  test('six rows are always mounted, top to bottom in priority order', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('#actionSlot > *')).map((el) => el.id));
    expect(ids).toEqual(['chargePrompt', 'objective', 'actionPrompt', 'throwPrompt', 'pickupPrompt', 'status']);

    // Every row exists (not conditionally mounted) even with nothing to show.
    for (const id of ids) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });
});
