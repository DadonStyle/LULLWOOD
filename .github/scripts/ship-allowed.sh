#!/usr/bin/env bash
# Is this change allowed to use `[ship]` (self-merge on green, no human, no reviewer)?
#
# Reads changed paths on stdin, one per line.
#   exit 0 -> allowed; nothing printed
#   exit 1 -> denied; the offending paths are printed, one per line
#
# The rule (LUL-73, Option A). CI proves a change builds, typechecks, lints and
# passes the smoke suite. It does not prove the change is *right* -- that it
# doesn't duplicate a helper we already have, or quietly reverse a decision we
# made last week. That judgement is the Code Reviewer's, and `[ship]` skips it.
#
# So `[ship]` is scoped to diffs where "it builds and the tests pass" really is
# the whole quality bar: prose, CI config, and the test suite itself. Anything
# that can change what the player experiences goes to the reviewer.
#
# This is an ALLOWLIST, deliberately. A denylist of code directories fails open:
# someone adds `src/` or `hooks/` next month, forgets this file exists, and
# engine code starts self-merging silently. An allowlist fails closed -- the
# worst case is a PR that waits for a review it didn't strictly need, which
# costs one heartbeat and no correctness.
#
# Widening this list is a policy change, not a cleanup. It needs the board.
set -uo pipefail

denied=()
while IFS= read -r path; do
  [ -z "$path" ] && continue
  case "$path" in
    # Workflows are the gate itself -- including ones that don't exist yet. A
    # brand-new file under .github/workflows/ is not named anywhere below, so
    # without this arm it would fall through to the generic `.github/*` allow
    # and could self-merge unreviewed with its own triggers and permissions.
    # Denying the whole directory (not just today's four files) closes that.
    # Must stay ABOVE the `.github/*` allow below.
    .github/workflows/*)
      denied+=("$path (workflow changes need review, new or existing)") ;;
    .github/scripts/ship-allowed.sh)
      denied+=("$path (changes the merge gate itself)") ;;
    # Prose, anywhere in the tree.
    *.md) ;;
    # CI, workflows and repo config.
    .github/*|.gitignore|LICENSE) ;;
    # The Playwright suite. Test-only changes are the Game Tester's own domain
    # and cannot affect a player.
    e2e/*|playwright.config.ts) ;;
    *) denied+=("$path") ;;
  esac
done

if [ "${#denied[@]}" -gt 0 ]; then
  printf '%s\n' "${denied[@]}"
  exit 1
fi
exit 0
