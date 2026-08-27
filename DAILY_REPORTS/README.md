# DAILY_REPORTS

One markdown file per calendar day, `YYYY-MM-DD.md`, summarizing what landed on
`release/next` that day. Founder request, **LUL-531**. Full decided spec,
including the measured facts behind every choice below: wiki
`systems/daily-reports`.

## Day boundary

**00:00–23:59 Asia/Jerusalem** — the founder's timezone, and already the author
timezone on every commit in this repo. Every file states this in its header so
no reader has to guess or assume UTC.

## Source of truth

`git log --first-parent origin/release/next`, bucketed by each commit's
**author** date converted to Asia/Jerusalem. `--first-parent` is mandatory:
this repo mixes squash merges with real merge commits, and without it every
PR's internal commits would double-count.

**Why `release/next`, not `main` (LUL-801):** under the release train (wiki
`systems/release-train`), `main` only receives periodic version-cut merges —
a day's real delivery integrates onto `release/next` continuously and shows
up on `main` only when the next cut happens, attributed to the cut's date
rather than the work's. Walking `release/next` is the same "reproducible, no
secrets, honest definition of shipped" reasoning the original choice of
`main` used, just pointed at the branch that's actually the studio's day-to-
day integration branch now. See wiki `systems/daily-reports` for the full
option comparison (union of both branches; expanding release-cut commits back
into their constituent PRs) and why they lost to this one on complexity.

Four commit shapes get distinct handling:

1. **Squash merge** (the common case, e.g. `LUL-485: add timeout-minutes to CI
   jobs (#80)`) — the subject is the entry, `(#80)` is the PR link.
2. **Real merge of a PR** (two parents, e.g. `Merge pull request #2 from
   DadonStyle/lul-22-positional-hiding`) — the subject is useless, so the
   merge commit's body (first paragraph) is used instead, falling back to the
   second parent's subject if the body is empty.
3. **Backmerge with no shipped content** (`Merge branch 'main' into
   lul-34-hud-react`) — excluded entirely; it ships nothing and would inflate
   every day's count.
4. **Empty-diff merge** — any first-parent commit whose tree is identical to
   its first parent's, excluded regardless of subject wording. On
   `release/next` this is what a release-train sync-back from `main` looks
   like (`Sync release/next after v2026.08.22-1 (#133)`, `Merge pull request
   #151 from DadonStyle/main`, `LUL-572: backmerge main into release/next` —
   three different title shapes, all measured empty-diff) — `main` never has
   content `release/next` didn't already have, so these carry no new work.
   Catching this by diff emptiness rather than pattern-matching current
   title wording is also what stops a release/sync merge from ever rendering
   as a game feature or any other section.

## Sections

The section list — order, titles, and classification rules — lives in the
`SECTIONS` config array at the top of `scripts/daily-report.mjs`. A day's file
omits any section with zero entries for that day; adding a new section kind is
one array entry, not a rewrite.

Classification stops at the first matching rule, highest confidence first:

1. An explicit `Report-Section: <title>` trailer in the commit message —
   the escape hatch for anything the heuristics below get wrong.
2. A conventional-commit prefix (`fix:`, `docs:`, `perf:`/`refactor:`,
   `feat(security)`, `chore(ci)`, …).
3. Subject keywords (`fix|bug|regression|revert|broken` → Bug fixes;
   `credential|secret|token|security` → Security). These are intentionally
   simple and can misfire (e.g. a commit about LLM token *cost* matching the
   security keyword `token`) — use the trailer to correct a specific
   misclassification rather than tuning the keyword list for one case.
4. Changed file paths (`engine/`, `lib/game/`, `components/`, `app/` (non-SEO)
   → Game features; `e2e/`/`*.spec.ts` → Testing & QA; `.github/`/`scripts/` →
   Infra; etc).
5. Unmatched → **Other**.

## Regenerating

```
node scripts/daily-report.mjs --backfill                    # 2026-08-13 -> yesterday
node scripts/daily-report.mjs --since=2026-08-18 --until=2026-08-19
node scripts/daily-report.mjs --day=2026-08-15               # a single day
```

**Idempotent by construction**: no generation timestamp, no "as of" line,
deterministic (chronological, git-driven) entry ordering. Regenerating any
past day produces a byte-identical file — verify with `git diff` after a
re-run; a non-empty diff on an unchanged day range means something in the
generator or the underlying git history changed, not that this is expected
behavior.

## The one hand-written exception: 2026-08-13

The company's first day of activity (wiki `decisions/0001-shared-wiki`)
predates the LULLWOOD repository, which was created the next day,
**2026-08-14**. There is no git data for 2026-08-13, so that file is a short,
explicitly labelled reconstructed note rather than a synthesized commit list.
It is not regenerated by `--backfill`'s normal git-log path; the generator
hardcodes its content (`FIRST_COMPANY_DAY` in `scripts/daily-report.mjs`).

## Forward automation

A nightly workflow that regenerates the last two days and lands the diff is a
separate, still-blocked ticket (child of LUL-533). It is not implemented by
this generator alone — see the "Forward automation" section of the wiki spec
for the `GITHUB_TOKEN`-doesn't-trigger-`auto-pr.yml` trap it has to route
around before it's built.
