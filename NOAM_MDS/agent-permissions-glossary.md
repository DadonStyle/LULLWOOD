# Agent permission / config boolean glossary

Educational reference for Noam: every boolean-valued setting that governs agent behavior
in the Lullwood Paperclip company, what each one actually does, and its current value for
every agent, as of **2026-08-15**.

## How this was gathered

Pulled live via the `paperclipai` CLI:

```
paperclipai company get <companyId> --json
paperclipai agent list --company-id <companyId> --json
paperclipai agent get <agentId> --json      # once per agent, all 7
```

Then every key in each JSON payload was walked recursively and every field whose value is
`true`/`false` was pulled out — not just the ones named in the ticket, so this should be a
complete sweep, not a curated subset.

**One gap, openly flagged:** `paperclipai agent get <id>` returns an agent's own
`adapterConfig` and `runtimeConfig` in full **only when the caller is that same agent**.
For every other agent it comes back as `{}` — this Founding Engineer agent doesn't hold the
`agents:configure` grant needed to read another agent's adapter/runtime config (only the
VP R&D does). So the `adapterConfig.*` and `runtimeConfig.heartbeat.*` rows below are fully
live-verified **only for the Founding Engineer** (this agent). For the other six, the table
uses the best available value from the shared wiki (`agents/roster`), each one individually
sourced and dated, and marked **"wiki, not re-verified this run"**. A follow-up ticket,
**LUL-98**, is assigned to the VP R&D (who does hold the grant) to pull the other six live
and correct this table if anything drifted.

Everything else below — every `permissions.*` and `access.*` field, and both company-level
flags — **is freshly pulled live** from this run, for all 7 agents.

---

## 1. Company-level flags

These apply to the whole company, not to any one agent.

| Flag | Current value |
|---|---|
| `requireBoardApprovalForNewAgents` | **`false`** |
| `feedbackDataSharingEnabled` | **`false`** |

**`requireBoardApprovalForNewAgents`** — when `true`, every new agent hire
(`POST /api/companies/{id}/agent-hires`) lands in `status: pending_approval` and does not
run — its config is frozen, its instruction bundle is frozen — until a human board member
approves it, *regardless* of whether the hiring agent has `canCreateAgents: true`. When
`false` (current state), a hire created by an agent with `canCreateAgents: true` can start
running without a human approval step. This is a hiring-only gate: it does **not** touch
the separate approval gates for making the repo public, first production deploy, spend,
DNS, secrets, or force-push — those stay in force no matter what this flag is set to. It
was flipped to `false` by the founder on 2026-08-15 (LUL-32).

**`feedbackDataSharingEnabled`** — controls whether this company's feedback/interaction
traces are shared out through Paperclip's feedback-data-sharing pipeline. `true` enables
export/sharing of those traces; `false` (current state) keeps them private to the company.
Companion fields `feedbackDataSharingConsentAt` / `...ConsentByUserId` /
`...TermsVersion` are all `null`, consistent with sharing never having been turned on.

---

## 2. Per-agent flags: what each one means

### `permissions.canAssignTasks`
The agent's baseline role grants it the ability to assign an issue to another agent
(`assigneeAgentId`) directly. `true` = assignment is part of the agent's role permissions
out of the box. Note this is the *raw* permission — see `access.canAssignTasks` below for
what Paperclip actually enforces, which can be `true` even when this raw field is absent,
because it can also come from an explicit grant.

### `permissions.canCreateAgents`
`true` = the agent may call the agent-hire endpoint to create new agents at all (still
subject to the company's `requireBoardApprovalForNewAgents` gate above). `false` = the
agent gets a 403 the moment it tries — hiring is not available to it under any
circumstance.

### `permissions.canCreateSkills`
`true` = the agent may author/update Paperclip skills (for itself or the company).
`false` = it cannot create or edit skills.

### `permissions.builtInMutationPolicy.*` (built-in agents only)
Only appears for Paperclip's built-in agents (here: Reflection Coach). Governs how a
*proposed* change from that built-in is allowed to actually take effect:

- **`requiresDisplayedDiff`** — `true` means a mutation the agent proposes must be shown to
  a human/board as a visible diff before it can be applied; it can't silently change
  things.
- **`applyInSeparateFollowUpRun`** — `true` means the apply step cannot happen in the same
  run that proposed the change; it needs a distinct follow-up run, which forces a
  checkpoint between "here's what I'd change" and "the change is now live."
- **`requiresAcceptedTaskInteraction`** — `true` means the change can only be applied after
  a task/issue-thread interaction (e.g. a `request_confirmation`) has been explicitly
  accepted; a pending or rejected interaction blocks the apply.

### `access.canAssignTasks` (computed, all agents)
This is the *resolved* value Paperclip actually checks when the agent tries to assign an
issue — it folds together the raw `permissions.canAssignTasks` field, the agent's role
(e.g. CEO gets it for free), and any explicit `tasks:assign` grant. It can be (and often
is, in this company) `true` even for agents whose raw `permissions.canAssignTasks` field is
absent, because Backlog Keeper, Game Tester, Code Reviewer, Reflection Coach, and Summarizer
all hold it via an explicit `tasks:assign` grant or a `simple_default` role rule instead of
the raw permission field. Treat the raw field as "granted by role config" and this one as
"what actually happens if the agent tries."

### `adapterConfig.dangerouslySkipPermissions`
`true` = the underlying Claude Code process for this agent runs with tool-call permission
prompts skipped entirely — fully autonomous, nothing ever pauses waiting for a human to
click "allow." `false`/unset = the agent's first tool call that needs approval stalls
indefinitely in an unattended run, because there's no one present to answer the prompt.
Per the shared wiki: "every working agent here has it, a fresh hire does not" — it's the
single flag most responsible for whether a newly hired agent's first run actually does
anything.

### `runtimeConfig.heartbeat.enabled`
`true` = the agent's periodic heartbeat timer is active and it wakes on its own schedule.
`false` = it only runs when something explicitly invokes/wakes it (assignment, on-demand
wake call, etc.), never on a timer.

### `runtimeConfig.heartbeat.wakeOnDemand`
`true` = the agent can be woken immediately outside its regular interval — e.g. the moment
an issue is assigned to it, or via an explicit wake call — rather than waiting for the next
scheduled tick.

### `runtimeConfig.heartbeat.skipTimerWhenNoActionableWork`
`true` = a scheduled heartbeat tick is skipped (no run happens, no model call spent) if the
agent has no actionable work queued at that moment. `false` = it runs on schedule
regardless of whether there's anything to do, burning a run for nothing.

---

## 3. Current value per agent

Agents, left to right: **VP R&D**, **Founding Engineer**, **Game Tester**, **Code
Reviewer**, **Backlog Keeper**, **Summarizer**, **Reflection Coach**.

### `permissions.*` and `access.*` — live-verified, all 7

| Flag | VP R&D | Founding Engineer | Game Tester | Code Reviewer | Backlog Keeper | Summarizer | Reflection Coach |
|---|---|---|---|---|---|---|---|
| `permissions.canAssignTasks` | `true` | `true` | *(absent)* | *(absent)* | *(absent)* | *(absent)* | *(absent)* |
| `permissions.canCreateAgents` | `true` | `true` | `false` | `false` | `false` | `false` | `false` |
| `permissions.canCreateSkills` | `true` | `true` | `true` | `true` | `true` | `false` | `false` |
| `permissions.builtInMutationPolicy.requiresDisplayedDiff` | n/a | n/a | n/a | n/a | n/a | *(absent — see note)* | `true` |
| `permissions.builtInMutationPolicy.applyInSeparateFollowUpRun` | n/a | n/a | n/a | n/a | n/a | *(absent — see note)* | `true` |
| `permissions.builtInMutationPolicy.requiresAcceptedTaskInteraction` | n/a | n/a | n/a | n/a | n/a | *(absent — see note)* | `true` |
| `access.canAssignTasks` (computed) | `true` | `true` | `true` | `true` | `true` | `true` | `true` |

*Note on Summarizer's `builtInMutationPolicy`:* both Summarizer and Reflection Coach are
Paperclip built-in agents, but only Reflection Coach's `permissions` block carries a
`builtInMutationPolicy` object in the live response — Summarizer's genuinely does not
include the key at all (not `false`, just absent). Read literally rather than assumed:
Summarizer currently has no displayed-diff / follow-up-run / accepted-interaction gate
recorded on it, unlike Reflection Coach which has all three set `true`.

*Note on `canAssignTasks` (raw vs. computed):* five of the seven agents have no raw
`permissions.canAssignTasks` field at all, yet `access.canAssignTasks` is `true` for every
single agent in the company. Each of those five holds it through an explicit `tasks:assign`
grant (Game Tester, Code Reviewer, Backlog Keeper, Founding Engineer all show one in their
`access.grants`) or a `simple_default` role rule (Summarizer, Reflection Coach) — see the
`access.canAssignTasks` explanation above.

### `adapterConfig.*` and `runtimeConfig.heartbeat.*`

| Flag | VP R&D | Founding Engineer | Game Tester | Code Reviewer | Backlog Keeper | Summarizer | Reflection Coach |
|---|---|---|---|---|---|---|---|
| `adapterConfig.dangerouslySkipPermissions` | presumed `true`¹ | **`true`** (live) | `true`² | presumed `true`¹ | `true`³ | unknown⁴ | unknown⁴ |
| `runtimeConfig.heartbeat.enabled` | not re-verified⁵ | **`true`** (live) | not re-verified⁵ | not re-verified⁵ | not re-verified⁵ | unknown⁴ | unknown⁴ |
| `runtimeConfig.heartbeat.wakeOnDemand` | not re-verified⁵ | **`true`** (live) | not re-verified⁵ | not re-verified⁵ | not re-verified⁵ | unknown⁴ | unknown⁴ |
| `runtimeConfig.heartbeat.skipTimerWhenNoActionableWork` | not re-verified⁵ | **`true`** (live) | not re-verified⁵ | not re-verified⁵ | not re-verified⁵ | unknown⁴ | unknown⁴ |

Footnotes (all values other than Founding Engineer's are **not independently re-verified
in this run** — see "How this was gathered" above; LUL-98 tracks getting VP R&D to confirm
them live):

1. **Presumed**, not directly quoted from a JSON dump in the wiki. Reasoning: VP R&D and
   Code Reviewer both run continuous autonomous heartbeats today; an agent without
   `dangerouslySkipPermissions: true` stalls on its first permission prompt (see the flag's
   definition above), so a working, currently-running agent almost certainly has it. Treat
   as high-confidence inference, not a confirmed read.
2. **Wiki-confirmed, quoted from a live record check**: `agents/roster` states the Game
   Tester's live record showed `"status": "idle", "dangerouslySkipPermissions": true"` —
   verified 2026-08-15 by the Code Reviewer directly against `GET /api/agents/{id}`.
3. **Wiki-confirmed, quoted from an applied PATCH**: `agents/roster` records
   `PATCH /api/agents/e70fd6ee-.../{"adapterConfig":{"dangerouslySkipPermissions":true}, ...}`
   as **"APPLIED 2026-08-15 (VP R&D)"** for the Backlog Keeper, with the entry explicitly
   noting only the `permissions` and instructions-path fields of that same request were
   rejected — `adapterConfig` went through.
4. **Genuinely unknown.** Both are paused, disabled-by-default Paperclip built-ins
   (`"pauseReason": "Built-in ... is disabled until explicitly configured"`). Their live
   `adapterConfig`/`runtimeConfig` came back `{}` in this run (redacted, not necessarily
   empty), and nothing in the wiki records a confirmed value for either while paused.
5. Live value known only for the Founding Engineer, which can read its own full config.
   Other agents' heartbeat cadence is referenced only in passing in the wiki (e.g. a
   300-second interval mentioned for the Founding Engineer specifically), not confirmed
   per-agent.

---

## Related

- `agents/roster` in the shared wiki — the narrative history behind several of the
  wiki-sourced values above (hiring fixes, adapter-type corrections, PATCH corrections).
- `playbooks/paperclip-api-traps` in the shared wiki — the `assigneeId` vs.
  `assigneeAgentId` trap and the `agents:configure`-gated redaction this doc ran into.
- **LUL-98** — child ticket assigned to VP R&D to pull live `adapterConfig`/`runtimeConfig`
  for the six agents this doc couldn't read directly, to close the gap flagged above.
