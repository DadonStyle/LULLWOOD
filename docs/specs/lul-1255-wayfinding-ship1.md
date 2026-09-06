# SPEC: Missions Ship 1 -- wayfinding (child's cry, landmarks, home-light)

**Ticket:** LUL-1255. **Tier: C** (touches `engine/forest-engine.js` detection/simulation).
**Citations below re-derived directly against `origin/release/next @ 5b29fa4`** (2026-09-06) --
do not copy them forward without re-checking; every prior version of this ticket's citations
drifted (see `game/mechanics/ship1-wayfinding-stalled`).

**Companion tickets this spec depends on:**
- **LUL-1646 (Game Economist) -- ANSWERED, `done`.** Numbers used below are theirs verbatim:
  cry audible radius 32u (fog-tide scaled), carried-noise floor 0.4x `NOISE_RADIUS_WALK`, spawn
  exclusion 26u -> 34u.
- **LUL-1647 (Player Psychologist) -- STILL `todo`, unanswered as of 2026-09-06.** This is a
  real, named blocker on exactly one sub-item below (S4, the carried-noise floor). Every other
  section is unblocked and ready to implement now. Do not build S4 until LUL-1647 resolves --
  see its own section for what "resolves" means for the implementer.

## Why this exists

Outbound, the player should follow a distant voice (the lost child calling) toward a point in
the world. Inbound (carrying), they follow a fire at home. Named landmarks become a navigable
coordinate system. See `decisions/missions-accepted-2026-09-01` §3 for the ruling that made
this Ship 1, and `game/mechanics/ship1-wayfinding-stalled` §4 for the detection-gap analysis
this spec resolves.

## Files

- `engine/forest-engine.js` -- all engine changes (S1-S5 below)
- `lib/game/noise.ts` -- new exported constants + a pure helper (S3)
- `docs/ELEMENTS.md` -- new "Wayfinding" subsection (S6, same PR)

## S1 -- Home-light distance raise (unblocked, do first -- smallest change)

**Current (`engine/forest-engine.js:757`):**
```js
const homeLight = new THREE.PointLight(CONFIG.home.glow, 1.0 * LEGACY_LIGHT_SCALE, 24, 2);
```
The `24` is the **third positional constructor argument** (range/distance), not a `.distance`
property -- there is no `homeLight.distance =` line anywhere to edit instead.

**Change:** raise `24` to `120` (half the map's 240-unit width -- chosen so home is visible as
a glow from a full map-width away, "horizon" rather than "underfoot," while staying inside one
order of magnitude of `BABY_LIGHT_DISTANCE = 28` so the two lights don't read as wildly
mismatched in brightness falloff shape). This is a visual/UX call, not one of the Economist's
three gated numbers -- if Game Tester's play verdict says 120 is too bright/dim, retune in a
follow-up ticket rather than blocking this PR on it.

```js
const homeLight = new THREE.PointLight(CONFIG.home.glow, 1.0 * LEGACY_LIGHT_SCALE, 120, 2);
```

No other line references this constructor call. `BABY_LIGHT_DISTANCE` (`:894`) and its two
`fogTideGlowRangeMul()` call sites (`:3244`, `:3365`) are baby-light-only and untouched.

## S2 -- Landmark navigability cue (unblocked)

`LANDMARKS` (`engine/forest-engine.js:198-203`) already has the four correct names:
`fireTower`, `stoneMarker`, `oak`, `drownedCar`. No renaming needed.

**Add a one-line first-run caption** the first time `entered` flips true (`:2187`, inside the
function that sets it -- read the ~15 lines around `:2187` to find the right insertion point,
it is a single `entered = true;` statement inside a larger "start the run" function). Fire it
unconditionally (not gated on `captionsOn`, since this is a one-time nav tip, not a repeating
audio-cue caption) via the same `pushState` shape used elsewhere (e.g. `:1976`):

```js
pushState({ caption: 'landmarks in the fog are safe to navigate by', captionId: ++captionSeq });
```

Cost: one line. No new geometry, no new state.

## S3 -- The child's cry: audio + a noise-event-at-a-point primitive (unblocked)

### S3a. The architecture gap (why this isn't "just add a sound")

`updatePredators(dt, noiseRadius)` (`:1294`) and everything it calls is **player-anchored
end to end**: `dist`/`ux`/`uz` (`:1298-1299`) are predator-to-*player*, `checkNoise(p, dist,
noiseRadius, dt)` (`:1184`) tests that same player distance, and `hearNoise(p)` (`:1190`) sets
`p.inv = 'approach'`, which `stepApproach(ux, uz, ...)` (`lib/game/predator.ts:225`) resolves
using those same player-relative unit vectors every tick. There is no concept of "a noise
happened over there" -- only "the player is this loud, this close." A naive cry implementation
that reuses `noiseRadius`/`checkNoise` therefore makes a predator that "hears the crying child"
walk toward the **player** instead, who on the outbound leg is nowhere near the child. That is
the opposite of the mechanic's point.

### S3b. The fix -- a second, independent noise check against a point

Do not touch `checkNoise`, `hearNoise`, `stepApproach`, or the player-noise path at all --
they stay exactly as they are for footsteps. Add a **parallel** check, once per predator per
frame, inside the `roam` state branch of `updatePredators` (`:1268-1275`, the block containing
`checkNoise(p, dist, noiseRadius, dt)`), for predators that are not already investigating/
chasing/etc.:

```js
// LUL-1255: the cry is a second, independent hearing check against the
// child's actual position, not the player's -- see S3 of the wayfinding
// spec for why this can't reuse checkNoise/hearNoise as-is.
else if(!sniffImmune && !baby.taken && checkNoise(p, Math.hypot(baby.x - p.x, baby.z - p.z), cryNoiseRadius, dt)){
  hearCry(p);
}
```
This is placed as one more `else if` arm alongside the existing
`checkScent`/`checkNoise` chain at `:1268-1275` -- read that exact block before editing so the
ordering (sight, then scent, then footstep-noise, then cry) is preserved; the cry check should
be last since it is the newest, lowest-priority-to-reach channel.

`checkNoise` is reused unchanged (it is already a pure `(p, dist, radius, dt) => boolean`
predicate over whatever distance you pass it -- `lib/game/noise.ts`'s `isNoiseHeard` takes
`dist`/`noiseRadius` as plain numbers with no assumption about whose distance it is). Passing
`Math.hypot(baby.x - p.x, baby.z - p.z)` instead of the player's `dist` is the entire fix for
S3a's bug.

`baby.taken` (set true on pickup, grep confirms it exists alongside `baby.x`/`baby.z` at
`:880`) gates the whole check off once the child is carried -- the cry-at-a-point mechanic is
outbound-only. The carrying-leg noise question is S4, gated separately.

**New function `hearCry(p)`**, sibling to `hearNoise(p)` (`:1190`), not a call to it (that
function sets `p.inv = 'approach'`, which chases the *player*):

```js
// Sibling to hearNoise() -- deliberately does not call it. hearNoise() commits
// the predator to approaching the *player* (stepApproach uses live player
// position); this commits it to the *child's* fixed position instead, since
// that is where the sound actually came from.
function hearCry(p){
  p.state = 'investigate'; p.inv = 'cry'; p.invTargetX = baby.x; p.invTargetZ = baby.z;
  p.sniffsLeft = rollSniffs(rng, 4);
}
```

This needs `p.inv === 'cry'` handled at whatever call site currently branches on `p.inv`
(search `p.inv ===` and `p.inv;` near the `investigate` state handling -- it is near
`stepApproach` usage). For `'cry'`, compute `ux, uz` toward the **stored** `p.invTargetX/Z`
instead of live player position, and call `stepApproach` with those. **Do not add a timeout
or "lose interest" clock beyond what `sniffsLeft`/the existing investigate-state exit
conditions already provide** -- reuse the existing giving-up logic, just retarget where it's
walking toward.

### S3c. The two Economist numbers this section uses

```js
// LUL-1255 / LUL-1646: the child's cry is audible further than any footstep --
// it's a sustained beacon, not an incidental sound. Scales with fog tide the
// same way baby-light range does (fogTideGlowRangeMul), same rationale: dread
// peaks with the tide.
const CRY_NOISE_RADIUS = 32;
```
and in the `tick()` fog-tide block (near `:3244`, alongside the existing
`fogTideGlowRangeMul(fogTideAmount)` call), compute once per frame:
```js
const cryNoiseRadius = CRY_NOISE_RADIUS * fogTideGlowRangeMul(fogTideAmount);
```
(reuses the already-imported `fogTideGlowRangeMul`, no new import).

**Spawn exclusion (`:1089`):** change the baby-exclusion constant from `26` to `34` --
Economist's number, chosen to exceed `CRY_NOISE_RADIUS = 32` so no predator spawns already
inside the cry's audible range:
```js
while((x*x+z*z < 2500 || Math.hypot(x-baby.x, z-baby.z) < 34 || blockedR(x, z, p.rad+0.5)) && tries < 60);
```

### S3d. The cry's audio itself

New function, sibling to `leafRustle`/`splash`/`hollowLogSound` (`:1801-1875`), using the same
procedural building blocks (`ctx`, `noise()`, biquad filters, gain envelopes -- no audio
files, per the Constraints below). Trigger it on an interval that gets *shorter* as the player
gets closer to the child (tempo carries distance), not by scaling pan:

```js
// LUL-1255: the child's cry. Tempo and pitch carry distance -- NOT pan depth --
// because stereo pan collapses to mono on a phone speaker; a player who can only
// hear "louder/faster" still gets the navigation cue, one who has stereo also
// gets left/right from the panner node below.
function childCry(distToPlayer){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const near = Math.max(0, Math.min(1, 1 - distToPlayer / 140));   // 0 far .. 1 close
  const pan = ctx.createStereoPanner();
  const dx = baby.x - player.x, dz = baby.z - player.z;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx =  Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  const right = dx*rx + dz*rz, fwd = dx*fx + dz*fz;
  pan.pan.value = Math.max(-1, Math.min(1, right / Math.max(1, Math.hypot(right, fwd))));
  const o = ctx.createOscillator(); o.type = 'sine';
  const baseF = 420 + near * 90;   // pitch rises slightly as you close in
  o.frequency.setValueAtTime(baseF, t);
  o.frequency.exponentialRampToValueAtTime(baseF * 1.4, t + 0.18);
  o.frequency.exponentialRampToValueAtTime(baseF, t + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05 + near * 0.05, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(g); g.connect(pan); pan.connect(master); pan.connect(conv);
  o.start(t); o.stop(t + 0.65);
}
```

**Call-site scheduling** (new state near the other one-shot timers, e.g. alongside
`scentEmitT`/`callTimer`-style fields declared around `:1610`): a `cryTimer` that counts down
in `tick()` whenever `!baby.taken && entered`, firing `childCry(dist)` and resetting itself to
an interval that shortens with proximity -- reuse the same `near` shape as above:
```js
const cryDist = Math.hypot(baby.x - player.x, baby.z - player.z);
cryTimer -= dt;
if(cryTimer <= 0){
  childCry(cryDist);
  const near = Math.max(0, Math.min(1, 1 - cryDist / 140));
  cryTimer = 5.5 - near * 3.5;   // 5.5s far, 2s close
}
```
Initialize `cryTimer = 2` (so the first cry comes quickly on spawn, not after a full interval).

**Captions:** gate a caption on `captionsOn` at the same call site, same shape as `:1201`'s
`hearNoise` caption (near/far + left/right/ahead/behind), text `"a child crying · <near|far> ·
<side>"` -- this is the deaf-player's only access to the mechanic, required by the ticket's
"Captions for audio cues" constraint.

## S4 -- Carried-child noise floor -- BLOCKED on LUL-1647, do not implement yet

`isNoiseHeard` (`lib/game/noise.ts`) returns `false` whenever `noiseRadius <= 0`, and the
engine only ever computes a `noiseRadius` inside the movement branch (`:3195`, guarded by
`mag > 0`) -- a **stationary** player, carrying or not, emits zero noise on this channel. The
mirror bug on sight (`CARRY_DETECT_MUL`, `lib/game/cover.ts:475`) was fixed by LUL-1310;
hearing was left alone.

Economist's number for when this unblocks: **carried-noise floor = `0.4 * NOISE_RADIUS_WALK`
= 5.6 units**, applied only when `carrying && !moving` (i.e. as a floor under whatever
`noiseRadius` the movement branch would otherwise compute, so a moving carrying player is
still louder, not quieter).

**Why this is blocked and not just "a number to drop in":** this makes a player who carries
the crying child into a hiding spot and holds still *still audible* -- it removes the game's
only perfect defense, specifically during the leg where the player is holding the thing they
came for. `game/mechanics/ship1-wayfinding-stalled` §4(c) named this exactly: "dread or
harassment?" is a fairness call, not an engineering one, and LUL-1647 is where the Player
Psychologist rules on it. Implementing S4 before that ruling lands means shipping a design
decision nobody who owns fairness has signed off on.

**What "resolves" means for whoever picks this back up:** check LUL-1647's status. If it
rules the mechanic in (as-is or with a different floor than 5.6), implement per that ruling
and this section's shape (a floor added at the `noiseRadius` computation site, `:3195`, active
`carrying && mag === 0`). If it vetoes the mechanic for hidden players specifically (e.g. "the
floor applies while carrying-and-visible but is suppressed while `hidden`"), implement that
carve-out instead -- do not silently pick the harsher reading. If unresolved, leave S1-S3 and
S5-S6 shipped and this section as a follow-up ticket; do not block the rest of the PR on it.

## S5 -- Home-fire crackle (unblocked)

Sibling procedural sound to the cry, panned by bearing to `CONFIG.home` (same pan-vector math
as `childCry`, substituting `CONFIG.home.x/z` for `baby.x/z`), firing on an interval whose
**density** (not pan) rises as the player nears home -- same tempo-carries-distance shape as
S3d, for the same mobile-mono reason. Trigger only while `carrying` (the return leg is the
leg this cue serves) via a `homeFireTimer` counted down in the same `carrying` branch of
`tick()` (`:3221` area, alongside the existing `babyLight`/`halo` carrying-phase updates).
Reuse the existing crackle/pop building blocks from `hollowLogSound`'s noise-burst pattern
(`:1853`, the `nb`/`bp`/`ng` chain) rather than inventing a new synthesis primitive -- a
crackle is timbrally close to the log's dry-wood knock, just softer and unpitched (drop the
sine-thump oscillator, keep only the filtered noise burst).

Caption (gated on `captionsOn`, same near/far+side shape): `"home fire crackling · <near|far>
· <side>"`.

## S6 -- `docs/ELEMENTS.md`

Add a "Wayfinding" subsection documenting: the four `LANDMARKS` as a navigable coordinate
system (verbs: none, purely visual/audio anchors), the child's cry (verbs: none, ambient
audio + predator-audible-at-a-point per S3), the home fire (verbs: none, ambient audio only),
and the home-light range change (S1). Follow the existing subsection format in the file
(check an existing entry, e.g. the hiding-spot or Fog Tide subsections, for the exact
heading/table shape used elsewhere in this doc).

## Verification

- `npx tsc --noEmit` -- clean
- `npx next build` -- clean
- `npx eslint .` (the `lint` script -- `next lint` is removed in Next.js 16)
- `node scripts/check-elements-citations.mjs --fix` then confirm clean (S1/S3/S5 shift line
  numbers throughout `engine/forest-engine.js`; existing `ELEMENTS.md` citations into that
  file may need re-derivation even where this diff didn't touch their subject)
- `node scripts/check-duplicate-logic.mjs` -- clean (watch for `hearCry`/`childCry` colliding
  with an unrelated `lib/game/*` export name; rename if it does, don't allowlist casually)
- No new `getElementById`/`innerHTML` in `engine/forest-engine.js`
- Manual/tester verification (engine correctness only asserted by the author, per role
  charter): cry audible and directional in both stereo and forced-mono playback, home glow
  visible from across the map, landmark first-run caption fires once, outbound cry pulls a
  roaming predator toward the child's fixed spawn point (not the live player) when the player
  is far from the child -- this last one is the one behavior a headless test can actually
  assert deterministically (predator position converges on `baby.x/z`, not on a moving
  player position, over N ticks with the player stationary elsewhere) and should get a
  `lib/game/predator.test.ts`-style unit test if the executor has room for one.

## Constraints (unchanged from the ticket, restated for the executor)

- Determinism: the map is seeded; none of S1-S6 touch map generation or the RNG stream.
- Audio is 100% procedural -- no new audio files.
- Captions required for every new audio cue (cry, home fire) -- both are the only warning
  players get, and deaf players lose them without captions.
- Reuse the existing spatial hash / broadphase -- S3's cry check reuses `checkNoise` and
  ordinary Euclidean distance to a fixed point; it adds no new spatial structure.
- Mobile parity: none of S1-S6 add a new player-facing input (cry/fire are passive audio,
  landmarks are passive visual/audio) -- no new touch affordance is required for this spec.
  If Game Engineer's implementation ends up adding any interactive follow/ignore control not
  described here, that's new scope: flag it rather than building it silently.

## Out of scope

- **Missions panel** -- moved to M2 Deepwater (see `decisions/missions-accepted-2026-09-01`).
- Ship 2 (M2 Deepwater), Ship 3 (M4 Ghost), Ship 4 (M5 Cold Walk).
- **S4 (carried-noise floor)** -- blocked on LUL-1647, see that section.
- Rewards/currency (Embers) -- separate track.
- Retuning `homeLight`'s `120` distance or `CRY_NOISE_RADIUS`'s `32` after playtest -- file a
  follow-up ticket, don't reopen this spec for a constant tweak.
