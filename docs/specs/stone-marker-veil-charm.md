# SPEC: Stone Marker veil-charm — second in-run Embers spend site

LUL-1210. Design source (read for full rationale, not needed to implement): wiki
`game/mechanics/veil-charm` (Feature Scout proposal, LUL-1193), `game/economy/veil-charm-price`
(Game Economist pricing), `decisions/veil-charm-accepted-2026-09-02` (acceptance + open items).

All file:line citations below were verified directly against `release/next` on 2026-09-08 (a
prior draft of this spec was checked against a stale local branch and had wrong line numbers —
this version replaces it). If a citation is off by a few lines by the time you implement, the
surrounding comment text quoted here is the anchor to search for, not the line number alone.

**Tier: B minimum** (per the acceptance decision — detection-adjacent via `veilAmount` →
`effectiveDetect`). A play verdict is expected even though the diff is small and additive.

## The mechanic, precisely

At the Stone Marker landmark (mesh/collider already shipped, LUL-374), spend 15 unbanked Embers
for a one-shot veil reserve: the next time the player's held mist-veil (`KeyF`) would fully drain
and lock out, it instead snaps back to the unlock threshold and stays unlocked, consuming the
reserve. Never offered while `carrying` (same rule as every other landmark purchase). Priced so
it can never fail for lack of funds: Stone Marker sits 125 units from home, so
`computeDepth(maxDistFromHome) >= 31` by geometry at the point of purchase — 15 leaves a 16-point
margin (Economist's proof, `game/economy/veil-charm-price`).

**Note:** `engine/forest-engine.js` already tracks and displays a live unbanked total
(`livePileEmbers`, LUL-1315 — `computeDepth(maxDistFromHome) + computeSurvival(...)`, pushed to
the HUD every tick, rendered at `components/Hud.tsx:511` as `Unbanked: {state.livePileEmbers}`).
This spec's spend must be reflected there too (see §5) or the displayed pile will look wrong
after a purchase.

## Files

1. `lib/game/veil.ts` — edit
2. `lib/game/veil.test.ts` — edit (add cases)
3. `lib/game/economy.ts` — edit
4. `engine/tuning.js` — edit
5. `engine/forest-engine.js` — edit
6. `components/Hud.tsx` — edit
7. `docs/ELEMENTS.md` — edit (definition of done: this PR adds a new interaction)

## The change

### 1. `lib/game/veil.ts`

`VeilChargeState` (currently `{ charge: number; locked: boolean }`) gains a third field:

```ts
export interface VeilChargeState {
  /** 1 = full, 0 = fully drained. */
  charge: number;
  /** true from the frame a full drain happens until charge regenerates past
   * VEIL_UNLOCK_CHARGE -- while locked, holding the trigger key does nothing. */
  locked: boolean;
  /** true if a Stone Marker charm is banked -- consumed instead of locking out
   * the next time a full drain would otherwise happen. LUL-1210. */
  reserve: boolean;
}
```

`stepVeilCharge()`'s current body (verify against the live file — this is quoted from
`release/next` as of this spec, unaffected by the stale-citation note above since this file
had zero drift):

```ts
export function stepVeilCharge(
  state: VeilChargeState,
  held: boolean,
  dt: number,
  maxHold: number = VEIL_MAX_HOLD,
): VeilChargeState & { active: boolean } {
  let { charge, locked } = state;
  if (locked && charge >= VEIL_UNLOCK_CHARGE * VEIL_MAX_HOLD / maxHold) locked = false;
  const active = held && !locked && charge > 0;
  if (active) {
    charge = Math.max(0, charge - dt / maxHold);
    if (charge <= 0) locked = true;
  } else {
    charge = Math.min(1, charge + (dt / maxHold) * VEIL_REGEN_MUL);
  }
  return { charge, locked, active };
}
```

Replace with:

```ts
export function stepVeilCharge(
  state: VeilChargeState,
  held: boolean,
  dt: number,
  maxHold: number = VEIL_MAX_HOLD,
): VeilChargeState & { active: boolean } {
  let { charge, locked, reserve } = state;
  if (locked && charge >= VEIL_UNLOCK_CHARGE * VEIL_MAX_HOLD / maxHold) locked = false;
  const active = held && !locked && charge > 0;
  if (active) {
    charge = Math.max(0, charge - dt / maxHold);
    if (charge <= 0) {
      if (reserve) {
        // LUL-1210: the Stone Marker charm -- spend it instead of locking out.
        charge = VEIL_UNLOCK_CHARGE * VEIL_MAX_HOLD / maxHold;
        reserve = false;
      } else {
        locked = true;
      }
    }
  } else {
    charge = Math.min(1, charge + (dt / maxHold) * VEIL_REGEN_MUL);
  }
  return { charge, locked, reserve, active };
}
```

Only behavior change when `reserve` is `false` on input: none (identical to today). This is the
only call site in the repo that constructs a `VeilChargeState` (see §5), so no other caller
needs updating.

### 2. `lib/game/veil.test.ts`

Add test cases (file already unit-tests `stepVeilCharge`; match its existing style — read the
current file first, this spec does not reproduce it). New cases required, at minimum:

- A full drain with `reserve: true` in the input state does **not** set `locked`, sets
  `reserve: false` in the output, and sets `charge` to `VEIL_UNLOCK_CHARGE * VEIL_MAX_HOLD /
  maxHold` for the `maxHold` used.
- A full drain with `reserve: false` behaves exactly as today (existing "locks out on full
  drain" test should already cover this once `reserve: false` is added to every existing state
  literal in the file — the field is not optional, so every existing test's input object needs
  it added or the file won't typecheck).
- A drain that does **not** reach 0 leaves `reserve` untouched (still `true` if it was `true`).

### 3. `lib/game/economy.ts`

`RunPayout` currently (verified current):

```ts
export interface RunPayout {
  depth: number;
  survival: number;
  carried: number;
  home: number;
  total: number;
}
```

Add a `spent` field:

```ts
export interface RunPayout {
  depth: number;
  survival: number;
  carried: number;
  home: number;
  spent: number;
  total: number;
}
```

`computeWinPayout()` currently ends:

```ts
  const total = depth + survival + carried + home + Math.round(missionBonus * mult);
  return { depth, survival, carried, home, total };
```

Change the final line to `return { depth, survival, carried, home, spent: 0, total };` — `spent`
is always `0` out of this function; it's populated by `applySpend` below, applied by the caller
after computing the payout. Do **not** fold a spend into this function or into `mult`-scaling —
the Stone Marker price is a flat unbanked amount, not a tier-scaled quantity.

`computeDeathPayout()` currently ends:

```ts
  const total = depth + survival;
  return { depth, survival, carried: 0, home: 0, total };
```

Change to `return { depth, survival, carried: 0, home: 0, spent: 0, total };`.

Add, immediately after `applyPayout`:

```ts
/** Deducts an in-run unbanked spend (e.g. the Stone Marker charm) from a computed payout,
 * clamped so `total` never goes negative. Does not touch depth/survival/carried/home --
 * `spent` is a separate, honestly-labeled line item, not folded into the other four (which
 * LUL-1640/LUL-1412 made sum to `total` by construction before any spend is applied). LUL-1210. */
export function applySpend(payout: RunPayout, spentAmount: number): RunPayout {
  const spent = Math.max(0, Math.min(spentAmount, payout.total));
  return { ...payout, spent, total: payout.total - spent };
}
```

Add a price constant, next to `MISSION_DEEPWATER_REWARD`:

```ts
// LUL-1210: Stone Marker veil-charm, priced against Deeper Lungs I (120) so it reads as
// worse value than saving -- game/economy/veil-charm-price. 125-unit landmark distance ->
// depth >= 31 at the point of purchase by geometry, 16-point margin.
export const VEIL_CHARM_PRICE = 15;
```

### 4. `engine/tuning.js`

Add, near `LANDMARKS` (`engine/tuning.js:57-64`, the `stoneMarker` entry is
`{ kind: 'stoneMarker', x: 100, z: -75, clear: 9, cr: 1.1 }`):

```js
// LUL-1210: Stone Marker veil-charm interact radius -- same shape as
// MISSION_POOL's interactRadius (lib/game/mission.ts).
export const VEIL_CHARM_INTERACT_RADIUS = 4;
```

### 5. `engine/forest-engine.js`

**Imports.** The `@/lib/game/economy` import (`engine/forest-engine.js:112-124`, a multi-line
named-import block currently including `freshEmbersState, computeWinPayout, computeDeathPayout,
applyPayout, purchaseDeeperLungs as economyPurchaseDeeperLungs, veilMaxHoldForTier,
DEEPER_LUNGS_MAX_TIER, MISSION_DEEPWATER_REWARD, computeDepth, computeSurvival, ...`) already
imports `computeDepth` and `computeSurvival` — add `applySpend` and `VEIL_CHARM_PRICE` to this
same block.

The `@/engine/tuning` import (`engine/forest-engine.js:162-167`, currently `CONFIG, LANDMARKS,
LEGACY_LIGHT_SCALE, LIGHT_NORMAL, LIGHT_DIMMED, VEIL_RAMP, MIST_VEIL_FOG, VIGNETTE_NORMAL,
VIGNETTE_DIMMED, CANOPY_R, CONE1_HEIGHT, CONE1_Y, STAR, LW, DUST, BW, BSP, BOG_TREES,
COVER_PROPS, DUST_WIND_SPEED, WARM, BABY_LIGHT_DISTANCE, PSPEC as PSPEC_BASE, CHASE_GAP,
DIFFICULTY_PRESETS, CAVE, CHARGE_COOLDOWN, SENS, SCALE, PLAYER_FOV_COS, CUT_END,
RADIO_MAST_BEACON_GLOW`) — add `VEIL_CHARM_INTERACT_RADIUS` to this same block.

**New per-run state.** At `engine/forest-engine.js:368` (`let veilCharge = 1, veilLocked =
false, veilAmount = 0, staminaCharge = 1, staminaLowCuePlayed = false;`), add `veilReserve =
false` to the same `let` statement.

At `engine/forest-engine.js:2097` (`let maxDistFromHome = 0, embers = freshEmbersState();`), add
`embersSpent = 0` to the same `let` statement.

At `engine/forest-engine.js:2062` (`let entered = false, walk = CONFIG.walk, won = false,
canPickup = false, ...`), add `canBuyVeilCharm = false` to the same `let` statement.

**Per-run reset.** In `enter()` (`engine/forest-engine.js:2731-2737`), currently:

```js
function enter(){
  entered = true;
  enteredAt = clock.elapsedTime;
  runElapsed = 0;
  maxDistFromHome = 0;   // LUL-1043: fresh run, fresh depth high-water mark
  chronicle = [];   // LUL-1103: fresh run, fresh chronicle
  pushState({ entered: true, livePileEmbers: 0 });
```

Add a reset line after `maxDistFromHome = 0;`:

```js
  maxDistFromHome = 0;   // LUL-1043: fresh run, fresh depth high-water mark
  veilReserve = false; embersSpent = 0;   // LUL-1210: fresh run, no charm banked or spent
  chronicle = [];   // LUL-1103: fresh run, fresh chronicle
```

**`stepVeilCharge` call site** (`engine/forest-engine.js:3877-3878`, inside `tick()`), currently:

```js
  const veilStep = stepVeilCharge({ charge: veilCharge, locked: veilLocked }, veilHeld, dt, veilMaxHoldForTier(embers.tiers.deeperLungs));
  veilCharge = veilStep.charge; veilLocked = veilStep.locked;
```

Change to:

```js
  const veilStep = stepVeilCharge({ charge: veilCharge, locked: veilLocked, reserve: veilReserve }, veilHeld, dt, veilMaxHoldForTier(embers.tiers.deeperLungs));
  const reserveFired = veilReserve && !veilStep.reserve;   // LUL-1210: charm consumed this frame
  veilCharge = veilStep.charge; veilLocked = veilStep.locked; veilReserve = veilStep.reserve;
  if(reserveFired){
    pushState({ caption: 'the charm held', captionId: ++captionSeq });
    // Reuse whatever the nearest existing short one-shot cue primitive is (the same family as
    // missionCompleteSting() -- grep for its definition and mirror it) for an audible tell.
  }
```

`captionSeq` already exists and is used the same way by `completeMissionSequence()` — reuse it,
do not add a second counter.

**Purchase gate, computed every tick** in the objective/status HUD block, right after the
existing `canPickup = canPickUp(runState(), distBaby, 3.6);` line
(`engine/forest-engine.js:4115`). Add:

```js
  canPickup = canPickUp(runState(), distBaby, 3.6);
  const distStoneMarker = Math.hypot(player.x - landmarkGroups.stoneMarker.position.x, player.z - landmarkGroups.stoneMarker.position.z);
  canBuyVeilCharm = !carrying && !veilReserve && distStoneMarker < VEIL_CHARM_INTERACT_RADIUS
    && computeDepth(maxDistFromHome) >= VEIL_CHARM_PRICE;
```

`landmarkGroups` is the module-scope object built at `engine/forest-engine.js:1092-1098`
(`const landmarkGroups = { fireTower: buildFireTower(), stoneMarker: buildStoneMarker(), ... }`)
and repositioned every round by `placeLandmarks()` (`engine/forest-engine.js:1116` area, which
writes `landmarkGroups[l.kind].position.x/z` for each `LANDMARKS` entry). Use
`landmarkGroups.stoneMarker.position` — it is the live, post-nudge position. Do **not** use the
static `LANDMARKS` config array for this distance check (that array holds pre-nudge target
coordinates only).

**New purchase function**, placed near `pickup()` (search for `function pickup(){` and place
this adjacent to it):

```js
function buyVeilCharm(){
  if(!canBuyVeilCharm) return;
  veilReserve = true;
  embersSpent += VEIL_CHARM_PRICE;
  pushState({ caption: 'a charm against the mist', captionId: ++captionSeq });
  // Reuse the same short cue-primitive family as the reserveFired tell above for a confirming sound.
  track({ event: 'feature_engagement', feature: 'veil_charm', action: 'purchased' });
}
```

**Wire it into both interact paths.** Desktop `KeyE` handler (`engine/forest-engine.js:2150-2156`),
currently:

```js
  if(e.code === 'KeyE' && playing && !paused){
    if(canPickup) pickup();
    else if(carrying) setDown();
    else if(missionCanComplete) completeMissionSequence();
    else grabThrowable();
  }
```

Insert the charm arm after `carrying`/`setDown()` (mutually exclusive with `canBuyVeilCharm`
anyway since the gate requires `!carrying`, but keeping the same relative order as the mobile
handler below matters for readability, not correctness):

```js
  if(e.code === 'KeyE' && playing && !paused){
    if(canPickup) pickup();
    else if(carrying) setDown();
    else if(canBuyVeilCharm) buyVeilCharm();
    else if(missionCanComplete) completeMissionSequence();
    else grabThrowable();
  }
```

`triggerTouchInteract()` (`engine/forest-engine.js:4359-4365`) — this is the whole mobile story
for this feature; no new `EngineActions` entry or touch target needed, same interact affordance
`MobileControls.tsx` already renders for pickup/set-down/mission/throwable. Currently:

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

Change identically to the desktop handler above (insert `else if(canBuyVeilCharm) buyVeilCharm();`
in the same position).

**HUD prompt text**, in the `pushState({...})` call at `engine/forest-engine.js:4180-4194`.
Currently:

```js
    pushState({
      objectiveVisible: true, objectiveReady: canPickup,
      objectiveText: carrying
        ? 'Carry the child home  ·  ' + Math.round(distHome) + 'm  ·  E  to set her down'
        : (canPickup ? (babySetDown ? 'Press  E  to lift her again' : 'Press  E  to lift the child')
           : (missionCanComplete ? 'Press  E  at the drowned car' : 'Find the lost child  ·  ' + Math.round(distBaby) + 'm')),
      statusVisible, statusText,
      ...
```

Change the `objectiveReady`/`objectiveText` lines only (everything else in that `pushState`
call is untouched):

```js
      objectiveVisible: true, objectiveReady: canPickup || canBuyVeilCharm,
      objectiveText: carrying
        ? 'Carry the child home  ·  ' + Math.round(distHome) + 'm  ·  E  to set her down'
        : (canPickup ? (babySetDown ? 'Press  E  to lift her again' : 'Press  E  to lift the child')
           : (canBuyVeilCharm ? 'Press  E  for a mist-charm  ·  15 embers'
              : (missionCanComplete ? 'Press  E  at the drowned car' : 'Find the lost child  ·  ' + Math.round(distBaby) + 'm'))),
```

**Live pile display.** At `engine/forest-engine.js:3985` (inside the `if(entered){ ... }` block
that also updates `maxDistFromHome`), currently:

```js
      pushState({ livePileEmbers: computeDepth(maxDistFromHome) + computeSurvival(clock.elapsedTime - enteredAt) });
```

Change to subtract what's already been spent, so the displayed pile reflects a purchase
immediately:

```js
      pushState({ livePileEmbers: computeDepth(maxDistFromHome) + computeSurvival(clock.elapsedTime - enteredAt) - embersSpent });
```

**Payout deduction.** In `arriveHome()` (`engine/forest-engine.js:3562-3563`), currently:

```js
  const payout = computeWinPayout(maxDistFromHome, survivedSeconds, difficulty, missionBonus);
  embers = applyPayout(embers, payout);
```

Change to:

```js
  const payout = applySpend(computeWinPayout(maxDistFromHome, survivedSeconds, difficulty, missionBonus), embersSpent);
  embers = applyPayout(embers, payout);
```

In `triggerDeath()` (`engine/forest-engine.js:3577-3583`), currently:

```js
  const payout = computeDeathPayout(
    maxDistFromHome,
    survivedSeconds,
    Math.hypot(baby.x - CONFIG.home.x, baby.z - CONFIG.home.z),
    difficulty,
  );
  embers = applyPayout(embers, payout);
```

Change to:

```js
  const payout = applySpend(computeDeathPayout(
    maxDistFromHome,
    survivedSeconds,
    Math.hypot(baby.x - CONFIG.home.x, baby.z - CONFIG.home.z),
    difficulty,
  ), embersSpent);
  embers = applyPayout(embers, payout);
```

### 6. `components/Hud.tsx`

`RunRecap` currently renders (`components/Hud.tsx:352-361`):

```tsx
+{payout.depth} depth · +{payout.survival} survival
{isDeath ? (
  <> · <span className="emberLoss">-{CARRIED + HOME} lost</span> (child &amp; home, forfeited)</>
) : (
  <>
    {payout.carried > 0 && <> · +{payout.carried} child</>}
    {payout.home > 0 && <> · +{payout.home} home</>}
  </>
)}
{' '}= <span className="emberGain">{payout.total} embers</span> · balance: {balance}
```

Add a `spent` line so the breakdown stays legible once `applySpend` deducts from `total` (it
would otherwise look like the numbers stopped adding up):

```tsx
+{payout.depth} depth · +{payout.survival} survival
{isDeath ? (
  <> · <span className="emberLoss">-{CARRIED + HOME} lost</span> (child &amp; home, forfeited)</>
) : (
  <>
    {payout.carried > 0 && <> · +{payout.carried} child</>}
    {payout.home > 0 && <> · +{payout.home} home</>}
  </>
)}
{payout.spent > 0 && <> · −{payout.spent} charm</>}
{' '}= <span className="emberGain">{payout.total} embers</span> · balance: {balance}
```

No changes to `EngineHudState`/`EngineActions` needed — `objectiveText`/`objectiveReady`/
`livePileEmbers` already exist as typed fields, and `RunPayout` is imported from
`lib/game/economy`, so the new `spent` field flows through automatically once §3 lands.

### 7. `docs/ELEMENTS.md`

Add a new element entry for the Stone Marker's interaction (it currently has none — it is
decorative-only today). Follow the existing entry format used for other landmark/interact-point
entries already in the file; cite exact `file:line` for `buyVeilCharm()`, the `canBuyVeilCharm`
gate, and `stepVeilCharge`'s `reserve` branch, matching how existing entries cite line numbers
(re-derive the actual line numbers from your own diff, not from this spec's citations, which
will have shifted once your edits land). Run `node scripts/check-elements-citations.mjs` after
writing it (see Verification).

## Verification

1. `npx tsc --noEmit` — clean.
2. `npx eslint lib/game/veil.ts lib/game/economy.ts engine/tuning.js engine/forest-engine.js components/Hud.tsx` — clean.
3. `node --test lib/game/veil.test.ts lib/game/economy.test.ts` — all pass, including the new
   cases from §2. Also run `node --test lib/game/*.test.ts` once, since `RunPayout` gained a
   required field — confirm nothing else constructs a `RunPayout` object literal by hand
   (grep the repo for `RunPayout` and for object literals with a `total:` key inside
   `lib/game/` and `engine/` to be sure).
4. `node scripts/check-duplicate-logic.mjs` — OK (required CI guard; see AGENTS.md's "unit
   tests" CI check note — a red run here is not necessarily this diff's fault, but check it).
5. `node scripts/check-elements-citations.mjs --fix` then re-run without `--fix` — OK, 0 drifted.
6. `next build` — passes.
7. Manual/tester verification (out of the implementer's assertion scope per AGENTS.md — state
   explicitly in the PR: builds clean, gameplay/audio/mobile-touch behavior unverified without a
   browser): does the charm actually save a chase-locked veil in play; does the HUD prompt
   appear only within `VEIL_CHARM_INTERACT_RADIUS` and only when `!carrying`; does the mobile
   tap-hold interact fire `buyVeilCharm()` correctly; does the recap breakdown read sensibly
   when a charm was bought; does `Unbanked: {livePileEmbers}` visibly drop by 15 right after
   purchase.

## Constraints

- Do not touch `VEIL_MAX_HOLD`, `VEIL_REGEN_MUL`, `VEIL_UNLOCK_CHARGE`, `VEIL_DETECT_MUL`, or any
  existing Deeper Lungs tuning (`DEEPER_LUNGS_HOLD_SECONDS`, `DEEPER_LUNGS_COSTS`) — this feature
  is purely additive to `stepVeilCharge`'s branches, not a retune.
- `stepVeilCharge()`'s behavior with `reserve: false` must be provably identical to today's
  behavior with no `reserve` field at all — this is why `reserve: false` must be added to every
  existing state literal in `veil.test.ts` (see §2) rather than left implicit.
- Do not fold `spent` into the LUL-1640/LUL-1412 four-field-sums-to-total invariant inside
  `computeWinPayout`/`computeDeathPayout` — `applySpend` is a separate step applied by the
  caller after that invariant already holds. Do not "simplify" by subtracting inside those two
  functions instead.
- Never offer the purchase while `carrying` — same rule as every other landmark purchase in the
  design docs (tower, mission). This is a hard gate, not a suggestion.
- The `computeDepth(maxDistFromHome) >= VEIL_CHARM_PRICE` guard in `canBuyVeilCharm` should
  never actually trip in normal play (by the Economist's own geometric proof) — keep it anyway,
  do not remove it as "dead code."
- Do not add a second currency/spend UI surface (no shop panel) — this is a single in-world
  interact prompt, same shape as pickup/mission-complete, not a menu.
- Mobile: no new `EngineActions` entry, no new touch target. The existing interact
  tap-and-hold already covers this. If you find yourself adding one, stop — that's a deviation
  from this spec and from the accepted proposal's explicit "no new touch target class" line;
  flag it instead of shipping it silently.

## Out of scope

- The fire tower's own pay-to-climb purchase (M1 The Watch) — designed in the same wiki pages
  but explicitly gated on vertical-traversal work that doesn't exist yet (see
  `game/mechanics/veil-charm`). Not part of this ticket.
- The "cheap version" fallback (instant top-up to `veilCharge = 1`, zero new state) — the
  reserve version above is the one to ship per the accepted decision
  (`decisions/veil-charm-accepted-2026-09-02`: "ship the reserve version if there's room — it's
  the one with a real decision in it"). Do not implement the fallback unless a reviewer
  explicitly asks for it in place of this spec.
- `game/psychology/missions-and-flow`'s pacing-collision question (does a second in-run prompt
  collide with the one-decision run shape) is flagged non-blocking in the acceptance decision,
  not ruled. Not this ticket's job to resolve; if the Player Psychologist raises it in review,
  route it there rather than re-deciding it in code.
- The base veil-hold verb's own telemetry already exists (`track({ event: 'feature_engagement',
  feature: 'veil', action: 'used' })`, `engine/forest-engine.js` inside the `stepVeilCharge` call
  site block) — the wiki note that flagged it missing is stale as of this spec. This ticket adds
  its own separate `veil_charm`/`purchased` event (§5); do not conflate the two or assume the
  old note still applies.
