# Lullwood

**[Play Lullwood in your browser → www.lullwoodgame.com](https://www.lullwoodgame.com)**

Lullwood is a browser-based first-person horror game. You cross a foggy night forest to
find a lost, glowing child and carry them home, while wolves, bears and lions hunt you by
sight and scent. The core loop is hiding and holding still while they sniff.

It is also an experiment: **the game is built by an all-AI studio.** A fleet of Claude
Code agents — engineers, a code reviewer, a tester, a backlog keeper, a feature scout and
a game economist — plan, write, review and ship it. A human founder sets direction and
approves; no human writes game code.

New here? Start with **[docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md)** — it explains the
game, the codebase and the studio in one pass.

## Getting started

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the game is playable at `/`.

```bash
npm run build     # production build (Next 16, Turbopack)
npm test          # node --test, unit tests only
npx playwright test   # e2e suite (desktop + mobile projects)
```

## Layout

- `app/` — Next.js App Router shell. `app/page.tsx` renders `components/GameLoader.tsx`,
  a `'use client'` wrapper that loads `components/GameCanvas.tsx` via
  `next/dynamic({ ssr: false })` (the engine touches `document`/`window`/`AudioContext`
  at module scope and cannot run on the server). It also renders the server-side content
  shell — the prose a crawler indexes, since a `<canvas>` is one opaque node to Google.
- `app/api/telemetry/` — Route Handler that receives gameplay events and writes them to
  Vercel Blob. See `HOW_IT_WORKS.md` § Analytics.
- `components/GameCanvas.tsx` — injects the game's original CSS + DOM overlay, then
  dynamically imports `engine/forest-engine.js` and calls its `init()`/`dispose()` around
  mount/unmount. The engine imports `three` itself and is bundled with it (LUL-28); there
  is no `window.THREE` global.
- `engine/forest-engine.js` — the game's original `<script>` body, wrapped in an
  `init()`/`dispose()` lifecycle (LUL-17) so it survives React StrictMode's double-invoked
  effects. Not linted or type-checked (see `eslint.config.mjs`) — a vendored, as-is port.
  Logic is being extracted into typed `lib/game/` units incrementally.
- `lib/game/` — pure, tested game logic extracted from the engine (cover, jump, charge,
  lake, bog, predator, event scheduler…). No DOM, no Three.js, no wall-clock reads.
- `lib/site.ts` — the single source of truth for the site URL, title and description.
  Everything else — canonical tag, Open Graph, JSON-LD, `robots.txt`, `sitemap.xml` —
  derives from it, so a domain change is one redeploy and no edits.
- `e2e/` — Playwright. `e2e/mobile/` runs under a real mobile-emulated context.
- `docs/ELEMENTS.md` — every gameplay element and where it lives in the engine.
- `NOAM_MDS/` — founder-facing notes and one-off reviews.

The original single-file prototype (`game/forest.html`) was removed once the port
superseded it. It remains in git history at `5e46ed1`.

## CI

`.github/workflows/ci.yml` runs on every branch push in two jobs:

- **`unit tests`** — git-remote credential guard, `docs/ELEMENTS.md` citation guard,
  duplicate-logic guard, then `node --test`
- **`build, typecheck, lint`** — `eslint`, `next typegen`, `tsc --noEmit`, `next build`

Two more required checks come from other workflows: **`workflow guard check`** and
**`base branch guard`**. All four must be green to merge into `main`.

CI runs on the **branch push**, not the PR — watch the checks on the head commit.

## How changes ship

Feature branches are named `lul-<ticket>-<slug>` and target **`release/next`**, never
`main`. `base-branch-guard.yml` enforces that: the only path to `main` is a version cut
(`release/next` → `main`). Full detail in [AGENTS.md](AGENTS.md) and
[docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

## Deploys

`main` auto-deploys to [www.lullwoodgame.com](https://www.lullwoodgame.com) via the Vercel
GitHub App. `lullwoodgame.com` and the legacy `lullwood.vercel.app` both resolve to it.

Vercel builds independently of CI and does not run Playwright, so a green PR is not a
working deploy — the Game Tester verifies gameplay against the live production URL.

Environment variables are baked in at **build time**. Adding or changing one has no effect
until a redeploy.

## Search engines

Google Search Console is set up and verified for `www.lullwoodgame.com`; the verification
token is served from `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`. `sitemap.xml` and `robots.txt`
are generated from `lib/site.ts`.

`public/<key>.txt` is the site's [IndexNow](https://www.indexnow.org/) key file — its
content is the key itself. IndexNow keys are public by design. `scripts/indexnow.mjs`
submits the URLs in `app/sitemap.ts` to Bing, DuckDuckGo, Yandex and Seznam in one call.
Run it manually after a deploy that changes sitemap URLs:

```bash
node scripts/indexnow.mjs
```

It is **not** wired into CI — pinging on every push is treated as abuse. Google does not
consume IndexNow; it discovers the site via Search Console and the sitemap.

## Status

The game is live, playable, and verified end to end: unit tests, a Playwright suite
covering the win path, the death path, HUD round-trips and mobile input, and Game Tester
play verdicts against production. Desktop and mobile ship together — every feature is
required to be reachable on a touch device before it merges.
