# SPEC: Missions Ship 1 -- wayfinding (child's cry, landmarks, home-fire)

**Ticket:** LUL-1255 (spec) / LUL-1674 (this pass: S2, S3, S5, S6).
**Tier: C** (touches `engine/forest-engine.js` detection/simulation).

**Re-derivation notice (2nd rewrite):** this spec has now stalled twice on citation rot --
first at `5b29fa4` -> `ec8f30d` (30h, +466 lines), and this rewrite happened because that
drift made the ticket unexecutable. **Citations below are symbol-first.** Every reference
gives the function/variable name and a literal grep pattern; a line number is included only
as a convenience snapshot **against `origin/release/next @ 7d55cc3`** (2026-09-07 09:12 UTC)
and must not be trusted on its own -- if it's wrong, the grep pattern is the source of truth,
not a signal to stop and report. (Stop-and-report still applies if the *symbol itself* is
gone or its shape has changed incompatibly -- see each section.)

**Companion tickets:**
- **LUL-1646 (Game Economist) -- `done`.** Numbers used below are theirs verbatim: cry
  audible radius 32u (fog-tide scaled), spawn exclusion 26u -> 34u.
- **LUL-1647 (Player Psychologist) + LUL-1686 (its numeric bound) -- both `done`.** These
  unblock S4 (carried-noise floor), but S4 is **not** in this pass -- see "S4" below.
- **LUL-1851 (Tier B, Game Engineer, `todo`) -- ships Ship 1's home-light-reach change
  separately**, already re-priced against the 480-unit map (240, not this spec's old 120).
  Nothing in this document touches `homeLight` or `BABY_LIGHT_DISTANCE`; do not re-derive
  that constant here, it's a different ticket's diff.
- **LUL-1857 (new, `todo`) -- S4 (carried-child noise floor + the Psychologist's sniff-loop
  fairness fixes), split out as its own ticket.** See "S4" below for why.

## Why this exists

Outbound, the player should follow a distant voice (the lost child calling) toward a point in
the world. Named landmarks become a navigable coordinate system. Inbound (carrying), a home
fire gives the return leg an audio cue it currently lacks entirely. See
`decisions/missions-accepted-2026-09-01` §3 for the ruling, and `game/mechanics/childs-cry-
unbuildable` §1 for confirmation that none of this exists yet in shipped code (the mission hum,
LUL-1258/1259, was built *mirroring* this cry, not replacing it).

## Files

- `engine/forest-engine.js` -- S2, S3, S5
- `lib/game/noise.ts` -- one new exported constant, `CRY_NOISE_RADIUS` (S3). **No new pure
  helper** -- `isNoiseHeard`/`checkNoise` are reused unchanged (correction from the prior
  version of this spec, which listed "a pure helper" in this file's scope and then never
  used one).
- `docs/ELEMENTS.md` -- new "Wayfinding" subsection (S6, same PR)

## S2 -- Landmark navigability cue

`LANDMARKS` **moved since this spec was first written** -- it is no longer in
`engine/forest-engine.js`. It is now `export const LANDMARKS = [...]` in `engine/tuning.js`
(grep `export const LANDMARKS`), imported into `forest-engine.js` in the same multi-symbol
import as `CONFIG`/`LEGACY_LIGHT_SCALE` (grep `LANDMARKS, LEGACY_LIGHT_SCALE`). Still has the
four correct names (`fireTower`, `stoneMarker`, `oak`, `drownedCar`) -- no renaming needed,
just confirm the import, don't re-declare it.

**Add a one-line first-run caption** the first time a run starts. Symbol: `function enter()`
(grep `function enter(){`), the statement `entered = true;` inside it (currently the first
line of the function body). Fire unconditionally (not gated on `captionsOn` -- this is a
one-time nav tip, not a repeating audio-cue caption), same `pushState` shape used throughout
the file (grep any `pushState({ caption:` call for the exact object shape), placed right after
`entered = true;`:

```js
pushState({ caption: 'landmarks in the fog are safe to navigate by', captionId: ++captionSeq });
```

Cost: one line. No new geometry, no new state.

## S3 -- The child's cry: audio + a noise-event-at-a-point primitive

### S3a. The architecture gap (why this isn't "just add a sound")

`function updatePredators(dt, noiseRadius)` (grep `function updatePredators(`) is
player-anchored end to end: `dist`/`ux`/`uz` are predator-to-*player*,
`function checkNoise(p, dist, noiseRadius, dt)` (grep `function checkNoise(`) tests that same
player distance, and `function hearNoise(p)` (grep `function hearNoise(`) sets
`p.inv = 'approach'`, resolved every tick against **live player position**. A naive cry that
reuses this path makes a predator "hear the crying child" and walk toward the **player**
instead -- backwards for the outbound leg, where the player is nowhere near the child. That
bug is real and is what S3b fixes.

### S3b. The fix -- reuse LUL-1623's existing point-target primitive, don't build a new one

**This is the one place this rewrite changes the *design*, not just the citations, and it's
worth calling out explicitly per the "declare deviations" rule:** since this spec was first
written, **LUL-1623** (thrown-decoy noise) landed and already built almost exactly what S3
needs -- a way to send an `investigate/approach`-state predator toward a fixed point instead
of the live player. Reusing it means **no new `p.inv` value and no new branch-handling code**,
which is strictly simpler than this spec's original plan (a `p.inv === 'cry'` state with its
own `invTargetX/Z` fields and a new handler). Do not build the old plan; build this one.

The primitive: `p.noiseTarget` / `p.noiseTargetT` (grep `noiseTarget:null, noiseTargetT:0` for
the per-predator init). Consumed inside `updatePredators`'s `investigate` state, in the
`p.inv === 'approach'` branch (grep `if(p.noiseTarget){` -- there are two occurrences close
together, one that overrides the approach direction, one that counts down `noiseTargetT` and
clears the target). When `p.noiseTarget` is set, that branch computes its direction/distance
toward the target instead of the live player; when cleared (by timeout or by reaching sniff
range), it falls back to live-player tracking. `function hearThrowableNoise(p, tx, tz)` (grep
`function hearThrowableNoise(`) is the existing caller that sets it -- read it as the template
for `hearCry` below, not `hearNoise`.

Add a **parallel** check, once per predator per frame, as one more `else if` arm in the `roam`
state's detection chain. Anchor: the block starting `} else if(p.state === 'roam'){` (grep
that literal), which currently ends its chain with
`else if(!sniffImmune && checkNoise(p, dist, noiseRadius, dt)){ hearNoise(p); }` (grep that
literal for the exact insertion point -- add the cry arm immediately after it, before the
final wildcard `else` that handles roam-wandering):

```js
// LUL-1255: the cry is a second, independent hearing check against the
// child's actual position, not the player's -- see S3 of the wayfinding
// spec for why this can't reuse checkNoise/hearNoise's live-player target.
else if(!sniffImmune && !baby.taken && checkNoise(p, Math.hypot(baby.x - p.x, baby.z - p.z), cryNoiseRadius, dt)){
  hearCry(p);
}
```
Ordering matters: sight, then scent, then footstep-noise, then cry -- cry stays last since
it's the newest, lowest-priority-to-reach channel.

`checkNoise`/`isNoiseHeard` are reused unchanged -- both are already pure `(dist, radius, dt)`
predicates with no assumption about whose distance is passed in. Passing
`Math.hypot(baby.x - p.x, baby.z - p.z)` instead of the player's `dist` is the entire fix.

`baby.taken` (grep `const baby = { x: 60, z: 60, taken: false };` for the object shape -- set
`true` on pickup) gates the whole check off once the child is carried; the cry-at-a-point
mechanic is outbound-only. The carrying-leg noise question is S4 (LUL-1857), not this ticket.

**New function `hearCry(p)`**, modeled on `hearThrowableNoise(p, tx, tz)` (cited above), not
on `hearNoise(p)` (that one has no target-override, it commits to the live player):

```js
// Modeled on hearThrowableNoise(), not hearNoise() -- this needs the
// point-target override (p.noiseTarget), not hearNoise()'s live-player commit.
// Unlike a thrown decoy's landing spot, the cry's source doesn't move and
// keeps sounding, so there is no timeout: p.noiseTargetT stays Infinity and
// only clears when stepApproach's own enterSniff fires (arrival), never by
// expiry reverting to the live player -- an expiry-revert here would
// silently reintroduce the exact S3a bug this section exists to fix.
function hearCry(p){
  p.state = 'investigate'; p.inv = 'approach'; p.sniffsLeft = rollSniffs(rng, 4);
  p.callTimer = rnd(2.6, 4.2);
  p.noiseTarget = { x: baby.x, z: baby.z };
  p.noiseTargetT = Infinity;
}
```

No other call site needs to change -- the existing `p.noiseTarget` consumption in the
`approach` branch, and the existing `enterSniff` clear, both already do the right thing for
any point target, cry or decoy alike.

### S3c. The Economist's numbers

New exported constant in `lib/game/noise.ts`, next to `NOISE_RADIUS_WALK`/`NOISE_RADIUS_RUN`:
```ts
/** The child's cry is audible further than any footstep -- a sustained beacon, not an
 * incidental sound. */
export const CRY_NOISE_RADIUS = 32;
```
Add it to the existing import in `forest-engine.js` (grep
`from '@/lib/game/noise';` -- add `CRY_NOISE_RADIUS` to that same import list, don't add a
second import line).

Compute the fog-tide-scaled radius once per frame, immediately before the one call site that
needs it: `if(playing) updatePredators(dt, noiseRadius);` (grep that literal -- `fogTideAmount`
is already in scope there as module state):
```js
const cryNoiseRadius = CRY_NOISE_RADIUS * fogTideGlowRangeMul(fogTideAmount);
```
(`fogTideGlowRangeMul` is already imported -- grep confirms it's used at two existing
`babyLight.distance = BABY_LIGHT_DISTANCE * fogTideGlowRangeMul(fogTideAmount);` call sites;
reuse the import, add no new one.)

**Spawn exclusion:** the predator-reset retry loop (grep
`Math.hypot(x-baby.x, z-baby.z) < 26` for the exact line) changes `26` to `34` -- Economist's
number, chosen to exceed `CRY_NOISE_RADIUS = 32` so no predator spawns already inside the
cry's audible range:
```js
while((x*x+z*z < 2500 || Math.hypot(x-baby.x, z-baby.z) < 34 || blockedR(x, z, p.rad+0.5)) && tries < 60);
```

### S3d. The cry's audio itself

**Do not write new Web Audio DSP for this.** `function missionWaypointHum(m, distToPlayer)`
(grep `function missionWaypointHum(`) is an *already-shipped* near-identical function --
LUL-1258 built it by mirroring this unbuilt spec's tempo/pitch-carries-distance design, per
its own comment (grep `mirrors childCry's cryTimer init` and
`reuses childCry's tempo-carries-distance shape`). Copy its structure for `childCry`, changing:
target point (`baby.x/z` instead of `m.target.x/z`), base frequency (pick something that
reads distinctly from the mission hum's `220 + near * 60` -- e.g. `420 + near * 90`, higher
and brighter, so the two cues stay distinguishable by ear), and the caption text/gate (see
below). Keep the same pan-by-bearing math, the same gain/frequency envelope shape, and the
same `if(!audio || !soundOn) return;` guard.

**Call-site scheduling:** `missionHumTimer`'s pattern is the template -- grep
`let missionHumTimer = 2;` (declaration, comment literally says "mirrors childCry's cryTimer
init") and its countdown block (grep `missionHumTimer -= dt;`) for the exact shape to mirror
with a new `cryTimer` variable. Declare `let cryTimer = 2;` near `missionHumTimer`'s own
declaration. Drive it from the same `if(!baby.taken){` block that already renders the child's
idle glow (grep `// the child's idle glow (outside the cinematic)` -- this block is already
gated on the right condition, reuse it rather than adding a second `!baby.taken` check
elsewhere):
```js
const cryDist = Math.hypot(baby.x - player.x, baby.z - player.z);
cryTimer -= dt;
if(cryTimer <= 0){
  childCry(cryDist);
  const near = Math.max(0, Math.min(1, 1 - cryDist / 140));
  cryTimer = 5.5 - near * 3.5;   // 5.5s far, 2s close -- same curve missionHumTimer mirrors
}
```

**Captions:** gate on `captionsOn`, same near/far + side shape as `hearNoise`'s caption (grep
`heard you · ${near} · ${side}` for the exact bearing-to-caption math to copy), text
`"a child crying · <near|far> · <side>"`. This is required, not optional -- it's the deaf
player's only access to the mechanic.

## S4 -- Carried-child noise floor -- SPLIT OUT to LUL-1857, not in this pass

LUL-1647 (Player Psychologist fairness ruling) and LUL-1686 (its numeric bound) are both
`done`, so S4 is no longer *blocked*. It is being shipped as its own ticket anyway, because the
Psychologist's verdict (wiki `game/psychology/carried-cry-fairness`, read the 2026-09-06
amendment §A1-A6, it supersedes the original §1-§8 numbers) turned out to require more than "a
number to drop in": a carried-noise floor (5.6u, capped under 8u after any fog-tide scaling
per LUL-1686), plus a required change to how the predator sniff-loop's terminal give-up
resolves (route it through the existing `backOffPoint()` helper so giving up is *observable*
as the animal leaving, not just as it going quiet), plus an hide/loss-event instrumentation
change. That's a distinct, reviewable unit of work with its own failure modes, sequenced after
this ticket (mitigation 2 in the verdict couples detection to the `cryTimer` pulse this spec
builds). Folding it in here would make this PR's review surface both the wayfinding cue *and*
a core-loop fairness rework in one diff -- worse for review, no benefit to sequencing since S4
literally depends on `childCry()`/`cryTimer` existing first.

**LUL-1857** carries the full scope with citations to the verdict. Nothing in S1-S3/S5/S6
below depends on S4 landing.

## S5 -- Home-fire crackle

Sibling procedural sound to the cry, panned by bearing to `CONFIG.home` (same pan-vector math
as `childCry`, substituting `CONFIG.home.x/z` for `baby.x/z`), firing on an interval whose
**density** (not pan) rises as the player nears home -- same tempo-carries-distance shape as
S3d, same mobile-mono rationale (stereo pan collapses to mono on a phone speaker; tempo/pitch
survive that, pan depth doesn't).

Trigger only while `carrying`. Anchor: the block `} else if(carrying){` inside `tick()` (grep
that literal), which already computes `const dh = Math.hypot(player.x - CONFIG.home.x, player.z
- CONFIG.home.z);` (grep that literal) for the arrive-home check -- reuse `dh` for the
crackle's proximity/tempo calc instead of recomputing it. Add a `homeFireTimer` counted down
in this same block, same shape as S3d's `cryTimer`.

Reuse `hollowLogSound(entering)` (grep `function hollowLogSound(`) for the noise-burst
building block -- specifically its `nb`/`bp`/`ng` bandpass-filtered-noise chain (grep
`bp.type='bandpass'; bp.frequency.value = 220;` for the exact chain to copy). A crackle is
timbrally close to the log's dry-wood knock, just softer and unpitched: drop the sine-thump
oscillator (`o`/`og` in that function), keep only the filtered noise burst.

Caption (gated on `captionsOn`, same near/far+side shape): `"home fire crackling · <near|far>
· <side>"`.

## S6 -- `docs/ELEMENTS.md`

Add a "Wayfinding" subsection documenting: the four `LANDMARKS` (now in `engine/tuning.js`) as
a navigable coordinate system (verbs: none, purely visual/audio anchors), the child's cry
(verbs: none, ambient audio + predator-audible-at-a-point per S3), and the home fire (verbs:
none, ambient audio only). **Do not document the home-light range change here** -- that's
LUL-1851's own diff and its own `docs/ELEMENTS.md` update. Follow the existing subsection
format in the file (check an existing entry -- e.g. Fog Tide -- for the exact heading/table
shape and citation style (`Lnnnn`) used elsewhere).

## Verification

- `npx tsc --noEmit` -- clean
- `npx next build` -- clean
- `npx eslint .` (the `lint` script -- `next lint` is removed in Next.js 16)
- `node scripts/check-elements-citations.mjs --fix` then confirm clean (S3/S5 shift line
  numbers throughout `engine/forest-engine.js`; existing `ELEMENTS.md` citations into that
  file may need re-derivation even where this diff didn't touch their subject -- and note the
  CI gotcha: this script can fail the `unit tests` check for reasons unrelated to your own
  diff if any *other* citation's line shifted, run `--fix` first, always)
- `node scripts/check-duplicate-logic.mjs` -- clean (watch specifically for `hearCry`/
  `childCry`/`CRY_NOISE_RADIUS` colliding with an unrelated `lib/game/*` export name; rename
  if it does, don't allowlist casually -- `CRY_NOISE_RADIUS` is *intended* to be a
  `lib/game/noise.ts` export imported by exact name into the engine, which the script
  recognizes as compliant, not a collision)
- No new `getElementById`/`innerHTML` in `engine/forest-engine.js`
- Manual/tester verification (engine correctness only asserted by the author, per role
  charter): cry audible and directional in both stereo and forced-mono playback, landmark
  first-run caption fires once, home-fire crackle audible and intensifying on the return leg,
  outbound cry pulls a roaming predator toward the child's fixed spawn point (not the live
  player) when the player is far from the child -- this last one is the one behavior a
  headless test can actually assert deterministically (predator position converges on
  `baby.x/z`, not on a moving player position, over N ticks with the player stationary
  elsewhere) and should get a `lib/game/predator.test.ts`-style unit test if the executor has
  room for one.

## Constraints (unchanged from the ticket, restated for the executor)

- Determinism: the map is seeded; none of S2/S3/S5/S6 touch map generation or the RNG stream.
- Audio is 100% procedural -- no new audio files.
- Captions required for every new audio cue (cry, home fire) -- both are the only warning
  players get, and deaf players lose them without captions.
- Reuse the existing spatial hash / broadphase -- S3's cry check reuses `checkNoise` and
  ordinary Euclidean distance to a fixed point; it adds no new spatial structure.
- Mobile parity: none of S2/S3/S5/S6 add a new player-facing input (cry/fire are passive
  audio, landmarks are passive visual/audio) -- no new touch affordance is required for this
  spec. If the implementation ends up adding any interactive follow/ignore control not
  described here, that's new scope: flag it rather than building it silently.

## Out of scope

- **S1 (home-light reach)** -- shipping separately as **LUL-1851**, already re-priced for the
  480-unit map. Do not touch `homeLight`/`BABY_LIGHT_DISTANCE` in this PR.
- **S4 (carried-noise floor + sniff-loop fairness fixes)** -- split to **LUL-1857**, sequenced
  after this ticket. See "S4" section above for why it isn't folded in.
- **Missions panel** -- moved to M2 Deepwater (see `decisions/missions-accepted-2026-09-01`).
- Ship 2 (M2 Deepwater), Ship 3 (M4 Ghost), Ship 4 (M5 Cold Walk).
- Rewards/currency (Embers) -- separate track.
- Retuning `CRY_NOISE_RADIUS`'s `32` or any of S3d/S5's audio envelope numbers after
  playtest -- file a follow-up ticket, don't reopen this spec for a constant tweak.
