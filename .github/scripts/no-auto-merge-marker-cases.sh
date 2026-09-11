#!/usr/bin/env bash
# LUL-2341 verification harness for tier-approve.yml's [no-auto-merge] guard
# (decisions/0016-tier-approve-no-auto-merge-marker).
#
# Not wired into CI -- same convention as ship-marker-cases.sh /
# tier-b-allowed-cases.sh: a reproducible record so the next person can re-run
# this instead of re-deriving it. Extracts the marker regex directly out of
# tier-approve.yml rather than restating it, same reason ship-marker-cases.sh
# does: the test cannot silently drift from the source it claims to test, and
# fails loudly if it can't find the regex at all.
#
# This tests the marker-detection logic in isolation (own-line match vs. a
# malformed mid-sentence substring vs. no marker at all) -- the same "ship /
# malformed / silent" three-way split ship-marker-cases.sh already proved for
# [ship], applied to [no-auto-merge]. It does NOT re-test the tier interaction:
# the guard in tier-approve.yml sits between guard 1 (tier) and guard 3
# (CI-green) with no tier check of its own -- reading the workflow confirms it
# fires unconditionally once a commit matches, regardless of what
# scripts/pr-tier.mjs classified the diff as. That "regardless of tier" claim
# is a property of the guard's *placement* (there is no tier gate around it),
# not of the regex this script exercises.
#
# Usage: .github/scripts/no-auto-merge-marker-cases.sh

set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow="$repo_root/.github/workflows/tier-approve.yml"

# --- pull the live regex out of the workflow ---------------------------------
# `|| true` is load-bearing, same reason as ship-marker-cases.sh: under
# `set -e -o pipefail` a no-match grep would abort this script with no
# explanation, and a gate that fails silently is the exact bug decisions/0016
# exists to close.
extract_marker_re() {
  grep -oE "'\^\[\[:space:\]\]\*\\\\\[no-auto-merge\\\\\]\[\[:space:\]\]\*\\\$'" "$1" | head -1 || true
}
MARKER_RE_QUOTED="$(extract_marker_re "$workflow")"
if [ -z "$MARKER_RE_QUOTED" ]; then
  echo "FAIL: could not find the [no-auto-merge] marker regex in tier-approve.yml" >&2
  exit 1
fi
MARKER_RE="${MARKER_RE_QUOTED%\'}"; MARKER_RE="${MARKER_RE#\'}"
echo "marker regex (from tier-approve.yml): $MARKER_RE"
echo

# --- the decision, exactly as the guard makes it ------------------------------
# blocked   -> own-line marker found -- guard fires, approval skipped
# malformed -> "[no-auto-merge]" present, but never on a line of its own --
#              guard does NOT fire (mirrors auto-pr.yml's [ship] "malformed"
#              case: a substring match is not treated as intent)
# silent    -> no marker at all -- guard does NOT fire
decide() {
  local messages="$1"
  if printf '%s\n' "$messages" | grep -qE "$MARKER_RE"; then
    echo blocked
  elif printf '%s\n' "$messages" | grep -qF '[no-auto-merge]'; then
    echo malformed
  else
    echo silent
  fi
}

fail=0
check() {
  local name="$1" expected="$2" got
  got="$(decide "$3")"
  if [ "$got" = "$expected" ]; then
    printf '  PASS  %-52s -> %s\n' "$name" "$got"
  else
    printf '  FAIL  %-52s -> %s (expected %s)\n' "$name" "$got" "$expected"
    fail=1
  fi
}

# --- case 1 (ticket's positive case): a Tier-B-by-path PR whose author still
# wants blocking review -- own-line marker anywhere in the branch's commits.
tierb_commits="$(printf '%s\n' 'LUL-9999: components/Hud.tsx tweak' '' '[no-auto-merge]')"
check "own-line marker on a Tier-B-by-path commit stream" blocked "$tierb_commits"

backmerges="$(printf '%s\n' \
  "Merge branch 'release/next' into lul-9999-example" \
  "Merge branch 'release/next' into lul-9999-example")"
check "own-line marker + backmerges (not just the head commit)" blocked \
  "$(printf '%s\n%s\n' "$tierb_commits" "$backmerges")"

# --- case 2 (ticket's negative case): marker text mid-sentence in a commit
# subject -- must NOT be read as intent, same as [ship]'s malformed case.
check "marker mid-sentence in a commit subject" malformed \
  "$(printf '%s\n' 'fix: this needs [no-auto-merge] treatment, revisit later')"
check "marker appended to a descriptive subject line" malformed \
  "$(printf '%s\n' 'LUL-1: components/Hud.tsx tweak [no-auto-merge]')"

# --- case 3: no marker anywhere -----------------------------------------------
check "no marker at all" silent \
  "$(printf '%s\n%s\n' 'LUL-1: an ordinary commit' "$backmerges")"

# --- guard: the marker must be the WHOLE line, not merely on its own line ----
check "leading text then marker" malformed "$(printf '%s\n' 'fix: [no-auto-merge] it later')"
check "marker with trailing spaces" blocked "$(printf '%s\n' 'LUL-1: x' '' '[no-auto-merge]   ')"

echo
if [ "$fail" = 0 ]; then echo "all cases passed"; else echo "FAILURES above"; fi
exit "$fail"
