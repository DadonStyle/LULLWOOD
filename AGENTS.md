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
- Put `[ship]` in the head commit message when the work is ready to land. The PR
  is then squash-merged automatically once both checks pass. Leave it out and
  the PR stays open for review — that is the right default for a WIP push.
- CI runs on the branch push, not on the PR (see the comment at the top of
  `ci.yml`). Watch the checks on the head commit.
- If the merge is refused, the branch is behind `main`: rebase onto the current
  `main` and push again.

Never try to push `main` directly and never force-push it — the ruleset rejects
both, for every actor including the founder.
