# SPEC: LUL-1081 win screen must hold

**Ticket:** LUL-1081 (bug), spec child LUL-1120 · **Tier: C** — win/lose conditions.
Blocking review (`REVIEW: APPROVED`) + a Game Tester play verdict, both required before
merge, per the severity rubric. Spec author (me) confirms Tier C explicitly here.

**Written against:** `release/next` @ `e14e0de` (LUL-1204, 2026-09-02). Re-derive every
`file:line` below from the branch you actually implement on if it has moved.

## Stage 0 result: no reproducible defect found — this is the deliverable this document exists to report

The plan on LUL-1120 asked for one of two answers before any spec got written: (a) a
specific commit regressed the win screen between 2026-08-26 (verified-in-production) and
2026-08-30 (founder report), or (b) it never fully worked and the 2026-08-26 verification
exercised a path the founder doesn't take. **Neither.** I could not find, or reproduce, a
mechanism that makes the win screen fail to hold, in the code as it stands today. Concretely:

1. **The win-hold guard is intact and has been since the LUL-596 extraction.**
   `lib/game/outcome.ts:30` `isPlaying()` returns `s.entered && !s.won && !s.dead &&
   !s.pickingUp` — once `arriveHome()` sets `won: true`
   (`lib/game/outcome.ts:81-84`, gated by `arriveHomeAllowed` at `:73-75`, requiring
   `!dead && !won`), `isPlaying` is false for the rest of the page's life (nothing flips
   `won` back). Every keydown handler that could plausibly cause a restart
   (`engine/forest-engine.js:1637` `on(window, 'keydown', ...)` — jump, hide, pickup,
   toggle-run) is gated on `playing = isPlaying(runState())` at `:1639`, and the movement
   block in `tick()` (`engine/forest-engine.js:3041` `if(playing && !hidden){...}`) is
   gated the same way. **There is no code path, on any branch merged as of this sha, where
   a keypress calls `restart()`.** The only call site of `restart()` outside its own
   declaration is the `onClick` on `.restartBtn` (`components/Hud.tsx:543,558`).

2. **Verified live, not just read.** I drove the actual mechanic headless (Playwright,
   production build, `qaHooks=1`): walked through pickup → carry → `qaTeleportHome()`,
   held `ShiftLeft`+`KeyW` (sprint-forward) from *before* the teleport through the moment
   `arriveHome()` fires (the scenario the founder report and the LUL-1120 plan both
   describe — a player still moving forward at the exact instant of arrival), kept both
   held 3s after the win screen appeared, then released and waited 2s more. `#winScreen`
   stayed visible throughout; `#gate` never remounted (`state.entered` never flips back to
   false, matching `components/Hud.tsx:454`'s `{!state.entered && (...)}` gate). This is
   the specific failure mode Stage 1's acceptance criteria named ("no restart-on-keypress
   that a player could trip by holding a movement key") and it does not occur.

3. **Timeline rules out the two Tier-C changes that landed closest to the report.** Both
   LUL-1043 (Embers economy, PR #229) and the three.js r128→0.185.1 upgrade (PR #228)
   merged to `release/next` on **2026-09-01** — two days *after* the founder's 2026-08-30
   report. Neither can be the cause of the original regression, despite both being the
   most recent Tier-C-scale changes to this surface at the time this ticket was filed.

4. **This is the second independent "no bug found" result for the same symptom.**
   `game/lul650-status` (wiki) recorded the same outcome for an earlier report of this
   exact symptom. Two investigations, two different sessions, same conclusion.

**What this means for scope:** there is no revert to make and no rebuild to spec — Stage
0's "one-line revert, collapse stages 1-2" branch doesn't apply either, because there is no
one-line fix. What *is* missing, and what LUL-1120's own plan already called for
independent of root cause, is the regression test that would have caught this the moment
it becomes true again: "a test that only asserts `winVisible === true` is what let this
through" (LUL-1120 plan). `e2e/smoke.spec.ts`'s existing win test (`:192-233`) does exactly
that — it asserts the screen appears, never that it *stays* appeared under the specific
input pattern in question. That gap is this spec's one required change.

**Escalation, not silent handling:** if the founder sees this again, the reproduction
needs to come from them directly — browser, OS, whether they were on the gamepad/keyboard,
and ideally a screen recording — because two code-level investigations have now come up
empty. Say this in the PR body and in the handoff comment on LUL-1081/LUL-1120; do not
let a third "no bug found" read as the team not looking.

## Declared deviation #1 — the plan's acceptance criterion #2 is stale, do not implement it

LUL-1120's plan (restating the founder's words) lists as required win-screen content: "the
run result from data already tracked: `survivedSeconds`, and whether it beat their best
(`BEST_TIME_KEY` in `localStorage`, `isNewBest`)." **`BEST_TIME_KEY` and `isNewBest` do not
exist in the codebase.** LUL-1043 (2026-09-01) deliberately deleted that mechanic —
`components/Hud.tsx`'s `useRunRecap`/`BEST_TIME_KEY` — because it rewarded dying slowly (a
horror game where a higher `survivedSeconds` "wins" is backwards), and replaced it with the
Embers payout breakdown (`RunPayout`, `lib/game/economy.ts:12-19`) rendered by the current
`RunRecap` (`components/Hud.tsx:290-311`). The plan predates that deletion and was not
updated. **Do not resurrect `BEST_TIME_KEY`/`isNewBest`** — implement against what the win
screen already shows: `survivedSeconds` (unchanged ask) plus the Embers payout (supersedes
the "beat their best" ask). This is a declared deviation from the plan's literal wording,
per the "deviations from a recorded decision" rule — flag it in the PR body too.

## Declared deviation #2 — the reserved reward-slot sequencing already happened, out of order, and is fine

The LUL-1120 plan's Stage 2 says "LUL-1081 ships first and owns the frame; LUL-1043 fills a
slot in it," specifically so Embers wouldn't design the end-of-run moment unilaterally.
**That sequencing did not happen** — LUL-1043 merged 2026-09-01 and already added its own
`EmbersShop` component directly into both `#winScreen` and `#deathScreen`
(`components/Hud.tsx:546,561`), and its own payout breakdown into `RunRecap`
(`:290-311`), with no LUL-1081 spec to conform to yet. This is not this spec's mistake to
fix by re-litigating Embers' placement — the result already reads correctly (balance and
shop render unconditionally; payout renders only when `lastPayout` is non-null, i.e. never
stale-from-a-previous-run per the comment at `:287-289`) and matches what the "reserved,
named region" ask was actually going for. **This spec ratifies the existing
`RunRecap`/`EmbersShop` placement as the reward-slot contract, retroactively**, rather than
asking the Game Engineer to move anything. Flag the out-of-order landing in the PR body as
a declared deviation from the plan's stated sequencing — it already shipped, reverting it
would be pure churn, and re-ordering history isn't on the table.

## Files

### 1. `e2e/smoke.spec.ts` — extend the existing win test, no new `test()` block

Add to the end of the existing test at `:192-233` (after the pointer-lock/cursor
assertions at `:229-232`, before the closing `});` at `:233`), inside the same
`test('pressing E lifts the child; only reaching home (not the pickup) shows the win
screen', ...)` block — same run, same state, no extra `qaTeleportHome()` needed:

```ts
    // LUL-1081/LUL-1120: the founder-reported regression this ticket exists for was
    // "winning silently restarts the game" -- a win screen that appears and then
    // disappears on its own, specifically hypothesized as triggered by a movement key
    // still held at the moment of arrival (a real player walks home holding
    // W/Shift, and is still holding it when they cross the threshold). A prior
    // assertion of `winVisible === true` right after arrival would not catch that --
    // it has to hold the screen open under exactly that input and keep checking.
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(3_000);
    await expect(
      page.locator('#winScreen'),
      'win screen must not disappear while a movement key is held (LUL-1081)',
    ).toBeVisible();
    await expect(page.locator('#gate'), 'winning must never silently restart back to the gate (LUL-1081)').toHaveCount(0);

    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    await page.waitForTimeout(1_000);
    await expect(
      page.locator('#winScreen'),
      'win screen must still hold after the key is released (LUL-1081)',
    ).toBeVisible();
    await expect(page.locator('#gate')).toHaveCount(0);
```

No other file changes. `components/Hud.tsx`, `engine/forest-engine.js`, and
`lib/game/outcome.ts` are not touched — Stage 0 found nothing in them to fix.

## Verification

```
npx playwright test -g "only reaching home"
```

Passing means: the existing assertions (win screen appears, pointer lock releases, cursor
restores) plus the three new ones above (screen stays visible under a 3s held
sprint-forward, stays visible 1s after release, `#gate` never remounts either time) all
green. This is Tier C, so this alone is not a merge gate — CI green plus `REVIEW: APPROVED`
plus a Game Tester play verdict (a real full loop, not just this script) are all still
required, per LUL-1120's own sequence table.

## Constraints

- Do not touch the death/loss screen (`#deathScreen`) — out of scope per the parent
  ticket, and untouched by this spec.
- Do not touch the win *condition* (`arriveHomeAllowed`, `canArriveHome`) — only
  post-win behavior was ever in scope.
- Do not resurrect `BEST_TIME_KEY`/`isNewBest` (declared deviation #1 above).
- Do not move or restructure `EmbersShop`/`RunRecap` inside the win screen (declared
  deviation #2 above) — this spec ratifies their current placement, it does not ask for a
  redesign.
- Do not add a production-code change "just in case" the regression test fails during
  implementation. If the new assertions in `e2e/smoke.spec.ts` **fail** when you actually
  run them, that is new information this spec did not have — stop and report it rather
  than improvising a fix; it would mean Stage 0's conclusion was wrong and the diagnosis
  needs to be redone, not patched around.

## Out of scope

- Embers values, banking/loss rules, sink pricing — LUL-1043 territory.
- Any HUD redesign beyond what's already in `#winScreen`/`#deathScreen`.
- Mobile-specific win-screen testing — the existing test (and this addition) run
  desktop-viewport only, same as before this spec; `#winScreen`'s CSS is not
  viewport-conditional (`components/GameCanvas.tsx`'s `OVERLAY_STYLE`), so no separate
  mobile behavior is expected, but the Game Tester's play verdict should still cover a
  mobile pass per the standing mobile-parity mandate, same as any Tier C ticket.

## A separate, unrelated finding worth a ticket of its own

While reproducing this live, the shared project checkout (this repo's working directory
outside of a worktree) was checked out to a different ticket's branch mid-session by a
concurrent agent run (confirmed via `git reflog` timestamps overlapping my own session).
That's a workspace-integrity hazard for every Founding-Engineer-shaped session using this
directory, separate from LUL-1081/LUL-1120's content — filed as its own ticket, not folded
in here.
