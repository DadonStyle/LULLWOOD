# SPEC: LUL-4527 Log — Crawl-Through

**Ticket:** LUL-4527 · **Tier:** C — touches `engine/forest-engine.js` core simulation
(new per-frame movement branch, scent-deposit gate, camera eye-height easing, chronicle),
`lib/game/cover.ts` (new geometry helper), `lib/game/chronicle.ts` (new event code). Needs
`REVIEW: APPROVED` from the Code Reviewer before merge, per founder rule (do not self-merge).

**Written against:** `release/next` @ `139f4ef9` (2026-09-24). Re-derive every `file:line`
below from the branch you actually implement on if it has moved.

Proposal: wiki `game/mechanics/log-crawl-through`. Decision record: wiki
`decisions/lul-3254-prop-powers-accepted-2026-09-22`. PLAN: CTO comment on this ticket,
2026-09-22T14:20:41Z.

## Deviations from the PLAN (verified live, corrected here)

1. **`maxSpd` citation has moved and simplified.** The PLAN cites
   `forest-engine.js:6593` with a chain including `carryPaceMul` and
   `lakeSpeedMultiplier`. Neither exists any more — `carrying`/throwables and
   `lakeSpeedMultiplier` were removed by earlier tickets (lake deletion, LUL-4675).
   The live line is `forest-engine.js:6721`:
   `const maxSpd = (running ? walk*sprintSpeedMul(staminaCharge) : walk) *
   bogSpeedMultiplier(playerBogginess) * brambleSnagSpeedMultiplier(brambleSnagT);`
   — one multiplier per active exclusive state (bramble already landed via LUL-4526). Per
   deviation #3 below, crawl does not join this chain as a multiplier; it replaces the whole
   `maxSpd` calculation with a fixed value inside its own branch.
2. **`isSprintHeld()` already exists** (LUL-4526 shipped it) at
   `forest-engine.js:3513-3515`. Reused verbatim below for the sprint-refusal tell — no new
   helper needed, correcting the PLAN's implication that this ticket would build it (LUL-4526
   built it first; whichever of the two merged first owns it, LUL-4526 already merged).
3. **Speed is a fixed override, not a stacked multiplier — because direction is also
   overridden.** The proposal's "no sprint/turn mid-crawl" is committed movement: while
   `inLogCrawl`, the player's WASD/touch input is not read for direction at all — movement is
   forced along the log's own long axis, entry mouth to exit mouth, at a fixed pace
   (`walk * LOG_CRAWL_SPEED_MUL`, ignoring `running`/`bogSpeedMultiplier`/`brambleSnagSpeedMultiplier`,
   which are all mutually exclusive with being mid-crawl in practice — bramble and log are
   different `HIDE_KINDS`/`kind` values, and bog biome speed is deliberately dropped so the
   crawl pace reads the same everywhere). This is a stronger, more literal reading of "committed
   and can't turn" than a passive speed cap, and it makes the exit condition trivial to compute
   (distance travelled along one fixed axis) instead of tracking an arbitrary path. See "The
   change" §2 for the exact mechanism and why a passive speed-multiplier-only design (closer to
   Bramble's) was rejected for this feature specifically.
4. **No new predator-alert loop, no new predator state.** The proposal's "predator ... loses
   continuity for a beat, and has to re-acquire at the exit" is a pure side effect of gating the
   single `depositScent()` call site (`forest-engine.js:6757-6758`, was `:6624` in the PLAN's
   stale citation) — nothing about predator AI changes. The PLAN already says this; restated
   here because it is the load-bearing simplification that keeps this a 2-day slice.
5. **PLAN's "6u from the exit mouth" e2e staging distance is corrected to ~1.5u.** Scent
   detection is a per-point radius test (`isScentDetected()`, `lib/game/scent.ts:97`), not a
   distance-to-player check — `SCENT_RADIUS_WALK = 2.2` (`lib/game/scent.ts:24`) is the base
   pickup radius around each individual deposited point. A predator 6u from the exit mouth would
   never detect a single walk-paced point deposited *at* the mouth regardless of this feature;
   staging it at ~1.5u (inside `SCENT_RADIUS_WALK`, outside `HIDE_ALERT_RADIUS`-class immediate
   giveaways) is what actually makes "no scent while inside, catches it the instant you resume
   depositing at the exit" a meaningful assertion. See `## e2e` below.

## Files

- `engine/tuning.js` — add two new tunables (append at EOF).
- `lib/game/cover.ts` — new pure `findLogCrawlEntry()` (append at EOF, sibling to
  `findHideSpot()`/`insideHideFootprint()`).
- `lib/game/cover.test.ts` — unit tests for the new function.
- `engine/forest-engine.js` — new `inLogCrawl`/`logCrawlDirX`/`logCrawlDirZ`/
  `logCrawlExitX`/`logCrawlExitZ`/`logCrawlDeniedLatch` state, `logCrawlDeniedCue()`,
  `logCrawlEnterCue()`/`logCrawlExitCue()`, entry check + forced-movement branch inside the
  existing `if(playing && !hidden){...}` movement block, eye-height easing extended, scent
  gate extended, `qaPlayerState()` extended.
- `lib/game/chronicle.ts` — new `'crawl'` `ChronicleCode`, new `lineFor()` case, drop the now
  fully-dead `HIDE_KIND_LABEL.log` entry.
- `engine/forest-engine.d.ts` — extend `qaPlayerState`'s return type.
- `e2e/log-crawl.spec.ts` — new file, one test (two assertions: crawl suppresses deposit,
  resumes immediately at the exit).
- `docs/ELEMENTS.md` — update the "Log" section (`:587-602` today) to state the new crawl
  behavior; it currently only documents log as walkable-but-not-hideable.
- `docs/CUES.md` — new cue-triple entry for Log Crawl-Through.
- `shared/local-qa/requests/lul-3254-log-crawl-through.md` — new local-qa request file.

## The change

### 1. `engine/tuning.js` — append at end of file (after the Bramble Thorn Snag block added by
LUL-4526)

```js

// ---- Log Crawl-Through (LUL-4527) ----------------------------------------------
// Pass-through mobility: crawling through a log is crawl-paced and committed (no sprint,
// no turning mid-crawl — movement is forced along the log's own axis until the far mouth).
// Pricing owned by the Game Economist in parallel (LUL-3254 decision) -- these are the
// proposal's example values, not final tuning; retune here, no call site changes needed.
export const LOG_CRAWL_SPEED_MUL = 0.5;    // fraction of base walk speed while crawling (fixed, ignores sprint)
export const LOG_CRAWL_ENTER_RADIUS = 1.2; // how close to a log mouth, while moving into it, triggers entry
```

### 2. `lib/game/cover.ts` — append at EOF (after `brambleSnagSpeedMultiplier`)

```ts

// LUL-4527: finds the log the player is walking into. Mirrors findHideSpot()'s
// neighbourhood()/rotation-local-coordinate pattern (cover.ts above) but filters
// kind==='log' specifically — not HIDE_KINDS (empty for log since LUL-2311) and not
// WALKABLE_KINDS (also true for bramble; this needs log's two-mouth geometry, which
// bramble/rock/reed don't have). A log's long axis is always its local `hx` (QA_COVER_SHAPE's
// own convention, engine/forest-engine.js's qaBuildScene block: "log always renders long
// along x; callers wanting the other orientation pass ry = Math.PI/2") — mouths sit at
// c.x ± cos(ry)*hx, c.z ± sin(ry)*hx in world space, the same rotation transform
// findHideSpot()/insideHideFootprint() already use, just applied outward instead of inward.
//
// Trigger condition: the player's next movement step (mvx,mvz, already-normalized world-space
// heading, computed by the caller from real input) must (a) put them within
// LOG_CRAWL_ENTER_RADIUS of one of the log's two mouths, and (b) be heading generally inward
// (dot product of the movement heading with the mouth->log-center direction > 0) — so walking
// past a log's end without turning toward it never triggers a crawl.
//
// Returns the world-space unit direction from the entered mouth to the far mouth (dirX,dirZ)
// and the far mouth's world point (exitX,exitZ), or null if no log qualifies. Ties (player
// near two mouths of different logs at once) break the same way findHideSpot() does: nearest
// candidate wins, first-encountered wins an exact tie.
export function findLogCrawlEntry(
  x: number, z: number, mvx: number, mvz: number,
  coverGrid: SpatialGrid<CoverAABB>,
  cell: number = CELL, span: number = Infinity,
): { dirX: number; dirZ: number; exitX: number; exitZ: number } | null {
  let best: { dirX: number; dirZ: number; exitX: number; exitZ: number } | null = null;
  let bestD = Infinity;
  for (const c of neighbourhood(coverGrid, x, z, cell, span)) {
    if (c.kind !== 'log') continue;
    const ry = c.ry ?? 0, co = Math.cos(ry), si = Math.sin(ry);
    const mouths = [
      { x: c.x + co * c.hx, z: c.z + si * c.hx },
      { x: c.x - co * c.hx, z: c.z - si * c.hx },
    ];
    for (let i = 0; i < 2; i++) {
      const near = mouths[i], far = mouths[1 - i];
      const dx = wrapDelta(x, near.x, span), dz = wrapDelta(z, near.z, span);
      const d = Math.hypot(dx, dz);
      if (d >= LOG_CRAWL_ENTER_RADIUS || d >= bestD) continue;
      const toCenterX = c.x - near.x, toCenterZ = c.z - near.z;
      const toCenterLen = Math.hypot(toCenterX, toCenterZ) || 1;
      const dot = (mvx * toCenterX + mvz * toCenterZ) / toCenterLen;
      if (dot <= 0) continue;
      const dirLen = Math.hypot(far.x - near.x, far.z - near.z) || 1;
      bestD = d;
      best = { dirX: (far.x - near.x) / dirLen, dirZ: (far.z - near.z) / dirLen, exitX: far.x, exitZ: far.z };
    }
  }
  return best;
}
```
(`LOG_CRAWL_ENTER_RADIUS` imported from `@/engine/tuning` — add to this file's existing
`@/engine/tuning` import alongside `BRAMBLE_SNAG_SPEED_MUL`, `:207` today.)

### 3. `lib/game/cover.test.ts` — add near the `brambleSnagSpeedMultiplier` tests

```ts
import { findLogCrawlEntry } from './cover';
import { SpatialGrid } from './spatial-grid'; // match this file's actual existing grid import — grep it, don't guess the path

test('findLogCrawlEntry: null with no logs nearby', () => {
  const grid = new SpatialGrid<any>();
  expect(findLogCrawlEntry(0, 0, 1, 0, grid, 8, Infinity)).toBeNull();
});
test('findLogCrawlEntry: finds the near mouth of a log dead ahead, ry=0', () => {
  const grid = new SpatialGrid<any>();
  grid.insert({ x: 5, z: 0, hx: 1.85, hz: 0.475, kind: 'log', ry: 0 }, 8);
  // player just outside the -x mouth (5 - 1.85 - 0.5 = 2.65), walking +x (toward the log)
  const r = findLogCrawlEntry(2.65, 0, 1, 0, grid, 8, Infinity);
  expect(r).not.toBeNull();
  expect(r!.exitX).toBeCloseTo(6.85, 1); // far mouth: 5 + 1.85
  expect(r!.dirX).toBeCloseTo(1, 5);
});
test('findLogCrawlEntry: walking past without turning toward it does not trigger', () => {
  const grid = new SpatialGrid<any>();
  grid.insert({ x: 5, z: 0, hx: 1.85, hz: 0.475, kind: 'log', ry: 0 }, 8);
  // near the mouth but moving parallel (+z), not toward the log's center
  const r = findLogCrawlEntry(2.65, 0, 0, 1, grid, 8, Infinity);
  expect(r).toBeNull();
});
```
(Match this file's actual `SpatialGrid` construction/insert API and test-runner globals —
grep an existing `cover.test.ts` test against `neighbourhood`/`findHideSpot` before writing
these; the shape above is illustrative, not copy-paste-exact against the real grid class.)

### 4. `engine/forest-engine.js`

**Import** — extend the existing `@/lib/game/cover` import list (`:80`, `brambleSnagSpeedMultiplier,`):
```
  brambleSnagSpeedMultiplier,
  findLogCrawlEntry as geoFindLogCrawlEntry,
  SHUFFLE_OFFSET,
} from '@/lib/game/cover';
```
and the `@/engine/tuning` import list (`:205`, `BRAMBLE_SNAG_DURATION_S, BRAMBLE_SNAG_SPEED_MUL,`):
```
  BRAMBLE_SNAG_DURATION_S, BRAMBLE_SNAG_SPEED_MUL,
  LOG_CRAWL_SPEED_MUL, LOG_CRAWL_ENTER_RADIUS,
} from '@/engine/tuning';
```

**New state** — extend the `brambleSnagT` declaration (`:445` today):
```js
let stoneMarkerPulseT = 0, brambleSnagT = 0, inLogCrawl = false,
    logCrawlDirX = 0, logCrawlDirZ = 0, logCrawlExitX = 0, logCrawlExitZ = 0,
    logCrawlDeniedLatch = false;   // LUL-4527
```

**New cues** — add directly above `enterHide()` (`:3530` today, after `thornSnagSound()`):
```js
// LUL-4527: same procedural-noise-burst shape as thornSnagSound()/leafRustle() -- a low,
// short scrape rather than a rustle, so it reads as wood/bark rather than brush. One-shot on
// entry and on exit, not a sustained loop -- this file has no sustained per-state ambience
// convention (grep confirms `.loop = true` exists only on the two always-on ambient beds,
// wind/insects); a Start/End one-shot pair is the existing convention for a temporary
// player-state transition (leafRustle(true/false)), reused here instead of inventing a loop.
function logCrawlEnterCue(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noise(ctx, 0.2, false);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.15, t+0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.22);
  src.connect(lp); lp.connect(g); g.connect(master); g.connect(conv);
  src.start(t); src.stop(t+0.24);
}
function logCrawlExitCue(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noise(ctx, 0.15, false);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.16);
  src.connect(lp); lp.connect(g); g.connect(master); g.connect(conv);
  src.start(t); src.stop(t+0.18);
}
// LUL-4527: refusal tell for a sprint/strafe/reverse attempt mid-crawl -- same shape as
// veilOverloadDeniedCue() (:6185), the codebase's one existing "input was refused" cue.
function logCrawlDeniedCue(){
  if(!audio || !soundOn) return;
  const { ctx, conv, master } = audio, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'square';
  o.frequency.setValueAtTime(90, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  o.connect(g); g.connect(master); g.connect(conv); o.start(t); o.stop(t + 0.17);
}
```

**Entry + forced movement** — this replaces reading `mvx,mvz` from input with a fixed heading
while `inLogCrawl`, and needs to sit inside the existing `if(playing && !hidden){...}` block
(`:6716` today) so it inherits the same `running`/`staminaCharge`/collision/scent-deposit
plumbing. Insert immediately after the existing `const maxSpd = ...` line (`:6721`) and before
`let ix = 0, iz = 0;`:

```js
    // LUL-4527: entry check -- only when not already crawling, using this frame's actual
    // input heading (computed below as mvx/mvz normally would be) is circular, so entry uses
    // the player's last real facing/movement intent instead: any movement key held this frame,
    // projected the same way the normal branch would. Cheap and correct since the entry check
    // only needs "are they walking toward the mouth," not the exact final heading.
    if(!inLogCrawl){
      let eix = 0, eiz = 0;
      if(keys['KeyW'] || keys['ArrowUp'])    eiz += 1;
      if(keys['KeyS'] || keys['ArrowDown'])  eiz -= 1;
      if(keys['KeyD'] || keys['ArrowRight']) eix += 1;
      if(keys['KeyA'] || keys['ArrowLeft'])  eix -= 1;
      if(hasTouchMove){ eix += touchMove.x; eiz += touchMove.z; }
      const efx = -Math.sin(player.yaw), efz = -Math.cos(player.yaw);
      const erx =  Math.cos(player.yaw), erz = -Math.sin(player.yaw);
      let emvx = efx*eiz + erx*eix, emvz = efz*eiz + erz*eix;
      const emag = Math.hypot(emvx, emvz);
      if(emag > 0){
        emvx /= emag; emvz /= emag;
        const entry = geoFindLogCrawlEntry(player.x, player.z, emvx, emvz, coverGrid, CELL, WRAP_SPAN);
        if(entry){
          inLogCrawl = true;
          logCrawlDirX = entry.dirX; logCrawlDirZ = entry.dirZ;
          logCrawlExitX = entry.exitX; logCrawlExitZ = entry.exitZ;
          logCrawlDeniedLatch = false;
          logCrawlEnterCue();
          logChronicle('crawl_enter', {});
          if(!hintSeen('logCrawl')){
            markHintSeen('logCrawl');
            if(captionsOn) pushState({ caption: "Crawling through the log — you can't sprint or turn until you're through.", captionId: ++captionSeq });
          }
        }
      }
    }
    // LUL-4527: forced-movement branch -- replaces the normal WASD/touch->mvx/mvz composition
    // entirely while crawling. Direction is locked to logCrawlDirX/Z (set on entry, above);
    // speed is a fixed override, not a multiplier on `maxSpd` -- sprint/bog/bramble states are
    // mutually exclusive with being mid-crawl. Any sprint/strafe/reverse input attempt still
    // fires the one-shot refusal cue (latched so it plays once per continuous hold, not every
    // frame), matching Q5's "refused input needs a positive tell."
    if(inLogCrawl){
      const deniedInput = isSprintHeld() || keys['KeyA'] || keys['KeyD'] || keys['KeyS'] ||
        keys['ArrowLeft'] || keys['ArrowRight'] || keys['ArrowDown'];
      if(deniedInput && !logCrawlDeniedLatch){ logCrawlDeniedLatch = true; logCrawlDeniedCue(); }
      else if(!deniedInput) logCrawlDeniedLatch = false;
      const mvx = logCrawlDirX, mvz = logCrawlDirZ;
      escX = mvx; escZ = mvz;
      movingAgainstWind = isMovingAgainstWind(mvx, mvz, windX, windZ);
      spd = walk * LOG_CRAWL_SPEED_MUL;
      const step = spd*dt, lim = half - margin, zLim = zMax - margin;
      const nx = Number.isFinite(WRAP_SPAN) ? wrapCoord(player.x + mvx*step, WRAP_SPAN) : Math.max(-lim, Math.min(lim, player.x + mvx*step));
      const nz = Number.isFinite(WRAP_SPAN) ? wrapCoord(player.z + mvz*step, WRAP_SPAN) : Math.max(-lim, Math.min(zLim, player.z + mvz*step));
      if(!blocked(nx, player.z)){ dist += Math.abs(nx - player.x); player.x = nx; }
      if(!blocked(player.x, nz)){ dist += Math.abs(nz - player.z); player.z = nz; }
      // LUL-4527: scent suppressed entirely while crawling -- no depositScent() call here at
      // all (the gate below on the normal branch is belt-and-suspenders in case both branches
      // ever run the same frame at a transition boundary; see the exit check's own comment).
      noiseRadius = NOISE_RADIUS_WALK;   // still makes a little noise -- crawling isn't silent, just untracked by scent
      const past = (player.x - logCrawlExitX) * logCrawlDirX + (player.z - logCrawlExitZ) * logCrawlDirZ;
      if(past >= 0){
        inLogCrawl = false;
        logCrawlExitCue();
        logChronicle('crawl', {});
      }
    } else {
```

...and close that `else` at the existing end of the block (before the closing brace of
`if(playing && !hidden){...}`, `:6763` today), wrapping the entire pre-existing `let ix = 0,
iz = 0; ... noiseRadius = ...;` body (the normal-movement code, unchanged) inside it. This is
the one structural change to an existing block in this spec — everything inside the `else` is
byte-identical to what's there today, just re-indented one level. **Do not** also change the
`const maxSpd = ...` line itself; it's dead while `inLogCrawl` (the forced branch never reads
it) and still correct for the normal branch.

**Scent gate** — extend the existing deposit line (inside the `else` branch now, same
`:6757-6758` content, unchanged — the forced-crawl branch above never calls `depositScent()` at
all, so no `&&` gate is actually needed on this line; this is a correction to the PLAN, which
assumed the gate would live on the shared line). No edit needed here beyond the reindent.

**Eye-height crouch** — extend the existing easing line (`:6639` today):
```js
  eyeH += (((hidden || inLogCrawl) ? 1.05 : CONFIG.eye) - eyeH) * Math.min(1, dt*8);
```

**`qaPlayerState()`** (`:295-299` in `.d.ts`, matching engine return around `:5210`) — extend
the existing `hidden: hidden, brambleSnagT: brambleSnagT,` return line:
```js
      hidden: hidden, brambleSnagT: brambleSnagT,
      inLogCrawl: inLogCrawl, logCrawlExitX: logCrawlExitX, logCrawlExitZ: logCrawlExitZ,
```

### 5. `engine/forest-engine.d.ts` — extend `qaPlayerState`'s return type (`:295-299`)

```ts
      qaPlayerState?: () => {
        x: number; z: number; yaw: number; pitch: number; mode: 'desktop' | 'mobile';
        jumping: boolean; paused: boolean; toggleRunOn: boolean; veilHeld: boolean;
        hidden: boolean; brambleSnagT: number;
        inLogCrawl: boolean; logCrawlExitX: number; logCrawlExitZ: number;
      };
```

### 6. `lib/game/chronicle.ts`

**`ChronicleCode`** (`:12-20`) — add `'crawl'` (the entry-only `'crawl_enter'` code the engine
logs above is deliberately NOT added here — it has no line, same pattern as `hide_alert`'s
"only sometimes has text" vs. other codes; see `lineFor()` below):
```ts
export type ChronicleCode =
  | 'scent_lock'
  | 'predator_gave_up'
  | 'hide'
  | 'hide_alert'
  | 'crawl'
  | 'pickup'
  | 'fog_tide_start'
  | 'fog_tide_end'
  | 'win'
  | 'death';
```

**`HIDE_KIND_LABEL`** (`:70`) — drop the dead `log` entry (nothing has read it since LUL-2311
removed log from `HIDE_KINDS`; the `'hide'` case at `:80` only ever receives
`kind==='bramble'` in practice today, and crawl gets its own case below instead of reusing this
map):
```ts
const HIDE_KIND_LABEL: Record<string, string> = { bramble: 'the brambles' };
```

**`lineFor()`** (`:72-90`) — add a case, right after `'hide_alert'`:
```ts
    case 'crawl': return 'you slipped through a hollow log, out the other side.';
```

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `node --run build` (or repo's build script) — clean.
- `npx vitest run lib/game/cover.test.ts lib/game/chronicle.test.ts` (or repo's actual
  unit-test command/files — grep for an existing `chronicle.test.ts`, add one if it doesn't
  exist yet) — new tests pass, no regressions.
- `node scripts/check-elements-citations.mjs` — OK, 0 new bad citations, after the
  `docs/ELEMENTS.md` update.
- Full e2e list per `## e2e` below.

## e2e

**Specs.** `e2e/log-crawl.spec.ts` — new file, test
`'crawling through a log suppresses scent deposit end to end: a predator waiting at the exit
mouth does not catch a trail while the player is inside, and catches it the instant they
emerge'`.

```ts
import { test, expect } from './fixtures';
import { boot, enter, qaHook } from './helpers';

const FIXED_DT = 0.02;
const stepsFor = (seconds: number) => Math.ceil(seconds / FIXED_DT);

test('log crawl-through breaks scent continuity end to end', async ({ page }) => {
  await boot(page, { qaHooks: true, qaWorld: 'micro' });
  await enter(page);
  await qaHook(page, 'qaSetWindHighSpeed', false);
  await qaHook(page, 'qaBuildScene', {
    props: [{ kind: 'log', x: 10, z: 0, ry: 0 }],   // hx=1.85 -> mouths at x=8.15 and x=11.85
    // 1.5u past the exit mouth, inside SCENT_RADIUS_WALK(2.2) once the player resumes
    // depositing right at the exit -- see deviation #5 above for why 1.5u, not the proposal's 6u.
    predators: [{ kind: 'wolf', x: 13.35, z: 0, state: 'roam' }],
  });
  // Position the player just outside the entry mouth (x=8.15), facing +x toward the log.
  // `qaTeleportNearCoverKind('log')` (existing hook) places the player 1u beyond whichever
  // mouth QA_COVER_SHAPE's `edge` (= max(hx,hz) = hx for a log) picks -- for this ry=0 log
  // that's the +x side (x = 10+1.85+1 = 12.85), i.e. the EXIT side, not the entry side needed
  // here. Either reposition to the entry side after calling it (`player.x = 8.15 - 1` via a
  // teleport hook, or a new minimal one), or flip the log's `ry` / predator offset so the
  // existing hook's far side becomes the entry -- confirm which against the live hook before
  // relying on it, do not assume.
  await qaHook(page, 'qaSetFixedStep', FIXED_DT);

  // walk forward (+x) toward and through the log
  await page.keyboard.down('KeyD'); // or whichever key maps to +x given this test's yaw -- verify against boot()'s default facing
  await qaHook(page, 'qaAdvance', stepsFor(0.3));   // a few steps to cross LOG_CRAWL_ENTER_RADIUS
  let ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(ps?.inLogCrawl, 'should have entered crawl on approach').toBe(true);

  let pred = await page.evaluate(() => window.ForestEngine?.qaPredatorState?.(0));
  expect(pred?.state, 'predator must not have caught a trail while player is still inside').toBe('roam');

  // advance until fully clear of the log (~ (2*1.85) / (walk*LOG_CRAWL_SPEED_MUL) seconds --
  // compute from the live tuning values, don't hardcode a guess)
  await qaHook(page, 'qaAdvance', stepsFor(3));
  ps = await page.evaluate(() => window.ForestEngine?.qaPlayerState?.());
  expect(ps?.inLogCrawl, 'should have exited crawl by now').toBe(false);

  // a couple more deposit intervals so the resumed trail actually lands
  await qaHook(page, 'qaAdvance', stepsFor(1));
  pred = await page.evaluate(() => window.ForestEngine?.qaPredatorState?.(0));
  expect(pred?.state, 'predator should pick up the resumed trail right at the exit').not.toBe('roam');
  await page.keyboard.up('KeyD');
});
```
This is written from the geometry and tuning values cited in this spec but **not run against a
live rig** — the implementer must verify the exact keypress/yaw needed to move +x given this
repo's `boot()`/`enter()` default facing (grep an existing spec like `e2e/hide.spec.ts` for the
convention), and recompute the `stepsFor(...)` durations from the actual `walk`/
`LOG_CRAWL_SPEED_MUL` values once landed, rather than trusting the placeholder numbers above.

**World.** micro, via `qaBuildScene({ props: [...], predators: [...] })` exactly as shown — one
log, one roaming predator at a fixed offset; no `@fullmap` reason applies (founder rule
LUL-2377).

**Hooks.** `qaBuildScene` (existing), `qaPlayerState` (existing, extended by this spec —
`inLogCrawl`/`logCrawlExitX`/`logCrawlExitZ`), `qaPredatorState` (existing),
`qaSetFixedStep`/`qaAdvance` (existing, LUL-2107 deterministic clock),
`qaSetWindHighSpeed` (existing). No new hook needed — the PLAN's ask for "a new `qa*` hook
that queries `inLogCrawl` + mouth world-pos" is satisfied by extending the existing
`qaPlayerState()` the same way `brambleSnagT` was, not a bespoke hook (declared deviation, see
above).

**Tester scenario.** New request file `shared/local-qa/requests/lul-3254-log-crawl-through.md`
for the nightly desktop + mobile-landscape sweep — confirms the crouch/camera-drop reads as a
crawl, the enter/exit scrape cues are audible and distinct from `thornSnagSound()`, and the
first-encounter caption renders without HUD overlap. The e2e case above is the regression gate
for the mechanic; this file is for the human-facing feel/cue check.

**Not covered.** Actual audio timbre/feel (procedural WebAudio) — manual, via the local-qa
request. The mobile-touch-move path is not separately e2e'd — `hasTouchMove`/`touchMove` feed
the exact same entry-check composition the desktop keys do (see "The change" §4's entry-check
block, which merges `touchMove` the same way the pre-existing normal-movement branch already
does), so wiring is proven by the desktop test; flag the mobile-landscape local-qa pass to
confirm the touch control's feel, same as LUL-4526's precedent.

## Cues

**Visual.** Camera eye-height drop to `1.05` (same value hide uses, `forest-engine.js:6639`) —
the crouch read. No separate crawl animation asset in this cheap slice; the height drop plus
the forced-slow, forced-straight movement is the tell (comparable to existing crouch/hide
visual states, per the wiki proposal's own Q4 answer).
**Audio.** `logCrawlEnterCue()` / `logCrawlExitCue()` (new, `engine/forest-engine.js`, above
`enterHide()`) — one-shot scrape pair on entry/exit, gated `soundOn`. Refusal tell:
`logCrawlDeniedCue()` (new, same file) on a sprint/strafe/reverse attempt mid-crawl, gated
`soundOn`.
**Explanation.** First encounter only: "Crawling through the log — you can't sprint or turn
until you're through." (entry-check block, gated `captionsOn`, one-shot via
`hintSeen('logCrawl')`/`markHintSeen('logCrawl')` — same pattern as `brambleSnag`'s one-shot
toast, not a `HIDE_PRIORITY` pill per the proposal's own Q9 answer: auto-triggered, no new
`#actionSlot` row).
**Reduced motion.** The eye-height crouch easing is already a smooth interpolation, not a
discrete animation — nothing to reduce. The forced-straight movement itself has no separate
motion effect beyond ordinary player translation.

See `decisions/0015-cue-triple` on the wiki.

## Constraints

- `inLogCrawl` must only ever gate the forced-movement branch, the scent-deposit skip (by
  virtue of that branch never calling `depositScent()`), the eye-height crouch, and the
  sprint/turn refusal tell — it must not interact with `hidden`/`hideKind`/`brambleSnagT`.
  Entering a log mid-crawl while already `hidden` cannot happen (the entry check runs inside
  `if(playing && !hidden){...}`, same gate `running` already sits behind), so no ordering
  question between hide and crawl exists.
- The forced-movement branch must still respect `blocked()` for any other solid prop the
  straight-line path might cross (unlikely given the log's own footprint is claimed, but the
  existing per-axis `if(!blocked(nx,...))`/`if(!blocked(...,nz))` guards are kept verbatim, not
  removed, for exactly this reason).
- `LOG_CRAWL_SPEED_MUL` pricing is Game Economist territory — ship with the proposal's example
  value, do not hand-tune based on how the crossing "feels" during implementation.
- Do not add a `HIDE_KINDS` entry for `log` — this feature is deliberately not a static hide
  (LUL-2311's removal reasoning stands; crawl is a transit state with its own boolean, not a
  re-opening of `findHideSpot()` eligibility).

## Out of scope

- Pricing/tuning of `LOG_CRAWL_SPEED_MUL`/`LOG_CRAWL_ENTER_RADIUS` — Game Economist territory
  per the LUL-3254 decision record, shipped here with example values as a starting point.
- Mobile touch-move UI/feel — wiring is identical (the entry check already merges
  `touchMove`), only the local-qa manual pass covers feel.
- Any change to `HIDE_KINDS`/`WALKABLE_KINDS` (`lib/game/cover.ts:631`/`:646`) — log stays
  walkable-but-not-a-static-hide-spot; this spec adds a third, separate boolean state
  (`inLogCrawl`), not a change to either existing set.
- Predator AI changes of any kind — the "loses continuity, re-acquires at the exit" behavior is
  entirely a side effect of the scent-deposit gate; `updatePredators()`/`scentOnto()`/
  `checkScent()` are untouched.
- A reverse-direction crawl retry (entering the exit mouth to re-cross backward) — falls out of
  the geometry for free (either mouth can be the entry, `findLogCrawlEntry()` checks both), not
  separately tested here; if the implementer wants coverage, a second `it()` case is welcome but
  not required for this slice.
