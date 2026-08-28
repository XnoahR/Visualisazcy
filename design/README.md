# App mockups

Four artboards for the full application, at 1440×900.

| | |
|---|---|
| `Main.dc.html` | Board — palette, canvas, collapsed inspector |
| `Inspector.dc.html` | An object selected: properties, wiring, hit rate, connections |
| `Story.dc.html` | Story mode — composed frame, step inspector, timeline strip |
| `Export.dc.html` | Export framing — crop overlay per aspect, output options |

## Look at them

Open `mockup.html` in any browser. No server, no build, no login — the only
external reference is Google Fonts, which falls back cleanly offline.

## Change them

Edit the `.dc.html` artboards, then:

```bash
node design/build-local.mjs      # rebuilds mockup.html from the four artboards
```

The artboards are the single source; `mockup.html` is generated and should not
be edited directly.

## Fidelity

Values are lifted from the running code, not approximated:

- tokens from `src/theme.js`
- card anatomy from `src/render.js` at scale 1 — 168×62, radius 12, 34px badge
  at radius 9, 3px meter inset 12
- type colours, icons and short names from `src/registry.js`

## Not built yet

Three things in these mockups do not exist in the app. They are drawn as
proposals, not documentation:

- **The inspector.** Node properties are only editable as JSON today.
- **Story mode as its own screen.** Timelines run, but there is no step editor.
- **Export.** Nothing renders to a file yet. It is drawn because timelines are
  already deterministic, which is the hard prerequisite for frame-sequence
  render.
