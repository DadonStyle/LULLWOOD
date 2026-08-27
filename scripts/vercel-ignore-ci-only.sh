#!/usr/bin/env bash
# LUL-789: skip Vercel preview deploys when only CI/scripts paths changed.
# Vercel runs this as the ignoreCommand (vercel.json). Exit 0 = skip, non-zero = build.
#
# LUL-854: widened from .github/+scripts/ only, after LUL-848 measured 4 of 9
# post-LUL-789 previews building for commits that touched no app code at all
# -- DAILY_REPORTS/ (written nightly, so this recurs daily), NOAM_MDS/ and
# GAMES_REPLAY/ (agent scratch/replay dirs), e2e/ (test specs), and
# root-level *.md (AGENTS.md, CLAUDE.md, README.md). Verified before adding:
# app/, components/, lib/, engine/, next.config.ts, tsconfig.json and
# package.json contain no imports from any of these -- every grep hit was a
# source comment citing a spec file, never a real import.
#
# docs/ is deliberately NOT in this list. Zero docs-only previews were
# observed in the measurement window, and LUL-47 plans a /devlog page that
# may source content from docs/ -- excluding it now would silently stop
# previewing real content later. Do not add docs/ here without checking
# LUL-47's status first.
#
# Paths that never affect the built app:
CI_ONLY_PATTERN='^(\.github/|scripts/|DAILY_REPORTS/|NOAM_MDS/|GAMES_REPLAY/|e2e/)|^[^/]+\.md$'

changed=$(git diff HEAD~1 HEAD --name-only 2>/dev/null)
if [ -z "$changed" ]; then
  # No parent or empty diff — build to be safe.
  exit 1
fi

non_ci=$(echo "$changed" | grep -vE "$CI_ONLY_PATTERN" | grep -v '^$' || true)
if [ -z "$non_ci" ]; then
  echo "ignoreCommand: all changes are in CI/scripts paths — skipping Vercel deploy"
  exit 0
fi

exit 1
