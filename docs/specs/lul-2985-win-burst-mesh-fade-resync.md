# SPEC: LUL-2985 win-burst mesh fades out long before the plateau it's meant to survive

**Ticket:** LUL-2985 · **Tier:** C — edits engine simulation visuals (`engine/forest-engine.js`
`updateBoom()`, the same render path LUL-2971/2972 touched). Needs `REVIEW: APPROVED` before
merge.

**Written against:** `release/next` @ `7fc311d43eae5235d22c003a989fd58e7967cbf7` (2026-09-17).
Re-derive every `file:line` below from the branch you actually implement on if it has moved.

## Background

CTO's root-cause comment on LUL-2985 (2026-09-17T15:13Z) confirmed this is a real recurrence,
not a stale build or a duplicate: `fcd6db21` (PR#729, the LUL-2971/2972 color-contrast fix) is
an ancestor of this run's build (`cc5d26d1`), so the fix is live, and the desktop screenshot
still shows only a faint gold ring and particle dots at the burst's centre — no bright flash.

**The mesh fade windows were never resynced to `#flash`'s plateau.** `updateBoom()`
(`engine/forest-engine.js:1788-1808`) drives four independently-timed curves off the same `e`
(seconds since `fireBoom()`):

| Layer | Curve | Fully faded by |
|---|---|---|
| `#flash` DOM overlay | plateau at `FLASH_PEAK_OPACITY` through `e<=1.5`, then linear to 0 | `e=1.8` |
| `boomFlash` (bright sphere) | `1 - e/0.4` | `e=0.4` |
| `boomRing` | `1 - e/1.4` | `e=1.4` |
| `bspPts` (particles) | `1 - e/1.6` | `e=1.6` |
| `boomGroup` retirement | — | `e>1.8` (`:1808`) |

`#flash`'s `e<=1.5` plateau exists specifically (LUL-2605) to tolerate a measured 1.36s
capture round-trip under software WebGL — the vision-QA harness can legitimately sample
anywhere in `[0, 1.5]`. But `boomFlash`, the mesh that actually carries LUL-2971's new
gold/orange color and is the brightest of the three layers, is **fully transparent by
`e=0.4`** — a quarter of the window it needs to survive. `boomRing` and `bspPts` last longer
but still fade out before the plateau ends (`1.4`/`1.6` vs `1.5`/`1.8`).

This ticket's own repro lands at `e≈0.94s` (`gameSinceE=10.24` minus the `e>=9.3` trigger
keyframe cited in LUL-2971's spec, `engine/forest-engine.js:6454`): `boomFlash` has been at 0
opacity for over half a second, `boomRing` is down to `0.33`, `bspPts` to `0.41`. What's left
on screen is exactly what the model described — "only particle effects" — because the one
layer designed to read as a *bright flash* is long gone. This is a timing gap, not a color
gap: LUL-2971 fixed contrast for an on-time capture but never re-measured the mesh's own fade
rate against the plateau it's now supposed to share.

**Why `e2e/win-burst-contrast.spec.ts` didn't catch this:** its worst-case sample point is
`e≈1.36s` (LUL-2605's measured delay), and its assertion is an analytical color-deficit
threshold (`deficit > 20`) computed from whatever `qaProbeBoomPixel()` reads — including
antialiased fringes and faint additive contributions from `boomRing`/`bspPts` at that instant.
That can numerically clear a `20`-unit threshold on trace color while reading, to a human or a
vision model looking at the actual frame, as "no burst, just particles" — the same gap between
a deterministic pixel probe and a vision-model judgement the LUL-2971 spec's own "Not covered"
section flagged. The fix has to make the *mesh itself* still substantially opaque at those
timestamps, not just tune the threshold down further.

## The change

### 1. `engine/forest-engine.js` — unify the three mesh fades with `#flash`'s plateau

At `:1788-1808`, `updateBoom()` currently computes three independent per-mesh opacities and a
separate plateau-then-fade curve for `#flash`. Replace the three mesh opacity lines with one
shared curve matching `#flash`'s own shape — held through `e<=1.5`, then faded to 0 over the
final `0.3s` so it reaches exactly 0 at `e=1.8`, in sync with `boomGroup`'s existing retirement
at `:1808`:

```js
function updateBoom(dt){
  if(boomStart < 0) return;
  boomStart += dt; const e = boomStart;
  // LUL-2985: all three burst-mesh layers now share #flash's own plateau
  // shape (held through e<=1.5, faded out over the last 0.3s to land on 0 at
  // e=1.8) instead of three independent faster fade rates (was 0.4/1.4/1.6s)
  // that left the mesh -- the layer that actually carries LUL-2971's color
  // fix -- fully transparent long before a late vision-QA capture could
  // land in the window #flash's own plateau exists to tolerate.
  const boomMeshOpacity = e <= 1.5 ? 1 : Math.max(0, 1 - (e - 1.5)/0.3);
  boomFlash.scale.setScalar((1 + e*11) * BOOM_FOV_SCALE); boomFlash.material.opacity = boomMeshOpacity;
  const rs = (1 + e*42) * BOOM_FOV_SCALE; boomRing.scale.set(rs, rs, rs); boomRing.material.opacity = boomMeshOpacity;
  const bp = bspPts.geometry.attributes.position.array;
  for(let i=0;i<BSP;i++){ bp[i*3]+=bspVel[i][0]*dt; bp[i*3+1]+=bspVel[i][1]*dt - 4*dt*e; bp[i*3+2]+=bspVel[i][2]*dt; }
  bspPts.geometry.attributes.position.needsUpdate = true;
  bspPts.material.opacity = boomMeshOpacity;
  // LUL-2605: hold #flash at full peak through a plateau instead of decaying from e=0 -- ...
  // (existing comment block and #flash line at :1796-1807, unchanged)
  if(flashEl) flashEl.style.opacity = String(e <= 1.5 ? FLASH_PEAK_OPACITY : Math.max(0, FLASH_PEAK_OPACITY - (e - 1.5)*(FLASH_PEAK_OPACITY/0.3)));
  if(e > 1.8){ boomGroup.visible = false; boomStart = -1; }
}
```

Only the opacity assignments on `boomFlash`/`boomRing`/`bspPts` change (three lines collapse to
one shared `boomMeshOpacity` constant reused three times); the scale math on each mesh and the
`#flash`/retirement lines are untouched. Do not touch `e<=1.5`/`e>1.8` — those are the LUL-2605
capture-delay tolerance, not this fix's concern (same constraint LUL-2971's spec carried).

### 2. `e2e/win-burst-contrast.spec.ts` — extend coverage to the plateau's back half

The existing `CAPTURES` array (`e2e/win-burst-contrast.spec.ts:69-73`) stops at `e≈1.36s`,
inside `#flash`'s tolerated window but a point where the *old* per-mesh curves had already
mostly faded — which is exactly why this bug shipped through that spec once already. Add a
fourth point at `e≈1.49s` (last instant inside the plateau, one frame before `#flash` itself
starts fading at `1.5`) and raise the assertion's bar so a bare "some trace of color" can't
pass:

```ts
const CAPTURES: { totalElapsed: number; label: string }[] = [
  { totalElapsed: 9.3 + 0.43, label: 'e~0.43s (measured LUL-2971 capture offset)' },
  { totalElapsed: 9.3 + 0.9, label: 'e~0.9s (mid-plateau)' },
  { totalElapsed: 9.3 + 1.36, label: 'e~1.36s (LUL-2605 worst-case capture delay)' },
  { totalElapsed: 9.3 + 1.49, label: 'e~1.49s (LUL-2985: last instant inside the plateau)' },
];
```

`assertVisibleTint`'s `deficit > 20` threshold stays as the color-*hue* check (still correct:
warm tint vs. white wash), but add a second assertion at each capture point that the mesh's
own raw opacity-weighted channel isn't just a trace — read `boomFlash`'s live
`material.opacity` via a new tiny hook (below) and assert it's still `> 0.5` for every point
`<= 1.5`, so a regression that reintroduces a fast per-mesh fade fails on the opacity check
even if the color-deficit math still happens to clear 20 by luck:

```ts
async function boomFlashOpacity(page: Page) {
  return qaHook(page, 'qaProbeBoomOpacity');
}
```

```ts
    const mesh = await qaHook(page, 'qaProbeBoomPixel');
    const flashOp = await flashOpacity(page);
    assertVisibleTint(compositeWithFlash(mesh, flashOp), label);
    if (totalElapsed - 9.3 <= 1.5) {
      const meshOpacity = await boomFlashOpacity(page);
      expect(meshOpacity, `${label}: boomFlash opacity decayed before #flash's own plateau ended`).toBeGreaterThan(0.5);
    }
```

New hook next to `qaProbeBoomPixel` (`:5237` area — declare adjacent in `init()`'s `?qaHooks`
block):

```js
  window.ForestEngine.qaProbeBoomOpacity = function(){ return boomFlash.material.opacity; };
```

Declare in `engine/forest-engine.d.ts` next to `qaProbeBoomPixel`:
```ts
      qaProbeBoomOpacity?: () => number;
```

### 3. `docs/ELEMENTS.md` — extend the LUL-2971 bullet

At `docs/ELEMENTS.md:225-233`, append one clause to the existing "As of `LUL-2971`" sentence
(re-run `check-elements-citations.mjs` after — this shifts nothing else since it's an append,
not an insert):

> **As of `LUL-2985`**, all three burst mesh layers (`boomFlash`/`boomRing`/`bspPts`) share
> `#flash`'s own plateau-then-fade timing (held through `e<=1.5`, fading out over the final
> `0.3s`) instead of three independent, faster per-mesh rates — the previous rates left
> `boomFlash` fully transparent by `e=0.4`, a quarter of the window a late vision-QA capture
> is tolerated to land in (`qaProbeBoomOpacity()`).

## Verification

- `npx tsc --noEmit` — clean (new hook typed).
- `npx eslint .` — clean.
- `npx playwright test win-burst` — `win-burst-contrast.spec.ts` (new capture point + opacity
  assertion) and `win-burst-flash-decay.spec.ts` (unchanged, still pins `#flash`'s own curve)
  pass on both `chromium` and `mobile` projects. `e2e/mobile/win-burst-fov-scale.spec.ts` must
  still pass unchanged (mesh scale math untouched).
- `node scripts/check-elements-citations.mjs` — 0 drift.

## e2e

**Specs.** `e2e/win-burst-contrast.spec.ts` — extended per §2 above: one new capture point
(`e≈1.49s`) and a per-point `boomFlash.material.opacity > 0.5` assertion for every point inside
the plateau, on both the `chromium (desktop)` and `mobile` describe blocks already in that
file. `e2e/win-burst-flash-decay.spec.ts` and `e2e/mobile/win-burst-fov-scale.spec.ts` —
unchanged, must still pass (regression check that `#flash`'s curve and mesh scale math weren't
touched).

**World.** micro (`qaTeleportNearBaby` + `qaSetFixedStep`/`qaAdvance`) — same fixture the file
already uses, no map features involved.

**Hooks.** `window.ForestEngine.qaProbeBoomOpacity(): number` — new, returns `boomFlash`'s live
material opacity (declare per §2 above). `qaProbeBoomPixel`, `qaTeleportNearBaby`,
`qaSetFixedStep`, `qaAdvance` — existing, unchanged.

**Tester scenario / local-qa request.** The nightly `vision-win-burst` scenario is the one that
filed this ticket and LUL-2971 before it — no new request file needed for the automatic
scenario. Separately, `shared/local-qa/requests/lul-2971-win-burst-contrast-recheck.md`'s
`expected` block currently asserts only `var boomPixel is truthy` (CTO's comment flagged this
as a false-PASS risk: `qaProbeBoomPixel()` returned `{r:255,g:255,b:255}` — pure white, i.e.
the mesh had already faded at capture time — and the assertion still passed because any object
is truthy). Fixing that manual request file is not a code change (it lives under
`shared/local-qa/`, not the repo) and is tracked directly on this ticket, not this spec — see
the implementation PR's description for the corrected `expr` line.

**Not covered.** Whether the extended plateau *feels* right — a mesh held near-full-opacity
for 1.5s instead of fading over 0.4-1.6s changes the burst's visual pacing from "quick flash"
to "held glow"; this is a legitimate game-feel tradeoff for QA-detectability the founder/CTO
should sanity-check against a real capture once merged, same as LUL-2971's own "Not covered"
note about the recolor. Real-device GPU rendering (targets the software-WebGL rig this bug was
found on).

## Cues

**Visual.** The sky-burst's three mesh layers now hold near-full opacity through `e<=1.5`
instead of fading independently over `0.4s`/`1.4s`/`1.6s`, then fade out together over the
final `0.3s` (`updateBoom()`, `engine/forest-engine.js:1788-1808`). No new visual element —
retiming of an existing one's fade curve; color and scale math unchanged.
**Audio.** Unchanged — `boom()` still fires once at `fireBoom()`, gated by `soundOn`.
**Explanation.** None — no caption/copy tied to the burst.
**Reduced motion.** Unchanged — `motionReduced()` is not consulted in `fireBoom()`/
`updateBoom()` today and this fix doesn't add a new animated property (confirmed via grep, same
as LUL-2971's spec).

## Constraints

- Do not change `e<=1.5`/`e>1.8` in `updateBoom()` — LUL-2605's capture-delay tolerance.
- Do not touch `FLASH_PEAK_OPACITY`, the mesh colors, or `BOOM_FOV_SCALE`/scale math — all
  LUL-2971/2953 territory, out of scope here.
- Tier C: needs `REVIEW: APPROVED` before merge.

## Out of scope

- Redesigning the burst's growth/scale curves (`(1 + e*11)`/`(1 + e*42)`) — this fix only
  retimes the three materials' opacity fade to match `#flash`'s plateau.
- Fixing `shared/local-qa/requests/lul-2971-win-burst-contrast-recheck.md`'s weak assertion —
  not a repo file; done directly on the ticket, not in this PR.
- Any change to `#winScreen` itself (named as `Element:` in the finding) — the defect is in the
  cinematic that plays *before* `#winScreen` appears, same as LUL-2971's own scope note.
