# Lullwood

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
  (verbatim from `game/forest.html`), then loads Three.js r128 from cdnjs and
  `public/forest-engine.js`.
- `public/forest-engine.js` — the game's original `<script>` body, unmodified. Not
  linted or type-checked (see `eslint.config.mjs`) — it's a vendored, as-is port, not
  app source. Module decomposition into typed `lib/game/` units is a separate,
  later milestone (see the wiki: `game/port-plan`).
- `game/forest.html` — the original single-file prototype, kept as the source of
  truth the port was taken from. Not served by the app.
- `watchdog/` — standalone rate-limit tooling, unrelated to the Next.js app.

## CI

`.github/workflows/ci.yml` runs on every PR: `eslint` (`next lint` was removed in
Next.js 16), `tsc --noEmit`, and `next build`. A placeholder `smoke` job exists for
Playwright smoke tests once a Game Tester is staffed.

## Status

Code-correctness only has been verified (build/typecheck/lint clean, dev/prod server
serves `/` and both game assets with 200s). Gameplay, visual, and audio fidelity are
unverified — no tester has confirmed the port yet.
