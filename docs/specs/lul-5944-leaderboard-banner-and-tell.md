# SPEC: LUL-5944 leaderboard banner resize + win-screen ineligibility tell

**Ticket:** LUL-5944 · **Tier:** B — `components/GameCanvas.tsx`, `components/Leaderboard.tsx`,
`docs/ELEMENTS.md`. No `engine/**` edit, no new `qa*` hook. Merges on green per AGENTS.md;
Code Reviewer review lands after merge, not before.

**Written against:** `release/next` @ `8f56184` (2026-10-11). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

This SPEC supersedes two details in the CTO's PLAN comment on the ticket after live
verification — both are called out inline below, not silently followed:

1. The PLAN says to add `#gateTitle`-style breakpoint overrides "at `:189` (768px) and the
   480px/420px blocks." Only one breakpoint exists for `#gateTitle` — the single
   `@media (max-width: 768px), (pointer: coarse) and (hover: none)` block starting
   `components/GameCanvas.tsx:150`, overriding `#gateTitle` at `:189`. The three `420px`
   queries in this file (`:620`, `:632-633`, `:877`) are `max-height` queries that style
   `#actionSlot`/`#hint`/`#missionPanel` — unrelated component, unrelated axis, no `#gateTitle`
   or `#leaderboardLine` rule inside any of them. There is no second width breakpoint to port.
2. The PLAN's "is absent on a lantern win" test case can reuse the *existing* test of that
   exact name (`e2e/leaderboard-submit.spec.ts:74-79`) rather than adding a new one with
   `seedSettings({ difficulty: 'lantern' })`. That existing test boots with no `seedSettings`
   call at all — the engine's own default (`engine/forest-engine.js:2142`,
   `let difficulty = 'night'`) is already a non-blackout difficulty, which is all the
   `difficulty !== 'blackout'` branch cares about. Extending the existing test is lower risk
   than adding a parallel one that re-derives `bootBlackout`'s seeding dance for a value the
   component treats identically to the default.

## Files

- `components/GameCanvas.tsx` — edited: resize `#leaderboardLine`, add its mobile breakpoint
  override, style `#leaderboardIneligibleNote`.
- `components/Leaderboard.tsx` — edited: split `LeaderboardSubmitForm`'s early return.
- `docs/ELEMENTS.md` — edited: the Leaderboard section's gate/eligibility description is stale
  after the split (see below).
- `e2e/leaderboard-menu.spec.ts` — edited: one new assertion in an existing test.
- `e2e/leaderboard-submit.spec.ts` — edited: two new assertions in an existing test.

## The change

### A. `#leaderboardLine` banner resize (`components/GameCanvas.tsx`)

Current rule, `:93-96`:

```css
/* LUL-3264: min-width reserves the longest menu string (20-char nickname, 59:59)
   so the loading -> populated swap causes no layout shift. */
#leaderboardLine { font-size: 13px; letter-spacing: 0.04em; color: #c9b98f; min-height: 1.4em;
  min-width: min(36rem, 100%); max-width: 36rem; }
```

Replace with:

```css
/* LUL-3264: min-width reserves the longest menu string (20-char nickname, 59:59)
   so the loading -> populated swap causes no layout shift.
   LUL-5944: sized/measured against a representative 20-char nickname
   ("forestrunner12345678"), not a pathological same-character fill -- the
   worst-case same-char string (e.g. 20 "m"s) already slightly overflowed the
   pre-5944 36rem reserve too (measured ~591px vs. 576px reserved, headless
   Chromium, ui-sans-serif stack) and still does at this size; that edge case
   was never guaranteed and isn't newly broken here. */
#leaderboardLine { font-size: 28px; letter-spacing: 0.04em; color: #c9b98f; min-height: 1.4em;
  text-shadow: 0 2px 26px rgba(201,185,143,0.4);
  min-width: min(68rem, 100%); max-width: 68rem; }
```

Rationale for the numbers (re-verify live before merging, per the "measure, don't just scale"
rule below): measured with Playwright + the real `ui-sans-serif, system-ui, sans-serif` stack
at `letter-spacing: 0.04em`, the representative string `"forestrunner12345678 is the top
rescuer at 59:59 — can you beat it?"` is ~1044px wide at 28px. `68rem` (1088px) covers that with
~44px headroom and still fits inside the standard 1280×720 e2e viewport's `#gate` content box
(1280 − 2×24px padding `:88` = 1232px available) — a literal 130px/10x (CTO PLAN's rejected
option, and this ticket's literal ask) does not fit that math at any reasonable buffer and
would also blow through the `min-width` guard; 28px is the largest size that stays clearly
under `#gateTitle`'s 40px (title remains the primary headline) while reading as a banner, not
a byline, and is reachable on the standard test viewport without wrapping for a realistic
nickname. Shadow color is `#c9b98f` (the line's own color, `rgba(201,185,143,...)`) at `0.4`
alpha — scaled down from `#gateTitle`'s `0.35` alpha blue shadow (`:90`) since the amber line
is a secondary element, not the page's single focal headline.

Add the mobile override inside the existing breakpoint block (`components/GameCanvas.tsx:150`
`@media (max-width: 768px), (pointer: coarse) and (hover: none) { ... }`), immediately after the
`#gateCredit` override at `:195`:

```css
    #gateCredit { font-size: 12px; }
    /* LUL-5944: same banner treatment, scaled to #gateTitle's own 40->26 mobile
       ratio (28 * 26/40 ≈ 18). min-width/max-width at this breakpoint always
       resolve to the container's 100% width (46rem > any phone viewport minus
       #gate's padding) -- kept for the same reason the desktop rule uses
       min(Xrem, 100%): documents the intended cap even though it never binds
       here, consistent with the existing :95-96 idiom. */
    #leaderboardLine { font-size: 18px; text-shadow: 0 1px 16px rgba(201,185,143,0.4);
      min-width: min(46rem, 100%); max-width: 46rem; }
```

**Constraint:** do not add `white-space: nowrap`. The populated-state string already wraps to
two lines on a narrow portrait phone today (measured: the *pre-existing* 13px/36rem rule needs
~485px for the representative string against a ~345px content box on a 393px-wide Pixel 5
portrait viewport minus `#gate`'s 24px×2 padding) — this is a pre-existing gap the ticket does
not ask you to close (see Out of scope), and forcing `nowrap` would turn a graceful wrap into a
hard overflow, which is strictly worse.

### B. Win-screen ineligibility tell (`components/Leaderboard.tsx`)

Current, `:100-110`:

```tsx
export function LeaderboardSubmitForm({ survivedSeconds, difficulty }: { survivedSeconds: number; difficulty: string }) {
  const [nickname, setNickname] = useState('');
  const [country, setCountry] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState<SubmitStatus>('idle');
  // Read once when the win screen mounts (SettingsPanel.tsx writes body[data-admin-mode]).
  // The game UI is client-only (ssr:false), so document always exists here.
  const [adminMode] = useState(() => document.body.dataset.adminMode === '1');

  const timeMs = Math.round(survivedSeconds * 1000);
  if (difficulty !== 'blackout' || adminMode || timeMs < PLAUSIBILITY_FLOOR_MS) return null;
```

Replace the one-line guard at `:110` with:

```tsx
  const timeMs = Math.round(survivedSeconds * 1000);
  // Feature Checklist Q5: a refused input needs a positive tell. adminMode and the
  // implausible-time floor are not real-player-facing cases (admin mode is a dev tool;
  // the floor only fires on a teleport-cheese run under ~15.7s) so they stay silent --
  // only the difficulty gate, which a normal Lantern/Night winner hits every time, gets one.
  if (adminMode || timeMs < PLAUSIBILITY_FLOOR_MS) return null;
  if (difficulty !== 'blackout') {
    return <p id="leaderboardIneligibleNote">Switch to Blackout to compete for the leaderboard.</p>;
  }
```

Everything below (`canSubmit`, `handleSubmit`, the rendered form) is unchanged. Mount site is
unchanged (`components/Hud.tsx:1418`, inside `{state.winVisible && (...)}`, right after
`RunRecap`) — no `Hud.tsx` edit.

Style the new element in `components/GameCanvas.tsx`. Current, `:573`:

```css
  #leaderboardHint, .leaderboardError, #leaderboardSubmitted { font-size: 12px; margin: 0; color: #cbb7a4; }
```

Replace with:

```css
  #leaderboardHint, .leaderboardError, #leaderboardSubmitted, #leaderboardIneligibleNote { font-size: 12px; margin: 0; color: #cbb7a4; }
  /* LUL-5944: unlike the other three (nested inside #leaderboardForm's own flex gap, :565),
     this one replaces the form entirely and sits directly under RunRecap -- needs its own
     top margin instead of inheriting the form's gap. */
  #leaderboardIneligibleNote { margin-top: 6px; }
```

No `#panel`/`adminMode` gating concern here (Feature Checklist Q3): `#winScreen` is a top-level
overlay (`:529`, `z-index: 25`), not a descendant of the admin-gated `#panel` subtree, so the
note is visible to every real player regardless of `adminMode`.

### C. `docs/ELEMENTS.md` (keep current, founder rule 2026-09-04)

The Leaderboard section (`docs/ELEMENTS.md:3864-3874`) currently reads:

> `#leaderboardForm` (...): Rendered only when all three gates pass: `difficulty ===
> 'blackout'`, ... Any one gate failing means no form at all — deliberately silent by design
> (an eligibility check, not a refused player input, so Q5 of `docs/FEATURE_CHECKLIST.md` does
> not apply here).

That last sentence is now wrong for one of the three gates. Replace the paragraph starting
"Any one gate failing" with:

> Admin mode and the plausibility floor failing still render nothing — neither is a
> real-player-facing case. The difficulty gate failing (a normal Lantern/Night win) instead
> renders `#leaderboardIneligibleNote` ("Switch to Blackout to compete for the leaderboard.")
> — LUL-5944, closing the Q5 gap this section used to claim didn't apply. The Blackout-only
> *submission* eligibility rule itself is unchanged and is a ratified decision
> (`decisions/lul-3264-leaderboard-accepted-2026-09-18`); this ticket only adds the tell, it
> does not open submission to other tiers.

Also update the `#leaderboardLine` paragraph's font-size detail if it names `13px` anywhere —
check `docs/ELEMENTS.md:3852-3863` for a stale pixel figure and correct it to 28px if present
(grep did not find one as of this SPEC's write time, but re-check against your actual diff).

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint components/GameCanvas.tsx components/Leaderboard.tsx` — clean.
- `npx next build` — clean.
- `node scripts/check-elements-citations.mjs` — 0 drifted (your `docs/ELEMENTS.md` edit must
  not shift any line number another citation depends on; re-check if it does).
- Manually render the game in a browser (desktop viewport) and confirm `#leaderboardLine` reads
  as a banner under `#gateTitle`, with its shadow, and does not wrap for the real populated
  state. Then narrow to a Pixel 5 viewport (`devices['Pixel 5']`, 393×851) and confirm the same
  for the 768px-breakpoint rule. This is the "verify by rendering the longest real string," not
  just-scale-the-px-value check the CTO's PLAN calls for — do it before merge, the numbers in
  this SPEC were derived from a headless measurement and deserve a human look.

## e2e

**Specs.**
- `e2e/leaderboard-menu.spec.ts` — extend `'shows the record holder and caches it'`
  (`:27-33`) with a computed-style assertion right after the existing `toHaveText` check at
  `:30`: `expect(await page.locator('#leaderboardLine').evaluate(el => getComputedStyle(el).fontSize)).toBe('28px');`.
  This is the regression guard the CTO's PLAN asked for on the banner size — existing.
- `e2e/leaderboard-submit.spec.ts` — extend `'is absent on a lantern win'` (`:74-79`, existing,
  unseeded so it runs at the engine's default non-blackout difficulty) to also assert the new
  tell:
  ```ts
  test('is absent on a lantern win', async ({ page }) => {
    await boot(page, { qaHooks: true });
    await enter(page);
    await win(page);
    await expect(page.locator('#leaderboardForm')).toHaveCount(0);
    await expect(page.locator('#leaderboardIneligibleNote')).toHaveText('Switch to Blackout to compete for the leaderboard.');
  });
  ```
- Keep `'appears on an eligible blackout win...'` (`:37-72`), `'admin mode suppresses it...'`
  (`:81-88`) and `'a blackout win under the plausibility floor...'` (`:90-95`) passing unchanged
  — add one assertion to each of the latter two confirming `#leaderboardIneligibleNote` is
  *also* absent (`toHaveCount(0)`), proving the silent-gates stayed silent after the split:
  ```ts
  await expect(page.locator('#leaderboardForm')).toHaveCount(0);
  await expect(page.locator('#leaderboardIneligibleNote')).toHaveCount(0); // new
  ```

**World.** micro (default, both spec files already boot the default micro world via `boot()` —
no `qaBuildScene` needed, this is a render-only change gated on `state.difficulty`/
`state.winVisible`, both already reachable in the micro world's default win path via
`qaTeleportNearBaby` + `KeyE`, same as every existing test in these two files).

**Hooks.** None new. Both specs already use the real win path (`win()` helper,
`e2e/leaderboard-submit.spec.ts:29-34`: `qaTeleportNearBaby` + `KeyE` + wait for `#winScreen`),
not a hook that force-sets state — satisfies Feature Checklist Q1.5 (the trigger,
`state.difficulty !== 'blackout'`, is set by the real `actions.setDifficulty()`/engine-default
path, same as the existing passing tests already exercise).

**Tester scenario.** Not filing a new `shared/local-qa/requests/*.md` — this is pure
Playwright-coverable render logic (same `state.difficulty`/`state.winVisible` surface the
existing e2e suite already drives through the real win path), no new engine behavior for the
nightly tester's narrower vision-model checks to add value over. The local-qa tester's existing
desktop + Pixel-5-landscape screenshot passes already cover `#gate` and `#winScreen` generally
and will show the resized line/new note incidentally.

**Not covered.** Visual "banner-ness" / whether the shadow reads well against the game's actual
3D background (subjective, needs a human or the local-qa vision model's eyes, not asserted in
e2e). The pathological same-character-nickname wrap case described in the Constraint above
(pre-existing, not asserted, not this ticket's scope).

## Cues

**Visual.** `#leaderboardLine` grows from 13px to 28px (18px ≤768px) with an amber text-shadow,
`components/GameCanvas.tsx:95-96` (new rule, same location). `#leaderboardIneligibleNote`
appears on the win screen in place of the submit form for a non-Blackout win,
`components/Leaderboard.tsx:110-112`.
**Audio.** None — no new sound; this is a static resize and a static text swap, not an event.
**Explanation.** The note's own text is the explanation: "Switch to Blackout to compete for the
leaderboard." (`components/Leaderboard.tsx`, new). Not gated by `captionsOn` — it is permanent
on-screen text, not a transient caption, same class as `#leaderboardHint`/`.leaderboardError`
right next to it, neither of which is `captionsOn`-gated either.
**Reduced motion.** Static, no animation to reduce (both changes are static CSS/text, no new
transition or animation added).

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- Do not touch `LeaderboardMenuLine`'s four-state machine (`loading`/`empty`/`populated`/
  `failed`) or its markup — CSS/font-size/shadow only, per the CTO's PLAN.
- Do not open Blackout-only *submission* to other difficulty tiers — that stays gated exactly
  as before; only the *rendering* behavior on the ineligible branch changes.
- Do not add `white-space: nowrap` to `#leaderboardLine` (see Constraint note in section A).
- Tier B: merges on green, Code Reviewer review lands after merge per AGENTS.md's review tiers.

## Out of scope

- The pathological same-character 20-char nickname overflowing `#leaderboardLine`'s `min-width`
  guard at any font size, and the populated-state string wrapping on narrow portrait phones
  (≤~400px wide) regardless of font size — both pre-existing (present before this ticket at the
  old 13px/36rem values too, per the live measurements in section A), not newly introduced, and
  not asked for by the ticket ("make it bigger" / "where do I put my name").
- Reworking `#leaderboardForm`'s own sizing/shadow treatment — the ticket's "too small" complaint
  and screenshot context are about the gate's record line, not the win-screen form; the form
  already has its own distinct, legible styling (`:565-571`) untouched here.
- The sky balloon / tree-tint surfaces (LUL-3295, wave 2) — unrelated rendering path, not named
  in the ticket.
