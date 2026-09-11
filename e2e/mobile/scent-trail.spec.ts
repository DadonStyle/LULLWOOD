// LUL-2230 (LUL-2224 item 2) mobile half -- see ../scent-trail.spec.ts for the
// desktop spec and the full writeup. Movement is driven through the real left
// stick (same dispatched-PointerEvents pattern as ../mobile/input-mode.spec.ts,
// since page.mouse under this rig's touch-emulated context reports
// clientX/clientY as 0 -- measured there, not re-derived here), then advanced
// deterministically via qaSetFixedStep/qaAdvance: `touchMove` is a persistent
// module-level object the engine reads every stepFrame() regardless of
// whether the frame came from the real RAF loop or qaAdvance(), so holding
// the stick and fast-forwarding game time compose the same way KeyW + qaAdvance
// does on desktop. Look direction uses qaSetLookYaw directly (the ticket's own
// choice) rather than dragging the right stick, since the caption/frustum
// check only cares about the resulting yaw, not how a real thumb would get there.
import { test, expect, type Page } from '@playwright/test';
import { boot, qaHook } from '../helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

async function enterMobile(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (no pointer-lock on mobile)
}

async function openSettings(page: Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
}

const closeSettings = (page: Page) =>
  page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());

async function assertNoOverlap(page: Page, selA: string, selB: string) {
  const locA = page.locator(selA), locB = page.locator(selB);
  if ((await locA.count()) === 0 || (await locB.count()) === 0) return;
  const a = await locA.boundingBox();
  const b = await locB.boundingBox();
  if (!a || !b) return;
  const overlaps =
    a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
  expect(overlaps, `${selA} (${JSON.stringify(a)}) must not overlap ${selB} (${JSON.stringify(b)})`).toBe(false);
}

/** Push the left stick forward and hold it there for `seconds` of game time. */
async function walkForward(page: Page, seconds: number) {
  const stick = page.getByTestId('leftStick');
  await expect(stick).toBeVisible();
  const box = await stick.boundingBox();
  if (!box) throw new Error('leftStick has no bounding box');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const pointerOpts = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };
  await stick.dispatchEvent('pointerdown', { ...pointerOpts, clientX: cx, clientY: cy });
  await stick.dispatchEvent('pointermove', { ...pointerOpts, clientX: cx, clientY: cy - 30 }); // up = forward (LUL-275)
  await qaHook(page, 'qaAdvance', stepsFor(seconds));
  await stick.dispatchEvent('pointerup', { ...pointerOpts, clientX: cx, clientY: cy - 30 });
}

const VIEWPORTS = [
  { name: 'Pixel 5 landscape', width: 851, height: 393 },
  { name: 'iPhone SE landscape', width: 667, height: 375 },
];

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('the scent trail renders, fades with age, and the one-time caption appears clear of the touch controls', async ({ page }) => {
      await boot(page, { qaHooks: true });
      await enterMobile(page);
      await qaHook(page, 'qaSetFixedStep', FIXED_DT);

      await walkForward(page, 2.5);

      const probe = await qaHook(page, 'qaProbeScentTrail');
      expect(probe.settingOn).toBe(true);
      expect(probe.rendered).toBe(true);
      expect(probe.points.length).toBeGreaterThanOrEqual(3);
      expect(probe.points.length).toBeLessThanOrEqual(probe.livePoints);
      const byAge = [...probe.points].sort((a: { age: number }, b: { age: number }) => a.age - b.age);
      for (let i = 1; i < byAge.length; i++) {
        expect(byAge[i].alpha).toBeLessThanOrEqual(byAge[i - 1].alpha + 1e-6);
      }

      const { yaw } = await qaHook(page, 'qaProbePlayer');
      await qaHook(page, 'qaSetLookYaw', yaw + Math.PI);
      await qaHook(page, 'qaAdvance', stepsFor(0.1));

      const turned = await qaHook(page, 'qaProbeScentTrail');
      expect(turned.points.some((p: { inFrustum: boolean }) => p.inFrustum)).toBe(true);
      expect(turned.captionVisible).toBe(true);

      const caption = page.locator('#scentTrailCaption');
      await expect(caption).toBeVisible();
      await expect(caption).toContainText('this is your scent trail — predators follow it');
      await assertNoOverlap(page, '#scentTrailCaption', '[data-testid=touchHide]');
      await assertNoOverlap(page, '#scentTrailCaption', '[data-testid=touchVeil]');
      await assertNoOverlap(page, '#scentTrailCaption', '[data-testid=touchJump]');
      await assertNoOverlap(page, '#scentTrailCaption', '[data-testid=leftStick]');
      await assertNoOverlap(page, '#scentTrailCaption', '[data-testid=rightStick]');
      await assertNoOverlap(page, '#scentTrailCaption', '#windIndicatorHint');

      await qaHook(page, 'qaAdvance', stepsFor(8.1));
      expect((await qaHook(page, 'qaProbeScentTrail')).captionVisible).toBe(false);
      await expect(caption).toHaveCount(0);
    });

    test('the Settings checkbox is a tappable 44px target and toggles the trail', async ({ page }) => {
      await boot(page, { qaHooks: true });
      await enterMobile(page);
      await qaHook(page, 'qaSetFixedStep', FIXED_DT);
      await walkForward(page, 2.5);
      expect((await qaHook(page, 'qaProbeScentTrail')).rendered).toBe(true);

      await openSettings(page);
      const row = page.getByLabel(/show my scent trail/i).locator('xpath=ancestor::label[contains(@class,"radioRow")]');
      const box = await row.boundingBox();
      expect(box, 'the radioRow tap target must have a bounding box').not.toBeNull();
      expect(box!.height, '44px min touch target (components/GameCanvas.tsx rationale)').toBeGreaterThanOrEqual(44);

      const toggle = page.getByLabel(/show my scent trail/i);
      await expect(toggle).toBeChecked();
      await toggle.evaluate((el) => (el as HTMLInputElement).click());
      await expect(toggle).not.toBeChecked();
      await closeSettings(page);
      await qaHook(page, 'qaAdvance', stepsFor(0.1));
      expect((await qaHook(page, 'qaProbeScentTrail')).rendered).toBe(false);
    });
  });
}
