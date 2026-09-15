# Groups — folding a microservice into one object

**Status:** built. This document was the requirement; the notes below record
what changed on contact with the code.

Run `node tests/groups.test.mjs` to check it still holds.

## The problem

> "there is api gateway then it will connect to many object... it will be pain
> because microservice has many object in it, and it will messy to look. How
> about we fold it? like group it — instead 10+ object, we fold it 1 object as
> perhaps 'SMS service' or 'cart service'."

A realistic microservice board is not one node per service. A cart service is an
API, a worker, a queue, a cache and a database — five objects, and that is a
small one. Three services and a gateway is twenty-odd cards and a wire tangle
where the interesting fact ("the gateway talks to three services") is the one
thing you cannot see.

The architecture diagram people actually draw has levels: services as boxes, and
the inside of one service when it matters. Visualisazcy currently has only the
innermost. **A group is a level**, and folding is how you move between them.

## What a group is

A named, explicit set of members that can be **folded** into a single card and
**unfolded** back. Folded, it is one object with one label — "Cart Service" —
and every wire that crossed its boundary now lands on that one card.

A member is a node **or another group**, so a Region can hold Services which
hold objects.

Folding is a **view operation**. It changes the picture and nothing else. The
nodes inside a folded group keep running, keep queueing, keep dropping and keep
being counted, exactly as they did when visible.

That is the most important property in this document, and
[§ The identity property](#the-identity-property) makes it testable.

## Decisions taken

| decision | choice | why |
|---|---|---|
| wiring to a folded card | **not in v1** — unfold to rewire | a `+` handle would have to guess which internal node the wire lands on |
| nesting | **allowed** — Region → Service → objects | large architectures have levels; one level would not reach them |
| sections | **kept**, alongside groups | they do a different job (see below) |

## Why this is not a section

Sections already draw a labelled rectangle around a group of nodes, so the
obvious move is `collapsed: true` on a section. That is wrong for three reasons,
and the third is fatal.

**1. Membership.** A section's membership is *geometric* — whatever currently
sits inside the rectangle. That is exactly right for a region label ("Edge",
"App tier") and exactly wrong for an encapsulation boundary. Dragging an
unrelated cache over the Cart Service rectangle must not make it part of the
cart service. A service is a *named set*, not a location.

**2. The rectangle's owner.** You draw and resize a section. A group's box is
*derived* — it follows its members, because the members are the definition. A
group has no resize gesture, and needs none.

**3. It cannot work.** `nodesIn()` filters on `!n.hidden`. Hide the members to
fold, and membership immediately evaluates to empty — the group forgets what it
contains at the instant it contains something worth remembering, and can never
unfold. Fixing that means freezing membership at fold time, which is explicit
membership with extra steps and a drift bug.

So: sections and groups are different objects that happen to both draw a
rectangle. Both stay. A section says *these things are near each other, here is
a name for the region*. A group says *these things are one thing*.

|  | Section | Group |
|---|---|---|
| membership | geometric, recomputed | explicit id list |
| rectangle | you draw and resize it | derived from members |
| nests | no | yes |
| folds | no | yes |
| affects the picture | tint and label | topology as drawn |
| affects the simulation | nothing | nothing |

## Architecture: the view graph

The design rests on one idea, and everything else falls out of it.

> The simulation runs on the **real graph**. Everything you see is drawn from a
> **view graph** derived from it.

```
real graph                        view graph, Region folded    Region open, Cart folded
  gateway                           gateway                      gateway
  cart_api cart_q cart_db     →     region  ×12          →       ┌ Region ─────────┐
  sms_api  sms_w                                                 │ cart ×5  sms ×2 │
  ...                                                            └─────────────────┘
```

Nesting is contained in **one function**:

```js
// The outermost folded ancestor — the card this thing is actually inside of.
// Walking to the top and keeping the last folded one is what makes a folded
// Region win over a folded Service inside it.
function proxyOf(id) {
  let out = null
  for (let g = parentOf(id); g; g = parentOf(g.id)) if (g.folded) out = g
  return out
}
```

`viewGraph(state)` then builds:

- **visible nodes** — those with no folded ancestor
- **proxy cards** — folded groups with no folded ancestor
- **open boxes** — unfolded groups with no folded ancestor
- **edges** — each end mapped through `proxyOf(id) ?? id`, then:
  - both ends equal → **dropped**, it is internal
  - crossing → **retargeted** to the proxy
  - same pair twice → **deduped** to one wire

`sim.js` never learns the word "fold". Which means:

- routing, queueing, capacity, percentiles, drops — untouched, so they cannot
  regress
- `autoLayout`, `stageEntrance`, `hitTest`, `paintWire`, `paintPacket` all
  consume the view graph and become correct for free
- a folded board auto-lays-out as nine cards instead of twenty-four, because
  layout is reading the level you are actually looking at

The cost of the feature is one derived function and a card painter, not a second
simulation.

## Data model

```js
groups: [
  {
    id: 'cart',
    label: 'Cart Service',
    children: ['cart_api', 'cart_worker', 'cart_q', 'cart_cache', 'cart_db'],
    folded: true,
    x: 0.62, y: 0.40,          // where the folded card sits at 16:9
    portrait: [0.5, 0.30],     // and where it sits when the canvas is taller
    tone: 'accent',            // optional, as sections
  },
  {
    id: 'region_eu',
    label: 'EU Region',
    children: ['cart', 'sms', 'ingress_lb'],   // groups and nodes may mix
    folded: false,
    x: 0.55, y: 0.45,
  },
]
```

`children` holds node ids and group ids in one list; the structure is a
**forest**, and validation enforces that (one parent, no cycles).

`x, y` belong to the group, not to any member — a folded card needs its own
position, and it must survive unfolding and refolding. Default on first fold:
the centroid of its visible members.

`portrait` is the same idea a node already carries: one scene, two aspects.
Groups shipped without it in the first pass and 9:16 broke immediately — the
loose nodes moved to their portrait coordinates while every service card stayed
at its landscape x, and the two collided. Both layouts live on the one group
object rather than in a runtime/spec pair, so there is nothing to drift.

Members keep their own `x, y` untouched while folded, so unfolding restores the
layout the author arranged rather than re-deriving one.

## Simulation

**Nothing changes.** No new physics, no aggregate node, no equivalent latency.

The tempting alternative is to collapse a group into one node with a derived
latency and concurrency — Little's Law makes that look natural. It is a lie for
anything but a straight chain: a fan-out to three servers has three times the
capacity of its slowest member, a cache with a hit rate short-circuits most
requests, and round-robin splits load in a way no single pair of numbers
reproduces. This project has repeatedly chosen the measured number over the
plausible one (capacity is derived, p50 excludes travel); an aggregate here
would undo that.

So the internals run, invisibly, and the card reports what they actually did.

### The identity property

Folding must not change a single number, **at any depth**.

```
run scene 10s fully unfolded      →  processed, dropped, p50, p99, per-node rps
run scene 10s services folded     →  identical
run scene 10s region folded       →  identical
```

Packets between two folded members still travel and still take their travel
time; they are simply not drawn. `inSystem` excludes travel already, so p50 and
p99 are untouched by definition.

This is the acceptance test. If it fails, the feature is wrong, not the test.

## The folded card

It must not look like a node, because it is not one — it opens.

```
   ┌──────────────────────────┐ ┐  two rectangles peek out behind,
  ┌┤  ×5   Cart Service       │ │  so "there is more in here" reads
 ┌┤│       42 rps             │ │  before you have read anything
 └┴┴──────────────────────────┘ ┘
  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░  worst-member utilisation
```

- **badge** — `×N`, the **transitive node count**, instead of a type icon. A
  folded Region holding three five-object services reads `×15`, because the
  question the badge answers is "how many objects are hidden in here"
- **label** — the group's name; this is the whole point of the feature
- **subtitle** — `N objects` at rest, measured `rps` into the group while running
- **meter** — the *worst* leaf utilisation, `max(rate / capacity)` over
  transitive members. Not an invented group capacity: this is measured, needs no
  aggregation theory, and answers the question you actually have — how close is
  this service to falling over
- **red border** — when any transitive member is overloaded
- **pulse** — the max member pulse, so internal traffic still registers

Width ×1.15 of a node card, so folded and unfolded objects are never mistaken
for each other at a glance.

## The open group

A solid-edged rounded rectangle around the members with a title strip,
distinguishable from a section's dashed edge. The strip carries the label and a
`–` chevron that folds it.

The box **follows its members**, and is computed **bottom-up**: innermost groups
first, then each parent pads ~18px past the union of its children's boxes and
cards. Computing outward in that order is what makes nested boxes nest visually
without a depth-scaled padding rule.

Crucially the box spans **visible** descendants — a folded child contributes its
*card*, not its hidden members. There is no resize gesture and no need for one.

## Gestures

| gesture | does | mode |
|---|---|---|
| `Ctrl/Cmd+G` on a selection | group them, prompt for a name | Edit |
| `Ctrl/Cmd+Shift+G` | ungroup one level; children stay put and keep their own structure | Edit |
| double-click a folded card | unfold one level | Edit |
| `–` chevron on the strip | fold | Edit |
| drag a folded card | moves the group **and** every transitive member by the same delta | Edit |
| right-click a folded card | remove the group and everything inside it | Edit |
| drag a member out of the box | nothing; membership is explicit | Edit |

A selection containing folded cards groups those *cards*, which is how you build
a Region from two Services — the nesting gesture is the same gesture.

Multi-select already exists (marquee, Edit mode), so `Ctrl+G` needs no new
selection machinery.

**Play mode does not fold or unfold.** A click already means "kill" there, and a
double-click would kill a card on its way to opening it. Fold state persists
into Play, which is what a presentation needs.

## Rules and edge cases

- **One parent, no cycles.** Every id appears in at most one `children` list,
  and a group may not contain one of its own ancestors. Enforced at creation and
  in validation.
- **No wiring while folded.** A `+` handle on a folded card would have to guess
  which internal node the wire lands on. Unfold to rewire.
- **An empty group is deleted**, not kept as a zero-member box.
- **Deleting a member** removes it from its parent's `children`. If that empties
  the group, the group goes too — recursively, so emptying a Service can remove
  the Region that held only it.
- **A group of one** is legal but pointless; the UI should not offer it.
- **Folded groups are excluded from `fit()`** collision shrinking as one box,
  not as N members — which is a large part of why folding fixes the "icons get
  tiny" complaint at all.
- **Off-frame members.** A group whose members straddle the export frame folds
  to a card at its own `x, y`, which may be inside the frame even when members
  are parked outside. That is correct and intended.

## Persistence, undo, validation

- `store.js` `strip()` carries `groups` — one line, same shape as `sections`.
- `sim.snapshot()`/`restore()` carry `groups`, so grouping, folding and nesting
  are undoable like everything else.
- `validate.js` gains: group needs `id` and `label`; every child must resolve to
  a known node or group; `children` non-empty; no id in two `children` lists; no
  cycle in the parent chain; a folded group needs numeric `x, y`; unknown `tone`
  rejected as elsewhere.
- Old scenes have no `groups` key and are unaffected.

## Acceptance criteria

1. **Identity.** A scene run 10s reports identical `processed`, `dropped`, p50,
   p99 and per-node rps in three states: fully open, services folded, region
   folded.
2. **Density.** The demo board is 20 objects in four services; folded it is 8
   cards, and no wire is drawn between two internal nodes. The test asserts
   24 → 11 → 8 on its own larger fixture.
3. **Dedupe.** A gateway wired to three nodes inside one service draws exactly
   one wire to the folded card, not three.
4. **Nested substitution.** With Region folded, `gateway → cart_api` draws one
   wire to the Region card. Unfold Region → it lands on the Cart card. Unfold
   Cart → it lands on `cart_api`.
5. **Nested box.** With Region open and Cart folded, the Region's rectangle
   encloses the Cart *card* and does not stretch to the cart's hidden members.
6. **Round trip.** Fold → save → reload → unfold restores every member to the
   position it had before folding, at every depth.
7. **Undo.** `Ctrl+G` then undo leaves the board byte-identical to before.
8. **Move.** Dragging a folded Region 0.1 right and unfolding twice puts every
   leaf node 0.1 right of where it was, relative positions preserved.
9. **Overload.** Overloading one leaf turns every folded ancestor card red and
   drives its meter to full.
10. **Cycles refused.** Adding a Region to one of its own descendants is
    rejected with a message, not a stack overflow.

## Out of scope for v1

- **Wiring to a folded group.** v2 rule: a group declares an `entry` node
  (defaulting to the member with inbound edges from outside); a wire dropped on
  a folded card lands there.
- **Group p50.** "How long does a request spend inside this service" is a real
  number and worth having. Mechanism: stamp `p.inSystem` when a packet crosses
  in, diff when it crosses out. Belongs in the inspector, not on the card.
- **Declared group facts.** Team, repo, SLO — `DECLARED` already exists and
  extends here naturally.
- **Fold depth limits.** No cap is imposed; nesting is bounded by validation
  (one parent, no cycles) rather than by an invented number.
- **Making room on unfold.** An open group needs more space than the card it
  replaced, and neighbours are not pushed aside — open one service on a tight
  board and its box will crowd the next. Four services cannot all be authored to
  open cleanly in one frame, which is the arithmetic that makes folding worth
  having; a "make room" pass would need its own design (does everything move
  back when you fold again?).

## Next, and cheap

**Timeline `expand`.** Steps are declarative full state, so a step gains
`expand: ['cart']` and the fold state becomes part of a story:

> three folded services fan out from a gateway → one unfolds to show that the
> cart service is a queue and a worker → the queue backs up.

That is the ten-second single-page video this app exists to make, and folding is
the last piece it was missing. It is roughly ten lines on top of v1.

## Build order

Each step leaves the app working, and the identity test can run from step 4.

| # | file | change |
|---|---|---|
| 1 | `src/groups.js` *(new)* | `parentOf`, `proxyOf`, `descendantsOf`, `viewGraph(state)`, `boxesOf` — pure functions over state, no rendering, no simulation |
| 2 | `src/sim.js` | `state.groups`, `addGroup`/`removeGroup`/`setFolded`/`moveGroup`; `snapshot`/`restore`/`syncScene` carry groups. **No change to `arrive`, `route`, `serviceNodes`, `step`.** |
| 3 | `src/validate.js` | the eight group rules |
| 4 | *test* | identity: same scene, three fold states, compare stats — before any pixels are drawn |
| 5 | `src/render.js` | `drawGraph` consumes `viewGraph`; `paintGroupCard`, `paintGroupBox`; `hitTest` and `hoverTargetAt` over the view graph |
| 6 | `src/engine.js` | `Ctrl+G`, `Ctrl+Shift+G`, double-click, chevron hit test, group drag |
| 7 | `index.html` | a Group button beside `▢ Section`, and the shortcut in the help panel |
| 8 | `src/store.js` | `strip()` carries `groups` |
| 9 | `README.md`, `SKILL.md` | document what shipped |

All nine landed. Two things the plan did not predict:

- **`restore()` was already broken.** Writing `found.capacity` throws, because
  capacity became a derived getter — so undo has been failing on any board where
  a node survived the undo, since well before this feature. The identity test
  walked straight into it.
- **Portrait needed a group variant**, above.

Step 1 is where the feature actually lives. If `viewGraph` is right, steps 5–7
are mechanical; if it is wrong, no amount of careful painting will save them.
