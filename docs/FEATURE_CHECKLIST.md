# Feature checklist — four roles, one gate

Founder's rule (LUL-382/LUL-383): every new feature carries four short
checklists — one per role. This is not paperwork; it is a gate. Keep each
list short enough to actually run before every PR.

Every list shares one non-negotiable item:

> **`docs/ELEMENTS.md` updated** — the new/changed element, and its
> row/column in the interaction matrix against every existing element.

That file's own maintenance contract already says this ("every ticket that
adds, removes, or changes an element's verbs, collision, or interactions
must update this file in the same PR"). This checklist just makes it a
per-role, per-PR habit instead of something only the reviewer remembers.

## 1. Agent proposing/adding the feature

- [ ] The change has **BIG, VISIBLE** impact on the world or the player's
      actions — not a formula tweak, a small radius delta, or a HUD-only
      change. See `decisions/0012-feature-impact-bar` on the wiki.
- [ ] It has a **cost or limit**. A lever with no downside is a win button,
      not a feature.
- [ ] Named which element(s) in `docs/ELEMENTS.md` it adds or touches.
- [ ] Grepped for an existing helper/mechanic that already does this before
      calling it new.
- [ ] Scoped to this ticket — no unrelated changes riding along.
- [ ] Names the visual cue, the audio cue and the one-line explanation the
      player sees the first time (`decisions/0015-cue-triple`).

## 2. Developer implementing it

- [ ] `docs/ELEMENTS.md` updated in the same PR: the element, plus its
      row/column in the interaction matrix against every existing element.
- [ ] New pure logic lives in `lib/game/*.ts`, not new closure state in
      `engine/forest-engine.js` (see `systems/unit-testing-standard`).
- [ ] Regression test added or updated in the same PR — unit test
      (`node --test`) for pure logic, Playwright spec for anything
      rendered/behavioural. A logic diff with no test diff is treated as P1
      by the reviewer (`systems/unit-testing-standard`, LUL-280).
- [ ] `## e2e` section of the spec satisfied: named spec updated, named hooks
      landed, in this PR.
- [ ] The spec boots the **micro world** and stages its case with
      `qaBuildScene` / the `qa*` hooks -- never the full map (founder rule
      LUL-2377; `lib/e2e-policy/world-policy.test.ts` fails the PR otherwise).
      A new or changed behaviour has a hook that reaches it.
- [ ] Branch kept current via backmerge, never rebase/force-push
      (`decisions/0010-no-force-push`).
- [ ] Ran the affected spec(s) locally/headlessly before pushing — not just
      `tsc`/`next build`.
- [ ] Visual cue + audio cue + first-encounter explanation shipped in this
      PR, each e2e-asserted (probe or DOM), each honouring reducedMotion /
      soundOn / captionsOn.

## 3. Reviewer (PR gate)

- [ ] Wiki queried for the touched subsystem before forming an opinion
      (`playbooks/review-protocol`).
- [ ] `docs/ELEMENTS.md` updated for any diff that adds or changes a
      gameplay element or interaction. **Missing this on a feature PR is a
      real gate (P1) — the registry is the stated base of all checks, so a
      feature that skips it is incomplete by definition.**
- [ ] Interaction-matrix entries present for the cells the new element
      plausibly touches — spot-check, not all 15 rows.
- [ ] Regression test present for logic changes — P1 per
      `systems/unit-testing-standard`; everything else stays a P2/P3 nit.
- [ ] Spec has an `## e2e` section naming real files — missing = block on
      Tier B/C.
- [ ] Behaviour change without a `qa*` hook and a micro-world spec = P1
      (founder rule LUL-2377). A new `@fullmap` spec needs a reason the micro
      world cannot express it, or it is a block.
- [ ] Big-impact bar (`decisions/0012-feature-impact-bar`) — if the diff
      reads as tuning or HUD-only, raise it as a scope objection early, not
      as a late merge block. Not a new P0/P1 class on its own.
- [ ] DRY pass: duplication is P2/P3 by default; only block (P1) if you can
      name the concrete divergence that breaks the game.
- [ ] Cue triple present (`decisions/0015-cue-triple`) — missing one is P1
      on a feature PR, same severity class as a missing `docs/ELEMENTS.md`
      update.

## 4. QA (local QA tester, nightly)

- [ ] A request file dropped at `shared/local-qa/requests/<lul-id>-<slug>.md`
      if the nightly checks do not already cover the change — see
      `shared/local-qa/REQUESTING-A-TEST.md`.
- [ ] Results read from `reports/<date>.md` the morning after merge.
