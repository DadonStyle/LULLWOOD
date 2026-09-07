#!/usr/bin/env bash
# Is this change allowed to use `[ship]` under Tier B -- merge on green, no
# human review, with the Code Reviewer's pass landing after the merge instead
# of before it?
#
# Reads changed paths on stdin, one per line.
#   exit 0 -> allowed; nothing printed
#   exit 1 -> denied; the offending paths are printed, one per line
#
# Sibling to ship-allowed.sh (Tier A: docs/CI/tests, review not needed at
# all). Both workflows try ship-allowed.sh first; only on denial do they try
# this script. Same contract, same fail-closed posture, same "the script
# decides the tier, the author never does" rule -- see ship-allowed.sh's own
# header for why an allowlist and not a denylist.
#
# decisions/0014-tier-b-automation (CEO ruling 2026-09-06, LUL-1061/LUL-1064).
# The development-first directive's Tier B is `components/**`, `app/**`,
# `lib/**`, and tuning constants in `engine/`. This script implements it with
# three narrowings the founder signed off on, because a path allowlist cannot
# see diff *content* and the naive version would silently open an unreviewed
# path into predator AI:
#
#   1. `engine/**` is entirely excluded. There is one engine file,
#      forest-engine.js, and it is simultaneously the tuning surface and the
#      Tier C simulation -- a path allowlist cannot tell a feel value from
#      predator AI in the same file. Extracting tuning constants out (LUL-1065,
#      engine/tuning.js) is the follow-up that would make "tuning in engine/
#      is Tier B" mechanically true; until then, engine/ stays Tier C.
#   2. `lib/game/predator.ts`, `scent.ts`, `cover.ts`, `outcome.ts`, `pack.ts`
#      are excluded even though they sit under `lib/`. They are predator AI /
#      scent / hiding / detection / win-lose, extracted out of
#      forest-engine.js -- Tier C by content, not by directory.
#   3. `scripts/**` and the dependency manifests (`package.json`,
#      `package-lock.json`) are Tier C, not Tier B -- several of those
#      scripts are merge-gate watchdogs themselves, and a dependency bump can
#      change runtime behaviour with no diff to `components/`, `app/`, or
#      `lib/` at all.
#
# This is Tier C to edit (it touches merge rules) -- see the ticket that
# shipped it.
set -uo pipefail

denied=()
while IFS= read -r path; do
  [ -z "$path" ] && continue
  case "$path" in
    # Workflows are the gate itself. Must stay ABOVE the lib/**, app/**,
    # components/** allows below -- same reasoning as ship-allowed.sh's
    # .github/workflows/* arm.
    .github/workflows/*)
      denied+=("$path (workflow changes need review, new or existing)") ;;
    .github/scripts/ship-allowed.sh|.github/scripts/tier-b-allowed.sh)
      denied+=("$path (changes a merge gate itself)") ;;
    # Amendment 1: engine/ is tuning surface AND Tier C simulation, no split.
    engine/*)
      denied+=("$path (engine/ is Tier C -- decisions/0014-tier-b-automation, amendment 1)") ;;
    # Amendment 2: these five are Tier C by content, not by directory.
    lib/game/predator.ts|lib/game/scent.ts|lib/game/cover.ts|lib/game/outcome.ts|lib/game/pack.ts)
      denied+=("$path (predator AI / scent / hiding / detection / win-lose -- decisions/0014-tier-b-automation, amendment 2)") ;;
    # Amendment 3: watchdog/tooling scripts and dependency manifests are Tier C.
    scripts/*|package.json|package-lock.json)
      denied+=("$path (scripts/ and dependency manifests are Tier C -- decisions/0014-tier-b-automation, amendment 3)") ;;
    # The Tier B surface proper.
    components/*|app/*|lib/*) ;;
    *) denied+=("$path") ;;
  esac
done

if [ "${#denied[@]}" -gt 0 ]; then
  printf '%s\n' "${denied[@]}"
  exit 1
fi
exit 0
