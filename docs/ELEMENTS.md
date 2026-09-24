# Lullwood — canonical ELEMENTS registry

Source of truth: `engine/forest-engine.js` on `main` at `7796362` (2026-08-18,
2,519 lines — re-derived after backmerging `main` past `fc2b51f`, LUL-411),
cross-checked against `lib/game/{jump,charge,scent}.ts` and `components/{GameCanvas,Hud,MobileControls,DesktopControls}.tsx`.
Everything below is enumerated from what the engine actually instantiates —
not from memory, not from the original ticket text. Every claim cites a real
symbol/line so it can be re-verified after the next diff.

**Code correctness only.** Every claim below is "this is what the source
does." None of it is a claim about how anything looks, feels, sounds, or
plays — that's the Game Tester's call (LUL-383c). Anywhere the source itself
doesn't settle a question, it's marked `UNVERIFIED`.

Maintenance contract: every ticket that adds, removes, or changes an
element's verbs, collision, or interactions must update this file in the same
PR. If a future PR doesn't, the interaction matrix below is stale advertising,
not a source of truth — treat any diff that changes gameplay-relevant code in
`engine/forest-engine.js` as required to touch this file too.

Cue-triple audit: see `docs/CUES.md`.

---

## Elements (main branch)

### Player

**What it can do**
- Move (WASD/arrows), walk or run (`Shift`, hold by default; toggle if the
  `runMode==='toggle'` accessibility setting is on, `ShiftLeft`/`ShiftRight`
  edge-detect at L1526-1527 flips `toggleRunOn`),
  look (mouse via Pointer Lock, or drag-fallback, or touch stick on mobile) —
  `applyLook()`, movement block in `tick()`,
  `running` derivation at L2822. In toggle mode, touch's analogue is
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
  within `HIDE_RADIUS` (2.2u) of a `bramble` cover prop's true,
  rotation-aware rectangular edge (`HIDE_KINDS`, L278-279; `findHideSpot()`,
  edge distance via `distanceToCoverEdge()` in `lib/game/cover.ts`,
  LUL-405/LUL-430 fix — previously approximated the edge as a
  `Math.max(hx,hz)` circle, which over-extended the trigger several times
  past the object's real thickness on an elongated prop's thin side; `log`
  was in `HIDE_KINDS` at the time this fix landed but was removed later,
  LUL-2311). Hiding lowers eye
  height (2.2→1.05, damped ~0.3s), silences footsteps/scent deposit, and
  shrinks predator detect range the longer it's held (`STILL_RAMP`=1.2s,
  `STILL_DETECT_CUT`=0.82 — never reaches 1, so standing still in the open
  next to a predator still gets you caught — `effectiveDetect()`).
- Dim the personal follow-light (hold `KeyF`, or hold touch's `touchVeil`
  button via `setTouchVeil()` L7788 — `veilHeld` reads `keys['KeyF'] ||
  touchVeil` at L6840, mirrored the same way in `qaPlayerState()`'s return  object, so the two inputs are equivalent, not independent) —
  `LIGHT_NORMAL`/`LIGHT_DIMMED` (`engine/tuning.js`),
  applied in `tick()`; paired with a screen-edge
  vignette cue (`applyVignette()`), **and**, as of `LUL-291`, a real
  detection multiplier — see the Follow-light section.
- Pick up the child (`KeyE` / touch Interact) within 3.6 units, once
  (`canPickup`, `pickup()`). **As of `LUL-2281`** (2026-09-09, reverts
  `LUL-1307`'s carry-home leg), completing the ~11.3s ascend/explode
  cinematic (`tick()`'s `pickingUp` branch, `finishPickup()`) IS the win --
  `completePickup()` (`lib/game/outcome.ts`) sets `won` directly. There is no
  carry-home leg to walk anymore. **`LUL-2285`** (2026-09-23) deleted the
  carry-the-child-home machinery `LUL-2281` had left in place on purpose
  (`carrying`/`setDown`/`arriveHome()`/`canArriveHome()`, `CONFIG.carryPaceMul`,
  the carry-render `tick()` branch, home-fire cadence, carried-cry pulse, the
  `deathCarrying` HUD flag, and the `CARRY_DETECT_MUL` detection multiplier)
  -- none of it is in the codebase anymore.
- Leave a scent trail while moving (not while hidden or standing still) —
  `depositScent()`, deposited every `SCENT_DEPOSIT_INTERVAL` (0.3s). LUL-1724:
  moving against the wind (`isMovingAgainstWind()` in `lib/game/scent.ts`, dot
  product of movement heading and wind unit vector < 0) shrinks the deposited
  point's radius by `WIND_AGAINST_RADIUS_MULTIPLIER` (0.8, i.e. -20%) at
  deposit time only — detection math (`isScentDetected`, drift) is unchanged.
  Wind direction is shown to the player via `#windIndicator` (see HUD section).
- **LUL-2539/2485 cheap slice:** `windHighSpeed`, a per-run boolean rolled 50/50 in
  `generateWind()` (`engine/forest-engine.js:1811`) from an independent seeded generator
  (`mulberry32(currentSeed ^ 0x57494e44)`, not the shared `rng` stream, to avoid perturbing
  `QA_PINNED_SEED` map-gen reproducibility), reduces the effective scent lifetime by
  `WIND_HIGH_SPEED_LIFETIME_MULTIPLIER` (0.8, i.e. -20%) via `scentLifetimeWithWind()`
  (`lib/game/scent.ts`) — stacks multiplicatively with the Quiet Step tier reduction, not a
  replacement for it. No player-facing indicator; pure tuning knob per
  [[decisions/lul-2485-scent-wind-tuning-accepted-2026-09-12]].
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
  (L1712-1713) says so directly: "There is no separate modal settings
  surface today (LUL-70, still backlog)." Previous revisions of this doc
  cited engine line numbers for this bullet as if it were live; that was
  wrong at every revision, not just a drift artifact — see the LUL-411
  handoff comment.

**What it CANNOT do**
- Cannot enter `hidden` anywhere else — standing behind a rock or a
  large tree (LOS cover) does **not** let you hide; those only block sight
  incidentally while you keep moving (LUL-212's own framing, L263-277).
- Cannot physically collide with the child, a predator, the fog,
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
  an ~0.3s time constant (`Math.min(1, dt*8)`, L2292), not snapped. **Fixed,
  LUL-273:** `canopyBlockedR()`/`blocked()` now recompute each tree's canopy
  radius live against this same `eyeH` (`canopyRadiusAtEye(t.s, eyeH,
  CANOPY_GEO)`) instead of the `crCanopy` cached at map-gen time for a fixed
  `CONFIG.eye` — the cached value under-protected for the ~0.3s window right
  after exiting a hide spot while moving, since the cone tapers and a lower
  eye height sits closer to its wider base. See wiki
  `game/lul267-canopy-collision-fix`.
- Player FOV for "can the player see the charging predator" gating is ~130°
  total (`PLAYER_FOV_COS`, `cos(65°)`, L1699) — independent of the render
  camera's own 70° vertical FOV (`camera`); this is a gameplay cone, not
  the literal viewport.

**Collision & physics profile**
- Movement collider: **circular, radius 0.6**, checked against the tree grid
  (`t.cr = 0.35*s`), the canopy-aware grid (`t.crCanopy`, player-only), and
  rotated-AABB cover props. No collider vs. home, fog, child, or
  predators — see above.
- No vertical/ground collision at all: eye height is a formula
  (`eyeH + bob + jumpY`, L2395), never a raycast against the ground mesh.
- Two different downstream checks read player position without going through
  `blocked()`: `hasLOS()` (sight, rotated-AABB raycast, includes tagged
  trees `s>1.4`) and the distance-only scent/noise/pickup/win checks above —
  geometry gates *sight only*; it never gates scent or hearing (`checkScent()`
  and `checkNoise()` take no cover/LOS argument at all). Catch is gated on
  sight too, always: `chase`/`hunt` kill via `canCatchInChase()`/`isCaught()`,
  which both require `canSee()` (and therefore `hasLOS()`) regardless of
  `hidden` — this is unchanged by LUL-2320. What LUL-2320 changed is what
  `hasLOS()`/`canSee()` themselves report while the player stands inside a
  Log/Bramble's own footprint — see those cards and the predator card below.

---

### Child (the lost, glowing objective)

**What it can do**
- Sit at a fixed point drawn once per map (`baby.x/z`, `generateMap()`),
  glowing and idly bobbing, marked by ambient "wisp" particles
  (`placeBabyWisps()`) so it's spottable through fog.
- Be picked up once (`baby.taken`, `pickup()`), triggering a scripted
  10s pickup cinematic (`tick()`'s `pickingUp` branch, L2349-2379) that ends
  in a sky-burst (`fireBoom()`). **As of `LUL-2953`**, the burst's mesh scale
  (`boomFlash`/`boomRing`/`bspPts`) is multiplied by `BOOM_FOV_SCALE` — the
  ratio between mobile's wider `CAMERA_FOV` (LUL-69) and the desktop 70°
  baseline the effect was tuned at — so it reads at the same apparent size on
  both platforms instead of shrinking on mobile's wider frame
  (`qaProbeBoom()`). **As of `LUL-2971`**, the burst materials are a
  saturated gold/orange (was near-white/cream) and the `#flash` DOM overlay's
  peak opacity is `FLASH_PEAK_OPACITY` (0.65, was 0.9) — the overlay
  composites on top of the WebGL canvas via plain CSS opacity, so a same-hue
  mesh under a 90%-white peak read as a white wash regardless of its scale;
  lowering the peak raises the mesh color's compositing weight enough for the
  new hue to read through (`qaProbeBoomPixel()`). **As of `LUL-2985`**, all
  three burst mesh layers (`boomFlash`/`boomRing`/`bspPts`) share `#flash`'s
  own plateau-then-fade timing (held through `e<=1.5`, fading out over the
  final `0.3s`) instead of three independent, faster per-mesh rates — the
  previous rates left `boomFlash` fully transparent by `e=0.4`, a quarter of
  the window a late vision-QA capture is tolerated to land in
  (`qaProbeBoomOpacity()`). **As of `LUL-3130`**, `boomFlash` (the only one
  of the three layers that ever covers the screen centre — `boomRing`'s own
  centre is a hole and `bspPts`'s scattered points rarely land on one pixel)
  blends `NormalBlending` instead of `AdditiveBlending`: during the pickup
  cinematic the camera looks into a bright sky, and an additive gold layer on
  top of an already-bright background pushed every channel to within a few
  percent of 255 — ACES/bloom's compression at that saturation then
  flattens any remaining per-channel gap into a white wash regardless of the
  mesh's own hue. `NormalBlending` replaces the background pixel with the
  mesh's own color instead of stacking onto it, so the read stays gold/orange
  no matter how bright the sky behind it is. The same fix also corrected
  `qaProbeBoomPixel()`, which had been calling `renderer.render(scene,
  camera)` directly — skipping the bloom+ACES composite pass (`renderPost()`)
  real frames use whenever post-processing is active, so the probe measured
  an uncomposited frame no player ever sees.
- **As of `LUL-2281`** (reverts `LUL-1307`'s carry-home leg, and `LUL-2285`
  deleted the machinery `LUL-2281` had left in place), completing the pickup
  cinematic wins the run outright (`completePickup()`, `finishPickup()`) —
  there is no carry-home leg, no set-down, no separate win-on-arrival step.
- **NOT live on `main`** — idle glow intensity scaled by a difficulty
  preset's `glowMul` was built on the unmerged LUL-26 branch
  (`DIFFICULTY_PRESETS`); `engine/forest-engine.js` on `main` has no
  `glowMul`/`DIFFICULTY_PRESETS` identifier at all (verified by grep,
  2026-08-18). See the Player section's accessibility-settings note above —
  same root cause, not a separate finding.
- **As of `LUL-27`**, the **Fog Tide** (see Fog above) scales the idle
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
  child's idle spawn position; a child outside every site's radius sees no
  tide glow boost regardless of the global clock's phase.
- **As of `LUL-1480`** (rules `LUL-1438`/`LUL-1414`), the unscaled idle glow
  and halo curves live in `lib/game/childGlow.ts` (pure, unit tested), not
  inline in `tick()`: `idleGlowIntensity()`/`idleHaloOpacity()`. The
  difficulty preset's `glowMul` and `fogTideGlowMul()` still apply on top of
  these curves exactly as before.

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
  false→true, reset by `generateMap()`/`restart()`. Picking her up wins the
  run outright (`LUL-2281`), so there is no set-down or re-pickup case.
- Cannot collide with anything (no collider function reads its position).

**Behaviours & logic**
- Placement: `generateMap()` — polar draw, `d = half*(0.5+rng()*0.3)`
  from origin, no rejection guard at all (no guard against landing
  near a tree/cover cluster either).
- On `'blackout'` difficulty (the hardest `DIFFICULTY_PRESETS` tier), the
  draw above is overridden by `applyHardBabySpawn()` to a point at least
  `BLACKOUT_MIN_RADIUS` (192) from home and clear of every landmark, via
  `pickHardBabyPosition()` (`lib/game/mission.ts` as of LUL-4676 — moved
  off `lib/game/bog.ts`'s deleted route-crosses-the-bog condition, which had
  no meaning once that patch stopped existing) — a separate, symmetric
  override keyed on its own `babySpawnDifficulty` flag, restored back to the
  normal draw if the player picks a non-`'blackout'` preset before entering
  (LUL-799). `'lantern'`/`'night'` never call `pickHardBabyPosition()`, so
  their rng stream is unaffected. Reachable from the real Settings panel via
  `setDifficulty()` (LUL-372) — previously only `qaSetDifficulty()` could set
  it.
- Home is a **fixed reuse of the spawn point** (`CONFIG.home = {x:0,z:0,...}`,
  L85, comment: "reuses the spawn point, no new rng draw" — LUL-38), not a
  second procedurally-placed landmark.

**Collision & physics profile**
- No collider. Visual scale/position only (`babyGroup`, a `THREE.Group` of
  two spheres + a halo + a point light, L526-539). Placement-time-only
  clearance from trees/cover (`inBaby()`,
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
  (`state==='roam'`, L1030-1039). A predator that gives up an
  investigate/sniff or flank/hold loop (never a chase's distance-based
  give-up) stashes the player's position and gets a bounded number of
  ring-biased return-sweep waypoints (`LKP_MAX_SWEEPS`, `pickRoamWaypoint()`,
  `lib/game/predator.ts`) before it truly forgets and reverts to the
  original uniform-random pick -- a predator that camping used to shake for
  good now circles back a few times first (LUL-1573/LUL-1620). A re-alert
  mid-sweep (scent/noise/cry) that gives up again does not refill the count
  back to `LKP_MAX_SWEEPS` (`armReturnSweep()`, `lib/game/predator.ts`) --
  only a genuinely fresh loss of trail (no live sweep, or the player has
  left `LKP_REPEAT_RADIUS`) arms a full memory (LUL-2505).
- A `chase`'s distance-based give-up (`shouldGiveUpChase()`,
  `lib/game/predator.ts`) compares against `effectiveDetect(p)` instead
  of the raw `PSPEC[kind].detect`, so the give-up radius scales with the
  same multipliers that widen acquisition -- difficulty, veil, fog tide
  (LUL-1600).
- Detect the player through three independent channels: **sight**
  (`canSee()`, LOS raycast + shrinking-with-stillness range),
  **scent** (`checkScent()`, radius+wind, no LOS check at all),
  and **noise** (`checkNoise()`, pure distance + per-second chance while the
  player moves). Any one channel alone triggers a chase. Noise acquisition
  now fires a distinct `leafRustle()` cue + caption ("wolf heard you · near ·
  behind") so the player knows *which* channel caught them; callTimer is also
  initialised on noise-catch so the first roar in the following chase is
  correctly delayed (LUL-1610).
- **Dead code, not yet removed (LUL-1482):** `p.sightLock`/`lib/game/sightLock.ts`
  (`SIGHT_TELL_TIME` freeze-and-face-the-player tell before a sight-acquired
  chase locks in) was scoped to the carry leg only -- its only two set sites
  were the `if(carrying){ p.sightLock = startSightLock(); ... }` branches
  `LUL-2285` deleted, so `startSightLock()` is never called and `p.sightLock`
  is now permanently `null`. Left in place pending a follow-up cleanup ticket
  (same shape as `LUL-2281`'s Decision 2). Sight acquisition today locks into
  a chase on the same frame `canSee()` turns true, same as scent/noise.
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
- **Chase LOS-flicker tolerance (LUL-2611/LUL-2712).** A sight-triggered
  chase (`spotOnto()`) sets no `scentLock`, unlike a scent-triggered one
  (`scentOnto()`) — before this, `chase`'s canSee()-loses-sight gate
  (`updatePredators()`) downgraded it to `investigate`/`approach` on the very
  next tick it lost the player, even for a single-frame flicker at a cover
  edge. `p.sightFlicker` (`SIGHT_FLICKER_TIME`, 0.4s,
  `shouldDowngradeChase()`, `lib/game/predator.ts`) is refreshed to 0.4s
  every tick `canSee()` is true and decays unconditionally every tick
  regardless of state (same shape as `p.sniffImmuneT`); the downgrade only
  fires once `scentLock<=0 && sightFlicker<=0 && !canSee()`. Sight only --
  does not touch `scentLock`'s own blind-chase leash or the distance-based
  give-up above. Runs for every chase, every player, every difficulty.
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
  threat" (L1052-1053 comment) — contrast with wolf/lion is the design
  intent, not an oversight.
- Catch (kill) the player at `dist < rad+1.3` while actively seeing/hunting
  them (`triggerDeath()`, multiple call sites in `updatePredators()`).
- **Whole-map spawn + park/unpark (LUL-2250, epic LUL-2223 final child).**
  `placePredators()` draws uniformly over the whole map (same
  `[-half+margin, half-margin]²` draw `generateCover()`/`generateThrowables()`
  already use) instead of the old
  fixed annulus around the always-(0,0) spawn point; a predator whose chunk
  is more than `STREAM_RADIUS_CHUNKS` (2, LUL-2249's 5×5 streaming ring) away
  from the player's chunk is `p.parked`: not simulated (`updateWolfPack()`,
  `updatePredators()`, the threat scan all skip it), not visible
  (`p.g.visible`), and forgotten (`state`/`spotted`/`inv`/`lkpSweeps`/`hunt`
  reset the tick it parks) so it reads no differently from one that was never
  generated. Recomputed every tick in `tick()`, right before
  `updatePredators()` runs. A `MIN_ACTIVE_HUNTERS` (2) / `HUNTER_GUARANTEE_T`
  (90s) guarantee prevents an all-parked board: once fewer than 2 predators
  have been active for 90s of game time, `relocateParkedHunter()` teleports
  one parked predator (lowest array index) to a random cell on the streaming
  ring's outer edge, at least 70 units from the player and outside
  `playerCanSee()`, and logs `hunter_relocated` to the chronicle buffer (an
  internal diagnostic only — deliberately not in `ChronicleCode`/
  `formatChronicle()`, never player-facing).
- **NOT live on `main`** — parking predators off-map (`p.inert`, `x=z=-9999`)
  under a lower difficulty preset's `activePerSpecies` was built on the
  unmerged LUL-26 branch. `placePredators()` on `main` (L704-726) has no
  `p.inert`/`activePerSpecies`/difficulty logic at all (verified by grep,
  2026-08-18) — every predator always spawns active, every seed, today. Same
  root cause as the Player/Child LUL-26 notes above.

**What they CANNOT do**
- Collides with rock/reed (solid) and passes through log/bramble (walkable),
  identically to the player: predators call `predatorBlocked()` →
  `blockedForPredator()` (`lib/game/cover.ts:512`), which runs
  `coverBlockedR()`/`coverKindBlocksMovement()` the same way `blocked()` does
  for the player — stale since LUL-1643 wired this in (this doc previously
  said predators never collide with cover at all, which stopped being true
  then). LUL-2306: movement collision now uses `moveRad =
  PLAYER_COLLISION_RADIUS` (0.6, same as the player), not the species `rad`
  — see "Collision & physics profile" below.
- Cannot collide with each other, or with the child — no code path checks
  predator-vs-predator or predator-vs-child distance for collision.
  `UNDEFINED` — see matrix.
- Bear cannot charge (see table). Only wolf/lion evaluate
  `shouldTriggerCharge()`.
- Cannot be avoided by outrunning them (every species is faster than the
  player's max sprint, `RUN = CONFIG.walk*1.8 = 10.8`, all three final
  speeds exceed it — L623-624).
- Cannot spawn inside the spawn clearing, too close to the child, or inside
  another collider (`placePredators()`'s rejection loop).

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
  LUL-2457: on `'cleared'` (a successfully dodged charge), the engine zeros
  `p.vx`/`p.vz` (residual charge-sprint velocity used to close the gap and
  re-catch the player within a couple of frames, the LUL-213/LUL-323 bug
  shape recurring through the velocity-lerp door instead of the overshoot-
  duration one) and arms `p.chargeRecoveryT = CHARGE_RECOVERY` (`lib/game/
  charge.ts`, `(CHARGE_WINDOW + CHARGE_RUN_TIME) * 2`), which suppresses
  `shouldRevertInvestigateToChase()`'s normal instant-revert
  (`engine/forest-engine.js`, the `'investigate'` state) for that window —
  a dodge landing mid-charge otherwise left the predator close enough that
  the ordinary sniff-loop revert closed the gap again before the player got
  any reaction time.
- Stuck detection: if a predator's actual movement falls under 35% of its
  intended speed for >1.0s (game-time) while trying to move, it backs up
  along its last 6 trail points then either follows a bounded local search
  toward its live target (hunt/chase/investigate-approach) or picks a fresh
  random waypoint (roam/flank and any pursuing search that finds nothing),
  `p.stuckT` (`engine/forest-engine.js`, updatePredators()). LUL-1091 shipped
  this at 0.8s but LUL-1597 reverted it because the shorter window was
  sensitive to per-frame wall-clock jitter, causing `predator-determinism`
  e2e divergence across parallel runs with the same seed; LUL-2283's
  `qaSetFixedStep()` removed that wall-clock jitter, which is what makes the
  LUL-2306 1.0s threshold safe. LUL-2306 also added the bounded search itself
  — `findLocalPath()` (`lib/game/steer.ts`), a deterministic best-first search
  on a 2u sub-grid, up to 3 waypoints, replacing the random ±20u waypoint for
  a pursuing predator only; roam's stuck recovery is unchanged. The
  pathfinding improvements (pickAvoidDirection near+far probe, slideVelocity)
  from LUL-1091 are retained. `p.trail` samples every 0.4s and keeps 6 points.

**Collision & physics profile**
- Movement collider: circular, radius `moveRad = PLAYER_COLLISION_RADIUS`
  (0.6, same as the player) for all three species, since LUL-2306 — checked
  against both the tree-trunk grid and cover props via `predatorBlocked()` →
  `blockedForPredator()` (see above), so a predator never passes a gap the
  player cannot and is never blocked by a gap the player passes.
  `PSPEC[kind].rad` (0.8/1.5/1.0, unchanged) still governs catch range
  (`isCaught`/`canCatchInChase`), the sniff-margin `canSee()` call, and
  predator-vs-predator separation (`predatorSeparationPush`) — those are
  unaffected by this ticket.
- LOS: same rotated-AABB raycast as the player's own (`hasLOS()`), applied
  symmetrically (`canSee()` calls it both directions along the same line).
  LUL-2320: a predator standing inside a log/bramble's own footprint is not
  blinded by it either (`hasLOS()`'s symmetric origin-side skip) — matches
  the player-side fix and keeps the raycast genuinely symmetric.
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
- Cannot be a hiding spot (`HIDE_KINDS` only contains `bramble`, LUL-2311) —
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
  blocks sight but never enables `hidden`. This is a separate, narrower
  concept from the LUL-4528 vantage-climb *mount* below: mounting a rock
  does not add it to `HIDE_KINDS`, and mounting/hiding are mutually
  exclusive by construction (see below) — a rock is never simultaneously
  a hide spot and a mount spot.
- Not guaranteed clear of tree trunks at placement (see matrix).

**Behaviours & logic**
- `hx=r, hz=r*(0.7+rng()*0.5)`, `r=0.9+rng()*0.9`, random rotation `ry`
  (`generateCover()`).

**Collision & physics profile**
- Rotated-AABB collider for both actors (half-extents `hx,hz`, rotation
  `ry`) — `blocked()` (player) and `blockedForPredator()` (predator,
  **LUL-1643**) both route through the same `coverBlockedR()`.
- LOS: same AABB, both actors.

## Vantage Climb (LUL-4528)

Sightline-only cut of the Feature Scout's Prop Powers proposal (LUL-3254) —
CEO-accepted with the Scout's own self-imposed cut: no directional ping, no
compass indicator, no Threat Beacon (LUL-3009) widget reuse, to avoid
duplicating that feature. Pure camera-height + detection-weight exposure.

**Trigger** — tap `KeyC` (desktop) or `triggerTouchClimb()` (mobile), not
held. `toggleRockClimb()` gates on `canMountRock()` (`lib/game/rockClimb.ts`):
not already hidden, not already mounted, and a rock within `ROCK_MOUNT_RADIUS`
(3 units, found via `findRockMountSpot()` — same rotated-AABB edge-distance
query `findHideSpot()` uses, next to it in `lib/game/cover.ts`). A refused
attempt (no rock in range, or hidden) fires `rockClimbDeniedCue()` — a short
declined-interact sound plus a caption ("can't climb here" / "can't climb
while hidden"), never a silent no-op.

**State** — `mountedOnRock` (boolean) / `rockClimbT` (countdown seconds,
module-level lets in `engine/forest-engine.js`). Mounting starts a fixed
`ROCK_MOUNT_DURATION` (2s) window; `rockClimbT` decrements every frame while
playing and auto-dismounts at 0 (`rockClimbEndCue()` fires exactly once on
that edge, "never lapse silently"). Manual KeyC/`triggerTouchClimb()` while
mounted dismounts immediately, same end cue. Reset to `false`/`0` at all
three `hidden = false` sites (`pickup()`, `triggerDeath()`, `restart()`).

**Effect** — while `mountedOnRock`:
- `rockClimbDetectMul(mountedOnRock)` (`lib/game/rockClimb.ts`) multiplies
  into both `effectiveDetect()` and `canSee()`'s shared multiplier chain
  (`ROCK_CLIMB_DETECT_MUL = 1.6`, alongside `veilDetectMul`/
  `fogTideDetectMul`/`timeOfRunDetectMul`/`timeOfDayDetectMul`) — the
  player is more exposed to every predator while up on the rock. Returns
  exactly `1` (no-op) whenever `mountedOnRock` is false.
- `eyeH` eases toward `CONFIG.eye + ROCK_MOUNT_HEIGHT` (1.4 added) instead of
  its usual hidden/standing targets. Since `blocked()` already forwards the
  live `eyeH` into `canopyBlockedR()` every frame, the raised camera also
  improves the player's own outward canopy clearance — a real sightline
  benefit, not just a number going up.

**Mutual exclusion with hiding** — `canMountRock`'s own `!hidden` gate refuses
a mount while hidden; symmetrically, `toggleHidden()` now also refuses while
`mountedOnRock` (a rock-mounted player has no reachable hide spot logically,
but the code says so rather than relying on geometry to make it impossible).

**HUD** — `climbPrompt` row inside `#actionSlot` ("Press  C  to climb the
rock", contextual — visible whenever a rock is in range, not hidden, not
already mounted). `#rockClimbPanel` countdown ("Exposed · Ns"), a sibling of
`#caveImmunePanel` outside `#panel` so both stay visible with `adminMode` off.

**Explanation** — `HINT_PRIORITY`'s `rockClimb` entry shows the one-shot
`#hintCaption` pill ("climb the rock to see farther — but you're exposed
while you're up there") the first time it becomes eligible, same precedent
as `caveImmune`/`veilOverload`. The refusal captions ("can't climb here" /
"can't climb while hidden") are separate — fired unconditionally on every
declined KeyC press, not gated by `hintSeen`/first-encounter, since they are
a repeated-input tell rather than a one-time explanation.

**QA hooks**: `qaStageRockClimb(dx, dz)` (stages a predator with LOS to the
nearest rock at a fixed clear distance, mirrors `qaHideBehindCoverKind` but
keyed on `kind === 'rock'` directly since rock is outside `HIDE_KINDS`),
`qaProbeRockClimb()` (`{ mountedOnRock, rockClimbT, startCueCount,
endCueCount, deniedCueCount }`, mirrors `qaProbeVeilOverload`'s shape).

See `docs/specs/lul-4528-rock-vantage-climb.md`.

**What it still CANNOT do**
- Still not a `HIDE_KINDS` spot — see "What it CANNOT do" above. Mounting and
  hiding are two distinct, mutually exclusive interactions with the same prop.
- No directional ping / compass — explicitly cut, not deferred (see the
  proposal's CEO decision). Sightline (camera height + exposure) only.
- No per-rock mount-height lookup — `ROCK_MOUNT_HEIGHT` is one fixed constant
  for every rock, even though the underlying mesh height (`y: r*0.55`,
  `generateCover()`) varies per rock.
- No predator-AI-specific reaction to a mounted player beyond the existing
  detection-weight chain (no "converge on last-seen-mounted position"
  behaviour) — no exposure state has that today.

---

### Log (fallen wood)

**What it can do**
- Everything Rock can do (LOS-blocking cover), **plus**: it's walkable
  (`WALKABLE_KINDS.log = true`, see "What it CANNOT do" below) — **but it is
  NOT a `hidden`-stance location** (`HIDE_KINDS` dropped `log`, LUL-2311;
  founder brief: a fallen log is thin, walkable cover with nothing to
  visually be "inside" of, so pressing `KeyH` beside one does nothing).
- **LUL-4527: Log Crawl-Through** — walking into either mouth of a log
  (`findLogCrawlEntry()`, `lib/game/cover.ts`, gated `LOG_CRAWL_ENTER_RADIUS`
  and an inward-heading dot-product check) forces the player through it: a
  fixed, committed pass at `walk * LOG_CRAWL_SPEED_MUL` along the log's own
  long axis, ignoring sprint/turn input until the far mouth (`inLogCrawl`
  state, `engine/forest-engine.js`'s `stepFrame()` movement block, replaces
  the normal WASD/touch composition entirely while active) — a sprint/
  strafe/reverse attempt mid-crawl is silently refused but fires
  `logCrawlDeniedCue()` as the tell. Eye height drops to the same `1.05`
  hide uses (crouch read). `depositScent()` is never called while
  `inLogCrawl` (the forced branch has no call site for it at all), so a
  predator loses scent continuity for the crossing and re-acquires the
  instant the player resumes normal movement at the exit mouth — a pure
  side effect of the branch split, not new predator AI. Sight and noise
  detection are untouched: `hasLOS()`'s pre-existing walkable-cover
  exemption (LUL-2320(A)) means a predator with a clear sightline down the
  log's own axis still sees straight through it while the player is inside
  the log's footprint, and `checkNoise()` still rolls every moving frame
  (`NOISE_RADIUS_WALK`) regardless of `inLogCrawl` — this feature is scent-
  continuity only, not a stealth/invisibility mechanic. This is a third,
  separate boolean state from `hidden`/`HIDE_KINDS` — log stays out of
  `HIDE_KINDS` (LUL-2311's reasoning still stands; a crawl is a transit,
  not a static hide). `qaPlayerState()` exposes `inLogCrawl`/
  `logCrawlExitX`/`logCrawlExitZ` for tests.
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
  guard.

**Behaviours & logic**
- `long = 1.3+rng()*1.1, thin = 0.35+rng()*0.25`, orientation randomized
  between long-on-x / long-on-z (`generateCover()`).

**Collision & physics profile**
- LOS-blocking for both actors, same as Rock (`hasLOS()`, unchanged).
- **No movement collision for either actor** (LUL-384 removed the
  player-only block; predators never had one). Catch stays gated on
  `canSee()` always (`canCatchInChase()`/`isCaught()` in `hunt`, unchanged by
  LUL-2320 — see the Player collision profile note above), but LUL-2320 fixed
  what `canSee()` itself reports while standing on a log: `hasLOS()` no
  longer treats the log's own footprint as occluding the point standing
  inside it, so an **un-hidden** player on a log now reads as visible (and
  is caught normally) the moment nothing else blocks the sightline, instead
  of unconditionally. A **hidden** player's footprint still shields them at
  range (`canSee()`'s `insideHideFootprint()` check), only reading visible
  once a predator closes to contact range (`rad + CATCH_MARGIN`) — at that
  point `canSee()` and `isCaught()` agree, so contact resolves the chase
  (catch or the sniff-loop hand-off below) instead of gluing. Before
  LUL-2320, `hasLOS()` treated the log's footprint as an occluder
  unconditionally (hidden or not, any range), which made *any* player
  standing on it invisible from every angle and glued a chasing predator at
  contact range forever.
- **LUL-2311: no longer gates `findHideSpot()`.** `HIDE_KINDS` dropped
  `log`, so proximity to a log no longer makes `KeyH` succeed — that
  eligibility now belongs to Bramble alone. The movement exemption above is
  independent and unaffected (`WALKABLE_KINDS`, not `HIDE_KINDS`, backs it).

---

### Bramble (bush)

**What it can do**
- Everything Log can do (walkable, LOS-blocking cover), **plus**: it's the
  **only** hiding-spot-eligible cover kind (`HIDE_KINDS.bramble = true` —
  `HIDE_KINDS` dropped `log` entirely, LUL-2311), with a distinct "leaf
  rustle" enter/exit sound (`leafRustle()`) — researched against
  stealth/horror foley convention per the LUL-212 handoff (wiki
  `game/lul212-hiding-spots`).
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
  original walkable-vs-solid distinction, made to unify Bramble and Log
  (both `HIDE_KINDS` members at the time) behind one detection path per the
  ticket's explicit ask, not an independent design call — LUL-2311 later
  removed Log from `HIDE_KINDS`, but this movement/LOS-unification fix is
  unaffected, since it was never about hide-eligibility itself).

**What it CANNOT do**
- Same as Log: no predator movement collision (never had one); as of
  LUL-1642, no player movement collision either. Not guaranteed clear of
  tree trunks at placement (same as every cover kind), but — also as of
  LUL-1642, matching Log — now guaranteed clear of tree **canopies** too
  (`overlapsTreeCanopy()`, since it reads `coverKindBlocksMovement()`
  directly and now includes bramble). As of **LUL-2212**, also guaranteed
  clear of every other already-placed cover prop (`overlapsExistingCover()`)
  — see the Log section above for the bug this fixed.

**Behaviours & logic**
- `r = 0.8+rng()*0.7`, `hx=hz=r` (roughly round footprint,
  `generateCover()`).

**Collision & physics profile**
- LOS-blocking for both actors, same as Log/Rock (`hasLOS()`, unchanged).
- **No movement collision for either actor** (LUL-1642 matched Log's
  LUL-384 exemption; predators never had one), independent of hide
  eligibility. **The only `findHideSpot()`-eligible cover kind as of
  LUL-2311** — that function reads `coverGrid`/`HIDE_KINDS` directly and
  never calls `coverBlockedR()`, so this is unrelated to the movement
  exemption above. Same LUL-2320 catch behaviour as Log above: `hidden`
  protects at range via `canSee()`'s `insideHideFootprint()` check, contact
  range still resolves the chase either way.

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
- Usable in any playable state — grab/throw have no run-phase gate.

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
  actual "regions" (spawn clearing, forest) are separate systems
  (`inSpawn()`) layered on top of one uniform flat plane.

**Behaviours & logic**
- Single static mesh, created once, never touched again after L140-142.

**Collision & physics profile**
- None. See above.

---

### Home (the goal landmark)

**What it can do**
- Mark a fixed landmark: a point light + additive ring at
  `CONFIG.home = {x:0, z:0, r:3.6, glow:0xffd9b0}` (L85, L492-497).
  **As of `LUL-2285`** (deletes the `LUL-2281`-orphaned carry-home leg): purely
  decorative now — picking up the child wins the run outright
  (`completePickup()`), so nothing triggers on proximity to `CONFIG.home`
  anymore.
- Breathe (opacity pulse) continuously regardless of game state
  (`tick()`).

**What it CANNOT do**
- Has no collider of any kind.
- Is not itself protected from tree/cover placement by name — it is
  protected only because it deliberately reuses the same coordinates as the
  spawn clearing (`inSpawn(x,z) = x*x+z*z<40`, L290), which trees and cover
  both already avoid (LUL-38 comment, L85: "reuses the spawn point, no new
  rng draw"). If `CONFIG.home` ever moved off the spawn point, this
  protection would silently stop applying.
- Drawn on the minimap as a warm stroked ring only, not a filled disc
  (`drawMinimapStatic()`, LUL-2248) — a fixed 4px minimap radius, since
  `CONFIG.home.r` is a gameplay proximity radius, not a visual size.

**Behaviours & logic**
- Static, no RNG draw — same every seed, every restart.

**Collision & physics profile**
- None. No gameplay effect.

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
  `veilAmount` via `veilFogDensity()` (`lib/game/veil.ts`, called at L2677)
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
- LUL-2667: `?qaHour=<0-23>` overrides the hour `timeOfDayFromHour()` sees at
  that same call site (`engine/forest-engine.js:327`), for deterministic e2e
  coverage of the six states/boundaries. Absent or non-finite falls back to
  the real clock — zero behavior change for real players. Read-only
  `qaProbeTimeOfDay()` hook (inside `?qaHooks=1`) returns the resolved
  `{ state, visual, audio }` so a test can assert without scraping Three.js
  renderer internals. See `docs/specs/lul-2667-time-of-day-coverage.md`.

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
  `#spotFlash`, `#rustleFlash`, `#bearingPulse`, `#flash`, `#winPendingCue`, `#minimap` (canvas, drawn every frame by
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
  ActionPrompt.tsx`), rendered as six always-mounted rows inside a single
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
  | throwable | `heldThrowable`, `throwablesReserve` | `#throwPrompt` |
  | pickup | `canGrabThrowable` | `#pickupPrompt` |
  | status (hidden/hunted) | `statusVisible`, `statusText` | `#status` |

  `#captionToast` (predator-call captions) reuses the same component,
  positioned as its own row just above `#actionSlot` rather than as a seventh
  slot row, since it isn't part of the E/H/F/SPACE priority stack. It moved
  off its old dedicated amber colour onto the shared `tone="status"` look
  (same as the hidden/hunted row) -- a declared visual change, not a silent
  one. `#caveImmunePanel`/`#hint` stayed top-side and out of scope (the
  ticket's own "may", not "must").

  **## e2e (LUL-2312).** `e2e/action-prompt.spec.ts` rewritten: every
  `.toHaveClass(/urgent/)` became `toHaveAttribute('data-tone', 'urgent')`,
  `#actionKey` became `.actionPromptKey` scoped under the row, and a new
  `#actionSlot row order` describe block pins the six ids' DOM order
  (`chargePrompt, objective, actionPrompt, throwPrompt, pickupPrompt, status`
  — `pickupPrompt` added by LUL-2614) independent
  of any gameplay staging. `e2e/helpers.ts` gained `expectRowVisible`/
  `expectRowHidden` (assert `data-visible` rather than mount/unmount) --
  every other spec that asserted `toHaveCount(0)` or `toBeVisible()`/
  `toBeHidden()` on `#objective`/`#status`/`#actionPrompt`/`#throwPrompt`/
  `#chargePrompt` now uses one of those two instead, since none of the six
  ever unmounts any more: `hide.spec.ts`, `death-persist.spec.ts`,
  `smoke.spec.ts`, `throwable-mission-hud.spec.ts` (+ its `mobile/` half —
  LUL-2614 added the first `#pickupPrompt` assertions to the desktop file),
  `throwables.spec.ts` (+ `mobile/`), `win-persist.spec.ts`,
  `lul211-founder-report.spec.ts`, `predator-memory.spec.ts`,
  `charge-dodge.spec.ts`, `mobile/charge-prompt-tap.spec.ts`. `scent-trail.
  spec.ts`'s `assertNoOverlap` helper also treats a zero-area box as nothing
  to overlap, since an empty row's content collapses to zero width rather
  than disappearing from the DOM. Not done in this PR (no existing QA hook
  supports it): a single scenario with all six rows populated at once to
  assert pairwise non-overlap directly -- today's coverage exercises at most
  one populated row per test. Flagged as a `[QA-HOOK]` follow-up, not silently
  skipped.

  **LUL-2358 fix.** Three cases (`urgent cover prompt`, `no nowrap overflow
  and no mobile-control collision`, `reduced motion`) staged their chasing
  lion via `qaTeleportToHideSpot()` + `qaOpenHideNearLion()`; the latter
  resets the player to the spawn clearing (its own designed cover-free
  scenario), clobbering the former's teleport, and placed the lion only 4
  units out -- inside its `CATCH_MARGIN`+`rad` contact range within ~0.18s
  at the lion's `tuning.js` speed (9.2), so `triggerDeath()` fired before
  `data-tone` could ever read `"urgent"`. All three now use
  `qaOpenHideNearLionAtHideSpot()` (`engine/forest-engine.js`), same as
  `cover wins over veil`; that hook's lion standoff moved from a hardcoded
  `4` to `LION_STANDOFF = 14` so a chasing lion can no longer close to catch
  range before any of these tests' assertions run, while staying inside
  `COVER_URGENT_RANGE` (22) for the urgent-tone premise.
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
  unconditional, so it followed every real player (`#minimap` was
  `display:none` under `data-admin-mode="0"`, the default, at the time) and
  collided with `MobileControls.tsx`'s bottom-anchored Hide/Veil column on
  short landscape phones. `top:184px; right:16px`/`#windIndicatorHint`'s
  `top:214px` now apply only while the minimap is actually visible; the
  default (minimap off) position reverts to LUL-1724's original
  `top:20px; right:20px` (`#windIndicatorHint` `top:50px; right:8px`),
  verified clear of `MobileControls` at every tested viewport. LUL-2057 found
  the arrow's own ~54px rendered box (28px font, ~1.2 line-height) still
  overlapped the hint's first line at that 30px gap; `#windIndicatorHint`'s
  `top` moved to `64px` (default) / `228px` (minimap visible), a 14px
  increase in both, to clear it. LUL-2309 gave the minimap its own
  `showMinimap` setting, decoupled from admin mode -- the clearance push
  moved from keying off `data-admin-mode="1"` to keying off
  `data-show-minimap="1"`, since it tracked the minimap's own visibility,
  not admin mode's. LUL-4341 reverted this: the leaderboard record
  (LUL-3264) is Blackout-only, no minimap, no admin mode, so a speed record
  isn't meaningful if half the field ran with a map on screen. The
  `showMinimap` setting and `data-show-minimap` flag are gone; `#minimap` is
  `display:none` under `body[data-admin-mode="0"]` again (same rule shape as
  `#panel`), and the clearance push keys back off `data-admin-mode="1"`. A
  stored `showMinimap: true` from before LUL-4341 is dead and does not
  resurrect the minimap.
  LUL-2310: fullscreen has a second entry point besides `GameMenu.tsx`'s
  dedicated `fullscreenToggle` button (LUL-3253) -- **F11** and **Alt+Enter** (`engine/
  forest-engine.js`'s `keydown` handler), both routed through one shared
  module, `lib/game/fullscreen.ts` (`toggleFullscreen`/`fullscreenSupported`/
  `isFullscreenActive`), so the button and the keys can never implement two
  different fullscreen behaviours the way EngineActions and init()'s return
  object once drifted (LUL-1697). The module also adds the `webkit`-prefixed
  fallback (`webkitRequestFullscreen`/`webkitExitFullscreen`/
  `webkitFullscreenElement`/`webkitfullscreenchange`) Safari < 16.4 needs --
  `fullscreenSupported()` is true if either the unprefixed or webkit API is
  present, so `fullscreenToggle` now renders there too. Browser collision
  matrix (ticket has the full writeup): F11 is Chromium/Firefox's own
  fullscreen key, so the keydown handler calls `e.preventDefault()` on it
  before toggling, or the browser's own handling fires alongside this one and
  `document.fullscreenElement` desyncs from what's on screen; Alt+Enter is
  the fallback since F11 alone does nothing on macOS Chromium without Fn
  held, and Firefox is inconsistent about whether the page ever sees F11 at
  all. iOS/iPadOS Safari exposes neither API for a non-`<video>` element, so
  the key does nothing and the button stays absent there, unchanged from
  before. The keydown branch gates on `!won && !dead` rather than the usual
  `isPlaying(runState())`, since it's meant to work on the pre-entry gate
  screen too and only end screens should suppress it; `e.repeat` is dropped
  so holding either combo down doesn't spam request/exit calls every OS
  auto-repeat tick.
  LUL-3253: fullscreen moved from a row inside `.menuPanel` (2 clicks: open the menu, then
  the row) to a dedicated `fullscreenToggle` button rendered as a sibling of `.menuToggle`
  inside a `.menuButtons` flex row, both still inside `#gameMenu` (`GameMenu.tsx`) -- 1 click,
  and the whole cluster stays one `#gameMenu` id/z-index-20 box so nothing that already treats
  `#gameMenu` as one region needed a change. `.menuPanel`'s `top: 56px; left: 0` stays anchored
  to `#gameMenu` itself, not to either button, so it's unmoved. The old `menuFullscreen` row is
  gone -- a dedicated one-click button and a still-present 2-click menu row would have been the
  exact same action and readout (`toggleFullscreen`/`isFullscreen`) a few pixels apart, so the
  row was removed rather than kept as a second path to the same state. Gated on the same
  `fullscreenSupported` boolean and the same `winVisible`/`deathVisible` unmount as
  `menuToggle` -- no new logic for requirements 5/6, see above.
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
  `finishPickup()` and `triggerDeath()` (`engine/forest-engine.js`). LUL-2312
  added the same `!winVisible && !deathVisible` gate to `#chargePrompt` and
  `#objective`/`#status` anyway, once all five moved into one component --
  redundant with the engine-side reset for the one-frame gap between
  `triggerDeath()`/`finishPickup()` running and the *next* `tick()` actually
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
  `finishPickup()` either, and can't be gated in React like the elements above since
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
  LUL-2410: the local QA tester's deterministic bounding-box audit found `#hint`
  (flat `top: 64px`) overlapping `#objective`'s `.actionPromptLine` on short
  landscape phones (e.g. iPhone SE landscape, 667x375) — the same short-viewport
  media query (`components/GameCanvas.tsx`, `@media (max-height: 420px) and
  (pointer: coarse) and (hover: none), (max-height: 420px) and (max-width: 768px)`)
  that sets `--action-slot-bottom: 190px` pushes `#actionSlot`'s rows up near the
  top of the screen, into `#hint`'s band, and there's no free vertical gap left to
  relocate either one into. Fixed in the same media query: `#hint { display: none
  !important; }`. `display: none`, not `opacity: 0` (unlike the LUL-2158 fix
  above) — the founder's overlap rule is enforced on raw DOM bounding boxes, so an
  opacity-hidden `#hint` would still occupy its rect and keep tripping the audit
  even though nothing is visibly drawn there; `display: none` collapses the box to
  nothing. `!important` still needed to beat `enter()`'s inline `hint.style.opacity`
  write. `#hint` is a transient onboarding caption the engine already fades out 5s
  after `enter()`, and `#actionSlot`'s own rows carry the info a player needs at
  this viewport, so dropping it here (rather than repositioning it) has no
  functional cost.

  **## e2e (LUL-2410).** `e2e/action-prompt.spec.ts` gained one case in the same
  describe block: boots the micro world at 667x375, asserts `getComputedStyle(#hint)
  .display === 'none'` right after `enter()` (beating the engine's synchronous
  `opacity = '0.85'` write, not just outrunning its fade), then asserts `#hint`'s
  and `#objective`'s `getBoundingClientRect()`s don't intersect. Verified
  non-vacuous by reverting the CSS rule and watching it fail red (`received: "block"`).
  LUL-1103 adds `#runChronicle`, a `<ul>` inside `RunRecap()` (`components/Hud.tsx`)
  below the existing time/payout line: a short chronological log of the run
  ("0:41 — a wolf caught your scent near the Leaning Stone.") instead of only
  a stat dump. Engine-owned: `logChronicle(code, args)` in
  `engine/forest-engine.js` appends a flat `{t, code, args}` entry at each of
  ~8 call sites (`scentOnto()`, the three chase/investigate/flank give-up
  transitions, `enterHide()`, `finishPickup()`,
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
  `*Revealed` flip (sized past `#winText`'s own fade — 0.5s since LUL-2496,
  `#deathText` stays 0.9s), not immediate —
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
  LUL-2496 (Ending Ceremony cheap slice, from Feature Scout proposal LUL-2400):
  `#winDialogue` adds a single fixed dialogue line ("You've brought her home.")
  inside `#winText`, above the existing chronicle-shared closing line — an
  addition, not a replacement, so `chronicle.test.ts`'s assertion on that line's
  canonical phrasing (`lib/game/chronicle.ts`) still holds. The full proposal
  (music stinger, visual glow, warm fog, readable chronicle) is deferred pending
  an art director; only the dialogue line and the fade-duration change above shipped.

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

LUL-2856 adds `#rustleFlash`, a brush-green edge vignette answering "the cover you're sitting
in just made noise" — the cheap slice of LUL-2570 cover degradation. Once `hideTime` clears
`COVER_RUSTLE_THRESHOLD_S` (12s, `lib/game/noise.ts`), `rollCoverRustle()` fires every
`COVER_RUSTLE_INTERVAL_S` (5s) via the tick-loop check next to the existing `hideTime` line
(`engine/forest-engine.js`): it re-runs `enterHide()`'s own roam-only alerted-predator loop
(`checkThrowableNoise`/`hearNoise`, gated `HIDE_ALERT_RADIUS`, never downgrading an
already-chasing/hunting predator), logs a `cover_rustle` chronicle event (`{ alerted }`, QA-only,
mirrors `hide_alert`), sets `rustleFlash` (same edge-vignette shape as `#spotFlash`, subtler peak
and one z-index lower), and plays `rustleSting()` — an escalating 3-burst bandpass sting distinct
from the continuous `leafRustle(true)` ambience already looping while hidden. A one-time
`captionsOn`-gated hint caption fires via `hintSeen`/`markHintSeen('coverRustle')`. Reduced motion
clamps `#rustleFlash`'s opacity to a fixed `0.15` while active instead of animating the decay ramp
(same clamp-not-remove shape `stoneMarkerPulseT` already uses). LUL-4790 (Cover Degradation Full)
scales both by difficulty tier — `DIFFICULTY_PRESETS[tier].rustleThresholdMul`/`rustleIntervalMul`
(`engine/tuning.js`) — lantern 16s/6s, night 12s/5s (unchanged), blackout 8s/4s. Cover-density
scaling remains out of scope (Economist follow-up, not part of the LUL-4629/CEO-accepted "Full"
slice).

LUL-1633 adds `#winPendingCue`, a warm full-bleed vignette answering "the win is resolving" —
the ~2.0s gap between the pickup cinematic's `fireBoom()` keyframe (`e>=9.3`,
`engine/forest-engine.js:6496`) and `finishPickup()` flipping `winVisible` (`e>=11.3`) during
which the boom burst had already decayed but no win text was up yet (LUL-1633 triage). Ramps
from 0 to 0.35 opacity over 1.5s once `winPendingActive` is set at the `fireBoom()` call site,
holds at peak for the remaining ~0.5s, and is naturally superseded when `#winText` fades in
over it (`components/Hud.tsx`, its own existing 0.5s transition). Reduced motion clamps it to a
static `0.2` instead of animating the build (same clamp-not-remove shape `#rustleFlash` uses
above). Not a new interactive feature under `decisions/0015-cue-triple` — it is an additive
layer inside the existing win moment, which already carries its own audio (`playWinMusic()`,
fired at `pickStart` in `pickup()`) and explanation (`#winText`'s "YOU WON"); no new audio or
caption is added.

LUL-3066/LUL-4786 adds the reposition-to-reset itself: `KeyR` (+ touch Shuffle button,
`components/MobileControls.tsx`, next to Hide) while `hidden`, off cooldown, calls
`shuffleHide()` (`engine/forest-engine.js`). Direction comes from held movement keys/touch
stick (same `ix/iz` -> `fx/fz/rx/rz` transform `stepFrame()`'s own movement block uses),
falling back to the player's facing direction when nothing is held; the candidate position is
clamped into the stored `hideSpot` `CoverAABB`'s own footprint (never outside the cover that
was entered) and rejected via `blocked()` if it would land in a collision. On success:
`hideTime` resets to 0 (feeding the exact same self-healing `coverRustleAccum` formula above,
for free — no separate tracker), `SHUFFLE_OFFSET` (`lib/game/cover.ts`) is the shuffle
distance, `isMovingAgainstWind()` (`lib/game/scent.ts`) decides silent-upwind vs.
alert-inducing-downwind (same roam-only alerted-predator loop as `enterHide()`/
`rollCoverRustle()`), `leafRustle(movingAgainstWind)` plays the muffled (2-burst) or fuller
(3-burst) foley, `rustleFlash`/`rustleSting()` fire unconditionally (reusing the cover-rustle
vignette above, not `spotFlash` — a newly-alerted roam predator is a lower-severity event than
a real detection), and a transient `caption`/`captionId` toast reads `'Shifted position'` /
`'Shifted position — noisy'`. First use instead gets the explanatory hint text (one caption
slot per call, not both — `pushState()` calls `emitState()` synchronously with no queue, so a
second call in the same tick would silently drop the first). `shuffleCooldownAccum`
(`SHUFFLE_COOLDOWN_S`, `lib/game/noise.ts`, 2.0s) blocks a repeat press until it decays. Note:
holding a movement key across the press still trips `stepFrame()`'s own pre-existing
"moving breaks cover" check on the very next tick, same as it always has for `KeyH` — the
shuffle's direction-from-held-keys path does not get an exemption from that rule, so the
facing-direction fallback (no key held) is the only path that reliably keeps the player hidden
afterward.

LUL-4526 (Bramble Thorn Snag) prices sprint-diving into the sole hide spot: `enterHide()` and
`exitHide()` (`engine/forest-engine.js`) both check `isSprintHeld()` (new, same-shape mirror of
the per-frame `running` expression, callable outside `stepFrame()`'s scope) against
`spot.kind`/`hideKind === 'bramble'` and, only if the transition happened at a sprint, set
`brambleSnagT` to `BRAMBLE_SNAG_DURATION_S` (`engine/tuning.js`) and play `thornSnagSound()`
(new, same procedural-WebAudio shape as `leafRustle()`/`rustleSting()`, no bus). Walking in/out
(`isSprintHeld()===false`) costs nothing. **LUL-4872 review:** the shipped diff also ran a
second `checkThrowableNoise`/`hearNoise` alerted-predator loop here, gated to a dedicated
`BRAMBLE_SNAG_NOISE_RADIUS` (5); dropped, since `enterHide()`'s own pre-existing unconditional
`HIDE_ALERT_RADIUS` (20) alert already fires on every hide entry regardless of sprint and
5 < 20 always, so the narrower loop could never independently alert a predator the wider one
hadn't already caught. The movement calc's `maxSpd` multiplies in
`brambleSnagSpeedMultiplier(brambleSnagT)` (`lib/game/cover.ts`, pure, `BRAMBLE_SNAG_SPEED_MUL`
while the timer is live, `1` once it decays); the tick loop decays
`brambleSnagT` the same clamp-to-zero way `stoneMarkerPulseT` already does. A one-time
`captionsOn`-gated hint fires via `hintSeen`/`markHintSeen('brambleSnag')`. `qaPlayerState()`
exposes `brambleSnagT` for e2e. Pricing (`BRAMBLE_SNAG_DURATION_S`/`BRAMBLE_SNAG_SPEED_MUL`,
`engine/tuning.js`) is Game Economist territory, shipped with the proposal's example values,
not final tuning.

**What it can do**
- Render every piece of state the engine pushes (`pushState()`, only sends
  a patch when a value actually changed).
- Send **actions back**, never state: the full API `init()` returns
  (L3182-3185) is `enter`, `restart`, `setPace`, `setFog`, `toggleSound`,
  `regenMap`, and nine touch-control setters (`setTouchMove`/`setTouchLook`/
  `setTouchSprint`/`triggerTouchHide`/`triggerTouchInteract`/
  `triggerTouchJump`/`triggerTouchPause`/`triggerTouchToggleRun`/
  `setTouchVeil`, LUL-529) — these are the *only* way React code can affect
  the world.
  No LUL-26 accessibility/difficulty setters exist in this object on `main`.
- The minimap specifically reads and draws another element's live data:
  tree positions (`treeData`, every 4th tree)
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
  exists on `main`.

**Behaviours & logic**
- `hudState` is a single flat object; `pushState()` diffs before emitting to
  avoid redundant React re-renders.

**Collision & physics profile**
- N/A — not a spatial/world object.

---

### Welcome splash (first-visit marketing, LUL-2612)

**What it is**
- A third, independent React-owned overlay (`components/WelcomeSplash.tsx`),
  outside the `hudState`/`EngineHudState` pipeline entirely — no engine touch,
  no `pushState()` field. It reads/writes exactly one localStorage key,
  `lullwood:welcomeSeen`, and is otherwise self-contained: mounted first
  inside `components/GameCanvas.tsx`'s returned fragment, before the
  engine-owned overlay markup and `<Hud>`.
- Shown once per browser (`window.localStorage.getItem('lullwood:welcomeSeen')
  !== '1'`, checked in the `useState` initializer — safe because `GameCanvas`
  only ever mounts client-side via `GameLoader`'s `dynamic(..., { ssr: false
  })`, so there is no SSR/hydration mismatch to guard against). Dismissing it
  (`#welcomeSplashDismiss`) sets the key to `'1'` and unmounts the component;
  it never reappears for that browser.
- `#welcomeSplash` is `position: fixed`, centered via `top/left/transform`,
  `z-index: 60` — the highest of any overlay in `OVERLAY_STYLE`
  (`components/GameCanvas.tsx`), above `#orientationGate` (50) and
  `#settingsPanel` (40), since a first-time visitor should see it before
  either. Content: "Welcome to Lullwood" heading, a short horror-game
  description, a bold `.welcomeSplashStudio strong` studio-credit line
  ("Built by Independence AI Studio!"), a paragraph on the studio/stack/goal,
  and the dismiss button.

**Behaviours & logic**
- No hold-to-act, no new keybinding, no `SettingsPanel` entry — a single
  click/tap dismiss, matching Q16 of `docs/FEATURE_CHECKLIST.md`'s "does this
  add a new input" question with "no, it's a plain button".
- `e2e/helpers.ts`'s `boot()` seeds `lullwood:welcomeSeen` before every other
  spec's `page.goto()` (new `seedWelcomeSplashSeen` option, default `true`) so
  the rest of the suite keeps booting straight to `#gate` — only
  `e2e/welcome-splash.spec.ts` / `e2e/mobile/welcome-splash.spec.ts` opt out
  to exercise the real first-visit path. `e2e/mobile/ui-hygiene.spec.ts` has
  its own local `boot()` (doesn't import `../helpers`) and got the same seed
  added directly.

**Collision & physics profile**
- N/A — not a spatial/world object.

---

### Embers (run currency)

**What it is**
- `embersBalance`: player's persisted currency balance (runs completed,
  predator kills, or other events), stored in `localStorage['lullwood:embers']`
  and synced to `hudState` via `setEmbers()` (in  `engine/forest-engine.js`). Earnable via `computeWinPayout()` /
  `computeDeathPayout()` in `lib/game/economy.ts`, applied via `applyPayout()`
  on win/death via `finishPickup()` / `triggerDeath()`. Both payout functions
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
  both `track()` call sites, in `finishPickup()` (L6068-6128, the win path since
  `LUL-2281`) and `triggerDeath()` (L6425-6466). The `difficulty` module-level
  variable is in scope at both sites. The economy
  dashboard (`lib/dashboard/aggregate.ts`) groups these events by tier into
  `byDifficulty` on `EconomyResult`; events without a `difficulty` field land in
  `unattributed`.
- `loss` telemetry event (LUL-2461): `distance_from_home_m` field added --
  distance from `CONFIG.home` to `player.x/z` at the moment `triggerDeath()`
  (L6425-6466) fires, computed and stored in `deathDistanceFromHomeM` (module-level,
  set at L6433) rather than recomputed later, since `player.x/z` can move on
  once the death screen is up. Deliberately not `maxDistFromHome` (the run's
  furthest point, already used by `computeDeathPayout`) -- this is where the
  run actually ended. Also exposed on `qaProbeDeath()` as
  `distanceFromHomeAtDeathM` (null before any death this run) for e2e
  coverage (`e2e/death-sequence.spec.ts`). `lib/dashboard/aggregate.ts`'s
  `computeOutcomesByTier()` is the per-tier win-rate/run-length/death-distance
  counterpart to `computeOutcomes()` (which pools all tiers) --
  `scripts/win-rate-by-tier.mjs` is the one-shot CLI that filters events to a
  build range (git-ancestry, not string comparison) and prints it.
- `chase_gap` telemetry event (LUL-2392): fired from `scentOnto()` (`engine/forest-engine.js`)
  when a predator re-acquires the player by scent after a chase->roam give-up --
  `duration_ms` is the wall-clock gap, `difficulty` the tier. `p.gaveUpAt` is set at
  all 4 give-up sites and reset in `placePredators()` so a give-up that outlives its
  run never survives into the next one. `qaProbeChaseGap()` exposes the last fired gap
  for e2e coverage (`e2e/chase-gap-instrumentation.spec.ts`). Feeds the Economist's
  LUL-1449 measurement (Deeper Lungs veil-tree re-pricing, LUL-1439):
  `lib/dashboard/aggregate.ts`'s `computeChaseGapByTier()` computes p50/p25 gap per tier,
  `scripts/chase-gap-by-tier.mjs` is the one-shot CLI. **Adding an event to the
  `lib/analytics.ts` emitter union is not enough** -- `lib/dashboard/events.ts`'s
  `KNOWN_EVENTS` is a separate allowlist that `parseRawEvent()` gates every Blob
  read-back on; PR #601 added `chase_gap` to the emitter but missed this file, so every
  emitted event was silently dropped on read until this entry's fix (also caught
  `engine_contract_violation`, LUL-2239, in the same gap). `lib/dashboard/events.test.ts`
  now locks every emitted event name to also being in `KNOWN_EVENTS`.
- Shop catalog (LUL-2351): `SHOP_CATALOG` in `lib/game/economy.ts` is the single
  source of truth for what's for sale — three permanent items, bought via the
  generic `purchase(id)`/`nextCost(id, tier)`/`tierOf(state, id)` trio instead
  of a per-item function. `tiers` is a `Record<string, number>` keyed by
  catalog id; an absent key means tier 0 (not purchased) — `freshEmbersState()`
  starts with `tiers: {}` rather than pre-filling every known id, so a new
  catalog entry needs no save migration.
  - **Deeper Lungs** (`deeperLungs`, tiers 0–3, `DEEPER_LUNGS_COSTS`): each
    tier increases the max veil (mist-dim) hold duration via
    `veilMaxHoldForTier()`.
  - **Quiet Step** (`quietStep`, tiers 0–2, `QUIET_STEP_COSTS`): each tier
    decays scent 20% faster (compounding), via `effectiveScentLifetime()`.
    Lifetime-only — `SCENT_RADIUS_WALK`/`SCENT_RADIUS_RUN` are untouched. Stacks
    multiplicatively with the high-wind `windHighSpeed` lifetime reduction (see the
    wind bullet near `WIND_AGAINST_RADIUS_MULTIPLIER` above).
  - **Pocket Stones** (`pocketStones`, single tier, `POCKET_STONES_COSTS`):
    grants `POCKET_STONES_RESERVE` (2) free throwable stones per run, auto-armed
    into `heldThrowable` on `enter()` and re-armed from the reserve in
    `throwThrowable()`. `throwablesReserve` is pushed to `EngineHudState`
    (LUL-2614) and rendered as a `(+N)`/`(+N in reserve)` suffix on
    `#throwPrompt` when non-zero; the shop's owned-tier copy
    (`shopEffectCopy()`, `components/Hud.tsx`) derives from `tier` instead of
    hardcoding "no reserve stones" once purchased. `canGrabThrowable` also
    gained its first render site, a new `#pickupPrompt` row in `#actionSlot`.
    Price is difficulty-scaled (LUL-2983): 80/120/140 embers for
    lantern/night/blackout, via `POCKET_STONES_COST_BY_DIFFICULTY` — the
    `POCKET_STONES_COSTS` array itself is unchanged (still length 1, a
    placeholder whose only load-bearing property is its `.length` for the
    max-tier gate) so the item stays single-tier; `nextCost()`/`purchase()`
    take an optional `difficulty` arg that special-cases `pocketStones` only.
- `livePileEmbers` (LUL-1315): live, unbanked depth+survival total for the
  run in progress — `hudState` field (`engine/forest-engine.js` L3871),
  reset to 0 on `enter()` (L3961) and recomputed every frame (`stepFrame()`,
  called each `tick()` -- LUL-2071 extracted the per-frame body out of `tick()`
  so a QA test clock can call it directly) while the run
  is neither won nor dead (L6745: `computeDepth(maxDistFromHome) +
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
- Buy any `SHOP_CATALOG` item via `purchase(id)`: costs `nextCost(id, tierOf(state, id))`,
  is a no-op (same object reference) if unaffordable, already maxed, or `id` isn't in the
  catalog. A real purchase plays `embersPurchaseCue()` (decisions/0015-cue-triple's audio
  leg, all three items including Deeper Lungs). Purchases are final, persisted to
  localStorage and synced to `hudState` via the `embersTiers` property.
- Telemetry (LUL-3003): a real purchase also pushes `{id, tier, cost}` (the tier reached,
  the price paid) onto the module-level `purchasesMade` accumulator, which `enter()`
  resets to `[]` at the start of every run and the `win`/`loss` `track()` calls read
  (`.slice()`) into the `purchases_made` field (`lib/analytics.ts`'s `PurchaseRecord`,
  schema added by LUL-2998). `enter()` also emits a `started_tiers` event with a snapshot
  of `embers.tiers` taken the same tick, before that run's own purchases apply. Because
  `EmbersShop` only renders pre-entry (the gate) or on the win/death screens -- never
  while a run is actually in progress -- a purchase always lands either before `enter()`
  resets the accumulator or after that run's own `win`/`loss` already fired, so
  `purchases_made` is legitimately `[]` on every event today; `started_tiers`'s
  before/after tiers diff across consecutive runs is the documented fallback for exactly
  that gap (`docs/TELEMETRY_SCHEMA.md`). `qaProbePurchasesMade()` exposes both live for
  e2e (`e2e/purchases-telemetry.spec.ts`).

**What it CANNOT do**
- Spend on anything outside `SHOP_CATALOG`.
- Be lost/reset except via manual localStorage deletion (QA/debug only, not
  a player-facing action).

**Behaviours & logic**
- Persistence: `useEmbers()` hook in `components/Hud.tsx` (L225-241) reads
  stored balance on engine mount and writes to localStorage whenever balance
  or tiers change. Gated to skip writing stale zero defaults before stored
  state is applied (ref `appliedRef` prevents persist effect from firing until
  apply-on-ready effect has run).
- `veilMaxHoldForTier(tier)` adds `DEEPER_LUNGS_HOLD_SECONDS[tier]` to base
  `VEIL_MAX_HOLD` — each tier adds 1 second to the hold cap (5/6/7/8 seconds
  at tiers 0/1/2/3).
- Win/death screen (and the gate) render one shop button per `SHOP_CATALOG` item
  still below its max tier (`EmbersShop` in `components/Hud.tsx`), each wired to
  `purchase(item.id)`, disabled below that item's `nextCost`. A maxed item renders
  a plain "maxed" row instead of a button.

**Collision & physics profile**
- N/A — not a spatial/world object.

---

### Progression: personal-best time + tier streak counter (LUL-2558)

**What it is**
- `progression`: per-`DifficultyTier` record (`lantern`/`night`/`blackout`) of
  `{ bestTime, runs, wins, currentStreak }`, defined in the pure module
  `lib/game/progression.ts` (`Progression`/`TierRecord`, same shape as
  `lib/game/economy.ts`/`lib/game/outcome.ts` — no I/O, no wall-clock reads).
  `bestTime` is the fastest WIN `survivedSeconds` for that tier (`null` = no
  win yet, lower is better — this is time-to-win, not a score). `runs`
  increments on every outcome (win or death); `wins` and `currentStreak`
  increment only on a win, and `currentStreak` resets to 0 on a death.
  `recordRun(p, difficulty, survivedSeconds, won)` is the one pure transition,
  called at both outcome sites — `finishPickup()` (the win path) and
  `triggerDeath()`.
- Persisted via `localStorage['lullwood:progression']`, synced to `hudState`
  through the engine action `setProgression()` (mirrors `setMissionUnlocks()`),
  applied once on mount and re-validated field-by-field against an
  arbitrary/stale stored shape rather than trusted as-is.
- HUD fields: `personalBest` (current-tier `bestTime`), `tierStats`
  (`{ runs, wins, streak }` for the current tier), `newRecord` (true only when
  the run just beat a strictly-lower `bestTime`).

**What it can do**
- Set a new personal-best time on a win that is strictly faster than the
  tier's existing `bestTime` (or the tier's first-ever win).
- Extend a win streak across consecutive wins; a single death resets it to 0
  without touching `bestTime` or `wins`.

**What it CANNOT do**
- Regress `bestTime` on a slower win, or set one on a death.
- Affect economy: `recordRun()`/`setProgression()` never read or write
  `embers`, `RunPayout`, or any `applyPayout()` call.

**Behaviours & logic**
- Persistence: `useProgression()` hook in `components/Hud.tsx`, identical
  two-effect split to `useMissionUnlocks()` — apply-on-ready effect calls
  `actions.setProgression?.(stored)` once `actions` exists, persist effect
  writes the full record to localStorage on change, gated on the same
  `appliedRef` guard so a fresh mount can't overwrite a stored record with
  `freshProgression()` before the apply effect runs.
- Display: `RunRecap` in `components/Hud.tsx` renders "Personal Best:
  `<time>` — New Record!" (only when `personalBest` is set) and a
  "`<tier>` stats: Runs N · Wins N (P%) · Streak N" line, reusing the
  existing `formatDuration()` helper. Text-only per the ticket's scope trim —
  no icon/glow/chime polish.

**Collision & physics profile**
- N/A — not a spatial/world object.

---

### Stamina (sprint resource)

**What it is**
- `staminaCharge`: player's sprint-capacity meter, state in `engine/forest-engine.js` (L327), driven by `stepStamina()` and `sprintSpeedMul()` in `lib/game/stamina.ts`. Tracks the player's ability to sprint — the meter drains while running and refills while walking or idle.
- **Live as of `LUL-1113`**: The player's top sprint speed is no longer uncapped — sprinting at full stamina approaches `CONFIG.walk*1.8` (10.8 u/s), but this multiplier decays as the stamina meter drops toward zero, scaling movement speed via `sprintSpeedMul(staminaCharge)`. Prevents unlimited outrunning of predators.
- Audio cue (`staminaExertionCue()`): a short breath/exertion tone (~200Hz sine, 0.25s decay) plays once when stamina drops below 0.45 charge, and resets the cue as soon as stamina climbs back past 0.55 (hysteresis bands `0.45`/`0.55`, `staminaLowCuePlayed` flag). Also pushes a caption (`'breathing hard'`) when captions are on.

**What it can do**
- Gate the player's sprint speed (`stepFrame()` at L6884, LUL-2071's extracted per-frame body): `maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) * ...`, so the player still moves at walk pace when running with zero stamina, but gains speed as stamina refills.
- Play an audio telegraph when nearing zero charge, so the player knows they're nearly exhausted.
- Reset to full on each new run: `staminaCharge = 1` on `restart()` (alongside `staminaLowCuePlayed`).
**What it CANNOT do**
- Cannot prevent the player from moving at all — sprinting with zero stamina falls back to walk speed, not immobilization.
- Does not interact with any other world element (predators, cover, etc.) — purely a player-state resource.
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
- **Implemented (LUL-1259, widened LUL-3010).** `MISSION_POOL` (`lib/game/mission.ts`): a pool of
  optional detour objectives, one active per run, drawn from the run's own seeded RNG (never
  player-selected). Three members: `deepwater` — a fixed waypoint at the fire tower landmark
  (`x: -95, z: -95`, matching `LANDMARKS`' `fireTower` entry, `engine/tuning.js:77`) —
  `oakHollow` — a near waypoint at the `oak` landmark (`x: 22, z: 4`, `engine/tuning.js:80`) —
  and `slackWater` (LUL-4958) — no world target at all, completes on pickup during Fog Tide's
  active phase (see below). Per-run state (`mission: MissionState | null`) lives alongside
  `baby` at `engine/forest-engine.js:885`, drawn once per `generateMap()` call, after every
  other rng() consumer, so it never shifts the stream any existing seed/replay depends on.

**Three variants (LUL-3010, LUL-4958)**
- `oakHollow` — near (≈22.4m from spawn), untimed, `MISSION_OAKHOLLOW_REWARD` = 6 Embers.
  Always eligible.
- `deepwater` — far (≈134.4m from spawn), `timeLimitSeconds: 60`, `MISSION_FIREPOWER_REWARD` = 8
  Embers. Only eligible once `eligibleMissionPool()` (`lib/game/mission.ts`) sees
  `progression[difficulty].wins >= MISSION_FAR_UNLOCK_WINS` (3) — below that, `pickMission()` only
  ever draws `oakHollow`. A returning player with existing win history keeps seeing `deepwater`
  immediately; a fresh/reset progression starts gated to the safe variant.
- `MissionState.status` widens to `'active' | 'complete' | 'expired'` — `checkMissionExpiry()`
  flips `deepwater`'s status to `'expired'` the instant survived time passes its `timeLimitSeconds`
  (checked every tick), forfeiting the bonus without failing the run. `oakHollow` has no
  `timeLimitSeconds` and can never expire. `#missionPanel`'s glyph is `●` complete / `✕` expired /
  `○` active; `#missionTimer` renders the countdown only while a `timeLimitSeconds` is set.
  `?qaMissionKind=<kind>` (under `?qaHooks=1`) forces the draw to a single kind for deterministic
  test coverage; `qaShrinkMissionTimer(seconds)` stages an imminent expiry.
- No verbs of its own — completion rides the existing interact action (`KeyE`
  (`engine/forest-engine.js:1689`) / `triggerTouchInteract()` (`:3635`), the same key/button
  that already lifts the child), gated on a `missionCanComplete` check computed alongside
  `canPickup` (`:3430`).
- `slackWater` — no world target (`spatial: false`, `lib/game/mission.ts`); completes when
  the player accepts the child pickup (`pickup()`, `engine/forest-engine.js`) while Fog Tide
  (LUL-27) is in its `'active'` phase, `MISSION_SLACKWATER_REWARD` = 10 Embers. Checked once,
  at the instant `pickup()` is accepted, not re-checked or expirable afterward -- there is
  only one pickup per run (`decisions/lul-2281-pickup-is-the-win-2026-09-09`). No secondary
  support (`SECONDARY_SUPPORTED_MISSIONS` unchanged). Produces no mission-nav hum (the
  `spatial: false` gate on `missionWaypointHum`'s call site). Renders in the existing, generic
  `#missionPanel` like every other mission kind while active (`MISSION_NAMES.slackWater` =
  "Slack Water", glyph `○` — see "show a two-line collapsed HUD panel ... whenever a mission
  exists" below, which already covers this kind with no gating by name) — this ticket ships no
  *new* HUD code (LUL-1098's territory is a new panel/copy system for missions generally), but
  the panel is real and player-visible today. Like every mission kind, the panel unmounts the
  instant `pickup()` is accepted (`pickingUp: true` excludes `isPlaying()`, and the `if(playing)`
  HUD-state gate nulls `missionKind`/`missionStatus` in the same tick) — the `●` complete glyph
  never actually renders for any mission kind, pre-existing behavior unchanged by this ticket.

**What it can do**
- Add a completion bonus to the win payout only, keyed by kind via `MISSION_REWARDS`
  (`lib/game/economy.ts`, `deepwater: MISSION_FIREPOWER_REWARD = 8`, `oakHollow:
  MISSION_OAKHOLLOW_REWARD = 6`, `slackWater: MISSION_SLACKWATER_REWARD = 10`), passed as
  `computeWinPayout()`'s optional fourth argument at the `finishPickup()` call site.
  **Forfeited on death or expiry** — `computeDeathPayout()` is
  unmodified, so reaching the mission target but dying before reaching home banks no bonus; a
  `deepwater` mission that times out (`status: 'expired'`) also forfeits the bonus even on a
  win, since the payout site only pays `status === 'complete'` (the detour's real payout is the
  `depth` term, already uncapped on win / capped on death; the mission bonus is a small addition
  on top, not the source of the risk/reward).
- Emit a repeating, non-predator-audible navigational audio cue (tempo-shortens with proximity,
  same shape as Ship 1's `childCry` wayfinding pattern) whenever a *spatial* mission is active
  (`missionWaypointHum()`, `engine/forest-engine.js`, gated on `mission.target.spatial !==
  false` — `slackWater` has no target to hum toward, so it produces none).
- Fire a one-time unconditional caption + audio sting on completion, and show a two-line
  collapsed HUD panel (name + progress glyph) top-left whenever a mission exists — mirrors the
  Embers/Stamina HUD-reflection pattern above, not a new panel system. **LUL-2442:** also hidden
  while `components/GameMenu.tsx`'s dropdown is open — its open panel shares the same top-left
  corner and would otherwise overlap the mission pill.

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
  arrive-home) and `speedrun` (arrive home within `MISSION_FIREPOWER_SPEEDRUN_SECONDS` = 240s of
  entering). Evaluated once, at `finishPickup()`, via `secondaryComplete()`.
- Pays an additive bonus on top of `MISSION_FIREPOWER_REWARD` at the moment of winning:
  `FIREPOWER_RETRIEVAL_BONUS` = 8 or `FIREPOWER_SPEEDRUN_BONUS` = 10 Embers
  (`lib/game/economy.ts`), passed as `computeWinPayout()`'s new fifth argument. Win-only —
  `computeDeathPayout()` is unmodified, same rule as the baseline mission bonus.
- **Never gates the baseline win.** Failing (or not attempting) the secondary never fails
  the win — `lib/game/outcome.ts` is untouched by this feature.
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
  (speedrun), hidden whenever no secondary is attached.

**Collision & physics profile**
- N/A — not a spatial/world object. The mission *target* (the fire tower) is a `LANDMARKS`
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

### Wayfinding (LUL-1255 Ship 1: S2/S3/S6)

**What it is**
- **Implemented (LUL-1674), S2/S3/S6 of the Ship 1 wayfinding spec.** No new verbs and no new
  collision for either piece below — both are passive visual/audio anchors. S1 (home-light
  reach) is a separate ticket (LUL-1851) and is not covered here. **S4 (carried-noise floor,
  LUL-1857) and S5 (home fire crackle) were carry-leg-only channels gated on `carrying`; `LUL-2285`
  (2026-09-23) deleted both** along with the rest of the carry-home machinery
  (`playCarryStartCue()`, `homeFireCrackle()`/`homeFireTimer`, the `carriedCryPulse` pulse and its
  `updatePredators` read, the `p.inv = 'leave'` give-up phase, and `CARRIED_NOISE_FLOOR` in
  `lib/game/noise.ts`) -- none of it is in the codebase anymore.
- **Landmark navigability cue (S2).** The four original `LANDMARKS` entries (`fireTower`,
  `stoneMarker`, `oak`, `drownedCar`, `engine/tuning.js`) already function as a navigable
  coordinate system; `enter()` (`engine/forest-engine.js`) now fires a one-time, unconditional
  (not gated on `captionsOn`) caption on run start — `"landmarks in the fog are safe to
  navigate by"` — as a nav tip, not a repeating audio-cue caption.
- **The child's cry (S3).** `childCry(distToPlayer, srcX, srcZ)` (`engine/forest-engine.js`) is
  a procedural, panned-by-bearing tone toward an explicit source position, same tempo/pitch-
  carries-distance shape as the mission hum it predates in design (`missionWaypointHum()`
  mirrors it), driven by a `cryTimer` countdown (5.5s far / 2s close) inside the same block that
  already renders the child's idle glow. A roaming predator can also hear it:
  `checkNoise(p, Math.hypot(baby.x-p.x, baby.z-p.z), cryNoiseRadius, dt)` is a second,
  independent hearing check (last in the roam state's detection chain — sight, scent, footstep,
  then cry) against the child's own fixed position, not the live player, resolved via
  `hearCry(p)` which reuses LUL-1623's `p.noiseTarget`/`p.noiseTargetT` point-target primitive
  (`p.noiseTargetT = Infinity` — the cry doesn't time out like a thrown decoy's landing spot, it
  keeps sounding until the predator arrives). This channel is gated off entirely once
  `baby.taken`. `CRY_NOISE_RADIUS = 32` (`lib/game/noise.ts`), fog-tide-scaled at the child's
  position (`fogTideGlowRangeMul(fogTideAmountAt(baby.x, baby.z, ...))`); predator spawn
  exclusion around the child raised from 26 to 34 units so nothing spawns already inside the
  cry's audible range. Caption (gated on `captionsOn`): `"a child crying · <near|far> · <side>"`.
  **e2e (LUL-2667 6/6):** `e2e/wayfinding-cry.spec.ts` stages a roaming wolf inside/outside
  `CRY_NOISE_RADIUS` of the child but always far outside sight/scent/footstep range of the
  (stationary) player, and asserts `p.alertedBy` (exposed by `qaProbePredatorState`) reads
  `'cry'` only in the in-range case. S2's landmark cue already has full coverage —
  `e2e/hints.spec.ts`'s "the landmark hint fires once on entry and never again".

**What it can do**
- Both pieces are passive: no new key binding, no new `EngineActions` method, no new touch
  target. Nothing here changes what the player or a predator can physically do beyond the
  hearing channel described above (S3).

**What it CANNOT do**
- Cannot be re-triggered manually or skipped — both cues are driven purely by elapsed-time
  timers and world state (`baby.taken`), not player input.
- The cry cannot pull a predator toward the live player — that's the exact bug this design
  fixes by targeting `baby.x/z` via `p.noiseTarget`, not the live-player-anchored
  `checkNoise`/`hearNoise` path every other hearing channel uses.

**Collision & physics profile**
- N/A for both pieces — no new geometry, no new spatial structure. The hearing check reuses
  ordinary Euclidean distance and the existing `checkNoise`/`isNoiseHeard`/`hearNoise` predicates
  unchanged.

---

### Stone Marker veil-charm (LUL-1210)

**What it is**
- **Implemented (LUL-2067/LUL-1210).** A one-shot in-run spend at the Stone Marker landmark
  (mesh/collider already shipped, LUL-374): 15 unbanked Embers buys a "reserve" that snaps a
  fully-drained mist-veil (`KeyF`) back to its unlock threshold instead of locking it out, the
  next time a full drain would otherwise happen. Second in-run Embers spend site, after Deeper
  Lungs (which is a between-run purchase, not in-run).
- Purchase gate `canBuyVeilCharm`, computed every tick (`engine/forest-engine.js:6162`):
  `!veilReserve && distStoneMarker < VEIL_CHARM_INTERACT_RADIUS &&
  computeDepth(maxDistFromHome) >= VEIL_CHARM_PRICE`. `VEIL_CHARM_INTERACT_RADIUS` (4 units,
  `engine/tuning.js:68`) and `VEIL_CHARM_PRICE` (15, `lib/game/economy.ts:74`).
- `buyVeilCharm()` (`engine/forest-engine.js:5207`): sets `veilReserve = true`, adds
  `VEIL_CHARM_PRICE` to `embersSpent`, fires a caption + `feature_engagement`/`veil_charm`
  telemetry event.
- `stepVeilCharge()`'s `reserve` branch (`lib/game/veil.ts:59`): on a full drain, if `reserve` is
  true it snaps `charge` back to the unlock threshold and clears `reserve` instead of setting
  `locked`; identical to prior behaviour when `reserve` is false.
- **Cue triple (LUL-2331/LUL-2321 Part 1).** Explain: the persistent offer prompt (below) names
  the mechanic. Purchase tell: `buyVeilCharm()` calls the existing `embersPurchaseCue()`
  (`engine/forest-engine.js:5345`, shared with every `SHOP_CATALOG` item) and sets
  `stoneMarkerPulseT = 0.6`, a one-shot boost on top of the Stone Marker's ambient beacon-glow
  pulse (`engine/forest-engine.js`, the `landmarkBeaconGlows` loop, ~`:6331-6340`), decayed
  once per frame in `tick()`. Activation tell: the `reserveFired` block calls the new
  `veilCharmReleaseCue()` (`engine/forest-engine.js:5361`, a descending 880→440Hz sweep, the
  inverse of `embersPurchaseCue()`'s rising one, so the two are distinguishable by sound alone)
  and `Hud.tsx` eases its own rendered `veilCharge` readout up over 0.4s
  (`useVeilMeterRamp`, `components/Hud.tsx:650`) with a brief flash class on `#veilState`,
  skipped outright when `reducedMotion` is set. `veilReserve` is exposed to React via
  `pushState` for a `#veilCharmPip` (`✦`) next to `#veilState` while a charm is banked — note
  `#veilState` lives inside `#panel`, hidden by default (admin-mode-gated, `e2e/admin-mode.spec.ts`),
  so the pip/eased-meter are dev-visible only; the audio cues, the beacon pulse, and the prompt
  text below are the player-visible/audible tells.

**What it can do**
- Reachable via both interact paths: desktop `KeyE` and mobile `triggerTouchInteract()` (the
  existing tap-and-hold interact target — no new touch control), same shape as pickup/mission
  completion.
- Deduct the spend from the run's live unbanked pile display (`livePileEmbers`) immediately, and
  from the final payout via `applySpend()` (`lib/game/economy.ts`), applied at both `finishPickup()`
  and `triggerDeath()` so the spend is honestly reflected whether the run ends in a win or a death.

**What it CANNOT do**
- Never a second currency/spend UI surface — a single in-world interact prompt, not a shop panel.
- Cannot fail for lack of funds in normal play: by the Stone Marker's fixed 125-unit distance from
  home, `computeDepth(maxDistFromHome) >= 31` by geometry at the point of purchase, a 16-point
  margin over the 15-point price (the `computeDepth(...) >= VEIL_CHARM_PRICE` guard is kept as a
  correctness backstop, not removed as dead code).
- Only one reserve may be banked at a time (`!veilReserve` in the gate) — cannot stack multiple
  charms.

**Behaviours & logic**
- Reset per-run: `veilReserve = false; embersSpent = 0;` in `enter()`.
- HUD prompt text (`engine/forest-engine.js:6238`, the `objectiveText`/`objectiveReady`
  `pushState()` block): `'Press  E  for a mist-charm  ·  15 embers  ·  saves your veil from
  locking, once'` (LUL-2331) when `canBuyVeilCharm` and no higher-priority prompt (pickup/carry/
  mission) applies; `objectiveReady` is `canPickup || canBuyVeilCharm`.
- `RunRecap` (`components/Hud.tsx`) renders a `· −{payout.spent} charm` fragment when
  `payout.spent > 0`, so the earnings breakdown still reads as sums to `total` after a spend.
- QA hooks (LUL-2331): `qaTeleportNearStoneMarker()` (`engine/forest-engine.js:4989`) teleports
  2 units off the landmark's live position; `qaProbeVeil()` (`:4996`) returns
  `{ charge, locked, reserve, releaseCueCount }`.

**Collision & physics profile**
- N/A — not a spatial/world object of its own. Uses the Stone Marker landmark's existing
  decorative/navigational collision profile (`landmarkGroups.stoneMarker.position`, live post-nudge
  position), unchanged by this entry.

### Chapel Sanctuary (LUL-5005, free `veilReserve` refuge)

**What it is**
- **Implemented (LUL-5005, cheap slice).** A second, free route to the same `veilReserve = true`
  the Stone Marker charm above sells for Embers: shelter at the `chapelSteeple` landmark
  (`x:20, z:-178`, `engine/tuning.js:69`) for a full `CHAPEL_SANCTUARY_DURATION` (15s,
  `engine/tuning.js:94`) dwell and leave with the charm, no Embers spent. One-shot per run --
  once granted, the chapel offers nothing more that round. Retargeted 2026-09-24 from an earlier
  `veilCharge` premise the CEO ruled false (`veilCharge` free-regenerates unconditionally in
  ~10s, `stepVeilCharge()`, `lib/game/veil.ts:47-71`) -- see wiki
  `decisions/chapel-sanctuary-retarget-veilreserve-2026-09-24`.
- State (`engine/forest-engine.js:601`): `chapelSanctuaryActive` (live dwell gate),
  `chapelSanctuaryChargeT` (countdown, decremented in `tick()`), `chapelSanctuaryUsedThisRun`
  (one-shot gate -- true ONLY once the full dwell actually completes, see below).
- Prompt gate `chapelSanctuaryPromptVisible`, computed every tick alongside `canBuyVeilCharm`
  (`engine/forest-engine.js:7135`): `chapelSanctuaryInRadius && !chapelSanctuaryUsedThisRun &&
  !chapelSanctuaryActive`, where `chapelSanctuaryInRadius` is `distChapel <
  CHAPEL_SANCTUARY_INTERACT_RADIUS` (4 units, `engine/tuning.js:93`, same radius shape as
  `VEIL_CHARM_INTERACT_RADIUS`).
- `startChapelSanctuary()` (`engine/forest-engine.js:5947`): sets `chapelSanctuaryActive = true`,
  `chapelSanctuaryChargeT = CHAPEL_SANCTUARY_DURATION`, fires an entry caption + start cue. Does
  **not** grant anything itself -- the grant only happens in `tick()`'s active-dwell branch
  (`engine/forest-engine.js:7242`) on the full-countdown edge, so the one-shot gate can only close
  on a real completed dwell (Q1.5), never on the E-press that starts it.
- Two exits from the active-dwell branch: full dwell (`chapelSanctuaryChargeT` reaches 0) sets
  `veilReserve = true`, `chapelSanctuaryUsedThisRun = true`, fires the caption + cue and a
  one-shot beacon-glow pulse (`chapelSanctuaryPulseT`, mirrors `stoneMarkerPulseT`); leaving the
  interact radius by more than 1.5x before the countdown completes cancels the dwell
  (`chapelSanctuaryActive = false`, `chapelSanctuaryChargeT = 0`) and grants nothing -- the
  one-shot gate stays open for a later retry the same run.
- **Cue triple.** Explain: entry caption (`startChapelSanctuary()`) names the mechanic and the
  one-time-per-run rule. Grant tell: reuses `buyVeilCharm()`'s own `embersPurchaseCue()`
  (`engine/forest-engine.js:6058`) and caption (`'a charm against the mist'`) so the charm reads
  identically whichever route granted it, plus the beacon-glow pulse above. Refusal tell
  (`chapelSanctuaryDeniedCue()`, `engine/forest-engine.js:6213`): pressing `KeyE` in radius after
  the gate is already closed fires the same square/100Hz/~0.17s buzz as
  `rockClimbDeniedCue()` (`:6137`, "the codebase's one existing 'input was refused' cue") plus a
  caption, gated on `captionsOn` same as that precedent. Early-exit tell
  (`chapelSanctuaryEarlyExitCue()`, `:6226`): a distinct, quieter triangle tone + caption --
  explicitly NOT the denied buzz, since leaving early is a non-event, not a refusal.

**What it can do**
- Reachable via both interact paths: desktop `KeyE` and mobile `triggerTouchInteract()` (the
  existing shared "E" tap target, `components/MobileControls.tsx:342`) -- identical priority
  slot to `canBuyVeilCharm`, right after it in both the keydown handler
  (`engine/forest-engine.js:3082-3095`) and `triggerTouchInteract()` (`:7658-7667`).
- Can be attempted, abandoned, and re-attempted freely in the same run as long as the full dwell
  never completes -- only a completed grant closes the gate.

**What it CANNOT do**
- Cannot double-grant: `canBuyVeilCharm` already reads `!veilReserve`, so once the chapel grants
  it, the Stone Marker purchase prompt correctly stops offering itself, and vice versa.
- Cannot fire both routes' triggers in the same frame -- the two landmarks are placed >100 units
  apart (`engine/tuning.js` `LANDMARKS`), so `distStoneMarker` and `distChapel` can't both be
  inside their respective radii at once.
- No new HUD readout for `veilReserve` itself -- reuses the existing Stone Marker `#veilCharmPip`
  tell unchanged; this feature only adds a second way to flip the same flag.
- No animated shelter pose, no interior-glow mesh, no wind-chime ambience loop -- deferred to a
  Tier B full-feature pass (the cheap slice's visual/audio tell is the existing landmark
  beacon-glow pulse, boosted on grant, same mechanism as the Stone Marker's `stoneMarkerPulseT`).

**Behaviours & logic**
- Reset per-run, same site as `veilOverloadUsedThisRound` (`engine/forest-engine.js:1402`, inside
  `enter()`, called by both initial boot and `restart()`): `chapelSanctuaryActive = false;
  chapelSanctuaryChargeT = 0; chapelSanctuaryUsedThisRun = false;`. Deliberately NOT reset on
  `arriveHome()`/child set-down -- that carry-leg path is dead in real play
  (`decisions/lul-2281-pickup-is-the-win-2026-09-09`), so there is no in-run scenario needing an
  earlier reset.
- HUD: `#chapelSanctuaryPrompt` row in `#actionSlot` (`components/Hud.tsx:1222`,
  "Press  E  for chapel sanctuary — shelter 15s for a free charm against the mist"), visible
  while `chapelSanctuaryPromptVisible`. `#chapelSanctuaryPanel` (`components/Hud.tsx:1036`),
  sibling of `#caveImmunePanel`/`#rockClimbPanel`/`#veilOverloadPanel` outside `#panel` (stays
  visible with `adminMode` off, Q3), "Sanctuary · Xs" countdown while `chapelSanctuaryActive`.
- QA hooks: `qaProbeChapelSanctuary()` (`engine/forest-engine.js:5652`, mirrors
  `qaProbeRockClimb()`'s shape -- `{ chapelSanctuaryActive, chapelSanctuaryChargeT,
  chapelSanctuaryUsedThisRun, promptVisible, startCueCount, deniedCueCount,
  earlyExitCueCount }`), `qaTeleportNearChapel()` (`:5664`, mirrors
  `qaTeleportNearStoneMarker()` -- 2 units off the landmark's live position, unaffected by
  `applyQaWorldMicroPreset()` since `LANDMARKS` positions are untouched in the micro world).

**Collision & physics profile**
- N/A — not a spatial/world object of its own. Uses the `chapelSteeple` landmark's existing
  decorative/navigational collision profile (`landmarkGroups.chapelSteeple.position`, live
  post-nudge position), unchanged by this entry.

See wiki `game/mechanics/chapel-sanctuary.md`.

---

### Cold Walk (LUL-4960, M5 outbound-leg walk-only constraint)

**What it is**
- Opt-in run modifier: if `coldWalkOptIn` is set (Settings, persisted, applied at the next
  `enter()`/`restart()`), the player forfeits a win-only `COLD_WALK_REWARD` (8, placeholder,
  `lib/game/economy.ts:100`) the instant they sprint before accepting the child pickup.
- State (`engine/forest-engine.js:597`): `coldWalkOptIn` (persisted setting), `coldWalkBroken`
  (per-run, sticky once true, reset in `enter()`).
- Pure predicate `coldWalkJustBroke()` (`lib/game/coldWalk.ts`) — true when opted in, not
  already broken, not mid-pickup (`!pickingUp`), and `running` — checked every frame right
  after `running` is computed (`engine/forest-engine.js:6812`, inside the `if(playing &&
  !hidden)` movement block).
- `setColdWalkOptIn()` (`engine/forest-engine.js:6470`) mirrors `setCaptions`/
  `setReducedMotion`'s shape.
- Reward folded into `computeWinPayout()`'s `total` as a 6th optional arg, `coldWalkBonus`
  (`lib/game/economy.ts:116-131`), same additive-only shape as `missionBonus`/`secondaryBonus`
  — no new `RunPayout` field. Computed in `finishPickup()` (`engine/forest-engine.js:6048`):
  `(coldWalkOptIn && !coldWalkBroken) ? COLD_WALK_REWARD : 0`.

**What it can do**
- Sprinting is never blocked — opting in only changes whether the bonus survives.
- The constraint window is `enter()` to `pickup()` (not `finishPickup()`): sprinting during the
  ~11.3s pickup cinematic does not break it, since `coldWalkJustBroke()` gates on `!pickingUp`.

**What it CANNOT do**
- No countdown, no readout for `COLD_WALK_REWARD` itself — follows the `missionBonus`/
  `secondaryBonus` precedent of no independent payout-screen line item.
- Never pre-selected — defaults `false`, single checkbox, not a list (2026-09-01 acceptance).

**Behaviours & logic**
- Reset per-run in `enter()` (`engine/forest-engine.js`, next to `embersSpent = 0`):
  `coldWalkBroken = false`.
- HUD: `#coldWalkPanel` (`components/Hud.tsx:1036`), sibling of `#rockClimbPanel`/
  `#veilOverloadPanel` outside `#panel` (stays visible with `adminMode` off, Q3), text swap
  only — "Cold Walk — silent" / "Cold Walk — broken" — visible while `coldWalkActive`
  (`coldWalkOptIn && !pickingUp`, per-frame `pushState`). Settings checkbox in the new "Run
  modifiers" `<fieldset>` (`components/SettingsPanel.tsx`).
- Cue: `coldWalkBrokenCue()` (`engine/forest-engine.js:6315`) — one-shot falling sine
  (320→140Hz), gated by `soundOn`, plus a caption ("sprinted — the cold walk is broken") gated
  by `captionsOn`, fired the frame the constraint first breaks.
- No `qaXxx` hook — driven entirely by the real Settings/localStorage path and the real sprint
  key, per the SPEC's Q1.5/Q11.

**Collision & physics profile**
- N/A — player-input-only mechanic, no world geometry.

See `docs/specs/lul-4960-cold-walk.md`.

---

## The interaction matrix

Every pairwise combination of the 17 elements above, physical/geometric
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

| | PL | CH | WO | BE | LI | TR | RO | LO | BR | GR | HO | FO | FL | MI | UI | EM |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **PL** Player | · | TRIG¹ | TRIG² | TRIG² | TRIG² | C+LOS³ | C+LOS+TRIG²⁵ | LOS²⁰ | LOS+HIDE²² | STAND | TRIG⁵ | – | ATT | TRIG²⁴ | TRIG⁶ | TRIG²¹ |
| **CH** Child | | · | **U**⁷ | **U**⁷ | **U**⁷ | – | – | – | – | STAND | – | – | – | – | TRIG⁶ | TRIG²¹ |
| **WO** Wolf | | | C⁹ | C¹⁰ | C¹⁰ | C(trunk)+LOS³ | C+LOS²³ | LOS only¹¹ | LOS only¹¹ | STAND | – | – | – | – | TRIG⁶ | TRIG²¹ |
| **BE** Bear | | | | C¹³ | C¹⁰ | C(trunk)+LOS³ | C+LOS²³ | LOS only¹¹ | LOS only¹¹ | STAND | – | – | – | – | TRIG⁶ | TRIG²¹ |
| **LI** Lion | | | | | C¹³ | C(trunk)+LOS³ | C+LOS²³ | LOS only¹¹ | LOS only¹¹ | STAND | – | – | – | – | TRIG⁶ | TRIG²¹ |
| **TR** Tree | | | | | | · | –¹⁴ | –¹⁴ | –¹⁴ | STAND | –¹⁶ | – | – | – | render¹⁷ | – |
| **RO** Rock | | | | | | | · | –¹⁸ | –¹⁸ | STAND | –¹⁶ | – | – | – | – | – |
| **LO** Log | | | | | | | | · | –¹⁸ | STAND | –¹⁶ | – | – | – | – | – |
| **BR** Bramble | | | | | | | | | · | STAND | –¹⁶ | – | – | – | – | – |
| **GR** Ground | | | | | | | | | | · | STAND | – | – | – | – | – |
| **HO** Home | | | | | | | | | | | · | – | – | – | – | TRIG²¹ |
| **FO** Fog | | | | | | | | | | | | · | – | – | – | – |
| **FL** Follow-light | | | | | | | | | | | | | · | – | – | – |
| **MI** Missions | | | | | | | | | | | | | | · | TRIG⁶ | TRIG²¹ |
| **UI** HUD/UI | | | | | | | | | | | | | | | · | – |
| **EM** Embers | | | | | | | | | | | | | | | | · |

¹ Pickup (`distBaby<3.6`) — proximity, not collision. **LUL-2281** (2026-09-09) made
the pickup cinematic itself the win, so there is no carry-follow leg after it.
² Catch/death (`dist<p.rad+1.3`) — proximity, not collision. Player and
predators never call `blocked()`/`blockedR()` against each other.
³ Only trees tagged `s>1.4` (`coverData`); smaller trees block movement but
not sight.
⁵ **Historical.** Used to be the walk-home win trigger (`dh<CONFIG.home.r`,
gated on `carrying===true`). `LUL-2281` moved the win to the pickup cinematic
(see footnote ¹); `LUL-2285` (2026-09-23) deleted this trigger along with the
rest of the carry-home machinery — Player/Home no longer interact.
⁶ HUD reflects state derived from this element (objective/status/caption
text, death/win screens) but never collides with or is collided into.
⁷ **Notable.** No runtime check ever compares a predator's position to the
child's — only a spawn-time clearance (`placePredators()`). A predator can
stand on an un-collected child indefinitely with no reaction from either
side. Filed as **LUL-393**.
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
¹³ Bears and lions are explicitly solitary — no pack *coordination* exists
for either species (LUL-24 comment: "bears stay solitary... the contrast is
the point"). That's targeting/flanking logic only; as of **LUL-394** they
still physically collide with same-species packmates via
`predatorSeparationPush()`, the same as every other predator pairing — see
⁹/¹⁰.
¹⁴ **Fixed, LUL-396/LUL-450.** `generateCover()` now rejects a
candidate rock/log/bramble whose own footprint circle overlaps a nearby
tree's trunk collision circle (`treesNear()` + `overlapsTreeTrunk()` in
`lib/game/cover.ts`) before placing it, same as the `inSpawn()`/
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
²⁰ **Changed, LUL-384; changed again, LUL-2311.** LUL-384: previously
`C+LOS+HIDE` like Bramble. Log became one of the cover kinds that doesn't
block the player's movement — `coverKindBlocksMovement('log')` is `false`
(`lib/game/cover.ts`), read by `coverBlockedR()`. At the time, LOS and
hide-spot eligibility were untouched (both read `coverGrid` independently
of `coverBlockedR()`), so Log kept `LOS+HIDE`; only the `C` was gone.
LUL-2311: `HIDE_KINDS` dropped `log` entirely (founder brief: a fallen log
is thin, walkable cover with nothing to visually be "inside" of) — Log now
keeps `LOS` only. The walkable-movement exemption is unaffected and now
lives on its own constant, `WALKABLE_KINDS` (`lib/game/cover.ts`), which
`coverKindBlocksMovement('log')` reads instead of `HIDE_KINDS`.
²¹ **Embers** (LUL-1043) is a run-currency event tracker, not a spatial
object — no movement collision or LOS interaction. `TRIG` marks events where
Embers earnings are computed: Player earnings/spending gate, Child pickup
earning trigger, Predator kill earning trigger, Home arrival earning trigger,
Mission completion earning trigger (`MISSION_REWARDS`/secondary bonuses,
`lib/game/economy.ts` — win-only, forfeited on death or expiry, see Missions
section).
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
neither a hiding spot, are unaffected. **LUL-2311** later removed Log from
`HIDE_KINDS` (²⁰) — Bramble is now the only cover kind with `HIDE` at all,
so this cell (`LOS+HIDE`) is unchanged but no longer has a Log counterpart
to match.
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
²⁴ **Missions** (LUL-1259/LUL-3010/LUL-1666) — proximity + interact trigger,
not a collider. `missionCanComplete` (`engine/forest-engine.js:7048`),
computed alongside `canPickup` (`:7021`), gates completion on distance to
the mission's target waypoint (or, for the `retrieval` secondary, the
`radioMast` landmark's `interactRadius`); firing also requires the player to
press the shared interact key/button (`KeyE`, `:3348` / `triggerTouchInteract()`,
`:7513`, the same one that lifts the child). No new keybinding, no new touch
target, no `blocked()`/`blockedR()` call against the player at all.
²⁵ **Added, LUL-4528 (Vantage Climb).** `KeyC`/`triggerTouchClimb()` proximity
trigger, on top of Rock's unchanged `C+LOS` collider — `findRockMountSpot()`
(`ROCK_MOUNT_RADIUS`=3, `lib/game/cover.ts`) is a distance query, not a new
collider; a mounted player still physically collides with the same rock AABB
as before. Directional effect (detection-weight exposure, camera-height
easing toward the rock) is *not* pairwise-geometric — see the Rock section's
"Vantage Climb" subsection above rather than a new matrix column, same
treatment `caveImmune`/`veilOverload` get (player-state features, not new
spatial elements).

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
- **LUL-393** — Predators have zero runtime awareness of the child's
  position; can stand on it with no reaction. P3 (narrow: only matters
  before pickup, and nothing currently depends on it).
- ~~**LUL-394**~~ — **Fixed.** `predatorSeparationPush()` resolves overlap
  for every predator pairing, same-species or cross-species; see footnotes
  ⁹/¹⁰/¹³.
- ~~**LUL-396**~~ — **Fixed, LUL-450.** Cover-prop placement (`generateCover()`)
  now checks tree clearance before placing; see footnote 14 above.

## Startled roosts (LUL-1914 slice a, LUL-4894 slice b) — ambient + player-triggered flush

Five fixed canopy sites (`ROOSTS`, `engine/tuning.js`, static list alongside
`LANDMARKS` — no `rng()` draw, seeds stay byte-identical). Two independent
triggers share the same per-site `flushRoost(i)`/`roostCooldown[i]` machinery,
so they cannot double-fire the same roost in quick succession:

- **Ambient (slice a, LUL-1914):** each tick, `updateRoosts(dt)`
  (`engine/forest-engine.js`) checks active, non-`inert` predators in
  `state === 'chase'` against each site's radius (20 units).
- **Player-thrown (slice b, LUL-4894):** `throwThrowable()`
  (`engine/forest-engine.js`) checks the stone's analytic landing point
  (`player pos + facing * THROWABLE_THROW_DISTANCE`) against the nearest
  roost's radius, after the existing predator-noise loop. Reuses `ROOSTS[i].radius`
  — no new `roostInteractRadius` constant.

On a hit, `flushRoost(i)` fires a small upward `THREE.Points` burst (fog-exempt,
reads above the fog line) and a positional wing-clatter (`roostFlushSound()`,
modeled on `scheduleBirdChirp`'s synthesis graph and `missionWaypointHum`'s
panner/falloff math), then puts that site on a 32s cooldown (`ROOST_COOLDOWN`).
No new engine state for either trigger.

**Player-thrown path only**: no `hearThrowableNoise()`-style detection event is
created — a flush is a feedback/presentation layer, same class as `#bearingPulse`
(LUL-1308) and LUL-1855's beacon glow, for both triggers. First player-thrown
flush ever also shows a one-shot `#hintCaption` pill ("throw a stone at a roost
to startle it", key `roostThrowCue`, `hintSeen`/`markHintSeen`, LUL-2230 model),
which supersedes `roostFlushSound()`'s own "birds scatter" caption for that one
event (single caption slot, last `pushState()` wins). Slice (c)
(`lib/game/eventSites.ts`-registered) remains deferred — see wiki
`decisions/startled-roosts-2026-09-07`.

## Hints — first-encounter explanations (LUL-2307, generalizes LUL-2230)

One small engine-side registry (`HINT_PRIORITY`/`HINT_TEXT`, `engine/forest-engine.js`)
replaces LUL-2230's bespoke scent-only caption with a `{key -> text/trigger}` table covering
eleven keys: `scent`, `landmark`, `deepwater`, `wolf`/`bear`/`lion`,
`stamina`, `cover` (hollow log/bramble), `caveImmune`, `rockClimb` (LUL-4528), `throwable`,
`veil` — plus `windAssist`/`windPulse`/`beaconHunter`/`veilOverload`, added later (see their
own sections below). Each key fires
once per install, the first time its trigger condition is true while `entered && !hidden &&
!win && !death` and the `Show hints` setting is on. Only one hint shows at a time;
`HINT_PRIORITY` order both breaks same-frame ties and lets a higher-priority key preempt a
lower-priority one already showing (not marked "seen" when preempted, so it can still fire
later) — needed because `landmark` is eligible unconditionally from frame one and would
otherwise occupy the slot for its full 8s before e.g. `scent` ever got a turn. A pill caption (`#hintCaption`,
`components/Hud.tsx`/`GameCanvas.tsx`) shows for 8s or until a key-specific dismiss-on-
interaction event (e.g. `scent`: the first `scentOnto()` call; `wolf`/`bear`/`lion`/`cover`:
the player hides; `throwable`: the player grabs it), then persists "seen" under
`lullwood:hints:<key>` so it never shows again on that install — `lullwood:hints:scent`
falls back to reading LUL-2230's old `lullwood:scentTrailCaptionSeen` key so an install that
already saw the scent caption doesn't see it a second time under the new key.

**Anchoring**: `scent`/`wolf`/`bear`/`lion`/`cover`/`throwable` are world-anchored — a real 3D
point (the mote/animal/prop/stone), projected to a viewport fraction via the same
camera-frustum math LUL-2230 introduced (`projectToScreen()`, generalized out of the
scent-only inline version). `deepwater`/`stamina`/`caveImmune`/`veil`/`landmark`
have no natural 3D point (or, for stamina/veil, no player-facing meter to anchor to at all —
see `SettingsPanel.tsx`'s own note that `#panel`'s stamina/veil readouts are dev-only;
`landmark` fires unconditionally on entry with nothing specific to point at, same as the old
toast it replaces) and are positioned by a fixed `[data-hint-key]` CSS rule instead:
`deepwater`/`caveImmune` sit below their own `#missionPanel`/`#caveImmunePanel`;
`stamina`/`veil`/`landmark` share the bottom-center spot `#captionToast`
(predator-call captions) already uses, above `#actionSlot`.

**LUL-2743 (short-landscape breakpoint only)**: at `@media (max-height: 420px)` (short
landscape phones, e.g. Pixel 5 851x393 / iPhone SE 667x375), the world-anchored keys stop
world-anchoring and share the same fixed slot as `stamina`/`veil`/`landmark`
instead (`components/GameCanvas.tsx`). Two earlier attempts (LUL-2532, LUL-2594) tuned the
ceiling a world-anchored pill's `translate(-50%,-120%)` lift is clamped against, but that
ceiling is `#actionSlot`'s own top edge — 9px above the viewport top on iPhone SE landscape
— which is less room than any real pill (with padding and wrapped text) can fit inside; no
ceiling constant fixes it. Safe to combine unconditionally with the self-anchored family:
only one `HINT_PRIORITY` key is ever active at a time, so the two groups never render
together. Same precedent as `#hint` (LUL-2410) and `deepwater` (LUL-2418): once there's no
room left to reposition into, stop trying to float the caption above `#actionSlot`.

**Settings**: `Show hints` checkbox (default on, next to `Show my scent trail`) and a `Reset
hints` button (clears every `lullwood:hints:*` key) in `SettingsPanel.tsx`.

**QA hooks**: `qaProbeHints()` (active key + full seen-map), `qaResetHints()` (clears every
key). `qaResetScentCaption()` (LUL-2230) is kept as a thin `scent`-only alias.

See `docs/specs/lul-2307-first-encounter-hints.md` for the full per-key trigger table and the
declared simplifications (no per-cover-kind copy branching, constant CSS position instead of
a DOM-measured one for the six fixed-anchor keys).

### Veil Overload (LUL-3150, retargeted LUL-4663)

**What it is**
- A real-danger emergency panic button: pressing `KeyQ` (desktop) or tapping
  `#veilOverloadPrompt` (mobile, `triggerTouchVeilOverload()`) while a live predator is in
  `state === 'chase'` (`veilOverloadTriggerActive`, recomputed every frame,
  `engine/forest-engine.js`) with veil charge above `VEIL_PROMPT_MIN_CHARGE` and not yet used
  this round burns the entire `veilCharge` to 0 and grants `VEIL_OVERLOAD_DURATION` (7s) of
  full sight+scent detection immunity, once per round (`veilOverloadUsedThisRound`, reset in
  `placeCave()` alongside the other per-round detection-state timers).
  LUL-4663: originally gated on `carrying`, which decisions/lul-2281-pickup-is-the-win-
  2026-09-09 made permanently false in real play (`completePickup()` wins directly, no
  carry-home leg) — the mechanic was dead for every real player (LUL-4662) until retargeted.
- Gate expression (`activateVeilOverload()`/`triggerTouchVeilOverload()`,
  `engine/forest-engine.js`): `veilCharge > VEIL_PROMPT_MIN_CHARGE && !veilOverloadUsedThisRound`.
  A refused press (chased but ineligible) always fires `veilOverloadDeniedCue()` — no silent
  no-op.
- Detection suppression is an OR with cave immunity at the same three real call sites —
  `checkScent(p)`, `effectiveDetect(p)`, `canSee(p, dist)` (`engine/forest-engine.js`) — same
  scope as `isCaveImmune`, no new immunity-kind enum. The two sources stack (orthogonal:
  a spent resource vs. cave-power state).
- Burning the resource does not touch `stepVeilCharge()` (`lib/game/veil.ts`) or set
  `veilLocked` — `veilCharge` is written directly from outside the state machine, same as
  every other module-level engine var; the natural regen path picks it back up next frame.

**Cue triple**
- Visual: `#veilOverloadPanel` ("Overload · Xs" countdown, `components/Hud.tsx`), visible with
  `adminMode` off (sibling of `#caveImmunePanel`, not inside `#panel`). `#actionSlot`'s
  `veilOverloadPrompt` row (`tone="urgent"`, keycap `Q`) is the pre-activation offer.
- Audio: `veilOverloadActivateCue()` on activation, `veilOverloadEndCue()` on the cooldown's
  `>0 -> 0` edge, `veilOverloadDeniedCue()` on a refused press — all gated
  `if(!audio || !soundOn) return`, distinct register (sawtooth sweep) from
  `caveImmuneStartCue()`/`caveImmuneEndCue()`'s sine sweep so the two immunity sources stay
  audibly distinguishable.
- Explanation: `HINT_PRIORITY`'s `veilOverload` entry shows the one-shot `#hintCaption` pill
  ("burn all veil charge (Q) for a detection-proof escape") the first time
  `veilOverloadChargeT > 0`, dismissed once it returns to 0 — same `caveImmune` precedent.

**QA hooks**: `qaOpenVeilOverloadTarget(kind)` (stages a chasing predator + full/unlocked veil
charge, mirrors `qaOpenVeilTarget`), `qaProbeVeilOverload()` (`{ chargeT, usedThisRound,
deniedCueCount }`).

See `docs/specs/lul-3150-veil-overload.md`.

### Scent Veil (LUL-5004, LUL-4895 accepted/retargeted)

**What it is**
- A one-time-per-lock break: pressing `KeyG` (desktop) or tapping `#veilPrompt` (mobile,
  `triggerTouchScentVeil()`) while at least one live predator has an active scent/beacon lock
  (`p.scentLock > 0`), the player is moving against the wind (`movingAgainstWind`), and the
  lock hasn't already been broken this cycle (`p.scentVeilReady`) spends `SCENT_VEIL_STAMINA_COST`
  (`lib/game/scent.ts`, placeholder 0.3 of the 0..1 stamina bar, Economist retuning is a
  deliberate follow-up) and clears `scentLock`/`scentVeilReady` on every predator that currently
  matches (`breakScentVeil()`, `engine/forest-engine.js`) -- not just the nearest one, since the
  HUD gate itself is a `.some()` across all predators and there's no way for the player to aim
  the press at a single animal.
  LUL-5004 ticket note: the original spec text gated this on `carrying`, which
  decisions/lul-2281-pickup-is-the-win-2026-09-09 already made permanently false in real play
  (same dead-gate class LUL-4662/LUL-4663 found on Veil Overload) -- dropped entirely rather than
  shipped dead, verified `checkScent()`/`scentOnto()` (`engine/forest-engine.js`) read no
  `carrying` reference before dropping it.
- `scentLock` is the one shared leash both real scent pickup (`scentOnto()`) and LUL-4897 Beacon
  Hunter's wind-signal channel (`beaconOnto()`) arm -- both set `p.scentVeilReady = true` alongside
  `p.scentLock = SCENT_TRACK_TIME`, so a break works on either detection channel without a second
  gate.
- Key binding: `KeyG`, not `KeyF` -- decisions/scent-veil-key-collision-retarget-2026-09-24. `KeyF`
  is already the mist veil's own hold key (`veilHeld`, this file's Veil section) and both are
  eligible the same real-play frame (hunted + downwind + charge/stamina available), so holding F
  would be ambiguous between two unrelated systems.
- Gate expression (`scentVeilPromptActive`, recomputed every frame, `engine/forest-engine.js`):
  `movingAgainstWind && predators.some(p => !p.inert && p.scentLock > 0 && p.scentVeilReady)`.
  Deliberately excludes the stamina check -- `#veilPrompt` stays visible, rendered `tone="disabled"`
  (grayed, not hidden) rather than unmounted, whenever stamina is the only thing blocking the
  press (Q5: a refused input needs a positive tell). A press while grayed fires
  `scentVeilDeniedCue()`, never a silent no-op.

**Cue triple**
- Visual: `#veilPrompt` row in `#actionSlot` (`components/Hud.tsx`, keycap `G`, "Press G to break
  the scent trail"), `tone="urgent"` when stamina-eligible, `tone="disabled"` (grayed) when not.
  `#windIndicator`'s `windIndicatorVeilActive` class (4x `windIndicatorPulse`'s default 900ms
  rate = 225ms, `components/GameCanvas.tsx`) composes alongside the existing `windIndicatorActive`
  class rather than overwriting it -- `movingAgainstWind` is a precondition of
  `scentVeilPromptVisible`, so both classes can be (and always are, when this one applies) present
  the same frame; `className` is built by joining an array of conditional class names, not a
  ternary. Visible with `adminMode` off -- `#actionSlot` is not inside `#panel`.
- Audio: `scentVeilBreakCue()` on a successful break (sine, 440->880Hz rising), `scentVeilDeniedCue()`
  on a refused press (square, 300->100Hz descending) -- both gated `if(!audio || !soundOn) return`,
  distinct register from Veil Overload's pair (sawtooth 140<->560Hz) so the two "something happened
  to my veil" sounds stay distinguishable.
- Explanation: none yet -- no `HINT_PRIORITY` entry filed with this cheap slice (out of scope per
  the ticket; a follow-up can add one the same way `veilOverload`'s entry works).

**QA hooks**: `qaProbePredatorState(kind)` extended with `scentLock`/`scentVeilReady` (real
predator fields, not a fake shadow copy). `qaProbeScentVeil()` (`{ staminaCharge,
deniedCueCount }`, mirrors `qaProbeVeilOverload`'s shape). Staging a real lock for a test reuses
the existing `qaSeedScentPoint`/`qaProbeScentOnOldest` pair (this file's LUL-65 scent-chase
coverage) -- no new "fake a lock" hook.

Wiki spec `game/mechanics/scent-veil.md`, decisions/scent-veil-accepted-retargeted-2026-09-24,
decisions/scent-veil-key-collision-retarget-2026-09-24.

### LUL-3009: Threat Beacon (active pulse on `#windIndicator`)

Scout proposal (LUL-3007), CEO-accepted cheap slice. Adds one new read-only `EngineHudState`
field, `movingAgainstWind` (`components/Hud.tsx`), pushed every frame (unlike LUL-1724's
`windX`/`windZ` above, pushed once per map) from `isMovingAgainstWind(mvx, mvz, windX, windZ)`
(`lib/game/scent.ts`) -- already computed on every throttled `scentEmitT` tick for
`depositScent()`'s own use (`engine/forest-engine.js`), now also evaluated unthrottled,
every frame, inside the movement block, and reset to `false` at the top of every `stepFrame()`
call so a stationary/hidden/paused frame clears it without a separate reset site.

No new element. Q7/Q8 duplicate-proof against the shipped LUL-1724 arrow: the arrow's rotation
reads `windX`/`windZ` (map-constant, same value all run); the beacon reads the player's live
per-frame heading against that same map-constant vector, flipping many times a second as the
player turns -- different question, not the same frame's state. Ships as a CSS class,
`windIndicatorActive`, toggled on `#windIndicator` itself (`components/Hud.tsx`) rather than a
second element: a 900ms `filter: brightness()`/`drop-shadow()` loop (`components/GameCanvas.tsx`)
-- `filter`, not `transform`, since `#windIndicator`'s own inline `style.transform` already does
the arrow's rotation and a CSS `animation` on `transform` would replace that value outright
instead of composing with it. Skipped entirely (class never applied) under `state.reducedMotion`,
same precedent as `veilRefillFlash` (LUL-2331) -- not left to the `prefers-reduced-motion` media
query alone, though that query also disables the keyframe as a defense-in-depth fallback.

**QA hooks**: `qaProbeWind()` (LUL-2189/LUL-2207) extended with `movingAgainstWind`.
`qaSetWindDirection(x, z)` forces `windX`/`windZ` directly (normalized, also pushed to HUD
state), same "bypass the roll" rationale as `qaSetWindHighSpeed` (LUL-2539) -- a
`movingAgainstWind` test needs a known wind vector to pick a heading provably against it,
rather than depending on which way the pinned seed's own `generateWind()` roll landed.

Covered by `e2e/wind-indicator.spec.ts` (extended, not a new file -- this element already had
dedicated LUL-2189/LUL-2207 coverage there): class presence tracks `qaProbeWind().
movingAgainstWind` exactly and clears the instant movement stops, class absence while moving
with the wind, and the class is never applied under `reducedMotion` even while the underlying
engine flag is genuinely true.

**LUL-3149 (Wind-Assisted Evasion)** adds two new, always-on effects to this same trigger --
`running && movingAgainstWind`, reusing the already-computed `movingAgainstWind` rather than
re-deriving it (`engine/forest-engine.js` L6790) -- stacking on top of the LUL-3009 scent
effect above rather than replacing it: a `WIND_ASSIST_SPEED_MUL` (1.2, `lib/game/stamina.ts`)
speed bonus applied to `spd` inside `stepFrame()` (L6796), and a `NOISE_RADIUS_RUN_WIND` (16.8, `lib/game/noise.ts`)
footstep-radius reduction applied to `noiseRadius` (L6814), replacing the plain sprint radius
only while the bonus is active. No new HUD element (checklist Q7/Q9): `#windIndicator`'s pulse
is a strict superset condition (`running && movingAgainstWind` implies `movingAgainstWind`) so
it already fires correctly for the sprint-bonus window; both the `title` and the always-visible
`#windIndicatorHint` caption (`components/Hud.tsx`) were updated to name all three effects.

First encounter gets a one-shot `'windAssist'` entry in `HINT_PRIORITY`/`HINT_TEXT`
(`engine/forest-engine.js` L7341 for the eligibility case), positioned below the danger hints
and `'stamina'`, above `'cover'`/`'caveImmune'` (LUL-4893's `'windPulse'` now sits directly below
it). A rising/falling sine-sweep audio cue pair,
`windAssistStartCue()` (L6365) and `windAssistEndCue()` (L6374), edge-triggers on the combined
`running && movingAgainstWind` transition (not on `movingAgainstWind` alone -- walking against
the wind stays silent on this cue, keeping only the existing scent effect).

**QA hooks**: none new -- `qaProbeWind().movingAgainstWind` (existing) is sufficient for the
walking-vs-running regression guard; the speed/noise effect is verified via displacement delta
(`qaProbePlayer()`) and a real staged predator's noise-detection outcome, not a dedicated probe.

Covered by `e2e/wind-assisted-evasion.spec.ts` (new): sprinting against the wind covers more
ground than sprinting with it over a fixed window; a wolf at a distance inside
`NOISE_RADIUS_RUN` but outside `NOISE_RADIUS_RUN_WIND` hears an unassisted sprint but not a
wind-assisted one; walking against the wind triggers neither the speed nor the noise bonus
(scent-only, per LUL-3009); both updated copy strings; the `windAssist` hint caption appears
once and not again after being marked seen.

### LUL-4893: Predator Pause (wind-gated freeze on downwind-perpendicular chase)

Scout proposal (LUL-4625), CEO-accepted (`decisions/predator-pause-roost-scare-dusk-stealth-accepted-2026-09-23.md`).
Completes the wind-mastery arc started by LUL-3149 above: wind now also works against a
chasing predator, not just for the player. Wiki spec `game/mechanics/predator-pause.md` was
corrected 2026-09-24 after review found several fabricated citations (the original claimed a
non-existent "Threat Beacon pulse visual" reuse and an `p.charge`-based trigger); the design
below is the corrected one, verified against `release/next` @`772d087`.

New pure decision helper `shouldWindPause(ux, uz, fx, fz, windX, windZ)` (`lib/game/predator.ts`,
LUL-345 standard) fires when a predator's chase-approach direction is both perpendicular to the
player's facing (`|dot(approach, facing)| < WIND_PAUSE_PERPENDICULAR_THRESHOLD` = 0.2) and
downwind (`dot(approach, wind) > WIND_PAUSE_DOWNWIND_THRESHOLD` = 0.6). Wired into exactly one
call site: the `p.state === 'chase'` fallback branch's plain pursuit line (`engine/forest-engine.js`,
`else { desx=ux; desz=uz; speed=p.spec.speed; }`) -- charge/sightLock/alert/reroute/searchPath/hunt
all sit ahead of this branch in `updatePredators()`'s priority chain and are untouched. A new
`p.windPauseT` field (distinct from `p.alert`, which already has its own spot-lock-tell contract)
holds the freeze for `WIND_PAUSE_DURATION` (0.3s) once triggered; `speed` is forced to 0 for that
window, same shape as the `p.alert > 0` branch, and decays only inside this branch (mirrors
`p.alert`'s own branch-scoped decay, not the unconditional `tickTimers()` decay `scentLock`/
`chargeCooldown` use).

No new visual asset (Q1 correction): reuses the predator's existing spot-lock rear-up/recovery
pose for free by extending its gate, `const alerting = p.alert > 0 || p.windPauseT > 0;`. No new
`EngineHudState`/`EngineActions` key (Q3/Q10) -- the freeze has no player-facing readout, matching
`decisions/0010-wind-hud-overrides-no-readouts.md`.

**Cue triple**
- Visual: the reused rear-up/recovery pose above -- no new keyframes, no `reducedMotion` branch
  needed (nothing new to simplify).
- Audio: `windPulseCue()` (`engine/forest-engine.js`, near `windAssistStartCue()`), a 120->180Hz
  rising sine chime, `soundOn`-gated, fired on the freeze's trigger edge. Distinct register from
  `windAssistStartCue()`'s 440->660Hz pair so the two wind-driven effects (player sprint bonus vs.
  predator freeze) stay audibly distinguishable.
- Explanation: new `'windPulse'` entry in `HINT_PRIORITY`/`HINT_TEXT`, positioned directly below
  `'windAssist'` (so the existing `HINTS_AHEAD_OF_WIND_ASSIST`-style pre-seed lists in other specs
  don't need updating). One-shot `#hintCaption` pill, "wind pulse -- nearby predators pause their
  sprint when moving across the wind", eligible while any predator has `windPauseT > 0`, dismissed
  (and marked seen) once that returns to 0 -- same `caveImmune`/`veilOverload` timer-dismiss
  precedent.

**Fixed 2026-09-24 (LUL-4996):** the "Known limitation" above -- no re-arm cooldown -- was
trivially reachable, not the "essentially never" case originally claimed: any player who simply
stops moving in a perpendicular+downwind geometry stalled a chasing predator indefinitely, which is
exactly what `e2e/missions-fire-tower.spec.ts` and `e2e/positional-hiding.spec.ts`'s catch-path
cases script (a stationary player, real predator chase) and exactly what broke them. A new
`p.windPauseCooldownT` field (`WIND_PAUSE_COOLDOWN` = 2.0s, `lib/game/predator.ts`) blocks a fresh
trigger for that long after a freeze ends; the predator still pursues at full speed during the
cooldown window (`desx=ux; desz=uz; speed=p.spec.speed`), so the cooldown itself can never stall a
chase. Branch-scoped decay, same shape as `p.windPauseT`/`p.alert`.

**QA hooks**: `qaPredatorState(idx)` extended with `windPauseT` and `windPauseCooldownT` (existing
hook, not a new `[QA-HOOK]` ticket per the corrected spec's Q11/Q12).

Covered by `e2e/wind-pulse.spec.ts` (new): a perpendicular+downwind lion freezes for the full
0.3s window (position provably unchanged) and resumes once the trigger condition no longer holds;
a head-on (non-perpendicular) lion, even downwind, never freezes; the `windPulse` hint caption
fires once on first trigger and never reshows.

### LUL-4897: Beacon Hunter (wind-signal wolf variant, cheap slice)

Wiki spec `game/mechanics/beacon-hunter.md` (corrected 2026-09-24). A `beaconHunter` variant of
the existing wolf that locks onto the player the instant `player.sprintWindBonusActive` is true
(LUL-3149's combined `running && movingAgainstWind` signal, the same one `#windIndicator`'s pulse
already shows), bypassing sight and scent entirely -- a fourth detection channel in
`updatePredators()`'s roam branch (`engine/forest-engine.js:2802`), gated on
`!sniffImmune && p.kind === 'wolf' && p.variant === 'beaconHunter' && player.sprintWindBonusActive
&& !isCaveImmune(caveImmuneT) && !isVeilOverloadActive(veilOverloadChargeT) && dist <
effectiveDetect(p) * BEACON_HUNTER_LOCK_MUL`. The immunity guard is stated explicitly (not just
relied on via `effectiveDetect()` already zeroing during those states) since this is the one
channel that could otherwise look like it bypasses immunity.

New tunables in `engine/tuning.js`: `BEACON_HUNTER_LOCK_MUL` (placeholder `1.0` -- companion
Economist ticket sets the real value, not blocking this merge) and `BEACON_HUNTER_EYE_COLOR`
(cold blue-teal, `0x2ad1c9`). Reuses `SCENT_TRACK_TIME` (8s) for the lock's `scentLock` --
no new cooldown constant, decays exactly like an ordinary scent chase (`shouldDowngradeChase()`
at `:2847` drops it to `investigate` once `scentLock` and `sightFlicker` both empty and sight
stays dark; `shouldGiveUpChase()` at `:2901` drops `chase` all the way to `roam` once distance
clears `detect * 1.5`).

New per-predator `p.variant` field (default `undefined`), plumbed additively in
`qaBuildScene()`'s predator spec loop (`engine/forest-engine.js:5891`, `p.variant = spec.variant`)
-- QA-stageable only; production spawn rate of a Beacon Hunter into the real wolf pool is out of
scope for this cheap slice (flagged on the ticket, per the spec's own Q11/Q12 answers this doesn't
block e2e coverage). `p.beaconHunterLocked` cleared at all three chase-exit sites (mirrors the
existing `scentLock` consumer pattern).

**Cue triple**
- Visual: `beaconOnto()` swaps the wolf's eye material to `BEACON_HUNTER_EYE_COLOR` on lock
  (`engine/forest-engine.js:2395`), reverted to the ordinary `p.spec.eye` the instant
  `beaconHunterLocked` clears (`:2629`) -- a static color swap, visible under `reducedMotion`
  since nothing here animates.
- Audio: `beaconLockCue()` (`engine/forest-engine.js:6271`), its own bus, `soundOn`-gated,
  distinct from the howl SFX and from `windPulseCue()`/`windAssistStartCue()`.
- Explanation: new `'beaconHunter'` entry in `HINT_PRIORITY`/`WORLD_HINT_KEYS`/`HINT_TEXT`
  (`engine/forest-engine.js:2201-2219`), one-shot first encounter: *"a Beacon Hunter -- locks
  onto you the instant you sprint into the wind, sight and scent don't matter to it. hide (H) or
  veil (F), or stop sprinting into the wind."*

**QA hooks**: `qaPredatorState(idx)` extended with `variant`/`beaconHunterLocked` (existing hook,
not a new `[QA-HOOK]` ticket); `qaBuildScene()`'s `predators[].variant` field is additive to an
existing hook's parameter shape.

Covered by `e2e/beacon-hunter.spec.ts` (new): a `beaconHunter` wolf locks on (`state` -> `'chase'`)
to a sprinting-against-wind player through a blocking cover prop with no scent trail deposited,
proving the lock is the beacon channel and not sight/scent; the chase downgrades to `'investigate'`
once `scentLock` decays and the player is teleported out of sight/leash range, with
`beaconHunterLocked` clearing; an ordinary wolf (no `variant`) never reaches `'chase'` from the
identical wind signal in the same single-tick window, proving no accidental duplication of the
channel onto ordinary wolves.
