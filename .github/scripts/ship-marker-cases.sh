#!/usr/bin/env bash
# LUL-465 verification harness for the `[ship]` marker decision.
#
# Not wired into CI -- this is the reproducible record of the measurement that
# justified the LUL-465 change, kept so the next person can re-run it instead of
# re-deriving it. It extracts the marker regex out of the two workflow files
# rather than restating it, so the test cannot silently drift from the source it
# claims to test (and fails loudly if the two workflows ever disagree).
#
# Usage:  .github/scripts/ship-marker-cases.sh [dir-with-prNN.txt fixtures]
# Each fixture is a raw commit-message stream, exactly what
#   gh api repos/OWNER/REPO/pulls/N/commits --paginate --jq '.[].commit.message'
# prints.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixtures="${1:-}"

# --- pull the live regex out of both workflows -------------------------------
# `|| true` is deliberate and load-bearing: under `set -e -o pipefail` a grep
# that matches nothing would abort the script here, exiting non-zero with no
# explanation at all -- and a gate that fails silently is the exact bug this
# whole change is about. Let it return empty and report it below.
extract_marker_re() {
  grep -oE "'\^\[\[:space:\]\]\*\\\\\[ship\\\\\]\[\[:space:\]\]\*\\\$'" "$1" | head -1 || true
}
re_auto="$(extract_marker_re "$repo_root/.github/workflows/auto-pr.yml")"
re_merge="$(extract_marker_re "$repo_root/.github/workflows/automerge.yml")"

if [ -z "$re_auto" ] || [ -z "$re_merge" ]; then
  echo "FAIL: could not find the marker regex in one of the workflows" >&2
  echo "  auto-pr.yml:   ${re_auto:-<none>}" >&2
  echo "  automerge.yml: ${re_merge:-<none>}" >&2
  exit 1
fi
if [ "$re_auto" != "$re_merge" ]; then
  echo "FAIL: the two workflows use different marker regexes -- a PR would merge" >&2
  echo "      down one path and not the other." >&2
  echo "  auto-pr.yml:   $re_auto" >&2
  echo "  automerge.yml: $re_merge" >&2
  exit 1
fi
# strip the surrounding single quotes captured above
MARKER_RE="${re_auto%\'}"; MARKER_RE="${MARKER_RE#\'}"
echo "marker regex (identical in both workflows): $MARKER_RE"
echo

# --- the decision, exactly as the workflows make it --------------------------
# ship        -> own-line marker found
# malformed   -> "[ship]" present, but never on a line of its own
# silent      -> no marker at all
decide() {
  local messages="$1"
  if printf '%s\n' "$messages" | grep -qE "$MARKER_RE"; then
    echo ship
  elif printf '%s\n' "$messages" | grep -qF '[ship]'; then
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

# --- case 1: the bug. own-line marker, then backmerges bury it ---------------
# This is the case the old head-only read got wrong: the marker is on the real
# commit, the head is a merge commit, and self-merge died silently.
tagged="$(printf '%s\n' 'LUL-465: widen the marker read' '' '[ship]')"
backmerges="$(printf '%s\n' \
  "Merge branch 'main' into lul-465-ship-marker-every-commit" \
  "Merge branch 'main' into lul-465-ship-marker-every-commit" \
  "Merge branch 'main' into lul-465-ship-marker-every-commit")"

check "own-line marker only"                 ship "$tagged"
check "own-line marker + 3 backmerges"       ship "$(printf '%s\n%s\n' "$tagged" "$backmerges")"
check "head-only slice of the same stream"   silent "$backmerges"   # what the old code read

# --- case 2: the two live PRs. inline marker, never own-line -----------------
if [ -n "$fixtures" ]; then
  for f in "$fixtures"/pr*.txt; do
    [ -e "$f" ] || continue
    check "real stream $(basename "$f")" malformed "$(cat "$f")"
  done
else
  echo "  SKIP  real PR fixtures (no fixture dir passed)"
fi

# inline forms, synthesised, in case the fixtures are unavailable later
check "inline marker on the subject line" malformed \
  "$(printf '%s\n' 'docs(LUL-380): add recovery pass status update [ship]')"
check "inline marker + backmerges" malformed \
  "$(printf '%s\n%s\n' 'LUL-389: add four-role checklist [ship]' "$backmerges")"

# --- case 3: no marker anywhere ----------------------------------------------
check "no marker at all" silent \
  "$(printf '%s\n%s\n' 'LUL-100: an ordinary commit' "$backmerges")"

# --- guard: the marker must be the WHOLE line, not merely on its own line ----
check "leading text then marker" malformed "$(printf '%s\n' 'fix: [ship] it later')"
check "marker with trailing spaces" ship "$(printf '%s\n' 'LUL-1: x' '' '[ship]   ')"

echo
if [ "$fail" = 0 ]; then echo "all cases passed"; else echo "FAILURES above"; fi
exit "$fail"
