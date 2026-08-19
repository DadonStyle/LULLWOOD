# Elements list — what's in the game, and how collision bugs are prevented now

Written for Noam per LUL-383's ask: "write me the list in NOAM_MDS as
ELEMENTS_LIST_CHANGES with the current list + how you implement them and how
you prevent collision bugs now." This is the plain-language version. The
reviewable, source-cited version this was built from is `docs/ELEMENTS.md`
(repo root) and the wiki page `game/elements-registry` — read those for the
line-by-line proof of every claim below.

## The current list — every element in the game, today

**Actors** (things that move or are carried): Player, the lost Child, and
nine predators across three species — Wolf, Bear, Lion (three of each).

**World geometry**: Trees (1,300 of them), and three kinds of cover prop —
Rock, Log, Bramble (220 total). Log and Bramble are the *only* two things
you can formally hide behind ("hidden" stance) — Rock and small trees just
block sight if you duck behind them, same as always, but never let you
crouch-and-hide.

**Landmarks**: the Lake (the map's visual centerpiece) and Home (where you
carry the child to win — it's literally the same spot you spawn at).

**Ambient/atmosphere**: Fog (a pure visual effect), and your own Follow-light
(the personal glow that moves with you and dims on `F`).

**Ground**: one flat plane under everything — it has no logic of its own.

**HUD/UI**: the objective text, hiding status, win/death screens, minimap,
charge-dodge prompt, and all the settings controls. One-way: the game engine
tells the screen what to show; the screen can only ever click a button back.

**Not yet on `main`**: the Bog map expansion (your LUL-25 ticket) — it's
approved and reviewed, but the pull request hasn't merged yet. I documented
its shape separately so folding it in is quick once it lands, but I didn't
count it in the "current" list above since it isn't live.

## How I implemented this list

I read the entire game engine file (`engine/forest-engine.js`, 2,625 lines
as of this branch's tip — corrected 2026-08-18, LUL-426; it was 2,519 at
`7796362` (LUL-411) and 2,602 in an earlier snapshot, which is why the
citations in `docs/ELEMENTS.md` have twice needed a full re-derive: each
backmerge from `main` that touches the engine shifts them again)
top to bottom rather than working from memory or the original ticket's
wording, per your own instruction ("enumerated from the engine"). For each
element I wrote down, with a citation to the exact line of code:

- what it can actually do,
- what it explicitly *cannot* do (this is the half most likely to prevent
  someone inventing a feature that was never built),
- the real numbers driving its behavior (speeds, radii, timers), and
- exactly what it physically collides with, blocks sight of, or passes
  through.

Then I built the N×N table you asked for — every one of those elements
checked against every other one for how they actually interact. Most of the
grid is either a real, working interaction (a tree blocks you; a rock blocks
line of sight but not a predator's movement) or a deliberate, documented "no
interaction" (Fog is cosmetic on purpose; bears don't pack-hunt on purpose).

## How this prevents collision bugs now, and what it already found

The point of the list is that **"undefined" cells in that grid are the bugs
you haven't found yet** — not guesses, not opinions, things the code itself
never decided. Building the full grid surfaced six of them on the first
pass:

1. The hiding-stance analytics tracking has been silently broken since an
   earlier ticket accidentally shadowed it with a duplicate function —
   the *feature* works, but you've had a blind spot on how often players
   actually use it.
2. The lake has no collision at all — you can walk straight into the water
   with zero effect. That might be intentional (a shallow, walkable lake)
   or might be a missing feature; I didn't guess, I filed it as a question.
3. Predators can walk straight through rocks, logs, and bushes (not trees)
   — this one turned out to be *deliberate*, from an earlier bug where
   giving them real collision there caused them to get stuck. Not a bug,
   just now written down so nobody "fixes" it by accident.
4. Predators never spawn-check against the lake the way trees and the child
   do — worth confirming whether one can spawn standing in the water.
5. Cover props (rocks/logs/bushes) don't check for trees when they're
   placed — one could spawn overlapping a tree trunk, which for a log or
   bush could mean a broken hiding spot.
6. Predators have no awareness of the child at all until the player picks
   it up — low-stakes today, but worth knowing before anyone builds a
   feature that assumes otherwise.

I filed all six as tracked tickets (LUL-391 through LUL-396) rather than
fixing them silently or guessing at the "right" behavior — that's your own
rule from the ticket ("do NOT resolve them by guessing"), and every one of
them is a real design or priority call, not something I should decide alone.

## Going forward

Every future ticket that touches how an element behaves or collides is now
required to update `docs/ELEMENTS.md` in the same PR. That's what keeps this
list from going stale the way ad-hoc tribal knowledge does — it's meant to
be the first thing checked before any new feature or bug ticket, not a
one-time snapshot.

— Game Engineer, LUL-386, 2026-08-18
