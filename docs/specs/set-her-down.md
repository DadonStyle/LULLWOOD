# Spec: "Set her down" — cheap version (LUL-1815)

Source: wiki `game/mechanics/set-her-down` (accepted proposal), ticket LUL-1815.
Cheap version only — no predator reaction, no abandon ending, no payout change.
Re-derived against `release/next` @ `85a4ba3`. All line numbers below are current
as of that commit; if the executor's checkout differs, re-find by grepping for the
cited identifier before editing — do not hand-adjust line numbers blind.

**Tier: C** — touches `engine/forest-engine.js` win/lose-adjacent carry state
(`lib/game/outcome.ts` RunState). Needs `REVIEW: APPROVED` before merge.

## Player experience being built

While carrying the child, pressing the interact key (`KeyE` desktop, the existing
touch-interact button mobile — no new input on either platform) sets her down at
the player's current position. She stays there, glowing, visible. The player is
instantly light again (not `carrying`). Walking back to her and pressing the same
key lifts her again, replaying the normal pickup cinematic. No timer, no decay, no
new ending — the only cost is the walk back.

## Files and exact changes

### 1. `lib/game/outcome.ts`

Add a `setDown` field to `RunState`, threaded through `freshRunState`, and add
three functions mirroring the existing `pickupAllowed`/`beginPickup`/`canPickUp`
shape.

```ts
export interface RunState {
  entered: boolean;
  won: boolean;
  dead: boolean;
  pickingUp: boolean;
  carrying: boolean;
  babyTaken: boolean;
  setDown: boolean;
}

export function freshRunState(): RunState {
  return { entered: false, won: false, dead: false, pickingUp: false, carrying: false, babyTaken: false, setDown: false };
}
```

`pickupAllowed` (currently `lib/game/outcome.ts:39`) changes its `babyTaken` guard
from `!s.babyTaken` to `(!s.babyTaken || s.setDown)` — the only way `babyTaken` can
be true while pickup is still allowed is when she's currently set down:

```ts
function pickupAllowed(s: RunState): boolean {
  return (!s.babyTaken || s.setDown) && !s.won && !s.dead && !s.pickingUp && !s.carrying;
}
```

`beginPickup` (currently `outcome.ts:53-56`) must also clear `setDown` on a
successful transition (a repickup ends the set-down state same as a first pickup
starts it):

```ts
export function beginPickup(s: RunState): RunState {
  if (!pickupAllowed(s)) return s;
  return { ...s, babyTaken: true, pickingUp: true, setDown: false };
}
```

New functions, placed after `arriveHome`/before `canTriggerDeath` (i.e. near the
other carry-state transitions, `outcome.ts:~85`):

```ts
/** Unlike pickupAllowed, no proximity term — you can set her down anywhere while
 * carrying, so there is no separate canSetDown(s, dist, radius) shape to mirror
 * canPickUp's. This is the one deliberate deviation from the "mirror the pickup
 * trio" instruction in the proposal; the pair still has a boolean-allowed +
 * transition shape. */
function setDownAllowed(s: RunState): boolean {
  return s.carrying && !s.won && !s.dead;
}

export function canSetDown(s: RunState): boolean {
  return setDownAllowed(s);
}

export function beginSetDown(s: RunState): RunState {
  if (!setDownAllowed(s)) return s;
  return { ...s, carrying: false, setDown: true };
}
```

(`!s.pickingUp` is omitted from `setDownAllowed` — `pickingUp` and `carrying` are
already mutually exclusive in every reachable RunState, so it would be redundant,
not a new safety net. Do not add it back "for symmetry"; that's dead weight.)

### 2. `lib/game/outcome.test.ts`

Two required edits to keep the suite passing, plus new coverage:

- `outcome.test.ts:29-31` (`freshRunState clears every flag...` — a `deepEqual`
  against a literal object) — add `setDown: false` to the expected object or the
  test fails on the new field, for a reason that has nothing to do with a real
  regression. Do this in the same commit as the `outcome.ts` change, not as an
  afterthought.
- Add test cases (mirror the existing `canPickUp`/`beginPickup` block's style,
  `outcome.test.ts:60+`):
  - `canSetDown` is true only when `carrying: true` and not `won`/`dead`.
  - `beginSetDown` on an allowed state returns `{ carrying: false, setDown: true }`
    merged over the input, and is a no-op (`return s` unchanged, same object shape)
    when not allowed (e.g. not carrying).
  - `beginPickup` succeeds when `babyTaken: true, setDown: true` (the repickup
    path) and the result has `setDown: false`.
  - `beginPickup` still rejects when `babyTaken: true, setDown: false` (the
    existing "already taken, not set down" case — pins the pre-existing
    behaviour, must not regress).

### 3. `engine/forest-engine.js`

**New local, alongside the existing `carrying` declaration** (`engine/forest-engine.js:1991-1996`,
the big `let entered = ..., carrying = false, ...` chain) — add `setDown = false,`
to that same declaration list.

**Import** `beginSetDown` alongside the existing `outcome.ts` imports (find the
`import { ... } from './outcome' ` or `'../lib/game/outcome'`-style block that
already imports `beginPickup`, `completePickup`, `canPickUp`, etc. — add
`beginSetDown` to it. Do not add `canSetDown`/`setDownAllowed` to the engine's
import list; the engine checks the `carrying` local directly at the call site
(see below), matching how `pickup()`'s own gating already reads `canPickup`
directly rather than re-deriving it inline).

**`runState()`** (`engine/forest-engine.js:2031-2033`) — add the new field:

```js
function runState(){
  return { entered, won, dead, pickingUp, carrying, babyTaken: baby.taken, setDown };
}
```

**New function**, placed directly after `pickup()` (which ends at
`engine/forest-engine.js:3361`, right before `function grabThrowable(){`):

```js
function setDownChild(){
  const next = beginSetDown(runState());
  if(next.carrying === carrying) return;   // rejected -- see setDownAllowed() in lib/game/outcome.ts
  carrying = next.carrying; setDown = next.setDown;
  baby.x = player.x; baby.z = player.z;
  babyGroup.visible = true; babyGroup.position.set(baby.x, 0, baby.z); babyGroup.scale.setScalar(1);
  bundle.material.emissiveIntensity = babyHead.material.emissiveIntensity = 0.5;   // back to idle level, was 0.55 while carrying
  logChronicle('setDown');
}
```

Do **not** re-show `bwisps` here (deviation from the wiki proposal, declared —
see "Deviation from the recorded proposal" below).

**`pickup()`** (`engine/forest-engine.js:3350-3361`) — sync the new field on a
successful transition, same line that already syncs `babyTaken`/`pickingUp`:

```js
function pickup(){
  const next = beginPickup(runState());
  if(next.pickingUp === pickingUp) return;
  baby.taken = next.babyTaken; pickingUp = next.pickingUp; setDown = next.setDown;
  ...
```
(only the one added `setDown = next.setDown;` — everything else in `pickup()` is
unchanged.)

**`restart()`** (`engine/forest-engine.js:3502`) — add `setDown` to the reset line
that already restores `won`/`dead`/`pickingUp`/`carrying`/`baby.taken` from
`freshRunState()`:

```js
won = fresh.won; dead = fresh.dead; pickingUp = fresh.pickingUp; carrying = fresh.carrying; baby.taken = fresh.babyTaken; setDown = fresh.setDown;
```

**KeyE keydown handler** (`engine/forest-engine.js:2075-2079`) — insert a
`carrying` arm. Order matters: `canPickup` must stay first (it already implies
`!carrying`, so it only fires for a genuine pickup/repickup), the new `carrying`
check goes second, before the mission/throwable arms (which are already
unreachable while carrying per `engine/forest-engine.js:4045`'s `!carrying` mission
gate, but making the new arm explicit and first avoids relying on that other gate
to keep working):

```js
if(e.code === 'KeyE' && playing && !paused){
  if(canPickup) pickup();
  else if(carrying) setDownChild();
  else if(missionCanComplete) completeMissionSequence();
  else grabThrowable();
}
```

**`triggerTouchInteract()`** (`engine/forest-engine.js:4228-4234`) — identical arm,
same order, same reasoning (this function already mirrors the KeyE chain
exactly):

```js
function triggerTouchInteract() {
  const playing = isPlaying(runState());
  if(!playing || paused) return;
  if(canPickup) pickup();
  else if(carrying) setDownChild();
  else if(missionCanComplete) completeMissionSequence();
  else grabThrowable();
}
```
This is the entire mobile-parity change this ticket needs — no new touch control,
no `EngineActions`/`Hud.tsx` change, because `triggerTouchInteract` is already
wired to the same interact button used for pickup/mission-complete/throwable-grab.

**Idle-glow render block** (`engine/forest-engine.js:4072`, `if(!baby.taken){`) —
this is the block that animates `babyGroup`'s bob, halo, and light for the
not-yet-carried child. It must also run while the child is set down (baby.taken
stays permanently true after the first pickup — this spec does not change that):

```js
if(!baby.taken || setDown){
```
No other line inside that block changes — it already reads `baby.x`/`baby.z`
generically, which `setDownChild()` above has already repointed at the drop spot,
and only ever writes `babyGroup.position.y` (not `.x`/`.z`), which is why
`setDownChild()` must set the full `.position` once as shown above.

**HUD `objectiveText`** (`engine/forest-engine.js:4053-4058`) — the full three-way
branch is now:

```js
objectiveText: carrying
  ? 'Carry the child home  ·  ' + Math.round(distHome) + 'm  ·  E  to set her down'
  : (canPickup
      ? (setDown ? 'Press  E  to lift her again' : 'Press  E  to lift the child')
      : (missionCanComplete ? 'Press  E  at the drowned car'
         : (setDown ? 'She’s where you left her  ·  ' + Math.round(distBaby) + 'm'
            : 'Find the lost child  ·  ' + Math.round(distBaby) + 'm'))),
```
Copy taken verbatim from the proposal §6 (`game/mechanics/set-her-down`) for the
"carrying" and "standing over her" lines; the "away from a set-down child" line
(`She’s where you left her`) is this spec's own addition — the proposal explicitly
left that one to the spec (§6, last bullet). Register constraint from the same
proposal section applies: no mechanic words ("detection", "penalty", "safe") in
any of it. Note the curly apostrophe (`’`) to match the file's existing house
style (see `DON’T MOVE`, `engine/forest-engine.js:4024`).

**QA hook** (optional but cheap, `engine/forest-engine.js:2711-2714`,
`qaProbeBabyLight`) — add `setDown` to the returned object so a Playwright test
can assert the new state without a screenshot diff:

```js
window.ForestEngine.qaProbeBabyLight = function(){
  return { intensity: babyLight.intensity, distance: babyLight.distance,
           carrying, pickingUp, setDown, taken: baby.taken };
};
```

### 4. `docs/ELEMENTS.md`

Two updates, both in the Child section (`docs/ELEMENTS.md:170-232`):

- `docs/ELEMENTS.md:230` currently reads *"Cannot be dropped, lost, or re-hidden
  once picked up — `baby.taken` only ever goes false→true, reset by
  `generateMap()`/`restart()`."* This is no longer true and must move out of
  "What it CANNOT do." Replace it with a "What it can do" bullet (append after
  the existing carry-ride bullet, `docs/ELEMENTS.md:179-182`):
  > While carrying, can be **set down** at the player's current position
  > (`setDownChild()`) and picked up again from there (`pickup()`'s `setDown`
  > branch) — any number of times, no cost beyond the walk. `baby.taken` still
  > only ever goes false→true; the new `setDown` flag (not `baby.taken`) is what
  > toggles on drop/re-lift.
- Run `node scripts/check-elements-citations.mjs --fix` after editing — this file
  shifts other citations' line numbers below it, and the script auto-corrects the
  ones it can prove.

## Deviation from the recorded proposal — declare this, don't bury it

The proposal (`game/mechanics/set-her-down` §5, cheap version) says `setDown()`
"re-shows `babyGroup` **and `bwisps`**" and cites the fresh-map re-show mechanism
at `:764` as proof it already exists. That citation is about **spawn-time**
placement, not re-anchoring: `bwArr` (the wisp particle ring, `engine/forest-engine.js:1151-1158`)
is computed once, around `baby.x/z` **at spawn**, and the per-frame wisp update
(`engine/forest-engine.js:4078-4079`) only animates each particle's height — X/Z
are never recomputed relative to a moving `baby.x/z`. Re-showing `bwisps.visible = true`
after a set-down at a new location would show the sparkle ring floating at the
**original spawn point**, not at the drop point — a visible bug, not a faithful
port of the proposal. This spec deliberately drops the "and bwisps" half of that
line: `setDownChild()` re-shows only `babyGroup` (mesh + halo + light, all of
which correctly track `baby.x/z` every frame via the idle-glow block). Re-seeding
`bwArr` around the new position is possible but is scope growth beyond "cheap
version, nothing else changes" — out of scope here, worth a follow-up ticket if
the set-down spot reads as needing the sparkle cue in playtesting.

## Constraints

- No new predator behavior, no abandon ending, no payout/telemetry change — full
  version is explicitly out of scope (proposal §5).
- No new input on either platform — reuses `KeyE` / the existing touch-interact
  button.
- `lib/game/outcome.ts` changes must stay pure — no engine/DOM/Three.js
  reference, consistent with the rest of the file.
- Preserve existing behavior: a player who never sets the child down must see
  zero change (this is purely additive to the state machine and the KeyE
  if-chain's new arm is only reachable while `carrying`, which was previously a
  dead end for that keypress).

## Out of scope (explicitly, per the proposal)

- Predators reacting to an unattended set-down child (discharges LUL-393) — full
  version only.
- A third run outcome / "abandon" ending, its payout, and its telemetry — full
  version only, blocked on Economist numbers (proposal §7).
- The "floor version" (set-down only while hidden) — not needed since the cheap
  version ships in full per the proposal's own recommendation.
- Re-seeding `bwisps` at the drop location (see Deviation section above).
- Any change to `CARRY_DETECT_MUL`, carry glow curves, or carry pace — untouched.

## Verification

1. `cd` to the repo root (wherever this branch is checked out) and run:
   ```
   npx tsc --noEmit
   npm test
   ```
   Both must pass. `npm test` covers the new/edited `outcome.test.ts` cases above
   — a red run there is a real regression, not one of the two CI guard scripts
   (this change adds no new top-level engine identifier that collides with a
   `lib/game` export, and touches no cited line ranges in `docs/ELEMENTS.md`
   other than the one edited and re-fixed by `--fix` above).
2. `node scripts/check-elements-citations.mjs --fix` — must exit clean (0 findings
   left) after the `docs/ELEMENTS.md` edit above.
3. `npx eslint .` (the `lint` script) clean.
4. `next build` passes.
5. Manual/Playwright smoke (new test, not required to exist before merge but
   strongly recommended given this is Tier C): via `?qaHooks=1`, teleport near
   baby, pick up, walk a few steps, press the interact key again, assert
   `qaProbeBabyLight().carrying === false && qaProbeBabyLight().setDown === true`
   and `#objectiveText` reads "Press  E  to lift her again" once back in range;
   then repickup and assert `setDown === false` again and the normal carry text
   returns.

Gameplay/visual correctness (does it feel right, is the glow readable at the new
position, mobile touch ergonomics) is **unverified by this spec** — flag that
explicitly in the implementation PR per the studio's "coding agents assert code
correctness only" rule. This is Tier C, so `REVIEW: APPROVED` is required before
merge regardless.
