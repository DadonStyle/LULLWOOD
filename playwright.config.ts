import { defineConfig, devices } from '@playwright/test';

// This box has no root and no system Chromium deps -- browser shared libs live in a
// user-owned apt-download prefix (see shared/qa/bin/qa-env, wiki: systems/headless-qa-rig).
// GitHub Actions runners get real libs via `playwright install --with-deps` (they have
// root), so only patch LD_LIBRARY_PATH when we are NOT on a CI runner. `CI` is set by
// GitHub Actions automatically; see .github/workflows/ci.yml.
if (!process.env.CI) {
  const prefix = '/home/noam/.paperclip/shared/browser-deps/usr/lib/x86_64-linux-gnu';
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${prefix}:${process.env.LD_LIBRARY_PATH}`
    : prefix;
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 3111;
const baseURL = `http://127.0.0.1:${PORT}`;

// LUL-35 (pass 2): a second `next dev` webServer on its own port used to live
// here, plus a `chromium-dev` project, both existing solely for
// e2e/lifecycle.spec.ts and justified by "it needs React StrictMode's dev-only
// double-invoke". That spec has never used StrictMode to trigger anything --
// it forces the remount itself via `window.__qaRemount`, precisely because the
// StrictMode double-invoke settles before the engine import resolves and so
// exercises no live engine (the spec's own header said exactly that, while
// this file claimed the opposite). One webServer, one project, one production
// build -- the same artifact that ships.
const launchOptions = {
  // No GPU here (real or in CI) -- go through software rendering. `--mute-audio`
  // means the WebAudio layer is never exercised by this suite (see LUL-20: do not
  // claim audio works from this rig).
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
};

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions,
  },
  webServer: {
    // The suite serves itself against a production build, same as what actually ships.
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
      // LUL-216: e2e/replay/** is recording-only (run by hand via `--project=replay`,
      // never as part of the required checks) -- excluded here so the smoke suite
      // doesn't pay to run the same scenarios twice on every push. LUL-275:
      // e2e/mobile/** needs a real mobile-emulated context (see the `mobile`
      // project below), which this desktop project can't give it -- excluded
      // the same way, not doubled up.
      testIgnore: ['**/replay/**', '**/mobile/**'],
    },
    // LUL-216: dedicated project for recording GAMES_REPLAY/ clips. Kept separate
    // from the `chromium` smoke project so CI's per-run/per-shard smoke suite
    // never pays for a video (which is `retain-on-failure` above, i.e. off on a
    // green run) -- only `npx playwright test --project=replay` records anything,
    // and that is run by hand/on demand, not as part of the required checks.
    {
      name: 'replay',
      testDir: './e2e/replay',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        // Matches the game canvas's own aspect ratio (16:9) at a size that keeps
        // committed .webm files small -- see GAMES_REPLAY/README.md for the
        // repo-weight budget these clips are curated against.
        video: { mode: 'on', size: { width: 960, height: 540 } },
      },
    },
    // LUL-275: real mobile emulation (touch, coarse pointer, no hover, narrow
    // viewport) for the half of the input-mode regression that `hasTouch`
    // alone on a desktop context can't reproduce -- see
    // e2e/mobile/input-mode.spec.ts. `devices['Pixel 5']`, not an iPhone
    // preset: those default `browserType` to webkit, and this repo installs
    // and runs chromium only (see the LD_LIBRARY_PATH / launchOptions comments
    // above, and CI's `playwright install --with-deps chromium`). Own testDir,
    // isolated the same way `replay` is isolated above, so this project only
    // ever runs the mobile spec, not the whole smoke suite a second time under
    // a tiny viewport. Unlike `replay` this carries no opt-in flag: VP R&D's
    // ask on LUL-275 is a permanent gate, so it runs on every plain
    // `npx playwright test`, same as `chromium`.
    {
      name: 'mobile',
      testDir: './e2e/mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
