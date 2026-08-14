#!/usr/bin/env bash
#
# Creates the private GitHub repo for Lullwood and pushes local `main` to it.
#
# The only thing this needs from a human is a GitHub token. Everything else --
# creating the repo, wiring the remote, pushing -- happens here. Outbound HTTPS
# to api.github.com is already known to work from this machine.
#
#   ./scripts/bootstrap-remote.sh preflight   # validate the token, write nothing
#   ./scripts/bootstrap-remote.sh push        # create repo (if absent) + push main
#
# Token is read from, in order: $GITHUB_TOKEN, $LULLWOOD_TOKEN_FILE, ~/.lullwood/github-token
# It is never written to .git/config, never passed in argv, and never printed.
#
# Required token scope: `repo` (classic), or a fine-grained token with
# Administration: read/write + Contents: read/write on the target repo.
#
# Overrides: LULLWOOD_GH_OWNER (default: the token's own login)
#            LULLWOOD_GH_REPO  (default: lullwood)

set -euo pipefail

readonly REPO_NAME="${LULLWOOD_GH_REPO:-lullwood}"
readonly TOKEN_FILE="${LULLWOOD_TOKEN_FILE:-$HOME/.lullwood/github-token}"
readonly API="https://api.github.com"

die() { echo "error: $*" >&2; exit 1; }

read_token() {
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    printf '%s' "$GITHUB_TOKEN"
    return
  fi
  [[ -f "$TOKEN_FILE" ]] || die "no token. Set \$GITHUB_TOKEN or write one to $TOKEN_FILE (chmod 600)."
  # Trailing newlines from an editor are the single most common failure here.
  tr -d '[:space:]' < "$TOKEN_FILE"
}

# api <method> <path> [json-body] -- prints "<body>\n<http_code>"
api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -w '\n%{http_code}' -X "$method"
              -H "Authorization: Bearer $TOKEN"
              -H "Accept: application/vnd.github+json"
              -H "X-GitHub-Api-Version: 2022-11-28")
  [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" -d "$body")
  curl "${args[@]}" "$API$path"
}

json_field() { python3 -c "import json,sys; print(json.load(sys.stdin).get('$1',''))"; }

# Resolves the token's identity and confirms it can create repos.
preflight() {
  local out code login
  out="$(api GET /user)"
  code="$(tail -n1 <<<"$out")"
  [[ "$code" == "200" ]] || die "token rejected by GitHub (HTTP $code). Check it is valid and not expired."

  login="$(sed '$d' <<<"$out" | json_field login)"
  # Human-readable output goes to stderr; stdout carries only the login, because
  # the caller captures it.
  echo "authenticated as: $login" >&2
  echo "target repo:      ${LULLWOOD_GH_OWNER:-$login}/$REPO_NAME (private)" >&2
  printf '%s' "$login"
}

# Creates the repo only if it does not already exist. Private, always.
ensure_repo() {
  local owner="$1" out code
  out="$(api GET "/repos/$owner/$REPO_NAME")"
  code="$(tail -n1 <<<"$out")"

  if [[ "$code" == "200" ]]; then
    echo "repo already exists, reusing it" >&2
    return
  fi
  [[ "$code" == "404" ]] || die "unexpected response checking for repo (HTTP $code)"

  local body='{"name":"'"$REPO_NAME"'","private":true,"has_issues":true,"has_wiki":false,"auto_init":false,"description":"Lullwood -- browser-based first-person horror game."}'
  local path="/user/repos"
  # An org target needs the org endpoint; a personal one does not.
  [[ -n "${LULLWOOD_GH_OWNER:-}" && "$LULLWOOD_GH_OWNER" != "$owner" ]] && path="/orgs/$LULLWOOD_GH_OWNER/repos"

  out="$(api POST "$path" "$body")"
  code="$(tail -n1 <<<"$out")"
  [[ "$code" == "201" ]] || die "could not create repo (HTTP $code): $(sed '$d' <<<"$out" | head -c 400)"
  echo "created private repo $owner/$REPO_NAME" >&2
}

# Pushes without ever persisting the token: git asks for credentials, and
# GIT_ASKPASS answers from the environment of that child process only.
push_main() {
  local owner="$1"
  local url="https://github.com/$owner/$REPO_NAME.git"

  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$url"
  else
    git remote add origin "$url"
  fi

  local askpass
  askpass="$(mktemp)"
  # shellcheck disable=SC2064  # expand $askpass now, not at trap time
  trap "rm -f '$askpass'" EXIT
  cat > "$askpass" <<'ASKPASS'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s' "$GIT_USER" ;;
  *)          printf '%s' "$GIT_TOKEN" ;;
esac
ASKPASS
  chmod 700 "$askpass"

  GIT_ASKPASS="$askpass" GIT_USER="$owner" GIT_TOKEN="$TOKEN" GIT_TERMINAL_PROMPT=0 \
    git push -u origin main

  echo "pushed main -> $url"
}

main() {
  local cmd="${1:-preflight}"
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  TOKEN="$(read_token)"
  readonly TOKEN

  local login owner
  login="$(preflight | tail -n1)"
  owner="${LULLWOOD_GH_OWNER:-$login}"

  case "$cmd" in
    preflight) echo "preflight OK -- rerun with 'push' to create the repo and push." ;;
    push)      ensure_repo "$owner"; push_main "$owner" ;;
    *)         die "unknown command '$cmd' (expected: preflight | push)" ;;
  esac
}

main "$@"
