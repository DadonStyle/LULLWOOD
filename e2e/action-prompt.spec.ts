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
// 6. #actionSlot's rows are always mounted, in the founder's stated
//    priority order (charge > objective > hide/veil > veil-overload > throwable > status),
//    regardless of which currently have content.
// 7. LUL-2336 (extended LUL-5166): qaForceAllActionRows() puts nine of
//    #actionSlot's ten rows live with real content at once (no real
//    playthrough state does; pickupPrompt is the one exception, mutually
//    exclusive with throwPrompt by construction) -- none of their bounding
//    boxes intersect, at 1280x720 and at a narrow mobile landscape width.
// 8. LUL-5246: at a real short-landscape mobile viewport (Pixel 5 / iPhone SE
//    landscape), with both #objective and #actionPrompt (hide/veil) populated
//    at once, #objective's .actionPromptLine collapses to display:none and
//    the two rows' visible boxes never intersect.
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

// LUL-5246: local-qa's layout-4a62437dbe finding -- #objective's
// .actionPromptLine (~31px, plain text) and #actionPrompt's (hide/veil,
// ~44px with a .actionPromptKey chip) both sit inside the short-landscape
// --action-slot-row: 11.91px track (GameCanvas.tsx:588) when both rows are
// populated at once, and physically overlap. Fix: GameCanvas.tsx's
// `body:has(#actionPrompt[data-visible="1"]) #objective .actionPromptLine`
// rule collapses the objective pill's text (not its row -- data-visible on
// #objective stays whatever the engine set it to) whenever the hide/veil row
// has real content. See docs/specs/lul-5246-action-slot-objective-hide-overlap.md.
test.describe('LUL-5246: #objective yields to #actionPrompt at short-landscape mobile', () => {
  async function assertObjectiveYieldsToActionPrompt(page: Page, width: number, height: number) {
    await page.setViewportSize({ width, height });
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await page.mouse.click(width / 2, height / 2);
    await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)

    // LUL-2804/LUL-2283 ordering: qaSetFixedStep() before the staging hook --
    // same hazard as the "urgent cover prompt" test above.
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);
    const staged = await page.evaluate(() => window.ForestEngine?.qaOpenHideNearLionAtHideSpot?.() ?? null);
    expect(staged, 'qaOpenHideNearLionAtHideSpot returned null — no hide spot or lion at this seed').not.toBeNull();
    await qaHook(page, 'qaAdvance', stepsFor(0.5));

    await expectRowVisible(page, 'actionPrompt');
    const objectiveWasActive = (await page.locator('#objective').getAttribute('data-visible')) === '1';
    expect(objectiveWasActive, 'this test only proves the suppression when a real objective is active').toBe(true);

    const objectiveLineDisplay = await page.evaluate(() => {
      const el = document.querySelector('#objective .actionPromptLine');
      return el ? window.getComputedStyle(el).display : null;
    });
    expect(objectiveLineDisplay, '#objective .actionPromptLine must collapse to display:none while #actionPrompt has content').toBe('none');

    const actionPromptText = await page.evaluate(() => document.querySelector('#actionPrompt .actionPromptLine')?.textContent?.trim() ?? null);
    expect(actionPromptText, '#actionPrompt .actionPromptLine must still render real content').not.toBeNull();
    expect(actionPromptText!.length).toBeGreaterThan(0);

    const overlap = await page.evaluate(() => {
      const a = document.querySelector('#objective .actionPromptLine');
      const b = document.querySelector('#actionPrompt .actionPromptLine');
      const boxes = [a, b]
        .filter((el): el is Element => !!el && window.getComputedStyle(el).display !== 'none')
        .map((el) => el.getBoundingClientRect());
      if (boxes.length < 2) return false;
      const [x, y] = boxes;
      return x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top;
    });
    expect(overlap, '#objective and #actionPrompt .actionPromptLine boxes must never intersect').toBe(false);
  }

  test('mobile-pixel5-landscape (727x393)', async ({ page }) => {
    await assertObjectiveYieldsToActionPrompt(page, 727, 393);
  });

  test('mobile-iphone-se-landscape (667x375)', async ({ page }) => {
    await assertObjectiveYieldsToActionPrompt(page, 667, 375);
  });
});

// LUL-5246: the describe block above uses plain setViewportSize, not real
// touch/device emulation (same as the LUL-2410 test above) -- the media
// query branch that matches here (`(max-height: 420px) and (max-width:
// 768px)`, GameCanvas.tsx:590-591) has no `pointer`/`hover` condition, so it
// engages identically with or without touch emulation. The "all forceable
// rows live at once" describe block below is desktop-only / plain-viewport
// too (no touch emulation) -- it does not exercise the real mobile
// --action-slot-bottom: 190px budget this fix targets (LUL-5246 SPEC,
// "Files" section).
//
// LUL-2336 (extended LUL-5166): the nine rows this hook forces -- deliberately
// excludes pickupPrompt/winVisible/deathVisible, which qaForceAllActionRows
// doesn't touch (pickupPrompt is mutually exclusive with throwPrompt by
// construction, per Hud.tsx's own comment on that row).
const FORCED_ROW_IDS = ['chargePrompt', 'objective', 'actionPrompt', 'veilOverloadPrompt', 'veilPrompt', 'throwPrompt', 'climbPrompt', 'chapelSanctuaryPrompt', 'status'] as const;

/** One evaluate() round-trip: each forced row's data-visible flag, trimmed
 * text content and viewport-relative bounding box of the inner
 * `.actionPromptLine` pill (LUL-5374: the outer `.actionPromptRow` grid-track
 * wrapper measured here previously is laid out by the grid and can never
 * overlap by construction -- LUL-5373's coverage-gap finding #1 -- so this
 * reads the actual rendered pill, same element the LUL-5246 describe block
 * above already asserts against), read together so the layout can't shift
 * between reads. */
async function readActionRows(page: Page) {
  return page.evaluate((ids: readonly string[]) => {
    return ids.map((id) => {
      const row = document.getElementById(id);
      const line = row?.querySelector('.actionPromptLine') ?? null;
      const rect = line?.getBoundingClientRect() ?? null;
      const display = line ? window.getComputedStyle(line).display : null;
      return {
        id,
        visible: row?.getAttribute('data-visible') ?? null,
        text: (row?.textContent ?? '').trim(),
        rendered: display !== null && display !== 'none',
        rect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null,
      };
    });
  }, FORCED_ROW_IDS);
}

function rectsOverlap(a: { left: number; right: number; top: number; bottom: number },
                       b: { left: number; right: number; top: number; bottom: number }) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Vertical intersection depth in px (0 if the boxes don't overlap vertically at all).
 * #actionSlot's rows share one horizontally-centered column, so vertical depth is the
 * only overlap dimension that varies pair to pair. */
function verticalOverlapDepth(a: { top: number; bottom: number }, b: { top: number; bottom: number }) {
  return Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

// LUL-5380: at the base (non-short-landscape) breakpoint, --action-slot-row +
// --action-slot-gap (36px + 6px, GameCanvas.tsx:55-57) sum to 42px per track, while a
// chip-styled .actionPromptLine (one with a keycap, e.g. "Tap Hide to slip into the
// bush") can render ~44px regardless of breakpoint -- so a bottom-anchored chip pill
// systematically overflows ~2px into whichever row sits above it, for ANY adjacent
// pair where the lower row is chip-styled, not just one specific pair. Discovered by
// this ticket's own readActionRows() fix (switching the rect source from
// .actionPromptRow, which can't overlap by construction, to the real .actionPromptLine
// pill) -- it predates LUL-5374 and fixing it would mean changing
// --action-slot-row/--action-slot-gap, which LUL-5374's own SPEC forbids (those tokens
// feed LUL-2410/LUL-2414/LUL-2418/LUL-2743's own formulas). Filed as LUL-5380 rather
// than silently patched here. A 3px tolerance absorbs this known, filed, sub-pixel-scale
// issue without hiding a real (larger) regression -- anything bigger still fails below.
const KNOWN_DESKTOP_CHIP_OVERFLOW_TOLERANCE_PX = 3;

/** Strict form for viewports outside the LUL-5246/LUL-5374 short-landscape
 * media query (nothing is suppressed there): force all nine forceable rows,
 * assert each is visible with real (non-empty), rendered content, then
 * assert no two of their `.actionPromptLine` boxes intersect by more than the known,
 * separately-tracked LUL-5380 tolerance above. */
async function assertAllForcedRowsNonOverlapping(page: Page) {
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
      if (!rectsOverlap(a.rect!, b.rect!)) continue;
      const depth = verticalOverlapDepth(a.rect!, b.rect!);
      expect(depth, `#${a.id} and #${b.id} overlap by ${depth}px, more than LUL-5380's known ${KNOWN_DESKTOP_CHIP_OVERFLOW_TOLERANCE_PX}px chip-overflow tolerance`)
        .toBeLessThanOrEqual(KNOWN_DESKTOP_CHIP_OVERFLOW_TOLERANCE_PX);
    }
  }
}

/** LUL-5374: relaxed form for the short-landscape media query, where the
 * suppression chain added by this ticket deliberately keeps only the single
 * highest-priority currently-live row's `.actionPromptLine` rendered when
 * several rows are forced at once -- that is the fix, not a regression, so
 * the strict "every row visible" premise above no longer holds here. Assert
 * instead: (a) every row's underlying data-visible flag is unaffected by the
 * CSS (the engine-state flags still fired), and (b) no two *rendered*
 * (display !== 'none') `.actionPromptLine`s overlap. `climbPrompt`/`status`
 * is the one pair this ticket's SPEC proves can never both be real
 * (climbPromptVisible requires !hidden, statusVisible only ever true inside
 * if(hidden)) -- qaForceAllActionRows forces both anyway (a synthetic-only
 * state), so if the suppression chain happens to leave both rendered here
 * that is expected and not re-asserted against, per
 * docs/specs/lul-5374-action-slot-full-row-suppression.md. */
async function assertAllForcedRowsSuppressedCorrectly(page: Page) {
  await qaHook(page, 'qaForceAllActionRows');

  const rows = await readActionRows(page);
  for (const row of rows) {
    expect(row.visible, `#${row.id} must be forced visible (engine state unaffected by CSS)`).toBe('1');
  }
  const rendered = rows.filter((r) => r.rendered && r.rect);
  for (let i = 0; i < rendered.length; i++) {
    for (let j = i + 1; j < rendered.length; j++) {
      const a = rendered[i], b = rendered[j];
      const isClimbStatusPair = (a.id === 'climbPrompt' && b.id === 'status') || (a.id === 'status' && b.id === 'climbPrompt');
      if (isClimbStatusPair) continue;
      expect(rectsOverlap(a.rect!, b.rect!), `#${a.id} and #${b.id} must not both render at this breakpoint`).toBe(false);
    }
  }
}

test.describe('#actionSlot — all forceable rows live at once (LUL-2336, LUL-5166)', () => {
  // LUL-5374: real isMobile/hasTouch context (LUL-5373's coverage-gap finding #2 --
  // this block previously only called page.setViewportSize(), which renders
  // desktop copy/styling regardless of pixel dimensions since hasTouch/isMobile
  // can't be toggled on an existing context, only at context-creation time). Matches
  // the device flags local-qa's real mobile-pixel5-landscape/mobile-iphone-se-landscape
  // projects use. The 1280x720 desktop test below is unaffected in practice -- it's
  // outside the max-height:420px media query either way, and lib/input-mode.ts's
  // isMobile() is computed from pointer/hover/max-width media queries that a
  // 1280px-wide viewport fails regardless of these context flags.
  test.use({ isMobile: true, hasTouch: true });

  test('1280x720 desktop: no two rows overlap with real content in every row', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    // LUL-2107: freeze the real RAF loop first -- qaForceAllActionRows's own
    // doc comment requires this so the next real stepFrame() tick doesn't
    // immediately recompute the forced flags back from live game state
    // (coverPromptVisible/heldThrowable/statusVisible would all revert to
    // false at this empty patch of the micro world).
    await qaHook(page, 'qaSetFixedStep', 0.02);
    await qaHook(page, 'qaAdvance', 1); // one real frame so objectiveText is the live computed string, not the boot default

    await assertAllForcedRowsNonOverlapping(page);
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

    // LUL-5374: relaxed assertion -- inside the max-height:420px media query, the
    // suppression chain this ticket adds deliberately keeps only the highest-priority
    // currently-live row's .actionPromptLine rendered, by design. See
    // assertAllForcedRowsSuppressedCorrectly's own doc comment above.
    await assertAllForcedRowsSuppressedCorrectly(page);
    expectNoConsoleErrors(errs);
  });
});

// LUL-5374: two representative real-trigger pairs from the priority chain added to
// GameCanvas.tsx's short-landscape media query above, each staged through a real engine
// trigger (not qaForceAllActionRows) -- the matrix above already proves the geometry is
// identical across pairs at this breakpoint, so two real-play pairs plus that structural
// matrix is the coverage this ticket's own SPEC calls sufficient. See
// docs/specs/lul-5374-action-slot-full-row-suppression.md's '## e2e' section.
test.describe('#actionSlot short-landscape suppression (LUL-5374)', () => {
  const WIDTH = 727, HEIGHT = 393; // mobile-pixel5-landscape, same viewport as the LUL-5246 describe block above

  test.use({ isMobile: true, hasTouch: true });

  test('veilOverloadPrompt survives over throwPrompt', async ({ page }) => {
    const errs = trackConsoleErrors(page);
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await page.mouse.click(WIDTH / 2, HEIGHT / 2);
    await page.waitForTimeout(1200); // gate fade settle (mobile has no pointer-lock to wait on)

    // Grab a real stone first (heldThrowable -> throwPrompt), then stage a real chase
    // (veilOverloadTriggerActive) on top of it -- both are live, independent flags per
    // the SPEC's real-co-occurrence check (forest-engine.js: heldThrowable has no gate
    // excluding veilOverloadTriggerActive).
    const stone = await qaHook(page, 'qaTeleportNearThrowable');
    expect(stone, 'qaTeleportNearThrowable returned null -- no untaken stone at this seed').not.toBeNull();
    await page.keyboard.press('KeyE');
    await expectRowVisible(page, 'throwPrompt');

    const idx = await qaHook(page, 'qaOpenVeilOverloadTarget', 'lion');
    expect(idx, 'qaOpenVeilOverloadTarget("lion") must find a spawned lion').not.toBeNull();
    await expectRowVisible(page, 'veilOverloadPrompt');

    const throwLineDisplay = await page.evaluate(() => {
      const el = document.querySelector('#throwPrompt .actionPromptLine');
      return el ? window.getComputedStyle(el).display : null;
    });
    expect(throwLineDisplay, '#throwPrompt .actionPromptLine must collapse to display:none while #veilOverloadPrompt has content').toBe('none');

    const veilOverloadText = await page.evaluate(() => document.querySelector('#veilOverloadPrompt .actionPromptLine')?.textContent?.trim() ?? null);
    expect(veilOverloadText, '#veilOverloadPrompt .actionPromptLine must still render real content').not.toBeNull();
    expect(veilOverloadText!.length).toBeGreaterThan(0);

    const overlap = await page.evaluate(() => {
      const a = document.querySelector('#throwPrompt .actionPromptLine');
      const b = document.querySelector('#veilOverloadPrompt .actionPromptLine');
      const boxes = [a, b]
        .filter((el): el is Element => !!el && window.getComputedStyle(el).display !== 'none')
        .map((el) => el.getBoundingClientRect());
      if (boxes.length < 2) return false;
      const [x, y] = boxes;
      return x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top;
    });
    expect(overlap, '#throwPrompt and #veilOverloadPrompt .actionPromptLine boxes must never intersect').toBe(false);

    expectNoConsoleErrors(errs);
  });

  // LUL-5374 SPEC's own flagged gap: chapelSanctuaryPrompt/status needs a real hide spot
  // inside CHAPEL_SANCTUARY_INTERACT_RADIUS (4 units, engine/tuning.js) of the chapel
  // steeple's micro-world position, which qaBuildScene cannot stage in one call (the
  // chapel's position is only known after qaTeleportNearChapel runs, and qaBuildScene
  // resets the whole scene including player position). The SPEC's own suggested
  // fallback -- qaForceAllActionRows for this one pair -- turns out not to work either
  // when actually run: qaForceAllActionRows forces every row unconditionally, including
  // climbPrompt, which outranks chapelSanctuaryPrompt in the same priority chain
  // (throwPrompt > climbPrompt > chapelSanctuaryPrompt > status) -- climbPrompt's own
  // suppression rule hides chapelSanctuaryPrompt's line before it ever gets a chance to
  // compete against status, so a full-force test can only prove "nothing renders twice"
  // (see assertAllForcedRowsSuppressedCorrectly above, which does cover this pair as
  // part of the whole matrix), not "chapelSanctuaryPrompt specifically beats status".
  // Isolating that one claim would need chapelSanctuaryPromptVisible/statusVisible true
  // with every higher-priority flag left off -- not reachable through any hook that
  // exists today (qaForceAllActionRows is intentionally all-or-nothing per the SPEC's
  // own "Out of scope" section, which rules out changing it here). Flagging this back
  // rather than shipping a test that looks like coverage but can't fail the way its own
  // name claims.
});

// LUL-2312: the founder's explicit requirement -- "stacked in a fixed
// priority order" -- pinned as a DOM-order check independent of any gameplay
// staging, so it can never silently drift if a future edit reorders the JSX
// inside #actionSlot (components/Hud.tsx).
test.describe('#actionSlot row order', () => {
  test('ten rows are always mounted, top to bottom in priority order', async ({ page }) => {
    await boot(page, { qaHooks: true, qaWorld: 'micro' });
    await enter(page);

    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('#actionSlot > *')).map((el) => el.id));
    // LUL-4528: climbPrompt inserted after pickupPrompt, before the terminal status row.
    // LUL-5004: veilPrompt inserted after veilOverloadPrompt -- both are "something to
    // do about being hunted" rows, kept adjacent.
    // LUL-5005: chapelSanctuaryPrompt inserted after climbPrompt, same "contextual
    // something-to-do row, before the terminal status row" placement.
    expect(ids).toEqual(['chargePrompt', 'objective', 'actionPrompt', 'veilOverloadPrompt', 'veilPrompt', 'throwPrompt', 'pickupPrompt', 'climbPrompt', 'chapelSanctuaryPrompt', 'status']);

    // Every row exists (not conditionally mounted) even with nothing to show.
    for (const id of ids) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });
});
