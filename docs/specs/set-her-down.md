# SPEC — LUL-1815 "Set her down" — carry leg set-down/pick-up verb (cheap version)

Tier: **C** (`engine/forest-engine.js` carrying/pickup simulation, `lib/game/outcome.ts`
run-outcome state machine used by win/lose conditions). Requires `REVIEW: APPROVED`
before merge — do not merge on green CI alone.

Written against `origin/release/next` @ `ec8f30d`. All line numbers below are verified
against that commit; if the target file has moved on by the time this is implemented,
re-locate by the cited symbol name, not the raw number, and report a spec bug if the
symbol itself is gone.

Source: wiki `game/mechanics/set-her-down` (Feature Scout proposal, accepted by CEO
2026-09-07, cheap version only) and the LUL-1815 ticket description. Full design
rationale lives there — this spec is the exact edit list, not the reasoning.

## Scope — CHEAP VERSION ONLY

Set-down and pick-back-up. No predator reaction to an unattended child (LUL-393 stays
deferred), no third run outcome/ending, no payout change, no new key on either platform.
Do not build any of that in this ticket.

## Files touched

1. `lib/game/outcome.ts` — new `RunState.setDown` field + `setDownAllowed()` /
   `canSetDown()` / `beginSetDown()`, plus a one-line change to `pickupAllowed()` and
   `beginPickup()`
2. `lib/game/outcome.test.ts` — update one exact-shape assertion, add new tests
3. `engine/forest-engine.js` — new `setDown()` function, new `babySetDown` local,
   `runState()`/`restart()` wiring, `KeyE` chain, `triggerTouchInteract()`, HUD
   `objectiveText`, idle-glow gate
4. `docs/ELEMENTS.md` — update the Child element's "what it cannot do" bullet (required,
   same PR)

---

## §1. `lib/game/outcome.ts`

### 1.1 `RunState` — add a field

At line 10-17, add `setDown` after `carrying`:

```ts
export interface RunState {
  entered: boolean;
  won: boolean;
  dead: boolean;
  pickingUp: boolean;
  carrying: boolean;
  setDown: boolean;
  babyTaken: boolean;
}
```

### 1.2 `freshRunState()` — line 19-21

```ts
export function freshRunState(): RunState {
  return { entered: false, won: false, dead: false, pickingUp: false, carrying: false, setDown: false, babyTaken: false };
}
```

### 1.3 `pickupAllowed()` — line 34-40

Change the `!s.babyTaken` term so a set-down child can be lifted again:

```ts
function pickupAllowed(s: RunState): boolean {
  // `!s.babyTaken` alone would permanently block re-pickup once she's ever been taken --
  // `s.setDown` (LUL-1815) is the one case where a true babyTaken must still allow it.
  return (!s.babyTaken || s.setDown) && !s.won && !s.dead && !s.pickingUp && !s.carrying;
}
```

Do not touch `canPickUp()` (line 46-48) — it already just wraps `pickupAllowed(s) &&
distToBaby < radius` and needs no change.

### 1.4 `beginPickup()` — line 53-56

Clear `setDown` on every successful pickup (initial or re-pickup), so the flag never
carries stale into a fresh `carrying` state:

```ts
export function beginPickup(s: RunState): RunState {
  if (!pickupAllowed(s)) return s;
  return { ...s, babyTaken: true, pickingUp: true, setDown: false };
}
```

### 1.5 New: set-down transition — add after `beginPickup`/`completePickup` (after line 65,
before the `arriveHomeAllowed` comment block at line 67), mirroring the
`pickupAllowed`/`canPickUp`/`beginPickup` trio:

```ts
/** Gate for the set-down input: only while actually carrying, and not mid-win/-death
 * (both already imply !carrying via their own transitions, but this stays explicit --
 * same reasoning as pickupAllowed's explicit !s.carrying, see its comment above). No
 * proximity term: unlike pickup, set-down has no target to be near, so there is no
 * canSetDown(state, dist, radius) wrapper the way canPickUp wraps pickupAllowed. */
function setDownAllowed(s: RunState): boolean {
  return s.carrying && !s.won && !s.dead;
}

/** Gate for the HUD prompt / KeyE-enabled state while carrying. Thin export of
 * setDownAllowed(), kept as its own function (not just exporting setDownAllowed
 * directly) for the same reason canPickUp exists alongside pickupAllowed: callers
 * outside this module should never reach for the private `*Allowed` name. */
export function canSetDown(s: RunState): boolean {
  return setDownAllowed(s);
}

/** Puts the child down at the player's current position. No-ops (returns `s` unchanged)
 * when not currently allowed, mirroring beginPickup(). The engine caller is responsible
 * for writing baby.x/z to the player's position -- this module has no coordinates. */
export function beginSetDown(s: RunState): RunState {
  if (!setDownAllowed(s)) return s;
  return { ...s, carrying: false, setDown: true };
}
```

---

## §2. `lib/game/outcome.test.ts`

### 2.1 Fix the now-broken exact-shape assertion (existing test, ~line 26-30)

```ts
test('freshRunState clears every flag, including babyTaken', () => {
  const s = freshRunState();
  assert.deepEqual(s, {
    entered: false, won: false, dead: false, pickingUp: false, carrying: false, setDown: false, babyTaken: false,
  });
});
```

### 2.2 Add imports — extend the existing import block (line 3-16) with `canSetDown`,
`beginSetDown`.

### 2.3 New tests — add near the pickup tests:

```ts
test('pickupAllowed (via canPickUp) rejects a fresh not-yet-taken-back child the same as always', () => {
  assert.equal(canPickUp(state(), 1, RADIUS), true);
});

test('canPickUp allows re-pickup of a set-down child even though babyTaken is still true', () => {
  const s = state({ babyTaken: true, setDown: true });
  assert.equal(canPickUp(s, 1, RADIUS), true);
});

test('canPickUp still rejects a taken, not-set-down child (ordinary carrying-not-yet-set-down case)', () => {
  const s = state({ babyTaken: true, setDown: false });
  assert.equal(canPickUp(s, 1, RADIUS), false);
});

test('beginPickup on a set-down child clears setDown and re-enters pickingUp', () => {
  const s = state({ babyTaken: true, setDown: true });
  const next = beginPickup(s);
  assert.deepEqual(next, { ...s, babyTaken: true, pickingUp: true, setDown: false });
});

test('canSetDown is true only while carrying', () => {
  assert.equal(canSetDown(state({ carrying: true })), true);
  assert.equal(canSetDown(state({ carrying: false })), false);
});

test('canSetDown rejects while dead or won even if carrying is (inconsistently) still true', () => {
  assert.equal(canSetDown(state({ carrying: true, dead: true })), false);
  assert.equal(canSetDown(state({ carrying: true, won: true })), false);
});

test('beginSetDown clears carrying and sets setDown on a legitimate call', () => {
  const s = state({ carrying: true, babyTaken: true });
  const next = beginSetDown(s);
  assert.deepEqual(next, { ...s, carrying: false, setDown: true });
});

test('beginSetDown is a no-op when not carrying', () => {
  const s = state({ carrying: false });
  assert.deepEqual(beginSetDown(s), s);
});

test('a second beginSetDown in the same frame is rejected (carrying already false)', () => {
  const first = beginSetDown(state({ carrying: true }));
  const second = beginSetDown(first);
  assert.deepEqual(second, first);
});
```

---

## §3. `engine/forest-engine.js`

### 3.1 Import — extend the `@/lib/game/outcome` import block (line 16-27) with
`canSetDown` and `beginSetDown`:

```js
import {
  freshRunState,
  isPlaying,
  canPickUp,
  beginPickup,
  completePickup,
  canArriveHome,
  arriveHome as outcomeArriveHome,
  triggerDeath as outcomeTriggerDeath,
  canGrabThrowable,
  canThrowThrowable,
  canSetDown,
  beginSetDown,
} from '@/lib/game/outcome';
```

### 3.2 New local — line 1841-1846, add `babySetDown = false,` to the same `let` chain
that declares `carrying`:

```js
let entered = false, walk = CONFIG.walk, won = false, canPickup = false,
    dead = false, pickingUp = false, carrying = false, babySetDown = false, pickStart = 0, hidden = false, hideTime = 0, eyeH = CONFIG.eye,
```

(rest of that statement unchanged)

### 3.3 `runState()` — line 1869-1871, add the field:

```js
function runState(){
  return { entered, won, dead, pickingUp, carrying, setDown: babySetDown, babyTaken: baby.taken };
}
```

### 3.4 New `setDown()` function — add immediately after `pickup()` (after line 3134, before
`function grabThrowable(){` at line 3135):

```js
function setDown(){
  const next = beginSetDown(runState());
  if(next.carrying === carrying) return;   // rejected -- see setDownAllowed() in lib/game/outcome.ts
  carrying = next.carrying; babySetDown = next.setDown;
  baby.x = player.x; baby.z = player.z;
  babyGroup.position.set(baby.x, 0, baby.z);
  babyGroup.visible = true; babyGroup.scale.setScalar(1);
  bwisps.visible = true;   // LUL-38's beacon wisps, hidden by pickup() at :3128 -- back on so she's spottable through fog again
  // reset glow to the idle baseline finishPickup()/restart() also use (:3172/:3278) --
  // the per-frame idle-glow block (§3.7 below) takes over the animated curve from here.
  bundle.material.emissiveIntensity = babyHead.material.emissiveIntensity = 0.5;
}
```

### 3.5 `KeyE` keydown handler — line 1912-1917, add a third arm between `canPickup` and
`missionCanComplete`:

```js
  // LUL-1258: no new key -- mission completion reuses the interact action.
  // LUL-1815: set-down is a third arm of the same multiplex -- carrying is mutually
  // exclusive with canPickup (pickupAllowed requires !carrying), so ordering vs.
  // canPickup doesn't matter, but it must come before missionCanComplete/grabThrowable
  // since carrying is already true whenever this arm should fire.
  if(e.code === 'KeyE' && playing && !paused){
    if(canPickup) pickup();
    else if(carrying) setDown();
    else if(missionCanComplete) completeMissionSequence();
    else grabThrowable();
  }
```

### 3.6 `triggerTouchInteract()` — line 3970-3976, same third arm (mobile parity,
`decisions/0012-mobile-parity-mandate`):

```js
  function triggerTouchInteract() {
    const playing = isPlaying(runState());
    if(!playing || paused) return;
    if(canPickup) pickup();
    else if(carrying) setDown();
    else if(missionCanComplete) completeMissionSequence();
    else grabThrowable();
  }
```

### 3.7 Idle-glow gate — line 3818 currently reads `if(!baby.taken){`. A set-down child
has `baby.taken === true` forever (one-way door, unchanged) but must still get the idle
bob/glow/wisp-drift treatment while she's on the ground awaiting re-pickup. Change the
condition:

```js
  // the child's idle glow (outside the cinematic) -- also covers a set-down child (LUL-1815):
  // baby.taken stays true forever once first picked up, so babySetDown is the only signal
  // that she's back on the ground.
  if(!baby.taken || babySetDown){
```

The body of that block (line 3819-3826) is unchanged — it already reads `baby.x/z`
indirectly via `babyGroup`'s already-set position and drives `halo`/`babyLight`/`bwisps`
generically, with no reference to `pickingUp`/`carrying` that would need updating.

### 3.8 `restart()` — line 3268-3283. Line 3272 resets the RunState-backed locals from
`freshRunState()`; add `babySetDown`:

```js
  won = fresh.won; dead = fresh.dead; pickingUp = fresh.pickingUp; carrying = fresh.carrying; babySetDown = fresh.setDown; baby.taken = fresh.babyTaken;
```

### 3.9 HUD `objectiveText` — line 3799-3804:

```js
    pushState({
      objectiveVisible: true, objectiveReady: canPickup,
      objectiveText: carrying
        ? 'Carry the child home  ·  ' + Math.round(distHome) + 'm  ·  E  to set her down'
        : (canPickup ? (babySetDown ? 'Press  E  to lift her again' : 'Press  E  to lift the child')
           : (missionCanComplete ? 'Press  E  at the drowned car' : 'Find the lost child  ·  ' + Math.round(distBaby) + 'm')),
```

(rest of the `pushState` call, line 3805-3813, unchanged)

---

## §4. `docs/ELEMENTS.md`

Update the Child element's "What it CANNOT do" bullet (currently line 223-224):

```
- Cannot be dropped, lost, or re-hidden once picked up — `baby.taken` only
  ever goes false→true, reset by `generateMap()`/`restart()`.
```

replace with:

```
- Cannot be lost or re-hidden once picked up — `baby.taken` only ever goes
  false→true, reset by `generateMap()`/`restart()`. **As of `LUL-1815`**, she
  *can* be set back down while carried (`setDown()`, same `KeyE`/touch-interact
  input as pickup — no new key) — this returns her to a fixed point on the
  ground (glowing, idle-animated, re-spottable via the beacon wisps) and the
  player to full speed/no carry-detect penalty until she's picked up again
  from that spot. `carrying` itself does still round-trip true→false→true;
  only `baby.taken` is one-way.
```

Also add one line to the "What it can do" list (after line 182, the `arriveHome()`
bullet) noting the new verb exists, for anyone scanning that list alone:

```
- **As of `LUL-1815`**, be set back down mid-carry (`setDown()`) and picked
  back up from where she was left (`pickupAllowed()`'s `babyTaken` guard is
  relaxed by a `setDown` flag in `lib/game/outcome.ts`) — see "cannot do"
  below for the exact boundary.
```

---

## Constraints — what must NOT change in this ticket

- No new predator behavior of any kind. A predator standing on a set-down child still has
  zero reaction (LUL-393 stays exactly as filed — do not touch anything under
  `updatePredators()`).
- No new run outcome, no new payout, no telemetry change. `arriveHomeAllowed()` still
  requires `s.carrying`; walking home without her is still not a way to end a run.
- No new input binding on either platform — `KeyE` and `triggerTouchInteract()` are the
  only two call sites that change, and both are pure reordering/insertion into an
  existing if-chain.
- `lib/game/outcome.ts` stays pure — no `Math`/wall-clock/DOM reads added to it. All new
  functions take only `RunState` (and, for the existing `canPickUp`, primitives already
  in its signature).
- Do not add a `canSetDown(state, dist, radius)` proximity wrapper — set-down has no
  target position to be near (unlike pickup), so `canSetDown(s)` takes only `RunState`.

## Verification

1. `npx tsc --noEmit` — clean.
2. `npm test -- lib/game/outcome.test.ts` (or the project's full `npm test` if that's the
   only wired entry point) — all existing tests still pass with the `setDown: false`
   field added to every `freshRunState()`-based fixture, and every new §2.3 test passes.
3. `npx eslint engine/forest-engine.js lib/game/outcome.ts` — clean.
4. `next build` — passes.
5. Manual/engine-level smoke (gameplay correctness is unverified by Founding Engineer
   per role; Game Engineer/tester should confirm): pick up the child, press `E` while
   carrying → she appears on the ground where you're standing, glowing and bobbing, HUD
   reads "Press  E  to lift her again"; walk away and back, press `E` again → carrying
   resumes, HUD reverts to the carry line with the "E to set her down" suffix; repeat on
   a touch/mobile viewport via `triggerTouchInteract()`.

## Out of scope (deferred, not declined — do not build any of this here)

- Predators reacting to an unattended set-down child (LUL-393).
- A third run outcome / abandon ending / abandon payout.
- Any per-second cost or farm-safety check on the set-down+re-pickup loop (Game
  Economist's three numbers in the wiki page's §7 — none of them block this ticket).
- The floor version (set-down only while hidden) — not needed, cheap version ships in
  full per the accepted proposal.
