# Cost calculation (LUL-381)

The founder reported not seeing money spent anywhere in the platform. That's
because the platform's own spend fields are unpopulated, not because spend is
low — see wiki `systems/spend-accounting-gap` for the measurement. This doc
covers the replacement: `scripts/cost-report.mjs`, which reconstructs spend
from local session transcripts.

## Why the platform can't tell you this

`GET /api/companies/{id}/agents` and `GET /api/companies/{id}` report
`spentMonthlyCents: 0` for every agent and the company record, after six days
of continuous multi-agent operation. There is no usage/cost API —
`/api/runs`, `/api/companies/{id}/runs`, `/api/usage`, and
`/api/companies/{id}/usage` all 404. The field exists in the schema; nothing
populates it. This report does not fix that (out of scope here — see
LUL-399, which wires a real number into the watchdog's stop threshold). It
answers "what did we actually spend" from a different data source in the
meantime.

## Where the numbers come from

Every Claude Code session writes a transcript to
`~/.claude/projects/<workspace-slug>/<session-id>.jsonl`. Each line where
`type: "assistant"` and `message.usage` is present is one billable API call.
`message.usage` carries, per call:

| field | meaning |
|---|---|
| `input_tokens` | base input, billed at the model's input rate |
| `output_tokens` | billed at the model's output rate |
| `cache_read_input_tokens` | a cache **hit** — billed at **0.1x** the input rate |
| `cache_creation.ephemeral_5m_input_tokens` | a cache **write**, 5-minute retention — billed at **1.25x** the input rate |
| `cache_creation.ephemeral_1h_input_tokens` | a cache **write**, 1-hour retention — billed at **2x** the input rate |
| `service_tier` | `"batch"` halves both input and output rates; every call observed so far is `"standard"` |

`message.model` gives the model id (`claude-sonnet-5`, `claude-opus-5`, ...).
Verified against 54,463 real usage events across all 8 agents: on every one
of them, `cache_creation_input_tokens` equals the sum of the two ephemeral
fields exactly (0 mismatches), so the 5m/1h split is always safe to trust.

## Attributing sessions to agents

Seven of the eight agents (VP R&D, Founding Engineer, Backlog Keeper, Game
Tester, Code Reviewer, Game Engineer, plus the two paused built-ins) each run
in their own workspace, and that workspace path — which contains the agent's
UUID — is exactly the transcript directory name. The script matches that
UUID against `/home/noam/.paperclip/shared/wiki/.agents.json` to get a
human name.

**One directory can't be attributed this way**: the shared project directory
at `.../027e840a-8500-4e4b-94b3-9f966f84e079/_default` (this is the shared
game repo's project path, referenced in the Founding Engineer's own
`AGENTS.md`). Multiple agents have used this path as their working
directory at different times, so the transcript directory name alone
doesn't say which agent ran a given session there. The script falls back to
grepping each such session for a literal `PAPERCLIP_AGENT_ID=<uuid>` string
(present when a session dumped its environment) and attributes it if found;
39 sessions live there, only 4 carried that marker. The remaining 35 are
reported under a single `unattributed (shared _default project dir...)`
bucket rather than guessed at. **As of this report that bucket totals
$35.91 measured, $67.13 open-scope on the excluded models below** — small
next to the company total, but real dollars sitting with no name on them.

## Rate table used (founder's card, LUL-381)

$ per 1,000,000 tokens, input / output:

| Model | Input | Output |
|---|---|---|
| Claude Haiku 4.5 (`claude-haiku-4-5`) | $1.00 | $5.00 |
| Claude Sonnet 5 (`claude-sonnet-5`) | $2.00 | $10.00 |
| Claude Opus 5 (`claude-opus-5`) | $5.00 | $25.00 |
| Claude Fable 5 (`claude-fable-5`) | $10.00 | $50.00 |

Cache reads are 0.1x the input rate. Cache writes are 1.25x (5-minute
retention) or 2x (1-hour retention) the input rate. Batch API, when used,
halves both input and output rates.

## What it can't see: two model ids the founder's card doesn't cover

Transcripts also show real, priced-looking usage under **`claude-opus-4-8`**
(306 events) and **`claude-sonnet-4-6`** (5,608 events, more call volume
than any single priced model except `claude-sonnet-5`). Neither string is
on the founder's rate card, which names "Claude Sonnet 5" and "Claude Opus
5" but not these specific snapshot ids. Per LUL-381's own instruction —
*"never invent a rate for a model id you do not recognise"* — the script
reports these as **UNPRICED** and excludes them from the priced total
rather than guessing which card row they belong under. That is a real
judgment call sitting with the founder, not a bug: is `claude-opus-4-8`
billed as "Opus 5", as its own tier, or something else? Same question for
`claude-sonnet-4-6`. Whatever the answer, it changes the total materially
(see below) — this needs an explicit answer, not an assumption baked into
a script silently.

## Current spend to date — measured vs. estimated

Run 2026-08-18, all data from 2026-08-12 (oldest transcript) through today.

**Measured** (only the four rate-carded models, `service_tier: "standard"`
confirmed on every call so batch never applies today):

```
Company total (priced models only): $1,931.63
```

By agent (measured, priced models only):

| Agent | $ |
|---|---|
| VP R&D | $757.65 |
| Founding Engineer | $421.93 |
| Code Reviewer | $236.03 |
| Game Tester | $218.02 |
| Game Engineer | $194.12 |
| Backlog Keeper | $67.97 |
| unattributed (shared dir) | $35.91 |

Full per-agent/per-model/per-day breakdown: `node scripts/cost-report.mjs`.

**Estimated, not measured** — if `claude-opus-4-8` is priced as the same
tier as `claude-opus-5` and `claude-sonnet-4-6` as the same tier as
`claude-sonnet-5` (the closest reasonable guess, *not* a confirmed billing
fact):

```
+$118.76  (claude-sonnet-4-6 ≈ $96.84, claude-opus-4-8 ≈ $21.92)
= ~$2,050 estimated total
```

That's a ~6% swing on the total from two model ids sitting outside the rate
card — worth the founder's five minutes to confirm before it's trusted as a
real number.

## What this can and cannot see

**Can:**
- Every local Claude Code session on this machine, going back to the oldest
  retained transcript (2026-08-12 here — transcripts may be pruned by the
  client over time, this is not a permanent ledger).
- Per-agent, per-model, per-day breakdown, plus cache read/write token
  volumes, plus batch-tier detection.

**Cannot:**
- Anything not run through this machine's Claude Code sessions — e.g. API
  calls made directly, or from an agent's transcripts that have since been
  pruned or that live on a different host.
- Confirm these are the actual dollars Anthropic billed. This reconstructs
  cost from the rate card the founder supplied; it does not read an
  invoice or billing API (none exists per the spend-accounting-gap
  finding). Treat it as the best available estimate of ground truth, not
  ground truth itself.
- Anything about models outside the rate card, by design (see above) —
  it will not silently under- or over-count them.

## Running it

```bash
node scripts/cost-report.mjs                    # human-readable table + totals
node scripts/cost-report.mjs --json              # machine-readable, for feeding LUL-399's watchdog wiring
node scripts/cost-report.mjs --since=2026-08-15  # restrict to calls on/after a date
```

Read-only: it only reads `~/.claude/projects/**/*.jsonl` and the wiki's
`.agents.json`. It does not call any API, does not spend anything, and does
not touch the watchdog's stop thresholds — that wiring is LUL-399, a
separate ticket, deliberately.
