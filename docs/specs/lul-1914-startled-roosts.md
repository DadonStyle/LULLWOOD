# SPEC — LUL-1914: startled roosts, slice (a)

Traces: [[game/mechanics/startled-roosts]] §3/§4/§6(a) ·
[[decisions/startled-roosts-2026-09-07]] · CTO plan on LUL-1914 (issue document `plan`).

**Tier: B** (`engine/tuning.js`, `engine/forest-engine.js` tuning/feedback addition —
reads predator position/state, writes only new local particle/audio/cooldown state;
never calls `effectiveDetect()`, `canSee()`, or `hearThrowableNoise()`; sets no field on
`predators[]`). Confirms the CTO plan's Tier B assessment. Merge on green CI; open the
Code Reviewer child issue after merge per the Tier B flow — do not block the branch on it.

All line numbers below re-verified against `origin/release/next` @ `a78f09f0` (current
head at spec-writing time) — several have drifted from the plan document's citations
(which were against an earlier commit); use the numbers in this spec, not the plan's.

## Files

1. `engine/tuning.js` — add two new exports.
2. `engine/forest-engine.js` — add roost state, update loop, effects, call site, restart reset.
3. `docs/ELEMENTS.md` — add a new subsection documenting the feature.

## 1. `engine/tuning.js`

Insert immediately after the `LANDMARKS` array closes (currently ends `];` at line 62,
right before the blank line preceding `export const PSPEC`... actually before whatever
follows — insert directly after the `LANDMARKS` closing `];`):

```js
// LUL-1914: startled roosts, slice (a) -- fixed canopy sites that flush when a
// predator passes through at speed. Same "static list, no rng() draw" contract
// as LANDMARKS immediately above -- generateMap() stays byte-identical per seed.
export const ROOSTS = [
  { kind: 'canopyNE', x: 110,  z: 90,   radius: 20 },
  { kind: 'canopyN',  x: 55,   z: 135,  radius: 20 },
  { kind: 'canopyW',  x: -140, z: 15,   radius: 20 },
  { kind: 'canopyS',  x: -30,  z: -140, radius: 20 },
  { kind: 'canopyE',  x: 150,  z: -25,  radius: 20 },
];
export const ROOST_COOLDOWN = 32;   // seconds a roost stays quiet after firing
```

Do not change `LANDMARKS` itself. Do not add an `rng()` call anywhere in this file.

## 2. `engine/forest-engine.js`

### 2a. Import

Find the existing import line that pulls from `./tuning.js` (it currently imports
`LANDMARKS`, `PSPEC`, etc. — grep the top of the file for `from './tuning`). Add
`ROOSTS, ROOST_COOLDOWN` to that same import's destructured list. Do not add a second
import statement.

### 2b. Module-scope state — place directly after the `bspPts`/`boomGroup` block

That block currently ends at line 1163 (`boomGroup.add(boomFlash, boomRing, bspPts);`)
followed by `let boomStart = -1;` at line 1164. Insert after `let boomStart = -1;`:

```js
// LUL-1914: startled roosts, slice (a) -- one small persistent THREE.Points burst
// per fixed roost site (not fireBoom/boomGroup: that's a single shared instance
// built for one radial burst at a time; two roosts can flush within the same
// few seconds from different predators, so each site needs its own timer).
const ROOST_BURST_PTS = 10;   // bird-lift silhouette, not an explosion -- keep small
const roostCooldown = new Float32Array(ROOSTS.length);      // seconds remaining, 0 = ready
const roostBurstStart = new Float32Array(ROOSTS.length).fill(-1);  // seconds since flush, -1 = idle
const roostBurstVel = ROOSTS.map(() => []);
const roostGroups = ROOSTS.map(r => {
  const g = new THREE.Group();
  g.position.set(r.x, 14, r.z);   // canopy height, above ground cover/fog line
  g.visible = false;
  const arr = new Float32Array(ROOST_BURST_PTS * 3);
  const pts = new THREE.Points(new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ color: 0x2a2620, size: 0.35, transparent: true, opacity: 1,
      depthWrite: false, fog: false }));   // fog:false: must read above the fog line at range (proposal §3)
  pts.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  pts.userData.arr = arr;
  g.add(pts);
  g.userData.pts = pts;
  scene.add(g);
  return g;
});
```

### 2c. `triggerRoostBurst` / `roostFlushSound` / `flushRoost` — place directly after
`function updateBoom(dt){...}` (ends at line 1177 with its closing `}`)

```js
// LUL-1914: slice (a) burst -- 10 points biased upward (bird-lift), small lateral
// spread, ~0.9s rise-and-fade. Keyed by roost index, independent of boomGroup.
function triggerRoostBurst(i){
  const g = roostGroups[i], pts = g.userData.pts, arr = pts.userData.arr;
  const vel = roostBurstVel[i];
  vel.length = 0;
  for(let k=0;k<ROOST_BURST_PTS;k++){
    const a = Math.random()*Math.PI*2;
    vel.push([Math.cos(a)*1.2, 3 + Math.random()*2.5, Math.sin(a)*1.2]);
    arr[k*3] = arr[k*3+1] = arr[k*3+2] = 0;
  }
  pts.geometry.attributes.position.needsUpdate = true;
  pts.material.opacity = 1;
  g.visible = true;
  roostBurstStart[i] = 0;
}
function updateRoostBursts(dt){
  for(let i=0;i<roostGroups.length;i++){
    if(roostBurstStart[i] < 0) continue;
    roostBurstStart[i] += dt;
    const e = roostBurstStart[i];
    const pts = roostGroups[i].userData.pts, arr = pts.userData.arr, vel = roostBurstVel[i];
    for(let k=0;k<ROOST_BURST_PTS;k++){
      arr[k*3]   += vel[k][0]*dt;
      arr[k*3+1] += vel[k][1]*dt;
      arr[k*3+2] += vel[k][2]*dt;
    }
    pts.geometry.attributes.position.needsUpdate = true;
    pts.material.opacity = Math.max(0, 1 - e/0.9);
    if(e > 0.9){ roostGroups[i].visible = false; roostBurstStart[i] = -1; }
  }
}
// LUL-1914: positional wing-clatter -- modeled on scheduleBirdChirp's bandpass-noise
// graph, made positional via missionWaypointHum's own panner/falloff math (both
// referenced by file:line in the wiki proposal and CTO plan). 3-4 chirps in quick
// succession so it reads as a flock lifting, not one bird. Math.random(), not the
// seeded rng -- same scope-exemption the existing ambient bird chirp already has.
function roostFlushSound(x, z){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio;
  const dx = x - player.x, dz = z - player.z;
  const dist = Math.hypot(dx, dz);
  const near = Math.max(0, Math.min(1, 1 - dist / 140));
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx =  Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  const right = dx*rx + dz*rz, fwd = dx*fx + dz*fz;
  const panVal = Math.max(-1, Math.min(1, right / Math.max(1, Math.hypot(right, fwd))));
  const bursts = 3 + Math.floor(Math.random()*2);   // 3-4
  let delay = 0;
  for(let n=0;n<bursts;n++){
    delay += 0.04 + Math.random()*0.05;   // 40-90ms apart
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = noise(ctx, 0.08, false);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = 2200 + Math.random() * 1800; f.Q.value = 4;
    const pan = ctx.createStereoPanner(); pan.pan.value = panVal;
    const g = ctx.createGain();
    const peak = (0.05 + near * 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(f); f.connect(pan); pan.connect(g); g.connect(master); g.connect(conv);
    src.start(t);
  }
  if(captionsOn){
    const cnear = dist < 60 ? 'near' : 'far';
    const side = Math.abs(right) < Math.abs(fwd)*0.6 ? (fwd >= 0 ? 'ahead' : 'behind') : (right > 0 ? 'right' : 'left');
    pushState({ caption: `birds scatter · ${cnear} · ${side}`, captionId: ++captionSeq });
  }
}
function flushRoost(i){
  triggerRoostBurst(i);
  roostFlushSound(ROOSTS[i].x, ROOSTS[i].z);
}
```

Note: `noise()`, `audio`, `soundOn`, `captionsOn`, `pushState`, `captionSeq`, `player`
are all existing module-scope bindings already used by `scheduleBirdChirp`/
`missionWaypointHum` in this same file — no new imports needed.

### 2d. `updateRoosts(dt)` — place directly after `function updatePredators(dt, noiseRadius){...}` closes

(`updatePredators` starts at line 1553; place this after its closing `}`.)

```js
// LUL-1914: slice (a), one-way feedback only. Reads p.x/p.z/p.state/p.inert on each
// active predator; writes nothing on any predator. Does not call effectiveDetect(),
// canSee(), or hearThrowableNoise() -- this is a spectator of predator state, not a
// participant. Cooldown array is reset in restart().
function updateRoosts(dt){
  updateRoostBursts(dt);
  for(let i=0;i<ROOSTS.length;i++){
    if(roostCooldown[i] > 0){ roostCooldown[i] -= dt; continue; }
    const r = ROOSTS[i];
    for(const p of predators){
      if(p.inert || p.state !== 'chase') continue;
      if(Math.hypot(p.x-r.x, p.z-r.z) < r.radius){
        flushRoost(i);
        roostCooldown[i] = ROOST_COOLDOWN;
        break;
      }
    }
  }
}
```

### 2e. Call site

Find `if(playing) updatePredators(dt, noiseRadius);` (currently line 3901). Add
immediately below it, same indentation:

```js
  if(playing) updateRoosts(dt);   // LUL-1914: roost feedback, same gate as predator AI
```

### 2f. `restart()` reset

Find `boomGroup.visible = false; boomStart = -1; if(flashEl) flashEl.style.opacity = '0';`
inside `function restart(){...}` (currently line 3479). Add immediately after it, same
line or next line:

```js
  roostCooldown.fill(0); roostBurstStart.fill(-1); roostGroups.forEach(g => g.visible = false);
```

## 3. `docs/ELEMENTS.md`

Add a new `##`-level section, placed directly after the existing `## The Bog (LUL-25 /
LUL-1483) — live on \`main\`` section (which starts at line 1423 and is the closest
precedent — a small fixed-geometry environmental feature). Model the prose on that
section's format (what it is, what's new, what's citable), e.g.:

```markdown
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
```

Run `node scripts/check-elements-citations.mjs --fix` after adding this section (before
committing) to catch any line-number drift the CI guard would otherwise flag as
unrelated failures per the CI-guards note in `AGENTS.md`.

## Constraints

- No `rng()` call anywhere in this diff. `Math.random()` in the burst/audio code is the
  same existing scope-exemption `scheduleBirdChirp` already uses — do not switch it to
  the seeded `rng`.
- Do not call `effectiveDetect()`, `canSee()`, `hearThrowableNoise()`, or
  `checkThrowableNoise()` anywhere in the new code, and do not write to any field on a
  `predators[]` entry (`p.state`, `p.noiseTarget`, etc.). Grep the diff for those four
  names before opening the PR — none should appear outside of `updateRoosts`'s read-only
  `p.inert`/`p.state`/`p.x`/`p.z` reads.
- Do not modify `LANDMARKS`, `fireBoom`, `boomGroup`, or any existing win-burst code path.
- No new mobile input, no `EngineActions` change — this is a pure presentation change,
  identical on desktop and mobile (per the wiki proposal §9 and CTO plan §4).
- No new npm dependency, no new asset under `/public`.

## Out of scope — do not build

- Slice (b): any player-triggered flush, any `hearThrowableNoise()` call from player
  movement. Tier C, deferred pending Player Psychologist reactivation.
- Slice (c): registering roosts through `lib/game/eventSites.ts`. Sequenced after
  LUL-1486/LUL-1848.

## Verification

1. `cd /path/to/lullwood-worktree && npx tsc --noEmit` — must stay clean (this file is
   plain JS consumed by TS elsewhere; confirms no type-check regression from the new
   exports' shape).
2. `npm run build` (or the repo's `next build` script) — must pass.
3. `npx eslint engine/forest-engine.js engine/tuning.js` — clean.
4. Determinism: in a Node REPL or scratch script, call `generateMap(12345)` twice
   (same seed) before and after this diff and confirm identical tree/predator/child
   placement — no `rng()` was added, so this should be a no-op check, but confirm it.
5. `grep -n "effectiveDetect\|canSee(\|hearThrowableNoise\|checkThrowableNoise" <diff>`
   — must return nothing inside the new `updateRoosts`/`flushRoost`/`triggerRoostBurst`/
   `roostFlushSound` functions.
6. `node scripts/check-elements-citations.mjs` — clean (run `--fix` first if needed).
7. Manual/local play smoke (best effort, no CI signal for this): temporarily lower
   `ROOST_COOLDOWN` and widen a `radius` to confirm a chasing predator near
   `{x:110,z:90}` fires the burst + panned clatter once, then stays silent for the
   cooldown window — revert the temporary tuning before committing.

Commit message: `LUL-1914: startled roosts slice (a) -- one-way predator-flush feedback
layer`. Branch: `lul-1914-startled-roosts`. Tier B — merge on green, open Code Reviewer
child issue after merge (post-merge review, not blocking).
