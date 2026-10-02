# LUL-3264 leaderboard on SQLite — security review

**Ticket:** LUL-3264 (wave 1, S0–S3), storage changed from Vercel Postgres (blocked on LUL-3310
since 2026-09-18) to SQLite on the founder's server, founder request 2026-10-02. **Tier: C** —
persistence, secrets and a new public network surface.

This page is the review of that change. It extends, and does not replace, the binding threat model
`decisions/lul-3288-leaderboard-threat-model-accepted-2026-09-18` (A1–A3, B1–B9): every item there
still applies and is mapped below. New items are numbered **H1–H12** (host/network) because moving
storage onto the founder's own machine adds risks the Postgres plan never had.

## Architecture (what talks to what)

```
player browser ──HTTPS──> Vercel route handlers (app/api/leaderboard/**, app/api/telemetry)
                              │  validate everything, salt+hash the IP, derive device class
                              │  signed request: HMAC-SHA256(ts, nonce, method, path, sha256(body))
                              ▼
                       Tailscale Funnel (https://<node>.ts.net:8443, public)
                              │
                              ▼
         noam-live-server 127.0.0.1:8787  services/leaderboard-db/server.ts
                              │  verify signature + nonce, validate everything again
                              ▼
                 /var/lib/lullwood-leaderboard/data/leaderboard.db  (SQLite, WAL)
                              │ hourly VACUUM INTO
                              ▼
                 /var/lib/lullwood-leaderboard/snapshot/stats.db ──read-only──> agents (stats.ts)
                              │ nightly cron
                              ▼
                 /mnt/hdd/backups/lullwood-leaderboard/  (14 days)
```

Players never reach the server directly; nothing on the server is reachable except one loopback
port through Funnel; the agents never touch the live database.

## Why not the obvious alternatives

- **SQLite on Vercel itself** — impossible: functions get a fresh, non-persistent filesystem per
  invocation. This is exactly how LUL-2993's local-disk suggestion store lost every write.
- **Players' browsers calling the server directly** — would expose the server URL to every player,
  make the server the place IPs are seen, and need CORS. Routing through Vercel keeps the server
  private behind a shared secret and keeps IP handling where A1/A2 are already fixed.

## Threat model mapping (LUL-3288)

| Item | Where it is enforced now | Test |
|---|---|---|
| A1 spoofed X-Forwarded-For | `lib/request-identity.ts` `getClientIp` (extracted from the suggestions route, which now imports it) | `app/api/leaderboard/route.test.ts` "A1", `lib/request-identity.test.ts` |
| A2 empty salt | `usableSalt()`; route answers 503 if `LEADERBOARD_IP_HASH_SALT` is unset | route.test.ts "A2" |
| A3 durable, atomic rate limits | SQLite `BEGIN IMMEDIATE` transaction in `db.ts` `submit()` (single writer) | `db.test.ts` cooldown / per-IP / global |
| B1 plausibility floor, strict integer | `validateTimeMs` (Vercel and service) | `lib/game/leaderboard.test.ts`, route + server tests |
| B1 founder alert on new record | `server.ts` `onNewRecord` → `new-record-alert` (email, opt-in via `/etc/lullwood-leaderboard/alert.env`) | server.test.ts "fires the new-record alert once" |
| B2 nickname pattern, textContent | `validateNickname`; React text children only, never `dangerouslySetInnerHTML` | `<script>` cases in all three test layers, e2e tampered-cache test |
| B3 parameterised SQL incl. pagination | `db.ts`: prepared statements only, keyset cursor bound as a parameter; Vercel passes only clamped integers | route.test.ts "B3", server.test.ts junk params |
| B4 denylist after leet normalisation | `isDenylisted` | leaderboard.test.ts "B4" |
| B5 admin invalidate, fail closed, logged | `app/api/leaderboard/[id]/invalidate/route.ts` (bearer, constant-time compare, 503 if unset) + service `admin_audit` table | route.test.ts "B5", db.test.ts invalidate |
| B6 global ceiling + 2 KB body cap | Vercel 2048 B, service 4096 B, `GLOBAL_LIMIT` in the transaction | route + server tests |
| B7 cached GET takes no input | `current/route.ts` `GET()` has no request parameter | route.test.ts "handler accepts no request argument" |
| B8 client cache untrusted | `decodeCachedRecord` re-validates every field, 6 h expiry | leaderboard.test.ts "S3/B8", e2e tampered cache |
| B9 country allowlist | `validateCountry` | leaderboard.test.ts "B9" |
| Concurrency: two faster times, one winner | compare-and-set `UPDATE current_record ... WHERE` inside `BEGIN IMMEDIATE` | db.test.ts "concurrent submissions from two connections" |

## New items for the self-hosted design

**H1. Public exposure through Funnel.** Only `127.0.0.1:8787` is published, on its own HTTPS port
(`tailscale funnel --bg --https=8443 http://127.0.0.1:8787`), never the whole host: the dev servers
on :3000/:3111 and the Paperclip UI on :3100 stay unreachable. Unauthenticated requests reach only
`GET /healthz` (`{"ok":true}`, no version or detail) and otherwise get a uniform 401 before any JSON
parsing or database work. *Accepted:* enabling Funnel puts the machine's `*.ts.net` name in public
certificate-transparency logs, so the hostname becomes discoverable. Nothing else on it is exposed.

**H2. Same-user compromise — the most serious finding.** A `systemd --user` unit on this box runs
with full access to the founder's home: `~/.lullwood/deploy_key`, the GitHub token, the Claude OAuth
token in a systemd drop-in, and the Paperclip database. Verified 2026-10-02: with
`kernel.apparmor_restrict_unprivileged_userns=1`, the user manager **silently ignores**
`ProtectHome=`/`BindPaths=` (a test unit could still read `~/.lullwood` and write to `$HOME`).
**Fix (launch blocker):** the service runs as a dedicated system user `lullwood-lb` under a
**system** unit (`lullwood-leaderboard.service`) with `ProtectHome=yes`, `ProtectSystem=strict`, an
empty capability set, a syscall filter and its own state directory. The code is copied to
`/opt/lullwood-leaderboard` (read-only, not a git checkout an agent can pull into). This needs sudo
once: `sudo bash services/leaderboard-db/install.sh`. Check the result with
`systemd-analyze security lullwood-leaderboard`.

**H3. Request authentication.** HMAC-SHA256 over timestamp, 128-bit nonce, method, path+query and
the body hash, with a 60 s skew window and a nonce replay cache (`lib/leaderboard/signing.ts`).
A secret shorter than 32 characters is refused on both sides (fail closed: the service will not
start, and the routes answer 503). Signatures are compared in constant time. The secret exists in
exactly two places: `/etc/lullwood-leaderboard/env` (0640 root:lullwood-lb) and Vercel's server-only
env. **Rotation:** generate a new value, update Vercel, then the server, then restart. Requests fail
for the minute in between, the record line falls back to the client cache, and nothing is lost
except submissions made during that minute.

**H4. Zero dependencies.** The service is `node:http` + `node:sqlite`, with no npm packages and so
no supply chain. TypeScript runs through Node's type stripping, with no build step.

**H5. Resource exhaustion.** Body caps (2 KB at Vercel, 4 KB at the service), `requestTimeout`
10 s, `headersTimeout` 5 s, at most 128 connections, a 256 MB memory cap and 50% CPU quota on the
unit. Telemetry is shed past 100,000 events/day or a 2 GB database, so leaderboard writes keep
working. Raw events are pruned after 180 days.

**H6. Prompt injection into the agents.** The agents read this data, and players control part of
it. Nicknames are limited to `[a-z0-9]{3,20}`. Every string in every telemetry payload must be a
plain token (`[A-Za-z0-9_.:/-]{0,64}`), with bounded depth and size, or the event is refused. So no
sentence, instruction or markup can reach the database. `stats.ts` also labels all values as
untrusted data.

**H7. Agents' access.** Agents read an hourly snapshot (`stats.db`, group-readable through the
`lullwood-lb` group) with a read-only connection and `PRAGMA query_only`. They cannot write, cannot
lock the live database, and cannot see the service's secrets (the env file is root-owned). The
snapshot is at most one hour stale.

**H8. Privacy.** Raw IPs never leave Vercel; the server stores only salted hashes. `anon_id` (a
browser-profile UUID that already exists in telemetry) links a nickname to that device's runs; that
link is the point of the "nickname history" stats. Device data is coarse (mobile/tablet/desktop,
browser family, viewport size rounded, `dpr`, touch), with no UA strings or versions. Country comes
from Vercel's geo header. Nicknames are public by design; nothing else in the database is shown to
players.

**H9. Availability.** The game must not depend on a home server. `/api/leaderboard/current` never
returns 5xx (`{ unavailable: true }`, no-store), so the record line shows the cached record or hides.
The telemetry copy has a 1.5 s timeout and is skipped silently. A submission while the server is
down gets an honest "could not be saved, try again". The server going away breaks no gameplay.

**H10. Data durability.** WAL mode plus `synchronous=NORMAL` (at most the last transaction can be
lost on power loss). There is an hourly consistent snapshot and a nightly copy to `/mnt/hdd`, kept
14 days. *Gap:* both are on the same machine, with no off-site copy yet.

**H11. Clock.** The signature window depends on both clocks. The server is NTP-synchronised
(checked 2026-10-02); Vercel's clock is managed.

**H12. Transport.** `LEADERBOARD_API_URL` must be `https://` (enforced by `serviceConfig`).
Redirects are refused (`redirect: 'error'`), so a misconfigured URL cannot be bounced elsewhere.
Funnel terminates TLS with a valid certificate.

## Accepted risks (carried over, unchanged)

Run times can be forged: the game is client-authoritative, and the response is operational (admin
invalidate plus the alert). Offensive nicknames will slip past the denylist; deletion is the
control. Launch-day gaming is expected; the new-record email exists so nobody has to watch a
dashboard.

## Launch checklist (founder actions, in order)

1. `sudo bash services/leaderboard-db/install.sh`. This creates the user, the unit and the secret,
   and prints `LB_API_SECRET`.
2. Tailscale admin console: enable HTTPS certificates, and add the `funnel` node attribute for
   `noam-live-server` in the ACL policy.
3. On the server: `tailscale funnel --bg --https=8443 http://127.0.0.1:8787`.
4. Vercel → Production env: `LEADERBOARD_API_URL=https://noam-live-server.<tailnet>.ts.net:8443`,
   `LEADERBOARD_API_SECRET` (from step 1), `LEADERBOARD_IP_HASH_SALT` (new random value),
   `LEADERBOARD_ADMIN_TOKEN` (new random value, at least 32 characters). Redeploy.
5. Optional: create `/etc/lullwood-leaderboard/alert.env` for new-record emails, then re-run step 1.
6. Prove it end to end: `curl https://www.lullwoodgame.com/api/leaderboard/current` should return
   `{"record":null}`, not `{"unavailable":true}`.
7. Replace the seed denylist with the real one, as the threat model requires before real players
   see the board.
