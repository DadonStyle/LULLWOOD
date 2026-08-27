#!/usr/bin/env bash
# LUL-589: base-branch enforcement -- systems/release-train-delivered "Trap 1".
#
# The release train (systems/release-train) only works because feature PRs
# land on `release/next`, and a version cut (`release/next` -> `main`,
# LUL-497) is the one path that reaches `main`. Nothing in CI enforced that
# before this: PR #107 sat open with `base: main` for three hours, opened by
# a stale copy of auto-pr.yml, and was only caught by a human reading PRs by
# hand. The rule: a PR whose base is `main` must have head `release/next`
# (the version cut), or carry an explicit `emergency-hotfix` label (a loud,
# opt-in escape hatch for a genuine hotfix -- never the silent default).
#
# Two ways this runs, both driving the same decide_one():
#
#   single (real, no API call): the `pull_request` trigger already hands us
#     base/head/labels in the event payload, so for the direct case there's
#     nothing to fetch. Env: PR_NUMBER, PR_BASE, PR_HEAD, PR_LABELS (comma-
#     separated). Exit 0/1 IS the check result for that PR's head SHA
#     (GitHub posts it automatically under this job's name).
#
#   sweep (real, via `gh`, or fixture for testing): PRs opened by
#     auto-pr.yml use GITHUB_TOKEN, and GitHub suppresses `pull_request`
#     runs an action's own GITHUB_TOKEN would trigger (recursion guard) --
#     see workflow-guard-check.yml's `on:` comment for the same fact cited
#     for the sibling check. So `pull_request: opened` never fires for the
#     exact PRs this exists to catch, which is how PR #107 went unnoticed
#     for three hours. The sweep (real mode: REPO + GH_TOKEN, lists every
#     OPEN PR -- not just `base:main` -- and posts a commit status per head
#     SHA under the SAME context ("base branch guard") the single-PR path
#     uses, so either path satisfies the one required check) closes that
#     gap on a cadence, same shape as deployment-budget.yml's
#     `*/20 * * * *` sweep.
#
#     LUL-841: the sweep used to fetch only `--base main` PRs, which meant
#     a PR that briefly targeted `main` (getting a real FAILURE posted by
#     `single`) and was then retargeted to `release/next` dropped out of
#     the list the very next cycle -- nobody ever revisited it, so the
#     FAILURE sat on that head SHA forever with no path back to green
#     (PRs #173, #162). `decide_one` already returned "ok" for base!=main,
#     it just never got called for these because the `gh pr list` filter
#     excluded them. Fix: list every open PR (no `--base` filter) and, for
#     any PR whose base is no longer `main`, check its statusCheckRollup
#     for a stale "base branch guard" CheckRun FAILURE with no newer
#     StatusContext fix already covering it (`is_stale_failure` below) --
#     if found, post state=success/"retargeted off main" the same way the
#     base=main path always has. A PR that never carried this check, or
#     whose stale failure was already cleared by an earlier sweep cycle,
#     gets no post -- this isn't "repost success for every open PR every
#     20 minutes forever," only "revisit the ones still showing red for a
#     reason that no longer applies."
#
#     Fixture mode: BASE_BRANCH_GUARD_FIXTURE points at a JSON array of
#     `{"number":N,"baseRefName":"...","headRefName":"...","labels":[...],
#     "headRefOid":"...","statusCheckRollup":[...]}` objects (the last two
#     optional, matching `gh pr list --json ...,headRefOid,statusCheckRollup`
#     shape) and nothing touches the network. Used by
#     base-branch-guard-cases.sh.
#
# Exit: 0 if every base:main PR considered is fine, 1 if at least one
# violates and isn't labelled `emergency-hotfix`.
#
# Usage:
#   PR_NUMBER=.. PR_BASE=.. PR_HEAD=.. PR_LABELS=.. base-branch-guard.sh
#   REPO=.. GH_TOKEN=.. base-branch-guard.sh
#   BASE_BRANCH_GUARD_FIXTURE=path.json base-branch-guard.sh

set -euo pipefail

# Prints "ok", "ok (emergency-hotfix)" or "violation: <message>" on stdout.
decide_one() {
  local number="$1" base="$2" head="$3" labels_csv="$4"

  if [ "$base" != "main" ]; then
    echo "ok"
    return
  fi
  if [ "$head" = "release/next" ]; then
    echo "ok"
    return
  fi
  if printf '%s\n' "$labels_csv" | tr ',' '\n' | grep -qxF 'emergency-hotfix'; then
    echo "ok (emergency-hotfix)"
    return
  fi

  echo "violation: PR #$number targets \`main\` directly from \`$head\`, bypassing the release train (systems/release-train in the shared wiki). Fix: \`gh pr edit $number --base release/next\`. If this is a genuine hotfix that must skip the train, add the \`emergency-hotfix\` label to make that explicit instead of silent."
}

run_sweep_from_json() {
  local prs_file="$1"
  local post_status="$2"  # "1" to post commit statuses (real sweep), "0" for fixture/offline
  local any_violation=0
  local any_post_failure=0

  # \x1f (unit separator), not a tab: bash's `read` squashes runs of IFS
  # *whitespace* (space/tab/newline) into one delimiter and drops empty
  # fields between them regardless of what IFS is set to -- LUL-841, found
  # here because an unlabeled PR (the common case) has an empty `labels`
  # field, which silently shifted `sha` (and now `revisit`) out from under
  # every PR with no labels, in both the pre-existing code and while
  # developing this fix. \x1f is not IFS-whitespace, so empty fields
  # survive.
  while IFS=$'\x1f' read -r number base head labels sha revisit; do
    [ -z "$number" ] && continue
    result="$(decide_one "$number" "$base" "$head" "$labels")"
    case "$result" in
      ok*)
        echo "PR #$number ($base <- $head): $result"
        # base=main always reposts the current verdict (unchanged LUL-589
        # behavior). base!=main only reposts when `revisit` (computed below
        # from statusCheckRollup) says this head SHA still shows a stale
        # "base branch guard" FAILURE from before it was retargeted --
        # LUL-841. A PR that never had this check fail, or whose failure
        # was already cleared by an earlier sweep cycle, gets no post.
        if [ "$base" = "main" ]; then
          desc="base=$head is fine"
        elif [ "$revisit" = "1" ]; then
          desc="base=$head, retargeted off main"
        else
          desc=""
        fi
        if [ -n "$desc" ]; then
          echo "  post: state=success context='base branch guard' sha=$sha desc=\"$desc\""
          if [ "$post_status" = "1" ]; then
            # LUL-851: a missing `statuses: write` scope makes this call
            # 404 (GitHub's shape for a GITHUB_TOKEN missing a permission
            # on this endpoint, not 403) -- it was previously piped to
            # /dev/null with no exit-code check, so the sweep posted
            # nothing and still exited 0. Loud on purpose now.
            if ! gh api "repos/${REPO:?}/statuses/$sha" \
              -f state=success \
              -f context='base branch guard' \
              -f description="$desc" > /dev/null; then
              echo "::error::base-branch-guard: failed to post success status for PR #$number sha=$sha via gh api repos/${REPO}/statuses/$sha" >&2
              any_post_failure=1
            fi
          fi
        fi
        ;;
      violation:*)
        any_violation=1
        msg="${result#violation: }"
        echo "PR #$number ($base <- $head): VIOLATION -- $msg"
        if [ "$post_status" = "1" ]; then
          if ! gh api "repos/${REPO:?}/statuses/$sha" \
            -f state=failure \
            -f context='base branch guard' \
            -f description="base=main requires head=release/next or the emergency-hotfix label" > /dev/null; then
            echo "::error::base-branch-guard: failed to post failure status for PR #$number sha=$sha via gh api repos/${REPO}/statuses/$sha" >&2
            any_post_failure=1
          fi
          # Best-effort, once per PR -- same de-dup convention auto-pr.yml
          # uses for SHIP_DENIED/SHIP_MALFORMED.
          if ! gh pr view "$number" --repo "${REPO:?}" --json comments \
               --jq '.comments[].body' 2>/dev/null | grep -qF 'BASE_BRANCH_VIOLATION'; then
            printf '%s\n' \
              '<!-- BASE_BRANCH_VIOLATION -->' \
              "$msg" > /tmp/base-branch-violation.md
            gh pr comment "$number" --repo "${REPO:?}" --body-file /tmp/base-branch-violation.md || true
          fi
        fi
        ;;
    esac
  done < <(python3 -c '
import json, sys

def is_stale_failure(rollup):
    # True if the most recent "base branch guard" CheckRun on this head SHA
    # is a FAILURE and no later StatusContext success (our own earlier fix)
    # already supersedes it. CheckRun and StatusContext are distinct
    # objects on GitHub'"'"'s side -- posting a success StatusContext does
    # not erase the old failing CheckRun, it just needs to be the newer of
    # the two for this PR to be considered fixed already.
    fail_time = None
    fix_time = None
    for item in rollup or []:
        ident = item.get("name") or item.get("context")
        if ident != "base branch guard":
            continue
        typename = item.get("__typename")
        if typename == "CheckRun" and item.get("conclusion") == "FAILURE":
            t = item.get("completedAt") or item.get("startedAt") or ""
            if fail_time is None or t > fail_time:
                fail_time = t
        elif typename == "StatusContext" and item.get("state") == "SUCCESS":
            t = item.get("startedAt") or ""
            if fix_time is None or t > fix_time:
                fix_time = t
    if fail_time is None:
        return False
    return fix_time is None or fix_time <= fail_time

prs = json.load(open(sys.argv[1]))
for pr in prs:
    labels = ",".join(l["name"] if isinstance(l, dict) else l for l in pr.get("labels", []))
    sha = pr.get("headRefOid") or pr.get("sha") or ""
    base = pr["baseRefName"]
    revisit = "1" if base != "main" and is_stale_failure(pr.get("statusCheckRollup")) else "0"
    print(pr["number"], base, pr["headRefName"], labels, sha, revisit, sep="\x1f")
' "$prs_file")

  if [ "$any_violation" = "1" ] || [ "$any_post_failure" = "1" ]; then
    return 1
  fi
  return 0
}

if [ -n "${PR_NUMBER:-}" ]; then
  # single mode: decide the one PR the pull_request event handed us, no API call.
  result="$(decide_one "$PR_NUMBER" "$PR_BASE" "$PR_HEAD" "${PR_LABELS:-}")"
  echo "PR #$PR_NUMBER ($PR_BASE <- $PR_HEAD): $result"
  case "$result" in
    violation:*)
      echo "::error::${result#violation: }" >&2
      exit 1
      ;;
    "ok (emergency-hotfix)")
      # Loud on purpose (ticket ask): the bypass is opt-in via a label
      # anyone can see on the PR, and this notice is the same signal in
      # the check output so it isn't only discoverable by reading labels.
      echo "::notice::base-branch-guard: PR #$PR_NUMBER targets main directly from '$PR_HEAD', allowed only because it carries the emergency-hotfix label."
      ;;
  esac
  exit 0

elif [ -n "${BASE_BRANCH_GUARD_FIXTURE:-}" ]; then
  # fixture sweep: offline, no gh calls, no commit statuses posted.
  set +e
  run_sweep_from_json "$BASE_BRANCH_GUARD_FIXTURE" 0
  rc=$?
  set -e
  exit "$rc"

else
  # real sweep: list EVERY open PR (not just base:main -- LUL-841, so a PR
  # retargeted off main this cycle is still here to be revisited), decide,
  # post a commit status per base:main head SHA plus any stale-failure
  # head SHA that needs clearing.
  : "${REPO:?REPO env var required in real sweep mode}"
  : "${GH_TOKEN:?GH_TOKEN env var required in real sweep mode}"
  prs_file="$(mktemp)"
  trap 'rm -f "$prs_file"' EXIT
  gh pr list --repo "$REPO" --state open \
    --json number,baseRefName,headRefName,headRefOid,labels,statusCheckRollup > "$prs_file"
  set +e
  run_sweep_from_json "$prs_file" 1
  rc=$?
  set -e
  if [ "$rc" != "0" ]; then
    echo "::error::base-branch-guard: sweep found at least one base:main violation or a commit-status post that failed (see ::error:: lines above for which)." >&2
  fi
  exit "$rc"
fi
