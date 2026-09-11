# SPEC: <TICKET-ID> <short title>

**Ticket:** <LUL-nnnn> · **Tier:** <A|B|C> — <one line naming what the diff touches and why
that tier>. Tier C needs `REVIEW: APPROVED` before merge; state that here if it applies.

**Written against:** `release/next` @ `<sha>` (<date>). Re-derive every `file:line` below
from the branch you actually implement on if it has moved.

## Files

- `<path>` — <created | edited, one line on what changes>

## The change

<Per file: exact content/diff. Full function signatures with types. Cite `file:line` for
every existing symbol referenced — an executor that can't find what you named will invent
something.>

## Verification

- <exact command> — <what passing looks like>

## e2e

**Specs.** `e2e/<file>.spec.ts` — '<test title>' (new | extended | must pass unchanged). One
line per spec.
**World.** micro (default — stage the case with `qaBuildScene({...})`: list the exact trees,
props, predators, child/home the spec places) | `@fullmap` + the one reason the micro world
cannot express it (founder rule LUL-2377: the QA rig never runs `@fullmap`; the allowlist in
`lib/e2e-policy/world-policy.test.ts` may only shrink).
**Hooks.** `window.ForestEngine.qaXxx(args): ReturnType` — one-line behaviour — new (declare
in `engine/forest-engine.d.ts`, install inside the `?qaHooks` block in `init()`) | existing
(`engine/forest-engine.js:<line>`). Every behaviour change needs a hook that reaches it.
**Tester scenario.** Which nightly check in `shared/local-qa/QA_TESTER.md` covers this, or
the request file `shared/local-qa/requests/<lul-id>-<slug>.md` written with this spec.
"None: not player-visible" needs a reason.
**Not covered.** Feel, audio, real-device items that stay manual, and why.

## Cues

**Visual.** <what the player sees change in the world or HUD, and where -- file:line for the render/HUD call site>.
**Audio.** <the one-shot sound function name and file:line -- new or existing -- gated by `soundOn`>.
**Explanation.** <the exact one-line text the player sees the first time (or every time, if a persistent gate), and file:line for the caption call site -- gated by `captionsOn`>.
**Reduced motion.** <what the visual cue degrades to when `reducedMotion` is true, or "static, no animation to reduce" if it was never animated>.

See `decisions/0015-cue-triple` on the wiki.

## Constraints

<What must not change. Pure/no-side-effects requirements. Repeat the tier here if it gates
merge.>

## Out of scope

<Named explicitly — what this spec deliberately does not touch, and why, so a reviewer
doesn't wonder if it was missed.>
