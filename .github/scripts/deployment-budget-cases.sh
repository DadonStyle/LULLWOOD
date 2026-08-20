#!/usr/bin/env bash
# LUL-498 verification harness for the deployment-budget guard.
#
# Not wired into CI -- this is the reproducible record that proves
# deployment-budget.sh's three threshold branches (ok / alert / fail-closed)
# actually fire, kept so the next person can re-run it instead of trusting a
# workflow file that "looks right". Per the standing rule (systems/*, "a
# passing check that executed zero assertions is indistinguishable from a
# working one"), a guard that has never refused anything is not a guard.
#
# Usage: .github/scripts/deployment-budget-cases.sh

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/.github/scripts/deployment-budget.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Builds a fixture of $1 deployment records, all dated "now" (well inside the
# trailing-24h window), alternating Production/Preview like the real mix.
make_fixture() {
  local n="$1" out="$2"
  python3 -c '
import json, datetime, sys
n = int(sys.argv[1])
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
records = [
    {"created_at": now, "environment": "Production" if i % 10 == 0 else "Preview"}
    for i in range(n)
]
json.dump(records, open(sys.argv[2], "w"))
' "$n" "$out"
}

fail=0

run_case() {
  local name="$1" count="$2" expect_exit="$3"
  local fixture="$tmp/$name.json"
  make_fixture "$count" "$fixture"

  local actual_exit=0
  local out
  out="$(DEPLOYMENT_BUDGET_FIXTURE="$fixture" bash "$script" 2>&1)" || actual_exit=$?

  if [ "$actual_exit" != "$expect_exit" ]; then
    echo "FAIL: $name (count=$count) -- expected exit $expect_exit, got $actual_exit" >&2
    echo "$out" | sed 's/^/    /' >&2
    fail=1
    return
  fi
  echo "ok: $name (count=$count) -> exit $actual_exit as expected"
}

# --- also prove records OUTSIDE the 24h window are excluded from the count --
run_stale_case() {
  local fixture="$tmp/stale-mix.json"
  python3 -c '
import json, datetime
now = datetime.datetime.now(datetime.timezone.utc)
records = []
# 95 records from 25h ago (outside the window) -- must NOT trip fail-closed
old = (now - datetime.timedelta(hours=25)).isoformat()
records += [{"created_at": old, "environment": "Preview"} for _ in range(95)]
# 10 records from now (inside the window) -- the only ones that should count
recent = now.isoformat()
records += [{"created_at": recent, "environment": "Preview"} for _ in range(10)]
json.dump(records, open("'"$fixture"'", "w"))
'
  local actual_exit=0
  local out
  out="$(DEPLOYMENT_BUDGET_FIXTURE="$fixture" bash "$script" 2>&1)" || actual_exit=$?

  if [ "$actual_exit" != "0" ]; then
    echo "FAIL: stale-mix (95 old + 10 recent) -- expected exit 0 (old records excluded), got $actual_exit" >&2
    echo "$out" | sed 's/^/    /' >&2
    fail=1
    return
  fi
  if ! echo "$out" | grep -q 'count=10 '; then
    echo "FAIL: stale-mix -- expected count=10 (only the recent records), got:" >&2
    echo "$out" | sed 's/^/    /' >&2
    fail=1
    return
  fi
  echo "ok: stale-mix (95 old + 10 recent) -> exit 0, count=10 as expected (24h cutoff excludes the old batch)"
}

run_case "well-under"      10 0
run_case "at-alert-50"     50 0
run_case "at-alert-80"     80 0
run_case "just-under-fail" 89 0
run_case "at-fail-closed"  90 1
run_case "over-fail"       95 1
run_case "measured-137"    137 1   # the real trailing-24h count on 2026-08-19, systems/vercel-cd
run_stale_case

if [ "$fail" != "0" ]; then
  echo
  echo "FAIL: at least one deployment-budget case did not behave as expected." >&2
  exit 1
fi

echo
echo "All deployment-budget cases passed, including the fail-closed branch at 90/95/137."
