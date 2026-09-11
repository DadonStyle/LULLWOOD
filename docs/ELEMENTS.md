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
  `triggerTouchToggleRun()` (gated on the same  `runMode==='toggle'` check; `MobileControls.tsx`'s `touchToggleRun` button
  only renders in that mode).
- Jump at any time while playing, not gated on being chased — `beginJump()`,
  `JUMP_DURATION`/`JUMP_HEIGHT` in `lib/game/jump.ts`. The same
  arc is the predator-charge dodge (LUL-213). Touch equivalent is
  `triggerTouchJump()` (same guards as the desktop `Space`  keydown handler, minus the `e.repeat` check since a tap is already
  discrete; `MobileControls.tsx`'s `touchJump` button). LUL-617: during a
  charge, the centered `#chargePrompt` pill (`Hud.tsx`) is *also* a tap
  target on mobile, wired to the same `triggerTouchJump()` — it used to
  render "JUMP" with `pointer-events: none`, a false affordance during the
  one-second dodge window; the bottom-left button is unchanged and still
  works too.
- Pause the run (`Escape`, desktop-only key) or resume it — touch has no
  pointer-lock re-acquire to resume with, so `triggerTouchPause()`
  (`MobileControls.tsx`'s `touchPause` button) toggles both  directions instead of only pausing.
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
  button via `setTouchVeil()` L5566 — `veilHeld` reads `keys['KeyF'] ||
  touchVeil` at L4935, mirrored the same way in `qaPlayerState()`'s return  object, so the two inputs are equivalent, not independent) —
  `LIGHT_NORMAL`/`LIGHT_DIMMED` (`engine/tuning.js`),
  applied in `tick()`; paired with a screen-edge
  vignette cue (`applyVignette()`), **and**, as of `LUL-291`, a real
  detection multiplier — see the Follow-light section.
- Pick up the child (`KeyE` / touch Interact) within 3.6 units, once
  (`canPickup`, `pickup()`). **As of `LUL-2281`** (2026-09-09, reverts
  `LUL-1307`'s carry-home leg), completing the ~11.3s ascend/explode
  cinematic (`tick()`'s `pickingUp` branch, `finishPickup()`) IS the win --
  `completePickup()` (`lib/game/outcome.ts`) sets `won` directly, not
  `carrying`. There is no carry-home leg to walk anymore.
- **Dead code, kept on purpose (`LUL-2281` Decision 2, wiki
  `decisions/lul-2281-pickup-is-the-win-2026-09-09`):** the old carry-the-
  child-home leg -- `carrying`/`setDown`/`arriveHome()`/`canArriveHome()`, and
  the walking-speed multiplier `CONFIG.carryPaceMul` (0.72) applied while
  carrying (`tick()`) -- is unreachable in real play now that `completePickup()`
  never sets `carrying` true, but was left in place rather than ripped out for
  a critical/ASAP fix. A follow-up cleanup ticket removes it.
- Leave a scent trail while moving (not while hidden or standing still) —
  `depositScent()`, deposited every `SCENT_DEPOSIT_INTERVAL` (0.3s). LUL-1724:
  moving against the wind (`isMovingAgainstWind()` in `lib/game/scent.ts`, dot
  product of movement heading and wind unit vector < 0) shrinks the deposited
  point's radius by `WIND_AGAINST_RADIUS_MULTIPLIER` (0.8, i.e. -20%) at
  deposit time only — detection math (`isScentDetected`, drift) is unchanged.
  Wind direction is shown to the player via `#windIndicator` (see HUD section).
- **As of `LUL-2230`**, the scent trail itself is rendered, not just implied by
  the wind arrow: a `THREE.Points` cloud (`scentTrailPts`) drawn every frame
  from the live `scentPoints` array, one mote per point, at its
  `driftedScentPosition()` — the same drifted position a predator's
  `checkScent()` actually queries, so the picture never shows the trail
  somewhere safer than it really is. Alpha fades linearly to 0 over the same
  `SCENT_LIFETIME` (14s) the array itself decays on, scaled by the point's
  radius (`SCENT_RADIUS_RUN` motes render brighter than `SCENT_RADIUS_WALK`
  ones) and dimmed ×0.3 at full mist veil — **presentation only**: the veil
  has zero effect on scent detection (see the Follow-light section's
  `p.spec.scent is untouched` note), this only makes the motes harder to see
  in the fog you've chosen to stand in. Toggle: "Show my scent trail" in
  Settings (`scentTrailVisible`, engine-owned, default on, persisted). A
  one-time caption ("this is your scent trail — predators follow it")
  appears the first time an install's player turns to see a mote on screen,
  gone within 8s or the first `scent_lock` chronicle event, persisted via
  `lullwood:scentTrailCaptionSeen` so it never shows again.
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
  (pickup: `distBaby<3.6`; death: `dist<p.rad+1.3`). **As of `LUL-2281`**, win
  is no longer a distance threshold at all -- it fires off the pickup
  cinematic's own clock (`e>=11.3` in `tick()`'s `pickingUp` branch,
  `finishPickup()`), not arrival at `CONFIG.home` (`dh<CONFIG.home.r`,
  `canArriveHome()`, now dead code -- see above).
- Cannot outrun any predator in a straight line — every species' tuned speed
  exceeds the player's (see Predator section); hiding/cover is the actual
  counterplay, not speed.
- Cannot move while `pickingUp` (the ~11.3s cinematic) or while `dead`/`won`.

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
  an ~0.3s time constant (`Math.min(1, dt*8)`, L2272), not snapped. **Fixed,
  LUL-273:** `canopyBlockedR()`/`blocked()` now recompute each tree's canopy
  radius live against this same `eyeH` (`canopyRadiusAtEye(t.s, eyeH,
  CANOPY_GEO)`) instead of the `crCanopy` cached at map-gen time for a fixed
  `CONFIG.eye` — the cached value under-protected for the ~0.3s window right
  after exiting a hide spot while moving, since the cone tapers and a lower
  eye height sits closer to its wider base. See wiki
  `game/lul267-canopy-collision-fix`.
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
- **As of `LUL-1815`**, be set back down mid-carry (`setDown()`) and picked
  back up from where she was left (`pickupAllowed()`'s `babyTaken` guard is
  relaxed by a `setDown` flag in `lib/game/outcome.ts`) — see "cannot do"
  below for the exact boundary.
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
- **As of `LUL-1486`**, the `fogTideAmount` fed into `fogTideGlowMul`/
  `fogTideGlowRangeMul` above is no longer the whole-world constant — it's
  `fogTideAmountAt(x, z, fogTideAmount, ...)` (`lib/game/fogTide.ts`), a
  proximity blend against a fixed set of `FOG_TIDE_SITES`. Sampled at the
  player's position while carried (colocated with the child) or the child's
  own idle spawn position otherwise; a child outside every site's radius
  sees no tide glow boost regardless of the global clock's phase.
- **As of `LUL-1480`** (rules `LUL-1438`/`LUL-1414`), the unscaled idle/carry
  glow and halo curves live in `lib/game/childGlow.ts` (pure, unit tested),
  not inline in `tick()`: `idleGlowIntensity()`/`idleHaloOpacity()` for the
  outbound leg and `carryGlowIntensity()`/`carryHaloOpacity()` for carry,
  handing off at `PICKUP_GLOW_PEAK` at the end of the pickup cinematic. The
  fix makes the carry leg strictly brighter and faster-pulsing than idle at
  every instant (`CARRY_GLOW_BASE=2.6` vs `IDLE_GLOW_BASE=1.0`, `CARRY_GLOW_
  FREQ=3.2` vs `IDLE_GLOW_FREQ=1.8`) — previously the pickup cinematic
  flared to 3.2 and then carry settled back down to ~1.2, barely above idle,
  the same frame `CARRY_DETECT_MUL` (`lib/game/cover.ts`) raises predator
  sight-detect by 35%. The difficulty preset's `glowMul` and
  `fogTideGlowMul()` still apply on top of these curves exactly as before;
  the pulse **rate** (not just brightness) is what's carry-only and
  unspoofable by either multiplier.

**What it CANNOT do**
- Cannot move on its own, ever, outside the two scripted transitions above —
  there is no idle wander, no reaction to nearby predators, no flee behavior.
- Cannot be found or interacted with by anything except the player — no
  predator state, roam waypoint, or detection check ever reads `baby.x/z`
  at runtime (only at **spawn time**, to keep predators from spawning on top
  of it — `Math.hypot(x-baby.x,z-baby.z)<26` in `placePredators()`).
  Once the map is generated, a predator can stand directly on the
  un-collected child with zero effect. `UNDEFINED` — see matrix.
- Cannot be lost or re-hidden once picked up — `baby.taken` only ever goes
  false→true, reset by `generateMap()`/`restart()`. **As of `LUL-1815`**, she
  *can* be set back down while carried (`setDown()`, same `KeyE`/touch-interact
  input as pickup — no new key) — this returns her to a fixed point on the
  ground (glowing, idle-animated, re-spottable via the beacon wisps) and the
  player to full speed/no carry-detect penalty until she's picked up again
  from that spot. `carrying` itself does still round-trip true→false→true;
  only `baby.taken` is one-way.
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
  (`state==='roam'`, L1010-1019). A predator that gives up an
  investigate/sniff or flank/hold loop (never a chase's distance-based
  give-up) stashes the player's position and gets a bounded number of
  ring-biased return-sweep waypoints (`LKP_MAX_SWEEPS`, `pickRoamWaypoint()`,
  `lib/game/predator.ts`) before it truly forgets and reverts to the
  original uniform-random pick -- a predator that camping used to shake for
  good now circles back a few times first (LUL-1573/LUL-1620).
- A `chase`'s distance-based give-up (`shouldGiveUpChase()`,
  `lib/game/predator.ts`) now compares against `effectiveDetect(p)` instead
  of the raw `PSPEC[kind].detect`, so the give-up radius scales with the
  same multipliers that widen acquisition -- difficulty, veil, fog tide, and
  `CARRY_DETECT_MUL` (1.35x while carrying). Before this fix a wolf/lion
  chase begun during the carry leg could never end, since the give-up
  distance didn't grow with the carry's wider acquisition range (LUL-1600).
- Detect the player through three independent channels: **sight**
  (`canSee()`, LOS raycast + shrinking-with-stillness range),
  **scent** (`checkScent()`, radius+wind, no LOS check at all),
  and **noise** (`checkNoise()`, pure distance + per-second chance while the
  player moves). Any one channel alone triggers a chase. Noise acquisition
  now fires a distinct `leafRustle()` cue + caption ("wolf heard you · near ·
  behind") so the player knows *which* channel caught them; callTimer is also
  initialised on noise-catch so the first roar in the following chase is
  correctly delayed (LUL-1610).
- **Carrying the child only:** sight acquisition no longer locks into a chase
  on the same frame `canSee()` turns true. A `SIGHT_TELL_TIME` (0.35s,
  `lib/game/sightLock.ts`) freeze-and-face-the-player tell plays first,
  reusing the existing alert rear-up animation; break line of sight or leave
  range before it elapses and the tell cancels with no roar, no flash, no
  state change (LUL-1482). Scent and noise acquisition are unaffected in
  every state, carrying or not.
- Chase, losing/regaining track via `investigate`→`sniff`→`back` (LUL-22,
  explicitly "not to be retuned"). LUL-1090: when the `approach` sub-phase
  reaches sniff range (`hasReachedSniffRange()`, `rad+SNIFF_APPROACH_MARGIN`
  ≈2.5-3.2 units) **while the player is `hidden`**, the predator first walks
  itself back to `SNIFF_STANDOFF` (4.5 units, `lib/game/predator.ts`
  `sniffStandoffPoint()`) via a new `standoff` sub-phase before entering
  `sniff` — a player caught in the open is unaffected and closes to the old
  distance as before. The "Hidden · something is sniffing you" status line
  (`tick()`) uses a separate, wider `SNIFF_STATUS_RANGE` (8 units, declared
  next to `SNIFF_STANDOFF` so the two can't drift apart) so the warning still
  reads once the predator has settled at its standoff distance.
- Force-hunt: if nothing has been within 20 units of the player for 30s, the
  nearest predator switches straight to `hunt` and comes for you at full
  speed. LUL-2246: losing sight while `hunt` is active now sets a 25s
  `FORCE_HUNT_LOCK` (`engine/tuning.js`) and routes into the same blind-chase
  leash a scent pickup uses (`scentLock`, LUL-23), instead of collapsing to
  the slower `investigate`/`approach` sub-phase — the escalation is now
  actually relentless, not just labeled that way. `tick()`.
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
  `CHARGE_COOLDOWN`=10s, `engine/tuning.js`) and the resulting movement.
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
- Block movement for **both player and predators** (`coverBlockedR()` for
  the player via `blocked()`, `blockedForPredator()` for predators —
  **LUL-1643**, rotated AABB).
- Block LOS for both player and predators (`hasLOS()`).
- Render as one of three cover-prop kinds (`DodecahedronGeometry`, L251),
  ~35% of the 220 `COVER_PROPS` roll (`roll < 0.75 && roll >= 0.4`,
  `generateCover()`).

**What it CANNOT do**
- Cannot be a hiding spot — not in `HIDE_KINDS`. Ducking behind a rock
  blocks sight but never enables `hidden`.
- Not guaranteed clear of tree trunks at placement (see matrix).

**Behaviours & logic**
- `hx=r, hz=r*(0.7+rng()*0.5)`, `r=0.9+rng()*0.9`, random rotation `ry`
  (`generateCover()`).

**Collision & physics profile**
- Rotated-AABB collider for both actors (half-extents `hx,hz`, rotation
  `ry`) — `blocked()` (player) and `blockedForPredator()` (predator,
  **LUL-1643**) both route through the same `coverBlockedR()`.
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
  `coverKindBlocksMovement('log')` is `false` (`lib/game/cover.ts`),
  so `coverBlockedR()` no longer blocks the player here. The always-on jump
  (LUL-213) already worked everywhere, including on/over a log; this just
  means you're no longer stopped at its edge in the first place.

**What it CANNOT do**
- Movement-blocking exemption, originally player-only for Log (LUL-384) —
  **as of LUL-1642, Bramble shares it too** (see Bramble section below).
  Log and Bramble are now the two cover kinds that block neither actor's
  movement; Rock and Reed remain solid to both actors — as of **LUL-1643**,
  that includes predators too, not just the player (see matrix note ²³).
- Guaranteed clear of tree **trunks** at placement, same as every cover kind
  (see matrix) — and, like Bramble as of LUL-1642, also guaranteed clear of
  tree **canopies** (`overlapsTreeCanopy()`, `lib/game/cover.ts`, LUL-491):
  since a log invites the player to walk its full span and
  `canopyBlockedR()` blocks unconditionally within a tree's canopy radius
  regardless of what cover prop sits there, `generateCover()` rejects a log
  candidate whose footprint overlaps a nearby canopy circle even when it
  clears the trunk circle. Rock/Reed don't get this extra check — solid
  either way, so a canopy-only overlap there changes nothing observable.
- **LUL-2212: as of this ticket, also guaranteed clear of every other
  already-placed cover prop** (`overlapsExistingCover()`, `lib/game/cover.ts`)
  — `generateCover()`'s candidate loop previously checked new props only
  against trees, so a solid prop (Rock/Reed) could spawn overlapping a Log's
  footprint; the Log itself stayed walkable but the overlapping solid
  neighbour's own AABB still blocked the player mid-span, an invisible wall
  on a prop that's supposed to be fully walkable end to end. `generateReeds()`
  (a separate placement loop, runs after `generateCover()`) had no overlap
  check at all before LUL-2212 and now gets the same `overlapsExistingCover()`
  guard. **LUL-2215: bog-tree canopy gap, fixed.** `generateCover()`'s canopy
  check runs before `generateBogTrees()` populates bog trees, so a Log/Bramble
  candidate could end up under a *bog* tree's canopy undetected (bog trees
  don't exist in the tree grid yet at that point) — reproduced on the
  QA-pinned seed in `e2e/lul211-founder-report.spec.ts`'s `log`/walkable-cover
  case. Fixed with a post-hoc filter in `generateMap()`, right after
  `generateBogTrees()` runs: any surviving `coverData` entry of a walkable
  kind (`!coverKindBlocksMovement()`) that overlaps a bog tree's canopy
  (`overlapsTreeCanopy()` against `bogTreeData`) is dropped. Filtering the
  finished array, not reordering generation or rejecting inside
  `generateCover()`'s loop, keeps every existing rng() draw — tree, baby,
  predator, and `generateCover()`'s own stream — byte-identical for every
  seed; same precedent as the LUL-2225 bog-keep-clear filter earlier in
  `generateCover()`.

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
- **LUL-1642: the player walks and runs over it too, same as Log** —
  `coverKindBlocksMovement('bramble')` is now `false`
  (`lib/game/cover.ts`), so `coverBlockedR()` no longer stops the player
  here either. Previously Bramble alone among `HIDE_KINDS` stayed solid,
  which meant a player entering `hidden` at a bramble was collision-stopped
  at its (small, roughly circular) AABB edge rather than standing inside it
  the way a Log hider could — `hasLOS()` reads the player's actual world
  position against that AABB regardless of the `hidden` flag, so an
  edge-standing bramble hider could sit in a predator's clean sightline a
  log hider's on-footprint position never exposed. That read in play as
  "sniffing broke — the animal found me while I was still hiding," reported
  as LUL-1642 (Bramble, unlike Log, is not fixed to matching a real "step
  over it" affordance — this is a deliberate deviation from LUL-384's
  original walkable-vs-solid distinction, made to unify the two `HIDE_KINDS`
  behind one detection path per the ticket's explicit ask, not an
  independent design call).

**What it CANNOT do**
- Same as Log: no predator movement collision (never had one); as of
  LUL-1642, no player movement collision either. Not guaranteed clear of
  tree trunks at placement (same as every cover kind), but — also as of
  LUL-1642, matching Log — now guaranteed clear of tree **canopies** too
  (`overlapsTreeCanopy()`, since it reads `coverKindBlocksMovement()`
  directly and now includes bramble). As of **LUL-2212**, also guaranteed
  clear of every other already-placed cover prop (`overlapsExistingCover()`)
  — see the Log section above for the bug this fixed and the one known
  remaining gap (bog-tree canopies).

**Behaviours & logic**
- `r = 0.8+rng()*0.7`, `hx=hz=r` (roughly round footprint,
  `generateCover()`).

**Collision & physics profile**
- LOS-blocking for both actors, same as Log/Rock (`hasLOS()`, unchanged).
- **No movement collision for either actor** (LUL-1642 matched Log's
  LUL-384 exemption; predators never had one). `findHideSpot()`-eligible,
  unaffected — that function reads `coverGrid` directly and never calls
  `coverBlockedR()`.

---

### Throwable (stone/twig) — LUL-1623

**What it can do**
- Grab: `E`/Interact, desktop and mobile, context-dispatched on the same key
  as child pickup (`canPickup` takes priority; `grabThrowable()`,
  `triggerTouchInteract()`) — no separate grab button on either platform.
- Throw: left-click desktop (`mousedown`, only while pointer-locked and not
  dragging/paused) / a dedicated "Throw" button on mobile
  (`triggerTouchThrow()`, `EngineActions`), both call `throwThrowable()`.
  Lands at `player pos + facing * THROWABLE_THROW_DISTANCE` (18u); the same
  landing-point formula on both platforms, so throw behavior doesn't diverge
  by input method.
- On landing, plays a percussive thud (`leafRustle(false)`, player-audible)
  and rolls `checkThrowableNoise()` (`lib/game/noise.ts`) against every
  non-inert predator's distance to the landing point. Any predator within
  `THROWABLE_NOISE_RADIUS` (24u, = `NOISE_RADIUS_RUN`) is redirected into
  `investigate`/`approach` **targeting the landing point**, not the live
  player, for a randomized 3–5s (`hearThrowableNoise()`) before reverting via
  the existing sniff/back/roam loop.
- Usable in any playable state, including while carrying the child (CTO plan
  decision 6) — grab/throw have no `carrying` gate.

**What it CANNOT do**
- Not a hiding spot, not LOS-blocking, not a movement collider for either
  actor — deliberately not `coverData`/`HIDE_KINDS` (CTO plan decision 3).
  Own spawn list (`throwableData`) and own `InstancedMesh`, independent of
  the cover-prop system above.
- Cannot be held two at once (`canGrabThrowable()`/`canThrowThrowable()`,
  `lib/game/outcome.ts` — one `heldThrowable` boolean, not a stack).
- Does not change `hearNoise()`/`isNoiseHeard()`/`checkNoise()` — those stay
  exactly as before; a throw is an additive, parallel noise source.
- No projectile arc / travel animation for v1 — landing is instant/computed,
  not a simulated flight (Scout proposal's "cheap version"; a visible arc is
  a possible follow-up).
- No economy cost, cooldown, or respawn for v1 (Economist territory, later).

**Behaviours & logic**
- 90 fixed spawn points per map (`THROWABLE_COUNT`, LUL-1839 — up from the
  Scout MVP's 10, ~1 stone found per run at an 8u acquisition radius, wiki
  `game/economy/throwable-price`), rejection-sampled at
  `generateMap()` time clear of tree trunks, home/spawn (12u), and each other
  (6u) — `generateThrowables()`. Picked-up stones are hidden (parked
  off-map, not removed from the array) via `layoutThrowableMeshes()`.
- Predator targeting override is confined to the `approach` sub-phase only:
  `updatePredators()`'s live-player `ux/uz/dist` are untouched for every
  other consumer (`canSee()`, `hunt`, `chase`, roam's investigate-entry
  check); only the local `approach`-branch target redirects to
  `p.noiseTarget` while it's set. No new `p.state`/`p.inv` value — this is a
  **deliberate, declared deviation from the CTO PLAN's literal "reuse
  hearNoise() unchanged"** (spec §4.6): wiring a throw through `hearNoise()`
  unmodified would have made the predator walk toward the live player, not
  the landing spot, defeating the mechanic.
- `shouldRevertInvestigateToChase()` (`lib/game/predator.ts`) is untouched —
  hiding during the investigate window still works exactly like a normal
  noise-hear; only the physical approach target differs while a decoy noise
  is active.

**Collision & physics profile**
- No collider of any kind (neither actor). Detection-only: a one-shot
  distance check on landing, not a per-frame roll like footstep noise.

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
- Slow predators too, the same way: `updatePredators()` samples
  `lakeSpeedMultiplier(inLakeWater(p.x, p.z, CONFIG.lake))` (and the bog's
  equivalent) per predator per tick and folds it into every roam/hunt/chase/
  investigate/flank speed — a predator that wades in pays the same cost the
  player does. The `charge` dash is explicitly exempt (LUL-1309).
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
- Drawn on the minimap as a warm stroked ring only, not a filled disc, so it
  reads distinctly from the lake/bog fills (`drawMinimapStatic()`, LUL-2248) —
  a fixed 4px minimap radius, since `CONFIG.home.r` is a gameplay proximity
  radius, not a visual size.

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
- **As of `LUL-1486`**, the `fogTideAmount` above is sampled at the player's
  own position via `fogTideAmountAt(player.x, player.z, fogTideAmount, ...)`
  (`lib/game/fogTide.ts`) rather than being a whole-world constant — the fog
  boost applies only within a fixed set of Fog Tide sites (`FOG_TIDE_SITES`),
  not globally; standing outside every site's radius adds no boost
  regardless of the global clock's phase.
- **As of `LUL-1709`**, an additive `timeOfRun * TIME_OF_RUN_FOG_DELTA` term
  (`TIME_OF_RUN_FOG_DELTA = 0.10 - CONFIG.fog`) on top of the veil/tide terms
  above, driven by `timeOfRun` — a live 0→1 pacing clock that rises over
  `TIME_OF_RUN_DURATION_S` (120s) of actual play (pauses with everything else,
  resets to 0 in `enter()`). Distinct from `LUL-1644`'s `TOD_VISUAL`/`TOD_AUDIO`
  (a static snapshot of the player's real wall-clock hour, computed once at
  load) — this is a live value that changes every frame during a run; the two
  compose, not replace. Same term also ramps the scene's `HemisphereLight`
  intensity down (`HEMI_BASE_INTENSITY * (1 - timeOfRun * 0.7)`) and is
  surfaced to the HUD as a plain-text clock (`#timeOfRunClock`,
  `formatTimeOfRunClock()`, dawn 6:00 AM at `timeOfRun=0` to 9:00 PM at
  `timeOfRun=1`).

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

### Time of day

**What it can do**
- Set the sky gradient, fog color, hemisphere/directional-light color and
  intensity, sun/moon disc color, and star-field opacity for the whole session,
  based on the player's real wall-clock hour at load
  (`timeOfDayFromHour()`, `lib/game/timeOfDay.ts`; applied once in
  `engine/forest-engine.js` before scene setup — see `docs/specs/time-of-day.md`).
- Set a per-state ambient audio profile in `startAudio()`: duck or restore the
  existing wind/drone beds, and add bird-chirp and insect layers for
  early-morning through evening states.
- Six states: `night`, `early-morning`, `morning`, `noon`, `afternoon`,
  `evening` — see `TIME_OF_DAY_VISUALS`/`TIME_OF_DAY_AUDIO` for exact values.

**What it CANNOT do**
- Does not change at all during a single play session — computed once at load
  from the real clock, not a live in-game cycle (unlike Fog Tide, below/above,
  which does tick during play).
- Has zero effect on predator detection, hiding, scent, or difficulty — purely
  atmospheric. `effectiveDetect()`/`DIFFICULTY_PRESETS` are untouched by this
  system.
- Does not add a flying-bird visual/mesh — audio only for birds; no new
  geometry.

**Behaviours & logic**
- Pure hour->state mapping and both config tables live in `lib/game/timeOfDay.ts`
  (unit tested, `lib/game/timeOfDay.test.ts`) with no wall-clock read inside
  that module — the engine reads `new Date().getHours()` at exactly one call
  site and passes the result in.

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
- **As of `LUL-1486`** (D2, ruled `LUL-1489`), the `fogTideAmount` fed into
  `fogTideDetectMul` above is sampled at **the predator's own position**
  (`fogTideAmountAt(p.x, p.z, fogTideAmount, ...)`, `lib/game/fogTide.ts`),
  not the player's — a predator standing outside every `FOG_TIDE_SITES`
  radius is not blinded by a tide it isn't standing in, even if the player
  is inside one.
- **As of `LUL-1709`/`LUL-1714`**, `timeOfRunDetectMul(timeOfRun)`
  (`lib/game/dayNight.ts`, unit tested — see `lib/game/dayNight.test.ts`,
  same pure-module split as `veilDetectMul()`/`fogTideDetectMul()`) — up to a
  30% (`TIME_OF_RUN_DETECT_MUL`) sight-range *increase* by full night —
  stacks in the same product in both `effectiveDetect()` and `canSee()`.
  Unlike the veil/tide terms above (which all cut range), this one only
  grows predator sight as the run's `timeOfRun` pacing clock advances (see
  Fog above); it composes multiplicatively with, and does not replace,
  `DIFFICULTY_PRESETS[difficulty].detectMul`. Deliberate, not a double-count
  bug: a spent resource (the veil, gated by its charge meter above) and a
  free recurring world event compounding is fine. Sight-only, same scope as
  the veil — `p.spec.scent` is untouched, so a predator can still
  scent-lock the player straight through a tide.
  Signposted ~10s ahead of the active window: the raw telegraph signal eases
  into `fogTideDroneGainMul(fogTideBuild)`, raising the ambient drone gain,
  while `fogTideWindGainMul(fogTideAmount)` ducks the wind bed by up to
  `FOG_TIDE_WIND_DUCK` (0.7) once the tide is active — audio eases over
  `FOG_TIDE_AUDIO_RAMP` (2s), faster than the world-effect ramp above so the
  cue reads as responsive. Only applied to this calm-bed audio mix — a
  chase already wins the audio outright, so the tide never fights the hunt
  cue.
- **As of `LUL-1486`**, both `fogTideBuild`/`fogTideAmount` above are sampled
  at **the player's position** (`fogTideBuildAt`/`fogTideAmountAt(player.x,
  player.z, ...)`, `lib/game/fogTide.ts`) rather than being whole-world
  constants — the camera and the listener are the player, so this is the
  same physical-coherence rule D2 established for predators, applied to the
  scene-fog/audio observer. Standing outside every `FOG_TIDE_SITES` radius
  mutes the drone/wind-duck effect regardless of the global clock's phase.

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
  `#spotFlash`, `#bearingPulse`, `#flash`, `#minimap` (canvas, drawn every frame by
  `drawMinimap()`/`drawMinimapStatic()`), `#hint`, `#pausePrompt`,
  `#deathVideo`.
- **React-owned** (`components/Hud.tsx`), driven one-directionally by
  `hudState`/`pushState()`/`emitState()`: objective text,
  hiding status, win/death screens, charge-dodge prompt, the contextual
  hide/veil prompt (LUL-1089), the post-run recap
  (`#runRecap`). **Not** difficulty/accessibility controls or captions —
  those were built on the unmerged LUL-26 branch; see the Player section's
  note. There is no separate modal settings surface on `main` today
  (engine's own comment, L1692-1693: "LUL-70, still backlog").
  LUL-2312 pulled every one of those bottom-centre prompts (`#objective`,
  `#actionPrompt`, `#throwPrompt`, `#chargePrompt`, `#status`) plus
  `#captionToast` into one component, `ActionPrompt` (`components/
  ActionPrompt.tsx`), rendered as five always-mounted rows inside a single
  fixed CSS-grid column, `#actionSlot` (`components/GameCanvas.tsx`). Each
  `EngineHudState` field named below still means exactly what it did before
  -- this was a render-layer consolidation only, no engine change. The old
  element ids survive as `id`/`data-testid` on each row (e2e continuity); the
  per-element CSS rules and their five independent bottom-offset magic
  numbers (74/92/110/130px, plus `#objective`'s separate `top:20px`) did not.

  | slot row (priority, top to bottom) | `EngineHudState` fields | `id` |
  |---|---|---|
  | charge dodge | `chargeVisible`, `chargeToken` | `#chargePrompt` |
  | objective (E) | `objectiveVisible`, `objectiveText`, `objectiveReady` | `#objective` |
  | hide or veil | `coverPromptVisible/Urgent/Kind`, `veilPromptVisible/Urgent` | `#actionPrompt` |
  | throwable | `heldThrowable` | `#throwPrompt` |
  | status (hidden/hunted) | `statusVisible`, `statusText` | `#status` |

  `#captionToast` (predator-call captions) reuses the same component,
  positioned as its own row just above `#actionSlot` rather than as a sixth
  slot row, since it isn't part of the E/H/F/SPACE priority stack. It moved
  off its old dedicated amber colour onto the shared `tone="status"` look
  (same as the hidden/hunted row) -- a declared visual change, not a silent
  one. `#caveImmunePanel`/`#hint` stayed top-side and out of scope (the
  ticket's own "may", not "must").

  **## e2e (LUL-2312).** `e2e/action-prompt.spec.ts` rewritten: every
  `.toHaveClass(/urgent/)` became `toHaveAttribute('data-tone', 'urgent')`,
  `#actionKey` became `.actionPromptKey` scoped under the row, and a new
  `#actionSlot row order` describe block pins the five ids' DOM order
  (`chargePrompt, objective, actionPrompt, throwPrompt, status`) independent
  of any gameplay staging. `e2e/helpers.ts` gained `expectRowVisible`/
  `expectRowHidden` (assert `data-visible` rather than mount/unmount) --
  every other spec that asserted `toHaveCount(0)` or `toBeVisible()`/
  `toBeHidden()` on `#objective`/`#status`/`#actionPrompt`/`#throwPrompt`/
  `#chargePrompt` now uses one of those two instead, since none of the five
  ever unmounts any more: `hide.spec.ts`, `death-persist.spec.ts`,
  `smoke.spec.ts`, `throwable-mission-hud.spec.ts` (+ its `mobile/` half),
  `throwables.spec.ts` (+ `mobile/`), `win-persist.spec.ts`,
  `lul211-founder-report.spec.ts`, `predator-memory.spec.ts`,
  `charge-dodge.spec.ts`, `mobile/charge-prompt-tap.spec.ts`. `scent-trail.
  spec.ts`'s `assertNoOverlap` helper also treats a zero-area box as nothing
  to overlap, since an empty row's content collapses to zero width rather
  than disappearing from the DOM. Not done in this PR (no existing QA hook
  supports it): a single scenario with all five rows populated at once to
  assert pairwise non-overlap directly -- today's coverage exercises at most
  one populated row per test. Flagged as a `[QA-HOOK]` follow-up, not silently
  skipped.
  LUL-1089 adds five new `EngineHudState` fields: `coverPromptVisible`,
  `coverPromptUrgent`, `coverPromptKind` (`'bramble'|'log'|null`),
  `veilPromptVisible`, `veilPromptUrgent`. Cover prompt fires only while
  `!hidden` and within `COVER_URGENT_RANGE` of a chasing predator for urgent.
  Veil prompt fires only when cover is not available (cover wins, never both).
  The cover probe is throttled to `COVER_PROBE_HZ` (6Hz); `lastHideSpot`
  holds the result between probes. Both prompt flags reset at every
  `hidden=false` reset site (pickup, death, restart).
  LUL-1724 adds `#windIndicator`, a fixed top-right arrow rendered from two new
  read-only `EngineHudState` fields (`windX`/`windZ`), pushed once per map
  generation (not per-frame) — the only HUD element driven by map-constant
  rather than per-frame or per-event engine state. LUL-1912 repositioned it to
  `top:184px; right:16px` to clear `#minimap`'s own box (`top:16px; right:16px;
  160x160`, which read as a child-position pointer), and added
  `#windIndicatorHint`, a static label below the arrow — no new engine state.
  LUL-2224 removed the original 7s CSS fade-out (`windHintFade`, which mirrored
  the existing `#hint` movement-controls pattern): the founder found players
  lost the explanation a few seconds into a run and never got it back, so the
  hint is now always visible for the whole run (same mount gating as before).
  LUL-1933 found that push
  unconditional, so it followed every real player (`#minimap` is
  `display:none` under `data-admin-mode="0"`, see above) and collided with
  `MobileControls.tsx`'s bottom-anchored Hide/Veil column on short landscape
  phones. `top:184px; right:16px`/`#windIndicatorHint`'s `top:214px` now apply
  only under `body[data-admin-mode="1"]`; the default (real player) position
  reverts to LUL-1724's original `top:20px; right:20px` (`#windIndicatorHint`
  `top:50px; right:8px`), verified clear of `MobileControls` at every tested
  viewport. LUL-2057 found the arrow's own ~54px rendered box (28px font,
  ~1.2 line-height) still overlapped the hint's first line at that 30px gap;
  `#windIndicatorHint`'s `top` moved to `64px` (default) / `228px`
  (`data-admin-mode="1"`), a 14px increase in both, to clear it.
  LUL-2131: `#windIndicator`/`#windIndicatorHint` (and `#throwPrompt`, `#actionPrompt`,
  `#captionToast`, all `components/Hud.tsx`) now also gate on `!state.winVisible &&
  !state.deathVisible` -- `state.entered` alone stays true through both end screens
  (`restart()` is the only site that clears it), so these kept rendering at their
  own z-indices (12/z-auto) over `#winScreen`/`#deathScreen` (z-index 25,
  `components/GameCanvas.tsx`). Same root cause hit `MobileControls.tsx`, which now
  unmounts entirely (`return null`) on `winVisible || deathVisible` -- its
  sticks/buttons sit at z-index 30/31, genuinely above the end screens, not just
  behind them at a lower z-index -- and `GameMenu.tsx`'s `#gameMenu` (hamburger +
  panel, z-index 20), which does the same. `#chargePrompt` needed no HUD-layer
  gate at the time: the engine already resets `chargeVisible: false` in both
  `arriveHome()` and `triggerDeath()` (`engine/forest-engine.js`). LUL-2312
  added the same `!winVisible && !deathVisible` gate to `#chargePrompt` and
  `#objective`/`#status` anyway, once all five moved into one component --
  redundant with the engine-side reset for the one-frame gap between
  `triggerDeath()`/`arriveHome()` running and the *next* `tick()` actually
  clearing the flag, but consistent across all five rows rather than three.
  LUL-2231: LUL-2131's `MobileControls.tsx` unmount left two gaps. First, its
  sticks/buttons (z-index 30/31) were never gated on `GameMenu.tsx`'s own open
  `.menuPanel` (z-index 21) -- nothing in that pairing unmounts for the other, so
  the E/Jump/Hide/Veil buttons and both `Stick`s sat on top of "Sound: on"/
  "Settings..." and ate their taps. `GameMenu.tsx` now reports its `open` state up
  via an `onOpenChange` callback (`useEffect` on `open`); `Hud.tsx` holds that in
  `menuOpen` state and passes it to `MobileControls`, whose early-return became
  `if (winVisible || deathVisible || menuOpen) return null`. Second, both `Stick`s
  rendered unconditionally -- only the button rows above them were gated on
  `entered` -- so they also sat over the pre-entry gate screen's instructions;
  both are now wrapped in `{entered && (...)}` to match.
  LUL-2158: `#hint` (engine-owned, see above) is *not* reset by `triggerDeath()`/
  `arriveHome()` either, and can't be gated in React like the elements above since
  it isn't React state — its opacity is a plain `enter()`-owned 5s fade timer
  (`forest-engine.js`), and a fast second death (restart → enter() re-arms the
  timer → death again before it clears) can land `#deathScreen`/`#winScreen` while
  it's still visibly fading in. `#deathText` has no opaque backdrop of its own
  (unlike `#winText`'s gradient), so the hint's text visibly overlapped "YOU LOSE".
  Fixed purely in CSS (`components/GameCanvas.tsx`'s `OVERLAY_STYLE`): `body:has(#winScreen)
  #hint, body:has(#deathScreen) #hint { opacity: 0 !important; transition: none !important; }`
  — reacts to whichever end screen is actually mounted with no engine change, and
  drops the transition so the hint can't still be fading (and overlapping) for up
  to 1.4s after the screen mounts.
  LUL-1103 adds `#runChronicle`, a `<ul>` inside `RunRecap()` (`components/Hud.tsx`)
  below the existing time/payout line: a short chronological log of the run
  ("0:41 — a wolf caught your scent near the Leaning Stone.") instead of only
  a stat dump. Engine-owned: `logChronicle(code, args)` in
  `engine/forest-engine.js` appends a flat `{t, code, args}` entry at each of
  ~8 call sites (`scentOnto()`, the three chase/investigate/flank give-up
  transitions, `enterHide()`, `finishPickup()`, `arriveHome()`,
  `triggerDeath()`, the fog-tide start/end branch) into a run-local `chronicle`
  buffer, reset in `enter()`. The buffer is handed to React exactly once, in
  the same `pushState()` call as `winVisible`/`deathVisible` — **not** streamed
  live, because `pushState`'s shallow `!==` compare would treat a fresh array
  as "changed" every frame if this were logged per-frame (see that function's
  own comment). `lib/game/chronicle.ts` is the pure formatter (`formatChronicle()`,
  `nearestLandmarkName()`) — no DOM, no Three.js, unit-testable on its own; it
  also gives the four fixed navigational landmarks (`LANDMARKS` in
  `engine/tuning.ts`) their first player-facing names. `#winText`/`#deathText`
  both gained `max-height: calc(100dvh - 48px); overflow-y: auto` in the same
  PR so a long chronicle can't overflow a phone viewport silently.
  LUL-1194: the death screen copy names the *cause*, not the predator species
  — a new `deathCause: 'charge'|'hunt'|'chase'` field, set by `triggerDeath()`
  (three call sites in `updatePredators()`) and mapped to player-facing text
  by `DEATH_CAUSE_TEXT` in `components/Hud.tsx`. `deathKind` (species) still
  exists in state and DOM (`#deathKind`, now `display:none`) purely so the
  existing e2e specs that assert on it keep working — it is no longer
  rendered to the player. The death cutscene (`#deathVideo`, `CUT_END`=3.7s)
  stays full-length and unskippable on the player's first-ever death only
  (persisted via `localStorage['lullwood:hasDied']`, not per-page-load);
  every death after that, any keydown or pointerdown skips straight to
  `revealLoss()` (`skipCutsceneIfAllowed()`). Both end screens' restart
  button also gains a `ref`-based focus-on-reveal in `Hud.tsx` (not raw
  `autoFocus`, which would fire before the screen reveals and let a stray
  Enter bypass the unskippable first cutscene via native button activation),
  giving Enter/Space a keyboard path back into a new run for free.
  LUL-1614: that focus is delayed `RESTART_FOCUS_DELAY_MS`=2000ms past the
  `*Revealed` flip (sized past `#winText`'s own 0.9s fade), not immediate —
  an in-flight Space/Enter still held from active gameplay (Space also being
  the jump key) would otherwise activate the freshly-focused button the
  instant it gains focus, silently restarting the run before the player has
  read the outcome. A deliberate press after the delay still restarts.
  Follow-up in the same ticket: both restart buttons are now `disabled`
  until their screen's `*Revealed` flag is true. `#deathText`/`#winText`
  are `opacity:0` but `pointer-events:auto` while unrevealed
  (`components/GameCanvas.tsx`) — an un-disabled button there was a live,
  invisible hitbox that a stray click (or the focus-then-Enter path just
  added) could fire, restarting straight through the "unskippable" first
  death cutscene. `disabled` blocks both click and keyboard activation
  without a CSS change; the ref-focus effects already only fire on reveal,
  so this doesn't fight them.

LUL-1308 adds `#bearingPulse`, a screen-edge glow answering "which side is the nearest
approaching predator on" for players who can't rely on the caption toggle (LUL-26) or
the direction-free `#spotFlash`. Driven off the same `pianoTimer`-gated approach-cue
block that fires `pianoNote()` (`updatePredators`'s threat-metrics scan): every note,
`bearingOf(nearP, player, ...)` (`lib/game/bearing.ts`) resolves a side, and unless it's
`'ahead'` (the player's own view already covers that case) the engine sets
`bearingPulseSide`/`bearingPulseT` and the element's class/opacity follow. The same
`bearingOf()` call also feeds `pianoNote()`'s new `pan` argument (a single
`StereoPannerNode` per note, `lib/game/bearing.ts`'s `bearingPan()`), and
`predatorCall()`'s volume now falls off with distance (`callVolumeMul()`, same module,
folded in per the CEO's LUL-1282 addendum) instead of the old binary `big ? 1.0 : 0.6`.
Not present: any compass, minimap dot, or degrees readout — deliberately rejected in the
design doc as turning horror into radar.

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
  and synced to `hudState` via `setEmbers()` (in  `engine/forest-engine.js`). Earnable via `computeWinPayout()` /
  `computeDeathPayout()` in `lib/game/economy.ts`, applied via `applyPayout()`
  on win/death via `arriveHome()` / `triggerDeath()`. Both payout functions
  accept a `DifficultyTier` argument (`'lantern'`/`'night'`/`'blackout'`) that
  scales every `RunPayout` field (`depth`/`survival`/`carried`/`home`, each
  rounded individually) by a tier multiplier (LUL-1412, reconciled LUL-1640):
  lantern ×1.00/×1.00, night ×1.75 win/×1.35 loss, blackout ×2.00 win/×1.25
  loss. `total` is the sum of the already-rounded fields, so
  depth+survival+carried+home always equals total on every tier (`RunRecap` in
  `components/Hud.tsx` renders that sum). The engine passes `difficulty` at
  both call sites.
- `lastPayout`: breakdown of earnings from the run that just ended (null
  before first win/death this session), read by HUD on win/death screens to
  display what was earned. Matches `RunPayout` shape in `lib/game/economy.ts`.
- `win`/`loss` telemetry events (LUL-1450): `difficulty: Difficulty` field added to
  both `track()` call sites, now in `finishPickup()` (L4438, the live win path as
  of `LUL-2281` -- `arriveHome()`'s L4543 copy is unreachable, kept per Decision 2)
  and `triggerDeath()` (L4613). The `difficulty` module-level variable is in scope
  at both sites. The economy
  dashboard (`lib/dashboard/aggregate.ts`) groups these events by tier into
  `byDifficulty` on `EconomyResult`; events without a `difficulty` field land in
  `unattributed`.
- Deeper Lungs: unlock via shop button in post-run UI; one-time purchase per
  tier (tiers 0–3, `DEEPER_LUNGS_COSTS` array), persisted alongside balance as
  `tiers.deeperLungs`. Each tier increases the max veil (mist-dim) hold
  duration via `veilMaxHoldForTier()` in `lib/game/economy.ts`.
- `livePileEmbers` (LUL-1315): live, unbanked depth+survival total for the
  run in progress — `hudState` field (`engine/forest-engine.js` L3182),
  reset to 0 on `enter()` (L3274) and recomputed every frame (`stepFrame()`,
  called each `tick()` -- LUL-2071 extracted the per-frame body out of `tick()`
  so a QA test clock can call it directly) while the run
  is neither won nor dead (L4838: `computeDepth(maxDistFromHome) +
  computeSurvival(clock.elapsedTime - enteredAt)`, both pure helpers from
  `lib/game/economy.ts`). Rendered as `#embersPile` ("Unbanked: N") next to
  `#embersBalance` in `components/Hud.tsx` (L489), hidden once a win/death
  screen is showing. It previews what `computeWinPayout()`'s depth+survival
  terms will bank if the run ends now — it does not include the win-only
  `CARRIED`/`RESCUE` terms, since those only pay out on a live arrival.
- Death forfeiture display: `RunRecap`'s death branch
  (`components/Hud.tsx` L339-340) shows a red
  `-{CARRIED + RESCUE} lost (child & rescue, forfeited)` fragment instead of the
  win branch's `+carried`/`+rescue` lines, making explicit that the win-only
  `CARRIED`/`RESCUE` terms (both now exported from `lib/game/economy.ts` for
  this display) are forfeited on death rather than silently omitted.

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
- Audio cue (`staminaExertionCue()`): a short breath/exertion tone (~200Hz sine, 0.25s decay) plays once when stamina drops below 0.45 charge, and resets the cue as soon as stamina climbs back past 0.55 (hysteresis bands `0.45`/`0.55`, `staminaLowCuePlayed` flag). Also pushes a caption (`'breathing hard'`) when captions are on.

**What it can do**
- Gate the player's sprint speed (`stepFrame()` at L4924, LUL-2071's extracted per-frame body): `maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) * ...`, so the player still moves at walk pace when running with zero stamina, but gains speed as stamina refills.
- Play an audio telegraph when nearing zero charge, so the player knows they're nearly exhausted.
- Reset to full on each new run: `staminaCharge = 1` on `restart()` (alongside `staminaLowCuePlayed`).
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

### Missions (detour objectives)

**What it is**
- **Implemented (LUL-1259).** `MISSION_POOL` (`lib/game/mission.ts`): a pool of optional detour
  objectives, one active per run, drawn from the run's own seeded RNG (never player-selected).
  Today the pool has exactly one member, `deepwater` — a fixed waypoint at the drowned car
  landmark (`x: 55, z: 205`, matching `LANDMARKS`' `drownedCar` entry, `engine/tuning.js:44`).
  Per-run state (`mission: MissionState | null`) lives alongside `baby` at
  `engine/forest-engine.js:885`, drawn once per `generateMap()` call, after every other rng()
  consumer, so it never shifts the stream any existing seed/replay depends on.
- No verbs of its own — completion rides the existing interact action (`KeyE`
  (`engine/forest-engine.js:1689`) / `triggerTouchInteract()` (`:3635`), the same key/button
  that already lifts the child), gated on a `missionCanComplete` check computed alongside
  `canPickup` (`:3430`).

**What it can do**
- Add a completion bonus to the win payout only: `MISSION_DEEPWATER_REWARD = 12` Embers
  (`lib/game/economy.ts`), passed as `computeWinPayout()`'s new optional fourth argument at the
  `arriveHome()` call site. **Forfeited on death** — `computeDeathPayout()` is unmodified, so
  reaching the mission target but dying before reaching home banks none of the +12 (the detour's
  real payout is the `depth` term, already uncapped on win / capped on death; the mission bonus
  is a small addition on top, not the source of the risk/reward).
- Emit a repeating, non-predator-audible navigational audio cue (tempo-shortens with proximity,
  same shape as Ship 1's `childCry` wayfinding pattern) while the mission is active and the
  player is not carrying the child; silent once carrying.
- Fire a one-time unconditional caption + audio sting on completion, and show a two-line
  collapsed HUD panel (name + progress glyph) top-left whenever a mission exists and the player
  isn't carrying — mirrors the Embers/Stamina HUD-reflection pattern above, not a new panel
  system.

**What it CANNOT do**
- Cannot be selected or seen by the player before the draw — the pool member is chosen silently
  at run start from the same seeded stream as map/predator generation, not exposed as a choice.
- Cannot replace or gate the core objective — the child-distance/carry pill is unaffected; a
  mission is a detour, not a mode switch.
- Cannot bind a new key or a new `EngineActions` method — the sole new player-facing action
  (mission completion) reuses the existing interact button/key, so it needs no new touch target
  and has no mobile-unreachable action.
- Cannot pay out on death — the completion bonus is win-only, exactly like `CARRIED`/`RESCUE`.

**Secondary objectives (LUL-1666, Phase 1 — `deepwater` only)**
- **Implemented.** `MissionState.secondary: MissionSecondaryState | null` (`lib/game/mission.ts`)
  — an optional bonus layered on top of `deepwater`'s baseline, never a replacement for it.
  Drawn at `pickMission(rng, secondaryChoice)` time, where `secondaryChoice` is the player's
  pre-run menu pick (`components/GameMenu.tsx`'s `menuSecondary` control), gated on
  `SECONDARY_SUPPORTED_MISSIONS` (`deepwater` only today) and on the pool member actually drawn
  — the choice is a request, not a guarantee.
- Two kinds: `retrieval` (reach the existing `radioMast` landmark, see below, and press
  interact — completion is a one-time flag, does not require still holding/standing on it at
  arrive-home) and `speedrun` (arrive home within `MISSION_DEEPWATER_SPEEDRUN_SECONDS` = 240s of
  entering). Evaluated once, at `arriveHome()`, via `secondaryComplete()`.
- Pays an additive bonus on top of `MISSION_DEEPWATER_REWARD` at the moment of winning:
  `DEEPWATER_RETRIEVAL_BONUS` = 15 or `DEEPWATER_SPEEDRUN_BONUS` = 18 Embers
  (`lib/game/economy.ts`), passed as `computeWinPayout()`'s new fifth argument. Win-only —
  `computeDeathPayout()` is unmodified, same rule as the baseline mission bonus.
- **Never gates the baseline win.** Failing (or not attempting) the secondary never fails
  `arriveHome()` — `lib/game/outcome.ts` is untouched by this feature.
- Gated behind a cross-session unlock: the secondary picker in the pre-run menu only renders
  once the player has completed `deepwater`'s baseline at least once
  (`missionUnlocks.deepwater`), persisted to `localStorage` by `components/Hud.tsx`'s
  `useMissionUnlocks()` exactly like Embers' `useEmbers()`.
- Retrieval reuses the existing interact channel (`KeyE` / `triggerTouchInteract()`), the same
  key/button that completes the baseline mission and lifts the child — no new keybinding, no new
  touch target. Completion fires `completeSecondarySequence()`: a caption + the same completion
  sting as the baseline mission, no cinematic lock.
- HUD: a second collapsed top-left panel (`#secondaryPanel` in `components/Hud.tsx`), same
  family as `#missionPanel` above — progress-to-target in meters (retrieval) or a countdown
  (speedrun), hidden whenever no secondary is attached or the player is carrying the child.

**Collision & physics profile**
- N/A — not a spatial/world object. The mission *target* (the drowned car) is a `LANDMARKS`
  entry with its own existing decorative/navigational collision profile, unchanged by this
  entry; the mission struct only reads that entry's coordinates, it does not add new geometry.
  The retrieval secondary's target is the `radioMast` landmark, below — also unchanged
  geometry, no new mesh or light.

---

### Radio Mast (`radioMast` landmark)

**What it is**
- A permanent, always-rendered decorative `LANDMARKS` entry (`engine/tuning.js`, `kind:
  'radioMast', x: 30, z: 175`) with its own pulsing red beacon glow sprite
  (`buildRadioMast()`, `LANDMARK_BEACONS.radioMast` tuning, LUL-1855; generalised to all six
  landmarks by LUL-2248 — see Landmark Beacons below — `radioMast`'s hue/scale/pulse are
  unchanged). It predates LUL-1666/LUL-1697 and its appearance is unchanged by them.

**What it can do**
- **LUL-1666/LUL-1697:** when the player's pre-run secondary choice is `retrieval` (see Missions
  above), this landmark doubles as the retrieval target — walking within
  `RETRIEVAL_ITEM.interactRadius` (`lib/game/mission.ts`, 4 units) and pressing interact flags
  `mission.secondary` complete via `completeRetrieval()`. When retrieval is not the active
  secondary, nothing about the landmark changes — same mesh, same pulse glow, no interaction.
  **Retargeted from the originally-shipped `stoneMarker` to `radioMast`**
  (`decisions/lul-1697-retrieval-landmark-radiomast-2026-09-08`) because `stoneMarker` gained its
  own, unrelated interact mechanic (`canBuyVeilCharm`, LUL-2067/LUL-1210, see below) on the same
  `E`-key slot after this ticket's spec was written — `radioMast` has no other interact mechanic,
  so the two never compete.

**What it CANNOT do**
- Cannot be picked up, carried, or moved — completion is a one-time flag on the mission struct,
  not an object-carry state (no position tracking, no drop-on-death).
- Cannot be interacted with outside a `retrieval`-secondary run — `canCompleteRetrieval()` is
  false whenever no secondary is attached or the attached secondary is `speedrun`.
- Gains no new geometry, particle, or glow-intensity change from LUL-1666/LUL-1697 — the existing
  pulsing beacon glow is the only signal that it is the active objective.

**Collision & physics profile**
- Unchanged by LUL-1666/LUL-1697 — same decorative-landmark collision profile `buildRadioMast()`
  always had.

---

### Wayfinding (LUL-1255 Ship 1: S2/S3/S4/S5/S6)

**What it is**
- **Implemented (LUL-1674), S2/S3/S5/S6 of the Ship 1 wayfinding spec; S4 (carried-noise
  floor) implemented separately (LUL-1857).** No new verbs and no new collision for any of the
  pieces below — all are passive visual/audio anchors, plus one new passive predator-detection
  channel (S4, carry-leg only). S1 (home-light reach) is a separate ticket (LUL-1851) and is not
  covered here.
- **Landmark navigability cue (S2).** The four original `LANDMARKS` entries (`fireTower`,
  `stoneMarker`, `oak`, `drownedCar`, `engine/tuning.js`) already function as a navigable
  coordinate system; `enter()` (`engine/forest-engine.js`) now fires a one-time, unconditional
  (not gated on `captionsOn`) caption on run start — `"landmarks in the fog are safe to
  navigate by"` — as a nav tip, not a repeating audio-cue caption.
- **The child's cry (S3).** `childCry(distToPlayer, srcX, srcZ)` (`engine/forest-engine.js`) is
  a procedural, panned-by-bearing tone toward an explicit source position, same tempo/pitch-
  carries-distance shape as the mission hum it predates in design (`missionWaypointHum()`
  mirrors it), driven by a `cryTimer` countdown (5.5s far / 2s close outbound; pinned to 2s —
  the closest-tempo floor — while carrying, LUL-1857) inside the same block that already renders
  the child's idle glow (outbound) or the carrying-phase update (carry leg). Outbound, a roaming
  predator can also hear it: `checkNoise(p, Math.hypot(baby.x-p.x, baby.z-p.z), cryNoiseRadius,
  dt)` is a second, independent hearing check (last in the roam state's detection chain — sight,
  scent, footstep, then cry) against the child's own fixed position, not the live player,
  resolved via `hearCry(p)` which reuses LUL-1623's `p.noiseTarget`/`p.noiseTargetT`
  point-target primitive (`p.noiseTargetT = Infinity` — the cry doesn't time out like a thrown
  decoy's landing spot, it keeps sounding until the predator arrives). This outbound channel is
  gated off entirely once `baby.taken`. `CRY_NOISE_RADIUS = 32` (`lib/game/noise.ts`),
  fog-tide-scaled at the child's position (`fogTideGlowRangeMul(fogTideAmountAt(baby.x, baby.z,
  ...))`); predator spawn exclusion around the child raised from 26 to 34 units so nothing spawns
  already inside the cry's audible range. Caption (gated on `captionsOn`): `"a child crying ·
  <near|far> · <side>"`.
- **Carried-noise floor (S4, LUL-1857).** While `carrying`, the same `cryTimer` (reused, not a
  second clock) pulses `childCry(0, player.x, player.z)` every 2s — always "near", centered pan
  (source = player position, since `baby.x/z` is a stale snapshot during carry, not live). Each
  pulse also sets a one-tick `carriedCryPulse` flag, consumed the same frame inside
  `updatePredators`'s `roam` state: `else if(!sniffImmune && carrying && carriedCryPulse && dist
  < CARRIED_NOISE_FLOOR){ hearNoise(p); }` — a deterministic proximity check at the moment of the
  pulse, not a per-frame `isNoiseHeard()` roll, and (unlike the outbound cry) resolved via
  `hearNoise(p)` so it targets the *live player position*, since the noise source moves with the
  player on the return leg. `CARRIED_NOISE_FLOOR = 0.4 * NOISE_RADIUS_WALK = 5.6` units
  (`lib/game/noise.ts`), deliberately **not** fog-tide-scaled (kept under the 8u sniff-backoff
  bound with margin). Only active for a still carrier — a *moving* carrier's footstep
  `noiseRadius` channel is unchanged and unaffected. Also, a predator's terminal sniff-loop
  give-up (`p.inv === 'sniff'`, `stepSniffLoop` returns not-`'back'`) now routes through a new
  `p.inv = 'leave'` phase — walking away via `backOffPoint()`, same retreat speed as the
  mid-loop `'back'` phase — instead of flipping to `roam` in place, when the give-up happens
  `hidden && carrying`; ungated (non-carrying) give-up keeps its prior in-place behavior.
  Predators caught by this carry-leg pulse get `p.alertedBy = 'cry'` set on them (LUL-1857
  mitigation 4, LUL-2194), read by the `chase`-catch `triggerDeath()` call site to report a
  `'heard'` death cause instead of `'chase'`; cleared to `null` by every other hearing/sight/
  scent channel.
- **Home fire crackle (S5).** `homeFireCrackle(dist)` (`engine/forest-engine.js`) is a
  filtered-noise burst (reuses `hollowLogSound()`'s bandpass-noise chain, minus its sine thump)
  panned by bearing to `CONFIG.home`, driven by a `homeFireTimer` on the same tempo-carries-
  distance curve as the cry, firing only while `carrying`. Not predator-audible — this is the
  return leg's audio cue, not a detection channel. Caption (gated on `captionsOn`): `"home fire
  crackling · <near|far> · <side>"`.

**What it can do**
- All pieces are passive: no new key binding, no new `EngineActions` method, no new touch
  target. Nothing here changes what the player or a predator can physically do beyond the two
  hearing channels described above (outbound cry, S3; carried-noise floor, S4).

**What it CANNOT do**
- Cannot be re-triggered manually or skipped — all cues are driven purely by elapsed-time
  timers and world state (`carrying`, `baby.taken`), not player input.
- The outbound cry cannot pull a predator toward the live player — that's the exact bug this
  design fixes by targeting `baby.x/z` via `p.noiseTarget`, not the live-player-anchored
  `checkNoise`/`hearNoise` path every other hearing channel uses. The carried-noise floor (S4)
  is the deliberate opposite: it targets the live player, because on the carry leg the noise
  source (the child, in the player's arms) *is* the live player position.
- The carried-noise floor cannot fire on a *moving* carrier — it's pulse-gated to the still-
  carrying case; a moving carrier is only subject to the ordinary continuous footstep
  `noiseRadius` roll, unchanged by this feature.

**Collision & physics profile**
- N/A for all pieces — no new geometry, no new spatial structure. Both hearing checks reuse
  ordinary Euclidean distance and the existing `checkNoise`/`isNoiseHeard`/`hearNoise` predicates
  unchanged; the carried-noise floor adds a distance threshold constant, not new geometry.

---

### Stone Marker veil-charm (LUL-1210)

**What it is**
- **Implemented (LUL-2067/LUL-1210).** A one-shot in-run spend at the Stone Marker landmark
  (mesh/collider already shipped, LUL-374): 15 unbanked Embers buys a "reserve" that snaps a
  fully-drained mist-veil (`KeyF`) back to its unlock threshold instead of locking it out, the
  next time a full drain would otherwise happen. Second in-run Embers spend site, after Deeper
  Lungs (which is a between-run purchase, not in-run).
- Purchase gate `canBuyVeilCharm`, computed every tick (`engine/forest-engine.js:4137`):
  `!carrying && !veilReserve && distStoneMarker < VEIL_CHARM_INTERACT_RADIUS &&
  computeDepth(maxDistFromHome) >= VEIL_CHARM_PRICE`. `VEIL_CHARM_INTERACT_RADIUS` (4 units,
  `engine/tuning.js:68`) and `VEIL_CHARM_PRICE` (15, `lib/game/economy.ts:74`).
- `buyVeilCharm()` (`engine/forest-engine.js:3445`): sets `veilReserve = true`, adds
  `VEIL_CHARM_PRICE` to `embersSpent`, fires a caption + `feature_engagement`/`veil_charm`
  telemetry event.
- `stepVeilCharge()`'s `reserve` branch (`lib/game/veil.ts:59`): on a full drain, if `reserve` is
  true it snaps `charge` back to the unlock threshold and clears `reserve` instead of setting
  `locked`; identical to prior behaviour when `reserve` is false.

**What it can do**
- Reachable via both interact paths: desktop `KeyE` and mobile `triggerTouchInteract()` (the
  existing tap-and-hold interact target — no new touch control), same shape as pickup/mission
  completion.
- Deduct the spend from the run's live unbanked pile display (`livePileEmbers`) immediately, and
  from the final payout via `applySpend()` (`lib/game/economy.ts`), applied at both `arriveHome()`
  and `triggerDeath()` so the spend is honestly reflected whether the run ends in a win or a death.

**What it CANNOT do**
- Never offered while `carrying` — same hard gate as every other landmark purchase.
- Never a second currency/spend UI surface — a single in-world interact prompt, not a shop panel.
- Cannot fail for lack of funds in normal play: by the Stone Marker's fixed 125-unit distance from
  home, `computeDepth(maxDistFromHome) >= 31` by geometry at the point of purchase, a 16-point
  margin over the 15-point price (the `computeDepth(...) >= VEIL_CHARM_PRICE` guard is kept as a
  correctness backstop, not removed as dead code).
- Only one reserve may be banked at a time (`!veilReserve` in the gate) — cannot stack multiple
  charms.

**Behaviours & logic**
- Reset per-run: `veilReserve = false; embersSpent = 0;` in `enter()`.
- HUD prompt text (`engine/forest-engine.js`, the `objectiveText`/`objectiveReady` `pushState()`
  block): `'Press  E  for a mist-charm  ·  15 embers'` when `canBuyVeilCharm` and no higher-priority
  prompt (pickup/carry/mission) applies; `objectiveReady` is `canPickup || canBuyVeilCharm`.
- `RunRecap` (`components/Hud.tsx`) renders a `· −{payout.spent} charm` fragment when
  `payout.spent > 0`, so the earnings breakdown still reads as sums to `total` after a spend.

**Collision & physics profile**
- N/A — not a spatial/world object of its own. Uses the Stone Marker landmark's existing
  decorative/navigational collision profile (`landmarkGroups.stoneMarker.position`, live post-nudge
  position), unchanged by this entry.

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
| **PL** Player | · | TRIG¹ | TRIG² | TRIG² | TRIG² | C+LOS³ | C+LOS | LOS+HIDE²⁰ | LOS+HIDE²² | STAND | SLOW⁴ | TRIG⁵ | – | ATT | TRIG⁶ | TRIG²¹ |
| **CH** Child | | · | **U**⁷ | **U**⁷ | **U**⁷ | – | – | – | – | STAND | – ⁸ | – | – | – | TRIG⁶ | TRIG²¹ |
| **WO** Wolf | | | C⁹ | C¹⁰ | C¹⁰ | C(trunk)+LOS³ | C+LOS²³ | LOS only¹¹ | LOS only¹¹ | STAND | –¹² | – | – | – | TRIG⁶ | TRIG²¹ |
| **BE** Bear | | | | C¹³ | C¹⁰ | C(trunk)+LOS³ | C+LOS²³ | LOS only¹¹ | LOS only¹¹ | STAND | –¹² | – | – | – | TRIG⁶ | TRIG²¹ |
| **LI** Lion | | | | | C¹³ | C(trunk)+LOS³ | C+LOS²³ | LOS only¹¹ | LOS only¹¹ | STAND | –¹² | – | – | – | TRIG⁶ | TRIG²¹ |
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
¹¹ Log/Bramble movement passes straight through for predators (and the
player, LUL-384/LUL-1642) — **deliberate**, the one exemption
`coverKindBlocksMovement()` (`lib/game/cover.ts`) carves out of the
composite block both actors otherwise share. **Rock/Reed no longer belong
in this footnote as of LUL-1643** — see ²³. LOS is still blocked normally
for all four kinds.
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
it hit a `bramble`/`log`. **Log (and, as of LUL-1642, Bramble too) also
checks canopy clearance (LUL-384/LUL-491/LUL-1642):** `overlapsTreeCanopy()`
(`lib/game/cover.ts`) rejects a walkable-kind candidate whose footprint
overlaps a nearby tree's wider *canopy* circle (`t.crCanopy`), even when the
trunk circle is clear — needed because a walkable prop
(`coverKindBlocksMovement(kind) === false`) lets the player cross its
full footprint and `canopyBlockedR()` blocks the player unconditionally
within the canopy radius regardless of what's on the ground; without this a
log or bramble could spawn clear of every trunk yet still wedge the player
mid-crossing at a canopy edge. Rock/Reed stay trunk-only — solid either
way, so a canopy-only overlap changes nothing observable for them.
¹⁵ Trees and cover props both reject `inLake()` spawn candidates
(`generateMap()`, `generateCover()`) — defined, not undefined.
¹⁶ Both protected from home only indirectly, via the shared `inSpawn()`
check (home reuses the spawn coordinates) — see Home's "what it cannot do."
¹⁷ Rendered as a dot/circle on the minimap (`drawMinimapStatic()`)
— a read-only relationship, not physical.
¹⁸ Cover props are never checked against each other at placement — two
props (e.g. a rock and a log) can overlap. Lower severity than ¹⁴ (both are
already non-solid to predators, and the overlap is cosmetic at most for the
player: a solid prop (Rock/Reed) involved still collides normally,
predictably resolving to whichever AABB the grid cell returns first. As of
LUL-1642, Bramble is walkable like Log, so a Log-Bramble overlap
specifically is cosmetic in every sense — neither collides with the
player either) — not filed as a separate ticket; noted for whoever next
touches `generateCover()`.
¹⁹ Both are static, hardcoded far apart (lake at (34,-28) r=15/clear=22;
home at (0,0) r=3.6) — no code enforces their separation, but no seed can
move either one, so there's nothing to verify per-seed. Defined by
construction, not undefined.
²⁰ **Changed, LUL-384.** Previously `C+LOS+HIDE` like Bramble. Log is now the
one cover kind that doesn't block the player's movement either —
`coverKindBlocksMovement('log')` is `false` (`lib/game/cover.ts`), read
by `coverBlockedR()`. LOS and hide-spot eligibility are untouched (both read
`coverGrid` independently of `coverBlockedR()`), so Log keeps `LOS+HIDE`;
only the `C` is gone.
²¹ **Embers** (LUL-1043) is a run-currency event tracker, not a spatial
object — no movement collision or LOS interaction. `TRIG` marks events where
Embers earnings are computed: Player earnings/spending gate, Child pickup
earning trigger, Predator kill earning trigger, Home arrival earning trigger.
²² **Changed, LUL-1642.** Previously `C+LOS+HIDE` — Bramble was the one
`HIDE_KINDS` prop still solid to the player, unlike Log (²⁰). Both kinds
already ran the exact same `hidden`/`hideTime`/`findHideSpot()` state
machine, but `hasLOS()`/`canSee()` test the player's *actual world
position* against the prop's AABB, not the `hidden` flag — solid Bramble
collision-stopped the player at its (small, roughly circular) footprint's
edge, often standing just outside the box `findHideSpot()`'s
`HIDE_RADIUS`=2.2 allowed them to trigger `hidden` from, while walkable Log
let the player stand inside its own (long, thin) footprint instead. An
edge-standing Bramble hider could sit in a clean sightline the on-footprint
Log case never exposed, playing as "the animal found me while I was still
hiding." Fixed by extending `coverKindBlocksMovement()`'s walkable
exemption from `log` alone to every `HIDE_KINDS` entry
(`!HIDE_KINDS[kind]`, `lib/game/cover.ts`) — Bramble now shares Log's
`LOS+HIDE` cell and the same canopy-clearance placement check (¹⁴). This is
a deliberate reversal of part of LUL-384's original walkable-vs-solid
split (which kept Bramble solid on purpose, "the one prop a person would
step over" being Log specifically) — called out here since the ticket
asked explicitly for one unified hiding behaviour across both cover kinds
rather than a bramble-only fix that left the two divergent. Rock/Reed,
neither a hiding spot, are unaffected.
²³ **Added, LUL-1643.** Predator movement now calls `blockedForPredator()`
(`lib/game/cover.ts`) — `blockedR()` (tree/landmark circles) plus
`coverBlockedR()` — instead of bare `blockedR()`, so Rock/Reed become real
predator colliders for the first time, reusing the exact same
`coverKindBlocksMovement()` solid/walkable predicate the player already
used via `blocked()`. `pickAvoidDirection()` (steering avoidance) probes the
same composite, so a chasing predator now slides around a Rock/Reed edge
in advance rather than bonking into it — same qualitative behaviour it
already had for trees. `canopyBlockedR` stays player-only (camera/eye-height
concern, no predator analogue) — Rock/Reed's predator collider is grid+cover
only. Log/Bramble are unaffected by this change (¹¹).

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

## The Bog (LUL-25 / LUL-1483 / LUL-1902 / LUL-2225)

LUL-1902 replaced the 2D-noise-scattered biome (many patches, ~30-37% of the map) with a
single fixed zone: `biomeAt(x, z)` derives bogginess from distance to `BOG_CENTER`
(`lib/game/bog.ts`), radial falloff smoothstepped between `BOG_INNER_RADIUS` (full
bogginess) and `BOG_OUTER_RADIUS` (dry), same edge-softness approach as before. Cost model
(`bogSpeedMultiplier`/`bogNoiseMultiplier`, splash foley) is byte-for-byte unchanged from
LUL-1483 — only *where* bogginess is nonzero has changed, twice.

**LUL-2225 (current shape)**: the founder rejected what LUL-2084 shipped for LUL-1902 --
~24.9% of the map, with `oak`/`drownedCar` deliberately blended inside it. `BOG_CENTER`
moved to `{x:-40,z:80}`, `BOG_OUTER_RADIUS` shrank 135→45 and `BOG_INNER_RADIUS` 35→25, so
the patch is now **2.75% of the map, one small area with nothing else in it** — every
`LANDMARKS` entry, `CAVE`, and every `ROOSTS` site sit strictly outside
`BOG_OUTER_RADIUS` (`bogKeepClear()`, unit-tested as a static-data guard over all three
lists), and `generateCover()`/`generateThrowables()` post-filter any log/rock/bramble/stone
that lands inside it. Forest trees inside the patch's dense-core threshold
(`biomeAt > 0.5`) are culled to 1-in-4 (deterministic index counter, no rng change) so the
interior reads as sparse, not "the same forest plus more trees" — `qaProbeBogKeepClear()`
reads all of this back from the live map. `CONFIG.lake` is now 131 units from `BOG_CENTER`
(outside `BOG_OUTER_RADIUS` on its own), so the old lake carve-out in `lib/game/bog.ts` was
dead code and was removed; `CONFIG.home`/spawn is still explicitly carved out to stay dry
(`HOME_CLEAR_RADIUS`/`HOME_FADE_RADIUS`). The patch now has a visible boundary: two
concentric ground discs (`bogOuterGround`/`bogInnerGround`, darker/wetter material than the
base `ground` plane) and a matching disc on the minimap (`drawMinimapStatic()`) — the
minimap was explicitly out of scope for LUL-1902 but a small patch finally gives it one
clean shape to draw.

Blackout's hard baby-spawn predicate changed with it: `pickHardBabyPosition()`
(`lib/game/bog.ts`) used to require the child stand *in* the bog
(`biomeAt(x,z) > 0 && hypot(x,z) >= BLACKOUT_MIN_RADIUS`) — impossible for any patch this
small (0/1000 seeded runs succeeded; every call silently fell back to a random point, the
exact failure LUL-1902's own spec had warned about). It now requires the *direct route
home* to cross the bog's full-bogginess core (`routeCrossesBog()`), which is satisfiable on
every seed (1000/1000, and asserted with no fallback over 200 seeds in `bog.test.ts`).
`qaProbeBaby()` reports `{x, z, distHome, routeCrossesBog}`, replacing the old `inBog` field.

**New elements it adds**: `BogTree` (30-instance thinner-cover twin of Tree, `BOG_TREES` in
`engine/tuning.js` — shrunk from 360 alongside the patch itself, LUL-2225; own
`bogTreeData` array, merged into the shared `grid` for collision),
`Reed` (tall `coverData` kind `'reed'`, LOS-blocking like Rock/Log/Bramble
but **not** in `HIDE_KINDS` — not a hiding spot; own budget `BOG_REEDS` (120) as of
LUL-2225, placed only in the ring between `BOG_INNER_RADIUS` and `BOG_OUTER_RADIUS` so reeds
themselves read as the patch's boundary, not scattered through its interior, and rejecting
`inLake()`/`overlapsTreeTrunk()` candidates in its own generation loop as of **LUL-2247**
(same checks `generateCover()` runs); as of the same ticket, Cover/Reed/BogTree/stone
(throwables) are additionally jointly capped per 60x60 chunk and to a 3.5u minimum spacing
across every non-tree prop type (`PROP_CHUNK_CAP`/`PROP_MIN_SPACING`, `engine/tuning.js`) —
a deterministic post-filter run once after every prop generator finishes,
`thinGeneratedProps()` in `generateMap()`; forest trees are unaffected), seven fixed `Landmark`
groups (fire tower, stone marker, drowned car, lightning-split oak, radio
mast, chapel steeple, cave — static,
no RNG draw, nudged clear of nearby trees via `clearLandmarkSpot()`; `oak`
and `drownedCar` were relocated by LUL-1483, `engine/tuning.js`, to sit inside the bog
patch as it existed at the time -- LUL-2225 moved the patch itself away from both instead
of repositioning either landmark, so as of LUL-2225 neither sits in bog),
`radioMast` and `chapelSteeple` (LUL-1782) sit in the outer ring, radius
~178-179, restoring fixed orientation geography on the leg past the original
four that LUL-1484's map growth left featureless. `cave` (LUL-1904) is the
first landmark whose spawn and visibility are conditional per-round (~50%
via a seeded coin-flip in `generateMap()`, drawn last in the rng stream)
rather than always-present; walking into its `interactR` grants a one-shot
25s sight+scent detection immunity (`CAVE_IMMUNITY_TIME`, `lib/game/cave.ts`),
hooked into `effectiveDetect()`/`canSee()`/`checkScent()`. As of LUL-1855
(`radioMast` only) and generalised to the other five by **LUL-2248**, every
non-`cave` landmark carries a small fog-exempt additive sprite on its beacon
(`LANDMARK_BEACONS`, `engine/tuning.js` -- one entry per `LANDMARKS[].kind`,
same scale/opacity/pulse, distinct hue per kind so a beacon reads
unambiguously as a bearing to a specific landmark) so it stays visible as a
dim, slowly-pulsing point past the fog line that erases the rest of the
landmark's geometry -- a bearing, not a lit scene. `cave` has no beacon (its
spawn/visibility are conditional per-round, out of scope for LUL-2248). LUL-2248
also colours each landmark's minimap square by its beacon hue and draws
`CONFIG.home` as a warm ring on the minimap (`drawMinimapStatic()`). and
the `Bog` biome itself: continuous bogginess 0 (dry) to 1 (deepest), not
boolean, so a patch edge scales speed/noise in rather than stepping. It
scales player/predator walk speed down and noise radius up while standing in
it (`bogSpeedMultiplier`/`bogNoiseMultiplier`, applied to both the player,
`engine/forest-engine.js`'s movement block, and predators, the terrain
multiplier in `updatePredators()`), and is kept fully dry around
`CONFIG.home`/spawn regardless of the noise field (`HOME_CLEAR_RADIUS`/
`HOME_FADE_RADIUS` in `lib/game/bog.ts`).

**LUL-1902 — wolf-only scent-masking**: standing in (or having recently left) the bog
suppresses the player's scent specifically against wolf-type predators. A persisted
`playerBogMask` (`engine/forest-engine.js`) rises instantly with `biomeAt(player.x,
player.z)` and decays linearly to 0 over `BOG_MASK_DECAY_TIME` (6s, `lib/game/bog.ts`)
once the player leaves — not an instant on/off at the patch edge. `checkScent()` reduces
only `p.spec.nose` for `p.kind === 'wolf'` by up to `WOLF_BOG_MASK_STRENGTH` (0.7, i.e. a
70% nose-multiplier cut at full mask — not 100%, so a wolf already close on the trail can
still catch it). Bears, lions, and all sight-based `detect`/`canSee` are untouched. This is
a deliberate tradeoff, not a safe room: the bog already costs half walk speed and 1.6x
noise radius, so using it to shake a wolf is a real bet against being heard by a bear or
lion instead (`docs/decisions` — wiki `game/mechanics/bog-consolidation`, CEO decision
2026-09-07, explicitly rejected a hard predator-exclusion zone for this reason).

**What's already known and citable**: reeds reuse the exact same
`coverMeshes`/`coverGrid`/`hasLOS()` machinery as Rock/Log/Bramble, with zero
changes to either function; bog trees reuse `canopyRadiusAtEye()` unchanged;
the minimap now draws the bog patch as of LUL-2225 (see above) — LUL-1902 had left this
explicitly out of scope (wiki `game/lul25-status`) while the patch was still a quarter of
the map; a small, single patch finally gave it one clean disc to draw. This predicts the same interaction shapes
already in the matrix above (Tree-shaped collision for both actors,
Rock-shaped `C+LOS` for both actors as of LUL-1643 (²³), Log/Bramble-shaped
LOS-only walkable cover) — Reed shares Rock's `coverKindBlocksMovement()`
predicate (both `!HIDE_KINDS` kinds), so it also became a real predator
collider in the same change, not just a player one.

## Startled roosts, slice (a) (LUL-1914) — one-way predator-flush feedback

Five fixed canopy sites (`ROOSTS`, `engine/tuning.js`, static list alongside
`LANDMARKS` — no `rng()` draw, seeds stay byte-identical). Each tick,
`updateRoosts(dt)` (`engine/forest-engine.js`) checks active, non-`inert`
predators in `state === 'chase'` against each site's radius (20 units); on
entry it fires a small upward `THREE.Points` burst (fog-exempt, reads above
the fog line) and a positional wing-clatter (`roostFlushSound()`, modeled on
`scheduleBirdChirp`'s synthesis graph and `missionWaypointHum`'s panner/
falloff math), then puts that site on a 32s cooldown (`ROOST_COOLDOWN`).

**One-way only in this slice**: the player never flushes a roost, and no
`hearThrowableNoise()`-style noise event is created — `updateRoosts()` never
calls `effectiveDetect()`, `canSee()`, or writes any field on a predator. This
is a feedback/presentation layer, same class as `#bearingPulse` (LUL-1308) and
LUL-1855's beacon glow. Slice (b) (two-way, player-triggered, Tier C) and slice
(c) (`lib/game/eventSites.ts`-registered) are deferred — see wiki
`decisions/startled-roosts-2026-09-07`.
