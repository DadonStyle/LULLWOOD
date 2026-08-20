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
#     open `base:main` PR and posts a commit status per head SHA under the
#     SAME context ("base branch guard") the single-PR path uses, so either
#     path satisfies the one required check) closes that gap on a cadence,
#     same shape as deployment-budget.yml's `*/20 * * * *` sweep.
#     Fixture mode: BASE_BRANCH_GUARD_FIXTURE points at a JSON array of
#     `{"number":N,"baseRefName":"...","headRefName":"...","labels":[...]}`
#     objects and nothing touches the network. Used by
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

  while IFS=$'\t' read -r number base head labels sha; do
    [ -z "$number" ] && continue
    result="$(decide_one "$number" "$base" "$head" "$labels")"
    case "$result" in
      ok*)
        echo "PR #$number ($base <- $head): $result"
        if [ "$post_status" = "1" ] && [ "$base" = "main" ]; then
          gh api "repos/${REPO:?}/statuses/$sha" \
            -f state=success \
            -f context='base branch guard' \
            -f description="base=$head is fine" > /dev/null
        fi
        ;;
      violation:*)
        any_violation=1
        msg="${result#violation: }"
        echo "PR #$number ($base <- $head): VIOLATION -- $msg"
        if [ "$post_status" = "1" ]; then
          gh api "repos/${REPO:?}/statuses/$sha" \
            -f state=failure \
            -f context='base branch guard' \
            -f description="base=main requires head=release/next or the emergency-hotfix label" > /dev/null
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
prs = json.load(open(sys.argv[1]))
for pr in prs:
    labels = ",".join(l["name"] if isinstance(l, dict) else l for l in pr.get("labels", []))
    sha = pr.get("headRefOid") or pr.get("sha") or ""
    print(pr["number"], pr["baseRefName"], pr["headRefName"], labels, sha, sep="\t")
' "$prs_file")

  return "$any_violation"
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
  # real sweep: list every open PR, decide, post a commit status per base:main head SHA.
  : "${REPO:?REPO env var required in real sweep mode}"
  : "${GH_TOKEN:?GH_TOKEN env var required in real sweep mode}"
  prs_file="$(mktemp)"
  trap 'rm -f "$prs_file"' EXIT
  gh pr list --repo "$REPO" --state open --base main \
    --json number,baseRefName,headRefName,headRefOid,labels > "$prs_file"
  set +e
  run_sweep_from_json "$prs_file" 1
  rc=$?
  set -e
  if [ "$rc" != "0" ]; then
    echo "::error::base-branch-guard: at least one open PR targets main directly without release/next as head or an emergency-hotfix label." >&2
  fi
  exit "$rc"
fi
