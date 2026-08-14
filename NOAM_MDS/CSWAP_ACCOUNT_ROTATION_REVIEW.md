# cswap / Claude-Code account rotation — full review (LUL-36)

**WEB SEARCH DISCLOSURE — READ FIRST.** Yes, I searched the web for this document. I do
have web access in this run (`WebSearch` + `WebFetch` tools, both working). Everything
below that is not marked *"measured on this box"* came from these searches, and every
source I actually opened or read results from is listed here:

| # | Source | What I took from it |
|---|---|---|
| 1 | https://github.com/realiti4/claude-swap | The `cswap` README: subcommands, Linux credential paths, auto-switch thresholds/strategies, cooldown + hysteresis, the "do not `/logout` first" warning |
| 2 | https://pypi.org/project/claude-swap/ | v0.25.0, released 2026-08-11, MIT licence, requires Python >= 3.12 |
| 3 | https://libraries.io/pypi/claude-swap | Package/maintenance metadata cross-check |
| 4 | https://github.com/trilliverse/claude-switch | Alternative tool (simple account switcher) |
| 5 | https://github.com/XueshiQiao/CCSwitcher | Alternative tool (GUI/click switcher) |
| 6 | https://umesh-malik.com/blog/claude-swap-multi-account-switcher-guide | Third-party walkthrough of claude-swap |
| 7 | https://claudeers.com/claude-swap · https://skillsllm.com/skill/claude-swap | Secondary listings, popularity check |
| 8 | https://www.anthropic.com/legal/aup | **Anthropic Usage Policy — verbatim clauses quoted in §5** |
| 9 | https://dev.to/vainamoinen/two-multi-account-claude-code-architectures-one-anthropic-accepts-one-they-ban-2om7 | The relay-vs-profile distinction; detection signals |
| 10 | https://metricnexus.ai/blog/anthropic-banning-multiple-claude-accounts | Reported Feb-2026 multi-account ban wave |
| 11 | https://autonomee.ai/blog/claude-code-account-suspended-banned-safe-usage/ | Suspension causes / risk factors |
| 12 | https://www.grandlinux.com/en/blogs/claude-account-ban-risk.html | Risky vs compliant multi-account patterns |
| 13 | https://www.aifreeapi.com/en/posts/avoid-claude-code-ban | Same, secondary |
| 14 | https://www.truefoundry.com/blog/claude-code-limits-explained | 5-hour + weekly limit structure |
| 15 | https://github.com/anthropics/claude-code/issues/36320 | Feature request: auto-resume after limit reset; no rate-limit exit code exists |
| 16 | https://github.com/anthropics/claude-code/issues/48786 · /24317 · /25609 · /27933 · /43392 · /54443 · /65851 | **The refresh-token race condition with concurrent sessions — the single biggest technical risk for us (§6.2)** |
| 17 | https://gist.github.com/Prajwalsrinvas/cacbb728c4ea06c3bc1676608d3c72dc | Credential file shape across OSes |
| 18 | https://code.claude.com/docs/en/settings | Official settings/env-var reference (checked for `CLAUDE_CONFIG_DIR` — see §3) |
| 19 | https://github.com/anthropics/claude-code/issues/34262 | `.credentials.json` vs Keychain behaviour |
| 20 | https://www.theregister.com/2026/01/05/claude_devs_usage_limits/ | Context on limit enforcement tightening |

Written 2026-08-15 by VP R&D. Companion pages in the shared wiki:
`systems/rate-limit-watchdog`, `incidents/2026-08-13-session-limit-stall`.

---

## 1. The one-paragraph answer

`cswap` is real, it is maintained, it is MIT-licensed, and it will technically work on this
Ubuntu 26.04 box tonight. **The problem is not whether it works — it is that what you are
asking it to do is the exact behaviour Anthropic's Usage Policy names and the exact
behaviour that produced a reported ban wave in February 2026.** There is a legitimate
version of multi-account Claude Code (separate profiles, separate humans, separate
workloads) and an illegitimate one (one operator rotating accounts to get past a limit),
and the difference is *purpose*, not tooling. Our ask — "when the limit is exceeded, switch
to another OAuth" — is by construction the second one. I am not going to pretend otherwise
in a document you will act on. §5 gives you the policy text, §6 gives you the technical
risks that apply *even if you accept the policy risk*, §7 gives you the full design you
asked for, and §8 gives you the compliant alternative that gets you the same outcome
(continuous operation) without betting the accounts.

---

## 2. What `cswap` actually is

`cswap` is the CLI name of **`claude-swap`** by GitHub user `realiti4`
([repo](https://github.com/realiti4/claude-swap)). Not to be confused with `cswap` the
crypto/constant-time-swap primitive, which is what the name collides with in search.

* **Version 0.25.0**, released 2026-08-11 — actively developed.
* **MIT licence**, Python **>= 3.12**.
* Works with the Claude Code CLI *and* the VS Code extension, on macOS / Linux / Windows.

### Subcommands (from the README)

| Command | What it does |
|---|---|
| `cswap add` | Registers the **currently logged-in** account into its store |
| `cswap list` | All accounts side by side with usage % and reset times |
| `cswap switch [n\|email]` | Rotate to next account, or jump to a named one |
| `cswap auto` | Foreground polling loop; auto-switches before a limit is hit |
| `cswap auto --once` | **Single check, then exit — this is the cron-friendly form** |
| `cswap run [n]` | Launch Claude Code as a specific account *in this terminal only* |
| `cswap map [n] [path]` | Bind an account to a repo path |
| `cswap status` | Which account is active now |
| `cswap config set …` | Thresholds, strategy, cooldown |
| `cswap alias / remove / disable / enable` | Housekeeping; `disable` excludes an account from rotation |
| `cswap` (bare) | Full-screen TUI dashboard |

### How the auto-switcher works

* Watches the active account's **5-hour** and **7-day** windows.
* Fires at a **threshold, default 90 %** (`cswap config set autoswitch.threshold 80`).
* **Strategies:** `best` (pick the account with the most quota left) or `consume-first`
  (drain the account whose window resets soonest).
* **Cooldown** (default 5 min) plus a **hysteresis margin** so it can't flip-flop around
  the threshold.
* README claims it takes the same credential locks Claude Code takes, to avoid colliding
  with token refreshes. **I have not verified that claim by reading the source — see §6.2,
  where it matters a great deal.**

### Where it keeps state on Linux

```
${XDG_DATA_HOME:-~/.local/share}/claude-swap/
├── settings.json
└── credentials/        # one saved .credentials.json blob per account
```

(On macOS/Windows it is `~/.claude-swap-backup/`. Linux is file-based because there is no
Keychain to migrate into — which is why this works more cleanly on our box than on a Mac.)

### README's own operational warning

> "Do not run `/logout` first: current Claude Code may revoke the refresh token stored for
> the account you are leaving."

That is a live footgun. A single `/logout` by anyone — including you, in your own
interactive session — can invalidate a stored account and silently take it out of the pool.

### Alternatives I looked at

| Tool | Verdict |
|---|---|
| [`trilliverse/claude-switch`](https://github.com/trilliverse/claude-switch) | Plain manual switcher. No usage tracking, no auto-rotation. Simpler, and *because* it has no auto-rotate it carries less policy risk. |
| [`XueshiQiao/CCSwitcher`](https://github.com/XueshiQiao/CCSwitcher) | Click-to-switch, GUI-oriented. Not useful headless. |
| Relay servers (`claude-relay-service`, PackyCode, AnyRouter) | **Do not touch.** See §5.2 — this is the architecture that gets banned. |
| Native `CLAUDE_CONFIG_DIR` profiles | No third-party code at all. **This is the mechanism I would actually build on** — see §3 and §7. |

---

## 3. Ground truth about *this* server (measured, not googled)

Everything in this section I checked directly on the box during this run.

| Fact | Value |
|---|---|
| OS | Ubuntu **26.04 LTS** (`resolute`), Linux 7.0.0-29-generic, x86-64 |
| Timezone | **Asia/Jerusalem (IDT, UTC+3)** — critical for your Fri/Sat windows, see §7.3 |
| Interactive CLI | `claude` 2.1.232 → `/home/noam/.local/share/claude/versions/2.1.232` (ELF binary) |
| **Agent runtime** | Paperclip agents do **not** use that binary. They run `/home/noam/.local/lib/node_modules/paperclipai/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude` via `claude-agent-acp` |
| Credentials | `/home/noam/.claude/.credentials.json`, mode `0600`, plain JSON. **No keyring/gnome-keyring installed** — no Keychain complication |
| Credential shape | `claudeAiOauth: { accessToken sk-ant-oat01-…, refreshToken sk-ant-ort01-…, expiresAt, refreshTokenExpiresAt, scopes[5], subscriptionType, rateLimitTier }` |
| **Subscription** | `subscriptionType: **pro**`, `rateLimitTier: default_claude_ai` — **we are on Pro, not Max** |
| `CLAUDE_CONFIG_DIR` support | **Yes, in both binaries** — 49 string hits in the 2.1.232 CLI, 43 in the agent-SDK binary. Note it is *not* in the public settings docs page I fetched, so treat it as supported-but-underdocumented |
| Concurrency | 2+ agent processes were live while I wrote this, **all sharing the one credentials file** |
| Python | 3.14.4. **No `uv`, no `pipx`** — an install needs one of those or a venv |
| Scheduling | `cron` in use (3 jobs incl. the watchdog every 10 min) **and** systemd user manager is `running` — timers are available |

Two consequences fall straight out of that table:

1. **`subscriptionType: pro` is the real story.** Pro is the smallest plan. A large part of
   the pain this ticket exists to solve is that we are running a multi-agent studio on a
   Pro seat. Upgrading the *one* account is a smaller, cheaper, fully-legitimate lever than
   building rotation infrastructure, and it should be priced before any of this is built.
2. **Swapping `~/.claude/.credentials.json` swaps it for every running agent at once.**
   There is no per-agent isolation today. That is §6.2, and it is the thing most likely to
   break us in practice.

---

## 4. How to install it on this box (if you decide to)

I have **not** installed anything. This is the procedure, for review.

```bash
# 1. Get an installer (neither uv nor pipx is present)
python3 -m venv ~/.local/opt/claude-swap
~/.local/opt/claude-swap/bin/pip install claude-swap
ln -s ~/.local/opt/claude-swap/bin/cswap ~/.local/bin/cswap

# 2. Register the account that is currently logged in
cswap add                      # -> saves ~/.claude/.credentials.json into its store
cswap list

# 3. For each ADDITIONAL account: log in as it, then add it.
#    NOTE: this box is headless. `claude /login` needs a browser round-trip
#    (open URL on your laptop, paste the code back). YOU have to do this per account.
#    DO NOT run /logout between accounts -- it can revoke the token you just saved.

# 4. Configure conservatively
cswap config set autoswitch.threshold 90
cswap config set autoswitch.strategy best
cswap config set autoswitch.cooldown 300
```

**Blocker for you, not me:** step 3 is interactive OAuth on a headless server. I cannot do
it, and I should not be handed the credentials to do it. You will need to run each login
yourself and hand me nothing more than confirmation that `cswap list` shows N accounts.

**Uninstall / rollback** is clean: `rm -rf ~/.local/opt/claude-swap ~/.local/bin/cswap` and
`rm -rf ~/.local/share/claude-swap` (that last one destroys the stored tokens — back it up
first if you want to keep them).

---

## 5. Risk #1 — policy. Read this before the engineering.

### 5.1 What the Usage Policy actually says

Fetched from https://www.anthropic.com/legal/aup. Verbatim, the clauses that bear on this:

> "Circumvent a ban through the use of a different account, such as the creation of a new
> account, use of an existing account, or providing access to a person or entity that was
> previously banned"

> "Coordinate malicious activity across multiple accounts to avoid detection or circumvent
> product guardrails"

> "Utilize automation in account creation or to engage in spammy behavior"

And Anthropic's agent policy separately says not to create or manage multiple accounts to
evade detection or circumvent safeguards.

**Honest reading.** Merely *holding* two Claude subscriptions is not itself a violation —
plenty of people have a personal and a work account. None of the clauses above says
"rotating accounts on rate limit" in those words. But the design in this ticket —
automation that detects a limit and moves to a different account specifically so the work
continues past that limit — is squarely inside the intent of "circumvent … guardrails," and
a rate limit is a guardrail. If you asked an Anthropic trust-and-safety reviewer whether an
always-on rotation daemon on one server is what the policy contemplates, the answer is no.
I would not build this and describe it internally as compliant.

### 5.2 The distinction that actually predicts enforcement

The most useful thing I found ([source 9](https://dev.to/vainamoinen/two-multi-account-claude-code-architectures-one-anthropic-accepts-one-they-ban-2om7))
splits multi-account setups in two:

* **Architecture A — the relay/proxy.** A server holding many OAuth tokens, impersonating
  the official client (`claude-relay-service`, PackyCode, AnyRouter). **Banned in waves.**
  Detection: one source endpoint, many tokens, high volume per token; token-scope binding
  checks; telemetry the official client emits that a relay cannot reproduce.
* **Architecture B — per-profile isolation.** The *real* Anthropic binary, run N times, each
  against its own config directory (`CLAUDE_CONFIG_DIR=~/.claude-acct2`), each logged in
  separately. **Acknowledged and not flagged** — the env var is Anthropic's own, and
  their issue #261 documents the pattern.

`cswap` is neither, exactly. It runs the official binary (good, B-like) but it rotates
credentials **inside one profile on one machine on a schedule tied to limits** (bad,
A-like intent, same endpoint, same fingerprint). It sits in the middle, and the part that
makes it middling is precisely the auto-rotation feature we want.

### 5.3 What "it goes wrong" costs

Reported outcome in the Feb-2026 wave: **accounts locked out, all of them, including the
ones that were being used legitimately.** Consequences for us specifically:

* Every Lullwood agent stops at once. Not degraded — stopped.
* Your personal account is plausibly in the blast radius, since it is the same human,
  same IP, same box.
* Appeals exist but are slow and not guaranteed; assume days, assume maybe never.
* The repo, CI, and Vercel survive; the *studio* does not.

Weigh that against what rotation buys: more hours per week on a **Pro** plan.

### 5.4 My recommendation

**Do not build the auto-rotation daemon.** Do §8 instead. If you overrule me — which is
your call, they are your accounts and your money — then build the *narrow*, windowed,
manual-ish version in §7 rather than a 24/7 rotator, because the windowing you already
asked for genuinely reduces exposure. I have written that design out in full below,
because you asked for it and because a half-specified version of it would be worse.

---

## 6. Risk #2 — the technical risks, which apply *even if* you accept §5

### 6.1 There is no reliable "limit exceeded" signal to trigger on

This is the load-bearing weakness of the whole idea. Claude Code **does not exit with a
distinct rate-limit exit code** — that is an open feature request
([issue #36320](https://github.com/anthropics/claude-code/issues/36320)), not a shipped
feature. So a rotator has exactly three ways to know it is time to switch, and all three
are bad:

1. **Scrape the error text** ("You've hit your session limit · resets 10:10pm"). String
   matching against a UI message that changes without notice. Brittle.
2. **Estimate from local transcripts** — what our own watchdog does. We already learned
   the hard way that this produces **false positives**: `systems/rate-limit-watchdog`
   records *three separate* false HOLDs from three different root causes, and the 5-hour
   estimate is now explicitly demoted to advisory because it cannot see the founder's own
   interactive usage on the same subscription. A rotator driven by that estimate would
   burn a second account early, on a limit that was never hit.
3. **Wait for a real 429.** Trustworthy, but by then the run has already died.

`cswap` uses (2)-style polling against a 90 % threshold. On our box, with our measurement
problems, **90 % of an unknown denominator is not a threshold** — it is a guess. This is
the part I am least willing to hand-wave: we do not currently know our own ceiling. The
watchdog page says so in as many words ("the honest position is that we have no upper
bound — only cap > X").

### 6.2 The refresh-token race — the one that will actually bite us

This is heavily documented in the Claude Code tracker: issues
[#48786](https://github.com/anthropics/claude-code/issues/48786),
[#24317](https://github.com/anthropics/claude-code/issues/24317),
[#25609](https://github.com/anthropics/claude-code/issues/25609),
[#27933](https://github.com/anthropics/claude-code/issues/27933),
[#43392](https://github.com/anthropics/claude-code/issues/43392),
[#54443](https://github.com/anthropics/claude-code/issues/54443),
[#65851](https://github.com/anthropics/claude-code/issues/65851).

The mechanics: OAuth refresh tokens here are **single-use and rotating**. All CLI sessions
share one `~/.claude/.credentials.json` with one refresh token. When several processes
refresh at once, one wins and the others are left holding an invalidated token — and get
forced back to `/login`. Reported at 4–7 concurrent sessions; **we run multiple Paperclip
agents concurrently right now.**

Now add a swapper that rewrites that same file underneath them. Concretely, what breaks:

* A mid-flight agent whose next request uses a token for an account it did not start on.
* An agent that survives the swap but whose *transcript* now spans two accounts, which
  silently corrupts the watchdog's per-account usage accounting — the thing the rotator
  depends on to decide when to rotate next.
* A swap landing exactly on a refresh, invalidating a stored account for good and
  quietly shrinking the pool.

`cswap`'s README says it takes the same locks Claude Code takes. Even taken at face value,
locking makes the *file write* atomic; it does not make an in-flight agent's notion of
"which account am I" atomic. **Mitigation is mandatory: never swap while an agent is
running.** See §7.5.

### 6.3 Everything else

| Risk | Severity | Note |
|---|---|---|
| Plaintext OAuth tokens for N accounts in one directory | **High** | `~/.local/share/claude-swap/credentials/` becomes a single high-value target. Anyone with the `noam` user owns every account at once. `chmod 700` minimum. Never into git — and this repo has a public-repo milestone. |
| Third-party code in the auth path | **High** | v0.25.0, MIT, one maintainer, fast-moving. It handles live refresh tokens. **Pin the exact version, read the diff before every upgrade, never auto-update.** |
| `/logout` revokes a stored account | Medium | Per the README. One stray `/logout` (yours, in a normal session) silently drops an account from the pool. |
| Silent quota exhaustion | Medium | Rotation removes the feedback that tells you you're overspending. You stop noticing you hit a limit — you just consume the next account. |
| Watchdog conflict | Medium | Two systems both reading transcripts and both deciding "stop / don't stop", with different models of the truth. They must not both be authoritative — see §7.6. |
| Bus factor / drift | Low | If Anthropic changes the credential file shape, the rotator breaks and every agent fails auth simultaneously. |

---

## 7. The design you asked for — limit-triggered switching, windowed to Fri/Sat + 00:00–05:00

Presented in full so the decision in §5.4 is an informed one. **Do not implement without an
explicit go-ahead on this ticket.**

### 7.1 First: confirm what the window means

Your words: *"only in specific times like saterday and firdays or everyday from 00:00 to
5:00."* Two readings:

* **(A)** Rotation allowed *all day* Friday and Saturday, **plus** 00:00–05:00 every day.
* **(B)** Rotation allowed only 00:00–05:00, and only on Fridays and Saturdays.

I have written the code for **(A)** and left (B) as a one-line change. Tell me which.

Either way — **the windowing is the best part of this proposal.** It is what turns an
always-on rotator into an occasional off-hours failover. It caps exposure, it keeps the
weekday signal honest (we still *feel* the limit Mon–Thu, so we still see the real cost),
and it confines swaps to hours when few agents are mid-flight.

### 7.2 Architecture: profiles, not file-swapping

Do **not** let anything rewrite `~/.claude/.credentials.json` under running agents (§6.2).
Use `CLAUDE_CONFIG_DIR` — verified present in both binaries on this box (§3) — and give
each account its own profile directory:

```
~/.claude              # account 1 (primary). Untouched. Your interactive session lives here.
~/.claude-acct2        # account 2. Populated by its own `claude /login`.
```

Rotation then means **changing one env var for newly-spawned agents**, not mutating shared
state. A running agent keeps the profile it started with, for its whole life. This is
Architecture B from §5.2 — the shape that is not flagged — and it removes the entire
refresh-race class of failure.

`cswap` is then optional: useful as a **dashboard** (`cswap list` across profiles) even if
you never enable `cswap auto`. That is the version of this I would be most comfortable
running: cswap for visibility, our own code for the decision.

### 7.3 The window gate

Server clock is **Asia/Jerusalem (UTC+3)** — pin it explicitly, never inherit.

```bash
#!/usr/bin/env bash
# ~/.paperclip/shared/swap/bin/swap-window
# exit 0 = inside an allowed rotation window, 1 = outside
export TZ=Asia/Jerusalem
dow=$(date +%u)   # 5=Fri 6=Sat
hour=$(date +%-H)

# Reading (A): all of Fri/Sat, plus 00:00-04:59 every day
if [ "$dow" -eq 5 ] || [ "$dow" -eq 6 ]; then exit 0; fi
if [ "$hour" -lt 5 ]; then exit 0; fi
exit 1
# Reading (B) instead: replace the two ifs with
#   [ \( "$dow" -eq 5 -o "$dow" -eq 6 \) -a "$hour" -lt 5 ] && exit 0 || exit 1
```

Note the DST trap: Israel shifts IDT/IST, so `00:00–05:00` is a *wall-clock* window and the
UTC offset moves twice a year. `TZ=Asia/Jerusalem` + `date` handles that correctly; a
hardcoded UTC cron expression would not. Keep the logic in the script, not the crontab.

### 7.4 The trigger

Given §6.1, trigger on the **trustworthy** signal only — a real, unexpired 429 — never on a
transcript estimate. Our watchdog already ranks signals exactly this way and already
records the 429 and its reset time.

```
rotate if ALL of:
  1. swap-window            -> exit 0        (we are inside Fri/Sat or 00:00-05:00)
  2. watchdog gate          -> exit 10 (HOLD) AND the reason is a real 429
  3. no agent process is mid-run             (see 7.5)
  4. a target profile exists whose own limit is NOT currently exhausted
  5. last rotation was > 60 min ago          (cooldown, wider than cswap's 5 min)
```

If any fails: do nothing, let the watchdog's normal `wait`-until-reset behaviour run. The
default must be "wait", not "rotate" — rotation is the exception path, not the happy path.

### 7.5 Quiescence — non-negotiable

Never rotate with agents in flight (§6.2). Sequence:

1. Watchdog `checkpoint`s the active ticket on every agent (this already exists).
2. Pause the Paperclip scheduler so no *new* agent spawns.
3. Wait for `claude-agent-acp` / agent-SDK `claude` processes to reach zero — bounded wait,
   say 10 minutes; if it does not drain, **abort the rotation** and keep the current
   profile.
4. Flip `CLAUDE_CONFIG_DIR` for the runtime.
5. Unpause. New agents come up on the new profile.

Step 3's abort is what keeps a bad night from becoming a corrupted-auth morning.

### 7.6 One authority

The watchdog decides *whether work may proceed*. The rotator only ever answers *which
profile new work uses*. The rotator must never override a HOLD, and must never be the thing
that clears one. Two schedulers with two truths is how we get the 2026-08-13 stall again
(`incidents/2026-08-13-session-limit-stall`).

### 7.7 Scheduling

```cron
# rotation check -- every 15 min; the script no-ops outside the window
*/15 * * * * /home/noam/.paperclip/shared/swap/bin/rotate-cron # lullwood-swap
```

The script self-gates on `swap-window`, so the cron expression stays dumb and DST-proof.
A systemd user timer would work equally well and gives better logs; cron matches the three
jobs already on this box, so I would stay with cron for consistency.

### 7.8 What I would *not* build

* No `cswap auto` daemon (threshold-driven, 24/7 — the highest-exposure mode).
* No relay/proxy, ever (§5.2).
* No third account. Two is a failover pair; three-plus starts looking like a fleet, which is
  exactly the pattern in the reported ban wave.
* No rotation during your interactive hours — you would lose your own session's account
  under you.

---

## 8. The alternative that gets you continuous operation without the bet

Your own founding brief already contains the answer, and I want to put it back in front of
you because it makes most of §7 unnecessary:

> "Truly continuous operation requires the Anthropic API, which has no session/weekly caps;
> a $20 subscription cannot run non-stop."

That is correct, and it is still correct. The API path:

* has **no 5-hour or weekly window** — the two limits this whole ticket exists to dodge;
* is billed per token, so it is capped by the **monthly $ ceiling** the brief already
  mandates (alerts at 50/80/100 %) — a control we *want* and currently do not have, since
  the subscription path has no per-token spend to cap;
* is unambiguously within terms — no rotation, no evasion, no ban risk;
* needs no third-party code in the auth path;
* removes the refresh-race entirely, because agents authenticate with an API key.

Ordered by cost, the honest ladder is:

1. **Upgrade the one account.** We are on **Pro** (measured, §3). Pro → Max is a large
   multiple of the limits we keep hitting, for one legitimate subscription, zero new
   infrastructure, zero policy risk. **This should be priced first.** It may end the
   problem outright.
2. **Move the agent fleet to the API** with a hard monthly cap. This is what the brief
   already asked for and is the only genuinely *continuous* option.
3. **Hybrid:** your interactive session stays on the subscription; the agent fleet runs on
   API keys. Clean separation, no shared credential file, and §6.2 disappears.
4. Rotation (§7) — last, and only if 1–3 are refused.

Options 1–3 all require **spend approval**, which is one of the founder-only gates. That is
the actual decision on this ticket. I cannot make it and would not want to.

---

## 9. Decision requested

1. **Fri/Sat window — reading (A) or (B)?** (§7.1)
2. **Do you want §7 built at all**, given §5? My recommendation is no.
3. **May I price options 1–3 in §8** (Pro→Max upgrade, and API cost at our current burn) and
   bring you numbers? This is the one I would like a yes on. It needs no spend to *quote*.
4. If §7 is a go: **you must perform the OAuth logins yourself** (§4 step 3, headless box),
   and I will need confirmation of how many accounts exist — never the tokens.

Until then this stays a document. Nothing in §4 or §7 has been installed, scheduled, or
run; the only change on disk from this ticket is the file you are reading.
