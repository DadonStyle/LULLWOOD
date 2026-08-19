#!/usr/bin/env bash
# Finishes a version cut (LUL-497 / LUL-492b) that `release-cut.yml` opened:
# merges `release/next` -> `main` with a merge commit, tags the result, and
# recreates `release/next` from the new `main` so it can't drift.
#
# Deliberately NOT a GitHub Actions workflow. `release/next`'s ruleset requires
# an approving review on every PR that touches it, including the "recreate"
# PR this script opens after the merge, with no bypass actor. Inside Actions
# the only identity available to approve a bot-authored PR is the studio PAT,
# and that PAT is not (as of this writing) provisioned as an Actions secret --
# adding it there is a secrets-provisioning decision, filed as a follow-up,
# not something to do unilaterally from inside a ticket about a workflow.
# Run under an agent's own PAT + deploy key instead, exactly like every other
# PR merge in this repo (AGENTS.md "Landing code" / systems/github-access) --
# this script only makes that sequence repeatable and safe to re-run, it does
# not change who's driving it.
#
# Preconditions this script assumes, not re-derives:
#   - the release PR (release/next -> main, title "Release <tag>") is open
#   - the Code Reviewer has posted `REVIEW: APPROVED` on its Paperclip review
#     child issue for the full-version review (LUL-492d mandate) -- this
#     script does not check Paperclip; the person running it has already
#     confirmed that verdict, same as any other PR merge in this studio.
#
# Usage:
#   .github/scripts/finish-release-cut.sh vYYYY.MM.DD-N          # dry run, prints the plan
#   .github/scripts/finish-release-cut.sh vYYYY.MM.DD-N --yes    # actually does it
#
# Requires (never echoed, never put on a command line):
#   GH_TOKEN                  -- the studio PAT (export before running:
#                                 export GH_TOKEN=$(tr -d ' \n\r' < ~/.lullwood/gh_token))
#   GIT_SSH_COMMAND            -- pointed at the deploy key, for the recreate push:
#                                 export GIT_SSH_COMMAND="ssh -i $HOME/.lullwood/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

set -euo pipefail

REPO="DadonStyle/LULLWOOD"
REQUIRED_CHECKS=("build, typecheck, lint" "unit tests" "playwright smoke suite")

tag="${1:?usage: finish-release-cut.sh vYYYY.MM.DD-N [--yes]}"
apply=false
if [ "${2:-}" = "--yes" ]; then
  apply=true
fi

if [ -z "${GH_TOKEN:-}" ]; then
  echo "::error:: GH_TOKEN is not set. export GH_TOKEN=\$(tr -d ' \\n\\r' < ~/.lullwood/gh_token) first." >&2
  exit 1
fi

wait_for_checks() {
  local sha="$1" deadline name latest status conclusion all_green summary runs_json
  deadline=$((SECONDS + 35 * 60))
  while :; do
    runs_json="$(gh api "repos/$REPO/commits/$sha/check-runs" --paginate --jq '[.check_runs[]]')"
    all_green=true
    summary=""
    for name in "${REQUIRED_CHECKS[@]}"; do
      latest="$(printf '%s' "$runs_json" | jq --arg n "$name" '[.[] | select(.name == $n)] | sort_by(.started_at) | last')"
      if [ "$latest" = "null" ] || [ -z "$latest" ]; then
        status="missing"; conclusion="-"
      else
        status="$(printf '%s' "$latest" | jq -r '.status')"
        conclusion="$(printf '%s' "$latest" | jq -r '.conclusion // "-"')"
      fi
      summary="$summary  $name: $status/$conclusion"
      if [ "$status" != "completed" ] || [ "$conclusion" != "success" ]; then
        all_green=false
      fi
    done
    if [ "$all_green" = true ]; then
      echo "all required checks green on $sha" >&2
      return 0
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "::error::required checks on $sha did not all report success within 35 minutes:$summary" >&2
      return 1
    fi
    echo "polling, not green yet:$summary" >&2
    sleep 30
  done
}

echo "== finish-release-cut: $tag (apply=$apply) =="

number="$(gh pr list --repo "$REPO" --base main --head release/next --state open \
  --json number,title,mergeStateStatus,headRefOid --jq ".[] | select(.title == \"Release $tag\")")"
if [ -z "$number" ]; then
  echo "::error::no open PR titled 'Release $tag' from release/next -> main. Has release-cut.yml opened it yet?" >&2
  exit 1
fi
pr_number="$(printf '%s' "$number" | jq -r '.number')"
head_sha="$(printf '%s' "$number" | jq -r '.headRefOid')"
merge_state="$(printf '%s' "$number" | jq -r '.mergeStateStatus')"

echo "release PR: #$pr_number, head $head_sha, mergeStateStatus=$merge_state"

# Re-verify, don't trust a verdict rendered before this run started (LUL-512:
# a stale mergeStateStatus rollup can read clean while a required context is
# actually null/pending). Refuse a blocked/dirty/behind PR outright.
case "$merge_state" in
  clean|unstable) ;;
  *) echo "::error::PR #$pr_number mergeStateStatus is '$merge_state', not clean/unstable. Not proceeding." >&2; exit 1 ;;
esac

# A CHANGES_REQUESTED review newer than the head commit blocks just like a
# missing approval would -- Paperclip's REVIEW: APPROVED does not clear a
# stale native GitHub review (systems/github-access, LUL-512 entry).
stale_changes_requested="$(gh api "repos/$REPO/pulls/$pr_number/reviews" --paginate \
  --jq 'group_by(.user.login) | map(max_by(.submitted_at)) | map(select(.state == "CHANGES_REQUESTED")) | length')"
if [ "$stale_changes_requested" -gt 0 ]; then
  echo "::error::PR #$pr_number has an unresolved CHANGES_REQUESTED review. Not proceeding." >&2
  exit 1
fi

echo "confirming required checks are still green on $head_sha..."
wait_for_checks "$head_sha"

if [ "$apply" != true ]; then
  echo "-- dry run, stopping here. Re-run with --yes to merge #$pr_number, tag $tag, and recreate release/next."
  exit 0
fi

echo "merging #$pr_number with a merge commit..."
merge_sha="$(gh api -X PUT "repos/$REPO/pulls/$pr_number/merge" \
  -f merge_method=merge \
  -f commit_title="Release $tag" \
  --jq '.sha')"
echo "merged: main is now $merge_sha"

echo "tagging $tag @ $merge_sha..."
gh api -X POST "repos/$REPO/git/refs" \
  -f ref="refs/tags/$tag" \
  -f sha="$merge_sha" >/dev/null
echo "tagged $tag"

# Recreate release/next. Pushed as a lul-* branch so auto-pr.yml opens a
# bot-authored PR (github-actions[bot]) targeting release/next automatically
# -- a different identity from this PAT, so the approval below doesn't 422
# (systems/github-access self-approval table). No [ship] marker on this
# commit: this must merge with merge_method=merge, not auto-pr.yml's default
# squash, so main's tip commit stays a real ancestor of release/next's new
# tip -- that ancestry is what keeps the next cut's "is release/next behind
# main" check a simple, correct git rev-list rather than something that has
# to reason about tree equality.
recreate_branch="lul-497-recreate-release-next-${tag#v}"
tmp_worktree="$(mktemp -d)"
git clone --quiet "git@github.com:$REPO.git" "$tmp_worktree"
git -C "$tmp_worktree" checkout --quiet "$merge_sha"
git -C "$tmp_worktree" push --quiet origin "$merge_sha:refs/heads/$recreate_branch"
rm -rf "$tmp_worktree"
echo "pushed $recreate_branch (== main @ $merge_sha) for auto-pr.yml to open against release/next"

recreate_number=""
deadline=$((SECONDS + 5 * 60))
while [ -z "$recreate_number" ]; do
  recreate_number="$(gh pr list --repo "$REPO" --head "$recreate_branch" --state open --json number --jq '.[0].number // empty')"
  if [ -n "$recreate_number" ]; then
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::error::auto-pr.yml did not open a PR for $recreate_branch within 5 minutes. release/next was NOT recreated -- main and the tag are still correct, but this needs manual follow-up (open $recreate_branch -> release/next by hand)." >&2
    exit 1
  fi
  sleep 10
done
echo "recreate PR: #$recreate_number"

echo "confirming required checks on the recreate PR..."
wait_for_checks "$merge_sha"

echo "approving #$recreate_number (bot-authored, empty diff -- no reviewable content, just a ref sync)..."
gh api -X POST "repos/$REPO/pulls/$recreate_number/reviews" -f event=APPROVE >/dev/null

echo "merging #$recreate_number with a merge commit (preserves ancestry -- do not squash)..."
gh api -X PUT "repos/$REPO/pulls/$recreate_number/merge" \
  -f merge_method=merge \
  -f commit_title="LUL-497: recreate release/next from $tag" >/dev/null

echo "deleting $recreate_branch..."
gh api -X DELETE "repos/$REPO/git/refs/heads/$recreate_branch" >/dev/null || \
  echo "::warning::couldn't delete $recreate_branch; harmless, clean up by hand later."

echo "== done: $tag merged to main @ $merge_sha, tagged, release/next recreated =="
