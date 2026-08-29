---
name: visualizcy-ui
description: Design rules for the Visualizcy app shell — layout regions, control grouping, the token set, and the specific mistakes already made here. Load before changing index.html, adding a control, or restyling any panel.
---

# Visualizcy UI

The app shell is `index.html` alone: markup, styles and wiring in one file. The
engine (`src/`) never knows about the UI, and the UI never reaches into engine
internals beyond the documented API. Keep that line.

## Tokens are not optional

Every colour comes from `src/theme.js`. The CSS mirrors it in `:root`; if the two
ever disagree, `theme.js` wins and the CSS is the bug.

```
--bg #08090d   --card #14171f   --edge rgba(255,255,255,.055)
--edge-hi rgba(255,255,255,.13)
--text #f5f6fa   --dim #9498ab   --mute #5a5f74
--accent #6ea0ff   --good #6ee7b7   --warn #fcd34d   --bad #fca5a5
display: Space Grotesk    mono: JetBrains Mono
```

Border at 5.5% opacity is deliberate and easy to get wrong — a brighter border
is the fastest way to make this look cheap. Panels are `--card` on `--bg`, never
a third surface colour.

## Layout regions

Four regions, fixed roles. Do not invent a fifth.

```
┌ toolbar ───────────────────────────────────────────┐
│ identity │ transport │ history │ tools │ … │ output │
├──────────┬──────────────────────────┬──────────────┤
│ palette  │        stage             │   context    │
│  (left)  │      (the canvas)        │   (right)    │
├──────────┴──────────────────────────┴──────────────┤
│ timeline strip — only when the scene has steps      │
└─────────────────────────────────────────────────────┘
```

- **Toolbar** — verbs. Things you do to the whole board.
- **Palette (left)** — nouns. Things you drag onto the board. Generated from
  `registry.js`; never hand-list types.
- **Stage** — gets every pixel the other three do not need.
- **Context (right)** — what is loaded and what it is doing right now.
- **Timeline** — hidden entirely for scenes without steps. An empty strip is
  worse than no strip.

## Controls

**Group by verb, separate with a rule.** Transport, history, tools and output are
four groups, not eleven adjacent buttons.

**A glyph alone is not a control.** `⧉ ✎ ▢ ↶ ↷ ⏺` told the user nothing — that is
a real complaint this app already received. Every control carries a `title`, and
anything not universally understood carries a visible label. Play, Reset and
Record earn words; undo/redo arrows may stay bare because the arrows are
conventional.

**Destructive and irreversible controls never sit next to routine ones.** Record
writes a file; keep it in the output group at the far end.

## Sizing the canvas

Never pin the frame to a hardcoded width. `max-width: 380px` on the 9:16 frame
gave every renderer a third of the room it was designed for, and made both the
portrait scenes and the size control look broken. That was one bug wearing two
disguises.

Size from the height available and derive width from `aspect-ratio`:

```css
.frame { aspect-ratio: var(--ar); height: calc(100% * var(--zoom, 1)); width: auto; }
```

The stage scrolls when `--zoom` exceeds 1, so "bigger" genuinely means bigger.

After any change to the frame's box, call `engine.resize()` on the next frame —
the renderer caches `W`, `H` and the fit scale, and will not notice otherwise.

## Contrast is measured, not judged

`--mute` was `#5a5f74` and measured **2.84:1 on `--card`** — a fail, at the
8.5-13.5px sizes it was actually used for. It is now `#8087a0`: 5.03 on card,
5.45 on panel, 5.58 on bg.

Before shipping a text colour, compute it against the darkest surface it lands
on, which here is `--card` and not `--bg`. Eyeballing a dark palette does not
work; every one of these looked fine.

Icon-only controls carry `aria-label`, not only `title`. Focus is an explicit
`:focus-visible` ring — the browser default is close to invisible on `#08090d`.

## Cards are buttons, and buttons carry baggage

`.tpl` and `.start-card` are `<button>`s, so they inherit the toolbar button
base — including `white-space: nowrap` and `align-items: center`, both correct
for a one-line control and both wrong for a card. Nowrap made every start-screen
description render 365px wide inside a 287px card and collide with its
neighbour; centring silently overrode `text-align: left`.

Reset `white-space` and `align-items` explicitly on anything that borrows the
button base for a non-button.

## The camera is not the export frame

They are separate things and conflating them caused two bugs at once. The
resting camera sits at `0.78` so there is visible board around the frame —
at zoom 1 the canvas *was* the frame, which is why placing anything outside it
felt walled off. And `beginExport()` pins the camera to the frame and restores
it afterwards, because otherwise panning before pressing record silently changed
what the video contained.

## Modes own gestures

Edit and Play exist because one click cannot mean both "select" and "kill".
Before adding any gesture, decide which mode owns it, and check it does not
already belong to the other. Empty-space drag is selection in Edit and panning
in Play; panning in Edit moved to space-and-drag.

## Panels

Each panel is one job with one `.lbl` heading. When a panel needs a second
heading it is two panels.

Order by how often it is touched, not by how it was built.

And before adding a panel, check the start screen does not already carry it. A
scene list lived in the right rail for a while duplicating the one on the start
screen, which cost a panel of reading for nothing.

## Adding a control

1. Decide its group. If it fits none, the grouping is wrong, not the control.
2. Give it an id, a `title`, and a label unless the glyph is conventional.
3. Wire it in the script block near its siblings.
4. If it changes the frame's geometry, `requestAnimationFrame(() => engine.resize())`.
5. Check it at 16:9, 1:1 and 9:16 before calling it done — portrait is where
   this app breaks first, every time.

## Verifying

The app exposes `window.__visualizcy` for exactly this. Drive real gestures
(`PointerEvent`, `DragEvent`, `contextmenu`) rather than calling engine methods,
because the gap between the two is where the bugs have actually been: the `+`
handles were unusable for a whole session because hover was tested against the
card while the handles sat outside it.

Direct renderer calls take **canvas-relative** coordinates; dispatched events
take **client** coordinates. Mixing them produces a convincing false failure.
