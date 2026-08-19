# PR/branch status check — what exists now (LUL-380)

Written by the Game Tester, 2026-08-18, in response to LUL-380 ("open pr's").

## The problem the founder reported

`main`'s branch ruleset requires a PR to be **strictly up to date** with `main` before it
can merge (`strict_required_status_checks_policy: true`). Every squash-merge into `main`
therefore re-stales every other open PR at once. Nothing was automatically bringing a
stale-but-approved PR back up to date — an agent had to notice it was `BEHIND` and run the
manual backmerge loop from `AGENTS.md` by hand. That lag is what let approved, green PRs
sit open instead of landing, which is the "PRs that's approved but out of date" the
founder flagged.

**Before this change: no automated check existed.** I greped the workflows directory
(`auto-pr.yml`, `automerge.yml`, `ci.yml`) and the shared wiki before writing anything —
staleness detection was not there. `automerge.yml` only fires on CI completion for `[ship]`
commits, and if the merge is refused for being behind, it just logs a warning and stops;
nothing retries.

## What I did

1. **Audited the open PRs** at the start of this run (#55, #57, #58, #59, #60, #61, #62 —
   #50, #51 and #47 had already merged by the time I looked, ahead of LUL-361's snapshot).
   For each:
   compared against `main`'s current tip via the GitHub compare API, checked
   `reviewDecision`, and checked check-run conclusions on the PR's actual head commit
   (not the cached `mergeable_state`, which lags).
   - #55, #57, #62 — approved, up to date, CI green or finishing. No action needed beyond
     waiting for the in-flight `playwright smoke suite` run.
   - **#58 (`lul-25-bog-map-landmarks`) and #59 (`lul-287-agents-md-backmerge`)** —
     approved and previously green, but 3 and 1 commits **behind** `main` respectively.
     I called `PUT /repos/DadonStyle/LULLWOOD/pulls/{n}/update-branch` on each by hand.
     That endpoint performs a real merge commit from `main` into the PR branch — not a
     rebase, no force-push — so it's the same operation the manual loop does, just via
     the API instead of a local `git merge` + push. Both came back `ahead_by: 2,
     behind_by: 0` immediately after. No conflicts, so no risk of the "logic and function
     loss" the founder was worried about — a real conflict would have made the call fail
     instead of silently resolving one side.
   - #60 (`lul-363-charge-dodge-e2e`) — **not approved**, and `playwright smoke suite`
     failed on its head commit. Left alone; this is a review/CI failure, not a staleness
     problem, and fixing the underlying e2e failure isn't this ticket's scope.
   - #61 (`lul-26-difficulty-accessibility`) — not yet approved, CI green. Left for the
     Code Reviewer; nothing for a freshness check to do here.

2. **Added `.github/workflows/pr-freshness.yml`** (this is the actual "check" the founder
   asked for going forward). It:
   - Triggers on every push to `main` (i.e. right after any merge, when staleness is
     created), on a 30-minute schedule as a fallback, and on `workflow_dispatch`.
   - Lists open `lul-*` PRs and their `mergeStateStatus`.
   - For every one that is `BEHIND`, calls the same `update-branch` API used above.
   - If `update-branch` fails (a real conflict — the one case it can't handle safely), it
     leaves a comment on the PR pointing at the manual backmerge loop and the no-force-push
     decision, instead of guessing at a resolution. It only comments once per PR (checks
     for its own marker first) so it doesn't spam on every scheduled run.
   - Uses `contents: write` + `pull-requests: write` on `${{ github.token }}`, same
     permission shape as `auto-pr.yml` and `automerge.yml`.

   This PR (`lul-380-pr-freshness-check`, opens as a PR automatically per `auto-pr.yml`)
   **cannot self-merge with `[ship]`** — `.github/scripts/ship-allowed.sh` denies all of
   `.github/workflows/*` unconditionally, specifically so a new workflow can't grant itself
   permissions and merge unreviewed. It needs a normal Code Reviewer `REVIEW: APPROVED`
   like any game/app change, even though the diff is CI-only.

## How PR handling works now, end to end

1. An agent pushes a branch named `lul-*`. `auto-pr.yml` fires **on that push** (not on the
   PR — the PR doesn't exist yet at push time) and opens a PR if one isn't already open for
   that branch.
2. CI (`ci.yml`: build/typecheck/lint, unit tests, Playwright smoke suite) runs off the
   same push.
3. If the head commit's message has a `[ship]` marker on its own line, `auto-pr.yml`
   checks the diff against `ship-allowed.sh`'s allowlist (docs, CI config excluding the
   allowlist script and workflows themselves, and `e2e/`/`playwright.config.ts`). If the
   diff is inside the allowlist, it arms `gh pr merge --auto --squash`; `automerge.yml` is
   the fallback if repo settings don't have "Allow auto-merge" on, and re-checks the same
   gate off the CI-completion event.
4. If the diff touches anything outside that allowlist (game/app/engine/lib code), `[ship]`
   is explicitly ignored and the PR is commented to say so. It now needs a human-equivalent
   review: a Code Reviewer child issue is opened, and the reviewer leaves
   `REVIEW: APPROVED` as the first line of a Paperclip issue comment **and** a matching
   GitHub PR review. Only P0/P1 findings block; P2/P3 become tickets and don't hold the
   merge.
5. **On a failed review** (`CHANGES REQUESTED` / a P0 or P1 finding): the PR stays open,
   the finding is reported with severity + repro, and the owning agent fixes it on the same
   branch and re-pushes. Re-push re-triggers CI (step 2) and, if needed, a fresh review
   pass — reviewers re-review at the new head sha, they don't rubber-stamp the old
   approval forward.
6. **Staleness coverage (new, this ticket):** independent of review outcome, if `main`
   moves while a PR is open, `pr-freshness.yml` now backmerges it automatically within the
   push-triggered run (or within 30 minutes via the schedule as a fallback) so an approved,
   green PR doesn't sit `BEHIND` waiting for an agent to notice. If the backmerge hits a
   real conflict, it stops and flags the PR for a human/agent to resolve by hand — it will
   not guess at conflict resolution.
7. Merge itself (once approved + green + up to date) is a `squash` merge via the API,
   documented in `AGENTS.md`'s "Who may merge what" section. `main`'s ruleset still
   adjudicates every merge attempt regardless of what any workflow believes the state is —
   a red check or a stale branch is refused at the API level, not just at the workflow
   level.

## What was NOT changed

- No conflict-resolution logic. A real conflict is a judgement call (which side's change
  wins) and stays a manual/agent-reviewed action, matching the founder's "make sure there
  is no logic and function loss" instruction — an automated resolver is exactly the thing
  that could cause that loss silently.
- No change to the `[ship]` allowlist or the review gate itself — this only keeps branches
  mergeable, it does not change who is allowed to merge them.

## Follow-up pass, same day (LUL-380 re-woken)

Re-audited every open PR against a fresh `gh pr list` + per-PR compare API, since the
first pass only covered approved PRs:

- **#60 (`lul-363-charge-dodge-e2e`) and #61 (`lul-26-difficulty-accessibility`)** were
  still `BEHIND` and **not approved** (`CHANGES_REQUESTED` / review pending). The
  freshness workflow backmerges regardless of review status — staleness and review are
  independent problems — so for consistency with what `pr-freshness.yml` will now do on
  its own, I ran the same `update-branch` call on both by hand. Both came back
  `ahead_by: 2, behind_by: 0`, no conflicts. This does **not** touch #60's `CHANGES_REQUESTED`
  or its failing Playwright run — that's a real code fix owed by #60's owner, not a
  staleness problem, and out of this ticket's scope.
- Confirmed **zero open PRs are `BEHIND` main** as of this pass (`gh pr list` sweep: #55,
  #57, #58, #59 approved+`BLOCKED` only on in-flight CI after their own backmerge; #60,
  #61 now fresh but still gated on review/CI; #62 approved+`UNSTABLE` but `behind_by: 0`
  per the compare API — not a staleness issue; #63 is this PR itself, `BLOCKED` only on
  its own review; #64 is unrelated work from another agent, not stale).
- **PR #63 (this workflow) is still unreviewed.** I opened a Code Reviewer child issue
  (LUL-390) requesting `REVIEW: APPROVED` when it was first opened; it's still `todo` as
  of this pass — the check exists and is proven to work by hand, but the workflow file
  itself hasn't landed on `main` yet, so it isn't running automatically until that review
  clears. Everything above in this section was done manually with the same API call the
  workflow uses, precisely so open PRs don't sit stale while the review is pending.
- Landing #55/#57/#58/#59/#62 themselves is not this ticket's job: #55/#57 are owned by
  LUL-361 ("drain the merge lane", Founding Engineer, actively running); #58/#59/#62 have
  no conflicting owner but were still mid-CI at last check, so there was nothing mergeable
  to act on.

---

# UPDATE 2026-08-19 — the check above works by hand, but is a no-op in production, and it was jamming the merge lane

Added by VP R&D, 2026-08-19T00:50–01:00Z. Everything above this line is accurate about
what was *built*. This section is about what it actually *does* once it runs unattended.
Tracked as **LUL-439** (Founding Engineer, critical).

## Short answer to the founder's three questions

**"Is there cover for not-updated branches?"** Yes — `pr-freshness.yml` landed and runs.
But the cover was **negative**: every branch it refreshed became *permanently* unmergeable.
It is now the highest-priority infrastructure ticket in the studio.

**"How are PRs handled now?"** As described above, with one correction: the up-to-date
backmerge step silently strips CI coverage from the branch it just helped.

**"What happens on a failed review? What's the cycle?"** Unchanged and working:
reviewer posts `CHANGES_REQUESTED` and blocks only on P0/P1 (P2/P3 become tickets, nits
are suggestions) → the owning agent pushes a fix to the same branch → CI re-runs on the new
head → a re-review ticket is filed against the Code Reviewer → on `REVIEW: APPROVED` a
landing ticket merges it. The weak link was never the review cycle; it was that the *merge*
step had no live owner, and now also that CI silently stopped reporting.

## The bug

Two workflows, each correct in isolation, that cancel each other out:

1. **`ci.yml` makes the `push` trigger load-bearing.** Every job is guarded with
   `if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name != github.repository`,
   so for a same-repo `lul-*` branch the `pull_request` run is **skipped by design**
   (LUL-100, to stop the double-run). Required contexts come only from the **push** run.
2. **`pr-freshness.yml` calls `update-branch` under `GH_TOKEN: ${{ github.token }}`** —
   GITHUB_TOKEN.

GitHub does not raise workflow-triggering events for commits authored by GITHUB_TOKEN. So a
branch refreshed by `pr-freshness` gets a new head sha with **no push run** (suppressed) and
**no pull_request run** (skipped by the fork guard). All three required contexts —
`build, typecheck, lint`, `playwright smoke suite`, `unit tests` — are then **MISSING
forever** on that head, and the ruleset can never be satisfied no matter how many approvals
the PR has.

**The automation built to unstick PRs is what was permanently sticking them.**

## Evidence

Heads refreshed by `pr-freshness` — one check run each, all required contexts absent:

| PR | head sha | checks present | required contexts |
|----|----------|----------------|-------------------|
| #58 | `154053d4` | `Vercel Preview Comments` only | all 3 MISSING |
| #60 | `b52b750f` | `Vercel Preview Comments` only | all 3 MISSING |
| #66 | `e7423873` | `Vercel Preview Comments` only | all 3 MISSING |

Heads pushed by a real agent credential — all three green: #64 (`b0ae5afb`), #67 (`9af2069c`).

**Control experiment.** I re-ran the *identical* `update-branch` call on #58 and #60 with
the studio PAT instead of GITHUB_TOKEN. New heads `c7f0cce3` / `1ca8c205`, and `CI / push`
runs started on both immediately. Same call, same repo, same branches — only the credential
differed. That isolates the cause to the token.

**Refinement:** the suppression follows the *actor chain*, not just the token. `e7423873`
was refreshed on a chain rooted in `github-actions[bot]` → no push run, stuck. `872dec66`
was refreshed on a chain rooted in my PAT-authenticated merge → push run fired. So
`pr-freshness` poisons a head only when its own trigger chain is bot-rooted, which is the
common case. **This is why the jam looked intermittent** and why several audit passes
reasonably wrote it off as "transient, still pending."

## Why it went unnoticed for days

Three signals each lied in a way that resembled good news:

1. `mergeStateStatus: BLOCKED` alongside `reviewDecision: APPROVED` reads as "a check is
   red." Nothing was red — nothing had run.
2. GraphQL `statusCheckRollup.state` returned **SUCCESS** for #66 and #60, because Vercel's
   single green check *is* the entire rollup. A green rollup over zero required checks.
3. 11 CI runs sat at `action_required` (oldest 2026-08-15), which looked like the cause. I
   approved four; **every one concluded `skipped`** via the fork guard. Approving them is
   not a workaround.

**The rule that replaces the old audit:** assert each required context is present **by name**
on the PR's actual head sha. Never read the rollup state. `MISSING` and `failure` are
opposite diagnoses — `MISSING` means no code fix will ever help until someone pushes from a
real credential.

One further trap, which caught me mid-investigation: most shas carry each context name
**twice** (the fork-guard-`skipped` `pull_request` copy plus the real one). Keying check
runs by name lets the `skipped` copy overwrite the real result. Group by name and keep every
conclusion.

## The fix — pick one, do not half-apply

1. **Give `pr-freshness.yml` a real credential** (PAT in a repo secret). Smallest change.
   Adding a secret is a founder approval gate, so it needs Noam's sign-off first.
2. **Make `ci.yml` cover the gap** — let the `pull_request` run proceed when the head sha has
   no push-run coverage. No secret needed, but reintroduces some of the LUL-100 double-run.
3. **Land the merge queue (LUL-359) and delete `pr-freshness` entirely.** A merge queue does
   its own up-to-date builds, making strict-mode backmerging obsolete. This is the real fix;
   1 or 2 is the stopgap.

Whichever lands, prove it the way this was proved: refresh a branch, then assert each
required context **by name** on the new head. A green rollup is not the assertion.

## Lane state after this pass (2026-08-19T~01:00Z)

- **PR #65 merged** as `16daa4f1` — unjams LUL-387 → LUL-382 / LUL-384 / LUL-383 (collisions).
- **#58** — real `build, typecheck, lint` **failure**. The only genuine code defect in the
  lane. Owner: LUL-427 (Game Engineer).
- **#60, #66** — build + unit green on their new heads, smoke suite running. Owners:
  LUL-432 (re-review), LUL-433 (land).
- **#64** — green, `CHANGES_REQUESTED`. Owner: LUL-434 (Code Reviewer).
- **#67** — all three green but `CONFLICTING`; `pr-freshness` deliberately won't touch a
  conflict. Owner: LUL-428 (Game Engineer), manual backmerge, no force-push.

Everything in the lane except #58 was this infrastructure bug wearing a code bug's clothes.
