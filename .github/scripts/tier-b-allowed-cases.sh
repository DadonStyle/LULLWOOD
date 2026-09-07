#!/usr/bin/env bash
# LUL-1064 verification harness for tier-b-allowed.sh
# (decisions/0014-tier-b-automation).
#
# Not wired into CI -- same convention as ship-marker-cases.sh /
# base-branch-guard-cases.sh: a reproducible record so the next person can
# re-run this instead of re-deriving it. Asserts every deny arm fires, the
# Tier B surface is allowed, a mixed diff is denied (highest tier wins), and
# the script denies edits to itself.
#
# Usage: .github/scripts/tier-b-allowed-cases.sh

set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/.github/scripts/tier-b-allowed.sh"

fail=0

check_allow() {
  local name="$1"; shift
  local out
  if out="$(printf '%s\n' "$@" | "$script")"; then
    printf '  PASS  %-60s -> allowed\n' "$name"
  else
    printf '  FAIL  %-60s -> denied, expected allowed:\n' "$name" >&2
    printf '%s\n' "$out" | sed 's/^/    /' >&2
    fail=1
  fi
}

check_deny() {
  local name="$1"; shift
  local out
  if out="$(printf '%s\n' "$@" | "$script")"; then
    printf '  FAIL  %-60s -> allowed, expected denied\n' "$name" >&2
    fail=1
  else
    printf '  PASS  %-60s -> denied\n' "$name"
  fi
}

# --- the Tier B surface is allowed ---------------------------------------
check_allow "components/ only"                    components/Hud.tsx
check_allow "app/ only"                           app/page.tsx
check_allow "lib/ outside the lib/game/* carve-out" lib/game/economy.ts lib/input-mode.ts
check_allow "mixed allowed paths"                 components/Hud.tsx app/layout.tsx lib/game/economy.ts

# --- amendment 1: engine/ is excluded whole -------------------------------
check_deny "engine/ forbidden (amendment 1)" engine/forest-engine.js

# --- amendment 2: the five Tier-C-by-content lib/game files ---------------
check_deny "lib/game/predator.ts forbidden (amendment 2)" lib/game/predator.ts
check_deny "lib/game/scent.ts forbidden (amendment 2)"    lib/game/scent.ts
check_deny "lib/game/cover.ts forbidden (amendment 2)"    lib/game/cover.ts
check_deny "lib/game/outcome.ts forbidden (amendment 2)"  lib/game/outcome.ts
check_deny "lib/game/pack.ts forbidden (amendment 2)"     lib/game/pack.ts

# --- amendment 3: scripts/ + dependency manifests -------------------------
check_deny "scripts/ forbidden (amendment 3)"          scripts/check-elements-citations.mjs
check_deny "package.json forbidden (amendment 3)"      package.json
check_deny "package-lock.json forbidden (amendment 3)" package-lock.json

# --- the gate scripts and workflows are never Tier B ----------------------
check_deny "tier-b-allowed.sh denies edits to itself" .github/scripts/tier-b-allowed.sh
check_deny "ship-allowed.sh stays out of Tier B"      .github/scripts/ship-allowed.sh
check_deny "workflow changes need review"             .github/workflows/automerge.yml

# --- highest tier wins on a mixed diff ------------------------------------
check_deny "mixed diff: components/ + engine/ -- highest tier wins" \
  components/Hud.tsx engine/forest-engine.js

if [ "$fail" != 0 ]; then
  echo
  echo "FAIL: at least one tier-b-allowed case did not behave as expected." >&2
  exit 1
fi

echo
echo "all tier-b-allowed cases passed"
