# SPEC: move the win fanfare from pickup to arrive-home (cheap version)

**Ticket:** LUL-1307, accepting LUL-1297's "cheap version" (Feature Scout proposal),
strengthened by LUL-1299 as the unaddressed half of founder bug LUL-1081. **Tier: C** —
win/lose sequencing (`engine/forest-engine.js` simulation). Blocking review (`REVIEW:
APPROVED`) + a Game Tester play verdict, both required before merge.

**Written against:** `release/next` @ `bfddc18` (2026-09-02). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

**Design source:** wiki `game/mechanics/ending-in-the-middle` — read it for the full
rationale; this spec only extracts the "cheap version" (its own §"The cheap version — the
whole feeling, no new assets") into exact edits. Not re-litigated here: the "fuller
version" (full 11.3s ascent moved wholesale to arrive-home) is explicitly out of scope,
per the ticket.

## Files

One file only: `engine/forest-engine.js` (edit, no new files). Optionally
`e2e/smoke.spec.ts` for one stale comment (see "Out of scope" — do it only if trivial,
skip if it causes any friction).

## The change

All line numbers below are current as of `bfddc18`.

### 1. `pickup()` — `engine/forest-engine.js:2687-2699`

Drop the `pickBoomed = false;` line (the debounce guard it fed is deleted in edit 6) and
swap the music call:

```js
function pickup(){
  const next = beginPickup(runState());
  if(next.pickingUp === pickingUp) return;   // rejected -- see pickupAllowed() in lib/game/outcome.ts
  baby.taken = next.babyTaken; pickingUp = next.pickingUp;
  pickStart = clock.elapsedTime; hidden = false;
  bwisps.visible = false;   // LUL-38: the beacon wisps marked where the child was found; carrying starts now
  pushState({ objectiveVisible: false, statusVisible: false });
  if(locked) document.exitPointerLock();
  document.body.style.cursor = 'none';
  armsGroup.visible = true;
  playPickupCue();
}
```

(Removed: `pickBoomed = false;`. Changed: `playPickupMusic();` → `playPickupCue();`, the
new function from edit 5.)

### 2. `finishPickup()` — `engine/forest-engine.js:2700-2713`

Update the comment only (it currently describes the old fireBoom-at-pickup design, which
this ticket removes). Body unchanged:

```js
function finishPickup(){
  // LUL-1307: pickup is just the gather now -- the fanfare (playWinMusic,
  // fireBoom) moved to arriveHome(), the actual win. Reset the glow
  // properties the ~2.5s gather cinematic left mid-transition.
  const next = completePickup(runState());
  pickingUp = next.pickingUp; carrying = next.carrying;
  armsGroup.visible = false;
  document.body.style.cursor = '';
  babyGroup.visible = true; babyGroup.scale.setScalar(0.6);
  bundle.material.emissiveIntensity = babyHead.material.emissiveIntensity = 0.55;
  halo.material.opacity = 0.22; babyLight.intensity = 1.3;
}
```

### 3. `arriveHome()` — `engine/forest-engine.js:2714-2733`

Add the fanfare call right after the cursor reset (world is already frozen here — `won`
just went true, so nothing else will animate over it):

```js
function arriveHome(){
  const next = outcomeArriveHome(runState());
  won = next.won; carrying = next.carrying;
  babyGroup.visible = false;
  if(locked) document.exitPointerLock();
  document.body.style.cursor = '';
  playWinMusic(); fireBoom(CONFIG.home.x, 2.2, CONFIG.home.z);   // LUL-1307: the win, not the midpoint
  const survivedSeconds = Math.max(0, clock.elapsedTime - enteredAt);
  // LUL-303: updatePredators() (the only other place that clears the charge
  // HUD) stops running once `playing` goes false here, so a charge/telegraph
  // in flight at the exact moment of arrival would otherwise render on top
  // of the win screen forever -- clear it the same way placePredators() does
  // on restart.
  activeCharges = 0;
  // LUL-1043: bank the run's Embers -- carried+home only pay on a win.
  const payout = computeWinPayout(maxDistFromHome, survivedSeconds);
  embers = applyPayout(embers, payout);
  pushState({ objectiveVisible: false, statusVisible: false, winVisible: true, chargeVisible: false, survivedSeconds,
    lastPayout: payout, embersBalance: embers.balance });
  track({ event: 'win', time_survived_ms: Math.round(survivedSeconds * 1000), seed: currentSeed, payout: payout.total, balance: embers.balance });
}
```

Only the one new line is added (`playWinMusic(); fireBoom(...)`); everything else in the
function is unchanged.

### 4. Rename `playPickupMusic()` → `playWinMusic()` — `engine/forest-engine.js:1866-1899`

Same function body (the chord/rise/bus logic does not change), only the name and two
comments:

```js
// LUL-1307: swelling warm cue for arriving home -- the win fanfare (moved
// here from pickup(), which used to spend it at the run's midpoint).
function playWinMusic(){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t0 = ctx.currentTime;
  audio.wg.gain.setTargetAtTime(0.015, t0, 0.6);   // duck wind + drone
  audio.dg.gain.setTargetAtTime(0.02, t0, 0.6);
  const bus = ctx.createGain(); bus.connect(master); bus.connect(conv);
  bus.gain.setValueAtTime(0.0001, t0);
  bus.gain.exponentialRampToValueAtTime(0.55, t0 + 3.5);
  bus.gain.setValueAtTime(0.55, t0 + 7);
  bus.gain.exponentialRampToValueAtTime(0.0001, t0 + 10.5);
  const chords = [[261.63,329.63,392.00],[196.00,293.66,392.00],[220.00,261.63,329.63],[174.61,261.63,349.23]];
  chords.forEach((ch, i) => {
    const s = t0 + i*2.5, e = s + 2.7;
    ch.forEach(f => {
      const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
      const o2 = ctx.createOscillator(); o2.type='triangle'; o2.frequency.value=f; o2.detune.value=5;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.12, s+0.8); g.gain.setValueAtTime(0.12, e-0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, e);
      o.connect(g); o2.connect(g); g.connect(bus);
      o.start(s); o2.start(s); o.stop(e+0.05); o2.stop(e+0.05);
    });
  });
  const rise = [392.00,440.00,523.25,587.33,659.25,783.99,880.00,1046.50];   // ascending as the fanfare resolves
  rise.forEach((f, i) => {
    const s = t0 + 3.5 + i*0.55;
    const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.14, s+0.02); g.gain.exponentialRampToValueAtTime(0.0001, s+1.4);
    o.connect(g); g.connect(bus); g.connect(conv); o.start(s); o.stop(s+1.5);
  });
  later(() => { if(audio){ audio.wg.gain.setTargetAtTime(0.05, audio.ctx.currentTime, 1); audio.dg.gain.setTargetAtTime(0.05, audio.ctx.currentTime, 1); } }, 11000);
}
```

Every line inside the body is byte-identical to the current `playPickupMusic()` except
the `rise` comment (`"ascending as the child lifts"` → `"ascending as the fanfare
resolves"`, since nothing lifts anymore) and the function-doc comment above it.

### 5. New function `playPickupCue()` — insert immediately after edit 4's closing `}`, before the `// distinct voice per species...` comment (currently `engine/forest-engine.js:1900`)

```js
// LUL-1307: the pickup itself is no longer the win -- ramp wind/drone UP
// (opposite of playWinMusic's duck) and sound one low note. Lifting the
// child should read as the forest noticing, not a resolution.
function playPickupCue(){
  if(!audio || !soundOn) return;
  const { ctx, master, conv } = audio, t0 = ctx.currentTime;
  audio.wg.gain.setTargetAtTime(0.11, t0, 0.4);
  audio.dg.gain.setTargetAtTime(0.09, t0, 0.4);
  const o = ctx.createOscillator(); o.type='sine'; o.frequency.value = 87.31;   // low F2
  const o2 = ctx.createOscillator(); o2.type='triangle'; o2.frequency.value = 87.31; o2.detune.value = 4;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.18, t0+0.6); g.gain.setValueAtTime(0.18, t0+1.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+2.4);
  o.connect(g); o2.connect(g); g.connect(master); g.connect(conv);
  o.start(t0); o2.start(t0); o.stop(t0+2.5); o2.stop(t0+2.5);
}
```

Do not touch `boom()` (`:2025`) or `twinkle()` (`:1855`) — this is a new, small function,
not a call to either.

### 6. `tick()`'s `pickingUp` branch — `engine/forest-engine.js:3084-3113`

Full replacement of the block from `if(pickingUp){` through the line `if(e >= 11.3)
finishPickup();` (inclusive):

```js
  if(pickingUp){
    const e = clock.elapsedTime - pickStart;
    // LUL-1307: gather only -- the child stays in the player's hands, no
    // ascent, no release. ~2.5s, retimed from the old cinematic's own
    // e in [0,3.5] "gather" phase (the ascent that used to follow it is gone).
    const lift   = key3(e, [[0,-0.95],[1.2,-0.5],[2.5,-0.35]]);
    const fwd    = key3(e, [[0,-0.5],[1.2,-0.68],[2.5,-0.72]]);
    const spread = key3(e, [[0,0.3],[1.2,0.15],[2.5,0.1]]);
    const pitchA = key3(e, [[0,0.2],[1.2,-0.2],[2.5,-0.35]]);
    armL.position.set(-spread, lift, fwd); armL.rotation.set(pitchA, 0,  0.2);
    armR.position.set( spread, lift, fwd); armR.rotation.set(pitchA, 0, -0.2);
    // the child settles into the player's hands, brightening slightly
    const ay = key3(e, [[0,0],[1.2,0.15],[2.5,0.22]]);
    babyGroup.visible = true; babyGroup.position.set(baby.x, ay, baby.z); babyGroup.rotation.y = e*0.6;
    halo.material.opacity = Math.min(0.5, 0.12 + e*0.05);
    bundle.material.emissiveIntensity = babyHead.material.emissiveIntensity = 0.5 + e*0.15;
    babyLight.intensity = key3(e, [[0,1],[1.5,2.4],[2.5,3.2]]);
    // camera holds position, glances toward the child being gathered --
    // LUL-26: under reduced motion, skip the tilt-to-follow slerp (exactly
    // the camera motion the setting exists to remove) and just hold the
    // player's own look direction instead.
    camera.position.set(player.x, CONFIG.eye, player.z);
    if(motionReduced()){
      camera.rotation.set(player.pitch, player.yaw, 0);
    } else {
      lookM.lookAt(camera.position, babyGroup.position, camera.up);
      lookQ.setFromRotationMatrix(lookM);
      camera.quaternion.slerp(lookQ, 0.06);
    }
    if(e >= 2.5) finishPickup();
```

(The line after this block, `} else if(carrying){`, is unchanged — do not touch it.)

Removed entirely: the `boomed` local, the `babyGroup.visible = !boomed` ternary, and the
`if(boomed && !pickBoomed){ pickBoomed = true; fireBoom(baby.x, ay, baby.z); }` line — the
boom is edit 3's job now, not this tick loop's.

### 7. Delete the `pickBoomed` state var — now fully dead

Three sites, all in `engine/forest-engine.js`:

- **`:1591`** (the big `let` list) — remove `pickBoomed = false,` from the list. Before:
  `deathStart = 0, deathShown = false, pickBoomed = false, scentEmitT = 0, enteredAt = 0,`
  After: `deathStart = 0, deathShown = false, scentEmitT = 0, enteredAt = 0,`
- **`:2697`** in `pickup()` — already removed by edit 1.
- **`:2767`** in `restart()` — remove just the `pickBoomed = false; ` token. Before:
  `pickBoomed = false; boomGroup.visible = false; boomStart = -1; if(flashEl) flashEl.style.opacity = '0';`
  After:
  `boomGroup.visible = false; boomStart = -1; if(flashEl) flashEl.style.opacity = '0';`

Confirm with `grep -n pickBoomed engine/forest-engine.js` after all edits — it must return
nothing.

## Verification

1. `grep -n pickBoomed engine/forest-engine.js` — no output.
2. `grep -n playPickupMusic engine/forest-engine.js` — no output (fully renamed).
3. `npx tsc --noEmit` — clean (this file is plain JS consumed by TS callers; the repo's
   `tsc --noEmit` must still pass with no new errors).
4. `npm run lint` (the `eslint` script — **not** `next lint`, which is removed) — clean,
   specifically no `no-unused-vars` on `pickBoomed`, `lookM`, or `lookQ`.
5. `npx playwright test e2e/smoke.spec.ts -g "pressing E lifts the child"` — must still
   pass. It polls the HUD for the "Carry the child home" handoff rather than sleeping a
   fixed duration, so the shortened ~2.5s cinematic does not need a test change to keep
   passing (see `e2e/smoke.spec.ts:193-234`).
6. `next build` passes, no console errors on load.
7. **Gameplay/audio/VFX correctness is not verifiable by the diff author** — the win
   fanfare's timing, the burst's position over the home ring, and the inverted pickup cue
   are all unverified until a Game Tester (Tier C) confirms them in a browser. Say this
   explicitly in the handoff; do not claim it "feels right" from reading the code.

## Constraints

- `engine/forest-engine.js` only. No new assets, no new files besides this spec (already
  written). Byte-identical map seeds — nothing here touches `generateMap()` or any RNG
  draw.
- Do not touch `boom()`, `fireBoom()`'s own body, `updateBoom()`, or `twinkle()` — only
  their call sites move/change.
- Do not touch the `carrying` branch (`:3114` onward, `} else if(carrying){...`) or
  anything in `outcome.ts` — the state machine's transitions (`beginPickup`,
  `completePickup`, `outcomeArriveHome`) are unchanged; only what the engine *does* at
  each transition changes.
- Keep `playWinMusic()`'s internal chord/rise/bus/duck logic byte-identical — only its
  name, its two comments, and its call site move.

## Out of scope

- The "fuller version" (full 11.3s ascent moved wholesale to `arriveHome()`) — ship this
  cheap version first, per the ticket.
- `RunRecap` / `computeWinPayout` / any Embers number — Game Economist's lane, not touched.
- The win/loss screen *text* or copy — Player Psychologist's lane
  (`game/psychology/stake-legibility`), not touched.
- `e2e/smoke.spec.ts:206-212`'s comment references the old "~11.3s" timeline by name. It is
  now stale but does not break the test (see Verification §5). Fixing it is optional
  polish, not required for this ticket — if you touch it, keep the diff to that one
  comment block, nothing else in the file.
- `carry-leg-inert` (the return leg being mechanically identical to the outbound leg) —
  filed separately, deliberately not re-litigated here.
