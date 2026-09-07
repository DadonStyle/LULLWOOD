# LUL-1053. Shared by cut-merge.yml and bot-approve.yml: verify every
# status check the BASE branch's ruleset requires is SUCCESS on the PR's
# own rollup. Required checks are matched BY NAME against the ruleset, not
# via `gh pr view --json statusCheckRollup`'s `isRequired` -- that field is
# `null` for every check on every PR on this repo (measured 2026-08-27,
# wiki systems/ci-github-token-blind-spot), so selecting on it yields an
# empty set that trivially passes an "all green" test.
#
# Inputs (env): REPO, BASE_BRANCH, PR. Must be sourced
# (". ./.github/scripts/check-required-checks.sh"), not executed, so its
# `required.txt`/`rollup.tsv` are left in the caller's working directory and
# a caller that wants its own diagnostics/error message on failure can add
# them before exiting -- it does not exit or print a generic error itself.
#
# Sets $required_checks_ok to 1 if every required check is SUCCESS, 0
# otherwise (ruleset declares no required checks, or any required check is
# missing/non-SUCCESS). Caller is responsible for checking it and exiting.

required_checks_ok=1

gh api "repos/$REPO/rules/branches/$(printf '%s' "$BASE_BRANCH" | sed 's|/|%2F|g')" \
  --jq '.[] | select(.type == "required_status_checks")
            | .parameters.required_status_checks[].context' | sort -u > required.txt
echo "checks required by $BASE_BRANCH's ruleset:"; cat required.txt
if [ ! -s required.txt ]; then
  echo "::error::$BASE_BRANCH's ruleset declares no required status checks. Refusing to treat an unverified head as green."
  required_checks_ok=0
else
  gh pr view "$PR" --repo "$REPO" --json statusCheckRollup \
    --jq '.statusCheckRollup[] | "\(.name // .context)\t\(.conclusion // .state)"' > rollup.tsv
  echo "PR #$PR rollup:"; cat rollup.tsv

  while IFS= read -r ctx; do
    state="$(awk -F'\t' -v c="$ctx" '$1 == c {print $2}' rollup.tsv | tail -1)"
    echo "  required '$ctx' -> ${state:-<ABSENT>}"
    if [ "$state" != "SUCCESS" ]; then
      echo "::error::required check '$ctx' is ${state:-absent from the PR rollup} on PR #$PR."
      required_checks_ok=0
    fi
  done < required.txt
fi
