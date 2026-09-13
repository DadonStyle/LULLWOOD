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

> **Section 0 below runs first.** Founder rule 2026-09-13: *"the feature agents need to ask them
> self series of questions about the feature so the developer can plan or the founding engineer that
> get this"*. An unanswered question is a bounce, not a review comment — the proposal goes back
> unplanned. The four role checklists still run after it.

## Feature questions — answered in the proposal, in writing

Every feature proposal answers all sixteen questions below **before** an engineer plans anything. An unanswered question is not a review comment; it is a bounce — the proposal goes back to the proposer unplanned. Answers are prose with `file:line` citations, in the wiki page at `game/mechanics/<slug>` and in the `suggest_tasks` body. This is section 0 of `docs/FEATURE_CHECKLIST.md`; sections 1–4 (proposer / developer / reviewer / QA) still run after it.

### A. What does the player see?

**1. List every piece of state this feature introduces, and for each one name the pixels that show it.**
Why: the engine holds state the screen never admits to. Worked example — throwables: `heldThrowable` is a boolean (`engine/forest-engine.js:2976`) while `throwablesReserve` is a hidden integer (`:2977`), so a Pocket Stones owner gets two throws and the HUD says the same thing for both: `text={mobile ? 'Holding a stone — tap  ' : 'Holding a stone — click to throw'}` (`components/Hud.tsx:1082`).
Good answer: a table of `state name → engine line → HUD element id → the exact string or glyph the player reads`, with no row whose HUD cell is empty.

**2. Which of this feature's values can be greater than one, and where is the count rendered?**
Why: a quantity the player must ration may never be expressed as a has/has-not pill; "you hold a stone" cannot answer "how many?".
Good answer: "reserve renders as `2/3` in `#actionSlot`" — or an explicit withheld-readout declaration citing `decisions/0010-wind-hud-overrides-no-readouts.md`, the studio's only standing override of the LUL-195 no-readouts aesthetic. Silence is not a third option.

**3. Is every readout you named visible with `adminMode` off?**
Why: `body[data-admin-mode="0"] #panel { display: none !important; }` (`components/GameCanvas.tsx:296`) hides the whole subtree by default and no descendant rule can override it — veil charge, stamina, the run clock and the unbanked pile are all invisible to every real player today.
Good answer: the element is a sibling of `#panel` (the `#windIndicator` / `#caveImmunePanel` pattern) or a row in the `#actionSlot` stack, plus the e2e assertion that runs with `adminMode` off.

**4. Does this feature create state that outlives the moment that triggered it — and can the player see that it is active and roughly how much is left?**
Why: timers, charges and one-shot wards are the states players most need to reason about and the ones most often left implicit.
Good answer: names the persistent surface and the units shown (the `Immune · Xs` cave panel is the reference implementation), or states that nothing outlives the input.

**5. Can this feature silently refuse the player's input, and what is the positive tell when it does?**
Why: the absence of a prompt is not a tell — prompts hide for a dozen unrelated reasons, so a refused grab, a locked veil or a preset overriding a setting reads to the player as a broken game.
Good answer: a named sound, flash or caption fired on the refusal path itself, not the removal of an affordance.

**6. Does any copy you are adding name a key, a mechanic or a HUD element — and did you re-read that thing this week?**
Why: copy rots silently. Two live examples: `components/Hud.tsx:890` tells the player "limited, watch the Veil meter", a meter inside admin-gated `#panel` that no player has seen; `engine/forest-engine.js:2060` still reads `'hollow log — H to hide inside'` after LUL-2311 left bramble as the only `HIDE_KINDS` member. The shop lies the same way: `current: 'no reserve stones'` is hardcoded at `components/Hud.tsx:608` and rendered by the maxed branch at `:621` to a player who just bought the reserve.
Good answer: each new string quoted next to the `file:line` of the thing it names, and shop/upgrade copy derived from the owned tier, never a literal.

### B. Is there a duplicate?

**7. Is any part of this already on screen? Quote the two trigger expressions and show they can be true in the same frame.**
Why: duplication is proved mechanically, not by copy that sounds similar. The hiding duplicate the founder reported is exactly this: `const coverPromptVisible = !hidden && lastHideSpot !== null;` (`engine/forest-engine.js:6197`) and `const coverHintVisible = !hidden && lastHideSpot !== null;` (`:6422`) are byte-identical reads of the same probe in the same tick.
Good answer: two `file:line` citations and one sentence on the frame where both fire — or "no overlap, I grepped X and Y".

**8. If it is a duplicate, which copy dies, and is the survivor actually capable of covering every case?**
Why: the green `#hintCaption` pills are one-shot-per-install (`markHintSeen` → `lullwood:hints:<key>`) with an 8s cap; `#actionSlot` rows are per-frame every run. A one-shot caption never replaces an always-on affordance, and `HINT_PRIORITY` (`engine/forest-engine.js:2040-2041`) has no `charge` entry at all, so `#chargePrompt` has no green equivalent to inherit its job.
Good answer: enumerates the survivor's key/priority table, names every trigger with no counterpart, and — where a directive taken literally would strip load-bearing UI — says plainly which part of the wording must not be followed and why.

**9. Does your new surface use the one prompt convention?**
Why: the bottom `#actionSlot` stack of green `<ActionPrompt>` rows (`components/Hud.tsx:1026-1094`) is the only prompt convention. Free-floating flashing keycaps are forbidden; LUL-2312 already deleted the legacy CSS, so a new one is a regression, not a survival.
Good answer: "a new `<ActionPrompt id="…">` row at position N in `#actionSlot`", plus the e2e row-order assertions that change with it.

**10. Does the engine push a field that no component reads?**
Why: `canGrabThrowable` has been computed every frame since LUL-1623 (`engine/forest-engine.js:6244`), typed in `EngineHudState` (`components/Hud.tsx:116`) and rendered by nothing — which is why there is no pick-up-a-stone prompt in the game.
Good answer: for every field added to `EngineHudState`, the `grep 'state.<field>' components/` result showing a render site, and the e2e DOM check asserting it. No render site = the feature is incomplete, not staged for later.

### C. How does it break, and what test proves it did not?

**11. Name the e2e spec file and test title, and name the opposing system it stages.**
Why: a test with no antagonist proves the input is wired, not that the mechanic works. `e2e/hide.spec.ts:25` says in its own comment "no predator is used anywhere in this file" — which is how the suite stayed green on hiding while hiding was broken and four tests in `positional-hiding`, `cover-feedback` and `hide-alert` were failing.
Good answer: "`e2e/<file>.spec.ts` — '<title>', stages a lion at 6u behind the bramble via `qaHideBehindCoverKind`". A flag/HUD assertion with nothing hunting you does not count as coverage for a stealth feature.

**12. Does that spec actually execute on the QA rig?**
Why: eleven spec files are `@fullmap`-tagged and never run — `playwright.config.ts:116` excludes the tag and `:136` only creates the project under `E2E_FULLMAP=1` (founder rule LUL-2377). Tree, Rock and Log collision coverage exists in the repo and has never executed.
Good answer: micro world via `qaBuildScene`, with the exact props listed. `@fullmap` requires the one reason the micro world cannot express it, and it does not count as regression coverage either way.

**13. What is the path of the local-qa request file you are filing with this feature, and which hooks does it need?**
Why: the e2e suite catches what it was written to catch; the nightly scenario catches the thing breaking in a real run. A file in `requests/` is not evidence — `lul-2611-hiding-near-predator.md` was filed and has never produced a verdict.
Good answer: `shared/local-qa/requests/<lul-id>-<slug>.md`, every step in the verb grammar, every `qa*` hook already on `window.ForestEngine` (a missing one returns `NEEDS-HOOK` and the whole scenario is skipped), plus the `reports/<date>.md` line you will read the morning after merge.

**14. Which currently-failing tests touch this feature, and what is today's baseline?**
Why: you cannot claim a regression gate on a red suite. The live baseline is `~/.paperclip/shared/local-qa/state/e2e-baseline.json` on the server — 2026-09-13: 212 tests, 16 failing — not the checked-in reports under `QA_REGRESSION/reports/`.
Good answer: the baseline date, the failing entries that overlap your element, and whether your change is expected to flip them.

### D. Cues, discoverability and accessibility

**15. What are the cue triple and its degraded forms?**
Why: the rule already exists — `decisions/0015-cue-triple` on the wiki, `## Cues` in `docs/specs/TEMPLATE.md`, standing audit in `docs/CUES.md`. This question adds only the assertion conditions: a triple asserted at engine defaults is untested for the players who need it most.
Good answer: the `## Cues` block filled in as the template asks, **plus** one e2e assertion with `captionsOn=true` and one with `reducedMotion=true`. Every new player-initiated verb produces a visible *and* an audible change in the frame the input is accepted, not only at its eventual outcome.

**16. What new inputs, settings or borrowed visual vocabulary does this add?**
Why: discoverability and accessibility gaps are cheap at proposal time and expensive after. A hold-to-act with no toggle alternative locks out players who cannot hold; a setting that is not persisted resets every session; a glow that looks interactive but is not teaches the player to distrust glows.
Good answer: new key → registered in the shared bindings map, exposed in `SettingsPanel`, toggle alternative for every hold. New setting → added to `PersistedSettings` and restored in `SettingsPanel`'s apply-on-ready effect in the same PR, and any engine/difficulty preset that overrides it says so where the player chose it. New audio → on a named bus, not the `soundOn` master alone. New text → shared pill/caption components and the UI scale token, no hard-coded px. Reused beacon/interact-radius vocabulary → either the object has a verb, or the proposal says why the shared vocabulary is still correct.

## How this is enforced

The reviewer rejects on these grounds, by name:

- **Unanswered question.** Any of the sixteen missing from the proposal → returned to the proposer, not planned. This gate runs at proposal time, before a tier exists, so the `AGENTS.md:115-118` demotion of checklist items to P2 in Tiers A and B does not reach it; a missing answer blocks at every tier.
- **Unrendered state (Q1–Q4, Q10).** An engine count exposed as a boolean, a player-facing readout placed under `#panel`, or an `EngineHudState` field with no render site → **P1**, same class as a missing `docs/ELEMENTS.md` update.
- **Unproven duplicate claim, or an unbuilt replacement (Q7–Q8).** Duplication asserted from similar copy with no two-expression proof, or a prompt removed whose replacement has no entry in `HINT_PRIORITY` → block.
- **New flashing keycap or prompt outside `#actionSlot` (Q9).** Block, with the LUL-2312 diff cited.
- **Coverage that cannot fail (Q11–Q12).** A spec with no opposing system staged, or one that only runs under `E2E_FULLMAP=1`, is not coverage — record it as **no coverage** in the PR body and block on Tier B/C.
- **No request file (Q13).** A player-visible feature with no `shared/local-qa/requests/<lul-id>-<slug>.md` and no reason recorded under "None: not player-visible" → block.
- **Stale copy (Q6).** A string naming a removed mechanic or an invisible HUD element ships as a defect even when it is outside the diff's scope; raise it, do not merge around it.

There is **no CI guard for any of this.** `.github/workflows/ci.yml:159` runs `check-elements-citations.mjs` for the registry; `docs/CUES.md` and this section have no script behind them, so the reviewer is the gate. Owners must be live roles — CEO, CTO, Founding Engineer, Game Engineer, Code Reviewer, Feature Scout, Game Economist; do not assign a step to a paused role. Installing this section into `docs/FEATURE_CHECKLIST.md` without also landing it in every building agent's `instructions/AGENTS.md` reproduces the cue-triple propagation bug, where a rule scoped to "every agent" reached one file out of seven — the install is not done until the grep for this section's heading hits every agent instruction file.

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
