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
| [2026-08-17-lul-216-win-path.webm](2026-08-17-lul-216-win-path.webm) | Title gate → find and pick up the lost child → carry them home → "YOU WON" | LUL-216 |
| [2026-08-17-lul-216-death-path.webm](2026-08-17-lul-216-death-path.webm) | A hunting wolf closes the distance in the dark (eyes visible through fog) → catch → death cutscene → "YOU LOSE" | LUL-216 |

## Repo-weight budget

Video is binary and permanent in git history. Keep clips short (seconds, not minutes),
downscaled (960x540, well under the 1280x720 canvas), and curated. Prune a superseded clip
in the same PR that adds its replacement — do not let old and new versions both sit here.
Current total: ~1.3 MB for 2 clips. If this folder starts pushing the repo past a few tens
of MB, stop and raise it before committing further.
