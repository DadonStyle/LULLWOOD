// LUL-2307 mobile half -- see ../hints.spec.ts for the desktop spec and the full writeup.
// Same qaSetFixedStep/qaAdvance-driven determinism; qaTeleportTo/qaSetLookYaw/qaBuildScene
// are engine hooks with no input-mode dependency, so the lake/deepwater/wolf staging is
// identical to the desktop version -- only entry (no pointer lock on mobile) and the
// Settings-row touch-target/overlap checks are mobile-specific, mirroring
// ../mobile/scent-trail.spec.ts's own split between shared engine assertions and
// mobile-only presentation ones.
import { test, expect, type Page } from '@playwright/test';
import { boot, qaHook } from '../helpers';
import { CONFIG } from '../../engine/tuning';

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

/** See ../hints.spec.ts's identical helper: drains whichever always-eligible-at-spawn
 * hint ('landmark', then 'deepwater') is active until nothing is, so a scenario further
 * down HINT_PRIORITY isn't just waiting behind one of those. */
async function clearPreemptiveHints(page: Page, maxRounds = 4) {
  for (let i = 0; i < maxRounds; i++) {
    await qaHook(page, 'qaAdvance', stepsFor(0.1));
    if (!(await qaHook(page, 'qaProbeHints')).activeKey) return;
    await qaHook(page, 'qaAdvance', stepsFor(8.2));
  }
  throw new Error(`clearPreemptiveHints: a hint was still active after ${maxRounds} rounds`);
}

const VIEWPORTS = [
  { name: 'Pixel 5 landscape', width: 851, height: 393 },
  { name: 'iPhone SE landscape', width: 667, height: 375 },
];

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('the landmark hint fires once on entry, clear of the touch controls and safe area', async ({ page }) => {
      await boot(page, { qaHooks: true });
      await enterMobile(page);
      await qaHook(page, 'qaSetFixedStep', FIXED_DT);

      await qaHook(page, 'qaAdvance', stepsFor(0.1));
      expect((await qaHook(page, 'qaProbeHints')).activeKey).toBe('landmark');

      const caption = page.locator('#hintCaption');
      await expect(caption).toBeVisible();
      await expect(caption).toContainText('landmarks in the fog are safe to navigate by');
      await assertNoOverlap(page, '#hintCaption', '[data-testid=touchHide]');
      await assertNoOverlap(page, '#hintCaption', '[data-testid=touchVeil]');
      await assertNoOverlap(page, '#hintCaption', '[data-testid=leftStick]');
      await assertNoOverlap(page, '#hintCaption', '[data-testid=rightStick]');
      await assertNoOverlap(page, '#hintCaption', '#windIndicatorHint');

      await qaHook(page, 'qaAdvance', stepsFor(8.1));
      const probe = await qaHook(page, 'qaProbeHints');
      expect(probe.activeKey).not.toBe('landmark');
      expect(probe.seen.landmark).toBe(true);
      // Not toHaveCount(0): 'deepwater' legitimately takes the slot the instant landmark's
      // own 8s window ends (../hints.spec.ts's desktop version documents why) -- #hintCaption
      // stays mounted with different content. landmark specifically being gone for good is
      // already covered by activeKey/seen.landmark above.
      await expect(caption).not.toContainText('landmarks in the fog are safe to navigate by');
    });

    test('the lake hint appears on first entry into the water, not on a second visit', async ({ page }) => {
      await boot(page, { qaHooks: true });
      await enterMobile(page);
      await qaHook(page, 'qaSetFixedStep', FIXED_DT);
      await clearPreemptiveHints(page);

      await qaHook(page, 'qaTeleportTo', CONFIG.lake.x, CONFIG.lake.z);
      await qaHook(page, 'qaAdvance', stepsFor(0.1));

      let probe = await qaHook(page, 'qaProbeHints');
      expect(probe.activeKey).toBe('lake');
      const caption = page.locator('#hintCaption');
      await expect(caption).toBeVisible();
      await expect(caption).toContainText('chest-deep water — half pace. predators wade too');
      await assertNoOverlap(page, '#hintCaption', '[data-testid=touchHide]');
      await assertNoOverlap(page, '#hintCaption', '[data-testid=touchVeil]');
      await assertNoOverlap(page, '#hintCaption', '[data-testid=leftStick]');
      await assertNoOverlap(page, '#hintCaption', '[data-testid=rightStick]');

      await qaHook(page, 'qaAdvance', stepsFor(8.1));
      probe = await qaHook(page, 'qaProbeHints');
      expect(probe.seen.lake).toBe(true);
      await expect(caption).toHaveCount(0);

      await qaHook(page, 'qaTeleportTo', 0, 0);
      await qaHook(page, 'qaAdvance', stepsFor(0.5));
      await qaHook(page, 'qaTeleportTo', CONFIG.lake.x, CONFIG.lake.z);
      await qaHook(page, 'qaAdvance', stepsFor(0.1));
      expect((await qaHook(page, 'qaProbeHints')).activeKey, 'an already-seen hint must not retrigger').not.toBe('lake');
    });

    test('a first-sighted wolf shows its caption once', async ({ page }) => {
      await boot(page, { qaHooks: true });
      await enterMobile(page);
      await qaHook(page, 'qaSetFixedStep', FIXED_DT);
      await clearPreemptiveHints(page);

      const map = await qaHook(page, 'qaProbeMapSeed');
      const wolf = (map.predators as { kind: string; x: number; z: number }[]).find((p) => p.kind === 'wolf');
      expect(wolf, 'the pinned seed must spawn a wolf').toBeTruthy();

      await qaHook(page, 'qaTeleportTo', wolf!.x, wolf!.z + 10);
      await qaHook(page, 'qaSetLookYaw', 0);
      await qaHook(page, 'qaAdvance', stepsFor(0.1));

      const probe = await qaHook(page, 'qaProbeHints');
      expect(probe.activeKey).toBe('wolf');
      await expect(page.locator('#hintCaption')).toContainText("a wolf — faster than you. hide (H) or veil (F), don't outrun");
    });

    test('the Show hints checkbox is a tappable 44px target and suppresses every hint', async ({ page }) => {
      await boot(page, { qaHooks: true });
      await enterMobile(page);

      await openSettings(page);
      const row = page.getByLabel(/show hints/i).locator('xpath=ancestor::label[contains(@class,"radioRow")]');
      const box = await row.boundingBox();
      expect(box, 'the radioRow tap target must have a bounding box').not.toBeNull();
      expect(box!.height, '44px min touch target (components/GameCanvas.tsx rationale)').toBeGreaterThanOrEqual(44);

      const toggle = page.getByLabel(/show hints/i);
      await expect(toggle).toBeChecked();
      await toggle.evaluate((el) => (el as HTMLInputElement).click());
      await expect(toggle).not.toBeChecked();
      await closeSettings(page);

      await qaHook(page, 'qaSetFixedStep', FIXED_DT);
      await qaHook(page, 'qaAdvance', stepsFor(0.5));
      expect((await qaHook(page, 'qaProbeHints')).activeKey).toBeNull();
      await expect(page.locator('#hintCaption')).toHaveCount(0);
    });
  });
}
