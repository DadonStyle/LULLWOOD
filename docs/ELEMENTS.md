# Lullwood — canonical ELEMENTS registry

Source of truth: `engine/forest-engine.js` on `main` at `7796362` (2026-08-18,
2,519 lines — re-derived after backmerging `main` past `fc2b51f`, LUL-411),
cross-checked against `lib/game/{jump,charge,scent}.ts` and `components/{GameCanvas,Hud,MobileControls,DesktopControls}.tsx`.
Everything below is enumerated from what the engine actually instantiates —
not from memory, not from the original ticket text. Every claim cites a real
symbol/line so it can be re-verified after the next diff.

**Scope note — LUL-25 (the Bog) is not in this file's main tables.** It is
approved (`REVIEW: APPROVED`, wiki `game/lul25-status`) but PR #58
(`lul-25-bog-map-landmarks`, head `86be9fc2`) is **still open, not merged** —
confirmed live via the GitHub API (`state: open`, `merged: false`) at the time
this page was written. Documenting it as if it were live on `main` would make
this registry wrong the moment anyone reads it against real `main`. Its shape
is recorded separately in the **Pending: the Bog (LUL-25, PR #58)** section at
the end, sourced from that branch's actual diff, so it's a five-minute merge
to fold in once the PR lands — not a re-derivation.

**Code correctness only.** Every claim below is "this is what the source
does." None of it is a claim about how anything looks, feels, sounds, or
plays — that's the Game Tester's call (LUL-383c). Anywhere the source itself
doesn't settle a question, it's marked `UNVERIFIED`.

Maintenance contract: every ticket that adds, removes, or changes an
element's verbs, collision, or interactions must update this file in the same
PR. If a future PR doesn't, the interaction matrix below is stale advertising,
not a source of truth — treat any diff that changes gameplay-relevant code in
`engine/forest-engine.js` as required to touch this file too.

---

## Elements (main branch)

### Player

**What it can do**
- Move (WASD/arrows), walk or run (`Shift`, hold by default; toggle if the
  `runMode==='toggle'` accessibility setting is on, `ShiftLeft`/`ShiftRight`
  edge-detect at L1506-1507 flips `toggleRunOn`),
  look (mouse via Pointer Lock, or drag-fallback, or touch stick on mobile) —
  `applyLook()`, movement block in `tick()`,
  `running` derivation at L2802. In toggle mode, touch's analogue is
  `triggerTouchToggleRun()` (L3525-3529, gated on the same
  `runMode==='toggle'` check; `MobileControls.tsx`'s `touchToggleRun` button
  only renders in that mode).
- Jump at any time while playing, not gated on being chased — `beginJump()`,
  `JUMP_DURATION`/`JUMP_HEIGHT` in `lib/game/jump.ts`. The same
  arc is the predator-charge dodge (LUL-213). Touch equivalent is
  `triggerTouchJump()` (L3502-3508, same guards as the desktop `Space`
  keydown handler, minus the `e.repeat` check since a tap is already
  discrete; `MobileControls.tsx`'s `touchJump` button). LUL-617: during a
  charge, the centered `#chargePrompt` pill (`Hud.tsx`) is *also* a tap
  target on mobile, wired to the same `triggerTouchJump()` — it used to
  render "JUMP" with `pointer-events: none`, a false affordance during the
  one-second dodge window; the bottom-left button is unchanged and still
  works too.
- Pause the run (`Escape`, desktop-only key) or resume it — touch has no
  pointer-lock re-acquire to resume with, so `triggerTouchPause()`
  (L3514-3518, `MobileControls.tsx`'s `touchPause` button) toggles both
  directions instead of only pausing.
- Enter a `hidden` stance (`KeyH` / touch Hide) — but **only** while standing
  within `HIDE_RADIUS` (2.2u) of a `bramble` or `log` cover prop's true,
  rotation-aware rectangular edge (`HIDE_KINDS`, L278-279; `findHideSpot()`,
  edge distance via `distanceToCoverEdge()` in `lib/game/cover.ts`,
  LUL-405/LUL-430 fix — previously approximated the edge as a
  `Math.max(hx,hz)` circle, which over-extended the trigger several times
  past the object's real thickness on an elongated log's thin side). Hiding
  lowers eye
  height (2.2→1.05, damped ~0.3s), silences footsteps/scent deposit, and
  shrinks predator detect range the longer it's held (`STILL_RAMP`=1.2s,
  `STILL_DETECT_CUT`=0.82 — never reaches 1, so standing still in the open
  next to a predator still gets you caught — `effectiveDetect()`).
- Dim the personal follow-light (hold `KeyF`, or hold touch's `touchVeil`
  button via `setTouchVeil()` L3488 — `veilHeld` reads `keys['KeyF'] ||
  touchVeil` at L3088, mirrored the same way in `qaPlayerState()`'s return
  object, so the two inputs are equivalent, not independent) —
  `LIGHT_NORMAL`/`LIGHT_DIMMED`,
  applied in `tick()`; paired with a screen-edge
  vignette cue (`applyVignette()`), **and**, as of `LUL-291`, a real
  detection multiplier — see the Follow-light section.
- Pick up the child (`KeyE` / touch Interact) within 3.6 units, once
  (`canPickup`, `pickup()`).
- Carry the child home; walking speed is multiplied by `CONFIG.carryPaceMul`
  (0.72) while carrying (`tick()`).
- Leave a scent trail while moving (not while hidden or standing still) —
  `depositScent()`, deposited every `SCENT_DEPOSIT_INTERVAL` (0.3s).
- Make audible footstep noise while moving — `NOISE_RADIUS_WALK`/`_RUN`
  (14/24 units), `checkNoise()`.
- Dodge a telegraphed predator charge by jumping within the charge window —
  `stepCharge()` in `lib/game/charge.ts`.
- **NOT live on `main`** — accessibility/difficulty settings (run mode
  hold/toggle, mouse sensitivity, invert-Y, reduced motion, captions,
  difficulty presets) were built on LUL-26 (`setRunMode`/`setSensitivity`/
  `setInvertY`/`setReducedMotion`/`setCaptions`/`setDifficulty`,
  `DIFFICULTY_PRESETS`, all in `engine/forest-engine.js` **on that branch
  only**), but branch `lul-26-difficulty-accessibility` is **not merged**.
  `engine/forest-engine.js` on `main` has no such identifiers today
  (verified by grep, 2026-08-18) and its own settings-panel comment
  (L1692-1693) says so directly: "There is no separate modal settings
  surface today (LUL-70, still backlog)." Previous revisions of this doc
  cited engine line numbers for this bullet as if it were live; that was
  wrong at every revision, not just a drift artifact — see the LUL-411
  handoff comment.

**What it CANNOT do**
- Cannot enter `hidden` anywhere else — standing behind a rock or a
  large tree (LOS cover) does **not** let you hide; those only block sight
  incidentally while you keep moving (LUL-212's own framing, L263-277).
- Cannot be blocked by the **lake** — it is a wade (half `maxSpd`,
  `lakeSpeedMultiplier()`/`inLakeWater()` in `lib/game/lake.ts`), not a wall.
  **Fixed, LUL-791/LUL-392** — see the Lake section and the matrix (`SLOW`⁴).
  This bullet used to say the lake had no effect at all; that was true until
  LUL-791 landed and is stale now.
- Cannot physically collide with the child, a predator, the lake, the fog,
  or the home landmark — none of `blocked()`/`blockedR()`/`coverBlockedR()`
  is ever called with those as the obstacle; every player/actor "contact" in
  this game is a **distance threshold**, not a solid-body collision
  (pickup: `distBaby<3.6`; death: `dist<p.rad+1.3`; win: `dh<CONFIG.home.r`).
- Cannot outrun any predator in a straight line — every species' tuned speed
  exceeds the player's (see Predator section); hiding/cover is the actual
  counterplay, not speed.
- Cannot move while `pickingUp` (the 10s cinematic) or while `dead`/`won`.

**Behaviours & logic**
- Movement collision: `blocked(x,z) = blockedR(x,z,0.6) || coverBlockedR(x,z,0.6) || canopyBlockedR(x,z)`
  (L372) — the **only** consumer of `canopyBlockedR()`/`coverBlockedR()` in
  the whole file; predators never call `blocked()`, only `blockedR()`
  directly (see Predator section — this is deliberate, LUL-119/LUL-211).
- **Fixed, LUL-391 (PR #117).** `toggleHidden()` used to be declared **twice**
  in the same closure scope (plain `function` statements, not `const`) — the
  earlier LUL-153 declaration carried the `feature_engagement` analytics
  `track()` call and was silently shadowed by the later LUL-212 rewrite, so
  the event never fired. The shadowed declaration is deleted; there is now a
  single `toggleHidden()`, and the `track()` call moved into
  `enterHide()`, which all three call sites (`KeyH`, the touch Hide
  button, and `tick()`'s movement-breaks-cover check) already funnel
  through, so `feature_engagement('hide')` fires on every hide entry again.
- Eye height (`eyeH`) is damped toward `hidden ? 1.05 : CONFIG.eye` (2.2) at
  an ~0.3s time constant (`Math.min(1, dt*8)`, L2272), not snapped — see
  wiki `game/lul267-canopy-collision-fix` for a documented edge case where
  this damping outlives the `hidden` flag for a few frames.
- Player FOV for "can the player see the charging predator" gating is ~130°
  total (`PLAYER_FOV_COS`, `cos(65°)`, L1679) — independent of the render
  camera's own 70° vertical FOV (`camera`); this is a gameplay cone, not
  the literal viewport.

**Collision & physics profile**
- Movement collider: **circular, radius 0.6**, checked against the tree grid
  (`t.cr = 0.35*s`), the canopy-aware grid (`t.crCanopy`, player-only), and
  rotated-AABB cover props. No collider vs. lake, home, fog, child, or
  predators — see above.
- No vertical/ground collision at all: eye height is a formula
  (`eyeH + bob + jumpY`, L2375), never a raycast against the ground mesh.
- Two different downstream checks read player position without going through
  `blocked()`: `hasLOS()` (sight, rotated-AABB raycast, includes tagged
  trees `s>1.4`) and the distance-only scent/noise/catch/pickup/win checks
  above — geometry gates *sight only*; it never gates scent or hearing
  (`checkScent()` and `checkNoise()` take no cover/LOS
  argument at all).

---

### Child (the lost, glowing objective)

**What it can do**
- Sit at a fixed point drawn once per map (`baby.x/z`, `generateMap()`),
  glowing and idly bobbing, marked by ambient "wisp" particles
  (`placeBabyWisps()`) so it's spottable through fog.
- Be picked up once (`baby.taken`, `pickup()`), triggering a scripted
  10s pickup cinematic (`tick()`'s `pickingUp` branch, L2329-2359) that ends
  in a sky-burst (`fireBoom()`).
- Ride along at the player's position while carried, small and glowing
  (`carrying` branch, `tick()`), until the player crosses
  `CONFIG.home.r` (3.6u) of the home landmark, which wins the run
  (`arriveHome()`).
- **NOT live on `main`** — idle/carry glow intensity scaled by a difficulty
  preset's `glowMul` was built on the unmerged LUL-26 branch
  (`DIFFICULTY_PRESETS`); `engine/forest-engine.js` on `main` has no
  `glowMul`/`DIFFICULTY_PRESETS` identifier at all (verified by grep,
  2026-08-18). See the Player section's accessibility-settings note above —
  same root cause, not a separate finding.
- **As of `LUL-27`**, the **Fog Tide** (see Fog above) scales the idle/carry
  glow further while active, on top of the difficulty preset's own
  `glowMul`: `fogTideGlowMul(fogTideAmount)` multiplies `halo.material.
  opacity` and `babyLight.intensity` by up to `FOG_TIDE_GLOW_MUL` (1.5x at
  full tide), and `fogTideGlowRangeMul(fogTideAmount)` separately multiplies
  `babyLight.distance` by up to `FOG_TIDE_GLOW_RANGE_MUL` (1.35x). "Carries
  further" is deliberately a range increase, not just brightness, so the
  glow stays legible through the tide's own added fog density (Fog above) —
  the two effects (denser fog, longer-reaching glow) are meant to roughly
  offset, not one cancel the other out unintentionally.

**What it CANNOT do**
- Cannot move on its own, ever, outside the two scripted transitions above —
  there is no idle wander, no reaction to nearby predators, no flee behavior.
- Cannot be found or interacted with by anything except the player — no
  predator state, roam waypoint, or detection check ever reads `baby.x/z`
  at runtime (only at **spawn time**, to keep predators from spawning on top
  of it — `Math.hypot(x-baby.x,z-baby.z)<26` in `placePredators()`).
  Once the map is generated, a predator can stand directly on the
  un-collected child with zero effect. `UNDEFINED` — see matrix.
- Cannot be dropped, lost, or re-hidden once picked up — `baby.taken` only
  ever goes false→true, reset by `generateMap()`/`restart()`.
- Cannot collide with anything (no collider function reads its position).

**Behaviours & logic**
- Placement: `generateMap()` — polar draw, `d = half*(0.5+rng()*0.3)`
  from origin, rejected while `inLake(baby.x,baby.z)` is true (only spawn
  guard on the child; no guard against landing near a tree/cover cluster).
- On `'blackout'` difficulty (the hardest `DIFFICULTY_PRESETS` tier), the
  draw above is overridden by `applyHardBabySpawn()` to a point beyond the
  Bog band instead, via `pickHardBabyPosition()` (`lib/game/bog.ts`) — a
  separate, symmetric override keyed on its own `babySpawnDifficulty` flag,
  restored back to the normal draw if the player picks a non-`'blackout'`
  preset before entering (LUL-799). `'lantern'`/`'night'` never call
  `pickHardBabyPosition()`, so their rng stream is unaffected. Reachable
  from the real Settings panel via `setDifficulty()` (LUL-372) — previously
  only `qaSetDifficulty()` could set it. See the Bog appendix for the band
  itself.
- Home is a **fixed reuse of the spawn point** (`CONFIG.home = {x:0,z:0,...}`,
  L85, comment: "reuses the spawn point, no new rng draw" — LUL-38), not a
  second procedurally-placed landmark.

**Collision & physics profile**
- No collider. Visual scale/position only (`babyGroup`, a `THREE.Group` of
  two spheres + a halo + a point light, L526-539). Placement-time-only
  clearance from the lake (`inLake`) and from trees/cover (`inBaby()`,
  used symmetrically by *their* placement loops, not the child's own).

---

### Wolf / Bear / Lion (predators)

Three species sharing one state machine (`updatePredators()`) and
one geometry builder (`makePredator()`), differentiated by the
`PSPEC` table:

| stat | wolf | bear | lion |
|---|---|---|---|
| `detect` (sight range, units) | 42 | 30 | 48 |
| `nose` (scent-pickup multiplier) | 1.0 | 1.4 (strongest) | 0.75 (weakest) |
| `rad` (collision radius) | 0.8 | 1.5 | 1.0 |
| `budget` (chase-speed divisor) | 6 | 9 | 4 |
| final `speed` (units/s) | ≈15.47 | ≈13.91 | ≈17.8 |
| pack behaviour | flanks as a pack | solitary | solitary |
| can charge | yes | **no** | yes |

**What they can do (shared)**
- Roam via random waypoints when nothing has noticed the player
  (`state==='roam'`, L1010-1019).
- Detect the player through three independent channels: **sight**
  (`canSee()`, LOS raycast + shrinking-with-stillness range),
  **scent** (`checkScent()`, radius+wind, no LOS check at all),
  and **noise** (`checkNoise()`, pure distance + per-second chance while the
  player moves). Any one channel alone triggers a chase.
- Chase, losing/regaining track via `investigate`→`sniff`→`back` (LUL-22,
  explicitly "not to be retuned").
- Force-hunt: if nothing has been within 20 units of the player for 30s, the
  nearest predator switches straight to `hunt` (relentless, ignores LOS
  break) — `tick()`.
- **Wolf only**: coordinate as a pack. The instant one wolf chases, the other
  two path to flanking points ±60° off the
  player's last movement heading (`updateWolfPack()`).
- **Wolf and lion only**: telegraph-and-charge at 7-16 units range
  (`CHARGE_TRIGGER_MIN/MAX`, `lib/game/charge.ts`), dodgeable by a
  well-timed jump. Bear deliberately excluded — "the slow unavoidable
  threat" (L1032-1033 comment) — contrast with wolf/lion is the design
  intent, not an oversight.
- Catch (kill) the player at `dist < rad+1.3` while actively seeing/hunting
  them (`triggerDeath()`, multiple call sites in `updatePredators()`).
- **NOT live on `main`** — parking predators off-map (`p.inert`, `x=z=-9999`)
  under a lower difficulty preset's `activePerSpecies` was built on the
  unmerged LUL-26 branch. `placePredators()` on `main` (L704-726) has no
  `p.inert`/`activePerSpecies`/difficulty logic at all (verified by grep,
  2026-08-18) — every predator always spawns active, every seed, today. Same
  root cause as the Player/Child LUL-26 notes above.

**What they CANNOT do**
- Cannot physically collide with cover props (rock/log/bramble) at all —
  predators call `blockedR()` directly for movement, never `blocked()`, so
  `coverBlockedR()` (and player-only `canopyBlockedR()`) never run for them.
  **Deliberate**, not a gap: the standing comment at `coverBlockedR()`
  (`lib/game/cover.ts`, moved there by LUL-425) says folding this in
  previously produced a stuck-predator
  freeze (LUL-119). LOS is still blocked by the same props via `hasLOS()` —
  only movement-collision is exempt.
- Cannot collide with each other, or with the child — no code path checks
  predator-vs-predator or predator-vs-child distance for collision.
  `UNDEFINED` — see matrix.
- Bear cannot charge (see table). Only wolf/lion evaluate
  `shouldTriggerCharge()`.
- Cannot be avoided by outrunning them (every species is faster than the
  player's max sprint, `RUN = CONFIG.walk*1.8 = 10.8`, all three final
  speeds exceed it — L623-624).
- Cannot spawn inside the spawn clearing, too close to the child, or inside
  another collider (`placePredators()`'s rejection loop) — **but
  this loop does not check `inLake()`**, unlike the tree and child spawn
  loops. `UNVERIFIED`/`UNDEFINED` whether a predator can spawn inside the
  lake's clear radius on some seeds — see matrix.

**Behaviours & logic**
- `PSPEC`'s literal `speed` values (8.5/6.8/9.2, L616-618) are **immediately
  overwritten** by `for(const k in PSPEC) PSPEC[k].speed = RUN + CHASE_GAP/PSPEC[k].budget`
  (L623-624) before any predator object is created — the literals in the
  table are dead values, never read by a live predator. Real speeds are the
  "final speed" row above.
- Charge state machine (`telegraph`→`charging`→`overshoot`→`caught`/`cleared`)
  lives in `lib/game/charge.ts`, unit-tested, imported into the engine —
  the engine only owns *when* one can start (`p.chargeCooldown<=0`,
  `CHARGE_COOLDOWN`=10s) and the resulting movement.
- Stuck detection: if a predator's actual movement falls under 35% of its
  intended speed for >3s while trying to move, it backs up along its last 6
  trail points then picks a fresh random waypoint (`p.stuckT`, L1491-1496).
  LUL-1091 shipped this at 0.8s but LUL-1597 reverted it: the shorter window
  is sensitive to per-frame wall-clock jitter, causing `predator-determinism`
  e2e divergence across parallel runs with the same seed. The pathfinding
  improvements (pickAvoidDirection near+far probe, slideVelocity) from
  LUL-1091 are retained. `p.trail` samples every 0.4s and keeps 6 points.

**Collision & physics profile**
- Movement collider: circular, radius `PSPEC[kind].rad` (0.8/1.5/1.0),
  checked only against the tree-trunk grid (`blockedR`, never
  `coverBlockedR`/`canopyBlockedR`) — see above.
- LOS: same rotated-AABB raycast as the player's own (`hasLOS()`), applied
  symmetrically (`canSee()` calls it both directions along the same line).
- No ground collision (`p.g.position.y = bob` is a formula, not a raycast,
  same as the player).

---

### Tree

**What it can do**
- Physically block player and predator movement via a trunk-radius circle
  collider (`t.cr = 0.35*s`, `blockedR()`).
- Additionally block the **player's own** movement via a wider,
  eye-height-aware canopy radius (`t.crCanopy = canopyRadiusAtEye(s)`,
  L229-231) — player-only, see wiki `game/lul267-canopy-collision-fix` for
  the full derivation and its known residual close-up-foliage limitation.
- Block line of sight for **both** player and predators, but only if
  `s > 1.4` ("large" trees get tagged into `coverData` as `kind:'tree'`,
  `generateCover()`).
- Render with per-instance brightness variation and random rotation
  (`generateMap()`).

**What it CANNOT do**
- Small/mid trees (`s <= 1.4`) never block LOS, only movement — there is no
  tree size below which line-of-sight blocking is guaranteed.
- Cannot be a hiding spot (`HIDE_KINDS` only contains `bramble`/`log`) —
  ducking behind a tagged tree blocks sight incidentally but never lets the
  player enter `hidden`.
- Cannot block predator movement beyond the trunk radius — canopy collision
  is player-only (see Player section, LUL-267/LUL-273).
- Does not guarantee clearance from cover props placed after it — see matrix
  (Tree × Rock/Log/Bramble).

**Behaviours & logic**
- 1,300 instances (`CONFIG.trees`), one instanced trunk cylinder + two
  instanced foliage cones (`trunkGeo`/`cone1Geo`/`cone2Geo`),
  scale `s = 0.7 + rng()*1.7` drawn per tree (`generateMap()`).
- Visual canopy radius (`CANOPY_R*s = 1.15*s`, 0.8-2.76u) is **~3.29× wider**
  than the trunk collision radius (`0.35*s`, 0.245-0.84u) at every scale —
  this ratio is the root cause LUL-266 documented and LUL-267 partially
  mitigated for the player only (wiki `game/lul266-teal-render-rootcause`).

**Collision & physics profile**
- Player: trunk circle (`0.35*s + 0.6`) **and** canopy circle (`crCanopy`,
  eye-height-derived, see Player section).
- Predator: trunk circle only (`0.35*s + p.rad`).
- LOS: rotated-AABB `{hx:hz: t.cr*1.4}` (L407), tagged trees only.

---

### Rock

**What it can do**
- Block movement for the **player only** (`coverBlockedR()`, rotated AABB).
- Block LOS for both player and predators (`hasLOS()`).
- Render as one of three cover-prop kinds (`DodecahedronGeometry`, L251),
  ~35% of the 220 `COVER_PROPS` roll (`roll < 0.75 && roll >= 0.4`,
  `generateCover()`).

**What it CANNOT do**
- Cannot block predator movement (predators never call `coverBlockedR()`).
- Cannot be a hiding spot — not in `HIDE_KINDS`. Ducking behind a rock
  blocks sight but never enables `hidden`.
- Not guaranteed clear of tree trunks at placement (see matrix).

**Behaviours & logic**
- `hx=r, hz=r*(0.7+rng()*0.5)`, `r=0.9+rng()*0.9`, random rotation `ry`
  (`generateCover()`).

**Collision & physics profile**
- Player-only rotated-AABB collider (half-extents `hx,hz`, rotation `ry`).
- LOS: same AABB, both actors.

---

### Log (fallen wood)

**What it can do**
- Everything Rock can do, **plus**: is a valid `hidden`-stance location
  (`HIDE_KINDS.log = true`) — entering/exiting plays a distinct "hollow
  log knock" sound (`hollowLogSound()`).
- ~40% of cover-prop rolls (`roll < 0.4`, `generateCover()`), long/thin
  (`hx`/`hz` drawn asymmetrically so it reads as a log, not a box).
- **LUL-384: the player walks and runs over it, no route-around needed** —
  `coverKindBlocksPlayerMovement('log')` is `false` (`lib/game/cover.ts`),
  so `coverBlockedR()` no longer blocks the player here. The always-on jump
  (LUL-213) already worked everywhere, including on/over a log; this just
  means you're no longer stopped at its edge in the first place.

**What it CANNOT do**
- Movement-blocking exemption now shared with the player too (LUL-384) —
  Log is the only cover kind that blocks neither actor's movement. Rock and
  Bramble are unchanged, still solid to the player.
- Guaranteed clear of tree **trunks** at placement, same as every cover kind
  (see matrix) — and, unlike Rock/Bramble, also guaranteed clear of tree
  **canopies** (`overlapsTreeCanopy()`, `lib/game/cover.ts`, LUL-491): since
  a log invites the player to walk its full span and `canopyBlockedR()`
  blocks unconditionally within a tree's canopy radius regardless of what
  cover prop sits there, `generateCover()` rejects a log candidate whose
  footprint overlaps a nearby canopy circle even when it clears the trunk
  circle. Rock/Bramble don't get this extra check — solid either way, so a
  canopy-only overlap there changes nothing observable.

**Behaviours & logic**
- `long = 1.3+rng()*1.1, thin = 0.35+rng()*0.25`, orientation randomized
  between long-on-x / long-on-z (`generateCover()`).

**Collision & physics profile**
- LOS-blocking for both actors, same as Rock (`hasLOS()`, unchanged).
- **No movement collision for either actor** (LUL-384 removed the
  player-only block; predators never had one). Catch resolves normally on
  or beside a log — `isCaught()`/chase are proximity checks, never gated on
  `blocked()`/`coverBlockedR()`, so a log is not a safe zone.
- Still gates `findHideSpot()` (proximity search, `HIDE_RADIUS`=2.2u
  beyond the prop's own edge, L908-922) — unaffected, that function reads
  `coverGrid` directly and never calls `coverBlockedR()`.

---

### Bramble (bush)

**What it can do**
- Everything Log can do (hiding-spot eligible, `HIDE_KINDS.bramble = true`),
  with a distinct "leaf rustle" enter/exit sound (`leafRustle()`)
  — researched against stealth/horror foley convention per the
  LUL-212 handoff (wiki `game/lul212-hiding-spots`).
- ~25% of cover-prop rolls (`roll >= 0.75`, `generateCover()`).

**What it CANNOT do**
- Same as Log: no predator movement collision; not guaranteed clear of tree
  trunks at placement.

**Behaviours & logic**
- `r = 0.8+rng()*0.7`, `hx=hz=r` (roughly round footprint,
  `generateCover()`).

**Collision & physics profile**
- Same as Log: player-only rotated-AABB collider, LOS for both actors,
  `findHideSpot()`-eligible.

---

### Ground / terrain

**What it can do**
- Render as a single 800×800 flat plane (`PlaneGeometry`, L140-142),
  visually "under" everything.

**What it CANNOT do**
- **Has no collision function at all.** Nothing in the file raycasts against
  it or reads its geometry. Every other element's vertical (Y) position is
  either a hardcoded constant, or a formula (bob/`eyeH`/`jumpY`/predator
  `bob`) — never derived from the ground mesh. "Standing on the ground" is
  a purely visual coincidence of Y=0-ish values agreeing, not a physical
  relationship.
- Has no texture variation, slope, or region boundary of its own — the map's
  actual "regions" (lake, spawn clearing, forest) are separate systems
  (`inLake()`, `inSpawn()`) layered on top of one uniform flat plane.

**Behaviours & logic**
- Single static mesh, created once, never touched again after L140-142.

**Collision & physics profile**
- None. See above.

---

### Lake

**What it can do**
- Visually mark the map's landmark body of water: a circular water mesh
  (`CONFIG.lake.r`=15), an additive glow ring, wisp particles rising out of
  it, and a point light (L476-505).
- Keep other elements clear of itself **at placement time only**: trees,
  cover props, and the child all reject spawn candidates inside
  `CONFIG.lake.clear` (22 units, `inLake()`, used for cover, tree, child,
  and — as of LUL-791/LUL-395 — predator spawn placement).
- Slow the player: `lakeSpeedMultiplier()` (`lib/game/lake.ts`) halves
  `maxSpd` while `inLakeWater()` is true — the visible water radius
  `CONFIG.lake.r` (15), a tighter circle than the `clear` ring spawn checks
  use, so the slow starts exactly where the water mesh does. LUL-791/LUL-392.
- Bias the ambient "twinkle" chime to play brighter/more often when the
  player is near it (`distLake < CONFIG.lake.r*3`, `tick()`).
- Deflect a predator's roam/stuck-recovery waypoint: `updatePredators()`'s
  two waypoint-pick sites (fresh roam target, and the stuck-recovery
  fallback) both route the candidate through `keepWaypointOffLake()`, which
  pushes it just past the water's edge (`inLakeWater()`, radius `r`) if it
  landed inside — predators never *target* water, though nothing stops one
  from crossing open water while actively chasing (LUL-857).

**What it CANNOT do**
- **Still cannot block player movement, by design.** Deliberately a wade
  (half speed, `LAKE_SPEED_MULTIPLIER`=0.5, same shape as the bog's
  `BOG_SPEED_MULTIPLIER`), not a hard wall — see ⁴. Nothing currently reads
  the lake as anything deeper than ankle/waist depth (no drown state, no
  stamina drain, no audio change beyond the existing proximity chime bias).
- Does not affect scent or noise propagation (both are pure radius+wind /
  radius+chance functions with no lake awareness).

**Behaviours & logic**
- `CONFIG.lake = { x:34, z:-28, r:15, clear:22, glow:0x86b8ff }`.
- Ambient wisp particles loop 0.2→4.5 units and reset (`tick()`).
- `pushOutOfLakeClearance()` (`lib/game/lake.ts`) is the deterministic
  fallback `placePredators()` applies if its 60-try spawn-retry budget
  exhausts on a candidate still inside `clear` — relocates radially outward
  to just past the ring, same angle as the rejected candidate.

**Collision & physics profile**
- **Slow-only for the player** (`SLOW`, water radius `r`), **placement-time
  exclusion only for everyone else** (`clear` radius: trees, cover, child,
  predators). No hard collider anywhere.

---

### Home (the goal landmark)

**What it can do**
- Mark the win destination: a point light + additive ring at
  `CONFIG.home = {x:0, z:0, r:3.6, glow:0xffd9b0}` (L85, L492-497).
- Trigger the win condition when the player, while `carrying`, comes within
  `CONFIG.home.r` of it (`arriveHome()`, `tick()`).
- Breathe (opacity pulse) continuously regardless of game state
  (`tick()`).

**What it CANNOT do**
- Has no collider of any kind — the win check is a plain distance compare,
  not `blocked()`/`blockedR()`.
- Is not itself protected from tree/cover placement by name — it is
  protected only because it deliberately reuses the same coordinates as the
  spawn clearing (`inSpawn(x,z) = x*x+z*z<40`, L290), which trees and cover
  both already avoid (LUL-38 comment, L85: "reuses the spawn point, no new
  rng draw"). If `CONFIG.home` ever moved off the spawn point, this
  protection would silently stop applying.
- Is not drawn on the minimap (`drawMinimapStatic()` renders trees and the
  lake only — home has no minimap marker).

**Behaviours & logic**
- Static, no RNG draw — same every seed, every restart.

**Collision & physics profile**
- None. Proximity trigger only, gated on `carrying === true`.

---

### Fog

**What it can do**
- Uniformly fade all rendered fragments by camera distance
  (`scene.fog = new THREE.FogExp2(0x0b1220, CONFIG.fog)`, L141,
  `CONFIG.fog = 0.04`, L89).
- Be adjusted live by the player via the settings panel (`setFog()`)
  — sets `fogBase`, the baseline the mist veil (below) ramps from and back
  to. Range on the slider itself is unchanged (0.02-0.11).
- **As of `LUL-382`** ramp all the way up to `MIST_VEIL_FOG` (0.34 — roughly
  3x the manual slider's own max) while the mist veil is held, eased
  by `veilAmount` over `VEIL_RAMP` (1.6s) each direction via
  `veilFogDensity()` (`lib/game/veil.ts`). `tick()` is the single
  writer of `scene.fog.density` now — `setFog()` no longer writes it
  directly, only `fogBase`.
- **As of `LUL-27`**, an additive top-up from the **Fog Tide**: a recurring
  world event on a fixed ~90s cadence (`FOG_TIDE_CONFIG` in
  `lib/game/fogTide.ts` — `period: 90`, `activeDuration: 20`, `leadIn: 10`,
  i.e. a 10s signposted build-up before each 20s active window), driven by
  the generic three-phase calm/signpost/active cycle in
  `lib/game/eventScheduler.ts`. At full tide, `fogTideFogBoost(fogTideAmount)`
  adds `FOG_TIDE_FOG_BOOST` (0.1) to `scene.fog.density` **on top of**
  whatever `veilFogDensity()` already produced (base + mist veil) — the two
  stack additively, the tide never overrides the veil's own density. Eased
  over `FOG_TIDE_RAMP` (4s — the same "thickens gradually, never snaps" feel
  as the veil's own ramp) toward the cycle's current target, computed in
  `tick()` regardless of whether the veil is held. Not seeded — a pure
  function of the dt-clamped game clock, deliberately not drawing from the
  map's `rng()` stream (see wiki `game/lul27-fog-tide` for the full
  reasoning). See Follow-light and Child below for the tide's other two
  effect surfaces (detect radius, child glow).

**What it CANNOT do**
- `effectiveDetect()` (predator sight range) still never reads
  `scene.fog`/`CONFIG.fog`/`fogBase` directly — the detection cut below
  reads `veilAmount`, a separate state variable driven by the same `KeyF`
  hold, not the actual fog density. In practice the two move in lockstep
  (both eased off the same `lightDimmed` transition, `tick()`),
  but a manual "Mist" slider change alone — no `KeyF` held — still has
  **zero** effect on detection, same invariant as before `LUL-382`, just now
  worth restating precisely: the correlation is real when the veil is
  active, not general "thicker fog = harder to be seen."
- Does not affect scent or noise in any way (see Follow-light below for the
  veil's own sight-only scope).
- Excluded from a handful of unfogged/always-visible effects on purpose
  (`fog:false` on several materials — stars, moon, the win-burst particles)
  so those read clearly regardless of density.

**Behaviours & logic**
- Single scalar (`density`), read once per frame by the renderer itself.
  `forest-engine.js` now re-derives it every frame from `fogBase` +
  `veilAmount` via `veilFogDensity()` (`lib/game/veil.ts`, called at L2657)
  while the veil is in play — no longer a pure pass-through of whatever
  `setFog()` last set.

**Collision & physics profile**
- N/A — not a spatial object, has no position or collider.

---

### Follow-light (player point light) / mist veil

**What it can do**
- Illuminate the area around the player, attached directly to the camera
  (`playerLight = new THREE.PointLight(...); camera.add(playerLight)`,
  L203) — always exactly coincident with the player, not a separate
  tracked entity.
- Switch between two fixed states, `LIGHT_NORMAL`/`LIGHT_DIMMED`
  (intensity 0.7/0.18, distance 20/8), toggled by holding `KeyF`
  (`tick()`), paired with a screen vignette cue.
- **As of `LUL-382` (supersedes `LUL-291`'s dim-only detection wiring, see
  decisions/0012-feature-impact-bar on the wiki)**, holding `KeyF` no longer
  just dims the light — it triggers the **mist veil**, a bundled world state:
  the light still dims (unchanged), `scene.fog.density` ramps to
  `MIST_VEIL_FOG` (0.34, see Fog above), and `effectiveDetect()`
  multiplies predator sight range by up to `VEIL_DETECT_MUL` (0.35 — a 65%
  cut, vs. LUL-291's 25%) via `veilDetectMul()`, scaled by the same
  `veilAmount` ramp as the fog. Sight only — `p.spec.scent` is untouched,
  same scope LUL-291 already had; a predator can still scent-lock the player
  through the veil.
- **Gated by a charge meter, not free** (`veilCharge`/`veilLocked`, engine
  L222): `VEIL_MAX_HOLD` (5s) of continuous hold drains it to zero, which
  force-drops the veil even with `KeyF` still held; it only regenerates
  while inactive, at `VEIL_REGEN_MUL` (0.5x) the drain rate, and a full
  drain locks the veil out until ~`VEIL_UNLOCK_CHARGE * VEIL_MAX_HOLD / maxHold`
  absolute veil-seconds of regen have elapsed (~1.5s by default; the threshold
  is scaled so Deeper Lungs tiers do not extend the lockout). The state machine itself is pure logic, lifted
  out to `lib/game/veil.ts` (`stepVeilCharge()`, unit tested — see
  `lib/game/veil.test.ts`) rather than living inline in `forest-engine.js`,
  per wiki systems/unit-testing-standard. Surfaced to the HUD as
  `veilCharge`/`veilLocked` (components/Hud.tsx, `#veilState`).
- **As of `LUL-27`**, the **Fog Tide** (see Fog above) cuts predator sight
  range on its own recurring cadence, independent of whether the veil is
  held: `effectiveDetect()`/`canSee()` multiply by `fogTideDetectMul
  (fogTideAmount)` (floor `FOG_TIDE_DETECT_MUL` 0.65 — a further 35% cut at
  full tide) in the same product as `veilDetectMul(veilAmount)` and the
  difficulty preset's own `detectMul` — all three stack multiplicatively.
  Deliberate, not a double-count bug: a spent resource (the veil, gated by
  its charge meter above) and a free recurring world event compounding is
  fine. Sight-only, same scope as the veil — `p.spec.scent` is untouched, so
  a predator can still scent-lock the player straight through a tide.
  Signposted ~10s ahead of the active window: the raw telegraph signal eases
  into `fogTideDroneGainMul(fogTideBuild)`, raising the ambient drone gain,
  while `fogTideWindGainMul(fogTideAmount)` ducks the wind bed by up to
  `FOG_TIDE_WIND_DUCK` (0.7) once the tide is active — audio eases over
  `FOG_TIDE_AUDIO_RAMP` (2s), faster than the world-effect ramp above so the
  cue reads as responsive. Only applied to this calm-bed audio mix — a
  chase already wins the audio outright, so the tide never fights the hunt
  cue.

**What it CANNOT do**
- Cannot be occluded by anything — **no shadow-casting exists anywhere in
  this file** (`grep` confirms zero `shadowMap`/`castShadow` usage). The
  light passes through trees, cover, and terrain equally; "dimming" changes
  its falloff distance/intensity, not what it can see through.
- Cannot be independently positioned — always camera-local.
- Cannot be held indefinitely — see the charge-meter bullet above; this is
  the feature's cost, a founder-mandated condition for shipping it
  (decisions/0012-feature-impact-bar).

**Behaviours & logic**
- Binary state only (no slider) — a deliberate choice per the LUL-40
  handoff, "a slider players set once and forget wouldn't be the
  every-second decision the ticket wants." Unchanged by `LUL-382`.
- `veilAmount` (0..1, `tick()`) eases `lightDimmed`'s boolean toward
  its target over `VEIL_RAMP` (1.6s) — slower than the vignette's own
  ~0.5s ramp (`dimAmount`), so the light pool reacts first and the world's
  mist visibly billows in behind it.

**Collision & physics profile**
- N/A — a light, not a collider. Unoccluded by all geometry (no shadow
  system in the renderer at all).

---

### HUD / UI surfaces

Two ownership domains, split at the LUL-34/LUL-35 boundary:

- **Engine-owned DOM** (`document.getElementById(...)`, created by
  `components/GameCanvas.tsx`, mutated directly by the engine): `#vignette`,
  `#spotFlash`, `#flash`, `#minimap` (canvas, drawn every frame by
  `drawMinimap()`/`drawMinimapStatic()`), `#hint`, `#pausePrompt`,
  `#deathVideo`.
- **React-owned** (`components/Hud.tsx`), driven one-directionally by
  `hudState`/`pushState()`/`emitState()`: objective text,
  hiding status, win/death screens, charge-dodge prompt, the contextual
  `#actionPrompt` (LUL-1089: hide/veil prompts), the post-run recap
  (`#runRecap`). **Not** difficulty/accessibility controls or captions —
  those were built on the unmerged LUL-26 branch; see the Player section's
  note. There is no separate modal settings surface on `main` today
  (engine's own comment, L1692-1693: "LUL-70, still backlog").
  LUL-1089 adds five new `EngineHudState` fields: `coverPromptVisible`,
  `coverPromptUrgent`, `coverPromptKind` (`'bramble'|'log'|null`),
  `veilPromptVisible`, `veilPromptUrgent`. Cover prompt fires only while
  `!hidden` and within `COVER_URGENT_RANGE` of a chasing predator for urgent.
  Veil prompt fires only when cover is not available (cover wins, never both).
  The cover probe is throttled to `COVER_PROBE_HZ` (6Hz); `lastHideSpot`
  holds the result between probes. Both prompt flags reset at every
  `hidden=false` reset site (pickup, death, restart).

**What it can do**
- Render every piece of state the engine pushes (`pushState()`, only sends
  a patch when a value actually changed).
- Send **actions back**, never state: the full API `init()` returns
  (L3162-3165) is `enter`, `restart`, `setPace`, `setFog`, `toggleSound`,
  `regenMap`, and nine touch-control setters (`setTouchMove`/`setTouchLook`/
  `setTouchSprint`/`triggerTouchHide`/`triggerTouchInteract`/
  `triggerTouchJump`/`triggerTouchPause`/`triggerTouchToggleRun`/
  `setTouchVeil`, LUL-529) — these are the *only* way React code can affect
  the world.
  No LUL-26 accessibility/difficulty setters exist in this object on `main`.
- The minimap specifically reads and draws two other elements' live data:
  tree positions (`treeData`, every 4th tree) and the lake's position/radius
  (`drawMinimapStatic()`) — not just player/child/predator state.

**What it CANNOT do**
- Cannot read engine internals directly — no reverse channel exists besides
  the action functions above; React never reaches into `player`, `treeData`,
  or any predator object.
- Cannot affect physics, collision, or AI directly — even the setters that
  do change world state (`setFog`, `regenMap`) go through
  the same functions the engine itself would call, not a bypass.
- The minimap is **not rescaled or extended for anything past the original
  240×240 forest** — deliberate today, since nothing past that boundary
  exists on `main` yet (see the Bog appendix: this will matter the moment
  LUL-25 lands, since its own wiki page already documents leaving the
  minimap untouched by design).

**Behaviours & logic**
- `hudState` is a single flat object; `pushState()` diffs before emitting to
  avoid redundant React re-renders.

**Collision & physics profile**
- N/A — not a spatial/world object.

---

### Embers (run currency)

**What it is**
- `embersBalance`: player's persisted currency balance (runs completed,
  predator kills, or other events), stored in `localStorage['lullwood:embers']`
  and synced to `hudState` via `setEmbers()` (L2924-2928 in
  `engine/forest-engine.js`). Earnable via `computeWinPayout()` /
  `computeDeathPayout()` in `lib/game/economy.ts`, applied via `applyPayout()`
  on win/death via `arriveHome()` / `triggerDeath()`. Both payout functions
  accept a `DifficultyTier` argument (`'lantern'`/`'night'`/`'blackout'`) that
  scales the total by a tier multiplier (LUL-1412): lantern ×1.00/×1.00,
  night ×1.75 win/×1.35 loss, blackout ×2.00 win/×1.25 loss. The engine passes
  `difficulty` at both call sites.
- `lastPayout`: breakdown of earnings from the run that just ended (null
  before first win/death this session), read by HUD on win/death screens to
  display what was earned. Matches `RunPayout` shape in `lib/game/economy.ts`.
- Deeper Lungs: unlock via shop button in post-run UI; one-time purchase per
  tier (tiers 0–3, `DEEPER_LUNGS_COSTS` array), persisted alongside balance as
  `tiers.deeperLungs`. Each tier increases the max veil (mist-dim) hold
  duration via `veilMaxHoldForTier()` in `lib/game/economy.ts`.

**What it can do**
- Bank on win/death: `applyPayout()` in `lib/game/economy.ts` computes
  balance delta and calls `setEmbers()` to persist; engine gates all payouts
  behind `canArriveHome()` / `triggerDeath()` to prevent double-apply.
- Unlock Deeper Lungs: each tier costs `DEEPER_LUNGS_COSTS[tier]` and increases
  `VEIL_MAX_HOLD` (via `veilMaxHoldForTier()`) until the next tier is purchased.
  Purchase is final, persisted to localStorage and synced to `hudState` via
  `deeperLungsTier` property.

**What it CANNOT do**
- Spend on anything other than Deeper Lungs tiers.
- Be lost/reset except via manual localStorage deletion (QA/debug only, not
  a player-facing action).

**Behaviours & logic**
- Persistence: `useEmbers()` hook in `components/Hud.tsx` (L225-241) reads
  stored balance on engine mount and writes to localStorage whenever balance
  or tier change. Gated to skip writing stale zero defaults before stored
  state is applied (ref `appliedRef` prevents persist effect from firing until
  apply-on-ready effect has run).
- `veilMaxHoldForTier(tier)` adds `DEEPER_LUNGS_HOLD_SECONDS[tier]` to base
  `VEIL_MAX_HOLD` — each tier adds 1 second to the hold cap (5/6/7/8 seconds
  at tiers 0/1/2/3).
- Win/death screen shows a shop button (wired to `purchaseDeeperLungs()`
  action) only if the player has balance ≥ `DEEPER_LUNGS_COSTS[currentTier]` and
  `currentTier < 3`.

**Collision & physics profile**
- N/A — not a spatial/world object.

---

### Stamina (sprint resource)

**What it is**
- `staminaCharge`: player's sprint-capacity meter, state in `engine/forest-engine.js` (L327), driven by `stepStamina()` and `sprintSpeedMul()` in `lib/game/stamina.ts`. Tracks the player's ability to sprint — the meter drains while running and refills while walking or idle.
- **Live as of `LUL-1113`**: The player's top sprint speed is no longer uncapped — sprinting at full stamina approaches `CONFIG.walk*1.8` (10.8 u/s), but this multiplier decays as the stamina meter drops toward zero, scaling movement speed via `sprintSpeedMul(staminaCharge)`. Prevents unlimited outrunning of predators.
- Audio cue (`staminaExertionCue()` L1806-1814): a short breath/exertion tone (~200Hz sine, 0.25s decay) plays once when stamina drops below 0.45 charge, and resets the cue as soon as stamina climbs back past 0.55 (hysteresis bands `0.45`/`0.55`, `staminaLowCuePlayed` flag). Also pushes a caption (`'breathing hard'`) when captions are on.

**What it can do**
- Gate the player's sprint speed (`tick()` at L3109-3112): `maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) * ...`, so the player still moves at walk pace when running with zero stamina, but gains speed as stamina refills.
- Play an audio telegraph when nearing zero charge, so the player knows they're nearly exhausted.
- Reset to full on each new run: `staminaCharge = 1` on `restart()` (L2860, alongside `staminaLowCuePlayed`).

**What it CANNOT do**
- Cannot prevent the player from moving at all — sprinting with zero stamina falls back to walk speed, not immobilization.
- Does not interact with any other world element (predators, cover, lake, etc.) — purely a player-state resource.
- Cannot be toggled or disabled by difficulty/accessibility settings (LUL-26 unmerged; no `DIFFICULTY_PRESETS` logic exists on `main` today).

**Behaviours & logic**
- Drain rate and refill rates are constants in `lib/game/stamina.ts` (`stepStamina()` parameters: `chargeDrainRate`/`chargeRegenRate`).
- Clamped to [0, 1] — never goes negative and never exceeds full.
- No player agency: decay and recovery are automatic, tied only to the `running` state and elapsed time `dt`.

**Collision & physics profile**
- N/A — not a spatial/world object.

---

## The interaction matrix

Every pairwise combination of the 16 elements above, physical/geometric
relationships only (movement collision, line-of-sight blocking, "stood on").
Scent and noise are **not** columns here because the source is unambiguous
that neither channel has *any* geometry interaction with *any* element
(`checkScent()`/`checkNoise()` take no cover/LOS argument at all, full stop)
— that fact is recorded once, globally, rather than repeated as "–" in 15
columns. Directional gameplay relationships that aren't physical collisions
(detection, proximity triggers, HUD reflection) are listed below the matrix
instead of forced into collision/LOS codes.

Legend: `C` = collides (blocks movement) · `LOS` = blocks line of sight ·
`HIDE` = enables the player's hidden-stance · `SLOW` = reduces movement
speed without blocking it · `STAND` = implicit/visual only,
not physically derived · `TRIG` = proximity/distance trigger, not a
collider · `ATT` = permanently attached/coincident · `–` = no interaction,
verified in source · **`U`** = **UNDEFINED — no source resolves this**.
Matrix is symmetric for `C`/`LOS`; filled upper-triangle, lower mirrors it.

| | PL | CH | WO | BE | LI | TR | RO | LO | BR | GR | LA | HO | FO | FL | UI | EM |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **PL** Player | · | TRIG¹ | TRIG² | TRIG² | TRIG² | C+LOS³ | C+LOS | LOS+HIDE²⁰ | C+LOS+HIDE | STAND | SLOW⁴ | TRIG⁵ | – | ATT | TRIG⁶ | TRIG²¹ |
| **CH** Child | | · | **U**⁷ | **U**⁷ | **U**⁷ | – | – | – | – | STAND | – ⁸ | – | – | – | TRIG⁶ | TRIG²¹ |
| **WO** Wolf | | | C⁹ | C¹⁰ | C¹⁰ | C(trunk)+LOS³ | LOS only¹¹ | LOS only¹¹ | LOS only¹¹ | STAND | –¹² | – | – | – | TRIG⁶ | TRIG²¹ |
| **BE** Bear | | | | C¹³ | C¹⁰ | C(trunk)+LOS³ | LOS only¹¹ | LOS only¹¹ | LOS only¹¹ | STAND | –¹² | – | – | – | TRIG⁶ | TRIG²¹ |
| **LI** Lion | | | | | C¹³ | C(trunk)+LOS³ | LOS only¹¹ | LOS only¹¹ | LOS only¹¹ | STAND | –¹² | – | – | – | TRIG⁶ | TRIG²¹ |
| **TR** Tree | | | | | | · | –¹⁴ | –¹⁴ | –¹⁴ | STAND | –¹⁵ | –¹⁶ | – | – | render¹⁷ | – |
| **RO** Rock | | | | | | | · | –¹⁸ | –¹⁸ | STAND | –¹⁵ | –¹⁶ | – | – | – | – |
| **LO** Log | | | | | | | | · | –¹⁸ | STAND | –¹⁵ | –¹⁶ | – | – | – | – |
| **BR** Bramble | | | | | | | | | · | STAND | –¹⁵ | –¹⁶ | – | – | – | – |
| **GR** Ground | | | | | | | | | | · | STAND | STAND | – | – | – | – |
| **LA** Lake | | | | | | | | | | | · | –¹⁹ | – | – | render¹⁷ | – |
| **HO** Home | | | | | | | | | | | | · | – | – | – | TRIG²¹ |
| **FO** Fog | | | | | | | | | | | | | · | – | – | – |
| **FL** Follow-light | | | | | | | | | | | | | | · | – | – |
| **UI** HUD/UI | | | | | | | | | | | | | | | · | – |
| **EM** Embers | | | | | | | | | | | | | | | | · |

¹ Pickup (`distBaby<3.6`) and carry-follow (child's position snaps to
player's while carrying) — proximity, not collision.
² Catch/death (`dist<p.rad+1.3`) — proximity, not collision. Player and
predators never call `blocked()`/`blockedR()` against each other.
³ Only trees tagged `s>1.4` (`coverData`); smaller trees block movement but
not sight.
⁴ **Fixed, LUL-791/LUL-392.** The player wades: `lakeSpeedMultiplier()`
(`lib/game/lake.ts`) halves `maxSpd` while `inLakeWater()` is true (the
visible water radius `CONFIG.lake.r`, not the wider `clear` spawn-clearance
ring ¹² uses). Deliberately a slow, not a hard wall — a fog-heavy horror
game reading a lake as an invisible wall feels like a bug even when
intentional, and the slow plays into the core hiding loop (risk the slow
crossing, or go around). Previously zero mechanical effect at all.
⁵ Win trigger (`dh<CONFIG.home.r`), gated on `carrying===true` — proximity,
not collision.
⁶ HUD reflects state derived from this element (objective/status/caption
text, death/win screens) but never collides with or is collided into.
⁷ **Notable.** No runtime check ever compares a predator's position to the
child's — only a spawn-time clearance (`placePredators()`). A predator can
stand on an un-collected child indefinitely with no reaction from either
side. Filed as **LUL-393**.
⁸ Child's spawn draw rejects `inLake()` positions (`generateMap()`)
— defined, not undefined; the child itself has no runtime lake interaction
because it never moves.
⁹ Wolves-vs-wolves: coordinate via `updateWolfPack()` (flank targeting reads
teammates' *state*, never position) and, as of **LUL-394**, also physically
collide — see ¹⁰.
¹⁰ **Fixed, LUL-394.** `predatorSeparationPush()` (`lib/game/predator.ts`)
runs as a second pass in `updatePredators()` (`engine/forest-engine.js`),
after every predator's own steering/movement for the frame, so it corrects
this frame's final positions rather than fighting movement mid-resolve. Any
two overlapping predators — same-species or cross-species — are pushed
apart along the line between their centers by half the overlap each (a
fixed heading if they're exactly coincident, since there's no defined
separation axis at zero distance). Applies to every pairing uniformly,
including same-species (wolf/wolf, bear/bear, lion/lion — see ⁹/¹³).
¹¹ Predators never call `coverBlockedR()` — movement passes straight
through rock/log/bramble. **Deliberate** (LUL-119/LUL-211 comment,
`coverBlockedR()` in `lib/game/cover.ts`), not `U`. LOS is still blocked
normally.
¹² **Fixed, LUL-791/LUL-395 (spawn) and LUL-857 (roam).**
`placePredators()`'s spawn-rejection loop rejects `inLake()` (the
`clear`-radius ring, same predicate as the tree/cover/child spawn loops),
same bounded budget (`tries<60`); on exhaustion, `pushOutOfLakeClearance()`
(`lib/game/lake.ts`) deterministically relocates the candidate just past the
clearance ring. Separately, `updatePredators()`'s two roam-waypoint pick
sites (fresh roam target and the stuck-recovery fallback) route through
`keepWaypointOffLake()` (`engine/forest-engine.js`), which pushes a
candidate just past the water's edge (`inLakeWater()`, radius `r`, not the
wider `clear`) if it landed inside — closes the gap this footnote used to
flag as residual. **Still not covered:** a predator actively chasing
(`state==='chase'`/`hunt`) heads straight at the player (`ux`/`uz`) and
ignores `wpx`/`wpz` entirely, so it can still cross open water mid-chase;
that's an intentional, unchanged behaviour (chase priority over lake
avoidance), not a gap in this fix.
¹³ Bears and lions are explicitly solitary — no pack *coordination* exists
for either species (LUL-24 comment: "bears stay solitary... the contrast is
the point"). That's targeting/flanking logic only; as of **LUL-394** they
still physically collide with same-species packmates via
`predatorSeparationPush()`, the same as every other predator pairing — see
⁹/¹⁰.
¹⁴ **Fixed, LUL-396/LUL-450.** `generateCover()` now rejects a
candidate rock/log/bramble whose own footprint circle overlaps a nearby
tree's trunk collision circle (`treesNear()` + `overlapsTreeTrunk()` in
`lib/game/cover.ts`) before placing it, same as the `inLake()`/`inSpawn()`/
`inBaby()` rejections already there. Previously unchecked — a prop could
spawn overlapping a tree trunk, a possible unreachable/broken hide spot if
it hit a `bramble`/`log`. **Log additionally checks canopy clearance
(LUL-384/LUL-491):** `overlapsTreeCanopy()` (`lib/game/cover.ts`) rejects a
log candidate whose footprint overlaps a nearby tree's wider *canopy*
circle (`t.crCanopy`), even when the trunk circle is clear — needed because
Log is walkable (`coverKindBlocksPlayerMovement('log') === false`) and
`canopyBlockedR()` blocks the player unconditionally within the canopy
radius regardless of what's on the ground; without this a log could spawn
clear of every trunk yet still wedge the player mid-crossing at a canopy
edge. Rock/Bramble stay trunk-only — solid either way, so a canopy-only
overlap changes nothing observable for them.
¹⁵ Trees and cover props both reject `inLake()` spawn candidates
(`generateMap()`, `generateCover()`) — defined, not undefined.
¹⁶ Both protected from home only indirectly, via the shared `inSpawn()`
check (home reuses the spawn coordinates) — see Home's "what it cannot do."
¹⁷ Rendered as a dot/circle on the minimap (`drawMinimapStatic()`)
— a read-only relationship, not physical.
¹⁸ Cover props are never checked against each other at placement — two
props (e.g. a rock and a bramble) can overlap. Lower severity than ¹⁴ (both
are already non-solid to predators and the overlap is cosmetic at most for
the player, who still collides with whichever AABB the grid cell returns
first) — not filed as a separate ticket; noted for whoever next touches
`generateCover()`.
¹⁹ Both are static, hardcoded far apart (lake at (34,-28) r=15/clear=22;
home at (0,0) r=3.6) — no code enforces their separation, but no seed can
move either one, so there's nothing to verify per-seed. Defined by
construction, not undefined.
²⁰ **Changed, LUL-384.** Previously `C+LOS+HIDE` like Bramble. Log is now the
one cover kind that doesn't block the player's movement either —
`coverKindBlocksPlayerMovement('log')` is `false` (`lib/game/cover.ts`), read
by `coverBlockedR()`. LOS and hide-spot eligibility are untouched (both read
`coverGrid` independently of `coverBlockedR()`), so Log keeps `LOS+HIDE`;
only the `C` is gone.
²¹ **Embers** (LUL-1043) is a run-currency event tracker, not a spatial
object — no movement collision or LOS interaction. `TRIG` marks events where
Embers earnings are computed: Player earnings/spending gate, Child pickup
earning trigger, Predator kill earning trigger, Home arrival earning trigger.

---

## Notable `UNDEFINED` cells filed as tickets

Per this ticket's instruction: these are filed, not guessed at. Each is a
plain child issue, not assigned to Code Review (nobody's claiming a fix here
— just visibility). Severity is P2/P3 per the shared rubric — none of these
break a core mechanic (win/hide/catch all function), so none block this
registry's own merge.

- ~~**LUL-391**~~ — **Fixed, PR #117.** Dead `toggleHidden()` analytics
  (`feature_engagement('hide')` never fired since LUL-212, function
  shadowing) is resolved: the shadowed declaration is deleted and the
  `track()` call now lives in `enterHide()`; see Player section.
- ~~**LUL-392**~~ — **Fixed, PR #163.** Player now wades: `lakeSpeedMultiplier()`
  halves `maxSpd` inside `inLakeWater()`; see footnote 4 and the Lake section.
- **LUL-393** — Predators have zero runtime awareness of the child's
  position; can stand on it with no reaction. P3 (narrow: only matters
  before pickup, and nothing currently depends on it).
- ~~**LUL-394**~~ — **Fixed.** `predatorSeparationPush()` resolves overlap
  for every predator pairing, same-species or cross-species; see footnotes
  ⁹/¹⁰/¹³.
- ~~**LUL-395**~~ — **Fixed, PR #163.** `placePredators()`'s spawn-rejection
  loop now rejects `inLake()` too; see footnote 12.
- ~~**LUL-396**~~ — **Fixed, LUL-450.** Cover-prop placement (`generateCover()`)
  now checks tree clearance before placing; see footnote 14 above.
- ~~**LUL-857**~~ — **Fixed.** `updatePredators()`'s roam and stuck-recovery
  waypoint picks now route through `keepWaypointOffLake()`; see footnote 12.
  (Filed after this doc's original ticket, as a residual gap PR #163 itself
  flagged rather than fixed — not one of the original `UNDEFINED` findings.)

---

## Pending: the Bog (LUL-25, PR #58 — not yet on `main`)

Sourced from branch `lul-25-bog-map-landmarks` (head `86be9fc2`) and
`lib/game/bog.ts` on that branch, **not** `main` — do not treat this section
as live until the PR merges, and fold it into the tables above (not append a
second matrix) the same day it does.

**New elements it adds**: `BogTree` (90-instance thinner-cover twin of Tree,
own `bogTreeData` array, merged into the shared `grid` for collision),
`Reed` (tall `coverData` kind `'reed'`, LOS-blocking like Rock/Log/Bramble
but **not** in `HIDE_KINDS` — not a hiding spot), four fixed `Landmark`
groups (fire tower, stone marker, drowned car, lightning-split oak — static,
no RNG draw, nudged clear of nearby trees via `clearLandmarkSpot()`), and a
`Bog` terrain band itself (`z > half && z <= zMax`, `isInBog()` in
`lib/game/bog.ts`) that halves player walk speed and multiplies noise
radius 1.6× while standing in it (`bogSpeedMultiplier`/`bogNoiseMultiplier`).

**What's already known and citable from that branch** (so this isn't a
guess): reeds reuse the exact same `coverMeshes`/`coverGrid`/`hasLOS()`
machinery as Rock/Log/Bramble, with zero changes to either function; bog
trees reuse `canopyRadiusAtEye()` unchanged; the minimap is deliberately
**not** extended to cover the bog (wiki `game/lul25-status`: "the bog is off
[the minimap's] edge on purpose," reasoned against genre wayfinding
precedent, not a shortcut). All of this predicts the same interaction shapes
already in the matrix above (Tree-shaped collision, Rock/Log/Bramble-shaped
LOS-only cover) — the merge-day update should mostly be new rows that mirror
existing ones, not new logic to re-derive.

**Not re-verified here**: PR #58's own review (LUL-371, Code Reviewer,
`REVIEW: APPROVED`) already re-derived its determinism claims independently;
this section only describes shape for forward-planning, it is not a second
review pass.
