#!/usr/bin/env bash
# LUL-3264: one-time install of the leaderboard service on the founder's server.
# Run as the founder:   sudo bash services/leaderboard-db/install.sh
# Re-running it is safe (it also redeploys the code and restarts the service).
#
# Creates a dedicated system user, copies only the files the service needs to
# /opt (not a git checkout: nothing in /opt can be pulled or edited by agents),
# writes /etc/lullwood-leaderboard/env with fresh secrets on first run, and
# starts the hardened system unit. It does NOT enable Tailscale Funnel -- that
# is a separate, explicit step (see README.md, "Go live").
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OWNER="${SUDO_USER:-noam}"

id lullwood-lb >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin lullwood-lb
# The founder's account (and so the agents, which run as it) can read the hourly snapshot via the group.
usermod -aG lullwood-lb "$OWNER"

install -d -m 0755 /opt/lullwood-leaderboard/app/services/leaderboard-db /opt/lullwood-leaderboard/app/lib/game /opt/lullwood-leaderboard/app/lib/leaderboard
install -m 0644 "$REPO"/services/leaderboard-db/{db.ts,server.ts,stats.ts} /opt/lullwood-leaderboard/app/services/leaderboard-db/
install -m 0755 "$REPO"/services/leaderboard-db/new-record-alert /opt/lullwood-leaderboard/app/services/leaderboard-db/
install -m 0644 "$REPO"/lib/game/leaderboard.ts /opt/lullwood-leaderboard/app/lib/game/
install -m 0644 "$REPO"/lib/leaderboard/signing.ts /opt/lullwood-leaderboard/app/lib/leaderboard/
printf '{ "type": "module" }\n' > /opt/lullwood-leaderboard/app/package.json

install -d -m 0750 -o root -g lullwood-lb /etc/lullwood-leaderboard
if [ ! -f /etc/lullwood-leaderboard/env ]; then
  umask 0027
  {
    echo "# Generated $(date -Is) by install.sh. LB_API_SECRET must equal Vercel's LEADERBOARD_API_SECRET."
    echo "LB_API_SECRET=$(openssl rand -hex 32)"
  } > /etc/lullwood-leaderboard/env
  chgrp lullwood-lb /etc/lullwood-leaderboard/env
  echo "NEW SECRET written to /etc/lullwood-leaderboard/env -- copy LB_API_SECRET into Vercel as LEADERBOARD_API_SECRET"
fi

# New-record email (threat model B1): opt in by creating /etc/lullwood-leaderboard/alert.env
# (SMTP_USER / SMTP_PASS / ALERT_TO, mode 0640 root:lullwood-lb). The service cannot read
# the founder's own ~/.config copy -- /home is invisible to it, on purpose.
if [ -f /etc/lullwood-leaderboard/alert.env ] && ! grep -q '^LB_ALERT_CMD=' /etc/lullwood-leaderboard/env; then
  printf 'LB_ALERT_CMD=/opt/lullwood-leaderboard/app/services/leaderboard-db/new-record-alert\nLB_ALERT_ENV=/etc/lullwood-leaderboard/alert.env\n' >> /etc/lullwood-leaderboard/env
fi

# Nightly off-disk backup of the hourly snapshot to the HDD, 14 days kept.
cat > /etc/cron.daily/lullwood-leaderboard-backup <<'CRON'
#!/bin/sh
# LUL-3264 (services/leaderboard-db/install.sh): nightly copy of the stats snapshot.
SRC=/var/lib/lullwood-leaderboard/snapshot/stats.db
DST=/mnt/hdd/backups/lullwood-leaderboard
mountpoint -q /mnt/hdd || exit 0
[ -f "$SRC" ] || exit 0
install -d -m 0750 -g lullwood-lb "$DST"
install -m 0640 -g lullwood-lb "$SRC" "$DST/stats-$(date +%F).db"
find "$DST" -name 'stats-*.db' -mtime +14 -delete
CRON
chmod 0755 /etc/cron.daily/lullwood-leaderboard-backup

install -m 0644 "$REPO"/services/leaderboard-db/lullwood-leaderboard.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable lullwood-leaderboard.service
systemctl restart lullwood-leaderboard.service
sleep 2
systemctl --no-pager --lines=5 status lullwood-leaderboard.service
curl -fsS http://127.0.0.1:8787/healthz && echo "  <- service healthy on loopback"
echo "Security score (lower is better):"; systemd-analyze security lullwood-leaderboard.service --no-pager | tail -1
