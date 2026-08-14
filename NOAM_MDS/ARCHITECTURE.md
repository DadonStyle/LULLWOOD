# Lullwood — project structure

Web search was **not** used to write this document. It was produced by reading
every source file in this repository at commit `0ca2b04` (2026-08-15). Sources:
the files themselves, plus the shared agent wiki pages `game/port-plan`,
`systems/lullwood-checkout`, `systems/vercel-cd`, and `systems/rate-limit-watchdog`.

---

## What this project is

Lullwood is a browser-based first-person horror game. You cross a foggy night
forest, find a lost glowing child, and carry them home while nine predators
(three wolves, three bears, three lions) hunt you by sight and scent. The core
loop is **hiding and holding still while they sniff**.

It began as a single-file HTML/Three.js prototype. It is now a Next.js 16 App
Router app (TypeScript, React 19) that wraps that prototype's engine. Live at
<https://lullwood.vercel.app>.

The shape of the codebase follows one rule: **the Next.js app is a thin shell,
and the game is one large vendored engine module.** Understanding the split
below is most of what you need.

---

## The three layers

### 1. `app/` — the Next.js shell (~29 lines total)

Deliberately almost empty. Three files:

- `layout.tsx` — the root HTML document and the page `<title>`/description.
- `page.tsx` — a five-line Server Component that renders the game loader.
- `globals.css` — a box-sizing/margin reset only. **All real styling lives with
  the game**, not here (see layer 2).

This layer exists to be boring. Landing page, SEO metadata, and the devlog (M3)
will grow here; nothing game-related should.

### 2. `components/` — the bridge between React and the engine

Two client components whose only job is getting a non-React, DOM-mutating,
`document`-at-import-time game engine safely into a React tree.

- **`GameLoader.tsx`** — a `'use client'` wrapper that exists solely to host a
  `next/dynamic(..., { ssr: false })` call, which is illegal in a Server
  Component. It also owns a QA-only remount hook (`window.__qaRemount`, opt-in
  via `?qaHooks=1`) that the lifecycle test uses to force a genuine
  unmount→remount of a live engine.
- **`GameCanvas.tsx`** — holds the game's entire original CSS (~100 lines) and
  DOM overlay markup (~40 lines) as template strings, injected via
  `dangerouslySetInnerHTML`, then dynamically imports the engine and calls
  `init()` on mount / `dispose()` on unmount.

**Why the strings:** they are verbatim from the original prototype, kept
unmodified so the port is a reviewable diff rather than a rewrite. The engine
finds these elements by `id` (`#gate`, `#minimap`, `#winScreen`, …). This is
known debt, and it is actively being paid down — see *Known debt* below.

### 3. `engine/forest-engine.js` — the game (1,280 lines)

The whole game, in one file, as one ES module. Not linted and not typechecked
(by design — it is a vendored as-is port, not app source). It imports `three`
directly and is bundled with it.

Its one structural feature is the **`init()` / `dispose()` lifecycle**:
everything that was module-scope state now lives inside `init()`'s closure,
every listener and timer is registered through internal `on()` / `later()`
helpers so `dispose()` can undo it, and `dispose()` walks the scene graph
releasing geometries, materials, textures, the renderer, and the AudioContext.
That is what lets React StrictMode double-invoke effects in dev without leaving
two engines running.

Read it in these bands (line numbers at `0ca2b04`):

| Lines | Responsibility |
|---|---|
| 32–54 | **Tuning knobs + seeded RNG.** `CONFIG` holds every gameplay constant. `mulberry32` makes a given seed a repeatable place. |
| 56–101 | **Scene, camera, renderer, night sky.** Lights, star field, moon, and the dim point light that follows the player. |
| 102–186 | **Forest generation.** One instanced "master tree" drawn thousands of times; a spatial hash grid (`CELL = 8`) provides collision. `generateMap()` places trees, avoiding the lake and spawn. |
| 187–246 | **Landmarks and the objective.** The glowing lake, its will-o'-wisps, drifting dust, and the lost child (`baby`) with its halo and wisps. |
| 247–303 | **Cinematic pieces.** First-person arms (shown only during pickup), the win sky-burst, and a small keyframe interpolator. |
| 304–524 | **Predators.** `PSPEC` defines wolf/bear/lion; speeds are derived from a "warning budget" — how long you get between being seen and being caught. Contains the sight/scent state machine, obstacle avoidance, and the spot/chase/catch transitions. |
| 525–573 | **Player and input.** Position, look, pointer lock, keyboard, touch. |
| 574–791 | **Procedural audio.** Everything is synthesised at runtime from an AudioContext — footsteps, predator calls, sniffs, the pickup melody, death stings. No audio files ship. |
| 792–906 | **Game states.** The entry gate, pause, the pickup cinematic, win, death (video + loss text), and restart. |
| 907–947 | **HUD controls and the minimap.** Pace/mist sliders, sound and regen buttons, and the 2D canvas minimap. |
| 948–1028 | **Post-processing.** Hand-written bloom, filmic tone mapping, vignette, and dither shaders, plus an adaptive-resolution loop that drops render scale when frame time slips. |
| 1031–1269 | **The frame loop (`tick`) and `dispose()`.** |

---

## Supporting directories

- **`e2e/`** — the Playwright smoke suite; the only thing allowed to assert that
  the game *works*. `smoke.spec.ts` drives load, the Three.js version pin, the
  win path, and the death path. `lifecycle.spec.ts` proves a remount leaks no
  rAF loop, WebGL context, or AudioContext. The engine exposes
  `window.ForestEngine.qaTeleportNearBaby()` / `qaLurePredator()` so tests can
  drive mechanics instead of racing the clock.
- **`public/`** — `death.mp4`, extracted from the prototype's inline base64 URI.
- **`.github/workflows/ci.yml`** — two jobs on every PR: *build/typecheck/lint*
  (`eslint` → `next typegen` → `tsc --noEmit` → `next build`) and the
  *playwright smoke suite*. `next typegen` must precede `tsc`, or generated
  route types are missing and typecheck fails spuriously.
- **Root config** — `next.config.ts` (StrictMode on; `allowedDevOrigins` so
  Next 16 will serve chunks to Playwright at `127.0.0.1`), `tsconfig.json`,
  `eslint.config.mjs`, `playwright.config.ts`.
- **`AGENTS.md` / `CLAUDE.md`** — conventions for the agents working this repo.

---

## Known debt (tracked, not forgotten)

1. **The engine mutates the DOM directly.** It reaches HUD elements by `id`
   from inside `GameCanvas`'s injected markup. Being fixed now: the engine will
   *emit state* and React will render it (ticket LUL-19 / LUL-34).
2. **The engine is one 1,280-line module of closure state.** Decomposition into
   typed `lib/game/` units is a later milestone; the port deliberately did not
   attempt it, because a 1,200-line reformat is not a reviewable diff.
3. **CI does not gate production.** Vercel builds from `main` independently and
   does not run Playwright, so red CI can still deploy. Fixing this needs
   branch protection on `main`, which only the repository owner can set
   (ticket LUL-33).

## What was removed, and why

The cleanup at this commit deleted two things that were dead weight:

- **`watchdog/` (7 TypeScript files, ~700 lines)** — a superseded
  implementation of the rate-limit watchdog. The watchdog that actually runs is
  a *Python* program at `~/.paperclip/shared/watchdog/`, invoked every ten
  minutes by cron. The TypeScript copy was excluded from `tsconfig.json`, never
  built, never run by CI, and its test file had no runner. Nothing on the
  machine referenced it.
- **`scripts/bootstrap-remote.sh`, `scripts/push-deploy-key.sh`** — one-time
  setup scripts for creating the GitHub repo and installing a deploy key. Both
  jobs are done and cannot recur; the procedure is recorded in the agent wiki
  (`systems/github-access`, `systems/lullwood-checkout`).

Both remain in git history if ever needed.
