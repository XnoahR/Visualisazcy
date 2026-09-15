# AGENTS.md

Instructions for any AI agent working in this repository. Read this before
touching code; read `.claude/skills/visualisazcy-ui/SKILL.md` before touching
`index.html`.

## What this is

Visualisazcy draws system-architecture diagrams that **run**. Objects have
capacity, traffic flows as discrete packets, and overloading or killing
something shows what breaks. It exports the result as a short video. Vanilla
JS, canvas 2D, ~8,400 lines, one HTML file for the shell.

`README.md` is the long-form explanation of every decision. `BRIEF.md` is the
two-minute version. `docs/` has the design notes for the larger features.

## Non-negotiables

These are the rules the codebase is built on. Breaking one is a design change,
not a refactor, and needs the owner's say-so.

1. **Zero dependencies, no build step.** `python3 -m http.server` serves it.
   No npm, no bundler, no SDK — the Anthropic call is a raw `fetch` for exactly
   this reason. If a feature needs a library, say so and stop.
2. **Positions are fractions of the frame, never pixels.** `0..1` is the
   export frame; the board runs `-1.5..2.5`. Card geometry lives in
   `src/theme.js`; a card is ~0.19 of a 16:9 frame wide, and two objects
   closer than that on the same row **overlap**.
3. **Capacity is derived, never declared.** `throughput = concurrency ÷ latency`
   (Little's Law). Nothing an author types can contradict it. The one
   exception is a rate limiter's `rateLimit`, which is a policy on top.
4. **Folding changes no number.** Groups are a view on the real graph;
   `sim.js` never learns the word "fold". `tests/groups.test.mjs` asserts
   identical stats at three fold depths. If a change breaks that test, the
   change is wrong.
5. **`validate.js` is the contract.** A scene is data. Anything that produces
   one — a person, a file, a model — goes through `validateScene`, and every
   error names the path and says what would fix it. Add a rule there before
   relying on it anywhere else.
6. **Colours come from `src/theme.js`**, and the CSS in `index.html` mirrors it.
   If they disagree, `theme.js` wins. Contrast is measured against `--card`,
   not eyeballed (`#5a5f74` looked fine and measured 2.84:1).
7. **A refused request tells its caller.** Drops fail back as errors. This is
   what lets overload trip a circuit breaker; do not reintroduce silent drops.
8. **Keys never touch source, scenes or saved boards.** Provider keys live in
   `localStorage` under `visualisazcy:ai` and go only to their provider's base
   URL. Never log one, never put a placeholder that looks like one in a file.

## Where things live

| file | owns |
|---|---|
| `src/registry.js` | the 25 object types, `capacityOf`, appearance and policy resolvers |
| `src/sim.js` | the simulation: admission → service → completion, retry, breaker, async hand-off, groups, sections, undo snapshots |
| `src/groups.js` | the view graph: `proxyOf` (outermost folded ancestor), edge substitution, folded-card measurements |
| `src/render.js` | canvas painting, camera, hit tests, snapping, group boxes and cards |
| `src/engine.js` | modes (Edit/Play), gestures, selection, undo, export stepping |
| `src/scene.js` | authoring helpers (`node`, `edge`, `group`, `section`, `scene`) — they spread every option through |
| `src/validate.js` | every rule a scene must satisfy |
| `src/timeline.js` | declarative steps: full state per step, deterministic seeking |
| `src/annotate.js` | callouts, stats, bars, brackets, notes |
| `src/export.js` | `captureStream(0)` frame-exact video |
| `src/store.js` | saved boards in `localStorage`, every call guarded |
| `src/ai.js` | system prompt built from the registry, JSON schema, the validate-and-retry loop |
| `src/providers.js` | provider config, presets, the two protocols (Anthropic Messages / OpenAI chat), test and list-models |
| `src/renderers/` | other scene kinds (`slots`, `trace`) via `registerRenderer` |
| `scenes/index.js` | the built-in scenes; `microservices`, `retryStorm`, `insideOne` are the reference examples |
| `index.html` | the whole shell: markup, CSS, and one module script |
| `tests/*.test.mjs` | headless suites; no framework, `node tests/x.test.mjs` |

## Run and verify

```bash
python3 -m http.server 8123          # then http://localhost:8123 — a server is required (ES modules)
node tests/groups.test.mjs           # 49 checks: folding identity, view graph, mutations
node tests/resilience.test.mjs       # 27 checks: failure, retry, breaker, async, read/write, lag
node tests/ai.test.mjs               # 59 checks: prompt, schema, both protocols, fallback, migration
```

Every scene must validate: `node -e` over `validateAll(SCENES)` should report
`0 errors, 0 warnings`. The suites run before any pixels are painted; **write
the headless test first**, then the UI.

For the UI, drive a real browser. `window.__visualisazcy` exposes the engine.
Dispatch real `PointerEvent`s and `DragEvent`s — the gap between a gesture and
an engine call is where the bugs have actually been. Renderer functions take
**canvas-relative** coordinates; dispatched events take **client** coordinates;
mixing them produces a convincing false failure. If no MCP browser is
available, `~/.cache/ms-playwright/chromium_headless_shell-*/…` plus
`playwright-core` from the npx cache launches one from node;
`page.route('https://api.anthropic.com/**', …)` mocks the model with no key and
no spend.

Parse `index.html`'s inline script with `vm.SourceTextModule` under
`--experimental-vm-modules`, not `new Function` — the latter is sloppy mode and
misses duplicate declarations that kill the whole page.

## How to add things

- **An object type**: one entry in `NODE_TYPES`. It appears in the palette,
  validates, and simulates with no other change. Give it `short` if the name
  will not fit a card.
- **A scene**: `scenes/index.js`, using the helpers. Space objects by the
  card, not the point (columns ≥0.20 apart, rows ≥0.14). Give it `portrait`
  coordinates. Check it at 16:9, 1:1 and 9:16 — portrait is where this app
  breaks first, every time.
- **A scene kind**: `registerRenderer(kind, fn)`; see `src/renderers/trace.js`.
- **A provider preset**: `PRESETS` in `src/providers.js`. Base URL and hint
  only; no key, and no model ids you are not sure of — "Fetch models" asks the
  server.
- **A control**: decide its toolbar group first; if it fits none, the grouping
  is wrong. Give it `title`, `aria-label`, and a label unless the glyph is
  conventional. Then `engine.resize()` on the next frame if it changes the
  frame's box.

## Conventions

- **Comments explain why, and what went wrong.** The code carries the history
  of its own mistakes ("a 25ms job measured as 33ms, and throughput landed at
  27/s instead of 40"). Write new comments in that voice; delete none.
- **Measure, do not look.** Every claim about behaviour in this repo was
  checked with a number — rps, ms, pixel gap, contrast ratio. A screenshot that
  looks right is not evidence that it is.
- **Put the important word first** in card text; truncation cuts the end.
- **Anything positional needs a portrait variant.** Nodes and groups both carry
  `portrait: [x, y]`.
- **A drawn affordance and its hit test share the same condition.** If a handle
  is painted only on hover, it is grabbable only on hover.
- **Errors name what came back.** A model that "returned something that was not
  JSON" is a useless message; "reasoned out loud and never wrote the JSON (text
  mode via DeepSeek V4 Flash; finish=stop): «The user wants…»" is the fix half
  the time.
- **Prefix helpers by feature** in `index.html` (`askStatus`, not `setStatus`).
  It is one module; a duplicate top-level declaration is a SyntaxError that
  silently un-wires the entire page.

## Do not

- Add a dependency, a bundler, or a framework.
- Declare a capacity, a group throughput, or any other number the simulation
  can derive.
- Cache the view graph across frames; it goes stale the moment a node is added.
- Use `prompt()`, `alert()` or `confirm()` — they block the page and the
  browser tools that test it.
- Commit or push unless asked. `main` is the working branch; every commit so
  far went there directly.
- Commit `.playwright-mcp/`, `docs/reference/`, or the generated
  `design/visualisazcy-app.html` — all are ignored for a reason.

## Owner

XnoahR. Indonesian and English both fine. Prefers to be shown the number over
being told it is fine, and to be asked before anything outward-facing.
