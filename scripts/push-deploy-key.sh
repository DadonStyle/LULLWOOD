#!/usr/bin/env bash
#
# Pushes local `main` to an EXISTING GitHub repo over SSH, using a deploy key.
#
# This is the sibling of bootstrap-remote.sh, for the case where the human would
# rather add a per-repo deploy key than mint a PAT. It cannot create a repo (a
# deploy key is scoped to one repo and cannot call the API) -- the repo must
# already exist. DadonStyle/LULLWOOD does.
#
#   ./scripts/push-deploy-key.sh check   # verify GitHub accepts the key, push nothing
#   ./scripts/push-deploy-key.sh push    # wire the remote + push main
#
# Setup, once, by a human:
#   1. Key already generated at ~/.lullwood/deploy_key{,.pub} (run this script's
#      `check` to have it regenerate if missing).
#   2. Paste the .pub into GitHub -> the repo -> Settings -> Deploy keys ->
#      Add deploy key, and TICK "Allow write access". Without that tick the key
#      can fetch but every push is rejected.
#
# Overrides: LULLWOOD_GH_OWNER (default DadonStyle), LULLWOOD_GH_REPO (default LULLWOOD)

set -euo pipefail

readonly OWNER="${LULLWOOD_GH_OWNER:-DadonStyle}"
readonly REPO="${LULLWOOD_GH_REPO:-LULLWOOD}"
readonly KEY="${LULLWOOD_DEPLOY_KEY:-$HOME/.lullwood/deploy_key}"

die() { echo "error: $*" >&2; exit 1; }

# Two ways in, in preference order:
#
#   1. A forwarded ssh-agent. If the human reached this box with `ssh -A`, their
#      own GitHub key is usable here and nothing has to be added to the repo.
#      Note ~/.ssh/authorized_keys holds their *public* key -- that only lets
#      them log in here, it cannot push, so the agent is the only way their
#      identity gets used.
#   2. The repo-scoped deploy key, which needs a one-time paste into GitHub.
#
# IdentitiesOnly stops ssh from offering any other agent key first and getting
# rate-limited out before it ever tries this one.
agent_has_identities() {
  [[ -n "${SSH_AUTH_SOCK:-}" ]] && ssh-add -l >/dev/null 2>&1
}

ssh_cmd() {
  if agent_has_identities; then
    printf 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes'
  else
    printf 'ssh -i %q -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes' "$KEY"
  fi
}

ensure_key() {
  if [[ -f "$KEY" ]]; then
    chmod 600 "$KEY"
    return
  fi
  mkdir -p "$(dirname "$KEY")"; chmod 700 "$(dirname "$KEY")"
  ssh-keygen -t ed25519 -N "" -C "lullwood-deploy-key" -f "$KEY" -q
  chmod 600 "$KEY"
  echo "generated a new keypair (the old public key, if you pasted one, is now stale)" >&2
}

# GitHub always exits 1 on `ssh -T` -- it never gives you a shell. The signal is
# in the greeting, not the exit code.
check() {
  ensure_key
  echo "public key to paste into GitHub (Deploy keys, WITH write access):" >&2
  echo >&2; cat "$KEY.pub" >&2; echo >&2

  local out
  out="$(GIT_SSH_COMMAND="$(ssh_cmd)" ssh -i "$KEY" -o IdentitiesOnly=yes \
        -o StrictHostKeyChecking=accept-new -o BatchMode=yes \
        -T git@github.com 2>&1 || true)"

  if grep -q "successfully authenticated" <<<"$out"; then
    # A deploy key greets with the repo it is bound to; a user key greets by username.
    echo "GitHub accepted the key: $out" >&2
    grep -qi "$REPO" <<<"$out" && echo "key is bound to $REPO -- correct repo." >&2
    return 0
  fi
  if grep -q "Permission denied" <<<"$out"; then
    die "GitHub rejected the key -- it has not been added to $OWNER/$REPO yet (or was added without write access)."
  fi
  die "could not reach GitHub over SSH: $out"
}

push() {
  ensure_key
  local url="git@github.com:$OWNER/$REPO.git"

  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$url"
  else
    git remote add origin "$url"
  fi

  GIT_SSH_COMMAND="$(ssh_cmd)" git push -u origin main
  echo "pushed main -> https://github.com/$OWNER/$REPO"
}

main() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  case "${1:-check}" in
    check) check; echo "key works -- rerun with 'push' to publish main." ;;
    push)  check >/dev/null 2>&1 || die "key not accepted yet; run 'check' for details."
           push ;;
    *)     die "unknown command '${1}' (expected: check | push)" ;;
  esac
}

main "$@"
