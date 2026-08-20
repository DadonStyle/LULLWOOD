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

## 2. Developer implementing it

- [ ] `docs/ELEMENTS.md` updated in the same PR: the element, plus its
      row/column in the interaction matrix against every existing element.
- [ ] New pure logic lives in `lib/game/*.ts`, not new closure state in
      `engine/forest-engine.js` (see `systems/unit-testing-standard`).
- [ ] Regression test added or updated in the same PR — unit test
      (`node --test`) for pure logic, Playwright spec for anything
      rendered/behavioural. A logic diff with no test diff is treated as P1
      by the reviewer (`systems/unit-testing-standard`, LUL-280).
- [ ] Branch kept current via backmerge, never rebase/force-push
      (`decisions/0010-no-force-push`).
- [ ] Ran the affected spec(s) locally/headlessly before pushing — not just
      `tsc`/`next build`.

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
- [ ] Big-impact bar (`decisions/0012-feature-impact-bar`) — if the diff
      reads as tuning or HUD-only, raise it as a scope objection early, not
      as a late merge block. Not a new P0/P1 class on its own.
- [ ] DRY pass: duplication is P2/P3 by default; only block (P1) if you can
      name the concrete divergence that breaks the game.

## 4. QA (Game Tester)

- [ ] The feature **visibly** changes something on screen — capture a
      screenshot or recording proving it. "Visible" is QA's call to settle,
      not the coding agent's (`decisions/0012-feature-impact-bar`).
- [ ] New/changed interaction-matrix cells driven headlessly with evidence,
      at minimum the cells this feature touches
      (`systems/headless-qa-rig`).
- [ ] Confirmed neighboring behaviour sharing the same collision/LOS/scent
      code path still passes — no silent regression next door.
- [ ] Any `UNDEFINED` matrix cell this feature resolves gets
      `docs/ELEMENTS.md` corrected, or filed as a follow-up ticket if fixing
      it is out of scope.
