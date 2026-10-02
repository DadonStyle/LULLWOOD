// LUL-5829 mobile half of ../predator-audio-bus.spec.ts. Required by the
// engine/React contract (founder rule 2026-09-09, step 4): `setPredatorVolume`
// is a new EngineActions key, so its React call site (components/SettingsPanel.tsx's
// Predator Audio slider) needs a Playwright spec on desktop AND mobile, same
// precedent as ../mobile/leaderboard-sky-and-trees.spec.ts for setLeaderboardRecord
// (PR#1002/LUL-5820). The slider itself is a shared SettingsPanel component with
// no touch-specific markup, so this mirrors the desktop file's shape rather than
// duplicating all four states -- it only needs to prove the real Hud.tsx/
// SettingsPanel.tsx -> engine action -> predatorGain wiring also runs when
// MobileControls mounts instead of DesktopControls.
import { test, expect } from '../fixtures';
import { boot, qaHook } from '../helpers';

test.use({ viewport: { width: 727, height: 393 } }); // landscape, clears OrientationGate (LUL-69)

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

async function enterMobile(page: import('@playwright/test').Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('mobile project must have a viewport size');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1200); // gate fade settle (no pointer-lock on mobile)
}

async function openSettings(page: import('@playwright/test').Page) {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
}
const closeSettings = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());

/** Same native-'input'-event dispatch as the desktop spec -- the WebGL canvas
 * intercepts real pointer-actionability polling in this rig, and React's
 * controlled <input type="range"> listens for 'input', not 'change'. */
async function setPredatorAudioSlider(page: import('@playwright/test').Page, percent: number) {
  const slider = page.getByLabel(/predator audio/i);
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, percent);
}

async function stageAndLureWolf(page: import('@playwright/test').Page) {
  await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 6, z: 0 }] });
  await qaHook(page, 'qaLurePredatorKind', 'wolf');
  await qaHook(page, 'qaAdvance', stepsFor(0.1));
}

test.describe('predator audio bus volume (LUL-5829, mobile)', () => {
  test('defaults to full gain (100%) on a fresh run', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enterMobile(page);
    const gain = await qaHook(page, 'qaProbePredatorVolume');
    expect(gain).toBeCloseTo(1, 5);
  });

  test('muting the slider to 0% via the real mobile Settings UI silences predatorGain during a real predator call', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enterMobile(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await openSettings(page);
    await setPredatorAudioSlider(page, 0);
    await expect(page.getByLabel(/predator audio/i)).toHaveValue('0');
    await closeSettings(page);

    // Real AudioContext ramp (setTargetAtTime(..., 0.05)), needs a wall-clock
    // wait to settle -- same reasoning as the desktop spec.
    await page.waitForTimeout(500);
    expect(await qaHook(page, 'qaProbePredatorVolume')).toBeCloseTo(0, 2);

    await stageAndLureWolf(page);
    expect(await qaHook(page, 'qaProbePredatorVolume')).toBeCloseTo(0, 2);
  });
});
