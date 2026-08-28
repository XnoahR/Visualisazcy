# Visualizcy

System diagrams that actually run. Nodes have capacity, traffic flows as discrete
packets, and when you overload or kill something the diagram shows you what breaks.

Vanilla JS, canvas 2D, zero dependencies, no build step.

![16:9](docs/landscape.png)

The same scene at 9:16, from the same data:

<img src="docs/portrait.png" width="300">

## Run it

```bash
cd Visualizcy
python3 -m http.server 8123
# open http://localhost:8123
```

A server is required because the code uses ES modules; `file://` will not work.

## The model

Three mechanics carry the whole thing:

**1. Sources emit on a rate accumulator.** A node with `role: 'source'` adds `dt`
to an accumulator and emits one packet per `1000/rps` milliseconds. Rate stays
exact regardless of frame timing.

**2. A packet is a progress value.** Each packet holds `progress` from 0 to 1
along one edge, plus a `trail` of the nodes it has passed. At 1 it arrives.
Position on screen is a lerp between the two card edges. No physics.

**3. A 1-second sliding window is what "overloaded" means.** Every node keeps
`rxLog`, the timestamps of recent arrivals. Because the window is exactly one
second, `rxLog.length` *is* the node's current rps. Compare it to `capacity`:
over the line, the node turns red and drops.

Requests travel forward and turn into responses at a `sink`, which retrace the
trail back to the source. Only requests consume capacity — responses are work
already paid for, so counting them would double every meter.

Routers fan out **round robin** via `rrIdx++ % outs.length`. That single line is
the entire load-balancing behaviour.

## Layout: fractions, never pixels

Node positions are fractions of the canvas (`0.42, 0.5`), so one scene renders at
16:9, 1:1 and 9:16 without being rebuilt. A node may also carry a `portrait`
position used when the canvas is taller than wide:

```js
n('lb', 'lb', 0.42, 0.5, { portrait: [0.5, 0.34] })
```

This is what makes the same source material work for a wide diagram and a vertical
video without duplicating anything.

## Motion

Simulation state is exact; presentation state is damped separately in
`advanceAnim`, which runs every frame whether or not the sim is running. Easing
therefore never distorts the numbers it is smoothing — a paused scene still
finishes its entrance, and a meter keeps settling after you hit pause.

- **Entrances run in flow order.** A BFS from the sources assigns each node a
  depth, and depth becomes the stagger delay. Reading the diagram and watching it
  build are the same motion. Cards rise, overshoot slightly (`easeOutBack`), settle.
- **Wires draw themselves only as far as both endpoints have arrived**, so the
  topology assembles rather than snapping into place.
- **`damp()` is the workhorse.** Frame-rate independent exponential smoothing,
  used for the displayed rps and for the overload blend. Measured on the load
  balancer scene, it cuts frame-to-frame meter jitter from 0.385 to 0.084 while
  holding the mean (23.55 raw vs 23.37 displayed).
- **Packet position stays linear.** This is a stream; easing each dot would make
  the flow clump at the ends. Only size and glow ease, and only near the cards.

## Timelines

A scene with a `steps` array becomes a story with frame chrome: step label and
narration top-left, author top-right, section bottom-left, `n / total` bottom-right.

Each step declares the **full** state it wants — visible nodes, live edges, who is
sending, what is dead — not a delta from the step before. Any step is therefore
reachable directly, and stepping to it by playing through, jumping forward, or
walking backwards all produce byte-identical state. That property is what makes
deterministic frame-by-frame video export possible later.

```js
{
  label: 'Traffic triples',
  note: 'Same server, seventy requests a second arriving.',
  duration: 4600,
  show: ['client', 's1'],          // everything else is hidden
  edges: ['client>s1'],            // everything else is muted
  traffic: { client: 70 },         // sources not named here fall silent
  dead: ['s2'],                    // optional
  clearPackets: true,              // optional, for a hard cut
}
```

`edges` matters more than it looks: without it a client wired to two future
routes would quietly split its traffic down a path the story has not introduced.

See `scaleStory` in `scenes/index.js` for a six-step example.

![timeline](docs/timeline.png)

## Interaction

- **Drag a node** to move it. Positions stay fractional, so the drag writes back
  into the scene spec for whichever layout is on screen — rearrange at 9:16 and
  the 16:9 layout is untouched.
- **Click without dragging** to kill a node. One gesture, two meanings, split by
  a 4px threshold so a shaky click still reads as a click.
- **⧉** copies the current positions as scene data, ready to paste back into
  `scenes/index.js`. Drag to compose, copy, commit.

## Fitting any aspect

Scale is driven by width, not `min(W, H)` — cards are wide, so horizontal room is
what constrains them. Then `fit()` walks every visible pair and shrinks until
nothing collides, because how much room a layout really has is only knowable once
the canvas is sized. Measured on the load balancer scene:

| Aspect | Canvas | Scale | Card | Tightest clearance |
|---|---|---|---|---|
| 16:9 | 904x508 | 1.03 | 173px | 78px |
| 1:1  | 618x618 | 0.70 | 118px | 67px |
| 9:16 | 378x674 | 0.88 | 148px | 40px |

## Add a scene

`scenes/index.js`:

```js
export const mine = scene({
  id: 'mine',
  title: 'Short imperative title',
  caption: 'One line telling the viewer what to watch for.',
  nodes: [
    n('client', 'client', 0.15, 0.5, { rps: 40, portrait: [0.5, 0.12] }),
    n('srv',    'server', 0.55, 0.5, { role: 'router' }),
    n('db',     'db',     0.85, 0.5, { capacity: 25 }),
  ],
  edges: [e('client', 'srv'), e('srv', 'db')],
})
```

Then add it to the `SCENES` array. Per-node options: `rps`, `capacity`, `label`,
`role`, `portrait`. `role` matters because an App Server is a sink in one topology
and a router in another.

## Add a node type

`src/registry.js`. Four fields do the work:

```js
gateway: {
  name: 'API Gateway', subtitle: 'Entry point', icon: 'GW',
  color: '#f97316', role: 'router', capacity: 3000,
  hint: 'Terminates TLS and routes by path',
},
```

## Theming

Every colour, font and card dimension lives in `src/theme.js`. Nothing else
hardcodes a colour, so a rebrand is one file.

## Files

```
src/theme.js      design tokens and card geometry
src/ease.js       easing curves and the damp() smoother
src/registry.js   node types: role, capacity, colour, icon
src/scene.js      scene spec helpers and fractional placement
src/sim.js        the simulation plus presentation state
src/timeline.js   step sequencing for story scenes
src/render.js     canvas 2D renderer
src/engine.js     rAF loop, resize, click-to-kill
scenes/index.js   the demo scenes
index.html        demo harness
```

## Not in here yet

Deliberately left out of v1, in rough order of usefulness:

- **Cache hit ratio.** A `hitRate` on cache nodes so a hit short-circuits back
  instead of forwarding to the database. This is the one that unlocks a whole
  category of scenes.
- **Latency per node.** Packets currently travel at constant speed; per-node
  service time would let slow databases actually look slow.
- **Retries, backoff, circuit breaker.** All expressible on top of the trail that
  packets already carry.
- **Video export.** Headless render to frames, then a scene spec becomes an MP4
  without screen recording. Timelines are already deterministic, so this is
  mostly plumbing.
- **Illustration assets.** Phones, buildings, maps as inline SVG placed into a
  scene. The reference work leans on these heavily; they are static art, not
  another engine.
- **Read/write packet kinds.** Needed before a primary/replica scene teaches
  anything beyond fan-out.
