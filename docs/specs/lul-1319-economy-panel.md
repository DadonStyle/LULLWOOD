# SPEC: Economy panel for the internal dashboard (payout/balance distributions)

**Ticket:** LUL-1319, accepting LUL-1295 (Game Economist), per wiki
`game/economy/falsification-card` §4. **Tier: B** — `app/internal/**` + `lib/dashboard/**`,
internal tooling, not player-facing. Merge on green; review lands after, per the
development-first directive. No `REVIEW: APPROVED` needed before merge.

**Written against:** `release/next` @ `7ac9070` (2026-09-02). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

**Design source:** wiki `game/economy/falsification-card` — six pre-registered predictions
(P1–P6) about the Embers curve, of which P1 (win rate) and P2 (loss-by-predator) are
*already* on screen via `computeOutcomes` in the existing dashboard. This spec closes the
gap for **P3, P4, P5, P6** — the four that need payout/balance data the dashboard currently
never touches. `grep -rn "payout|balance" app/internal/` returns nothing today; that is the
bug this spec fixes.

Read-side only. **No game-code change, no new telemetry event, no new stored field, no
migration.** `payout`, `balance`, and `time_survived_ms` are already emitted
(`lib/analytics.ts:23-24`) and already survive `RawEvent` parsing untouched
(`lib/dashboard/events.ts:17` is an open `[key: string]: unknown` index, no allowlist to
extend).

## Files

1. `lib/dashboard/aggregate.ts` — edit. Add one exported function (`computeEconomy`) and
   one exported interface (`EconomyResult`).
2. `app/internal/dashboard/page.tsx` — edit. Call `computeEconomy` and render one new
   `<section>`.
3. `lib/dashboard/aggregate.test.ts` — edit. Add tests for `computeEconomy`.

## The change

### 1. `lib/dashboard/aggregate.ts`

Reuses the two helpers already in this file: `percentile(sortedAsc, p)` (`:44`) and
`numberProp(e, key)` (`:50`) — both apply unchanged, do not modify either.

Append this at the end of the file (after `computeFeatureEngagement`, i.e. after current
line 175):

```ts
export interface EconomyResult {
  winPayout: { p50: number | null; p90: number | null; n: number };
  lossPayout: { p50: number | null; p90: number | null; n: number };
  /** P3: median(loss payout) / median(win payout) * 100. Falsification card predicts 12-28%. */
  failureBandPct: number | null;
  /**
   * P4: derived death-depth = payout - min(6, floor(time_survived_ms / 20000)) on each
   * loss (the survival term, capped at 6, subtracted back out). No `maxDistFromHome`
   * field needed -- see wiki game/economy/falsification-card §1 note under P4.
   * Falsification card predicts p95 <= 24.
   */
  lossDepth: { p50: number | null; p95: number | null; pctAbove24: number | null; n: number };
  /**
   * P5: a purchase is a decrease in an anon_id's balance sequence (win/loss events,
   * ts-ordered) -- no `purchase` event needed. Falsification card predicts >=60% of
   * anon_ids that ever cross 120 balance show a decrease within the next 3 runs.
   */
  purchase: {
    crossed120Count: number;
    purchasedWithin3RunsCount: number;
    purchasedWithin3RunsPct: number | null;
  };
}

const SURVIVAL_TERM_CAP = 6;
const SURVIVAL_TERM_DIVISOR_MS = 20000;
const DEPTH_FALSIFY_THRESHOLD = 24;
const PURCHASE_BALANCE_THRESHOLD = 120;
const PURCHASE_WINDOW_RUNS = 3;

export function computeEconomy(events: RawEvent[]): EconomyResult {
  const wins = events.filter((e) => e.event === 'win');
  const losses = events.filter((e) => e.event === 'loss');

  const winPayouts = wins
    .map((e) => numberProp(e, 'payout'))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const lossPayouts = losses
    .map((e) => numberProp(e, 'payout'))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

  const winPayoutP50 = percentile(winPayouts, 50);
  const lossPayoutP50 = percentile(lossPayouts, 50);

  const lossDepths = losses
    .map((e) => {
      const payout = numberProp(e, 'payout');
      const survivedMs = numberProp(e, 'time_survived_ms');
      if (payout === null || survivedMs === null) return null;
      const survivalTerm = Math.min(SURVIVAL_TERM_CAP, Math.floor(survivedMs / SURVIVAL_TERM_DIVISOR_MS));
      return payout - survivalTerm;
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

  const pctAbove24 =
    lossDepths.length === 0 ? null : (lossDepths.filter((d) => d > DEPTH_FALSIFY_THRESHOLD).length / lossDepths.length) * 100;

  // P5: chronological balance sequence per anon_id, across win+loss events.
  const runsByAnon = new Map<string, number[]>();
  const chronological = [...wins, ...losses].sort((a, b) => a.ts - b.ts);
  for (const e of chronological) {
    const balance = numberProp(e, 'balance');
    if (balance === null) continue;
    const arr = runsByAnon.get(e.anon_id) ?? [];
    arr.push(balance);
    runsByAnon.set(e.anon_id, arr);
  }

  let crossed120Count = 0;
  let purchasedWithin3RunsCount = 0;
  for (const balances of runsByAnon.values()) {
    const crossIdx = balances.findIndex((b) => b >= PURCHASE_BALANCE_THRESHOLD);
    if (crossIdx === -1) continue;
    crossed120Count++;
    for (let i = crossIdx + 1; i <= crossIdx + PURCHASE_WINDOW_RUNS && i < balances.length; i++) {
      if (balances[i] < balances[i - 1]) {
        purchasedWithin3RunsCount++;
        break;
      }
    }
  }

  return {
    winPayout: { p50: winPayoutP50, p90: percentile(winPayouts, 90), n: winPayouts.length },
    lossPayout: { p50: lossPayoutP50, p90: percentile(lossPayouts, 90), n: lossPayouts.length },
    failureBandPct:
      winPayoutP50 === null || lossPayoutP50 === null || winPayoutP50 === 0 ? null : (lossPayoutP50 / winPayoutP50) * 100,
    lossDepth: {
      p50: percentile(lossDepths, 50),
      p95: percentile(lossDepths, 95),
      pctAbove24,
      n: lossDepths.length,
    },
    purchase: {
      crossed120Count,
      purchasedWithin3RunsCount,
      purchasedWithin3RunsPct: crossed120Count === 0 ? null : (purchasedWithin3RunsCount / crossed120Count) * 100,
    },
  };
}
```

### 2. `app/internal/dashboard/page.tsx`

**Import** (edit line 3, add `computeEconomy` to the existing import):

```ts
import { computeFunnel, computeOutcomes, computeSessions, computeFeatureEngagement, computeEconomy } from '@/lib/dashboard/aggregate';
```

**Compute** (edit line 42, add one line right after the existing `computeFeatureEngagement`
call):

```ts
  const featureEngagement = computeFeatureEngagement(events);
  const economy = computeEconomy(events);
```

**Render.** Insert a new `<section>` between the existing "Sessions" section (ends at
current line 183, `</section>`) and the "Feature engagement" section (starts at current
line 185, `<section>`):

```tsx
        <section style={{ marginBottom: '2.5rem' }}>
          <h2>Economy</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '1rem' }}>
            <tbody>
              <tr>
                <td style={td}>Win payout P50 / P90 (n)</td>
                <td style={td}>
                  {fmtNum2(economy.winPayout.p50)} / {fmtNum2(economy.winPayout.p90)} ({fmtNum(economy.winPayout.n)})
                </td>
              </tr>
              <tr>
                <td style={td}>Loss payout P50 / P90 (n)</td>
                <td style={td}>
                  {fmtNum2(economy.lossPayout.p50)} / {fmtNum2(economy.lossPayout.p90)} ({fmtNum(economy.lossPayout.n)})
                </td>
              </tr>
              <tr>
                <td style={td}>Failure band (loss/win payout)</td>
                <td style={td}>{fmtPct(economy.failureBandPct)}</td>
              </tr>
              <tr>
                <td style={td}>Loss depth P50 / P95 (n)</td>
                <td style={td}>
                  {fmtNum2(economy.lossDepth.p50)} / {fmtNum2(economy.lossDepth.p95)} ({fmtNum(economy.lossDepth.n)})
                </td>
              </tr>
              <tr>
                <td style={td}>Loss depth &gt; 24</td>
                <td style={td}>{fmtPct(economy.lossDepth.pctAbove24)}</td>
              </tr>
              <tr>
                <td style={td}>Crossed 120 balance</td>
                <td style={td}>{fmtNum(economy.purchase.crossed120Count)}</td>
              </tr>
              <tr>
                <td style={td}>Purchased within 3 runs of crossing</td>
                <td style={td}>
                  {fmtNum(economy.purchase.purchasedWithin3RunsCount)} ({fmtPct(economy.purchase.purchasedWithin3RunsPct)})
                </td>
              </tr>
            </tbody>
          </table>
          <p style={{ color: '#777', fontSize: '0.85rem' }}>
            Falsification card (wiki <code>game/economy/falsification-card</code>): P3 predicts the failure band in
            12–28%; P4 predicts loss depth P95 ≤ 24; P5 predicts ≥60% purchase-within-3-runs; P6 predicts win payout
            P50 in [95, 130]. This panel reports the measurements only — it does not evaluate the predictions.
          </p>
        </section>

```

Add one formatter next to the existing `fmtPct`/`fmtMs`/`fmtNum` (edit around current line
25, right after `fmtNum`):

```ts
function fmtNum2(n: number | null): string {
  return n === null ? '—' : n.toFixed(2);
}
```

### 3. `lib/dashboard/aggregate.test.ts`

Add `computeEconomy` to the existing import (edit line 3):

```ts
import { computeFunnel, computeOutcomes, computeSessions, computeFeatureEngagement, computeEconomy } from './aggregate.ts';
```

Append these tests at the end of the file (reuse the existing `ev()` helper and `BASE_TS`
already defined at the top of this file — do not redefine them):

```ts
test('computeEconomy: payout percentiles and failure band', () => {
  const events: RawEvent[] = [
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000 }),
    ev('win', BASE_TS, 'b', { payout: 120, balance: 220, time_survived_ms: 90000 }),
    ev('loss', BASE_TS, 'c', { payout: 15, balance: 15, time_survived_ms: 30000, predator_kind: 'wolf' }),
    ev('loss', BASE_TS, 'd', { payout: 25, balance: 25, time_survived_ms: 30000, predator_kind: 'bear' }),
  ];
  const economy = computeEconomy(events);
  assert.equal(economy.winPayout.n, 2);
  assert.equal(economy.winPayout.p50, 100);
  assert.equal(economy.lossPayout.n, 2);
  assert.equal(economy.lossPayout.p50, 15);
  assert.equal(economy.failureBandPct, 15);
});

test('computeEconomy: empty input never divides by zero', () => {
  const economy = computeEconomy([]);
  assert.equal(economy.winPayout.p50, null);
  assert.equal(economy.failureBandPct, null);
  assert.equal(economy.lossDepth.pctAbove24, null);
  assert.equal(economy.purchase.crossed120Count, 0);
  assert.equal(economy.purchase.purchasedWithin3RunsPct, null);
});

test('computeEconomy: loss depth derives survival term from time_survived_ms, capped at 6', () => {
  const events: RawEvent[] = [
    // survivalTerm = min(6, floor(150000/20000)) = min(6,7) = 6; depth = 30 - 6 = 24
    ev('loss', BASE_TS, 'a', { payout: 30, time_survived_ms: 150000, predator_kind: 'wolf' }),
    // survivalTerm = min(6, floor(10000/20000)) = 0; depth = 40 - 0 = 40 (> 24)
    ev('loss', BASE_TS, 'b', { payout: 40, time_survived_ms: 10000, predator_kind: 'lion' }),
  ];
  const economy = computeEconomy(events);
  assert.equal(economy.lossDepth.n, 2);
  assert.equal(economy.lossDepth.p50, 24);
  assert.equal(economy.lossDepth.pctAbove24, 50);
});

test('computeEconomy: purchase is a balance decrease within 3 runs of crossing 120', () => {
  const events: RawEvent[] = [
    // anon 'a': crosses 120 on run 2, decreases on run 3 (within window) -> purchased
    ev('win', BASE_TS, 'a', { payout: 100, balance: 100, time_survived_ms: 90000 }),
    ev('win', BASE_TS + 1, 'a', { payout: 30, balance: 130, time_survived_ms: 90000 }),
    ev('loss', BASE_TS + 2, 'a', { payout: 15, balance: 45, time_survived_ms: 30000, predator_kind: 'wolf' }),
    // anon 'b': crosses 120 on run 1, never decreases -> not purchased
    ev('win', BASE_TS, 'b', { payout: 150, balance: 150, time_survived_ms: 90000 }),
    ev('win', BASE_TS + 1, 'b', { payout: 20, balance: 170, time_survived_ms: 90000 }),
    // anon 'c': never crosses 120 -> excluded entirely
    ev('loss', BASE_TS, 'c', { payout: 15, balance: 15, time_survived_ms: 30000, predator_kind: 'bear' }),
  ];
  const economy = computeEconomy(events);
  assert.equal(economy.purchase.crossed120Count, 2);
  assert.equal(economy.purchase.purchasedWithin3RunsCount, 1);
  assert.equal(economy.purchase.purchasedWithin3RunsPct, 50);
});
```

## Verification

```bash
node --test --experimental-test-module-mocks lib/dashboard/aggregate.test.ts
npx tsc --noEmit
npx eslint lib/dashboard/aggregate.ts app/internal/dashboard/page.tsx lib/dashboard/aggregate.test.ts
npm run build
```

All four must pass clean. The four new `computeEconomy` tests plus the existing suite in
`aggregate.test.ts` must all report passing (`node --test` summary: 0 fail).

## Constraints

- Read-side only: do not touch `lib/analytics.ts`, `lib/telemetry-transport.ts`,
  `app/api/telemetry/route.ts`, `lib/dashboard/events.ts`, or `lib/dashboard/blob-source.ts`.
- `computeEconomy` must be pure (no I/O), exactly like `computeOutcomes` next to it — this
  is what keeps the whole file unit-testable without touching Blob.
- Do not add a `maxDistFromHome` field or a `purchase` event. Both are explicitly
  out-of-scope scope-creep per wiki `game/economy/falsification-card` §4 — depth and
  purchases are already derivable from `payout`/`balance`/`time_survived_ms`, which is the
  entire point of this spec.
- Do not change `computeFunnel`, `computeOutcomes`, `computeSessions`, or
  `computeFeatureEngagement`, or their existing call sites/rendering. P1 (win rate) and P2
  (loss-by-predator) are already covered by `computeOutcomes` and already rendered — nothing
  here duplicates them.
- Follow the existing file's formatting conventions exactly (inline `style={...}` objects
  reusing the module-level `th`/`td` constants, no new CSS, no new dependencies).

## Out of scope

- Evaluating the six predictions against their falsification thresholds (e.g. coloring a
  row red/green). This panel reports numbers; a human reads the wiki card and judges them.
- The three "horizon predictions" added 2026-09-02 to the falsification card (median run
  length, session-end-vs-run-21, first-purchase-at-run-4) — those come from
  `session_length`/funnel data already on screen via the existing Sessions/Funnel sections,
  not from this panel.
- Any change to the Embers price curve, payout formula, or any other game-code change.
- Mobile-specific layout: this is an internal `/internal/dashboard` tooling page rendered
  with plain HTML tables, same as every other section on it already. No mobile parity work
  applies here (not a player-facing surface).
