// Runtime check for the LUL-17 dispose() lifecycle: mount -> unmount ->
// remount should leave exactly one rAF loop, one live WebGL context, and one
// open AudioContext -- never two.
//
// This deliberately does not rely on React StrictMode's own dev-only
// double-invoke to exercise dispose(): GameCanvas.tsx pulls the engine in with
// a dynamic `import()` (LUL-28 made it a bundled ES module -- this comment used
// to say "a <script> tag", which has not been true since), and StrictMode's
// mount -> cleanup -> remount sequence runs synchronously, before that import
// resolves. So the cleanup that fires mid-sequence has no live engine to tear
// down -- a no-op against a StrictMode remount either way, dev or prod.
//
// Instead this spec uses a QA-only hook added to GameLoader.tsx
// (`?qaHooks=1` -> `window.__qaRemount()`) to force a genuine React
// unmount/remount of a *live* engine via a `key` change -- see GameLoader.tsx
// for why that hook is safe for real players (opt-in, absent by default).
//
// LUL-35 (pass 2): because that trigger is explicit rather than StrictMode's
// automatic one, this spec does not need a dev server -- and it no longer gets
// one. playwright.config.ts used to boot a second `next dev` webServer on its
// own port purely for this file, on the stale premise that it needed
// StrictMode; the file's own header had said the opposite for just as long.
// One webServer, one project, one prod build, same as the rest of the suite.
import { test, expect } from '@playwright/test';
import { boot } from './helpers';

// Installed before any page script runs (Playwright guarantees addInitScript
// executes ahead of the page's own scripts on every navigation), so it sees
// every requestAnimationFrame/AudioContext/WebGL context the engine creates.
function installInstrumentation() {
  const w = window as any;
  w.__qa = { rafPending: new Set<number>(), audioCreated: 0, audioClosed: 0, webglCreated: 0, webglLive: 0 };

  const nativeRAF = window.requestAnimationFrame.bind(window);
  const nativeCAF = window.cancelAnimationFrame.bind(window);
  w.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id: number = nativeRAF((...args: [number]) => {
      w.__qa.rafPending.delete(id);
      return (cb as any)(...args);
    });
    w.__qa.rafPending.add(id);
    return id;
  };
  w.cancelAnimationFrame = (id: number) => {
    w.__qa.rafPending.delete(id);
    return nativeCAF(id);
  };

  const NativeAC = w.AudioContext || w.webkitAudioContext;
  if (NativeAC) {
    const Wrapped = function (this: any, ...args: any[]) {
      const ctx = new NativeAC(...args);
      w.__qa.audioCreated++;
      const nativeClose = ctx.close.bind(ctx);
      ctx.close = (...cargs: any[]) => {
        w.__qa.audioClosed++;
        return nativeClose(...cargs);
      };
      return ctx;
    };
    Wrapped.prototype = NativeAC.prototype;
    w.AudioContext = Wrapped;
    w.webkitAudioContext = Wrapped;
  }

  const nativeGetContext = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: any[]) {
    const ctx = (nativeGetContext as any).call(this, type, ...rest);
    if (ctx && /webgl/i.test(String(type)) && !ctx.__qaTracked) {
      ctx.__qaTracked = true;
      w.__qa.webglCreated++;
      w.__qa.webglLive++;
      this.addEventListener(
        'webglcontextlost',
        () => {
          w.__qa.webglLive--;
        },
        { once: true },
      );
    }
    return ctx;
  };
}

test.describe('lifecycle', () => {
  test('mount -> unmount -> remount leaves exactly one rAF loop / WebGL context / AudioContext', async ({
    page,
  }) => {
    await page.addInitScript(installInstrumentation);
    await boot(page, { qaHooks: true });
    await page.waitForTimeout(500); // let the rAF loop settle into steady state

    const baseline = await page.evaluate(() => {
      const q = (window as any).__qa;
      return { rafPending: q.rafPending.size, webglCreated: q.webglCreated, webglLive: q.webglLive };
    });
    expect(baseline.rafPending, 'exactly one active rAF loop after first init').toBe(1);
    expect(baseline.webglCreated, 'exactly one WebGL context created by first init').toBe(1);
    expect(baseline.webglLive, 'that context is live').toBe(1);

    // Enter the game so startAudio() runs -- audio is created lazily on the
    // first click, not at init() time.
    await page.mouse.click(640, 360);
    await page.waitForFunction(() => (window as any).__qa.audioCreated === 1, { timeout: 10_000 });

    const afterFirstEnter = await page.evaluate(() => {
      const q = (window as any).__qa;
      return { audioCreated: q.audioCreated, audioClosed: q.audioClosed };
    });
    expect(afterFirstEnter.audioCreated, 'one AudioContext created on first enter').toBe(1);
    expect(afterFirstEnter.audioClosed, 'nothing closed yet').toBe(0);

    // Force a real unmount -> remount of the live engine (see file header for
    // why StrictMode's own automatic one doesn't exercise this).
    await page.evaluate(() => (window as any).__qaRemount());

    await page.waitForFunction(
      () => {
        const q = (window as any).__qa;
        return (
          q.webglCreated === 2 &&
          q.webglLive === 1 &&
          q.audioClosed === 1 &&
          q.rafPending.size === 1 &&
          document.querySelectorAll('canvas').length === 2
        );
      },
      { timeout: 30_000 },
    );

    const afterRemount = await page.evaluate(() => {
      const q = (window as any).__qa;
      return {
        rafPending: q.rafPending.size,
        webglCreated: q.webglCreated,
        webglLive: q.webglLive,
        audioCreated: q.audioCreated,
        audioClosed: q.audioClosed,
      };
    });
    // dispose() ran once (on the real unmount): the old rAF loop was
    // cancelled, the old WebGL context was lost, and the old AudioContext
    // was closed -- while init() ran again fresh, leaving exactly one of
    // each, never two live at once.
    expect(afterRemount.rafPending, 'still exactly one active rAF loop after remount').toBe(1);
    expect(afterRemount.webglCreated, 'a second WebGL context was created by the remount').toBe(2);
    expect(afterRemount.webglLive, 'only one WebGL context is live -- the old one was released').toBe(1);
    expect(afterRemount.audioClosed, 'the old AudioContext was closed by dispose()').toBe(1);

    // Enter again on the fresh instance and confirm the same holds for audio:
    // a second context gets created, but only one stays open.
    await page.mouse.click(640, 360);
    await page.waitForFunction(() => (window as any).__qa.audioCreated === 2, { timeout: 10_000 });

    const final = await page.evaluate(() => {
      const q = (window as any).__qa;
      return { audioCreated: q.audioCreated, audioClosed: q.audioClosed, netOpen: q.audioCreated - q.audioClosed };
    });
    expect(final.netOpen, 'exactly one AudioContext left open across the whole mount/unmount/remount cycle').toBe(1);
  });
});
