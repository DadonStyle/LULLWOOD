# e2e/

## Ownership

This suite is **not owned by the Game Tester** — that role has been paused since
2026-09-04/05. It is owned by whichever engineer changes the code a spec covers: if your PR
changes behavior a spec asserts, you update that spec in the same PR. The local QA tester
(a nightly cron, not an agent — see `shared/local-qa/QA_TESTER.md`) re-runs this whole suite
every night against `release/next` and files `[BUG]` tickets to the CTO for anything red,
plus one grouped `[BUG] e2e nightly <date>` ticket for new suite failures. It does not read
tickets or comments and cannot fix a stale spec for you.

## The `## e2e` section rule

Every spec in `docs/specs/` must contain an `## e2e` section (see `docs/specs/TEMPLATE.md`)
naming the spec file(s) that cover the change, any new/existing QA hooks the tests need, and
the nightly tester scenario (or request file) that exercises it. Missing this section blocks
a Tier B/C PR in review. Full mechanism and how to request a test or a hook: read
`shared/local-qa/REQUESTING-A-TEST.md` before writing a request file or a `[QA-HOOK]` ticket.

## Writing a spec here

- Use the helpers in `helpers.ts`: `boot(page, opts)` to load the game, `enter(page)` to
  click through the gate. Prefer `qaHook(page, name, ...args)` over
  `window.ForestEngine?.qaX?.()` — `qaHook` throws immediately when a hook is missing
  instead of silently no-opping into a downstream "element not found" that reads like a UI
  bug instead of a boot mistake.
- `QA_PINNED_SEED` (`helpers.ts:35`) is the seed nearly every spec boots with, so the suite
  keeps exercising one known, understood map layout. **Never re-pin it** to make a failing
  test pass — a seed change is a scope decision for whoever owns the spec, not an escape
  hatch.
- Make every new assertion **fail once on purpose** before trusting it green — comment out
  the fix, or point the assertion at the wrong value, and confirm it actually goes red. A
  hook or DOM node that renders and is tappable can still be wired to nothing; assert the
  engine-visible effect (a QA hook's return value), not just that a DOM element exists.
- This rig runs on software WebGL (swiftshader): game time runs at roughly 63% of wall time
  and frame rate is low. Never `sleep` past a fixed real-time duration expecting game state
  to have advanced by then — poll `qaProbeElapsedTime()` (or the relevant hook) until the
  condition holds, within a generous budget, instead.

## Never do these two things

1. **Never weaken, skip, or delete an assertion, widen a timeout, or re-pin
   `QA_PINNED_SEED` just to turn a run green.** A failing test is a finding. If the test
   itself is wrong — asserting behavior a later, intentional change superseded — say so and
   fix the spec for the new behavior in the same PR; don't quietly loosen it.
2. **Never assign to or resume the paused Game Tester.** Problems with the tester itself
   (this suite's runner, not an individual spec) go to the CEO as a ticket flagged for the
   founder.

## Known accepted-flaky signatures

- **`e2e/predator-audio-bus.spec.ts`** -- "raising the slider back up un-mutes the bus for the
  next real predator call" and the transition-matrix test (6 rapid writes) can both
  intermittently fail with a stuck-value signature (`Expected: <n>, Received: 1` or
  `Received: <prior value>`), reproducing even on an unmodified baseline with no app-code
  change (LUL-5934, LUL-5942). Root cause: the rig's `--mute-audio` Chromium flag
  (`playwright.config.ts:38-52`, LUL-20) means WebAudio's render thread isn't guaranteed to
  pump `AudioParam` automation every test session; this is a rig gap, not an app bug.
  Playwright's own retry clears it in practice (retry0 fail / retry1 pass). Do not re-pin the
  seed, widen the timeout, or treat a single isolated occurrence as a regression -- check
  `git log` for actual changes to the implicated files first. Decision record: wiki
  `decisions/lul-5942-predator-audio-bus-accepted-flaky-2026-10-10`.
