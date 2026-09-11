# SPEC: LUL-2331 Stone Marker mist-charm cue triple

**Ticket:** LUL-2331 (child of LUL-2321 Part 1) · **Tier: B** — presentation-only (new synth
cues, caption text, HUD pip, a one-shot beacon-glow pulse). `lib/game/veil.ts`'s charge/lock
state machine and `lib/game/economy.ts`'s price are not touched. `release/next`'s branch
ruleset requires 1 approval unconditionally regardless of tier — file a `REVIEW: APPROVED`
child issue to Code Reviewer per usual routing, no Tier-C-only implication.

**Written against:** `release/next` @ `1787b8b` (2026-09-11). Every citation below was
re-derived against this sha (the PLAN's own citations, written against `main` @ `3572e53`, had
already drifted — re-check yours again if this branch has moved by the time you implement).

Design source: wiki `decisions/0015-cue-triple` (the rule this closes), `docs/CUES.md`'s Stone
Marker row (the audit that found the gap), `docs/specs/stone-marker-veil-charm.md` (LUL-1210,
the original feature spec — read for mechanic background, not reproduced here).

## Files

- `engine/forest-engine.js` — edited (2 new one-shot cue functions, 1 changed prompt string,
  1 new beacon-pulse timer + its tick update, `veilReserve` added to the per-tick `pushState`,
  2 new `?qaHooks` hooks)
- `engine/forest-engine.d.ts` — edited (declare the 2 new hooks)
- `components/Hud.tsx` — edited (`veilReserve` on `EngineState`, a small pip, a 0.4s eased
  veil-meter readout on the reserve-fired edge)
- `e2e/veil-charm.spec.ts` — new
- `e2e/mobile/veil-charm.spec.ts` — new
- `docs/ELEMENTS.md` — edited (Stone Marker card: reword the two stale citations already
  flagged there — `canBuyVeilCharm` cited `:4137` is now `:5608`; `buyVeilCharm()` cited
  `:3445` is now `:4730` — plus the new cue lines)
- `docs/CUES.md` — edited (Stone Marker row: audio/explanation cells go from MISSING to cited)

## The change

### 1. Explain (offer prompt) — option (a), folded into the persistent prompt

`objectiveText` ternary, `engine/forest-engine.js:5684-5686`:

```js
objectiveText: canPickup ? 'Press  E  to lift the child'
  : (canBuyVeilCharm ? 'Press  E  for a mist-charm  ·  15 embers'
     : (missionCanComplete ? 'Press  E  at the drowned car' : 'Find the lost child  ·  ' + Math.round(distBaby) + 'm')),
```

Change only the `canBuyVeilCharm` branch's string to:

```js
'Press  E  for a mist-charm  ·  15 embers  ·  saves your veil from locking, once'
```

**Why (a), not (b):** LUL-2307 ("First-encounter explanations", already merged as `#570`,
`engine/forest-engine.js:1838` registry / `:5885-5890` hint eligibility) already has a `'veil'`
hint key, but it fires on `veilCharge < 0.3 && !veilLocked` (`:5884`) — that explains *using*
the veil (hold F), a completely different moment from *buying* the reserve at the Stone Marker.
Folding a second, unrelated meaning into LUL-2307's dismiss-after-8s key would be wrong even if
the key name were reused. The Stone Marker prompt is also persistent (shown every time
`canBuyVeilCharm` is true, not once-and-dismissed) — LUL-2307's dismiss model doesn't fit it.
Do not touch `engine/forest-engine.js:1838` or the `hintCandidate`/`hintDismissedByEvent`
switches.

### 2. Purchase tell

**Audio — reuse, no new function.** `buyVeilCharm()`, `engine/forest-engine.js:4730-4737`:

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

Replace the comment line with a call to the existing `embersPurchaseCue()`
(`engine/forest-engine.js:4861-4869`, added by LUL-2351/PR #586 as the shared purchase-audio
cue for every `SHOP_CATALOG` item — already `soundOn`-gated, already increments
`qaEmbersPurchaseCueCount` for e2e). The Stone Marker charm is not in `SHOP_CATALOG` (flat
15-Ember price, not a tiered item, bought through `buyVeilCharm()` not `purchase(id)`), but the
cue itself is generic — a rising 440→880Hz sine ping with no catalog-specific data — so calling
it directly here is a correct reuse, not a hack. Do not invent a second `charmSound()`; the PLAN
named that only because it hadn't found `embersPurchaseCue()` yet (it didn't exist when the
PLAN's `main`@`3572e53` was cited against — it landed same-day in `release/next`@`72ab46c`).

**Visual — one-shot beacon-glow pulse.** The per-frame ambient pulse for every landmark beacon
already exists (`engine/forest-engine.js:5777-5781`, LUL-1855/LUL-2248):

```js
for(const kind in landmarkBeaconGlows){
  const cfg = LANDMARK_BEACONS[kind];
  landmarkBeaconGlows[kind].material.opacity = cfg.opacityBase + Math.sin(t * cfg.pulseHz) * cfg.opacityAmp;
}
```

That is a continuous ambient loop, not a purchase-moment tell — do not touch it or
`LANDMARK_BEACONS`. Add a single module-scope timer next to `veilReserve`'s own declaration
(`engine/forest-engine.js:408`): `let stoneMarkerPulseT = 0;`. In `buyVeilCharm()`, set
`stoneMarkerPulseT = 0.6;` (seconds). In `tick()`, decrement it once per frame near where
`dimAmount` decays (`engine/forest-engine.js:5341`): `if(stoneMarkerPulseT > 0) stoneMarkerPulseT = Math.max(0, stoneMarkerPulseT - dt);`.
In the beacon loop above, add the boost only for `kind === 'stoneMarker'`:

```js
for(const kind in landmarkBeaconGlows){
  const cfg = LANDMARK_BEACONS[kind];
  let opacity = cfg.opacityBase + Math.sin(t * cfg.pulseHz) * cfg.opacityAmp;
  if(kind === 'stoneMarker' && stoneMarkerPulseT > 0){
    opacity += motionReduced() ? 0.35 : 0.5 * (stoneMarkerPulseT / 0.6);
  }
  landmarkBeaconGlows[kind].material.opacity = opacity;
}
```

`motionReduced()` (`engine/forest-engine.js:2763`) branch is a flat, non-decaying boost for the
same 0.6s window — "static brighten" per the PLAN, not an eased pulse — vs. the animated
linear decay for the normal case. Don't build a generic per-kind pulse-boost registry; no other
landmark needs one today (see Out of scope).

**HUD pip.** `veilReserve` is not currently exposed to React at all — confirmed by grep, it is
a private engine variable (`engine/forest-engine.js:408`). Add it to the per-tick `pushState`
call, `engine/forest-engine.js:5351`:

```js
pushState({ veilCharge: Math.round(veilCharge * 100) / 100, veilLocked, veilReserve, staminaCharge: Math.round(staminaCharge * 100) / 100, timeOfRunClock: formatTimeOfRunClock(timeOfRun) });
```

Also add `veilReserve: false` to the reset-state object at `engine/forest-engine.js:3285`
(`veilCharge: 1, veilLocked: false,` → `veilCharge: 1, veilLocked: false, veilReserve: false,`)
so a fresh run's first HUD push doesn't read stale `undefined`.

`components/Hud.tsx`: add `veilReserve: boolean;` to the `EngineState` interface next to
`veilLocked` (`:63`), and `veilReserve: false,` to the initial state object next to
`veilLocked: false,` (`:225`). Render a small pip next to the veil meter (`:684`):

```tsx
<span id="veilState">
  Veil: {Math.round(state.veilCharge * 100)}%{state.veilLocked ? ' (recharging)' : ''}
  {state.veilReserve && <span id="veilCharmPip"> ✦</span>}
</span>
```

### 3. Activation tell

**Audio — one new function.** The `reserveFired` block, `engine/forest-engine.js:5326-5330`:

```js
if(reserveFired){
  pushState({ caption: 'the charm held', captionId: ++captionSeq });
  // Reuse whatever the nearest existing short one-shot cue primitive is (the same family as
  // missionCompleteSting() -- grep for its definition and mirror it) for an audible tell.
}
```

The comment says "reuse", but every existing one-shot in this file is a distinct
register/direction from its sibling (`caveImmuneStartCue()`'s 220→660Hz rising sweep vs.
`caveImmuneEndCue()`'s 660→220Hz falling sweep, `engine/forest-engine.js:4875-4893`) so the two
edges of one mechanic are never confused for each other with sound off-screen or captions off.
Reusing `embersPurchaseCue()` here too would make "you bought a charm" and "the charm just
saved you" sound identical — add one new function, placed directly after `embersPurchaseCue()`
(`engine/forest-engine.js:4869`), mirroring its shape but descending (the charm being spent,
the inverse of being bought):

```js
// LUL-2331: the Stone Marker charm firing (reserveFired below) is a distinct moment from
// buying it (embersPurchaseCue() above) -- descending sweep, the inverse of that rising one,
// so the two are audibly distinguishable with sound alone, same rationale as
// caveImmuneStartCue()/caveImmuneEndCue() below.
function veilCharmReleaseCue(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(440, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.35);
}
```

Call it from the `reserveFired` block in place of the comment. Give it its own
`qaVeilCharmReleaseCueCount` counter, same idiom as `qaEmbersPurchaseCueCount`
(`engine/forest-engine.js:4860`), incremented unconditionally at the top of the function (before
the `soundOn` guard) so e2e can assert it fired even with sound off.

**Visual — 0.4s eased veil-meter refill, `Hud.tsx` only.** The engine snaps `veilCharge`
instantly on the frame `reserveFired` fires (`lib/game/veil.ts:59-62`, the `reserve` branch of
`stepVeilCharge()` sets `charge = VEIL_UNLOCK_CHARGE * VEIL_MAX_HOLD / maxHold` synchronously) —
this spec does not touch that; the "visible" 0.4s refill is `Hud.tsx` interpolating its own
*rendered* copy of the value, same "engine owns state, HUD owns presentation" split the file
already uses for e.g. captions. In the `Hud` component: track the previous `state.veilReserve`
in a ref, and on the `true → false` falling edge (this *is* `reserveFired`, already computed
engine-side — no need to duplicate that logic in React), start a `requestAnimationFrame` ramp
of a local `displayVeilCharge` state from its last rendered value up to `state.veilCharge` over
400ms; render `Math.round(displayVeilCharge * 100)` instead of `Math.round(state.veilCharge *
100)` at `:684`. When `motionReduced` / `state.reducedMotion` (`:89`) is true, skip the
animation entirely — set `displayVeilCharge` straight to `state.veilCharge` on the same edge, no
ramp. Add a brief CSS flash (a class toggled on `#veilState` for ~400ms, removed by the same
timeout that ends the ramp) on the same edge, also skipped under `reducedMotion` — put the class
and its animation in the same stylesheet the existing `#hint`/caption fade rules live in (grep
for the file, don't invent a new one). The pip added in step 2 disappears on this same edge for
free — it's a direct read of `state.veilReserve`, needs no extra code.

Caption `'the charm held'` (`:5327`) stays exactly as-is — the PLAN's own instruction.

### 4. Guard idioms

Every new call site above already follows the codebase's existing guards precisely:
`embersPurchaseCue()`/`veilCharmReleaseCue()` both open `if(!audio || !soundOn) return;` (audio
functions already have their own qa-counter workaround for the `soundOn`-off case, matching
`qaEmbersPurchaseCueCount`'s own pattern at `:4860`). The beacon pulse and the HUD ramp both
check `motionReduced()`/`state.reducedMotion`. The prompt string in step 1 needs no
`captionsOn` guard — it's the existing persistent `objectiveText`, never gated by captions
(captions are the *toast* system; this is a different display, already exempt today).

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint components/Hud.tsx engine/forest-engine.d.ts` — clean (`forest-engine.js` is
  plain JS, not linted).
- `node --test lib/game/*.test.ts` — unchanged, still green (no file in this spec is under
  `lib/game/`, so nothing here should move any count).
- `npx playwright test e2e/veil-charm.spec.ts e2e/mobile/veil-charm.spec.ts` — new specs green.
- `node .github/scripts/check-elements-citations.mjs` (or the project's usual invocation) —
  clean after the `docs/ELEMENTS.md` line-number fixes in this same PR.

## e2e

**Specs.**
- `e2e/veil-charm.spec.ts` — desktop, `?qaHooks=1`:
  - `'buying the mist-charm plays the purchase cue, shows the pip, and updates the prompt'` —
    new. `qaTeleportNearStoneMarker()`, assert `#objective` reads the new explanation string,
    `page.keyboard.press('KeyE')`, assert `qaProbeEmbersPurchase().purchaseCueCount` incremented
    and `qaProbeVeil().reserve === true`, assert `#veilCharmPip` visible.
  - `'the charm firing plays its own cue, refills the veil, and clears the pip'` — new. After
    purchase, drain the veil to trigger `reserveFired` (hold `KeyF` via `qaSetFixedStep`/
    `qaAdvance`, same clock-control idiom `e2e/action-prompt.spec.ts` already uses, not
    `waitForTimeout`), assert the `'the charm held'` caption fires, `qaVeilCharmReleaseCueCount`
    incremented, `qaProbeVeil()` shows `reserve: false` and `charge >= 0.3`
    (`VEIL_UNLOCK_CHARGE`), `#veilCharmPip` gone.
- `e2e/mobile/veil-charm.spec.ts` — same two scenarios, `touchInteract`/`touchVeil` testids
  (`components/MobileControls.tsx:336` and the existing `touchVeil` target `e2e/mobile/
  veil.spec.ts` already exercises) instead of keyboard, one viewport.

**World.** micro (default). `qaTeleportNearStoneMarker()` reads `landmarkGroups.stoneMarker
.position` at call time and teleports the player `+2` on one axis — same pattern as
`qaTeleportNearThrowable()` (`engine/forest-engine.js:4504-4508`) and `qaTeleportNearMission()`
— so it works regardless of where the landmark actually sits. Note for whoever implements: per
`engine/tuning.js:194-195`, `applyQaWorldMicroPreset()` deliberately leaves `LANDMARKS`
untouched, so the Stone Marker keeps its full-map ~125-unit-from-home position even in the
96-unit micro world; this is a pre-existing, out-of-scope characteristic of the QA world (same
class of gap as LUL-2407, not this ticket's to fix) — the teleport hook sidesteps it by jumping
directly to the landmark's live position rather than walking there, and `maxDistFromHome`
updates from the player's actual post-teleport position on the next tick
(`engine/forest-engine.js:5436`), which is what satisfies `canBuyVeilCharm`'s
`computeDepth(maxDistFromHome) >= VEIL_CHARM_PRICE` gate — no QA-only bypass needed.

**Hooks.**
- `window.ForestEngine.qaTeleportNearStoneMarker(): { x: number; z: number }` — new. Places the
  player 2 units off `landmarkGroups.stoneMarker.position` (mirrors `qaTeleportNearThrowable`),
  not `carrying` (true at run start already). Declare in `engine/forest-engine.d.ts` next to
  `qaTeleportNearThrowable`.
- `window.ForestEngine.qaProbeVeil(): { charge: number; locked: boolean; reserve: boolean }` —
  new. Mirrors `qaProbeMission`'s shape (`engine/forest-engine.js:3645-3647`). Reads
  `veilCharge`/`veilLocked`/`veilReserve` directly, no side effect.
- `qaProbeEmbersPurchase().purchaseCueCount` — existing (`engine/forest-engine.js:4536-4538`),
  reused as-is; `embersPurchaseCue()` already increments the counter it reads.
- `qaVeilCharmReleaseCueCount` — new module-scope counter (see step 3), exposed by folding it
  into `qaProbeVeil()`'s return as a fourth field, or its own tiny probe — implementer's choice,
  name it in the PR.

**Tester scenario.** None — the founder's local QA tester only drives DOM/screenshot checks on
the nightly rig; this feature's correctness (the two new cues actually firing, the pip's
state) is Playwright-assertable and covered above. Worth a follow-up local-qa request only if a
human wants the beacon-pulse *look* eyeballed — not required for this ticket.

**Not covered.** Whether the new sounds and the pulse *feel* right (tone, timing, whether 0.6s
read as "notice me" vs "flash") is a play verdict, not a code check — say so in the PR per the
Tier-B "a play verdict is expected" note the original LUL-1210 spec already carries.

## Cues

**Visual.** Purchase: one-shot beacon-glow opacity boost on `landmarkBeaconGlows.stoneMarker`,
0.6s decay (`engine/forest-engine.js`, beacon loop ~`:5777-5786`). Activation: HUD veil-meter
number eases up over 0.4s + a brief flash class, `components/Hud.tsx` ~`:684`.
**Audio.** Purchase: `embersPurchaseCue()` (existing, `engine/forest-engine.js:4861-4869`),
called from `buyVeilCharm()`. Activation: `veilCharmReleaseCue()` (new, next to it), called from
the `reserveFired` block (`engine/forest-engine.js:5326-5330`). Both `soundOn`-gated.
**Explanation.** Persistent offer prompt, reworded in place: `'Press  E  for a mist-charm  ·
15 embers  ·  saves your veil from locking, once'` (`engine/forest-engine.js:5685`). Activation
caption `'the charm held'` is unchanged (`:5327`).
**Reduced motion.** Purchase pulse: flat, non-decaying opacity boost for the same 0.6s instead
of an eased one (still visible, just not animated). Activation meter ramp: skipped outright —
the displayed number snaps straight to the new value, same as the raw engine state already
does. The HUD pip itself (state.veilReserve true/false) is never animated either way.

## Constraints

No change to `lib/game/veil.ts`'s state machine or `lib/game/economy.ts`'s price. Must not
alter `canBuyVeilCharm`'s gating conditions (`engine/forest-engine.js:5608-5609`). Do not touch
the shared per-frame ambient beacon-pulse loop for any kind other than `stoneMarker`, and do not
build a generic per-landmark pulse-boost registry (see Out of scope).

## Out of scope

- LUL-2307's broader first-encounter-caption rollout for other elements — unrelated, already
  merged, not touched here.
- Part 2 of LUL-2321 (the studio-wide cue-triple checklist/audit itself, `docs/CUES.md`'s other
  `MISSING` rows like fire tower/lake/bog) — CTO's, not this ticket's.
- The Stone Marker landmark's own placement sitting outside the QA micro world's bounds
  (`engine/tuning.js:194-195`) — pre-existing, same class as LUL-2407, not caused or fixed by
  this diff; the e2e teleport hook works around it without needing the underlying gap closed.
- A generic per-landmark one-shot-pulse mechanism for every `LANDMARK_BEACONS` kind — only
  Stone Marker needs a purchase-moment tell today; building a registry for five kinds that don't
  need one yet is speculative.
- `docs/CUES.md`'s row update for this ticket only fixes the Stone Marker row's own MISSING
  cells; it does not re-audit or touch any other row.
