# SPEC: LUL-1857 — carried-cry detection on the return leg, sniff-loop terminal give-up fix

LUL-1857 (LUL-1255.2, Ship 1 wayfinding S4). Design source: wiki
`game/psychology/carried-cry-fairness` (LUL-1647 verdict + its 2026-09-06 amendment §A1-A6,
which supersedes §1-§8's original numbers — read the amendment, not just the base verdict).
Depends on LUL-1674 (S2/S3/S5/S6), merged `e398e3c` — its `cryTimer`/`childCry()`/`hearCry()`
pulse machinery is what this ticket reuses.

All file:line citations below verified directly against `origin/release/next` @ `3271464`
(2026-09-08). If a citation has drifted by the time you implement, the quoted surrounding code
is the anchor to search for — do not guess a nearby line and proceed silently; stop and report
per the spec-architecture contract.

**Tier: C** (predator detection/sniff-loop simulation) — needs `REVIEW: APPROVED` before merge.

## What's actually missing today (verified, not assumed)

Two things are true right now that the ticket description doesn't spell out, and both matter:

1. **There is currently zero carried-cry detection on the return leg.** `hearCry()`
   (`engine/forest-engine.js:1544`) is only ever called from the `roam` branch's cry check at
   `:1830`, which is gated `!baby.taken` — i.e. it fires only outbound, before first pickup.
   Once `carrying` is true this channel is fully off. The "carried-noise floor" the ticket
   calls "LUL-1646, done" is a *number* Game Economist signed off on; the engine wiring for it
   does not exist yet. This ticket adds it from scratch.
2. **`childCry()` (the audible cue) never plays while carrying either.** Its only call site
   (`:4344-4348`) is inside a block gated `if(!baby.taken || babySetDown)` (`:4332`) — the exact
   logical negation of "actively carrying." So today there is no audio cue on the return leg at
   all, which is why mitigation 1 ("the cry that feeds detection is the cry the player hears")
   is a real, unmet requirement, not a formality.

Both facts mean this is new engine behavior, not a retune of something half-built.

## The design (decisions made here, not left open)

**Carried-noise floor is pulse-triggered, not a continuous per-frame roll.** The ticket's own
item 1 describes the floor as sitting "under whatever `noiseRadius` the movement branch would
otherwise compute" (the footstep channel). That footstep channel (`noiseRadius`,
`engine/forest-engine.js:4085`) is fine as-is and stays a continuous `isNoiseHeard()` roll for
*moving* carriers — unchanged, out of scope. But the verdict's mitigation 2 is explicit and
listed as still-required in the amendment's §A6 recap: "the hearing roll fires on the cry, not
per frame." Reconciling the two: the floor governs the **still, carrying** case (footstep
`noiseRadius` is 0 there — no footsteps), and *that* case is what must be pulse-fired, not
continuous. Moving-while-carrying already has real footstep noise and is untouched. This spec
reuses the existing `cryTimer` pulse (already ticks every frame during idle/outbound per
LUL-1674 S3) for both the audio cue and the detection check while carrying, satisfying
mitigation 1 (one timer, one radius, two consumers) and mitigation 2 (pulse, not continuous) at
once.

**Fog tide does NOT scale the floor.** Amendment §A3: naive `floor * 1.35` reaches 7.56u,
inside the 8u sniff-backoff bound by 0.44u — headroom too thin to be safe under future retuning.
Verdict explicitly permits "either cap... or explicitly do not scale" — this spec does not
scale, full stop, and says so in a code comment at the computation site (ticket's own
requirement, item 2).

**Mitigation 3 (backoff-on-give-up) is scoped to the `investigate`/`sniff` terminal give-up
only** (`engine/forest-engine.js:1955`), not the `flank`/`hold` analog at `:1982`. The verdict
(§A5) scopes the requirement to "a hidden, still, carrying player," which is the investigate
loop's territory (flank/hold is the pack-flanking mechanic, a materially different loop with no
sniff-range-then-give-up shape cited anywhere in the verdict). Extending it to flank/hold too
might be a good idea but is not asked for here — note it as a candidate follow-up, do not do it
silently.

**Mitigation 4 (death cause) is NOT implemented in this ticket.** `triggerDeath(kind, cause)`
already threads a `cause` string through to the `loss` analytics event and `deathCause` in
pushed state (`:3674-3703`; existing causes: `'charge'`, `'hunt'`, `'chase'`). But nothing in
the current chase/investigate transition path carries *why* a chase started (heard vs. seen vs.
scented) forward to the eventual `triggerDeath('chase')` call at `:1879` — threading that
through cleanly touches the `chase` transition's several entry points and is a separate,
non-trivial change. The ticket marks this RECOMMENDED not blocking and explicitly allows
leaving it for LUL-1438. Leave it. Do not half-wire it.

**Instrumentation ask (item 7) is already done, no action needed.** `enterHide()` (`:2483`)
already tracks `track({ event: 'feature_engagement', feature: 'hide', action: 'used', carrying
})` and `triggerDeath()`'s `loss` event (`:3703`) already carries `carrying`. Verified by
reading both call sites directly — this predates this ticket (landed with LUL-1674 or earlier).
Confirm it's still true when you pick this up; if so, skip item 7 entirely.

## Files

1. `lib/game/noise.ts` — edit (new exported constant)
2. `lib/game/noise.test.ts` — edit (add cases for the new constant's value and bound)
3. `engine/forest-engine.js` — edit (four separate spots, detailed below)
4. `docs/ELEMENTS.md` — edit only if it documents predator detection channels or the sniff loop
   as a listed interaction (check first; if it doesn't already enumerate hearing channels this
   is a behavior change, not a new element, and may not need a row — use judgement, but say
   what you decided in the PR body)

## The change

### 1. `lib/game/noise.ts` — new constant

Add directly below `CRY_NOISE_RADIUS` (`:28`):

```ts
/** LUL-1857: a still, carrying player still emits this much noise from the child's
 * own rustling/fussing -- a floor under the footstep channel, not a replacement for
 * it (a *moving* carrier still uses NOISE_RADIUS_WALK/RUN normally). 0.4 *
 * NOISE_RADIUS_WALK, per LUL-1646 (Game Economist) / decisions/childs-cry-lul1674-
 * disposition-2026-09-07. Deliberately NOT fog-tide-scaled: game/psychology/
 * carried-cry-fairness §A3 shows floor*1.35 (fog-tide's own multiplier) reaches
 * 7.56u, inside the 8u sniff-backoff-distance bound (§A3) by only 0.44u -- too
 * little headroom to be safe under any future retune. Leaving this unscaled keeps
 * a full 2.4u of margin always. This value is checked deterministically against a
 * pulse event (see engine/forest-engine.js's carry-leg cry timer), not rolled
 * per-frame like isNoiseHeard() -- see carried-cry-fairness verdict mitigation 2. */
export const CARRIED_NOISE_FLOOR = 0.4 * NOISE_RADIUS_WALK; // 5.6
```

Add a test in `lib/game/noise.test.ts` (new `describe`/section, following the file's existing
flat `test(...)` style) asserting:
- `CARRIED_NOISE_FLOOR === 5.6`
- `CARRIED_NOISE_FLOOR < 8` (the amendment's hard bound — this is the one assertion that would
  catch a future accidental retune of `NOISE_RADIUS_WALK` pushing the floor over the line;
  make it self-documenting, e.g. `assert.ok(CARRIED_NOISE_FLOOR < 8, 'must stay under the
  sniff-backoff distance per carried-cry-fairness §A3')`)

### 2. `engine/forest-engine.js` — import

`CARRIED_NOISE_FLOOR` needs to reach both the carry-leg pulse block (~`:4344` area) and
`updatePredators` (`:1709`). Add it to the existing `lib/game/noise.ts` import (find the
existing `NOISE_RADIUS_WALK`/`CRY_NOISE_RADIUS`/etc. import line near the top of the file and
add `CARRIED_NOISE_FLOOR` to it — do not add a second import statement for the same module).

### 3. `engine/forest-engine.js` — carry-leg cry pulse (inside the `carrying` render branch)

The `carrying` branch starts at `:4131` (`} else if(carrying){`) and its last statement before
the closing brace is the `canArriveHome(...)` check (a few lines after `:4141`, — re-locate by
searching for `if(canArriveHome(runState(), dh, CONFIG.home.r)) arriveHome();` inside that
branch; do not hardcode a line number for the insertion point beyond that anchor).

Add, inside the `carrying` branch (after `dh` is computed, alongside the existing
`homeFireTimer` pulse block that already lives there — same shape, same branch):

```js
    // LUL-1857: carry-leg cry pulse -- reuses cryTimer (LUL-1674 S3d) rather than a
    // second timer, so outbound and carry-leg cry cadence stay one clock (mitigation
    // 1: "one source, two consumers"). The outbound pulse block below (`if(!baby.taken
    // || babySetDown)`) is the exact logical negation of `carrying`, so the two never
    // both fire in the same frame -- safe to share the module-level cryTimer.
    cryTimer -= dt;
    if(cryTimer <= 0){
      childCry(0, player.x, player.z);   // in your arms: always "near" (near=1), centered (no pan)
      cryTimer = 2;                      // closest-tempo floor -- matches the outbound block's own near=1 case (5.5 - 1*3.5)
      carriedCryPulse = true;            // consumed by updatePredators() this same tick, cleared after
    }
```

`carriedCryPulse` is a new module-level flag, declared alongside the existing `cryTimer`/
`homeFireTimer` declarations (`:1182-1184`): `let carriedCryPulse = false;`. It must be reset
to `false` immediately after `updatePredators(...)` is called (`:4168` today — the call site
this spec doesn't otherwise change), e.g.:

```js
  if(playing) updatePredators(dt, noiseRadius, cryNoiseRadius);   // predators only hunt while you're actually playing
  carriedCryPulse = false;   // LUL-1857: one-tick pulse, consumed above -- clear so it isn't sticky
```

Do **not** thread `carriedCryPulse` through `updatePredators`'s parameter list — `carrying` and
every other module-level flag it reads (`hidden`, `player`, etc.) are already read via closure
inside that function (confirm: `carrying` is referenced directly at `:1815` inside
`updatePredators` today, no parameter needed), so this new flag follows the same existing
pattern.

### 4. `engine/forest-engine.js` — `childCry()` signature change

`childCry(distToPlayer)` (`:1562`) currently derives its own pan direction from module-level
`baby.x`/`baby.z` internally (`:1567`: `const dx = baby.x - player.x, dz = baby.z - player.z;`).
That's correct outbound (baby.x/z is live there) but wrong during carry: `baby.x`/`baby.z` is
**not** updated per frame while carrying — it's a static snapshot last written at pickup
(`finishPickup()`) or `setDown()` (`:3548`: `baby.x = player.x; baby.z = player.z;`, run once on
put-down, not continuously). Reusing it during carry would pan toward a stale, receding point
instead of the player's own hands.

Fix: give `childCry()` explicit source-position parameters instead of reading `baby.x/z`
internally.

```js
function childCry(distToPlayer, srcX, srcZ){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const near = Math.max(0, Math.min(1, 1 - distToPlayer / 140));   // 0 far .. 1 close
  const pan = ctx.createStereoPanner();
  const dx = srcX - player.x, dz = srcZ - player.z;
  // ...unchanged below this line...
```

Update the one existing call site (outbound pulse, `:4344`, inside `if(!baby.taken ||
babySetDown)`) to pass the explicit position it was implicitly using before:

```js
      childCry(cryDist, baby.x, baby.z);
```

(`cryDist` there is already `Math.hypot(baby.x - player.x, baby.z - player.z)`, computed the
line above — unchanged.)

With `srcX = srcZ = player.x/player.z` at the new carry call site, `dx = dz = 0`, so `pan.pan`
resolves to `0 / Math.max(1, 0) = 0` (centered, no `NaN` — the existing `Math.max(1, ...)`
guard already handles the zero-vector case, confirm this by reading `:1567-1571` — no new
guard needed).

### 5. `engine/forest-engine.js` — the detection check itself, inside `updatePredators`

In the `roam` branch (`:1709` `function updatePredators`, the state check starting
`} else if(p.state === 'roam'){`), the existing chain of `else if` detection checks runs
sight → scent → footstep → outbound-cry (`:1817-1830`), ending in the `wander` `else` at
`:1832`. Add a new arm **after** the existing outbound-cry check at `:1830` and **before** the
final wander `else`:

```js
      else if(!sniffImmune && carrying && carriedCryPulse && dist < CARRIED_NOISE_FLOOR){
        // LUL-1857: pulse-fired, not a continuous isNoiseHeard() roll (mitigation 2)
        // -- deterministic proximity check at the moment the cry sounds, same shape
        // as checkThrowableNoise()'s one-shot design (lib/game/noise.ts). `dist` here
        // is already the live predator-to-*player* distance computed at the top of
        // this loop (`:` a few lines above this function's body) -- correct source
        // position for the carry leg since the child moves with the player and
        // baby.x/z is not live during carry (see childCry() fix above).
        hearNoise(p);   // commits to investigate/approach targeting the live player position -- exactly the carry-leg contract (the "noise source" moves with you)
      }
```

`carrying` is already in scope inside `updatePredators` via closure (confirmed used at `:1815`
today). `dist` is the per-predator variable already computed near the top of the per-predator
loop body (the same `dist` the footstep check at `:1823` uses) — do not recompute it.

Reusing `hearNoise(p)` (not a new function) is deliberate: it already sets `p.state =
'investigate'; p.inv = 'approach'` targeting the *live player position* (no `p.noiseTarget`
override), which is exactly correct here — unlike the outbound cry (`hearCry()`, which targets
the fixed `baby.x/z` because the baby doesn't move on its own before pickup), the carry-leg
noise source moves with the player every frame, so the default live-player-targeting behavior
`hearNoise()` already has is the right one. Do not call `hearCry()` here.

### 6. `engine/forest-engine.js` — terminal give-up routes through `backOffPoint()` when hidden+carrying

At `:1955` (inside `p.inv === 'sniff'`'s `stepSniffLoop` handling, the `else` branch for
`sniffOutcome.next === 'roam'`):

```js
          else { p.lkpX=player.x; p.lkpZ=player.z; p.lkpSweeps=LKP_MAX_SWEEPS; p.state='roam'; p.spotted=false; logChronicle('predator_gave_up', { kind: p.kind }); }
```

Today this leaves the predator's `x`/`z` untouched — it just flips state to `roam` in place, at
sniff range (2.5-3.2u, inside the 5.6u floor). Per verdict amendment §A5, a hidden, still,
carrying player's give-up must be observable as the animal *walking away*, using the same
`backOffPoint()` helper the mid-loop `sniff → back` transition already uses (`:1953-1954`, `bd
= 8 + rng()*8`).

The mid-loop `back` sub-phase (`p.inv === 'back'` handler, `:1957-1958`) can't be reused
directly for this — on arrival it always transitions to `p.inv = 'approach'` (there's more
sniffing to do), but the terminal give-up needs to land in `roam` instead once it arrives. Add
a new `p.inv` value, `'leave'`, that mirrors `'back'`'s movement but a different arrival
transition:

```js
          else if(hidden && carrying){
            // LUL-1857 (carried-cry-fairness §A5): route the give-up through the
            // same backoff helper the mid-loop 'back' path uses, but land in 'roam'
            // on arrival (not 'approach' -- there's nothing left to sniff). Scoped to
            // hidden+carrying only, per the verdict's own scope (§A5) -- the ordinary
            // (non-carrying) give-up keeps its existing in-place behavior unchanged,
            // an intentional, not-yet-asked-for-elsewhere deviation from a uniform fix.
            const bd = 8 + rng()*8;
            [p.backX, p.backZ] = backOffPoint(p.x, p.z, ux, uz, bd, half, zMax, WRAP_SPAN);
            p.inv = 'leave';
          }
          else { p.lkpX=player.x; p.lkpZ=player.z; p.lkpSweeps=LKP_MAX_SWEEPS; p.state='roam'; p.spotted=false; logChronicle('predator_gave_up', { kind: p.kind }); }
```

And add the new `'leave'` handler as a sibling arm to the existing `p.inv === 'back'` handler
at `:1957`:

```js
      } else if(p.inv === 'leave'){
        const bx=p.backX-p.x, bz=p.backZ-p.z, bd=Math.hypot(bx,bz);
        if(bd < 2){ p.lkpX=player.x; p.lkpZ=player.z; p.lkpSweeps=LKP_MAX_SWEEPS; p.state='roam'; p.spotted=false; p.inv=''; logChronicle('predator_gave_up', { kind: p.kind }); }
        else { desx=bx/bd; desz=bz/bd; speed=p.spec.speed*0.5*pLakeMul; }
      }
```

(Movement speed `*0.5` matches the existing `'back'` handler's own retreat speed — same
"walking away, not fleeing" pace, not a new number.) `logChronicle('predator_gave_up', ...)`
fires on arrival, not at the moment the give-up begins, so a chronicle reader sees the give-up
recorded when the predator has actually left, not when it started leaving — a deliberate choice
consistent with what `'back'`'s own sibling code already does elsewhere in this loop (it defers
side effects like `sniffImmuneT` to loop-entry, not loop-intent). If this makes an existing
chronicle-timing assumption break, that's a spec/repo disagreement — stop and report, per the
spec-architecture contract, don't silently change the timing.

`ux`/`uz` are already computed once per predator per frame near the top of the per-predator
loop body (same variables `:1954`'s existing `back` transition already uses) — reuse them, do
not recompute.

## Out of scope (do not touch)

- The outbound cry channel (`hearCry()`, `:1544`, and its `:1830` call site) — already shipped,
  reviewed, unrelated to this ticket. Do not modify its gating, timing, or targeting.
- The footstep noise channel for a *moving* carrier (`noiseRadius` at `:4085`) — unchanged,
  still a continuous roll, still `NOISE_RADIUS_WALK`/`RUN`.
- `flank`/`hold`'s terminal give-up (`:1982`) — not in the verdict's scope (see "The design"
  above). Do not extend the `'leave'` mechanism there in this ticket.
- Mitigation 4 (death cause threading) — explicitly deferred to LUL-1438; do not partially wire
  a `cause` value that isn't real (e.g. do not hardcode `'heard_child'` on every carry-leg
  chase — that would misattribute deaths caused by sight/scent while carrying).
- Any change to `SNIFF_IMMUNITY_TIME`/`isSniffImmune()` values — the amendment (§A2) already
  found the existing 1.5s grace adequate once mitigation 3 lands; this spec does not retune it.
- `docs/ELEMENTS.md` — only touch if you determine (see Files §4) that it currently documents
  predator hearing/detection as an enumerated interaction; if it doesn't, this is a behavior
  change to an existing element, not a new one, and may not need a row. State your call in the
  PR body either way.

## Mobile parity

No new input or on-screen control — this is a detection/AI-behavior and audio change only, with
no new player-facing verb. Confirm in the PR body that no touch affordance was needed (nothing
to route through `EngineActions`/`triggerTouchInteract`), consistent with `AGENTS.md`'s mobile
rule that a feature only needs a touch affordance when it "binds a key" or adds a reachable
action — this doesn't.

## Verification

1. `node --test lib/game/noise.test.ts lib/game/predator.test.ts` — both existing suites must
   still pass unmodified in substance (only the new `CARRIED_NOISE_FLOOR` cases are additive to
   `noise.test.ts`; `predator.test.ts` needs no new cases since `backOffPoint()` itself is
   unchanged — only its call sites in `forest-engine.js` are new, and that file has no unit
   test harness of its own per this repo's existing pattern).
2. `npx tsc --noEmit` — clean.
3. `npx eslint lib/game/noise.ts lib/game/noise.test.ts engine/forest-engine.js` — clean.
4. `node scripts/check-duplicate-logic.mjs` — clean. `CARRIED_NOISE_FLOOR` is a new top-level
   export from `lib/game/noise.ts` imported by name into the engine (per Files §2) — matches
   the script's required import shape, should not trip it.
5. `node scripts/check-elements-citations.mjs --fix` — run regardless of whether `ELEMENTS.md`
   was touched; harmless if not, and this diff shifts line numbers in `forest-engine.js` which
   can flip unrelated existing citations (see `AGENTS.md`'s "unit tests CI check" section).
6. `next build` — passes.
7. No console errors on load — cannot verify without a browser in this environment; say so
   explicitly in the PR, per `AGENTS.md`'s "you assert code correctness only" rule. Gameplay/
   audio feel (does the carry-leg cry read as dread, not harassment) is Game Tester's call and
   QA is currently paused — say that explicitly too.

## Constraints recap

- Tier C — do not merge without `REVIEW: APPROVED`.
- Pure/no-side-effect requirement: `CARRIED_NOISE_FLOOR` itself must stay a plain exported
  constant, no function.
- `CARRIED_NOISE_FLOOR` must stay `< 8` always (enforced by the test in Files §1) — this is the
  one number in this spec with a hard safety bound; do not let a future PR retune
  `NOISE_RADIUS_WALK` silently break it without that test catching it.
- Do not add fog-tide scaling to the floor. If a future ticket wants it, that's a deliberate,
  declared change against §A3's bound, not something to sneak into this diff.
