# SPEC: LUL-2351 Store expansion shelf — data-driven catalog + purchase wiring

**Ticket:** LUL-2351, engineering split of LUL-2308 (Game Economist proposal, CEO-accepted
2026-09-11, wiki `decisions/lul-2308-store-expansion-accepted-2026-09-11`). **Tier: B** —
`lib/game/economy.ts` (pure logic) + `components/Hud.tsx` (React wiring) +
`engine/forest-engine.js` (simulation state) + `lib/engine-contract.ts` (type gate). Merge on
green CI; no `REVIEW: APPROVED` needed before merge, per the development-first directive.

**Written against:** `release/next` @ `30be134` (2026-09-11). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

**Builds on:** the CTO PLAN comment on LUL-2351 (2026-09-11) — read it first for the
rationale; this spec pins down the three items it explicitly deferred (Quiet Step
lifetime-only vs. lifetime+radius, the `throwablesReserve` mechanism, delete-vs-wrap
`purchaseDeeperLungs`) and adds one thing the PLAN predates: `decisions/0015-cue-triple`
(filed 2026-09-11, after the PLAN), which requires a visual+audio+explanation cue triple on
every player-interactive feature. §7 below covers it — it is now a P1 merge gate per
`docs/FEATURE_CHECKLIST.md`, same severity as a missing `docs/ELEMENTS.md` update.

**Decisions this spec makes** (the PLAN's three open items, resolved):
1. **Quiet Step is lifetime-only** — matches the accepted falsification metric
   (`avgScentLifetimeBySurvivalRung`, wiki `game/economy/store-expansion`). Radius
   (`SCENT_RADIUS_WALK`/`_RUN`) is untouched.
2. **`purchaseDeeperLungs`/`nextDeeperLungsCost` are deleted**, not wrapped — replaced by
   generic `purchase`/`nextCost`. All 6 call sites enumerated below.
3. **Pocket Stones auto-arms `heldThrowable` from the reserve, it does not add a
   "throw from reserve" branch.** See §5 — this reuses the existing single-held-stone state
   machine and its HUD prompt verbatim, so it needs **zero** UI changes, at the cost of a
   small deviation from the PLAN's literal wording ("consume reserve directly without
   requiring pickup"). Same net effect (+2 free throws/run), simpler mechanism, no new HUD
   surface to cue.
4. **The reserve-refill runs inside `enter()`, not `restart()`** (PLAN cited `:4755`, inside
   `restart()`). `restart()` already calls `enter()` at its tail (`:4763`) — if the refill
   lived only in `restart()`, a returning player's *very first* run of a session (which
   reaches `enter()` directly from the gate click, never through `restart()`) would silently
   lose their purchased Pocket Stones tier for that one run. Putting it in `enter()` covers
   both paths for free; no duplication needed. `embers.tiers.pocketStones` is already
   restored by then — `useEmbers()`'s apply-on-ready effect (`Hud.tsx:351-356`) runs on
   mount, before the player can click the gate.

## Files

- `lib/game/economy.ts` — edited: `EmbersTiers` becomes a map, add `SHOP_CATALOG` +
  generic `purchase`/`nextCost`/`tierOf`, add Quiet Step and Pocket Stones constants, delete
  `purchaseDeeperLungs`/`nextDeeperLungsCost`.
- `lib/game/economy.test.ts` — edited: replace the deleted functions' tests, add catalog
  coverage.
- `lib/engine-contract.ts` — edited: `ENGINE_ACTION_KEYS` swap.
- `components/Hud.tsx` — edited: `EngineActions`/`EngineHudState` shape, `readEmbers`/
  `useEmbers`, `EmbersShop` renders from the catalog, 3 call sites.
- `e2e/returning-player.spec.ts`, `e2e/mobile/returning-player.spec.ts` — **no edit** (kept
  passing unchanged, see Constraints — this is the point of the superset-shape migration).
- `engine/forest-engine.js` — edited: imports, `setEmbers`/`purchase`, Quiet Step scent-decay
  wiring, Pocket Stones reserve, 2 new `qaHooks`, `init()` return, purchase audio cue.
- `engine/forest-engine.d.ts` — edited: declare the 2 new `qaHooks`.
- `docs/ELEMENTS.md` — edited: Embers section prose (`:1246-1326`). No interaction-matrix
  change — `EM` is already a single generic column/row (`:1620-1637`) and neither new item is
  a new physical/geometric world object.
- `docs/specs/lul-1319-economy-panel.md` — **no edit**: grepped `deeperLungs|EmbersTiers`
  against `lib/dashboard/` and `app/internal/` — zero hits. That spec doesn't touch this
  shape and the CTO's PLAN already dropped it from scope on re-derivation.
- `e2e/embers-shop.spec.ts` — new, see §7.

## 1. `lib/game/economy.ts`

Add an import at the top (alongside the existing `VEIL_MAX_HOLD` import, `:10`):

```ts
import { VEIL_MAX_HOLD } from './veil.ts';
import { SCENT_LIFETIME } from './scent.ts';
```

Replace `EmbersTiers` (`:34-37`):

```ts
/** Keyed by SHOP_CATALOG id. Absent key === tier 0 (not purchased) — freshEmbersState()
 * starts empty rather than pre-filling every known id, so a new catalog entry needs no
 * migration of existing saves. Always read through tierOf(), never index directly --
 * an absent key is `undefined` at runtime even though the Record type says `number`
 * (no noUncheckedIndexedAccess in tsconfig.json). */
export type EmbersTiers = Record<string, number>;
```

`freshEmbersState()` (`:44-46`): `tiers: {}` instead of `tiers: { deeperLungs: 0 }`.

After the existing Deeper Lungs section (`:137-159`, `DEEPER_LUNGS_HOLD_SECONDS`/
`DEEPER_LUNGS_COSTS`/`DEEPER_LUNGS_MAX_TIER`/`veilMaxHoldForTier` all stay exactly as-is —
still used by name), add two new sections in the same style, then the catalog and the
generic spend functions:

```ts
// ---- Spend: Quiet Step -- scent decays faster per tier ----------------
// 20% faster decay per tier, compounding (tier2 decays 20% faster than tier1, which is
// already 20% faster than base) -- same "derive from the base constant" discipline as
// DEEPER_LUNGS_HOLD_SECONDS above, so a future SCENT_LIFETIME retune propagates here too.
export const QUIET_STEP_LIFETIME_SECONDS = [
  SCENT_LIFETIME,
  SCENT_LIFETIME * 0.8,
  SCENT_LIFETIME * 0.8 * 0.8,
] as const;
export const QUIET_STEP_COSTS = [150, 250] as const;
export const QUIET_STEP_MAX_TIER = QUIET_STEP_COSTS.length;

export function effectiveScentLifetime(tier: number): number {
  const idx = Math.max(0, Math.min(QUIET_STEP_LIFETIME_SECONDS.length - 1, tier));
  return QUIET_STEP_LIFETIME_SECONDS[idx];
}

// ---- Spend: Pocket Stones -- +2 free throwables per run ----------------
// Single tier. Effect wiring lives in engine/forest-engine.js (enter()) -- this module
// only owns the price and the reserve size, same split as VEIL_CHARM_PRICE above.
export const POCKET_STONES_COSTS = [80] as const;
export const POCKET_STONES_RESERVE = 2;

// ---- Shop catalog -------------------------------------------------------
// Single source of truth for what's for sale, driving both EmbersShop's render
// (components/Hud.tsx) and setEmbers()'s clamp (engine/forest-engine.js). Adding a
// fourth item means adding one entry here -- no new action, no new EmbersShop markup.
export type ShopItemKind = 'permanent' | 'consumable';
export interface ShopItem {
  id: string;
  label: string;
  kind: ShopItemKind;
  costs: readonly number[]; // costs[tier] = price to go from tier -> tier+1
}
export const SHOP_CATALOG: readonly ShopItem[] = [
  { id: 'deeperLungs', label: 'Deeper Lungs', kind: 'permanent', costs: DEEPER_LUNGS_COSTS },
  { id: 'quietStep', label: 'Quiet Step', kind: 'permanent', costs: QUIET_STEP_COSTS },
  { id: 'pocketStones', label: 'Pocket Stones', kind: 'permanent', costs: POCKET_STONES_COSTS },
];

function catalogItem(id: string): ShopItem | undefined {
  return SHOP_CATALOG.find((i) => i.id === id);
}

/** Always 0 for an id with no key yet -- the one safe way to read a tier. */
export function tierOf(state: EmbersState, id: string): number {
  return state.tiers[id] ?? 0;
}

/** Cost to go from `tier` to `tier + 1` for `id`, or null once maxed / for an unknown id. */
export function nextCost(id: string, tier: number): number | null {
  const item = catalogItem(id);
  if (!item) return null;
  return tier >= item.costs.length ? null : item.costs[tier];
}

/** No-op (returns `state` unchanged, same reference) if already maxed, unaffordable, or
 * `id` isn't in the catalog -- callers don't need to pre-check. Replaces
 * purchaseDeeperLungs(); callers that need "did this actually purchase" (the engine's
 * cue-triple gate, see forest-engine.js) compare the returned reference to the input. */
export function purchase(state: EmbersState, id: string): EmbersState {
  const tier = tierOf(state, id);
  const cost = nextCost(id, tier);
  if (cost === null || state.balance < cost) return state;
  return { balance: state.balance - cost, tiers: { ...state.tiers, [id]: tier + 1 } };
}
```

**Delete** `nextDeeperLungsCost` and `purchaseDeeperLungs` (`:156-167`).

## 2. `lib/game/economy.test.ts`

Delete the tests for `nextDeeperLungsCost`/`purchaseDeeperLungs` (currently `:296-330`,
"nextDeeperLungsCost is 120/300/600..." through "purchasing all three tiers in sequence...").
Update the import list (`:1-20`): drop `nextDeeperLungsCost`, `purchaseDeeperLungs`; add
`purchase`, `nextCost`, `tierOf`, `SHOP_CATALOG`, `effectiveScentLifetime`,
`QUIET_STEP_COSTS`, `POCKET_STONES_COSTS`, `POCKET_STONES_RESERVE`.

Also fix `:275-279` and `:306-330`'s `EmbersState` literals — `tiers: { deeperLungs: 1 }` is
still valid (a `Record<string, number>` superset), no change needed there.

Add, in the same file:

```ts
// ---- Generic catalog spend ------------------------------------------------

test('SHOP_CATALOG has the three accepted items, 1,500 total across all tiers', () => {
  const total = SHOP_CATALOG.reduce((sum, item) => sum + item.costs.reduce((a, b) => a + b, 0), 0);
  assert.equal(total, 1500);
});

test('nextCost is 120/300/600 for deeperLungs tiers 0/1/2, then null once maxed', () => {
  assert.equal(nextCost('deeperLungs', 0), 120);
  assert.equal(nextCost('deeperLungs', 1), 300);
  assert.equal(nextCost('deeperLungs', 2), 600);
  assert.equal(nextCost('deeperLungs', 3), null);
});

test('nextCost is null for an unknown id', () => {
  assert.equal(nextCost('nope', 0), null);
});

test('tierOf is 0 for an id with no key yet', () => {
  const s: EmbersState = { balance: 0, tiers: {} };
  assert.equal(tierOf(s, 'quietStep'), 0);
});

test('purchase deducts cost and bumps the tier when affordable', () => {
  const s0: EmbersState = { balance: 150, tiers: {} };
  const s1 = purchase(s0, 'deeperLungs');
  assert.equal(s1.balance, 30);
  assert.equal(tierOf(s1, 'deeperLungs'), 1);
});

test('purchase is a no-op (same reference) when unaffordable', () => {
  const s0: EmbersState = { balance: 50, tiers: {} };
  const s1 = purchase(s0, 'deeperLungs');
  assert.equal(s1, s0);
});

test('purchase is a no-op once maxed, even with plenty of balance', () => {
  const s0: EmbersState = { balance: 99999, tiers: { pocketStones: 1 } };
  const s1 = purchase(s0, 'pocketStones');
  assert.equal(s1, s0);
});

test('purchase is a no-op for an unknown id', () => {
  const s0: EmbersState = { balance: 99999, tiers: {} };
  assert.equal(purchase(s0, 'nope'), s0);
});

test('purchasing quietStep twice in sequence costs 150+250 and lands at tier 2', () => {
  let s: EmbersState = { balance: 400, tiers: {} };
  s = purchase(s, 'quietStep');
  s = purchase(s, 'quietStep');
  assert.equal(tierOf(s, 'quietStep'), 2);
  assert.equal(s.balance, 0);
});

// ---- effectiveScentLifetime ------------------------------------------------

test('effectiveScentLifetime compounds 20% faster decay per Quiet Step tier', () => {
  assert.equal(effectiveScentLifetime(0), SCENT_LIFETIME);
  assert.equal(effectiveScentLifetime(1), SCENT_LIFETIME * 0.8);
  assert.equal(effectiveScentLifetime(2), SCENT_LIFETIME * 0.8 * 0.8);
  assert.equal(effectiveScentLifetime(9), effectiveScentLifetime(2)); // clamps at max tier
});
```

(Import `SCENT_LIFETIME` from `./scent.ts` in the test file for the last block.)

## 3. `lib/engine-contract.ts`

`ENGINE_ACTION_KEYS` (`:14-21`): replace `'purchaseDeeperLungs'` with `'purchase'`. Leave
`'setEmbers'` in place (the key name is unchanged; only its signature changes, which this
array doesn't encode).

## 4. `components/Hud.tsx`

Import line `:12`:

```ts
import { SHOP_CATALOG, nextCost, veilMaxHoldForTier, effectiveScentLifetime, POCKET_STONES_RESERVE, CARRIED, RESCUE, type RunPayout } from '@/lib/game/economy';
```

`EngineActions` (`:168-170`):

```ts
  setEmbers: (balance: number, tiers: Record<string, number>) => void;
  purchase: (id: string) => void;
```

`EngineHudState` (`:97-99`): rename `embersDeeperLungsTier: number` to
`embersTiers: Record<string, number>`.

`INITIAL_HUD_STATE` (`:225-227`): `embersTiers: {}` instead of `embersDeeperLungsTier: 0`.

`PersistedEmbers` (`:316-319`): `tiers: Record<string, number>;`.

`readEmbers()` (`:321-332`) — relax to copy every numeric value, not just `deeperLungs`:

```ts
function readEmbers(): PersistedEmbers | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(EMBERS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedEmbers>;
    if (typeof parsed.balance !== 'number') return null;
    const tiers: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed.tiers ?? {})) {
      if (typeof v === 'number') tiers[k] = v;
    }
    return { balance: parsed.balance, tiers };
  } catch {
    return null;
  }
}
```

`useEmbers()` (`:343-365`) — thread the whole record:

```ts
function useEmbers(actions: EngineActions | null, balance: number, tiers: Record<string, number>) {
  const appliedRef = useRef(false);
  useEffect(() => {
    if (!actions) return;
    appliedRef.current = true;
    const stored = readEmbers();
    if (stored) actions.setEmbers(stored.balance, stored.tiers);
  }, [actions]);
  useEffect(() => {
    if (!appliedRef.current) return;
    writeEmbers({ balance, tiers });
  }, [balance, tiers]);
}
```

`writeEmbers()` (`:334-341`): unchanged (already takes `PersistedEmbers`, whose `tiers`
field type just changed above).

`EmbersShop` (`:494-518`) — render from the catalog:

```tsx
function shopEffectCopy(id: string, tier: number): { current: string; next: string } {
  if (id === 'deeperLungs') {
    return { current: `veil hold ${veilMaxHoldForTier(tier)}s`, next: `veil hold ${veilMaxHoldForTier(tier + 1)}s` };
  }
  if (id === 'quietStep') {
    return {
      current: `scent fades in ${effectiveScentLifetime(tier).toFixed(1)}s`,
      next: `scent fades in ${effectiveScentLifetime(tier + 1).toFixed(1)}s`,
    };
  }
  // pocketStones: single tier, tier is always 0 here (cost==null branch handles tier 1)
  return { current: 'no reserve stones', next: `+${POCKET_STONES_RESERVE} throwables/run` };
}

function EmbersShop({ balance, tiers, actions }: { balance: number; tiers: Record<string, number>; actions: EngineActions | null }) {
  return (
    <div id="embersShop">
      <div id="embersShopBalance">Embers: {balance}</div>
      {SHOP_CATALOG.map((item) => {
        const tier = tiers[item.id] ?? 0;
        const cost = nextCost(item.id, tier);
        const copy = shopEffectCopy(item.id, tier);
        return cost == null ? (
          <div key={item.id} id={`embersShopMaxed-${item.id}`}>
            {item.label} maxed — {copy.current}
          </div>
        ) : (
          <button
            key={item.id}
            className="buyBtn"
            id={`buy-${item.id}`}
            disabled={balance < cost}
            onClick={(e) => {
              // #gate's own onClick would otherwise also fire enter() on this same click.
              e.stopPropagation();
              actions?.purchase(item.id);
            }}
          >
            {item.label} — {copy.current} → {copy.next} — {cost} embers
          </button>
        );
      })}
    </div>
  );
}
```

3 call sites (`:733`, `:918`, `:945`): `tier={state.embersDeeperLungsTier}` →
`tiers={state.embersTiers}`.

`useEmbers()` call site (`:527`): `state.embersDeeperLungsTier` → `state.embersTiers`.

## 5. `engine/forest-engine.js`

**Imports** (`:121-136`): replace `purchaseDeeperLungs as economyPurchaseDeeperLungs` and
`DEEPER_LUNGS_MAX_TIER` (no longer referenced once `setEmbers` loops the catalog, §below)
with:

```js
import {
  freshEmbersState,
  computeWinPayout,
  computeDeathPayout,
  applyPayout,
  purchase as economyPurchase,
  veilMaxHoldForTier,
  effectiveScentLifetime,
  SHOP_CATALOG,
  tierOf,
  POCKET_STONES_RESERVE,
  MISSION_DEEPWATER_REWARD,
  DEEPWATER_RETRIEVAL_BONUS,
  DEEPWATER_SPEEDRUN_BONUS,
  computeDepth,
  computeSurvival,
  applySpend,
  VEIL_CHARM_PRICE,
} from '@/lib/game/economy';
```

**`setEmbers`/`purchase`** (`:4809-4822`) — replace both functions:

```js
// LUL-1043/LUL-2351: sync from components/Hud.tsx's localStorage read, once on mount --
// same "engine owns the state, React persists it" split as setDifficulty/setRunMode/etc.
// above. Bypasses earn/spend logic entirely -- this only ever restores a prior balance,
// it never grants or charges Embers. Clamps every known catalog id to its own max tier and
// silently drops unknown keys, so a future catalog change or a hand-edited localStorage
// value can't hand out an out-of-range tier.
function setEmbers(balance, tiers){
  const clamped = {};
  for(const item of SHOP_CATALOG){
    const raw = tiers && tiers[item.id];
    const t = Math.max(0, Math.min(item.costs.length, Math.floor(raw) || 0));
    if(t > 0) clamped[item.id] = t;
  }
  embers = { balance: Math.max(0, Math.floor(balance) || 0), tiers: clamped };
  pushState({ embersBalance: embers.balance, embersTiers: { ...embers.tiers } });
}
// LUL-2351: generic replacement for purchaseDeeperLungs -- one action for every
// SHOP_CATALOG item. economyPurchase() returns the same `embers` reference, unchanged,
// on a no-op (unaffordable/maxed/unknown id), so the reference check below only fires
// the cue-triple's audio cue on a real purchase.
function purchase(id){
  const before = embers;
  embers = economyPurchase(embers, id);
  pushState({ embersBalance: embers.balance, embersTiers: { ...embers.tiers } });
  if(embers !== before) embersPurchaseCue();
}
```

**`veilMaxHoldForTier` call site** (`:5059`): `veilMaxHoldForTier(embers.tiers.deeperLungs)`
→ `veilMaxHoldForTier(tierOf(embers, 'deeperLungs'))` (direct `.tiers.deeperLungs` access can
be `undefined` at runtime now that an unpurchased tier has no key — see the `EmbersTiers`
comment in `economy.ts` §1).

**Quiet Step — scent lifetime.** `SCENT_LIFETIME` (imported `:48`) stays imported and
**unchanged** at its one sizing use (`SCENT_TRAIL_MAX`, `:1425`) — that buffer must be sized
for the *longest possible* lifetime (tier 0, since every tier only shortens it), so leaving
it keyed to the base constant is already correct and conservative. Replace the two
*behavioral* uses:

- `:1825`, the prune-on-deposit loop inside `depositScent()`:
  ```js
  while(scentPoints.length && isScentPastPruneCutoff(clock.elapsedTime - scentPoints[0].t0, effectiveScentLifetime(tierOf(embers, 'quietStep')))) scentPoints.shift();
  ```
- `:1834`, inside `checkScent()`:
  ```js
  if(isScentDetected(s, age, p.x, p.z, windX, windZ, nose, effectiveScentLifetime(tierOf(embers, 'quietStep')), WRAP_SPAN)) return true;
  ```

Two more call sites currently rely on `isScentExpired(age)`'s default parameter
(`= SCENT_LIFETIME` in `lib/game/scent.ts:44`) and must also pass the effective value for
the effect to be honest end-to-end (a Quiet Step owner whose scent is undetectable per
`checkScent()` but whose render/QA read still shows the old, longer lifetime is a
lying-UI bug, not a cosmetic nit):
- `:3671`, `qaProbeScentOnOldest`: `isScentExpired(age)` → `isScentExpired(age, effectiveScentLifetime(tierOf(embers, 'quietStep')))`.
- `:5546`, the scent-trail render loop: `isScentExpired(age)` → `isScentExpired(age, effectiveScentLifetime(tierOf(embers, 'quietStep')))`.
- `:5554`, the same render loop's alpha calc: `(1 - age/SCENT_LIFETIME)` →
  `(1 - age/effectiveScentLifetime(tierOf(embers, 'quietStep')))` — the LUL-2230 trail visual
  fading proportionally faster is Quiet Step's *visual cue* (see §7), free from this one-line
  change since the trail already renders off real point age.

**Pocket Stones — reserve.** New module-level local next to `heldThrowable`
(`:2583`): `let throwablesReserve = 0;`

Inside `enter()` (`:3281-3289`, in the same fresh-run reset block as `maxDistFromHome = 0;`
/ `veilReserve = false; embersSpent = 0;` — **not** `restart()`, see the Decisions note
above for why):

```js
  throwablesReserve = tierOf(embers, 'pocketStones') > 0 ? POCKET_STONES_RESERVE : 0;
  if(!heldThrowable && throwablesReserve > 0){ heldThrowable = true; throwablesReserve--; }
```

Inside `throwThrowable()` (`:4533-4545`), immediately after `heldThrowable = false;`
(`:4535`), add the same re-arm so a thrown reserve stone is replaced from the reserve
without a map pickup:

```js
  if(!heldThrowable && throwablesReserve > 0){ heldThrowable = true; throwablesReserve--; }
```

No change to `grabThrowable()` (`:4519-4531`) — it already early-returns while
`heldThrowable` is true, so a reserve-armed player can't also grab a map stone on top of it,
same single-held-item invariant as today.

**Purchase audio cue** (place near `caveImmuneStartCue()`, `:4623-4631`, same style):

```js
// LUL-2351: decisions/0015-cue-triple's audio leg for every SHOP_CATALOG purchase
// (Deeper Lungs included -- it had no purchase sound before this ticket; making
// purchase() one shared function for all three items closes that gap as a side effect,
// not a separate retrofit). qaEmbersPurchaseCueCount lets e2e assert it fired without
// decoding actual audio output.
let qaEmbersPurchaseCueCount = 0;
function embersPurchaseCue(){
  qaEmbersPurchaseCueCount++;
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(440, t); o.frequency.exponentialRampToValueAtTime(880, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.35);
}
```

**`init()` return** (`:5741-5749`): replace `setEmbers, purchaseDeeperLungs,` with
`setEmbers, purchase,`. This is exactly the founder's engine/React contract rule
(2026-09-09) checkpoint — `purchase` must exist in `EngineActions` (§4), in
`ENGINE_ACTION_KEYS` (§3), in the engine (`this section`), and **here**, or it's the
LUL-1697 failure class again.

**New `qaHooks`** (inside the `?qaHooks=1` block, `:3320` on, alongside
`qaTeleportNearThrowable` `:4303-4308`):

```js
  // [QA-HOOK] LUL-2351: effective scent lifetime for the run's current Quiet Step tier --
  // an e2e spec can't wait out 14s+ of real decay, so it asserts the tier's effect on this
  // number instead of on live scent-point aging.
  window.ForestEngine.qaProbeScentLifetime = function(){ return effectiveScentLifetime(tierOf(embers, 'quietStep')); };

  // [QA-HOOK] LUL-2351: throwablesReserve + heldThrowable + the purchase-cue fire count,
  // so a spec can assert Pocket Stones granted +2 throws and that buying anything played
  // the cue-triple's audio leg, without decoding actual WebAudio output.
  window.ForestEngine.qaProbeEmbersPurchase = function(){
    return { throwablesReserve, heldThrowable, purchaseCueCount: qaEmbersPurchaseCueCount };
  };
```

## 6. `engine/forest-engine.d.ts`

Declare the two new hooks (near the other `qaProbe*`/throwable declarations, `:99-104` /
`:343`):

```ts
      qaProbeScentLifetime?: () => number;
      qaProbeEmbersPurchase?: () => { throwablesReserve: number; heldThrowable: boolean; purchaseCueCount: number };
```

## 7. Cue triple (`decisions/0015-cue-triple`, P1 gate)

- **Purchase (all 3 catalog items, one interaction).**
  - **Visual:** the shop button/maxed-row text updates immediately (new tier, new cost, new
    disabled state) and `#embersShopBalance` decrements — both already fall out of the
    existing state-driven re-render in §4, no new animation added.
  - **Audio:** `embersPurchaseCue()`, §5 — new, `soundOn`-gated, fires on every real purchase
    across all three items (including Deeper Lungs, previously silent — see the code comment
    on why that's a side effect, not scope creep).
  - **Explanation:** the button's own copy names the effect before/after
    (`shopEffectCopy()`, §4) — same convention as the existing Deeper Lungs button, extended
    to the two new items.
- **Quiet Step's effect.** No new cue needed: the LUL-2230 scent-trail visual already renders
  off real point age (`:5546`/`:5554`), so a shorter effective lifetime is automatically a
  faster-fading trail — the existing visual *is* the effect's cue.
- **Pocket Stones' effect.** No new cue needed: auto-arming `heldThrowable` reuses the
  existing "Holding a stone — click to throw" HUD prompt (`Hud.tsx:888-891`) and its existing
  activation affordance verbatim — the player sees they're already holding a stone at run
  start, which is the tell.
- Not touched: `docs/CUES.md`'s registry (CTO-owned per the decision) — flag back to CTO to
  add rows for the new purchase-cue call site after this merges; not part of this PR's gate.

## Verification

```bash
cd /home/noam/lullwood
npx next typegen && npx tsc --noEmit
npx eslint .
node --test lib/game/economy.test.ts
npx next build
npx playwright install chromium
npx playwright test e2e/embers-shop.spec.ts e2e/returning-player.spec.ts e2e/mobile/returning-player.spec.ts
```

## e2e

**Specs.**
- `e2e/embers-shop.spec.ts` (new) — desktop: seed a high `lullwood:embers` balance via
  `context.addInitScript` (same pattern as `e2e/returning-player.spec.ts:9-13`), boot with
  `qaHooks: true`, buy each of the three items via their `#buy-<id>` button, assert the
  balance/tier text updates and `qaProbeEmbersPurchase().purchaseCueCount` increments each
  time; assert a button is `disabled` when the balance is below its cost; reload the page and
  assert tiers persisted (`localStorage['lullwood:embers']`); assert
  `qaProbeScentLifetime()` drops after buying Quiet Step and `qaProbeEmbersPurchase().
  throwablesReserve`/`heldThrowable` reflect Pocket Stones after `enter()`.
- Same scenarios, mobile viewport (`e2e/mobile/` convention, e.g. `e2e/mobile/embers-shop.spec.ts`
  or a `test.describe` with a mobile project — match whichever convention
  `e2e/mobile/throwables.spec.ts` uses).
- `e2e/returning-player.spec.ts`, `e2e/mobile/returning-player.spec.ts` — must pass
  **unchanged**: their fixture (`tiers: { deeperLungs: 1 }`) is exactly the pre-migration
  shape the `Record<string, number>` superset design exists to keep working.

**Hooks.**
- `window.ForestEngine.qaProbeScentLifetime(): number` — new, §5/§6.
- `window.ForestEngine.qaProbeEmbersPurchase(): { throwablesReserve, heldThrowable, purchaseCueCount }` — new, §5/§6.
- Both land in this PR (small, engine-local, no separate `[QA-HOOK]` ticket needed).

**Tester scenario.** Not one of the nightly fixed checks (`shared/local-qa/QA_TESTER.md`
covers HUD overlap + win/lose sequences only) — drop
`shared/local-qa/requests/lul-2351-embers-shop.md` once the PR is up, pointing at the new
spec above, per `shared/local-qa/REQUESTING-A-TEST.md`.

**Not covered.** The purchase chime's actual timbre/loudness (audio feel) and whether the
faster-fading scent trail's *visual* pacing reads as legible mid-chase — both stay manual
playtest calls, not e2e-assertable.

## Cues

See §7 above (kept inline with the rest of the change since it spans three files, not a
single call site).

## Constraints

- No change to `SCENT_RADIUS_WALK`/`SCENT_RADIUS_RUN` (Quiet Step is lifetime-only, per
  Decision 1).
- `lib/game/economy.ts` stays pure — no Three.js, no localStorage, no wall-clock reads
  (existing file-header rule, `:1-8`).
- `e2e/returning-player.spec.ts`/`e2e/mobile/returning-player.spec.ts` pass with **zero**
  edits — a diff to either of those two files is a sign this spec's migration isn't actually
  backward-compatible and should stop before merging.
- `ENGINE_ACTION_KEYS` (§3), `EngineActions` (§4), `init()`'s return (§5) must all list
  `purchase` in the same PR — the founder's engine/React contract rule, LUL-1697's failure
  mode exactly.
- Single PR — all five files are coupled by the same catalog id list and the contract rule
  above forbids splitting `ENGINE_ACTION_KEYS` from the engine/React sides across PRs.

## Out of scope

- Wayfinder — deferred to v2 pending a design read of LUL-2248 (Decision 3 on LUL-2351).
- `docs/CUES.md` registry update — CTO-owned, flagged in §7, not gated on this PR.
- Any change to `lib/dashboard/`/`app/internal/` — grepped clean, nothing there reads
  `EmbersTiers`/`deeperLungs`.
- Retrofitting a purchase-confirmation *visual* animation (e.g., a button flash) beyond the
  existing state-driven text/balance update — the existing re-render already satisfies the
  cue triple's visual leg (§7); adding animation on top is a polish call for a future ticket,
  not required here.
