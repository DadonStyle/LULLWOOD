# Lullwood — project structure

Produced by reading every source file in this repository. No web search was used.
Current as of the **LUL-35 pass-2 cleanup** (2026-08-15); the previous revision
described commit `0ca2b04` and predates the HUD lift (LUL-34) and the return
trip (LUL-38).

Supporting context lives in the shared agent wiki: `game/port-plan`,
`systems/lullwood-checkout`, `systems/vercel-cd`, `systems/headless-qa-rig`.

---

## What this project is

Lullwood is a browser-based first-person horror game. You cross a foggy night
forest, find a lost glowing child, lift them, and **carry them home** while nine
predators (three wolves, three bears, three lions) hunt you by sight and scent.
The core loop is **hiding and holding still while they sniff**.

It began as a single-file HTML/Three.js prototype. It is now a Next.js 16 App
Router app (TypeScript, React 19) wrapping that prototype's engine. Live at
<https://lullwood.vercel.app>.

The shape of the codebase follows one rule: **the Next.js app is a thin shell,
and the game is one large vendored engine module.** Understanding the split
below, and the one-way state channel between the two, is most of what you need.

---

## The three layers

### 1. `app/` — the Next.js shell (~29 lines total)

Deliberately almost empty. Three files: `layout.tsx` (root document, title and
description), `page.tsx` (a five-line Server Component rendering the game
loader), and `globals.css` (a box-sizing/margin reset only).

**All real styling lives with the game**, not here. This layer exists to be
boring. The landing page, SEO metadata, and the devlog (M3) grow here; nothing
game-related should.

### 2. `components/` — the bridge between React and the engine

Three client components whose only job is getting a non-React, DOM-mutating,
`document`-at-import-time game engine safely into a React tree.

- **`GameLoader.tsx`** — a `'use client'` wrapper existing solely to host a
  `next/dynamic(..., { ssr: false })` call, which is illegal in a Server
  Component. It also owns a QA-only remount hook (`window.__qaRemount`, opt-in
  via `?qaHooks=1`) that the lifecycle test uses to force a genuine
  unmount→remount of a live engine.
- **`GameCanvas.tsx`** — owns the game's original CSS (~100 lines) as a template
  string plus the small residue of engine-owned overlay markup, dynamically
  imports the engine, calls `init()` on mount and the imported `dispose()` on
  unmount, and holds the HUD state that the engine pushes at it.
- **`Hud.tsx`** — the HUD as real JSX: the settings panel, entry gate, objective
  banner, hide status, win screen, and death text. It renders engine state and
  calls back through the action functions `init()` returns. It never reaches
  into engine internals.

### 3. `engine/forest-engine.js` — the game (1,359 lines)

The whole game, one file, one ES module. Not linted and not typechecked **by
design** — it is a vendored as-is port, not app source. It imports `three`
directly and is bundled with it. `engine/forest-engine.d.ts` gives the app a
typed view of its public surface.

Two structural features matter more than any single line:

**The `init()` / `dispose()` lifecycle.** Everything that was module-scope state
lives inside `init()`'s closure; every listener and timer is registered through
internal `on()` / `later()` helpers so `dispose()` can undo it; `dispose()` walks
the scene graph releasing geometries, materials, textures, the renderer, and the
AudioContext. That is what lets React StrictMode double-invoke effects in dev
without leaving two engines running.

**The one-way state channel.** The engine owns a `hudState` object and pushes
patches out through `emitState()`; React renders them and talks back only via
the action functions `init()` returns (`enter`, `restart`, `setPace`, `setFog`,
`toggleSound`, `regenMap`). Nothing reads engine state back in. `hudState`
carries **data, never presentation** — the engine emits fog as the raw density
it feeds Three, and `Hud.tsx` formats it.

Read the engine in these bands:

| Lines | Responsibility |
|---|---|
| 33–58 | **Tuning knobs + seeded RNG.** `CONFIG` holds every gameplay constant and is the single source of truth for the HUD's opening slider values. `mulberry32` makes a given seed a repeatable place. |
| 59–104 | **Scene, camera, renderer, night sky.** Lights, star field, moon, and the dim point light following the player. |
| 105–190 | **Forest generation.** One instanced "master tree" drawn thousands of times; a spatial hash grid (`CELL = 8`) provides collision. `generateMap()` places trees, avoiding the lake and spawn. |
| 191–261 | **Landmarks and the objective.** The glowing lake and its will-o'-wisps, the **home landmark** the child must reach (LUL-38), drifting dust, and the child with its halo and wisps. |
| 262–318 | **Cinematic pieces.** First-person arms (shown only during pickup), the win sky-burst, and a small keyframe interpolator. |
| 319–539 | **Predators.** `PSPEC` defines wolf/bear/lion; speeds derive from a "warning budget" — how long you get between being seen and being caught. Holds the sight/scent state machine, obstacle avoidance, and spot/chase/catch transitions. |
| 540–588 | **Player and input.** Position, look, pointer lock, keyboard, touch. |
| 589–806 | **Procedural audio.** Everything synthesised at runtime from an AudioContext — footsteps, predator calls, sniffs, the pickup melody, death stings. No audio files ship. |
| 807–837 | **HUD state.** `hudState`, `pushState()`, `emitState()` — the channel described above. |
| 838–959 | **Game states.** Entry gate, pause, the pickup cinematic, the carry-home win condition, death (video + loss text), restart, and the `?qaHooks=1` test hooks. |
| 960–999 | **Controls and the minimap.** The action functions React calls, and the 2D canvas minimap. |
| 1000–1080 | **Post-processing.** Hand-written bloom, filmic tone mapping, vignette, and dither shaders, plus an adaptive-resolution loop that drops render scale when frame time slips. |
| 1081–1086 | **Boot.** Build the first map, then run. |
| 1087–1343 | **The frame loop (`tick`).** Movement, predator updates, distance/objective computation, and the per-frame `pushState()`. |
| 1344–1359 | **`dispose()`** and the `window.ForestEngine` install. |

> `window.ForestEngine` is a **QA and debug surface only**. The app reaches the
> engine through the module import — one path in (`init`), one path out
> (`dispose`). Do not add a second.

---

## Supporting directories

- **`e2e/`** — the Playwright suite; the only thing allowed to assert the game
  *works*. `helpers.ts` holds the shared boot/enter/console-error steps so no
  spec re-invents how the game starts. `smoke.spec.ts` covers load, the Three.js
  version pin, HUD mount/unmount, the panel controls round-tripping into the
  engine, and the win and death paths. `hide.spec.ts` covers the `H` hide toggle
  and breaking cover by moving. `lifecycle.spec.ts` proves a remount leaks no
  rAF loop, WebGL context, or AudioContext. The whole suite runs against a
  **production build** — the artifact that actually ships. The engine's
  `?qaHooks=1` hooks (`qaTeleportNearBaby`, `qaTeleportHome`, `qaLurePredator`)
  let tests drive mechanics instead of racing the clock.
- **`public/`** — `death.mp4`, extracted from the prototype's inline base64 URI.
- **`.github/workflows/ci.yml`** — two jobs on every PR: *build/typecheck/lint*
  (`eslint` → `next typegen` → `tsc --noEmit` → `next build`) and the Playwright
  suite. `next typegen` must precede `tsc`, or generated route types are missing
  and typecheck fails spuriously.
- **Root config** — `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`,
  `playwright.config.ts`.
- **`AGENTS.md` / `CLAUDE.md`** — conventions for the agents working this repo.

---

## Known debt (tracked, not forgotten)

1. **The engine still owns some DOM directly.** LUL-34 lifted the HUD into
   React, but `#vignette`, `#spotFlash`, `#flash`, `#minimap`, `#hint`,
   `#pausePrompt`, and `#deathVideo` are still engine-mutated nodes reached by
   `id`. These are effects and canvases rather than state-driven UI, so they are
   a much smaller problem than the HUD was.
2. **The engine is one 1,359-line module of closure state.** Decomposition into
   typed `lib/game/` units is a later milestone; the port deliberately did not
   attempt it, because a 1,200-line reformat is not a reviewable diff.
3. **CI does not gate production.** Vercel builds from `main` independently and
   does not run Playwright, so red CI can still deploy. Fixing this needs branch
   protection on `main`, which only the repository owner can set (LUL-33).

---

## What the cleanup removed, and why

### Pass 1 (`593696e`) — ~950 lines nothing ran

- **`watchdog/` (7 TypeScript files, ~700 lines)** — a superseded implementation
  of the rate-limit watchdog. The watchdog that actually runs is a *Python*
  program at `~/.paperclip/shared/watchdog/`, invoked every ten minutes by cron.
  The TypeScript copy was excluded from `tsconfig.json`, never built, never run
  by CI, and its test file had no runner. Nothing referenced it. **Do not
  re-add a watchdog to the game repo** — that confusion is what this removed.
- **`scripts/bootstrap-remote.sh`, `scripts/push-deploy-key.sh`** — one-time
  setup for creating the GitHub repo and installing a deploy key. Both jobs are
  done and cannot recur; the procedure is recorded in the wiki
  (`systems/github-access`).
- **`game/`** — the original single-file prototype, superseded by the port.
  `README.md` records the git ref if you need to diff against it.

### Pass 2 — duplication that LUL-34 and LUL-38 introduced after pass 1

- **Four copies of the test boot sequence**, already drifting in their waits and
  hook handling, collapsed into `e2e/helpers.ts`. Booting now waits on the
  engine's own readiness signal rather than a flat 4-second sleep.
- **A second `next dev` Playwright server** and its `chromium-dev` project,
  justified by a claim that `lifecycle.spec.ts` needs StrictMode's dev-only
  double-invoke. It does not, and never did — it forces the remount itself,
  because the StrictMode double-invoke settles before the engine import
  resolves. One server, one project, one production build.
- **Three copies of the starting slider values** (engine `CONFIG`, React's
  initial state, and the inputs' `defaultValue`). They had drifted: the panel
  advertised mist `.045` while the scene rendered `0.04`. `CONFIG` is now the
  only source; the sliders are controlled inputs.
- **`statusHiding`**, a HUD state field only ever assigned the value of
  `statusVisible` — two names for one fact.
- **A hand-redeclared `window.ForestEngine` type** in `GameCanvas.tsx`, moved
  next to the module that installs the global and reusing the exported
  `init`/`dispose` types instead of restating their signatures.
- **A second teardown path** (`window.ForestEngine.dispose()`) and the dead
  `#status.danger` CSS rule, which no code path has ever applied.

Everything removed remains in git history.
