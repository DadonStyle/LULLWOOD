#!/usr/bin/env bash
# LUL-789: skip Vercel preview deploys when only CI/scripts paths changed.
# Vercel runs this as the ignoreCommand (vercel.json). Exit 0 = skip, non-zero = build.
#
# LUL-854: widened from .github/+scripts/ only, after LUL-848 measured 4 of 9
# post-LUL-789 previews building for commits that touched no app code at all
# -- DAILY_REPORTS/ (written nightly, so this recurs daily), NOAM_MDS/ and
# QA_REGRESSION/ (agent scratch/replay dirs), e2e/ (test specs), and
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
CI_ONLY_PATTERN='^(\.github/|scripts/|DAILY_REPORTS/|NOAM_MDS/|QA_REGRESSION/|e2e/)|^[^/]+\.md$'

# LUL-2847 (founder THROTTLE decision, LUL-1786): skip every Preview deploy on
# a `lul-*` feature branch, before the CI-only check even runs. Root cause
# (LUL-1783): 88 Previews/24h mapped to 35 distinct PRs, 25 of them with 2+
# pushes (max 5) — the repeat-push amplification on open PRs, not any single
# wasteful push shape the CI_ONLY_PATTERN above was built to catch. Audited
# every consumer of a Preview URL in this repo (wiki systems/vercel-cd,
# systems/vercel-ignorecommand-branch-scope) and found none: previews sit
# behind Vercel Deployment Protection (anonymous curl gets 302), review reads
# the diff (Code Reviewer / tier-approve.yml), and the local-qa tester builds
# its own vendored checkout rather than hitting a Vercel URL. A feature-branch
# preview has been pure byproduct, so this costs ~zero real throughput while
# cutting the actual repeat-push volume — the fix LUL-1783 said was the only
# lever left ("push/PR volume or preview-deploy frequency per push").
#
# `release/next` and `main` are unaffected (still fall through to the
# CI_ONLY_PATTERN check below), so the one Preview a PR's squash-merge
# produces on `release/next` still happens — that is the ~35/24h the studio
# actually watches, not the ~88 it was burning.
#
# `[force-preview]` alone on its own line in the commit being deployed is the
# one-way escape hatch for the rare case someone genuinely wants a live link
# on a feature branch before it reaches release/next — same marker
# convention as `[ship]` / `[no-auto-merge]` (decisions/0016). Vercel exposes
# the commit being deployed via VERCEL_GIT_COMMIT_REF/_MESSAGE directly, no
# git history walk needed (works even on a shallow, single-commit checkout).
branch="${VERCEL_GIT_COMMIT_REF:-}"
if printf '%s' "$branch" | grep -qE '^lul-'; then
  if printf '%s\n' "${VERCEL_GIT_COMMIT_MESSAGE:-}" | grep -qE '^[[:space:]]*\[force-preview\][[:space:]]*$'; then
    echo "ignoreCommand: $branch carries [force-preview] — building despite the lul-* feature-branch skip (LUL-2847)"
    exit 1
  fi
  echo "ignoreCommand: $branch is a feature branch — skipping Vercel preview (LUL-2847 cadence throttle; no functional consumer, see wiki systems/vercel-cd)"
  exit 0
fi

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
