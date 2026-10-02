# Style guide — notes / action-prompt pills

Standing style guide for the bottom-center "note" pills the player reads during
play (`components/ActionPrompt.tsx`, rendered as rows in `#actionSlot`,
`components/Hud.tsx:1072`) -- "Press  H  to hide in the bush", "Press  E  to
lift the child", the hidden/hunted status line, and every pill that follows
this pattern in the future.

Decision record: wiki `decisions/lul-5771-note-style-green-standard`
(LUL-5771, player-facing request). LUL-5772 is the implementation.

## The one approved palette

One family, drawn from the already-shipped hint-caption look
(`#hintCaption`/`#scentTrailCaption`, `components/GameCanvas.tsx`) rather than
inventing a third color scheme. All values are the `--action-pill-*` custom
properties declared once in `components/GameCanvas.tsx`'s `OVERLAY_STYLE`
(inside the top-level `html, body { ... }` rule) and consumed by
`.actionPromptLine`/`.actionPromptKey` further down the same file.

| Token | Value | Used for |
|---|---|---|
| `--action-pill-bg` | `rgba(18,34,34,0.6)` | Pill background, every tone (matches `#hintCaption`'s background exactly) |
| `--action-pill-border-calm` | `rgba(159,224,208,0.22)` | Border, `calm` tone — dim weight, ambient/ever-present prompts |
| `--action-pill-border-ready` | `rgba(159,224,208,0.6)` | Border, `ready`/`urgent` tone — brighter weight, same teal hue as calm |
| `--action-pill-border-status` | `rgba(120,200,150,0.4)` | Border, `status` tone (hidden/hunted line) — kept as its own already-green hue, unchanged by this pass |
| `--action-pill-color-calm` | `#9bc9bd` | Text, `calm` tone — muted teal |
| `--action-pill-color-ready` | `#cdf3e8` | Text, `ready`/`urgent` tone — the hint caption's own text color, full brightness |
| `--action-pill-color-status` | `#9fd7b0` | Text, `status` tone — unchanged |
| `--action-pill-key-bg` | `#bdeedb` | Keycap chip background |
| `--action-pill-key-color` | `#07211a` | Keycap chip text |
| `--action-pill-key-shadow` | `0 2px 20px rgba(159,224,208,0.6)` | Keycap chip glow |

**The one explicit exception:** `--action-pill-urgent-bg` (`#e8554a`) and
`--action-pill-urgent-shadow` (`0 2px 26px rgba(232,85,74,0.85)`) stay red.
The `urgent` tone's keycap flash (`urgentFlash` keyframes,
`components/GameCanvas.tsx`; `REDUCED_MOTION_URGENT_KEY_STYLE`,
`components/ActionPrompt.tsx`) is an "act now" safety signal, not decorative —
the row's own text/border still use the shared `ready` teal, only the keycap
glow escalates to red. This was flagged as an open call in the decision doc,
not unilaterally decided; if a future pass wants to revisit it, say so in that
PR, don't change it silently.

`disabled` tone (`--action-pill-*-disabled`, grayscale, LUL-5004) is a
separate semantic — "visible but not currently actionable" — and is untouched
by this palette; it's deliberately outside the green family so a grayed row
still reads as grayed.

High-contrast mode (`body[data-high-contrast="1"]`, same file) gets its own
override values so it stays at least as distinct as the base palette: `ready`
moves to `#eafff8` / border `#9fe0d0` (bright teal-mint), `urgent` stays red
(`#ff9f9f` / `#ff6b6b`, same exception as base), `status` is unchanged
(`#baffcf` / `#6fe89a`, already green and already distinct from the new teal
`ready`).

## The font plate

Already in use at `components/GameCanvas.tsx`'s `.actionPromptLine`/
`.actionPromptKey` rules — restated here as the standard, not reinvented:

- Pill text (`.actionPromptLine`): `font-size: 13px; letter-spacing: 0.03em;`
- Keycap chip (`.actionPromptKey`): `font-size: 15px; font-weight: 600; letter-spacing: 0.08em; padding: 5px 14px; border-radius: 8px;`
- Pill shape (`.actionPromptLine`): `padding: 7px 16px; border-radius: 999px; backdrop-filter: blur(8px);`
- Transitions: opacity-only, 150ms fade-in on mount, no exit transition, no scale/bounce (LUL-2312 rule 4) — `urgent`'s keycap flash is the only animated state, and it animates `background`/`box-shadow` only, never `transform`.

## The rule

Every future "note" / action-prompt row reuses these tokens. Don't introduce
a new color literal for a new row or a new tone — pick the closest existing
tone (`calm`/`ready`/`urgent`/`status`/`disabled`) or extend this table in the
same PR that adds a genuinely new tone, so the next feature doesn't reinvent a
third palette the way the original tan/peach pills did.

This mirrors `components/ActionPrompt.tsx:1-16`'s own rationale for being "one
component" for every pill (replacing five independently-styled, independently
positioned predecessors, LUL-2312): the same reasoning that justifies one
component justifies one palette. A second color scheme for a new pill is the
same class of drift LUL-2312 already fixed once, just in CSS instead of JSX.
