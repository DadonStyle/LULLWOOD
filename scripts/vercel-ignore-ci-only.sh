#!/usr/bin/env bash
# LUL-789: skip Vercel preview deploys when only CI/scripts paths changed.
# Vercel runs this as the ignoreCommand (vercel.json). Exit 0 = skip, non-zero = build.
#
# Paths that never affect the built app:
CI_ONLY_PATTERN='^(\.github/|scripts/)'

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
