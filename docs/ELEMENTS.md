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
- Move (WASD/arrows), walk or run (`Shift`),
  look (mouse via Pointer Lock, or drag-fallback, or touch stick on mobile) —
  `applyLook()` L1228, movement block in `tick()` L2199-2230.
- Jump at any time while playing, not gated on being chased — `beginJump()`
  L1199-1202, `JUMP_DURATION`/`JUMP_HEIGHT` in `lib/game/jump.ts`. The same
  arc is the predator-charge dodge (LUL-213).
- Enter a `hidden` stance (`KeyH` / touch Hide) — but **only** while standing
  within `HIDE_RADIUS` (2.2u) of a `bramble` or `log` cover prop
  (`HIDE_KINDS`, L278-279; `findHideSpot()` L854-867). Hiding lowers eye
  height (2.2→1.05, damped ~0.3s), silences footsteps/scent deposit, and
  shrinks predator detect range the longer it's held (`STILL_RAMP`=1.2s,
  `STILL_DETECT_CUT`=0.82 — never reaches 1, so standing still in the open
  next to a predator still gets you caught — `effectiveDetect()` L871-874).
- Dim the personal follow-light (hold `KeyF`) — `LIGHT_NORMAL`/`LIGHT_DIMMED`
  L172-173, applied in `tick()` L2188-2197; paired with a screen-edge
  vignette cue (`applyVignette()` L191-195), **and**, as of `LUL-291`, a real
  detection multiplier — see the Follow-light section.
- Pick up the child (`KeyE` / touch Interact) within 3.6 units, once
  (`canPickup`, `pickup()` L1951-1961).
- Carry the child home; walking speed is multiplied by `CONFIG.carryPaceMul`
  (0.72) while carrying (`tick()` L2202).
- Leave a scent trail while moving (not while hidden or standing still) —
  `depositScent()` L746-749, deposited every `SCENT_DEPOSIT_INTERVAL` (0.3s).
- Make audible footstep noise while moving — `NOISE_RADIUS_WALK`/`_RUN`
  (14/24 units), `checkNoise()` L791-794.
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
  (L1618-1619) says so directly: "There is no separate modal settings
  surface today (LUL-70, still backlog)." Previous revisions of this doc
  cited engine line numbers for this bullet as if it were live; that was
  wrong at every revision, not just a drift artifact — see the LUL-411
  handoff comment.

**What it CANNOT do**
- Cannot enter `hidden` anywhere else — standing behind a rock or a
  large tree (LOS cover) does **not** let you hide; those only block sight
  incidentally while you keep moving (LUL-212's own framing, L263-277).
- Cannot be slowed, blocked, or otherwise affected by the **lake** — no
  collision or speed check anywhere references `inLake()` for the player's
  own movement (only for *other* objects' spawn placement, see the Lake
  section and the matrix). Flagged as `UNDEFINED` below, not a feature.
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
- `toggleHidden()` is declared **twice** in the same closure scope (plain
  `function` statements, not `const`): once at L1189-1192 (the original
  LUL-153 version: unconditional `hidden=!hidden` + a `feature_engagement`
  analytics `track()` call), and again at L1385-1389 (the LUL-212 rewrite:
  gates entry on `findHideSpot()`, delegates exit to `exitHide()`). In
  JavaScript, the later `function` declaration in the same scope wins — the
  first definition, analytics call included, is **dead code, never
  executed**. Practical effect: the `feature_engagement('hide')` analytics
  event has not fired since LUL-212 shipped, silently. Filed as **LUL-391**
  (see handoff comment) — not fixed here, out of this ticket's scope, but a
  real finding this registry exists to surface.
- Eye height (`eyeH`) is damped toward `hidden ? 1.05 : CONFIG.eye` (2.2) at
  an ~0.3s time constant (`Math.min(1, dt*8)`, L2175), not snapped — see
  wiki `game/lul267-canopy-collision-fix` for a documented edge case where
  this damping outlives the `hidden` flag for a few frames.
- Player FOV for "can the player see the charging predator" gating is ~130°
  total (`PLAYER_FOV_COS`, `cos(65°)`, L1605) — independent of the render
  camera's own 70° vertical FOV (`camera` L107); this is a gameplay cone, not
  the literal viewport.

**Collision & physics profile**
- Movement collider: **circular, radius 0.6**, checked against the tree grid
  (`t.cr = 0.35*s`), the canopy-aware grid (`t.crCanopy`, player-only), and
  rotated-AABB cover props. No collider vs. lake, home, fog, child, or
  predators — see above.
- No vertical/ground collision at all: eye height is a formula
  (`eyeH + bob + jumpY`, L2271), never a raycast against the ground mesh.
- Two different downstream checks read player position without going through
  `blocked()`: `hasLOS()` (sight, rotated-AABB raycast, includes tagged
  trees `s>1.4`) and the distance-only scent/noise/catch/pickup/win checks
  above — geometry gates *sight only*; it never gates scent or hearing
  (`checkScent()` L750-756 and `checkNoise()` L791-794 take no cover/LOS
  argument at all).

---

### Child (the lost, glowing objective)

**What it can do**
- Sit at a fixed point drawn once per map (`baby.x/z`, `generateMap()`
  L432-435), glowing and idly bobbing, marked by ambient "wisp" particles
  (`placeBabyWisps()` L547-551) so it's spottable through fog.
- Be picked up once (`baby.taken`, `pickup()` L1951), triggering a scripted
  10s pickup cinematic (`tick()`'s `pickingUp` branch, L2232-2255) that ends
  in a sky-burst (`fireBoom()` L579-598).
- Ride along at the player's position while carried, small and glowing
  (`carrying` branch, `tick()` L2255-2264), until the player crosses
  `CONFIG.home.r` (3.6u) of the home landmark, which wins the run
  (`arriveHome()` L1975-1989).
- **NOT live on `main`** — idle/carry glow intensity scaled by a difficulty
  preset's `glowMul` was built on the unmerged LUL-26 branch
  (`DIFFICULTY_PRESETS`); `engine/forest-engine.js` on `main` has no
  `glowMul`/`DIFFICULTY_PRESETS` identifier at all (verified by grep,
  2026-08-18). See the Player section's accessibility-settings note above —
  same root cause, not a separate finding.

**What it CANNOT do**
- Cannot move on its own, ever, outside the two scripted transitions above —
  there is no idle wander, no reaction to nearby predators, no flee behavior.
- Cannot be found or interacted with by anything except the player — no
  predator state, roam waypoint, or detection check ever reads `baby.x/z`
  at runtime (only at **spawn time**, to keep predators from spawning on top
  of it — `Math.hypot(x-baby.x,z-baby.z)<26` in `placePredators()` L692).
  Once the map is generated, a predator can stand directly on the
  un-collected child with zero effect. `UNDEFINED` — see matrix.
- Cannot be dropped, lost, or re-hidden once picked up — `baby.taken` only
  ever goes false→true, reset by `generateMap()`/`restart()`.
- Cannot collide with anything (no collider function reads its position).

**Behaviours & logic**
- Placement: `generateMap()` L432-435 — polar draw, `d = half*(0.5+rng()*0.3)`
  from origin, rejected while `inLake(baby.x,baby.z)` is true (only spawn
  guard on the child; no guard against landing near a tree/cover cluster).
- Home is a **fixed reuse of the spawn point** (`CONFIG.home = {x:0,z:0,...}`,
  L85, comment: "reuses the spawn point, no new rng draw" — LUL-38), not a
  second procedurally-placed landmark.

**Collision & physics profile**
- No collider. Visual scale/position only (`babyGroup`, a `THREE.Group` of
  two spheres + a halo + a point light, L526-539). Placement-time-only
  clearance from the lake (`inLake`) and from trees/cover (`inBaby()`,
  L524, used symmetrically by *their* placement loops, not the child's own).

---

### Wolf / Bear / Lion (predators)

Three species sharing one state machine (`updatePredators()`, L930-1160) and
one geometry builder (`makePredator()`, L625-683), differentiated by the
`PSPEC` table (L611-619):

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
  (`state==='roam'`, L984-993).
- Detect the player through three independent channels: **sight**
  (`canSee()`, LOS raycast + shrinking-with-stillness range, L875-878),
  **scent** (`checkScent()`, radius+wind, no LOS check at all, L750-756),
  and **noise** (`checkNoise()`, pure distance + per-second chance while the
  player moves, L791-794). Any one channel alone triggers a chase.
- Chase, losing/regaining track via `investigate`→`sniff`→`back` (LUL-22,
  explicitly "not to be retuned").
- Force-hunt: if nothing has been within 20 units of the player for 30s, the
  nearest predator switches straight to `hunt` (relentless, ignores LOS
  break) — `tick()` L2297-2299.
- **Wolf only**: coordinate as a pack. The instant one wolf chases, the other
  two path to flanking points ±60° off the
  player's last movement heading (`updateWolfPack()`, L894-921).
- **Wolf and lion only**: telegraph-and-charge at 7-16 units range
  (`CHARGE_TRIGGER_MIN/MAX`, `lib/game/charge.ts`), dodgeable by a
  well-timed jump. Bear deliberately excluded — "the slow unavoidable
  threat" (L1006-1007 comment) — contrast with wolf/lion is the design
  intent, not an oversight.
- Catch (kill) the player at `dist < rad+1.3` while actively seeing/hunting
  them (`triggerDeath()`, multiple call sites in `updatePredators()`).
- **NOT live on `main`** — parking predators off-map (`p.inert`, `x=z=-9999`)
  under a lower difficulty preset's `activePerSpecies` was built on the
  unmerged LUL-26 branch. `placePredators()` on `main` (L688-701) has no
  `p.inert`/`activePerSpecies`/difficulty logic at all (verified by grep,
  2026-08-18) — every predator always spawns active, every seed, today. Same
  root cause as the Player/Child LUL-26 notes above.

**What they CANNOT do**
- Cannot physically collide with cover props (rock/log/bramble) at all —
  predators call `blockedR()` directly for movement, never `blocked()`, so
  `coverBlockedR()` (and player-only `canopyBlockedR()`) never run for them.
  **Deliberate**, not a gap: the standing comment at `coverBlockedR()`
  (L308-320) says folding this in previously produced a stuck-predator
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
  another collider (`placePredators()`'s rejection loop, L692) — **but
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
  `CHARGE_COOLDOWN`=10s, L928) and the resulting movement.
- Stuck detection: if a predator's actual movement falls under 35% of its
  intended speed for >3s while trying to move, it backs up along its last 6
  trail points then picks a fresh random waypoint (`p.stuckT`, L1095-1103).

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
  `generateCover()` L387).
- Render with per-instance brightness variation and random rotation
  (`generateMap()` L450-462).

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
  instanced foliage cones (`trunkGeo`/`cone1Geo`/`cone2Geo`, L200-202),
  scale `s = 0.7 + rng()*1.7` drawn per tree (`generateMap()` L447).
- Visual canopy radius (`CANOPY_R*s = 1.15*s`, 0.8-2.76u) is **~3.29× wider**
  than the trunk collision radius (`0.35*s`, 0.245-0.84u) at every scale —
  this ratio is the root cause LUL-266 documented and LUL-267 partially
  mitigated for the player only (wiki `game/lul266-teal-render-rootcause`).

**Collision & physics profile**
- Player: trunk circle (`0.35*s + 0.6`) **and** canopy circle (`crCanopy`,
  eye-height-derived, see Player section).
- Predator: trunk circle only (`0.35*s + p.rad`).
- LOS: rotated-AABB `{hx:hz: t.cr*1.4}` (L387), tagged trees only.

---

### Rock

**What it can do**
- Block movement for the **player only** (`coverBlockedR()`, rotated AABB).
- Block LOS for both player and predators (`hasLOS()`).
- Render as one of three cover-prop kinds (`DodecahedronGeometry`, L251),
  ~35% of the 220 `COVER_PROPS` roll (`roll < 0.75 && roll >= 0.4`,
  `generateCover()` L398).

**What it CANNOT do**
- Cannot block predator movement (predators never call `coverBlockedR()`).
- Cannot be a hiding spot — not in `HIDE_KINDS`. Ducking behind a rock
  blocks sight but never enables `hidden`.
- Not guaranteed clear of tree trunks at placement (see matrix).

**Behaviours & logic**
- `hx=r, hz=r*(0.7+rng()*0.5)`, `r=0.9+rng()*0.9`, random rotation `ry`
  (`generateCover()` L398, L400).

**Collision & physics profile**
- Player-only rotated-AABB collider (half-extents `hx,hz`, rotation `ry`).
- LOS: same AABB, both actors.

---

### Log (fallen wood)

**What it can do**
- Everything Rock can do, **plus**: is a valid `hidden`-stance location
  (`HIDE_KINDS.log = true`) — entering/exiting plays a distinct "hollow
  log knock" sound (`hollowLogSound()`, L1356-1377).
- ~40% of cover-prop rolls (`roll < 0.4`, `generateCover()` L396), long/thin
  (`hx`/`hz` drawn asymmetrically so it reads as a log, not a box).

**What it CANNOT do**
- Same movement-blocking exemption as Rock: predators pass through it.
- Not guaranteed clear of tree trunks at placement (see matrix).

**Behaviours & logic**
- `long = 1.3+rng()*1.1, thin = 0.35+rng()*0.25`, orientation randomized
  between long-on-x / long-on-z (`generateCover()` L396-397).

**Collision & physics profile**
- Same as Rock: player-only rotated-AABB collider, LOS for both actors.
- Additionally gates `findHideSpot()` (proximity search, `HIDE_RADIUS`=2.2u
  beyond the prop's own edge, L854-867).

---

### Bramble (bush)

**What it can do**
- Everything Log can do (hiding-spot eligible, `HIDE_KINDS.bramble = true`),
  with a distinct "leaf rustle" enter/exit sound (`leafRustle()`,
  L1335-1352) — researched against stealth/horror foley convention per the
  LUL-212 handoff (wiki `game/lul212-hiding-spots`).
- ~25% of cover-prop rolls (`roll >= 0.75`, `generateCover()` L399).

**What it CANNOT do**
- Same as Log: no predator movement collision; not guaranteed clear of tree
  trunks at placement.

**Behaviours & logic**
- `r = 0.8+rng()*0.7`, `hx=hz=r` (roughly round footprint,
  `generateCover()` L399).

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
  `CONFIG.lake.clear` (22 units, `inLake()` L289, used at L393 (cover),
  L446 (trees), L435 (child)).
- Bias the ambient "twinkle" chime to play brighter/more often when the
  player is near it (`distLake < CONFIG.lake.r*3`, `tick()` L2386-2388).

**What it CANNOT do**
- **Cannot block, slow, or otherwise affect player movement at all.**
  `inLake()` is never called from `blocked()`/`blockedR()`/`coverBlockedR()`
  — a player can walk straight into and through the water mesh with zero
  mechanical consequence. `UNDEFINED` — see matrix; this reads exactly like
  a missing feature (shallow-water slow, or a hard block) rather than an
  intentional "walkable lake."
- Does not keep **predators** clear of itself at spawn — `placePredators()`'s
  rejection loop (L692) checks spawn-clearing distance, baby distance,
  and `blockedR()`, but never `inLake()`. `UNVERIFIED`/`UNDEFINED` whether a
  predator can spawn standing in the lake on some seeds.
- Does not affect scent or noise propagation (both are pure radius+wind /
  radius+chance functions with no lake awareness).

**Behaviours & logic**
- `CONFIG.lake = { x:34, z:-28, r:15, clear:22, glow:0x86b8ff }` (L84).
- Ambient wisp particles loop 0.2→4.5 units and reset (`tick()` L2400-2402).

**Collision & physics profile**
- **None for movement, for anyone.** Purely a placement-time exclusion zone
  for trees/cover/child, and a purely visual landmark otherwise.

---

### Home (the goal landmark)

**What it can do**
- Mark the win destination: a point light + additive ring at
  `CONFIG.home = {x:0, z:0, r:3.6, glow:0xffd9b0}` (L85, L492-497).
- Trigger the win condition when the player, while `carrying`, comes within
  `CONFIG.home.r` of it (`arriveHome()`, `tick()` L2263-2264).
- Breathe (opacity pulse) continuously regardless of game state
  (`tick()` L2396).

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
  lake only, L2044-2052 — home has no minimap marker).

**Behaviours & logic**
- Static, no RNG draw — same every seed, every restart.

**Collision & physics profile**
- None. Proximity trigger only, gated on `carrying === true`.

---

### Fog

**What it can do**
- Uniformly fade all rendered fragments by camera distance
  (`scene.fog = new THREE.FogExp2(0x0b1220, CONFIG.fog)`, L105,
  `CONFIG.fog = 0.04`, L78).
- Be adjusted live by the player via the settings panel (`setFog()`,
  L2027) — a pure rendering parameter, `scene.fog.density`.

**What it CANNOT do**
- **Has no coupling to any detection math.** `effectiveDetect()` (predator
  sight range) never reads `scene.fog` or `CONFIG.fog` — a predator's
  mechanical sight range is fixed by species (`PSPEC.detect`) regardless of
  how thick the fog is set, and the player's own ability to "notice" a
  predator has no gameplay hook at all (informational only, via rendering).
  This is a real, verified absence, not a gap in reading the code — worth
  knowing before assuming "thicker fog = harder to be seen."
- Does not affect scent, noise, or collision in any way.
- Excluded from a handful of unfogged/always-visible effects on purpose
  (`fog:false` on several materials — stars, moon, the win-burst particles,
  L156-163, L568-576) so those read clearly regardless of density.

**Behaviours & logic**
- Single scalar (`density`), read once per frame by the renderer itself;
  nothing in `forest-engine.js` re-derives anything from it per frame.

**Collision & physics profile**
- N/A — not a spatial object, has no position or collider.

---

### Follow-light (player point light)

**What it can do**
- Illuminate the area around the player, attached directly to the camera
  (`playerLight = new THREE.PointLight(...); camera.add(playerLight)`,
  L166) — always exactly coincident with the player, not a separate
  tracked entity.
- Switch between two fixed states, `LIGHT_NORMAL`/`LIGHT_DIMMED`
  (intensity 0.7/0.18, distance 20/8, L172-173), toggled by holding `KeyF`
  (`tick()` L2188-2197), paired with a screen vignette cue.
- **As of `LUL-291` (merged to `main` 2026-08-18, pulled in by this ticket's
  required backmerge — see handoff comment), dimming is also a real
  detection multiplier**: `effectiveDetect()` (L871-874) now multiplies by
  `DIM_DETECT_MUL` (0.75, L824) whenever `lightDimmed` is true, stacking
  with the stillness cut. Previous revisions of this doc described this as
  "deliberately dormant" — that was true against this branch's original base
  (`fc2b51f`) but is **no longer true against current `main`**; see the
  "CANNOT do" bullet below, corrected in the same pass.

**What it CANNOT do**
- Cannot be occluded by anything — **no shadow-casting exists anywhere in
  this file** (`grep` confirms zero `shadowMap`/`castShadow` usage). The
  light passes through trees, cover, and terrain equally; "dimming" changes
  its falloff distance/intensity, not what it can see through.
- Cannot be independently positioned — always camera-local.

**Behaviours & logic**
- Binary state only (no slider) — a deliberate choice per the LUL-40
  handoff, "a slider players set once and forget wouldn't be the
  every-second decision the ticket wants."

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
  `hudState`/`pushState()`/`emitState()` (L1562-1579): objective text,
  hiding status, win/death screens, charge-dodge prompt, the post-run recap
  (`#runRecap`). **Not** difficulty/accessibility controls or captions —
  those were built on the unmerged LUL-26 branch; see the Player section's
  note. There is no separate modal settings surface on `main` today
  (engine's own comment, L1618-1619: "LUL-70, still backlog").

**What it can do**
- Render every piece of state the engine pushes (`pushState()`, only sends
  a patch when a value actually changed, L1573-1579).
- Send **actions back**, never state: the full returned API is `enter`,
  `restart`, `setPace`, `setFog`, `toggleSound`, `regenMap`, and five
  touch-control setters (`setTouchMove`/`setTouchLook`/`setTouchSprint`/
  `triggerTouchHide`/`triggerTouchInteract`) (L2500-2501) — these are the
  *only* way React code can affect the world. No LUL-26 accessibility/
  difficulty setters exist in this object on `main`.
- The minimap specifically reads and draws two other elements' live data:
  tree positions (`treeData`, every 4th tree) and the lake's position/radius
  (`drawMinimapStatic()` L2044-2052) — not just player/child/predator state.

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
  avoid redundant React re-renders (L1573-1579).

**Collision & physics profile**
- N/A — not a spatial/world object.

---

## The interaction matrix

Every pairwise combination of the 15 elements above, physical/geometric
relationships only (movement collision, line-of-sight blocking, "stood on").
Scent and noise are **not** columns here because the source is unambiguous
that neither channel has *any* geometry interaction with *any* element
(`checkScent()`/`checkNoise()` take no cover/LOS argument at all, full stop)
— that fact is recorded once, globally, rather than repeated as "–" in 15
columns. Directional gameplay relationships that aren't physical collisions
(detection, proximity triggers, HUD reflection) are listed below the matrix
instead of forced into collision/LOS codes.

Legend: `C` = collides (blocks movement) · `LOS` = blocks line of sight ·
`HIDE` = enables the player's hidden-stance · `STAND` = implicit/visual only,
not physically derived · `TRIG` = proximity/distance trigger, not a
collider · `ATT` = permanently attached/coincident · `–` = no interaction,
verified in source · **`U`** = **UNDEFINED — no source resolves this**.
Matrix is symmetric for `C`/`LOS`; filled upper-triangle, lower mirrors it.

| | PL | CH | WO | BE | LI | TR | RO | LO | BR | GR | LA | HO | FO | FL | UI |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **PL** Player | · | TRIG¹ | TRIG² | TRIG² | TRIG² | C+LOS³ | C+LOS | C+LOS+HIDE | C+LOS+HIDE | STAND | **U**⁴ | TRIG⁵ | – | ATT | TRIG⁶ |
| **CH** Child | | · | **U**⁷ | **U**⁷ | **U**⁷ | – | – | – | – | STAND | – ⁸ | – | – | – | TRIG⁶ |
| **WO** Wolf | | | ·⁹ | **U**¹⁰ | **U**¹⁰ | C(trunk)+LOS³ | LOS only¹¹ | LOS only¹¹ | LOS only¹¹ | STAND | **U**¹² | – | – | – | TRIG⁶ |
| **BE** Bear | | | | –¹³ | **U**¹⁰ | C(trunk)+LOS³ | LOS only¹¹ | LOS only¹¹ | LOS only¹¹ | STAND | **U**¹² | – | – | – | TRIG⁶ |
| **LI** Lion | | | | | –¹³ | C(trunk)+LOS³ | LOS only¹¹ | LOS only¹¹ | LOS only¹¹ | STAND | **U**¹² | – | – | – | TRIG⁶ |
| **TR** Tree | | | | | | · | **U**¹⁴ | **U**¹⁴ | **U**¹⁴ | STAND | –¹⁵ | –¹⁶ | – | – | render¹⁷ |
| **RO** Rock | | | | | | | · | –¹⁸ | –¹⁸ | STAND | –¹⁵ | –¹⁶ | – | – | – |
| **LO** Log | | | | | | | | · | –¹⁸ | STAND | –¹⁵ | –¹⁶ | – | – | – |
| **BR** Bramble | | | | | | | | | · | STAND | –¹⁵ | –¹⁶ | – | – | – |
| **GR** Ground | | | | | | | | | | · | STAND | STAND | – | – | – |
| **LA** Lake | | | | | | | | | | | · | –¹⁹ | – | – | render¹⁷ |
| **HO** Home | | | | | | | | | | | | · | – | – | – |
| **FO** Fog | | | | | | | | | | | | | · | – | – |
| **FL** Follow-light | | | | | | | | | | | | | | · | – |
| **UI** HUD/UI | | | | | | | | | | | | | | | · |

¹ Pickup (`distBaby<3.6`) and carry-follow (child's position snaps to
player's while carrying) — proximity, not collision.
² Catch/death (`dist<p.rad+1.3`) — proximity, not collision. Player and
predators never call `blocked()`/`blockedR()` against each other.
³ Only trees tagged `s>1.4` (`coverData`); smaller trees block movement but
not sight.
⁴ **Notable.** Nothing gates player movement against the lake at all —
walking into the water mesh has zero mechanical effect. Filed as **LUL-392**.
⁵ Win trigger (`dh<CONFIG.home.r`), gated on `carrying===true` — proximity,
not collision.
⁶ HUD reflects state derived from this element (objective/status/caption
text, death/win screens) but never collides with or is collided into.
⁷ **Notable.** No runtime check ever compares a predator's position to the
child's — only a spawn-time clearance (`placePredators()`). A predator can
stand on an un-collected child indefinitely with no reaction from either
side. Filed as **LUL-393**.
⁸ Child's spawn draw rejects `inLake()` positions (`generateMap()` L432-435)
— defined, not undefined; the child itself has no runtime lake interaction
because it never moves.
⁹ Wolves-vs-wolves: coordinate via `updateWolfPack()` (flank targeting reads
teammates' state) but **do not collide** with each other — see ¹⁰.
¹⁰ **Notable.** Zero code compares any two predators' positions for
collision — same-species or cross-species. Two wolves, a wolf and a bear,
etc. can fully overlap in world space. Filed as **LUL-394** (bundles all
predator-predator pairs — see handoff comment for why one ticket, not six).
¹¹ Predators never call `coverBlockedR()` — movement passes straight
through rock/log/bramble. **Deliberate** (LUL-119/LUL-211 comment,
`coverBlockedR()` L308-320), not `U`. LOS is still blocked normally.
¹² **Notable.** `placePredators()`'s spawn-rejection loop (L692) checks
spawn-clearing, baby-distance, and `blockedR()`, but never `inLake()` —
unlike the tree and child spawn loops. Whether a predator can spawn (or
later roam into) the lake is unresolved by source. Filed as **LUL-395**.
¹³ Bears and lions are explicitly solitary — no pack coordination exists for
either species (LUL-24 comment: "bears stay solitary... the contrast is the
point"). Defined absence, not undefined.
¹⁴ **Notable.** `generateCover()` (L385-404) never checks tree positions —
only `inLake()`/`inSpawn()`/`inBaby()`. A rock/log/bramble can spawn
overlapping a tree trunk. Filed as **LUL-396**.
¹⁵ Trees and cover props both reject `inLake()` spawn candidates
(`generateMap()` L446, `generateCover()` L393) — defined, not undefined.
¹⁶ Both protected from home only indirectly, via the shared `inSpawn()`
check (home reuses the spawn coordinates) — see Home's "what it cannot do."
¹⁷ Rendered as a dot/circle on the minimap (`drawMinimapStatic()`,
L2044-2052) — a read-only relationship, not physical.
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

---

## Notable `UNDEFINED` cells filed as tickets

Per this ticket's instruction: these are filed, not guessed at. Each is a
plain child issue, not assigned to Code Review (nobody's claiming a fix here
— just visibility). Severity is P2/P3 per the shared rubric — none of these
break a core mechanic (win/hide/catch all function), so none block this
registry's own merge.

- **LUL-391** — dead `toggleHidden()` analytics: `feature_engagement('hide')`
  has never fired since LUL-212 shipped (function shadowing, see Player
  section). P2 (analytics blind spot, not a gameplay break).
- **LUL-392** — Player has no collision or slow against the lake; walking
  into the water mesh does nothing. P2/P3 (visual/feel question for the
  Game Tester to weigh in on — is a walkable lake intended?).
- **LUL-393** — Predators have zero runtime awareness of the child's
  position; can stand on it with no reaction. P3 (narrow: only matters
  before pickup, and nothing currently depends on it).
- **LUL-394** — No predator-vs-predator collision, any pairing; they can
  fully overlap in world space. P3 (cosmetic risk, not a mechanic break).
- **LUL-395** — Predator spawn placement doesn't check `inLake()`, unlike
  tree/child placement; whether a predator can spawn in the lake is
  unverified. P2 (spawn-correctness question, easy fix if real).
- **LUL-396** — Cover-prop placement (`generateCover()`) doesn't check tree
  clearance; a rock/log/bramble can spawn overlapping a tree trunk. P2
  (visual clipping, possibly an unreachable/broken hiding spot if it hits a
  `bramble`/`log`).

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
