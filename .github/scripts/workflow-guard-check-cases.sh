#!/usr/bin/env bash
# LUL-589 verification harness for workflow-guard-check.sh.
#
# Not wired into CI -- this is the reproducible record that proves the
# marker-absence check actually fires on both sides (a stripped marker
# fails, an intact one passes), kept so the next person can re-run it
# instead of trusting a workflow file that "looks right". Per the standing
# rule (systems/*, "a passing check that executed zero assertions is
# indistinguishable from a working one"), a guard that has never refused
# anything is not a guard. This reproduces PR #108's exact shape: a workflow
# file with zero references to a guard the manifest requires.
#
# Usage: .github/scripts/workflow-guard-check-cases.sh

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/.github/scripts/workflow-guard-check.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

manifest="$tmp/manifest.json"
cat > "$manifest" <<'EOF'
{
  "auto-pr.yml": ["deployment-budget.sh", "ship-allowed.sh"]
}
EOF

fail=0

run_case() {
  local name="$1" workflows_dir="$2" expect_exit="$3"
  local actual_exit=0
  local out
  out="$(WORKFLOW_GUARD_FIXTURE_MANIFEST="$manifest" WORKFLOW_GUARD_FIXTURE_WORKFLOWS_DIR="$workflows_dir" bash "$script" 2>&1)" || actual_exit=$?

  if [ "$actual_exit" != "$expect_exit" ]; then
    echo "FAIL: $name -- expected exit $expect_exit, got $actual_exit" >&2
    echo "$out" | sed 's/^/    /' >&2
    fail=1
    return
  fi
  echo "ok: $name -> exit $actual_exit as expected"
}

# --- case 1: both markers present (the healthy state) ------------------------
healthy="$tmp/healthy"
mkdir -p "$healthy"
cat > "$healthy/auto-pr.yml" <<'EOF'
name: Auto PR
on:
  push:
    branches: ['lul-*']
steps:
  - run: bash .github/scripts/deployment-budget.sh
  - run: git show FETCH_HEAD:.github/scripts/ship-allowed.sh
EOF
run_case "both markers present" "$healthy" 0

# --- case 2: PR #108's exact shape -- the file exists but references neither -
stale="$tmp/stale"
mkdir -p "$stale"
cat > "$stale/auto-pr.yml" <<'EOF'
name: Auto PR
on:
  push:
    branches: ['lul-*']
steps:
  - run: gh pr create --base main --head "$BRANCH"
EOF
run_case "PR #108 shape: zero references to either guard" "$stale" 1

# --- case 3: one marker survives, one was dropped -----------------------------
partial="$tmp/partial"
mkdir -p "$partial"
cat > "$partial/auto-pr.yml" <<'EOF'
name: Auto PR
on:
  push:
    branches: ['lul-*']
steps:
  - run: bash .github/scripts/deployment-budget.sh
EOF
run_case "one of two markers dropped" "$partial" 1

# --- case 4: the file itself is gone ------------------------------------------
deleted="$tmp/deleted"
mkdir -p "$deleted"
run_case "file deleted entirely" "$deleted" 1

# --- case 5: no manifest reachable -- fail closed, never silently pass -------
# Run from a bare empty directory (no .git at all, real mode, no fixture
# env vars) so `git show origin/main:...` fails deterministically no matter
# what this repo's own origin/main happens to contain right now -- this
# case must stay meaningful before AND after main actually has the
# manifest.
no_git_dir="$tmp/no-git"
mkdir -p "$no_git_dir"
actual_exit=0
out="$(cd "$no_git_dir" && bash "$script" 2>&1)" || actual_exit=$?
# Outside a git checkout (or with origin/main unreachable) `git show` fails,
# which must fail closed, not pass by default.
if [ "$actual_exit" = "0" ]; then
  echo "FAIL: no-manifest-reachable -- expected a non-zero (fail-closed) exit, got 0" >&2
  echo "$out" | sed 's/^/    /' >&2
  fail=1
else
  echo "ok: no-manifest-reachable -> exit $actual_exit (fail closed) as expected"
fi

if [ "$fail" != "0" ]; then
  echo
  echo "FAIL: at least one workflow-guard-check case did not behave as expected." >&2
  exit 1
fi

echo
echo "All workflow-guard-check cases passed, including the PR #108 reproduction and the fail-closed no-manifest case."
