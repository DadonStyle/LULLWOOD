#!/usr/bin/env bash
# LUL-498: the deployment budget guard (LUL-492 plan doc, §5).
#
# Vercel allows 100 deployments/24h; the founder's instruction is to stay
# under 90. Vercel mirrors every deploy into GitHub's Deployments API
# (wiki systems/vercel-cd, "the count is FREE from GitHub"), so this needs
# only GITHUB_TOKEN -- no VERCEL_API_TOKEN, no secret, no approval gate.
# LUL-498's own description asked for a Vercel token; that was wrong and is
# corrected on the ticket and in the wiki.
#
# Counts deployments in the trailing 24h and:
#   - prints the count (and a Production/Preview split) to the job summary,
#     so it's visible without digging
#   - warns at ALERT_50 / ALERT_80
#   - fails closed (exit 1) at/over FAIL_AT -- never `|| true` this, per the
#     standing rule (systems/ci-github-token-blind-spot: a swallowed warning
#     here previously hid a lane-wide jam)
#
# Modes:
#   real (default): paginates `gh api repos/$REPO/deployments`, newest first
#     (GitHub's default order), stopping once a page's oldest record is
#     already outside the trailing-24h window.
#   fixture: set DEPLOYMENT_BUDGET_FIXTURE to a JSON file of deployment
#     records (`[{"created_at": "...", "environment": "Preview"}, ...]`) to
#     drive the threshold logic without calling the API. Used by
#     deployment-budget-cases.sh and by this repo's workflow_dispatch test
#     hook to prove the fail-closed branch actually fires.
#
# Env:
#   REPO                      owner/repo (required in real mode)
#   GH_TOKEN                  token `gh` uses (required in real mode)
#   DEPLOYMENT_BUDGET_FIXTURE path to a fixture JSON file (fixture mode)
#   ALERT_50, ALERT_80, FAIL_AT   thresholds; default 50 / 80 / 90
#
# Exit: 0 under FAIL_AT, 1 at/over FAIL_AT.

set -euo pipefail

ALERT_50="${ALERT_50:-50}"
ALERT_80="${ALERT_80:-80}"
FAIL_AT="${FAIL_AT:-90}"

now_epoch=$(date -u +%s)
cutoff_epoch=$((now_epoch - 86400))

# Pages/fixture land as FILES in this dir, never as JSON on argv or in a
# shell variable -- the trailing-24h window alone can be 100+ records, and
# the real deployments API easily returns pages numbering well past that
# (this repo's own history briefly reached 137/24h and thousands over a few
# days). Passing that through `python3 -c '...' "$records"` blew past
# ARG_MAX ("Argument list too long") the first time this was run against
# the live API -- files have no such ceiling.
pages_dir="$(mktemp -d)"
trap 'rm -rf "$pages_dir"' EXIT

if [ -n "${DEPLOYMENT_BUDGET_FIXTURE:-}" ]; then
  cp "$DEPLOYMENT_BUDGET_FIXTURE" "$pages_dir/page-0001.json"
else
  : "${REPO:?REPO env var required in real mode}"
  : "${GH_TOKEN:?GH_TOKEN env var required in real mode}"
  page=1
  while :; do
    page_file="$pages_dir/page-$(printf '%04d' "$page").json"
    gh api "repos/$REPO/deployments?per_page=100&page=$page" > "$page_file"
    batch_len="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$page_file")"
    if [ "$batch_len" -eq 0 ]; then
      rm -f "$page_file"
      break
    fi

    # Stop paginating once this page's oldest record already predates the
    # 24h window -- later pages (GitHub returns newest-first) are only older.
    oldest_epoch="$(python3 -c '
import json, sys, datetime
data = json.load(open(sys.argv[1]))
oldest = min(datetime.datetime.fromisoformat(d["created_at"].replace("Z", "+00:00")) for d in data)
print(int(oldest.timestamp()))
' "$page_file")"
    if [ "$oldest_epoch" -lt "$cutoff_epoch" ]; then
      break
    fi
    if [ "$batch_len" -lt 100 ]; then
      break
    fi
    page=$((page + 1))
    if [ "$page" -gt 20 ]; then
      echo "::error::deployment-budget: paginated 20 pages (2000 records) without reaching the 24h cutoff -- aborting rather than looping forever. Something is wrong with the pagination or the cutoff logic." >&2
      exit 1
    fi
  done
fi

result="$(python3 -c '
import json, sys, os, glob, datetime
pages_dir = sys.argv[1]
cutoff = int(sys.argv[2])
total = prod = preview = 0
for fn in sorted(glob.glob(os.path.join(pages_dir, "page-*.json"))):
    for d in json.load(open(fn)):
        ts = datetime.datetime.fromisoformat(d["created_at"].replace("Z", "+00:00")).timestamp()
        if ts >= cutoff:
            total += 1
            env = d.get("environment", "")
            if env == "Production":
                prod += 1
            elif env == "Preview":
                preview += 1
print(total, prod, preview)
' "$pages_dir" "$cutoff_epoch")"

count="$(echo "$result" | awk '{print $1}')"
prod_count="$(echo "$result" | awk '{print $2}')"
preview_count="$(echo "$result" | awk '{print $3}')"

state="ok"
if [ "$count" -ge "$FAIL_AT" ]; then
  state="blocked"
elif [ "$count" -ge "$ALERT_80" ]; then
  state="alert-80"
elif [ "$count" -ge "$ALERT_50" ]; then
  state="alert-50"
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Deployment budget (trailing 24h)"
    echo
    echo "| metric | value |"
    echo "|---|---|"
    echo "| total | **$count** |"
    echo "| Production | $prod_count |"
    echo "| Preview | $preview_count |"
    echo "| alert at | $ALERT_50 / $ALERT_80 |"
    echo "| fail closed at | $FAIL_AT |"
    echo "| state | **$state** |"
  } >> "$GITHUB_STEP_SUMMARY"
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "count=$count"
    echo "state=$state"
  } >> "$GITHUB_OUTPUT"
fi

echo "deployment-budget: count=$count (Production=$prod_count Preview=$preview_count) state=$state fail_at=$FAIL_AT" >&2

case "$state" in
  blocked)
    echo "::error::deployment-budget: $count deployments in the trailing 24h, at/over the fail-closed threshold ($FAIL_AT/90). Holding new PR opens until the window rolls." >&2
    exit 1
    ;;
  alert-80)
    echo "::warning::deployment-budget: $count deployments in the trailing 24h, at/over the $ALERT_80 alert threshold." >&2
    ;;
  alert-50)
    echo "::warning::deployment-budget: $count deployments in the trailing 24h, at/over the $ALERT_50 alert threshold." >&2
    ;;
esac

exit 0
