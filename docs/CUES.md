# Cue-triple audit

Standing registry for `decisions/0015-cue-triple` (wiki). One row per interactive map
element — anything the player can walk up to or trigger. Each cell cites `file:line` for a
real, grep-verified call site, or `MISSING`. Passive/ambient world texture (fog, general
ambience, decorative-only props) is out of scope per that decision's Scope note.

Owned by the CTO; refresh whenever a `MISSING` is closed or a new interactive element ships.
First pass: LUL-2332 (child of LUL-2321 Part 2), 2026-09-11, against `release/next` @
`c352ab9`. Re-derive every citation on your branch if it has moved.

| Element | Visual cue | Audio cue | Explanation | Notes |
|---|---|---|---|---|
| Child pickup | `engine/forest-engine.js:4495` `armsGroup.visible = true` inside `pickup()` (`:4486-4497`); halo/`fireBoom()` burst ramp `:5195-5211` during the pick-up-to-win cinematic | `playWinMusic()` `:2961`, called from `pickup()` `:4497` | `:5420` `objectiveText`: `'Press  E  to lift the child'` | No `captionsOn`-gated one-shot fires on the pickup moment itself — explanation is the persistent objective prompt, not a caption toast. Reduced motion: camera-follow slerp is skipped (`:5206-5211`) but the halo/boom visual itself is not `reducedMotion`-gated. |
| Home/rescue | `fireBoom(CONFIG.home.x, 2.2, CONFIG.home.z)` `:4665`; `babyGroup.visible = false` `:4662`, both inside `arriveHome()` (`:4659-...`) | `playWinMusic()` `:4665`; `boom()` `:3148`, `soundOn`-gated | `components/Hud.tsx:904-909` win screen: "YOU WON — the child is safe — you lifted her into the light" | Explanation is static win-screen body copy shown whenever `winVisible`, not a `captionsOn`-gated one-shot — `arriveHome()` pushes no `caption:` field. |
| Stone Marker mist-charm | Beacon glow `addBeaconGlow(g, 'stoneMarker', 5.9)` `:1446`; purchase-moment one-shot boost on top of it, `stoneMarkerPulseT`, set in `buyVeilCharm()` `:5213`, decayed in `tick()`, applied in the `landmarkBeaconGlows` loop `:6331-6340` (LUL-2331) | `embersPurchaseCue()` `:5345` (reused, called from `buyVeilCharm()` `:5212`); `veilCharmReleaseCue()` `:5361` (new, called from the `reserveFired` block `:5862-5864`) — both `soundOn`-gated (LUL-2331) | Offer prompt `:6238` `'Press  E  for a mist-charm  ·  15 embers  ·  saves your veil from locking, once'` (reworded LUL-2331 — now names the effect, not just the price); purchase caption `:5211` `'a charm against the mist'`; activation caption `:5863` `'the charm held'` | Closed (LUL-2331). `#veilCharmPip`/the eased `#veilState` refill (`components/Hud.tsx`'s `useVeilMeterRamp`) are dev-visible only — `#veilState` lives inside `#panel`, hidden by default (admin-mode-gated, `e2e/admin-mode.spec.ts`); the audio cues, beacon pulse, and prompt/caption text above are the real player-visible/audible triple. |
| Drowned car (Deepwater) | `buildDrownedCar()` `:1251-1263`; `addBeaconGlow(g, 'drownedCar', 1.6)` `:1261` | `missionCompleteSting()` `:4605-4618` (`soundOn`-gated), called from `completeMissionSequence()` `:4648` | Prompt `:5422` `'Press  E  at the drowned car'`; caption `:4647` `'the drowned car -- found it'` | Full triple present. |
| Radio mast | `buildRadioMast()` `:1295-1315`; `addBeaconGlow(g, 'radioMast', 11.2)` `:1313` | `missionCompleteSting()` `:4605`, called from `completeSecondarySequence()` `:4657` | Caption `:4656` `'the radio mast -- retrieved'` | Full triple present; gated by `secondaryCanComplete` (`:5360-5363`) + interact key. |
| Fire tower | `buildFireTower()` `:1223-1239`; `addBeaconGlow(g, 'fireTower', 9.6)` `:1237`; ambient `PointLight` `:1235` | **MISSING** | **MISSING** | Grepped `fireTower` file-wide — only its own builder and the `landmarkGroups` init (`:1341`). Pure navigational beacon; no mission or interaction hangs off it at all today, so no explanation exists to be missing a home for. |
| Cave immunity | `components/Hud.tsx:780-784` persistent `#caveImmunePanel`, `'Immune · {ceil(timeLeft)}s'`, visible while `caveImmuneActive` | `caveImmuneStartCue()` `:4623-4631` (called `:1859`); `caveImmuneEndCue()` `:4632-4640` (called `:5412` on the active→inactive edge) | **MISSING** as a one-shot — the HUD panel text above is persistent status, not a `captionsOn`-gated first-encounter caption | Triggered by walk-in distance (`:5399-5401` → `activateCavePower()` `:1844-1860`), no keypress. |
| Hollow log hide | Crouch: `eyeH` lerps to 1.05 while hidden `:5040` (shared with bramble) | `hollowLogSound(entering)` `:2903-2924` (`soundOn`-gated), dispatched via `playHideSfx('log', ...)` `:2925` | Prompt `components/Hud.tsx:284,293` `'Press  H  to hide in the hollow log'`; while hidden, `statusText` `:5369-5370` `'Hidden · Xs...'` | No `captionsOn`-gated one-shot fires on entering/exiting specifically — explanation lives in the persistent action-prompt/status HUD text, not the caption toast system. This element is being removed by the open, unmerged `lul-2311-remove-log-hiding` PR (#571, bramble becomes the only hide spot) — re-check this row once that lands; not yet true on `release/next`. |
| Bramble hide | Same crouch mechanism `:5040` | `leafRustle(entering)` `:2855-2879`, dispatched via `playHideSfx('bramble', ...)` `:2925` | Same shared prompt UI, `components/Hud.tsx:284,293` (`noun='bush'`); same `statusText` `:5369-5370` | Fully shares the hide-prompt/status UI with hollow log hide — not a separate UI path. |
| Throwable stones | Pickup: stone disappears from the world / `heldThrowable` drives `layoutThrowableMeshes()` `:4531`; no throw trajectory/impact visual found | Landing thud reuses `leafRustle(false)` `:4539` (`soundOn`-gated via `:2856`); no dedicated throw sound — `throwThrowable()` (`:4533-4544`) makes no direct audio call | **MISSING for pickup.** `canGrabThrowable` is pushed (`:5426`) and commented as gating a "pick up stone" prompt (`:3220-3222`), but `state.canGrabThrowable` is never read anywhere in `components/Hud.tsx` — confirmed by grep, no prompt renders. Only the post-pickup `'Holding a stone — click to throw'` (`components/Hud.tsx:888-891`) exists, and it explains the throw action, not what picking one up is for. | The dead `canGrabThrowable` React read is a real gap (engine pushes state no component consumes) — flagged separately, not folded into this docs PR. |
| Roosts/nests | `triggerRoostBurst(i)` `:1560-1573` (per-roost particle burst), driven by `updateRoostBursts(dt)` `:1574-1587` | `roostFlushSound(x, z)` `:1595-1627` (`soundOn`-gated `:1596`) | Caption `` `birds scatter · ${cnear} · ${side}` `` `:1625`, itself gated `if(captionsOn)` `:1621` | Full triple present, unusually colocated inside the sound function itself rather than at the trigger call site. |
| Lake | Static water mesh/glow ring/`lakeLight` `:1157-1167`; ambient wisps `:1397-1400`; movement slow via `lakeSpeedMultiplier` `:5130` (felt, not seen) | Ambient proximity `twinkle()` chime `:2941`/`:5497-5500`, `soundOn`-gated | **MISSING** — no `caption:` mentioning the lake anywhere in the file | Twinkle is ambient/proximity, not a discrete "you found the lake" cue. Lake wading uses ordinary `footstep()`, not the bog's `splash()` — no distinct lake-specific audio tell either. |
| Bog | Ground render `bogOuterGround`/`bogInnerGround` `:1178-1187`; `generateBogTrees()` `:918-932`; canopy/reed cover | `splash(vol)` `:2827-2836` (`soundOn`-gated), fired at `:5506` whenever `playerBogginess > 0` | **MISSING** — no `caption:` for entering/being in the bog | Bog-mask (scent reduction, `:1829-1831`) is a stealth mechanic with no HUD explanation text found. |
| Landmarks/beacons (generic) | Generic pulsing beacon-glow opacity update, all six kinds, `:5513-5516` | None generic — per-landmark audio is mission-specific (drowned car/radio mast rows) or absent (Stone Marker/fire tower rows) | One generic, unconditional nav-tip caption `:3285` `'landmarks in the fog are safe to navigate by'`, fired once from `enter()` (`:3281-3285`) | Partial rollup, not a duplicate of the per-landmark rows above: the beacon-glow visual and the one-time nav caption are genuinely shared across all six; per-landmark audio/explanation is fully covered by (or missing from) the individual rows. |
| Embers pile | HUD counter only: `components/Hud.tsx:656` `Unbanked: {state.livePileEmbers}`, driven by `pushState({ livePileEmbers: ... })` `:5174` | **N/A** | **N/A** | Grepped `pile`/`ember` file-wide — there is no physical embers-pickup object in the 3D world. Embers accrue as a continuous running tally (depth + survival time), banked only at `arriveHome()`/`triggerDeath()`. This row, as named in `decisions/0015-cue-triple`'s row list, does not correspond to a discrete walk-up-and-trigger element in the current codebase — there is no single trigger moment to cue. Flagged back to the CTO rather than filed as a cue-gap ticket; see the comment on this ticket. |

## MISSING summary

Genuine cue-triple gaps, one interactive element, cell-by-cell:

- **Stone Marker mist-charm** — closed by LUL-2331 (child of LUL-2321 Part 1): audio
  (purchase + activation) and the offer-prompt explanation are no longer MISSING, see the
  row above.
- **Fire tower** — audio and explanation both MISSING, but there is no interaction of any
  kind on the fire tower today (pure beacon) — no ticket filed; needs a product decision
  (does the fire tower do anything?) before an engineering ticket makes sense. Flagged to
  CTO.
- **Cave immunity** — explanation MISSING (no first-encounter one-shot; only a persistent
  status readout). Explanation-only gap → folds into LUL-2307 per this ticket's routing
  rule, not a new ticket.
- **Throwable stones (pickup)** — explanation MISSING, and the underlying cause is a dead
  `state.canGrabThrowable` field (engine pushes it, no component reads it) rather than
  missing text. Explanation-only in effect, but the fix is a real code path, not just copy
  — folded into LUL-2307's scope note as "needs a live prompt, not just wording" rather
  than silently treated as a copy-only fix.
- **Lake** — explanation MISSING (audio/visual present). Explanation-only → LUL-2307.
- **Bog** — explanation MISSING (audio/visual present). Explanation-only → LUL-2307.
- **Embers pile** — not a real discrete trigger point in the current implementation; no
  ticket filed, flagged to CTO as a decision-doc/implementation mismatch instead.

No new child ticket opened by this audit: the one gap with a real engineering shape beyond
copy (Stone Marker) already has one (LUL-2331); the fire-tower and embers-pile findings are
product questions, not engineering gaps, and go to the CTO as ticket comments; every
remaining MISSING cell is explanation-only and folds into LUL-2307 (status: `blocked`,
assigned Game Engineer, PR #570 already open against `release/next`) per this ticket's own
routing rule.
