# GAMES_REPLAY

Actual video of the agent playing Lullwood, per founder directive LUL-214. Recorded with
Playwright's native video capture (`video: 'on'`, `e2e/replay/` specs, `replay` project in
`playwright.config.ts`) driving the same production build that ships, headless.

This is a curated set, not a CI artifact dump: a win clip, a death clip, and any future
session that demonstrates a new feature or reproduces a bug. See `systems/headless-qa-rig`
on the shared wiki for how to reproduce a capture.

## Index

| Clip | Demonstrates | LUL |
| --- | --- | --- |
| [2026-08-17-lul-237-win-path.webm](2026-08-17-lul-237-win-path.webm) | Title gate → find and pick up the lost child, forest fully visible (trees, ground, minimap) → carry them home → "YOU WON" | LUL-237 |
| [2026-08-17-lul-237-death-path.webm](2026-08-17-lul-237-death-path.webm) | A hunting wolf closes the distance in the dark (eyes visible through fog) → catch (jaws cutscene) → "a wolf caught you in the dark" → "YOU LOSE" | LUL-237 |

**2026-08-17-lul-216-win-path.webm / -death-path.webm retired (LUL-237).** Both predated
LUL-211's canvas z-index fix (the WebGL canvas painted *behind* the SSR body background,
CSS stacking order step 2 < step 3) — the clips are a near-black screen with only HUD text
and the minimap visible, no 3D scene at all. That's what prompted this ticket: a founder
review of the checked-in clips read "the screen [is] mostly background with no objects in
it" and asked why the agent playing the game wasn't shown detecting trees, collisions, or
predators. The mechanic itself was fine — LUL-216's branch just recorded against a build
cut before LUL-211 landed on `main`, and the two PRs merged out of order. Re-recorded here
against current `main` (LUL-211 in), frame-verified before committing: the forest, ground,
and cover props are genuinely visible now. See wiki:game/lul237-replay-root-cause.

A dedicated collision clip (walking into a rock/log/bramble and stopping) is intentionally
*not* added here yet: PR #38 (`lul-211-regression-spec`, LUL-211/LUL-245, VP R&D, open as
of this writing) is already adding the canonical `qaProbePlayer`/`qaStageWalkIntoCover`
QA hooks and a per-kind collision regression spec for exactly this. Building a second,
differently-named set of collision hooks here would duplicate that work and leave two
competing APIs in the codebase once both land. Once #38 merges, a follow-up can add the
collision clip on top of its hooks instead of inventing new ones. See
wiki:game/lul237-replay-root-cause for the live-verified evidence in the meantime (Game
Tester ran a throwaway, uncommitted probe against tree/rock/log/bramble and confirmed
LUL-211's collision fix holds for all four, before deferring the committed hooks to #38).

## Repo-weight budget

Video is binary and permanent in git history. Keep clips short (seconds, not minutes),
downscaled (960x540, well under the 1280x720 canvas), and curated. Prune a superseded clip
in the same PR that adds its replacement — do not let old and new versions both sit here.
Current total: ~3.0 MB for 2 clips. If this folder starts pushing the repo past a few tens
of MB, stop and raise it before committing further.
