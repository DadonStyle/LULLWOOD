# Lullwood

**[Play Lullwood in your browser -> lullwood.vercel.app](https://lullwood.vercel.app)**

Lullwood is a browser-based first-person horror game. You cross a foggy night forest to
find a lost, glowing child and carry them home, while wolves, bears and lions hunt you by
sight and scent. The core loop is hiding and holding still while they sniff.

A lost child is somewhere in the dark. Next.js (App Router, TypeScript) shell around
the original single-file prototype, ported in as-is.

## Getting started

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the game is playable at `/`.

## Layout

- `app/` — Next.js App Router shell. `app/page.tsx` renders `components/GameLoader.tsx`,
  a `'use client'` wrapper that loads `components/GameCanvas.tsx` via
  `next/dynamic({ ssr: false })` (the engine touches `document`/`window`/`AudioContext`
  at module scope and cannot run on the server).
- `components/GameCanvas.tsx` — injects the game's original CSS + DOM overlay
  (verbatim from the prototype), then dynamically imports `engine/forest-engine.js`
  and calls its `init()`/`dispose()` around the component's mount/unmount. The
  engine imports `three@0.128` itself and is bundled with it (LUL-28); there is no
  `window.THREE` global.
- `engine/forest-engine.js` — the game's original `<script>` body, wrapped in an
  `init()`/`dispose()` lifecycle (LUL-17) so it survives React StrictMode's
  double-invoked effects; otherwise unmodified. Not linted or type-checked (see
  `eslint.config.mjs`) — it's a vendored, as-is port, not app source. Module
  decomposition into typed `lib/game/` units is a separate, later milestone (see
  the wiki: `game/port-plan`).
- `public/death.mp4` — the death sequence video, extracted from the prototype's
  inline base64 data URI.
- `NOAM_MDS/` — human-facing documentation: `NOAM_MDS/ARCHITECTURE.md` describes every
  directory and what its files do, grouped by responsibility.

The original single-file prototype (`game/forest.html`) was removed once the port
superseded it — the app never served it. It remains in git history at `5e46ed1`
(`git show 5e46ed1:game/forest.html`) if you ever need to diff against it.

## CI

`.github/workflows/ci.yml` runs on every PR in two jobs: `build, typecheck, lint`
(`eslint` — `next lint` was removed in Next.js 16 — then `next typegen`, `tsc
--noEmit`, `next build`) and `playwright smoke suite` (`e2e/`, headless Chromium,
report uploaded as an artifact).

## Deploys

`main` auto-deploys to [lullwood.vercel.app](https://lullwood.vercel.app) via the
Vercel GitHub App. Vercel builds independently of CI and does not run Playwright,
so CI status does not gate a production deploy — that requires branch protection on
`main` (tracked as LUL-33).

## Status

Code-correctness only has been verified (build/typecheck/lint clean, dev/prod server
serves `/` and both game assets with 200s). Gameplay, visual, and audio fidelity are
unverified — no tester has confirmed the port yet.
