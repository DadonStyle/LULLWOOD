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
  pull request against `main` for any branch matching `lul-*`.
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
- If the merge is refused, the branch is behind `main`: **backmerge** `main` into
  the branch and push again. Never rebase — that needs a force-push, which is
  banned (see below).

  ```bash
  git fetch --no-tags origin main
  git merge FETCH_HEAD   # resolve conflicts here, commit the merge
  git push origin HEAD:refs/heads/lul-<ticket>-<slug>   # plain, fast-forward
  ```

  Merge commits on a feature branch are expected and correct: every PR lands via
  squash-merge, so the branch collapses to one commit and `main` stays linear.

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
