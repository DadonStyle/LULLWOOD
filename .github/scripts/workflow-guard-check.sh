#!/usr/bin/env bash
# LUL-589: does this checkout's copy of .github/workflows/* still contain
# every marker main says it must?
#
# Trap 2 in systems/release-train-delivered: PR #108's branch forked before
# LUL-498 landed, so its copy of auto-pr.yml had ZERO references to
# deployment-budget.sh -- the deployment-budget guard step, and the
# `deployments: read` permission it needs, were simply never there. Nobody
# reads a 27-line YAML diff looking for an absence. This script does, by
# checking presence, not diffing.
#
# The manifest (.github/workflow-guards.json) and this script's own logic
# are both read from MAIN, never from the branch under test -- same rule
# .github/scripts/ship-allowed.sh already follows, and for the same reason:
# the branch being judged cannot be trusted to supply the rule it's judged
# by. This is deliberately NOT semantic diffing. A marker is just a string
# (a script filename, a permission key, a job name) that must appear
# somewhere in the file; presence is cheap to check and cheap to reason
# about. Widening the manifest is the whole extension mechanism -- do not
# make this cleverer.
#
# Modes:
#   real (default): reads the manifest via `git show origin/main:...` and
#     checks files under .github/workflows/ in the current checkout (the
#     branch/PR state being tested). Requires `git fetch --no-tags origin
#     main` to have already run in this checkout.
#   fixture: set WORKFLOW_GUARD_FIXTURE_MANIFEST to a manifest JSON file and
#     WORKFLOW_GUARD_FIXTURE_WORKFLOWS_DIR to a directory standing in for
#     .github/workflows/, to drive the logic without a git repo at all.
#     Used by workflow-guard-check-cases.sh.
#
# Exit: 0 if every manifest marker is present in its file, 1 otherwise --
# including when the manifest itself cannot be read (fail closed: no
# manifest means nothing is provably still guarded, never "no manifest
# means nothing to enforce").
#
# Usage: .github/scripts/workflow-guard-check.sh

set -euo pipefail

cleanup_manifest=""
# `|| true` is load-bearing: an EXIT trap's own exit status replaces the
# script's real one (a bash gotcha), so a bare `[ -n ... ] && rm -f ...`
# that evaluates false (nothing to clean up) would silently turn a real
# `exit 0` into a reported failure -- exactly the kind of self-inflicted
# false negative this script exists to catch in OTHER files.
cleanup() { [ -n "$cleanup_manifest" ] && rm -f "$cleanup_manifest"; true; }
trap cleanup EXIT

if [ -n "${WORKFLOW_GUARD_FIXTURE_MANIFEST:-}" ]; then
  manifest_file="$WORKFLOW_GUARD_FIXTURE_MANIFEST"
  workflows_dir="${WORKFLOW_GUARD_FIXTURE_WORKFLOWS_DIR:?WORKFLOW_GUARD_FIXTURE_WORKFLOWS_DIR required in fixture mode}"
else
  manifest_file="$(mktemp)"
  cleanup_manifest="$manifest_file"
  if ! git show origin/main:.github/workflow-guards.json > "$manifest_file" 2>/dev/null; then
    echo "::error::workflow-guard-check: no .github/workflow-guards.json on origin/main (or it could not be read) -- refusing to pass without a manifest to check against. Fail closed." >&2
    exit 1
  fi
  workflows_dir=".github/workflows"
fi

missing=()
while IFS=$'\t' read -r file marker; do
  [ -z "$file" ] && continue
  path="$workflows_dir/$file"
  if [ ! -f "$path" ]; then
    missing+=("$file: the file itself is gone (expected marker '$marker')")
    continue
  fi
  if ! grep -qF -- "$marker" "$path"; then
    missing+=("$file: missing marker '$marker'")
  fi
done < <(python3 -c '
import json, sys
manifest = json.load(open(sys.argv[1]))
for file, markers in manifest.items():
    if file.startswith("_"):
        continue
    for marker in markers:
        print(f"{file}\t{marker}")
' "$manifest_file")

if [ "${#missing[@]}" -gt 0 ]; then
  echo "::error::workflow-guard-check: this diff removes a guard that exists on main -- a marker main's manifest requires is no longer present:" >&2
  for m in "${missing[@]}"; do
    echo "::error::  - $m" >&2
  done
  echo "::error::Manifest: .github/workflow-guards.json (main's copy). If this marker moved rather than vanished, update the workflow so the marker string still appears; if a guard is being deliberately retired, that's a policy change for the board, not a silent diff." >&2
  exit 1
fi

echo "workflow-guard-check: every marker in main's .github/workflow-guards.json is present." >&2
exit 0
