<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# How to ship a change

`main` is protected: no direct pushes, a pull request is mandatory, and both CI
checks must be green. Agents push with an SSH deploy key, which can move refs
but has no GitHub API scope — it cannot open or merge a PR. So the whole
workflow rides on `git push`:

```bash
export GIT_SSH_COMMAND="ssh -i $HOME/.lullwood/deploy_key -o IdentitiesOnly=yes"
git push origin HEAD:refs/heads/lul-42-short-description
```

- Name the branch `lul-<ticket>-<slug>`. `.github/workflows/auto-pr.yml` opens a
  pull request against **`release/next`** for any branch matching `lul-*`.
  (`release/next` feeds into `main` at version gates; it has the same checks as
  `main` but `strict: false`, so you never need to backmerge it before CI runs.)
- Put a `[ship]` marker on a commit when the work is ready to land. The PR is
  then squash-merged automatically once both checks pass. Leave it out and the
  PR stays open for review — that is the right default for a WIP push.

  **The marker must be a line of its own.** The check is an exact-line match, so
  `[ship]` appended to a descriptive subject line is silently ignored and that PR
  will never self-merge. It is read from every commit the branch authored (not
  just the head — a backmerge replaces the head with a merge commit), so tagging
  a branch you have already pushed is one command:

  ```bash
  git commit --allow-empty -m '[ship]' && git push
  ```

  Get this wrong and `auto-pr.yml` leaves a one-time comment on the PR saying so.
  It never blocks anything.
- CI runs on the branch push, not on the PR (see the comment at the top of
  `ci.yml`). Watch the checks on the head commit.
- If the merge is refused, the branch is behind `release/next`: **backmerge**
  `release/next` into the branch and push again. Never rebase — that needs a
  force-push, which is banned (see below).

  ```bash
  git fetch --no-tags origin release/next
  git merge FETCH_HEAD   # resolve conflicts here, commit the merge
  git push origin HEAD:refs/heads/lul-<ticket>-<slug>   # plain, fast-forward
  ```

  Merge commits on a feature branch are expected and correct: every PR lands via
  squash-merge, so the branch collapses to one commit and `release/next` stays linear.

Never try to push `main` directly — the ruleset rejects it for every actor
including the founder.

**Force-push is banned on every branch, including your own `lul-*` branch.** That
covers `--force` and `--force-with-lease`, and the disguised forms: interactive
rebase on a pushed branch, `--amend` on a pushed commit, reset-and-repush. There
is no "it's my own branch" carve-out and no approval that unlocks one. Branches
track `main` by backmerge, as above.

## Tests

**Changing logic means changing its tests, in the same PR.** If you change a
pure function's behaviour on purpose, update its unit tests in the same
commit. A behaviour change with an untouched test file is not "tests still
pass" — it means the tests were not testing that behaviour. New pure logic
ships with its tests or it does not ship.

Unit tests are `node --test`, colocated as `*.test.ts`. Pure logic only — no
Three.js, no DOM, no `window`, no timers, no wall-clock reads, no unseeded
`Math.random()`. Rendering and input stay Playwright's job.

## Review tiers (development-first, founder directive 2026-08-29)

Measured the day this landed: the two building agents ran 803 sessions in a week; the two
gating agents ran 853. More than half the studio's effort was spent checking work rather
than making it. These tiers exist to change that ratio on purpose.

Tier is decided by **what the diff touches**, not who wrote it or how large it is. When a
diff spans tiers, the **highest** tier wins. State your tier in one line in the PR body,
e.g. `Tier: B — components/Hud.tsx`.

| Tier | Paths | Gate |
|---|---|---|
| **A** | `docs/**`, `*.md`, `e2e/**`, `*.test.*`, comment-only diffs, `public/` assets, copy | Ship on green. No review, no play verdict. `[ship]` permitted. |
| **B** | `app/**`, `lib/**`, `components/**`, non-security CI, engine tuning constants | Merge on green; open the review child issue **after**. A P0/P1 found post-merge is a fix ticket, not a revert. |
| **C** | `engine/forest-engine.js` simulation (movement, collision, predator AI, scent, hiding, win/lose), persistence, **anything touching secrets, tokens, auth, branch protection or merge rules**, release cuts | Blocking review + Game Tester play verdict. Unchanged. |

**If you review:** only Tier C blocks. Batch P2/P3 into the single standing hygiene
ticket rather than one ticket per finding — per-finding ticketing is what inflated the
board. The LUL-389 checklist items ("logic diff with no test diff", "registry not
updated") are **P2** in Tiers A and B, and remain P1 blockers in Tier C.

**If you test:** stop verifying every build. The Playwright suite is the gate for A and
B. Spend play sessions on Tier C, new or changed predator behaviour, core-loop changes,
mobile input, and release cuts.

**Not relaxed by any of this:** CI is required on every tier; P0/P1 still block in Tier C;
every secrets rule is unchanged; mobile parity is unchanged; never switch branches in
`/home/noam/lullwood`.

**Honest tradeoff:** Tier B means some defects reach `release/next` that a pre-merge
review would have caught. That is accepted in exchange for shipping roughly twice as
much. If it starts producing P0s rather than P2s, that is evidence — record it in
`decisions/` and move the tier boundary. Do not silently drift back to reviewing
everything.

**Known gap:** `release/next` requires 1 approving review, so Tier B cannot literally
merge on green yet. `bot-approve.yml` records an approval as `github-actions[bot]` — a
distinct identity from the studio PAT — only when every required check is green, no
approval exists, and it did not author the PR. Wiring it to fire automatically for
Tier-B-only diffs is open work; until then Tier B still waits on the Code Reviewer.

## The release train

Feature branches target `release/next`. The **only** path to `main` is a version cut
(`release/next` → `main`), enforced by `base-branch-guard.yml`.

**Cut PRs must merge with a real merge commit, never a squash.** A squash discards the
second parent, so `main` and `release/next` stop sharing an ancestor and every subsequent
cut opens with conflicts. This has already happened; see the CRITICAL ticket and
`docs/HOW_IT_WORKS.md` § 8.
