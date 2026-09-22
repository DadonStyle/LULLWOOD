# SPEC: LUL-3150 Veil Overload

**Ticket:** LUL-3150 · **Tier:** C — engine simulation (new detection-suppression state
gating `checkScent`/`effectiveDetect`/`canSee`, a new keybinding) + HUD render sites. Needs
`REVIEW: APPROVED` from the Code Reviewer before merge (balance-critical: a full-immunity
window is a strong lever, same class as cave immunity).

**Written against:** `release/next` @ `4f23b9d` (2026-09-22). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

**Source material:** `game/mechanics/veil-overload.md` (Feature Scout's Section-0
formalization, illustrative pseudocode only — file paths and function names there
(`lib/game/keybindings.ts`, `predators.forEach(p => p.detect = 0)`, a "protectionBus") do
not exist in the repo and are **not** what this spec implements; the technical design below
supersedes it, verified against real `file:line` citations). `decisions/veil-overload-
accepted-2026-09-18` (CEO acceptance, flags the Q5 refusal-feedback gap as in-scope).

## Drift from the CTO's 2026-09-18 PLAN comment

The PLAN's line numbers (`:598`, `:2272`, `:2502/:2506`, `:5709-5710`, `:5851-5858`,
`:5866-5877`, `:6769-6774`, `:6805-6809`) have all shifted with `release/next`'s head moving
from that date to `4f23b9d` today. Re-verified against real code below — the *design* the
PLAN describes is unchanged, only the citations. One correction beyond line drift: the PLAN
says "three call sites" for detection suppression citing two line numbers (`:2502`,
`:2506`); there are three real call sites (`checkScent`, `effectiveDetect`, `canSee`) — see
`## The change` §3.

**Tuning number:** the Game Economist has not replied on this ticket as of this writing
(checked live). Per the CTO's own fallback instruction in the PLAN comment, this spec locks
`VEIL_OVERLOAD_DURATION = 7` (middle of the 6–8s range) and treats it as a follow-up tuning
pass, not a blocker.

## Files

- `lib/game/veilOverload.ts` — created. Pure duration constant + predicate, mirrors
  `lib/game/cave.ts` exactly (same one-constant-one-predicate shape as `CAVE_IMMUNITY_TIME`/
  `isCaveImmune`).
- `engine/forest-engine.js` — edited. New state vars, per-frame countdown, `KeyQ` handler,
  `setDown()` reset, detection-suppression gate at 3 call sites, `pushState` wiring (both the
  `playing` and not-`playing` branches), 2 new cue functions + a denied-cue counter, 1
  `HINT_PRIORITY` entry + its 3 switch-case additions, 2 new QA hooks.
- `engine/forest-engine.d.ts` — edited. Declares the 2 new QA hooks (doc-comment style,
  matching `qaOpenVeilTarget`/`qaProbeVeil`'s existing declarations).
- `components/Hud.tsx` — edited. 3 new `EngineHudState` fields + their default-state entries,
  `#veilOverloadPanel` (sibling of `#caveImmunePanel`), 1 new `<ActionPrompt>` row in
  `#actionSlot`, 1 new `EngineActions.triggerTouchVeilOverload` entry (mobile parity, §9).
- `lib/engine-contract.ts` — edited. `triggerTouchVeilOverload` added to
  `ENGINE_ACTION_KEYS` (§9 step 3).
- `docs/ELEMENTS.md` — edited. New `### Veil Overload (LUL-3150)` section, modeled on the
  existing `### Stone Marker veil-charm (LUL-1210)` entry (`docs/ELEMENTS.md:1979`).
- `e2e/veil-overload.spec.ts` — created.
- `shared/local-qa/requests/lul-3150-veil-overload.md` — created once a real branch/commit
  sha exists to cite (can't be written speculatively, per standing local-qa duty).

## The change

### §1. `lib/game/veilOverload.ts` (new file)

Mirrors `lib/game/cave.ts` verbatim in shape:

```ts
export const VEIL_OVERLOAD_DURATION = 7;   // seconds -- middle of the CEO-accepted 6-8s
                                            // range; Economist has not priced the exact
                                            // number as of this spec (follow-up tuning pass)

/** true from the frame activation happens until the countdown reaches 0. */
export function isVeilOverloadActive(veilOverloadChargeT: number): boolean {
  return veilOverloadChargeT > 0;
}
```

### §2. `engine/forest-engine.js` — state, activation, decrement, set-down reset

**State declaration.** Alongside `caveImmuneT` at `engine/forest-engine.js:620` (`let
caveSpawned = false, caveData = null, caveConsumed = false, caveImmuneT = 0;`), add a
sibling `let` for the two new module-level vars (own statement, not folded into that line —
it's a distinct feature, not cave-power state):

```js
let veilOverloadChargeT = 0, veilOverloadUsedThisCarry = false;
```

Import the new module at the top alongside the existing `cave.ts` import
(`engine/forest-engine.js:127`, `import { CAVE_IMMUNITY_TIME, isCaveImmune } from
'@/lib/game/cave';`):

```js
import { VEIL_OVERLOAD_DURATION, isVeilOverloadActive } from '@/lib/game/veilOverload';
```

**Activation.** New `activateVeilOverload()` function, placed directly after
`activateCavePower()` (`engine/forest-engine.js:2349-2366`) since both are one-shot
detection-immunity triggers with the same cue-firing shape:

```js
function activateVeilOverload(){
  veilCharge = 0;   // burn the whole resource -- deliberately does NOT touch veilLocked:
                     // stepVeilCharge() (lib/game/veil.ts:41, called every frame at
                     // engine/forest-engine.js:6522) reads charge=0 next frame and takes
                     // its existing regen branch (active = held && !locked && charge>0 is
                     // false once charge is 0 regardless of held) -- exactly the same path
                     // a natural hold-to-drain takes AFTER a lock clears, not the "just
                     // hit 0" path that sets locked=true. Setting locked here too would be
                     // a second, undocumented penalty on top of the burn itself.
  veilOverloadChargeT = VEIL_OVERLOAD_DURATION;
  veilOverloadUsedThisCarry = true;
  pushState({ veilOverloadActive: true, veilOverloadTimeLeft: VEIL_OVERLOAD_DURATION });
  veilOverloadActivateCue();
}
```

**`KeyQ` handler.** In the keydown listener, insert directly after the `KeyE` block closes
and before the `KeyH` line (`engine/forest-engine.js:3317-3325`):

```js
  if(e.code === 'KeyE' && playing && !paused){
    if(canPickup) pickup();
    else if(carrying) setDown();
    else if(canBuyVeilCharm) buyVeilCharm();
    else if(missionCanComplete) completeMissionSequence();
    else if(secondaryCanComplete) completeSecondarySequence();
    else grabThrowable();
  }
  // LUL-3150: carry-leg emergency panic button -- burns all veil charge for a
  // detection-immunity window, once per carry leg. Gated the same three ways
  // veilOverloadVisible is (carrying/charge/not-yet-used) so the key only ever
  // does something when the HUD prompt agrees it should; the denied branch is
  // the Q5 refusal-feedback gap the CEO's acceptance flagged as in-scope, not
  // deferred -- pressing Q while carrying but ineligible always gets a cue.
  if(e.code === 'KeyQ' && playing && !paused && carrying){
    if(veilCharge > VEIL_PROMPT_MIN_CHARGE && !veilOverloadUsedThisCarry) activateVeilOverload();
    else veilOverloadDeniedCue();
  }
  if(e.code === 'KeyH' && playing && !paused) toggleHidden();
```

Not-carrying-at-all presses no-op with no cue (matches the KeyE/KeyH convention already
documented at that call site — pressing an action key with no valid context does nothing
audible either; refusal feedback is owed only where the action would plausibly work, per the
CTO's PLAN).

**Per-frame decrement.** Alongside the `caveImmuneT` decrement in `tick()`
(`engine/forest-engine.js:6951-6956`):

```js
    let caveImmuneJustEnded = false;
    if(caveImmuneT > 0){
      caveImmuneT = Math.max(0, caveImmuneT - dt);
      if(caveImmuneT === 0) caveImmuneJustEnded = true;
    }
    if(caveImmuneJustEnded) caveImmuneEndCue();
    let veilOverloadJustEnded = false;
    if(veilOverloadChargeT > 0){
      veilOverloadChargeT = Math.max(0, veilOverloadChargeT - dt);
      if(veilOverloadChargeT === 0) veilOverloadJustEnded = true;
    }
    if(veilOverloadJustEnded) veilOverloadEndCue();
```

**Set-down reset.** In `setDown()` (`engine/forest-engine.js:5896-5905`), reset only
`veilOverloadUsedThisCarry` — **not** `veilOverloadChargeT`. Design call: an active cooldown
keeps running its own countdown after the child is set down (e.g. the player reaches home
and sets down while the window is still live); only the "have I used my one shot this leg"
gate resets, so the *next* pickup gets a fresh use:

```js
function setDown(){
  const next = beginSetDown(runState());
  if(next.carrying === carrying) return;
  carrying = next.carrying; babySetDown = next.setDown;
  veilOverloadUsedThisCarry = false;
  baby.x = player.x; baby.z = player.z;
  ...
```

### §3. Detection suppression — 3 real call sites

The PLAN cites two line numbers for "the immunity check"; there are three real functions
each independently gated by `isCaveImmune(caveImmuneT)`, all in `engine/forest-engine.js`:

- `checkScent(p)` — `:2333`
- `effectiveDetect(p)` — `:2564`
- `canSee(p, dist)` — `:2568`

Each becomes an OR of the two immunity predicates (cave immunity and veil overload are
orthogonal, stackable — Scout's Q7/Q8 answer in `game/mechanics/veil-overload.md:140`):

```js
// checkScent, :2333
if(isCaveImmune(caveImmuneT) || isVeilOverloadActive(veilOverloadChargeT)) return false;
// effectiveDetect, :2564
if(isCaveImmune(caveImmuneT) || isVeilOverloadActive(veilOverloadChargeT)) return 0;
// canSee, :2568
if(isCaveImmune(caveImmuneT) || isVeilOverloadActive(veilOverloadChargeT)) return false;
```

### §4. Cues (`engine/forest-engine.js`)

Two new standalone WebAudio functions, placed directly after `caveImmuneEndCue()`
(`engine/forest-engine.js:6031-6039`), same shape as every existing cue function (gated
`if(!audio || !soundOn) return`, connects to `master`/`conv`, no bus infra — the PLAN's
correction re: no `protectionBus` exists, confirmed live):

```js
// LUL-3150: veil-overload cues -- distinct register from caveImmuneStartCue/EndCue (which
// sweep low<->high sine) so the two immunity sources stay audibly distinguishable. Denied
// cue mirrors veilCharmReleaseCue()'s counter-before-audio-gate idiom (:6007-6009) so the
// e2e spec can assert a refusal fired even with soundOn:false.
let qaVeilOverloadDeniedCueCount = 0;
function veilOverloadActivateCue(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(560, t + 0.3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.5);
}
function veilOverloadEndCue(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(560, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.55);
}
function veilOverloadDeniedCue(){
  qaVeilOverloadDeniedCueCount++;
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'square';
  o.frequency.setValueAtTime(110, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.2);
}
```

### §5. First-encounter caption — `HINT_PRIORITY` (one-shot, distinct from the always-on panel)

Per Q8, this is a *different* UI surface than `#veilOverloadPanel`/the `#actionSlot` prompt —
the one-shot green `#hintCaption` pill, same system `caveImmune` already uses. Add one entry
to each of the four switches in `engine/forest-engine.js`:

- `HINT_PRIORITY` array (`:2224-2225`) — insert `'veilOverload'` after `'caveImmune'`:
  `[...,'stamina','cover','caveImmune','veilOverload','throwable','veil']`.
- `HINT_TEXT` (`:2233-2247`) — new entry: `veilOverload: 'burn all veil charge (Q) for a
  detection-proof escape'`.
- `hintCandidate(key)` switch (`:7156-7178`) — new case, self/panel-anchored like
  `caveImmune`: `case 'veilOverload': return [veilOverloadChargeT > 0, null];`
- `hintDismissedByEvent(key, baseline)` switch (`:7181-7192`) — new case, mirrors
  `caveImmune`'s own dismissal rule exactly: `case 'veilOverload': return
  veilOverloadChargeT <= 0;`

### §6. `pushState` wiring (`engine/forest-engine.js`)

**Initial seed object** (`:3879`, alongside `caveImmuneActive: false, caveImmuneTimeLeft:
0,`): add `veilOverloadActive: false, veilOverloadTimeLeft: 0, veilOverloadVisible: false,`.

**Playing branch**, inside the big `pushState({...})` call (`:6957-6994`), alongside
`caveImmuneActive: caveImmuneT > 0, caveImmuneTimeLeft: caveImmuneT,` at the end:

```js
      caveImmuneActive: caveImmuneT > 0,
      caveImmuneTimeLeft: caveImmuneT,
      veilOverloadActive: veilOverloadChargeT > 0,
      veilOverloadTimeLeft: veilOverloadChargeT,
      veilOverloadVisible: carrying && veilCharge > VEIL_PROMPT_MIN_CHARGE && !veilOverloadUsedThisCarry,
```

**Not-playing branch** (`:6996`), append `veilOverloadActive: false, veilOverloadVisible:
false` to the existing reset call (matches how that line already resets
`caveImmuneActive: false` but not `caveImmuneTimeLeft` — a pre-existing asymmetry in this
branch, not something this feature should fix or copy further than necessary; a stale
`veilOverloadTimeLeft` while not-playing has no render effect since `veilOverloadActive`
gates the panel, same as `caveImmuneTimeLeft` today).

### §7. `engine/forest-engine.d.ts` — QA hook declarations

Two new hooks, declared next to their siblings (`qaOpenVeilTarget` at `:160`, `qaProbeVeil`
at `:473`):

```ts
qaOpenVeilOverloadTarget?: (kind: 'wolf' | 'bear' | 'lion') => number | null;
...
qaProbeVeilOverload?: () => { chargeT: number; usedThisCarry: boolean; deniedCueCount: number };
```

### §8. QA hooks — `engine/forest-engine.js`, inside the `?qaHooks` block in `init()`

`qaOpenVeilOverloadTarget(kind)` mirrors `qaOpenVeilTarget(kind)`
(`engine/forest-engine.js:4563-4578`) exactly — same predator-staging body — plus puts the
player into a carrying state and gives full veil charge so the scenario is immediately
ready to test activation. This is a staging hook (teleports predator/player state directly,
same class as `qaOpenVeilTarget`/`qaBuildScene` already do); the mechanic *under test*
(`KeyQ` activation) still goes through the real keydown listener via
`page.keyboard.press('KeyQ')` in the e2e spec, not a hook:

```js
window.ForestEngine.qaOpenVeilOverloadTarget = function(kind){
  const idx = predators.findIndex(p => p.kind === kind);
  if(idx < 0) return null;
  const target = predators[idx];
  for(const p of predators){
    if(p === target) continue;
    if(p.charge){ p.charge = null; endChargeHud(); }
    p.hunt = false;
  }
  player.x = 0; player.z = 0;
  target.x = 6; target.z = 0;
  target.vx = target.vz = 0; target.alert = 0; target.stuckT = 0; target.sightLock = null;
  target.state = 'chase'; target.hunt = true; target.alertedBy = null; target.charge = null; target.scentLock = 0;
  target.reroute = 10; target.rrX = target.x; target.rrZ = target.z;
  carrying = true; veilCharge = 1; veilLocked = false; veilOverloadUsedThisCarry = false; veilOverloadChargeT = 0;
  return idx;
};
window.ForestEngine.qaProbeVeilOverload = function(){
  return { chargeT: veilOverloadChargeT, usedThisCarry: veilOverloadUsedThisCarry, deniedCueCount: qaVeilOverloadDeniedCueCount };
};
```

### §9. `components/Hud.tsx`

**`EngineHudState`** (alongside `caveImmuneActive`/`caveImmuneTimeLeft` at `:68-70`):

```ts
caveImmuneActive:   boolean;
caveImmuneTimeLeft: number;
// LUL-3150: carry-leg panic button -- burns all veil charge for a detection-proof window.
veilOverloadActive:  boolean;
veilOverloadTimeLeft: number;
veilOverloadVisible: boolean;
```

**Default state object** (alongside `caveImmuneActive: false, caveImmuneTimeLeft: 0,` at
`:250-251`): `veilOverloadActive: false, veilOverloadTimeLeft: 0, veilOverloadVisible:
false,`.

**`#veilOverloadPanel`** — sibling of `#caveImmunePanel`, same admin-gate-bypass placement
(directly after the `#caveImmunePanel` block, `components/Hud.tsx:975-979`):

```tsx
{state.veilOverloadActive && (
  <div id="veilOverloadPanel">
    Overload · {Math.ceil(state.veilOverloadTimeLeft)}s
  </div>
)}
```

**`#actionSlot` row.** New `<ActionPrompt id="veilOverloadPrompt">`, inserted between the
`actionPrompt` (hide/veil) row and the `throwPrompt` row (`components/Hud.tsx:1071-1094`) —
engineering call: it belongs next to the other "predator response" affordance
(`actionPrompt`), not next to the throwable/objective rows, since it's read the same way
("something to do about being hunted"), and carrying is mutually exclusive with the
hide/cover prompt (you can't hide while carrying — `coverPromptVisible` requires `!carrying`
transitively via `hidden`/hide-entry preconditions), so the two rows never compete for the
same visual beat:

```tsx
<ActionPrompt
  id="veilOverloadPrompt"
  visible={state.veilOverloadVisible && !state.winVisible && !state.deathVisible}
  tone="urgent"
  keycap="Q"
  text="Burn veil for a detection-proof escape"
/>
```

Mobile: `ActionPrompt` already renders a tap target for any row with `onPointerDown` wired
(see `chargePrompt`'s pattern, `components/Hud.tsx:1079`); this row needs the same treatment
— `onPointerDown={mobile ? (e) => { e.preventDefault(); actions?.triggerTouchVeilOverload(); } : undefined}`,
naming it `triggerTouchVeilOverload` to match the existing `triggerTouchJump`/
`triggerTouchHide`/`triggerTouchInteract`/`triggerTouchThrow` family (`components/Hud.tsx:194`,
`engine/forest-engine.js:7404-7406`), not a bare `trigger*`. **This requires a matching
`EngineActions.triggerTouchVeilOverload()` entry** (LUL-1697 engine/React contract) —
desktop fires via the real `KeyQ` listener, mobile has no physical key to synthesize.
Implementer, all 5 steps in the same PR (2026-09-09 rule, no exception for "additive"):
1. `function triggerTouchVeilOverload(){ if(!playing || paused || !carrying) return;
   if(veilCharge > VEIL_PROMPT_MIN_CHARGE && !veilOverloadUsedThisCarry) activateVeilOverload();
   else veilOverloadDeniedCue(); }` in `engine/forest-engine.js`, next to `triggerTouchJump`
   (`:7375`) — same guard/branch shape as the `KeyQ` handler (§2), just without the
   `e.code`/keydown-event wrapper.
2. Added to `init()`'s `return {...}` (`engine/forest-engine.js:7404-7406`) alongside
   `triggerTouchJump, triggerTouchPause, triggerTouchToggleRun,`.
3. Added to `ENGINE_ACTION_KEYS` (`lib/engine-contract.ts:18`) in the same
   `triggerTouchJump/Pause/ToggleRun` line.
4. `EngineActions` interface (`components/Hud.tsx:194`) gets `triggerTouchVeilOverload: () =>
   void;` next to `triggerTouchJump`.
5. `e2e/veil-overload.spec.ts` (§ e2e below) exercises both the desktop `KeyQ` path and the
   mobile tap path (`components/MobileControls.tsx`'s pointerdown wiring for this new
   `#actionSlot` row), matching the mobile-parity checklist.

### §10. `docs/ELEMENTS.md`

New `### Veil Overload (LUL-3150)` section after `### Stone Marker veil-charm (LUL-1210)`
(`docs/ELEMENTS.md:1979`), modeled on that entry's structure: what it is, the exact gate
expression with citations, the cue triple, the HUD render sites, and the `adminMode`
visibility note (both `#veilOverloadPanel` and the `#actionSlot` row are visible with
`adminMode` off, same as `#caveImmunePanel` and every `#actionSlot` row today).

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `npm test` (unit tests, incl. new `lib/game/veilOverload.test.ts` mirroring
  `lib/game/cave.test.ts` if one exists, else a small new one covering
  `isVeilOverloadActive`'s 0/positive boundary) — all pass.
- `npx playwright test e2e/veil-overload.spec.ts` — new spec passes.
- `npx playwright test e2e/veil.spec.ts e2e/veil-charm.spec.ts` — must pass unchanged
  (constraint: `veilCharge = 0` on activation must not perturb `stepVeilCharge()`'s own
  drain/regen/lock math for players not using Overload).
- `node scripts/check-elements-citations.mjs` (or whatever `ci.yml:159` invokes) — clean
  against the new `docs/ELEMENTS.md` section.

## e2e

**Specs.** `e2e/veil-overload.spec.ts` — new, three tests:
1. "burning veil overload suppresses a lion's detection for the cooldown window, then it
   returns" — the core mechanic.
2. "pressing Q while carrying with insufficient veil charge fires the denied cue, not
   activation" — the Q5 refusal-feedback gap.
3. "veilOverloadUsedThisCarry resets on set-down, allowing a second use next carry leg" —
   the one-shot-per-leg boundary.

`e2e/veil.spec.ts`, `e2e/veil-charm.spec.ts` must pass unchanged (see Verification).

**World.** micro (default — `boot(page, { qaHooks: true })` already boots micro per LUL-2377;
no `qaBuildScene` call needed, same as `e2e/veil.spec.ts`'s existing pattern —
`qaOpenVeilOverloadTarget('lion')` stages predator + player + carrying/charge state on the
already-spawned micro-world predator pool).

**Hooks.** `qaOpenVeilOverloadTarget(kind): number | null` — new, staging (§8). `qaProbeVeilOverload():
{chargeT, usedThisCarry, deniedCueCount}` — new, read-only (§8). `qaSetFixedStep`/`qaAdvance`
— existing (`docs/specs/lul-2071-deterministic-qa-clock.md`), used to cross the 7s cooldown
deterministically instead of a wall-clock wait, same as `e2e/veil.spec.ts`'s ramp-crossing
loop.

**Test 1 sketch:**
```ts
await boot(page, { qaHooks: true });
await enter(page);
const idx = await qaHook(page, 'qaOpenVeilOverloadTarget', 'lion');
expect(idx).not.toBeNull();
expect((await qaHook(page, 'qaPredatorState', idx))?.canSee).toBe(true);
await page.keyboard.press('KeyQ');
const mid = await qaHook(page, 'qaProbeVeilOverload');
expect(mid.chargeT).toBeGreaterThan(0);
expect(mid.usedThisCarry).toBe(true);
expect((await qaHook(page, 'qaPredatorState', idx))?.canSee).toBe(false);
await qaHook(page, 'qaSetFixedStep', 0.02);
await qaHook(page, 'qaAdvance', 400);   // 8s game-time, clears the 7s window with margin
const after = await qaHook(page, 'qaProbeVeilOverload');
expect(after.chargeT).toBe(0);
expect((await qaHook(page, 'qaPredatorState', idx))?.canSee).toBe(true);
```

**Tester scenario.** `shared/local-qa/requests/lul-3150-veil-overload.md`, written once a
real branch/sha exists to cite: stage via `qaOpenVeilOverloadTarget('lion')`, press `KeyQ`,
assert `qaProbeVeilOverload()` before/during/after, assert `#veilOverloadPanel` text and
`#veilOverloadPrompt` visibility across the same window, mobile tap-target variant on both
landscape viewports.

**Not covered.** The `#hintCaption` first-encounter pill's actual visual feel (color, glyph
choice) — asserted structurally (`state.hintKey === 'veilOverload'`) but not visually; real
predator AI variety beyond the lion used for the fixed-distance repro — same simplification
`e2e/veil.spec.ts` already makes.

## Cues

**Visual.** `#veilOverloadPanel` (`components/Hud.tsx`, §9) — "Overload · Xs" countdown,
same static-text treatment as `#caveImmunePanel`, no pulse/glow animation to gate on
`reducedMotion` (mirrors the cave-immunity panel's own lack of one — consistent, not a gap
introduced here). The `#actionSlot` `veilOverloadPrompt` row uses `tone="urgent"`, which
`ActionPrompt`'s existing shared component already renders as the standard red-flash urgent
state (LUL-2312 rule 4) — no new animation code.

**Audio.** `veilOverloadActivateCue()` (`engine/forest-engine.js`, §4, new) on activation;
`veilOverloadEndCue()` (§4, new) on the cooldown's `>0 -> 0` edge; `veilOverloadDeniedCue()`
(§4, new) on a refused `KeyQ` press. All three gated `if(!audio || !soundOn) return`, same
as every existing cue.

**Explanation.** First time `veilOverloadChargeT > 0`, the `HINT_PRIORITY` system (§5) shows
`"burn all veil charge (Q) for a detection-proof escape"` in `#hintCaption` for its standard
one-shot window (dismissed once `veilOverloadChargeT <= 0`, `markHintSeen`-gated so it never
repeats after the first real use, following the `caveImmune` entry's exact precedent). Gated
by the existing `captionsOn`/hint-system plumbing — no new gate needed.

**Reduced motion.** No animation exists to reduce — `#veilOverloadPanel` and the
`#actionSlot` row are both static text/color-state, same as `#caveImmunePanel` and
`chargePrompt`'s `tone="urgent"` respectively. `reducedMotion=true` e2e assertion: panel
text and prompt visibility are unaffected by the flag (there's nothing conditional on it in
this feature's render path — state that explicitly in the e2e spec rather than skip the
check).

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- Must not touch `stepVeilCharge()` (`lib/game/veil.ts`) itself — Overload burns the
  resource by writing `veilCharge` directly from outside the state machine, the same way
  every other module-level engine var is a plain mutable, not by adding a new parameter or
  branch to the pure function. `e2e/veil.spec.ts`/`veil-charm.spec.ts` passing unchanged is
  the proof this held.
- Must not set `veilLocked = true` on activation (§2, `activateVeilOverload()` comment) —
  that would double-penalize the burn on top of the 7s vulnerability-free window already
  being the cost.
- Detection suppression (§3) is sight + scent, matching cave immunity's own scope exactly —
  no new "immunity kind" enum, no divergent behavior between the two immunity sources beyond
  their distinct trigger/cost.
- Tier C: this PR blocks on `REVIEW: APPROVED` from the Code Reviewer before merge.

## Out of scope

- The exact 6–8s duration number — locked to 7 here per the CTO's fallback instruction;
  Economist pre-pricing is a non-blocking follow-up tuning pass, not part of this PR.
- `SettingsPanel` key-remapping for `KeyQ` — the PLAN's Q16 correction already established no
  remap infrastructure exists in the repo (flat `e.code === 'KeyX'` checks only); adding a
  remapping system is a separate, much larger ticket, not bundled here.
- Cave immunity's own missing e2e coverage (no `e2e/cave-immunity*.spec.ts` file exists in
  the repo today, confirmed live) — a pre-existing gap, not introduced or required to be
  fixed by this feature, though `#actionSlot`'s header comment claiming "five always-mounted
  rows" is already stale at six before this PR adds a seventh; not touched here, flagged for
  whoever next edits that comment block.
