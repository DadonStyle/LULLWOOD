# SPEC: LUL-2479 widen the win-burst `#flash` decay window

**Ticket:** LUL-2479 · **Tier:** C -- `engine/forest-engine.js` is Tier C by path
regardless of diff content (simulation file). `REVIEW: APPROVED` required before merge.

**Written against:** `origin/release/next` @ `08ecacf` (2026-09-12). Re-derive line numbers
if this branch has moved further -- `updateBoom()` and the `winRevealed` poll comment are
both inside `init()`'s closure and have shifted before on unrelated diffs.

**Origin:** filed by the founder's local QA tester as a model-judgement lead
(`local-qa-fingerprint: vision-win-burst-5b1b8cd3c8`), triaged by the CTO (comment,
2026-09-12T02:46), assigned to Founding Engineer to spec.

## Root cause (confirmed, not re-derived here -- see CTO's ticket comment)

The win-burst screen flash (`#flash`) decays from opacity `0.9` to `0` in ~0.257 game-seconds
(`updateBoom()`, `flashEl.style.opacity = String(Math.max(0, 0.9 - e*3.5))`,
`engine/forest-engine.js:1561`) -- far shorter than the paired 3D burst (`boomFlash` mesh
0.4s, `boomRing` 1.4s, particles 1.6s, `boomGroup` visible until `e>1.8`). The QA repro's own
telemetry shows why this is a real, not marginal, problem: it polls
`cs('#flash').opacity >= 0.5` (`shared/local-qa/requests/LUL-1614-win-sequence-full-loop.md:28`)
and snaps immediately after that resolves true, but the screenshot it actually captured was
taken at `gameSinceE=9.94` against a `fireBoom()` trigger at cinematic `e=9.3` -- **0.64
game-seconds after the trigger**, i.e. ~2.5x longer than the flash's own full fade-out
window. Under software WebGL the wait-for-true-then-capture round trip (poll tick -> render
-> screenshot write) costs real wall time, during which game time keeps advancing; a
~0.26s-wide flash cannot survive that round trip even though the `wait_for` genuinely
observed `opacity>=0.5` at some earlier tick. This is a real player-facing risk too, not just
a test artifact: ~15 frames at 60fps, fewer under any frame-pacing hitch.

## The fix

### 1. `engine/forest-engine.js:1561` -- widen the decay rate

```js
// before
if(flashEl) flashEl.style.opacity = String(Math.max(0, 0.9 - e*3.5));
// after
if(flashEl) flashEl.style.opacity = String(Math.max(0, 0.9 - e*0.6));
```

This stretches the fade from ~0.257s to 1.5s. Sizing rationale, not just the CTO comment's
rough `*1.5` (~0.6s) suggestion: the QA repro's own measured capture delay was 0.64s and
still landed on `opacity===0` at the old rate, so a decay that only reaches zero at ~0.6s
would still be at risk of the same miss if a capture round trip costs slightly more next
time. At `*0.6`, opacity at the measured 0.64s-late capture point is `0.9 - 0.64*0.6 = 0.516`
-- still comfortably above the QA repro's own `>=0.5` threshold with margin, and opacity at
a full 1.0s-late capture is `0.3`, still a visible glow. 1.5s total fade stays inside
`boomRing`'s 1.4s ring fade and short of the particle group's 1.6s/1.8s window, so `#flash`
keeps overlapping the 3D burst elements it's paired with rather than outliving or badly
undershooting them. `fireBoom()`'s initial `flashEl.style.opacity = '0.9'`
(`engine/forest-engine.js:1550`) is unchanged -- only the decay rate moves.

No other read of this literal exists (`grep -n "0.9 - e" engine/forest-engine.js` --
`updateBoom()` is the only match); no `docs/ELEMENTS.md` passage cites the numeric decay
rate (only the general "sky-burst (`fireBoom()`)" mention at `docs/ELEMENTS.md:215`, which
survives structurally regardless of the constant's value) -- no ELEMENTS.md content edit
needed for this hunk, only the usual citation-drift check below for the comment edit's line
delta.

### 2. `engine/forest-engine.js:5600-5604` -- fix the stale LUL-1611 comment

This is a comment-only correctness fix (no behavior change), flagged separately by the CTO:
the comment asserts `fireBoom()` "only ever fires from `arriveHome()`", which was true when
LUL-1611 wrote it but has been stale since LUL-2281 added a second call site
(`engine/forest-engine.js:5545`, the `pickingUp` cinematic's `e>=9.3` keyframe -- the live
win path in real play today; `arriveHome()`'s own `fireBoom()` call at `:4994` is
unreachable in real play since LUL-2281 Decision 2, per `finishPickup()`'s own comment at
`:4863-4865`, and is left in place deliberately). The downstream logic this comment
describes (`boomStart<0` as "the burst that fired has finished") is still correct either
way -- there is exactly one `fireBoom()` call per run (`pickBoomed` guards the cinematic
path from firing twice; `arriveHome()` is dead code in the live path) -- only the comment's
claim about *which* call site fires needs correcting so it doesn't mislead the next reader
into thinking `arriveHome()` is still the live trigger.

```js
// before (engine/forest-engine.js:5600-5604)
    // LUL-1611: reveal the win text once the boom burst itself retires
    // (boomStart resets to -1 in updateBoom() at e>1.8s) instead of a
    // wall-clock timer -- see arriveHome() for why. fireBoom() only ever
    // fires from arriveHome(), so boomStart<0 here unambiguously means the
    // win burst that just played has finished, not "no burst yet".

// after
    // LUL-1611: reveal the win text once the boom burst itself retires
    // (boomStart resets to -1 in updateBoom() at e>1.8s) instead of a
    // wall-clock timer -- see arriveHome() for why. fireBoom() fires from
    // the pickingUp cinematic's e>=9.3 keyframe in real play (LUL-2281) and
    // from arriveHome() (unreachable in real play since LUL-2281 Decision 2,
    // left in place) -- either way there is exactly one fireBoom() call per
    // run (pickBoomed guards the cinematic path), so boomStart<0 here still
    // unambiguously means the win burst that fired has finished, not "no
    // burst yet".
    if(hudState.winVisible && !hudState.winRevealed && boomStart < 0) pushState({ winRevealed: true });
```

The replacement is 8 comment lines vs. the original 5 -- **re-run
`node scripts/check-elements-citations.mjs` (or whatever the current citation-check script
is named) after this edit** and fix any `docs/ELEMENTS.md` line citation that shifts past
`:5604` because of the +3 line delta. Do the same check after hunk 1 above in case any
citation lands between `:1550` and the old `:1561` (none currently do, per the grep above,
but re-verify against your own working tree since this spec was written).

## Verification

- `npx tsc --noEmit` -- clean (no `EngineActions` key added/changed/removed; this diff adds
  no new engine action, so the LUL-1697 engine/React contract check does not apply).
- `npx eslint .` (via the `lint` script) -- clean.
- `node scripts/check-elements-citations.mjs` (or current equivalent) -- clean after the
  comment-line-count shift noted above.
- Manual/local confirmation that `#flash` opacity is still `>=0.5` well past the old
  0.257s window: e.g. `qaTeleportNearBaby()` -> `KeyE` -> hold through the cinematic ->
  poll `document.getElementById('flash').style.opacity` in the browser console at
  `e=9.3+0.64` game-seconds and confirm it reads `~0.516`, not `0`. This is the same
  invariant the QA repro's `wait_for`/`snap` pair depends on -- confirm it before opening
  the PR, don't rely solely on the tester's next nightly run to find out.

## e2e

**Specs.** No existing Playwright spec references `#flash`, `fireBoom`, or `boomStart`
(`grep -rn "#flash\|fireBoom\|boomStart" e2e/` on `08ecacf` returns nothing) -- this is a
QA-tester-only surface today, not covered by CI's own suite. No new Playwright spec is
required by this ticket; the existing
`shared/local-qa/requests/LUL-1614-win-sequence-full-loop.md` scenario (`wait_for
cs('#flash').opacity >= 0.5`, step `:28`, `snap win-burst`, step `:29`) already exercises
this exact code path and needs no edit -- it will simply start passing its own vision-model
question ("Is a bright burst or flash visible at the centre of the frame?") once the decay
window is wide enough to survive the capture round trip. Do not weaken or retime that
request file's assertion to force a pass -- per the local-qa founder rule, a failing/
marginal check is a finding, and this spec's job is to fix the underlying timing, not the
test.

**Hooks.** None needed -- no new QA hook is required; the existing `#flash` DOM element and
`cs()` (computed-style) helper already used by the request file are sufficient to observe
the fix.

**Tester scenario.** The founder's nightly local-qa tester is the authoritative verdict here
-- this ticket originated from its vision-model check, and the same
`LUL-1614-win-sequence-full-loop.md` request's `win-burst` scenario/model-question pair is
what re-verifies it post-fix on the next nightly run. No new request file needed.

**Not covered.** Whether the widened flash *feels* right in play (readability, whether 1.5s
feels too long or washes out the ascend cinematic's final beat) is a feel call, unverified
until a human or the founder plays a build -- flag this in the PR description per the FE
boundary on gameplay/visual verification.

## Constraints

- `fireBoom()`'s trigger timing (`e>=9.3` in the pickingup cinematic, `arriveHome()`'s own
  unreachable call) is unchanged -- this ticket only widens how long the DOM flash stays
  visible after whichever call fires it, not when it fires.
- `boomFlash`/`boomRing`/particle 3D burst timings (0.4s/1.4s/1.6s/1.8s) are unchanged.
- No `EngineActions`/`ENGINE_ACTION_KEYS` change -- this diff adds no new engine action.

## Out of scope

- Any broader tuning-constant extraction (`engine/tuning.js`) -- `docs/specs/tuning-extraction.md`
  (LUL-1340) is a separate, sequenced, full-file mechanical move; this one-literal bug fix
  does not fold into it and should not wait on it (it isn't touching any of the constants
  that spec's sequencing note calls out as contested).
- The `LUL-1614-win-sequence-full-loop.md` request file's `within 25000` timeout budget or
  any other of its steps -- untouched, no edit needed per the `## e2e` section above.
