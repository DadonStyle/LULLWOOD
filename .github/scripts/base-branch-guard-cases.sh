#!/usr/bin/env bash
# LUL-589 verification harness for base-branch-guard.sh.
#
# Not wired into CI -- this is the reproducible record that proves the
# base==main enforcement actually fires, both for the single-PR path (the
# `pull_request` trigger's own event fields, no API call) and the sweep
# path (fixture JSON standing in for `gh pr list`). Per the standing rule
# (systems/*, "a passing check that executed zero assertions is
# indistinguishable from a working one"), reproduces PR #107's exact shape:
# base=main, head a plain lul-* branch, no label.
#
# Usage: .github/scripts/base-branch-guard-cases.sh

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/.github/scripts/base-branch-guard.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail=0

# --- single mode: the pull_request-event path, no gh calls -------------------
run_single() {
  local name="$1" number="$2" base="$3" head="$4" labels="$5" expect_exit="$6"
  local actual_exit=0
  local out
  out="$(PR_NUMBER="$number" PR_BASE="$base" PR_HEAD="$head" PR_LABELS="$labels" bash "$script" 2>&1)" || actual_exit=$?
  if [ "$actual_exit" != "$expect_exit" ]; then
    echo "FAIL: single/$name -- expected exit $expect_exit, got $actual_exit" >&2
    echo "$out" | sed 's/^/    /' >&2
    fail=1
    return
  fi
  echo "ok: single/$name -> exit $actual_exit as expected"
}

# PR #107's exact shape: base=main, head a plain feature branch, no label.
run_single "PR #107 shape (lul-* head, no label)" 107 main lul-578-p3-engine-nit-sweep "" 1
run_single "the version cut (head=release/next)"  109 main release/next "" 0
run_single "emergency-hotfix label bypasses"       200 main lul-999-hotfix "bug,emergency-hotfix" 0
run_single "base != main is never this check's business" 50 release/next lul-50-thing "" 0
run_single "base=main, head=main is nonsensical but still a violation" 60 main main "" 1

# --- sweep mode: fixture JSON standing in for `gh pr list` -------------------
run_sweep() {
  local name="$1" fixture_json="$2" expect_exit="$3"
  local fixture="$tmp/$name.json"
  printf '%s' "$fixture_json" > "$fixture"
  local actual_exit=0
  local out
  out="$(BASE_BRANCH_GUARD_FIXTURE="$fixture" bash "$script" 2>&1)" || actual_exit=$?
  if [ "$actual_exit" != "$expect_exit" ]; then
    echo "FAIL: sweep/$name -- expected exit $expect_exit, got $actual_exit" >&2
    echo "$out" | sed 's/^/    /' >&2
    fail=1
    return
  fi
  echo "ok: sweep/$name -> exit $actual_exit as expected"
}

run_sweep "all clean" '[
  {"number":83,"baseRefName":"release/next","headRefName":"lul-83-thing","labels":[]},
  {"number":109,"baseRefName":"main","headRefName":"release/next","labels":[]}
]' 0

run_sweep "PR #107 sitting in the lane, three hours unnoticed" '[
  {"number":83,"baseRefName":"release/next","headRefName":"lul-83-thing","labels":[]},
  {"number":107,"baseRefName":"main","headRefName":"lul-578-p3-engine-nit-sweep","labels":[]}
]' 1

run_sweep "mixed: one violation among several clean PRs" '[
  {"number":1,"baseRefName":"release/next","headRefName":"lul-1","labels":[]},
  {"number":2,"baseRefName":"main","headRefName":"release/next","labels":[]},
  {"number":3,"baseRefName":"main","headRefName":"lul-3-oops","labels":[{"name":"bug"}]}
]' 1

run_sweep "labelled hotfix does not trip the sweep" '[
  {"number":4,"baseRefName":"main","headRefName":"lul-4-hotfix","labels":[{"name":"emergency-hotfix"}]}
]' 0

if [ "$fail" != "0" ]; then
  echo
  echo "FAIL: at least one base-branch-guard case did not behave as expected." >&2
  exit 1
fi

echo
echo "All base-branch-guard cases passed, including the PR #107 reproduction (single and sweep paths)."
