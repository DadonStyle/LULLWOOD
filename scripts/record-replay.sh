#!/usr/bin/env bash
# Records e2e/replay/*.spec.ts and stages the output as dated GAMES_REPLAY/ clips.
#
# Before this script existed, producing a GAMES_REPLAY clip was a fully manual
# copy/rename/ffmpeg dance (see wiki:systems/headless-qa-rig), done by hand twice
# (LUL-216, LUL-237) and then not repeated -- which is why the folder sat frozen
# on one date (LUL-436). This automates the mechanical half (run, locate, rename,
# frame-extract); it deliberately does NOT touch GAMES_REPLAY/README.md or commit
# anything -- deciding whether a clip is real gameplay and worth keeping stays a
# judgement call for whoever runs this (see the frame-viewing step below).
#
# Usage:
#   scripts/record-replay.sh <lul-id> [extra-slug]
#
# Examples:
#   scripts/record-replay.sh 436                  -> GAMES_REPLAY/<date>-lul-436-win-path.webm, ...-death-path.webm
#   scripts/record-replay.sh 436 freshness-check   -> ...-win-path-freshness-check.webm
set -euo pipefail

LUL_ID="${1:?usage: record-replay.sh <lul-id> [extra-slug]}"
EXTRA_SLUG="${2:-}"
DATE=$(date +%F)
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"

rm -rf test-results
npx playwright test --project=replay --reporter=list

FF=$(find "$HOME/.cache/ms-playwright" -iname 'ffmpeg*' -type f 2>/dev/null | head -1)
FRAME_DIR="$REPO_ROOT/test-results-frames"
mkdir -p "$FRAME_DIR"
rm -f "$FRAME_DIR"/*.png

wrote_any=0
for video in test-results/*-replay/video.webm; do
  [ -f "$video" ] || continue
  wrote_any=1
  test_dir=$(basename "$(dirname "$video")")
  case "$test_dir" in
    death-*) WHAT="death-path" ;;
    win-*)   WHAT="win-path" ;;
    *)       WHAT=$(echo "$test_dir" | sed -E 's/-[0-9a-f]+-replay$//; s/-replay$//') ;;
  esac
  SLUG="$WHAT"
  [ -n "$EXTRA_SLUG" ] && SLUG="${WHAT}-${EXTRA_SLUG}"
  DEST="GAMES_REPLAY/${DATE}-lul-${LUL_ID}-${SLUG}.webm"
  cp "$video" "$DEST"

  if [ -n "$FF" ]; then
    "$FF" -y -ss 1 -i "$DEST" -frames:v 1 "$FRAME_DIR/${SLUG}-start.png" >/dev/null 2>&1 || true
    "$FF" -y -sseof -1 -i "$DEST" -frames:v 1 "$FRAME_DIR/${SLUG}-end.png" >/dev/null 2>&1 || true
  fi

  echo "wrote $DEST"
done

if [ "$wrote_any" -eq 0 ]; then
  echo "no replay videos found under test-results/ -- did the replay project run?" >&2
  exit 1
fi

echo
echo "Frames for manual review: $FRAME_DIR/*.png"
echo "Next steps (not automated -- these are judgement calls):"
echo "  1. Read the extracted frames. Confirm real gameplay, not a black/HUD-only screen."
echo "  2. Add a row to GAMES_REPLAY/README.md for each clip you keep."
echo "  3. Prune any earlier clip the new one supersedes (same commit, per the README's repo-weight budget)."
echo "  4. Delete any clip you don't keep -- this script does not decide that for you."
