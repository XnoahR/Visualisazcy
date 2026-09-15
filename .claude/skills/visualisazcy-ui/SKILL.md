---
name: visualisazcy-ui
description: Design rules for the Visualisazcy app shell — layout regions, control grouping, the token set, and the specific mistakes already made here. Load before changing index.html, adding a control, or restyling any panel.
---

# Visualisazcy UI

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

## A handle you cannot see should not be grabbable

Section grips are offered only for the hovered section, matching what is drawn.
The first version hit-tested every section, so two adjacent ones fought over the
same corner and you resized the wrong one — with no way to tell, since the grip
you grabbed was never painted.

Whenever an affordance is drawn conditionally, gate its hit test on the same
condition.

## Depth cues need opacity, not subtlety

A folded group draws two cards peeking out behind it. The first version faded
them to a fifth and outlined them in the 5.5% card edge — on `#08090d` both
slivers vanished completely, and a folded group looked exactly like the node it
is not. They are now full opacity with a tone-tinted hairline.

On a dark palette, "behind" cannot be expressed by lowering alpha. It has to be
a visible edge.

## Scene coordinates are card widths, not points

A card is 168px wide and a folded group 193px. On a 902px frame that is ~0.19 of
the width, so two objects closer than 0.19 apart **overlap** — and `fit()` will
not save you, because it only shrinks a composition, never a free board.

The first pass of the microservices scene put the client, CDN and gateway at
0.05 / 0.14 / 0.27 and all three collided. Space from the box, then check.

## Anything positional needs a portrait variant

Nodes carry `portrait: [x, y]`. Groups shipped without one and 9:16 broke on the
first look: the loose nodes moved to their portrait coordinates while every
folded card stayed at its landscape x, and they collided.

Both layouts live on the one group object, resolved through `posOf(g, portrait)`,
and writes go back into whichever layout is on screen. Keeping them on a single
object is deliberate — a runtime/spec split is what you then have to keep in
step.

## A drag-only affordance is unreachable

Clicking an open group's title strip started a drag and nothing else, so the
group could never enter the selection — and the inspector is bound to the
selection, which meant there was no way to rename one. The strip now selects
*and* drags.

Any element whose only gesture is a drag cannot be inspected. If it has
properties, its gesture has to select as well.

## A derived box has no outside

A group's rectangle is the union of its members, so dragging one "out" only
stretches the box. There is no position that means *not in this group*, and
waiting for the user to find one is waiting forever.

When a container's geometry is derived from its contents, leaving has to be an
explicit action — a button and a shortcut — not a place you drag to.

## Spawn where the user is, and not on top of anything

`▢ Section` used a fixed rectangle at 0.3/0.28/0.4/0.44. On any populated board
that lands on existing objects, and because section membership is geometric it
adopts them silently — the next drag then hauls things nobody grouped.

It now wraps the selection when there is one, and otherwise takes the clear
patch **nearest the centre**. Scanning from a corner is predictable but puts the
result where nobody is looking.

## An allow-list of options is a silent trap

`node()` in scene.js copied five named fields and dropped everything else, so a
scene asking for `latency`, `concurrency`, `retry` or `breaker` got the type
default and was never told. Thirteen options across the built-in scenes were
being discarded, and a whole demo scene was configured with a circuit breaker
that did not exist.

A helper that constructs data should spread what it is given. If a field needs
checking, that is validate.js's job, where a wrong one produces a message.

## Put the word that matters first

Card text truncates from the end. `12 rps · slow` on a narrow card rendered as
`12 rps · sl…` and said nothing, so it is now `slow · 12 rps`.

For the same reason the short name is chosen by **measuring**, not by guessing at
a scale threshold: at S=1.02 "Message Broker" still did not fit a card with an
effect gauge and rendered as "Message…", because the old rule only swapped in the
short name below S=0.82.

## A chip on a wire needs a gap to sit in

Two cards 0.23 apart on a 902px frame leave about 35px of visible wire. A
`BREAKER OPEN` chip is 70px and lands on the card next to it. Labels on wires are
short (`OPEN`, `PROBE`, `async`) and offset perpendicular to the line, so even an
oversized one clears both ends.

## Space scenes by the card, not the point

A card is 168px wide, and a folded group 193px — about 0.19 of a 902px frame. Two
objects closer than that **overlap**, and `fit()` will not save you because it
only shrinks a composition, never a free board. Seven columns do not fit; the
sandbox had been overlapping in two places for exactly this reason.

## A single-file app is one namespace

`setStatus` already existed (for the JSON editor). A second one, added for the
ask panel, was a duplicate top-level declaration — a SyntaxError in a module, so
the **entire** inline script failed to run and nothing on the page was wired.
Prefix helpers by feature (`askStatus`), and grep for the name before adding a
function to index.html.

The static check that missed it used `new Function(script)`, which is sloppy
mode and tolerates duplicate declarations. Parse inline module scripts with
`vm.SourceTextModule` under `--experimental-vm-modules`; that is what the
browser does.

## `[hidden]` loses to any `display:` on a class

`.home-sec { display: flex }` beat the browser's own `[hidden] { display: none }`,
so an empty "Your boards" header stayed on screen with `hidden` set. Four other
elements had each been given their own `[hidden]` rule; this one was missed.

There is now one global `[hidden] { display: none !important }`. Do not add
per-element ones.

## When the MCP browsers are gone, drive one yourself

The Chrome extension can be attached to a browser on a different machine — it
returned `ERR_CONNECTION_REFUSED` for this machine's own loopback. Playwright's
MCP server was down the same session.

`~/.cache/ms-playwright/chromium_headless_shell-*/…/chrome-headless-shell` plus
`playwright-core` from the npx cache launch a real page from node in one file.
`page.route('https://api.anthropic.com/**', …)` mocks the model at the network
layer, so the whole UI path runs genuinely with no key and no spend.

Start the server with the sandbox disabled if a real browser has to reach it;
the sandboxed loopback is not the host's.

## A redraw replaces the element you just wrote to

The settings form is rebuilt from data on every change. "2 models" and
"ok · 16ms" were written to `#set-result` and then `persist()` rebuilt the
form, replacing that element with a blank one — the message existed for zero
frames. Same in the failure branch, which saved without redrawing at all, so
the red dot only appeared on the next unrelated change.

When a view is rebuilt from state: put the fact **in the state** (`lastTest`),
persist, redraw, and only then write any transient message — to the element
that now exists.

## "Configured" and "works" are different facts

A provider with a URL, a model and a key is configured. Whether it works is
something only a test can say. One green/grey dot conflated them and showed
green beside a provider whose key had just been rejected. Three states now:
grey (missing something), red (last test failed), green.

## In a single module, call order is declaration order

`showPage()` reads `PAGES`, a `const`. The first call to it sat in the ask
block, which is *above* the routing block that declares `PAGES` — so the page
threw "Cannot access 'PAGES' before initialization" and rendered nothing past
that line. A module script runs top to bottom; a `const` is in its temporal
dead zone until the line that declares it has run, however far below the
function that uses it.

Initial calls go at the bottom, after everything they touch. The module-mode
parse check cannot catch this one; only running the page can.

## An error that names what came back is the fix half the time

"The model returned something that was not JSON" told the user nothing and me
nothing. The message now carries the parse verdict (empty / cut off / not JSON),
the dialect it was asked in, the model, and the first 220 characters of the
answer. Most of those failures are then obvious from the message alone.

## One long page is a pile; four named pages is a place

The start screen stacked describe, start, saved boards and fourteen example
cards on one scroll. A left menu with four entries — each with a one-line
description — and the hash as the page made it navigable, linkable and
back-button-friendly. Boards and stories are listed apart because one is
something you edit and the other plays as a take.

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

The app exposes `window.__visualisazcy` for exactly this. Drive real gestures
(`PointerEvent`, `DragEvent`, `contextmenu`) rather than calling engine methods,
because the gap between the two is where the bugs have actually been: the `+`
handles were unusable for a whole session because hover was tested against the
card while the handles sat outside it.

Direct renderer calls take **canvas-relative** coordinates; dispatched events
take **client** coordinates. Mixing them produces a convincing false failure.
