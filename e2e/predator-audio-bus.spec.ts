// LUL-5829: Predator Audio slider -- ducks predator-call/threat SFX (predatorCall/
// investigateCue/sniff) independently of the soundOn master mute, via a dedicated
// predatorGain WebAudio node (engine/forest-engine.js startAudio()). Full four-bus
// scope (Music/Ambient/Interface/Predator) is deferred -- this covers only the one
// gain stage shipped here. See wiki decisions/lul-5808-audio-bus-cheap-slice-accepted-2026-10-02.
//
// qaProbePredatorVolume() (engine/forest-engine.js, near qaProbeKeyMap) reads the
// real predatorGain.gain.value, not just the stored setting -- per Q11 of the
// Feature Checklist, a test that only reads back the state it wrote isn't coverage.
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

const openSettings = async (page: import('@playwright/test').Page) => {
  await page.getByTestId('menuToggle').evaluate((el) => (el as HTMLElement).click());
  await page.locator('#settingsBtn').evaluate((el) => (el as HTMLElement).click());
};
const closeSettings = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Close settings' }).evaluate((el) => (el as HTMLElement).click());

/**
 * Sets the Predator Audio range input's value and fires a native 'input' event --
 * the WebGL canvas intercepts real pointer-actionability polling in this rig (same
 * reason e2e/scent-trail.spec.ts's settings checkbox uses el.click() instead of a
 * real Playwright click), and React's controlled <input type="range"> listens for
 * the native 'input' event to drive onChange, not 'change'.
 */
async function setPredatorAudioSlider(page: import('@playwright/test').Page, percent: number) {
  const slider = page.getByLabel(/predator audio/i);
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, percent);
}

/** Stages one wolf at catch-range distance and lures it so the real spotted/hunt
 * path (not a fake state write) calls predatorCall() -- see forest-engine.js's
 * p.hunt branch (`if(dist < 8){ ...; p.callTimer -= dt; if(p.callTimer<=0)
 * predatorCall(...) }`), callTimer starts at 0 on a fresh qaBuildScene placement
 * so the very first qaAdvance step fires the real call.
 */
async function stageAndLureWolf(page: import('@playwright/test').Page) {
  await qaHook(page, 'qaBuildScene', { predators: [{ kind: 'wolf', x: 6, z: 0 }] });
  await qaHook(page, 'qaLurePredatorKind', 'wolf');
  await qaHook(page, 'qaAdvance', stepsFor(0.1));
}

test.describe('predator audio bus volume (LUL-5829)', () => {
  test('defaults to full gain (100%) on a fresh run', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    const gain = await qaHook(page, 'qaProbePredatorVolume');
    expect(gain).toBeCloseTo(1, 5);
  });

  test('muting the slider to 0% silences the predatorGain node during a real predator call', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await openSettings(page);
    await setPredatorAudioSlider(page, 0);
    await expect(page.getByLabel(/predator audio/i)).toHaveValue('0');
    await closeSettings(page);

    // The setter ramps via setTargetAtTime(..., 0.05) against the real AudioContext
    // clock (ctx.currentTime), not the engine's simulated qaAdvance game-time clock
    // -- this needs an actual wall-clock wait, not more sim steps, to settle.
    await page.waitForTimeout(500);
    expect(await qaHook(page, 'qaProbePredatorVolume')).toBeCloseTo(0, 2);

    await stageAndLureWolf(page);

    // The real call fired (predatorCall real path, not fabricated state) and the
    // bus gain it was routed through is still silenced -- this is the WebAudio
    // node's actual .value, not a readback of the stored predatorVolume setting.
    expect(await qaHook(page, 'qaProbePredatorVolume')).toBeCloseTo(0, 2);
  });

  test('raising the slider back up un-mutes the bus for the next real predator call', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await qaHook(page, 'qaSetFixedStep', FIXED_DT);

    await openSettings(page);
    await setPredatorAudioSlider(page, 0);
    await setPredatorAudioSlider(page, 65);
    await expect(page.getByLabel(/predator audio/i)).toHaveValue('65');
    await closeSettings(page);

    await page.waitForTimeout(500);
    expect(await qaHook(page, 'qaProbePredatorVolume')).toBeCloseTo(0.65, 2);

    await stageAndLureWolf(page);
    expect(await qaHook(page, 'qaProbePredatorVolume')).toBeCloseTo(0.65, 2);
  });

  test('persists across reload (LUL-2649 apply-on-ready gate)', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);

    await openSettings(page);
    await setPredatorAudioSlider(page, 40);
    await expect(page.getByLabel(/predator audio/i)).toHaveValue('40');
    await closeSettings(page);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.ForestEngine));
    await enter(page);

    await openSettings(page);
    await expect(
      page.getByLabel(/predator audio/i),
      'the stored 40% must survive reload, not revert to the 100 default',
    ).toHaveValue('40');

    const gain = await qaHook(page, 'qaProbePredatorVolume');
    expect(gain).toBeCloseTo(0.4, 2);
  });
});
