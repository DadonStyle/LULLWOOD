# How Lullwood works

One pass over the whole thing: the game, the code, and the studio that builds it.
Written 2026-08-29. If something here contradicts the code, the code is right — fix
this file.

---

## 1. The game

You start at a treeline in a foggy night forest. A child is somewhere ahead, glowing
faintly — that light is the only thing you can navigate by. Reach them, lift them, and
carry them home.

Wolves, bears and lions hunt you. **You have no weapon.** They track you two ways:

- **Sight** — a real line-of-sight raycast (`canSee()` / `hasLOS()`), so cover genuinely
  blocks vision rather than approximating it
- **Scent** — a decaying trail you leave as you move. Sprinting lays a stronger one.

The only tool is **stillness**: duck into a bramble or hollow log, hold still, and let
them lose you. Running is usually the wrong answer.

Reaching the child is half the game — you still have to carry them back.

### Verbs

| Action | Desktop | Touch |
|---|---|---|
| Move / look | WASD / mouse | twin sticks |
| Run | Shift (hold or toggle) | left-stick magnitude, or a toggle button |
| Jump — also the predator-charge dodge | Space | button, and the charge prompt itself |
| Hide | H | button |
| Mist veil — dims your light, cuts detection range | F (hold) | button (hold) |
| Lift the child | E | button |
| Pause | Escape | button |

**Every feature ships desktop and mobile together.** That is a standing founder
directive, not a nice-to-have: a survival verb reachable on a keyboard but not on a
phone is a P1 bug.

---

## 2. The stack

**Next.js 16 (App Router, TypeScript, Turbopack) · React 19 · Three.js · Vercel**

The load path:

```
app/page.tsx  (server)
  ├── <GameLoader/>          'use client'
  │     └── next/dynamic({ ssr: false })
  │           └── components/GameCanvas.tsx
  │                 └── engine/forest-engine.js   init() / dispose()
  └── <main class="about">   server-rendered prose — the indexable surface
```

**Why `ssr: false` is correct and not a bug.** The engine touches `window`, `document`
and `AudioContext` at module scope, and needs a GPU context. It cannot run on a server.
More importantly a rendered `<canvas>` is **one opaque node** to a crawler — it
contributes zero indexable text either way. Google indexes the prose *around* the canvas,
which is what `app/page.tsx`'s content shell exists for.

The raw HTML contains `BAILOUT_TO_CLIENT_SIDE_RENDERING`. That is expected. Judge SSR by
the body text, not by grepping for that marker.

### Where logic lives

- `engine/forest-engine.js` — the original prototype, wrapped in `init()`/`dispose()`.
  Vendored: not linted, not type-checked.
- `lib/game/*.ts` — pure logic extracted from the engine, with colocated `*.test.ts`.
  No DOM, no Three.js, no timers, no wall-clock, no unseeded `Math.random()`.

Extraction is incremental. A **duplicate-logic guard** in CI fails the build if a symbol
exists in both places — nine tests once passed against a `lib/` copy while the engine
shipped its own divergent version, and that guard exists so it cannot recur.

---

## 3. Testing

**Unit — `npm test`** (`node --test`, colocated `*.test.ts`). Pure functions only.
Changing a behaviour means changing its test in the same PR; a behaviour change with an
untouched test file means the test was never testing that behaviour.

**End-to-end — `npx playwright test`.** Three projects:

| Project | Covers |
|---|---|
| `chromium` | desktop, 1280×720 |
| `mobile` | Pixel 5 emulation — touch, coarse pointer, narrow viewport |
| `replay` | records `GAMES_REPLAY/` clips, run by hand only |

Determinism matters more than coverage here. `e2e/helpers.ts` pins every spec to
`QA_PINNED_SEED = 20260718` so terrain-dependent assertions are stable, and `boot()`
waits on the engine's own global rather than a fixed sleep.

**Two traps worth knowing:**

- `playwright.config.ts` sets `reuseExistingServer: true`. A stale `next start` on the
  port means the suite silently tests an **old build**. If results look impossible,
  check for an orphaned server before believing them.
- A touch control that renders and is tappable can still be wired to nothing. Assert the
  engine-visible effect, not the DOM node, and make every new assertion fail once on
  purpose.

---

## 4. Shipping a change

```
lul-<ticket>-<slug>  ──►  release/next  ──►  main  ──►  production
        feature PR          version cut       Vercel
```

`base-branch-guard.yml` enforces the shape: a PR with `base=main` is rejected unless
`head=release/next` or it carries an explicit `emergency-hotfix` label. The only path to
`main` is a version cut.

- Branch names must start with `lul-` or `auto-pr.yml` opens nothing
- CI runs on the **branch push**, not the PR
- **Force-push is banned everywhere** — including your own branch, and including the
  disguised forms (interactive rebase on a pushed branch, `--amend` on a pushed commit,
  reset-and-repush). Branches catch up by **backmerge**, never rebase.
- Never switch branches in `/home/noam/lullwood` — it is a shared tree with live
  uncommitted work. Use `git worktree`.

### Required checks

`unit tests` · `build, typecheck, lint` · `workflow guard check` · `base branch guard`

### Review tiers (development-first, 2026-08-29)

Tier is decided by **what the diff touches**; when a diff spans tiers, the highest wins.

| Tier | Paths | Gate |
|---|---|---|
| **A** | docs, `e2e/**`, tests, comments, assets, copy | ship on green, no review |
| **B** | `app/**`, `lib/**`, `components/**`, tuning constants | merge on green, review after |
| **C** | engine simulation, persistence, **secrets/auth/CI/merge rules**, release cuts | blocking review + play verdict |

The directive exists because the two building agents ran 803 sessions in a week while
the two gating agents ran 853 — more than half the studio's effort was spent checking
work rather than making it.

**Known gap:** `release/next` carries `required_approving_review_count: 1`, so Tier B
cannot literally "merge on green" — GitHub blocks it at `REVIEW_REQUIRED`.
`bot-approve.yml` is the intended fix: it records an approval as `github-actions[bot]`
(a genuinely distinct identity from the studio PAT) only when every required check is
already green, no approval exists, and it did not author the PR. Wiring it to fire
automatically for Tier-B-only diffs is open work.

---

## 5. The studio

Eleven Claude Code agents, orchestrated by **Paperclip** on a always-on server.

```
VP R&D / CEO
  └── CTO
       ├── Founding Engineer     infra, CI, release, Vercel
       ├── Game Engineer         gameplay + full mobile ownership
       ├── Code Reviewer         the PR gate
       └── Game Tester           plays the build, owns gameplay verdicts

outside the line
  Backlog Keeper    the only agent whose output is tickets
  Feature Scout     researches MECHANICS, proposes to the CEO
  Game Economist    researches the ECONOMY, proposes to the CEO
  Summarizer · Reflection Coach   Paperclip built-ins
```

Model tiering: Opus 5 for the CEO, CTO and the two research agents; Sonnet 5 for
engineering and review; Haiku 4.5 for mechanical summarisation.

### The Scout / Economist split

Two outward-looking agents, one firm boundary:

- **Feature Scout owns mechanics** — what exists and what the player *does*: animals,
  objects, places, objectives, minigames, easter eggs, core-loop changes, story, lore,
  subtitles, hints, menus.
- **Game Economist owns the economy** — what the player *earns, spends, risks and loses*:
  currency, per-run rewards, what a failed run pays, death cost, powerup prices, session
  limits, balance curves.

*You design the wolf. They decide what killing it is worth.*

Neither opens tickets. Both propose to the CEO, which decides and files. They coordinate
through the wiki: query the counterpart's namespace before proposing, cross-link every
page, and never invent the other's half — write the requirement and name them.

### The shared brain

`~/.paperclip/shared/wiki` is the fleet's only cross-agent memory, and it is mandatory.
Agent-private memory is invisible to everyone else, so anything another agent would
benefit from goes in the wiki.

Writes go through the `wiki` CLI only — it locks per page, writes atomically, stamps
provenance and appends to a log. Direct `Write`/`Edit`/shell redirection bypasses the
lock and silently clobbers concurrent edits. Query before researching; file what you
learned before the run ends; cross-link or lint flags the page an orphan. Decisions go
in `decisions/` as ADRs with the alternatives that were rejected, so nobody relitigates.

### Automation outside the agent loop

Eight cron jobs: rate-limit watchdog, watchdog router, board integrity, wiki enrolment,
GitHub PAT expiry, QA regression, and a daily status snapshot.

---

## 6. Analytics

Seven events — `page_view`, `cta_start_clicked`, `game_start`, `win`, `loss`,
`session_length`, `feature_engagement` — emitted from `lib/analytics.ts`, sent by
`navigator.sendBeacon` to `app/api/telemetry/route.ts`, validated against the schema, and
written one JSON object per event to Vercel Blob at `events/{yyyy}/{mm}/{dd}/{uuid}.json`.

The only identifier is an `anon_id` (UUID v4 in `localStorage`). No email, no IP, no
fingerprinting. It exists so return rate is computable.

The handler degrades to `204` when `BLOB_READ_WRITE_TOKEN` is absent, caps bodies at
2 KB, and rate-limits per `anon_id`. It uses web-standard `Request`/`Response` so it is
testable under `node --test` without mocking Next internals.

This is what lets the Game Economist model real earn rates instead of guessing.

---

## 7. SEO

A `<canvas>` is invisible to crawlers, so the server-rendered prose in `app/page.tsx` is
the entire indexable surface — currently ~2,600 characters.

`lib/site.ts` is the single source of truth. Title, description, canonical, Open Graph,
JSON-LD, `robots.txt` and `sitemap.xml` all derive from it, which is why moving to
`www.lullwoodgame.com` took one redeploy and zero edits.

Two things that are easy to get wrong:

- **`max-image-preview: large` is opt-in.** Without the `googleBot` robots directives,
  Google serves a thumbnail and a truncated snippet.
- **The title is not the brand alone.** "Lullwood" is an invented word with no search
  volume, and `lullwood.com` is an unrelated live product. The title carries the terms
  people actually type; the AI-studio story is a *link magnet*, not a keyword, and lives
  in the devlog and off-site listings.

---

## 8. Things that have already cost this studio time

- **Squash-merging the release train.** A squash discards the second parent, so `main`
  and `release/next` never share an ancestor and every version cut conflicts. Two
  deliberate merge commits were auto-squashed before the cause was found. Cut PRs must
  merge with a real merge commit.
- **`docs/ELEMENTS.md` line citations.** 118 `L<n>` references into the engine; measured
  82/82 wrong, and 65 wrong the day they were written. `check-elements-citations.mjs`
  now gates them against a baseline that may shrink but never grow.
- **Stale Playwright servers** silently testing an old build (§3).
- **Credentials in git remote URLs.** Leaked the same PAT three times; a CI guard now
  checks for it before `npm ci`.
- **Env vars are build-time.** Setting one changes nothing until a redeploy.
