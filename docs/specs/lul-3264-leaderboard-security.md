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

## R1. Run times: server-timed run sessions (phase 1, 2026-11-14)

**What happened.** `POST /api/leaderboard` trusted `time_ms` from the browser and only checked the
15.7 s .. 1 h range. A script sent `time_ms: 16000` and took the record.

**Fix (phase 1).** The service now times every Blackout run on its own clock:

1. When a run starts (`enter()` bumps `runSerial`; `components/Leaderboard.tsx` `useRunSession`),
   the browser calls `POST /api/run/start {difficulty, anon_id}`. The route hashes the IP and calls
   the signed `POST /v1/runs/start`, which stores a `run_sessions` row (128-bit random id, server
   `started_at`) and answers `{run_id}`. Starts are limited to `RUN_START_IP_LIMIT` (60) per IP hash
   per hour; rows older than 1 h are pruned on each start.
2. When the child is lifted (the moment the run clock stops, ~11 s before the win screen), the
   browser calls `POST /api/run/finish {run_id, anon_id}` → `/v1/runs/finish`, which stamps
   `finished_at` once.
3. `POST /api/leaderboard` requires a strict-hex `run_id` (400 without it). In one `BEGIN IMMEDIATE`
   transaction the service checks (`checkRunSubmit` in `lib/game/leaderboard.ts`): the session
   exists, is unused, is at most 1 h old, is Blackout, has the same `anon_id` (when it has one), is
   finished, `finished_at - started_at` ≥ `PLAUSIBILITY_FLOOR_MS`, and that differs from `time_ms`
   by at most `RUN_CLOCK_TOLERANCE_MS` (1.5 s). Then it sets `used_at` and stores the client
   `time_ms`, so the board still equals the in-game timer. A refusal answers 400 with only a code
   (`invalid_run`, `run_used`, `run_expired`, `run_unfinished`, `too_fast`, `clock_mismatch`) and
   writes nothing; the route turns the code into a short sentence.
4. The server clock does not stop for a pause, so a run paused at any point before the lift shows
   `#leaderboardPausedNote` instead of the form; a run with no confirmed run id shows
   `#leaderboardUntimedNote`.

Tests: `lib/game/leaderboard.test.ts`, `services/leaderboard-db/db.test.ts` and `server.test.ts`
("runs: ..."), `app/api/run/route.test.ts` (routes plus the real service), `app/api/leaderboard/route.test.ts`,
`e2e/leaderboard-submit.spec.ts`.

**What phase 1 does not stop.** A script can still call start, wait the real time, call finish and
submit a time that matches. So a forged time can no longer be *shorter than the wall-clock time
the script waited*, and never under the floor by the server's clock -- but a script that waits
16 s still passes. Phase 2 (R2 below) asks for evidence of the run itself. Network latency between the start and
finish calls counts against the 1.5 s tolerance; a slow cold start on `/api/run/start` can make an
honest run fail with `clock_mismatch` (the player is told the time could not be verified).

## R2. Proof of play: the run's path (phase 2, 2026-11-14)

**What was still open.** After R1 a script could start a run, wait 16 s, finish it and submit a
matching time without playing. `/api/telemetry` also took any win event as sent (a 0 ms Blackout
win landed in the stats database).

**Fix.** The run finish must carry a trace of the run (`lib/game/run-trace.ts`):

1. The engine records the player's position (int16, 0.25 u steps) every 1 s of run time from
   `enter()` at home, plus one sample at the lift with the child's position (`pickup()`). Samples
   are added for every second boundary passed, so a hidden or throttled tab still has the right
   count (the player cannot move while no frames run). At 240 samples every other one is dropped
   and the interval doubles (1 s → 16 s max), so the trace is at most 1,288 base64 characters for
   any run up to the 1 h ceiling. The body cap of `/api/run/finish` is that plus 1 KB (2.3 KB); the
   service cap stays 4 KB.
2. `useRunSession` sends it with `POST /api/run/finish`. The route checks it with `checkRunTrace`
   (an invalid one never reaches the service), forwards only the known fields, and the service
   checks it again before it stamps `finished_at`. The checks, all with margins against false
   rejections: the version and shape; an interval of 1 s × 2ⁿ, only as long as the run length
   needs; one sample per interval from 0 to `end_ms` (±1); every position on the map (±250 u); the
   first sample within 12 u of home; the child at least 110 u from home (the game's lowest spawn
   is 120 u -- the Blackout spawn is 192 u, but a first run after a difficulty change can still use
   the normal spawn); the lift sample within 8 u of the child (the game allows 3.6 u); and no step
   faster than 1.5 × the fastest the player can move (6 u/s × 1.8 sprint × 1.2 wind assist =
   12.96 u/s, so 19.44 u/s) plus 2 u per step for quantisation and the small hide/shuffle snaps.
3. A refusal is `400 { error: 'invalid_trace' }` (the route adds the player sentence). The service
   logs the reason (`finish refused: invalid_trace reason=too_fast (sample 12: ...)`), never the
   path. Nothing is stamped, so the session can't be submitted (`run_unfinished`). The client shows
   `#leaderboardUnverifiedNote` ("The server couldn't verify this run …") instead of the form, in
   the style of the paused and untimed notes.
4. The service keeps the accepted trace's `end_ms` in `run_traces` (schema version 3, pruned with
   `run_sessions` after 1 h). `checkRunSubmit` then requires `|time_ms − end_ms| ≤ 250 ms` (both
   come from the same frozen run clock), after the R1 checks.
5. **Transition flag.** `LB_TRACE_REQUIRED` (service env, default: required). `LB_TRACE_REQUIRED=0`
   accepts a finish without a trace for the deploy window, so an app build that does not send one
   still works; a trace that *is* sent is always checked.
6. **Telemetry.** `implausibleWin` (`lib/game/leaderboard.ts`): a win event with no usable time, a
   Blackout win under `PLAUSIBILITY_FLOOR_MS`, or any win under `WIN_FLOOR_ANY_TIER_MS` (~4.6 s:
   120 u at 12.96 u/s, halved like the floor) is answered 204 by `/api/telemetry` like any other
   event but not forwarded, and the service drops it again (`202 { stored: false, reason:
   'implausible' }`, logged as `telemetry win dropped`). Losses and every other event are untouched.

**Deploy order.** The two halves are independent in one direction only. Ship the **app first**
(Vercel): an R1 service ignores the extra `trace` field and keeps working. Then ship the
**service**, where the trace becomes required. Tabs opened before the app deploy still send no
trace; to be kind to them, start the service with `LB_TRACE_REQUIRED=0` and remove it after a day.
Shipping the service first with the default (required) setting would refuse every finish from the
old app -- if the service must go first, start it with `LB_TRACE_REQUIRED=0` until the app is live.

Tests: `lib/game/run-trace.test.ts` (recorder, encoding, honest runs incl. low FPS, a hidden tab, a
one-hour run and the fastest legal run; every refusal reason), `lib/game/leaderboard.test.ts`,
`services/leaderboard-db/db.test.ts` and `server.test.ts` ("trace: ...", "events: a win with an
impossible time ..."), `app/api/run/route.test.ts`, `app/api/telemetry/route.test.ts`,
`e2e/leaderboard-submit.spec.ts` (the trace is sent and matches the run; the unverified note).

## Accepted risks

**What R1 + R2 now cover.** A forged leaderboard time needs, for every submission: a run session
started and finished on the server's clock at least `PLAUSIBILITY_FLOOR_MS` apart, matching the
claimed time within 1.5 s; and a trace that walks from home to a plausible child position at a
legal speed, with one sample per second of the claimed time, ending exactly at that time. The
"start, wait, finish, submit" script is refused at the finish. Forged sub-floor telemetry wins no
longer reach the stats database.

**What is still not covered.**

- **A synthesised trace.** The game is still client-authoritative. Someone who reads the client
  code can generate a plausible path (a walk to a point 110+ u away at under 19 u/s) and send it,
  then wait the real time. Their time is then bounded by the walk they faked, not by playing. The
  server does not know the real child position (it depends on the map seed and the Blackout
  spawn draw), the trees, predators or collisions, so it can't tell a real path from a smooth
  invented one. Closing this would need the server to replay the run (a seeded map the server
  can regenerate plus an input log), which is far heavier.
- **No server nonce in the trace.** A nonce from `/runs/start` mixed into the trace would add
  nothing while the client computes the trace: the same script would mix it in too.
- **The fastest legal path is still accepted.** A real run that sprints straight to a Blackout
  child takes about 15–18 s (192 u at 10.8–12.96 u/s); a fake that does the same passes. The response is operational: admin
  invalidate plus the new-record alert, and the refusal log.
- **Telemetry is still unsigned.** Only impossible *win times* are dropped. Plausible but fake
  events (and losses) are still accepted, as before; the in-memory per-anon_id limit is the only
  throttle.
- **False rejections.** The margins are wide (1.5× the real top speed, ±1 sample, 8 u at the
  child, 110 u spawn floor), and a refusal only costs that one run's leaderboard entry, with a
  clear note. Watch `invalid_trace` in the service log after the deploy; a reason that shows up for
  honest players means a margin to widen, not a player to block.

Offensive nicknames will slip past the denylist; deletion is the control. Launch-day gaming is
expected; the new-record email exists so nobody has to watch a dashboard.

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
