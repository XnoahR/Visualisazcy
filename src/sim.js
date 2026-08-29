// The simulation. Three mechanics and nothing else:
//
//   1. sources emit packets on a rate accumulator
//   2. a packet is a progress value from 0 to 1 along one edge
//   3. every node keeps a 1s sliding window of arrivals; window vs capacity
//      is what "overloaded" means, and overloaded nodes drop
//
// Simulation state is exact. Presentation state (entrances, pulses, the value
// the meters actually display) is damped separately in advanceAnim, so easing
// never distorts the numbers it is smoothing.

import { typeOf, roleOf, connectionError, NODE_TYPES, capacityOf,
         failureOf, retryOf, breakerOf, acceptsOf,
         DEGRADE_LATENCY, DEGRADE_FAILURE } from './registry.js'
import { placement, WORLD_MIN, WORLD_MAX } from './scene.js'
import { groupById, parentOf, leavesOf, subgroupsOf, childItemsOf, posOf as groupPos } from './groups.js'
import { damp, clamp01 } from './ease.js'

const WINDOW = 1000        // ms; equal to 1s so rxLog.length reads as rps
const DEFAULT_RPS = 6
const SPEED = 0.55         // fractions of the canvas travelled per second
const ENTER_MS = 460       // card entrance duration
const EXIT_MS = 280        // and its way out; shorter, because leaving should not linger
const ENTER_STEP = 105     // stagger between successive hops
const RATE_LAMBDA = 5.5    // how hard the displayed rps chases the measured one

export function createSim(sceneDef, opts = {}) {
  const state = {
    scene: sceneDef,
    nodes: [],
    edges: [],
    sections: [],
    groups: [],
    packets: [],
    running: false,
    time: 0,        // simulation clock; only advances while running
    animTime: 0,    // presentation clock; always advances
    portrait: !!opts.portrait,
    stats: { processed: 0, dropped: 0, overloaded: 0, hits: 0,
             errors: 0, failed: 0, retries: 0, jobs: 0, tripped: 0 },
    latencies: [],
  }

  let seq = 0

  // One place that knows how to turn a spec into a runtime node, so a node
  // dropped from the palette is identical to one that came from a scene file.
  function makeNode(n) {
      const at = placement(n, state.portrait)
      return {
        id: n.id,
        type: n.type,
        spec: n,
        x: at.x,
        y: at.y,
        rps: n.rps ?? DEFAULT_RPS,
        get capacity() { return capacityOf(this) },
        label: n.label ?? typeOf(n).name,
        rxLog: [],
        overloaded: false,
        dead: false,
        degraded: false,   // answering, slowly and badly — the failure that actually happens
        hidden: false,
        spawnAccum: 0,
        rrIdx: 0,
        // presentation only
        appearAt: 0,      // animTime at which this card starts entering
        exitAt: null,     // and at which it starts leaving, if it does
        pulse: 0,         // 1 on arrival, decays
        showRate: 0,      // damped rps, what the meter and label actually show
        hot: 0,           // damped 0..1 overload blend, so the red fades in
        dim: 0,           // damped 0..1; 1 means a step has focus elsewhere
        dimTarget: 0,
        // per-type behaviour
        tokens: typeOf(n).burst ?? 0,   // rate limiter bucket
        inService: [],                  // { p, doneAt } currently being served
        queue: [],                      // waiting their turn
        hits: 0, misses: 0,             // cache
        failures: 0,                    // calls this node refused or fumbled
        pending: [],                    // retries waiting out a backoff
        breakers: new Map(),            // one per downstream, keyed by node id
      }
  }

  function load(def = state.scene) {
    state.scene = def
    state.nodes = (def.nodes || []).map(makeNode)
    state.edges = (def.edges || []).map(e => ({ ...e, off: false }))
    state.sections = (def.sections || []).map(x => ({ ...x, spec: x }))
    // A group object IS its spec. Sections keep a separate `spec` and write
    // through to it; groups have no portrait variant and no derived runtime
    // fields, so one object cannot drift from the other.
    state.groups = (def.groups || []).map(g => ({ ...g, children: [...(g.children || [])] }))
    reset()
    stageEntrance(state.animTime)
  }

  // Drop a new node onto the board. It is written into the scene as well as the
  // running state, so the sandbox editor and a copied layout both see it.
  function addNode(type, x, y) {
    if (!NODE_TYPES[type]) return null
    let id = type, i = 1
    while (byId(id)) id = `${type}${++i}`
    const spec = { id, type, x: clamp01(x), y: clamp01(y) }
    state.scene.nodes.push(spec)
    const node = makeNode(spec)
    node.appearAt = state.animTime
    state.nodes.push(node)
    return node
  }

  // --- latency percentiles ---------------------------------------------------
  // Queueing is what makes these worth having: without it every request took
  // exactly as long as the wire, and a percentile said nothing.
  const SAMPLES = 400
  function recordLatency(ms) {
    const a = state.latencies
    a.push(ms)
    if (a.length > SAMPLES) a.shift()
  }

  function percentile(p) {
    const a = state.latencies
    if (!a.length) return 0
    const sorted = [...a].sort((x, y) => x - y)
    const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
    return sorted[i]
  }

  // --- history --------------------------------------------------------------
  // Undo works on snapshots rather than inverse commands. A board is small
  // enough that copying it is cheap, and it means every mutation gets undo for
  // free instead of each one needing a hand-written inverse to keep in step.
  function snapshot() {
    return JSON.stringify({
      nodes: state.nodes.map(n => ({ ...n.spec, x: n.x, y: n.y })),
      edges: state.edges.map(e => edgeSpec(e)),
      sections: state.sections.map(x => ({
        id: x.id, label: x.label, x: x.x, y: x.y, w: x.w, h: x.h, tone: x.tone ?? null,
      })),
      groups: state.groups.map(g => ({ ...g, children: [...g.children] })),
    })
  }

  // Restores in place: surviving nodes keep their runtime state, so undoing a
  // wire change does not also reset the traffic that was flowing through it.
  function restore(json) {
    const snap = JSON.parse(json)
    const order = new Map(snap.nodes.map((n, i) => [n.id, i]))

    state.nodes = state.nodes.filter(n => order.has(n.id))
    for (const spec of snap.nodes) {
      const found = byId(spec.id)
      if (found) {
        Object.assign(found.spec, spec)
        found.x = spec.x
        found.y = spec.y
        found.rps = spec.rps ?? DEFAULT_RPS
        // No capacity assignment: it is a derived getter now, and writing to it
        // threw on every undo that a node survived. latency and concurrency come
        // back with the spec above, which is what capacity is computed from.
        found.label = spec.label ?? typeOf(found).name
      } else {
        const n = makeNode(spec)
        n.appearAt = state.animTime
        state.nodes.push(n)
      }
    }
    state.nodes.sort((a, b) => order.get(a.id) - order.get(b.id))

    state.edges = snap.edges.map(e => ({ ...e, off: false }))
    state.sections = snap.sections.map(x => ({ ...x, spec: x }))
    state.groups = (snap.groups || []).map(g => ({ ...g, children: [...g.children] }))
    pruneGroups()
    state.packets = state.packets.filter(p => byId(p.from) && byId(p.to))
    syncScene()
  }

  // The scene definition is the thing the editor and the layout copy read, so
  // it has to follow every structural change rather than only the ones that
  // remembered to write through.
  function syncScene() {
    state.scene.nodes = state.nodes.map(n => n.spec)
    state.scene.edges = state.edges.map(e => edgeSpec(e))
    state.scene.sections = state.sections.map(x => x.spec)
    state.scene.groups = state.groups
  }

  // --- sections -------------------------------------------------------------

  // Whatever currently sits inside the rectangle. Recomputed on demand rather
  // than stored, so dragging a node in or out just works.
  function nodesIn(sec) {
    return state.nodes.filter(n =>
      !n.hidden && n.x >= sec.x && n.x <= sec.x + sec.w &&
                   n.y >= sec.y && n.y <= sec.y + sec.h)
  }

  function addSection(label, x, y, w, h) {
    let id = 'section', i = 1
    while (state.sections.some(s2 => s2.id === id)) id = `section${++i}`
    const spec = { id, label: label || 'Section', x, y, w, h }
    if (!state.scene.sections) state.scene.sections = []
    state.scene.sections.push(spec)
    const sec = { ...spec, spec }
    state.sections.push(sec)
    return sec
  }

  // Resizing does NOT carry the contents, unlike moving. Membership is
  // geometric, so growing a section takes in whatever it now covers and
  // shrinking it lets things go — which is the behaviour that makes a
  // geometric grouping worth having.
  const MIN_SEC = 0.06

  function resizeSection(id, corner, dx, dy) {
    const sec = state.sections.find(s2 => s2.id === id)
    if (!sec) return
    let { x, y, w, h } = sec

    if (corner.includes('w')) { const nx = x + dx; const nw = w - dx; if (nw >= MIN_SEC) { x = nx; w = nw } }
    if (corner.includes('e')) { const nw = w + dx; if (nw >= MIN_SEC) w = nw }
    if (corner.includes('n')) { const ny = y + dy; const nh = h - dy; if (nh >= MIN_SEC) { y = ny; h = nh } }
    if (corner.includes('s')) { const nh = h + dy; if (nh >= MIN_SEC) h = nh }

    sec.x = clamp01(x); sec.y = clamp01(y)
    sec.w = Math.min(w, 1 - sec.x); sec.h = Math.min(h, 1 - sec.y)
    Object.assign(sec.spec, { x: sec.x, y: sec.y, w: sec.w, h: sec.h })
  }

  function removeSection(id) {
    state.sections = state.sections.filter(s2 => s2.id !== id)
    if (state.scene.sections) {
      state.scene.sections = state.scene.sections.filter(s2 => s2.id !== id)
    }
  }

  // Moving a section carries its contents. That is the whole point of grouping,
  // and it is why membership is resolved before the move, not after.
  // `carry` is the Alt-drag escape hatch. Geometric membership means a section
  // adopts whatever it happens to cover, so moving one can haul objects you
  // never meant to group — this is how you reposition the frame alone.
  function moveSection(id, dx, dy, { carry = true } = {}) {
    const sec = state.sections.find(s2 => s2.id === id)
    if (!sec) return
    const carried = carry ? nodesIn(sec) : []
    sec.x = clamp01(sec.x + dx)
    sec.y = clamp01(sec.y + dy)
    sec.spec.x = sec.x
    sec.spec.y = sec.y
    for (const n of carried) {
      n.x = clamp01(n.x + dx)
      n.y = clamp01(n.y + dy)
      if (state.portrait) n.spec.portrait = [n.x, n.y]
      else { n.spec.x = n.x; n.spec.y = n.y }
    }
  }


  // --- groups ---------------------------------------------------------------
  // Folding is a VIEW operation: nothing below touches routing, queueing or
  // capacity. The simulation keeps running the members it can no longer see,
  // which is what makes folding free of consequence — and testable.

  const world = v => Math.max(WORLD_MIN, Math.min(WORLD_MAX, v))
  const anyId = id => byId(id) || groupById(state, id)

  // Where a child item sits, whichever kind it is.
  function posOf(id) {
    const n = byId(id)
    if (n) return { x: n.x, y: n.y }          // already resolved for this layout
    const g = groupById(state, id)
    return g ? groupPos(g, state.portrait) : null
  }

  // A group writes back into whichever layout is on screen, exactly as a node
  // does. Without this, arranging a board at 9:16 silently edited the 16:9 one.
  function place(g, x, y) {
    if (state.portrait) g.portrait = [x, y]
    else { g.x = x; g.y = y }
  }

  function centroid(ids) {
    const pts = ids.map(posOf).filter(Boolean)
    if (!pts.length) return { x: 0.5, y: 0.5 }
    return {
      x: pts.reduce((s2, p) => s2 + p.x, 0) / pts.length,
      y: pts.reduce((s2, p) => s2 + p.y, 0) / pts.length,
    }
  }

  // Grouping a selection that spans two different parents would have to pick
  // one of them to reparent into, and there is no right answer — so it is
  // refused with a reason rather than guessed at.
  function addGroup(label, itemIds) {
    const ids = [...new Set(itemIds)].filter(anyId)
    if (ids.length < 2) return { error: 'select at least two objects to group' }

    const parents = new Set(ids.map(id => parentOf(state, id)?.id ?? null))
    if (parents.size > 1) return { error: 'that selection spans two groups' }
    const parent = parentOf(state, ids[0])

    // One id space for nodes and groups: the view graph draws both as items,
    // and an edge retargeted onto a proxy has to name it unambiguously.
    let id = 'group', i = 1
    while (anyId(id)) id = `group${++i}`

    const at = centroid(ids)
    const g = { id, label: label || 'Group', children: ids, folded: false, x: at.x, y: at.y }
    state.groups.push(g)

    if (parent) {
      const first = Math.min(...ids.map(c => parent.children.indexOf(c)).filter(k => k >= 0))
      parent.children = parent.children.filter(c => !ids.includes(c))
      parent.children.splice(Number.isFinite(first) ? first : parent.children.length, 0, id)
    }
    syncScene()
    return { group: g }
  }

  function dropGroup(id) {
    state.groups = state.groups.filter(g => g.id !== id)
    for (const g of state.groups) g.children = (g.children || []).filter(c => c !== id)
  }

  // Ungrouping hands the children back to whoever held the group, so dissolving
  // a Region leaves its Services where they were instead of scattering them to
  // the top level.
  function removeGroup(id, { deep = false } = {}) {
    const g = groupById(state, id)
    if (!g) return
    if (deep) {
      const leaves = leavesOf(state, g)
      const subs = subgroupsOf(state, g)
      for (const s2 of [...subs, g]) dropGroup(s2.id)   // groups first, so pruning has nothing left to cascade
      for (const n of leaves) removeNode(n.id)
      syncScene()
      return
    }
    const parent = parentOf(state, id)
    const kids = [...(g.children || [])]
    dropGroup(id)
    if (parent) parent.children.push(...kids)
    syncScene()
  }

  // The folded card's position is always the centroid of what it holds. That
  // stays true through a drag because moveGroup carries the members by the same
  // delta, so folding twice lands in the same place both times.
  function setFolded(id, folded) {
    const g = groupById(state, id)
    if (!g) return
    g.folded = !!folded
    if (g.folded) { const c = centroid(g.children || []); place(g, c.x, c.y) }
    syncScene()
  }

  function moveGroup(id, dx, dy) {
    const g = groupById(state, id)
    if (!g) return
    for (const sub of [g, ...subgroupsOf(state, g)]) {
      const p = groupPos(sub, state.portrait)
      place(sub, world(p.x + dx), world(p.y + dy))
    }
    for (const n of leavesOf(state, g)) {
      n.x = world(n.x + dx)
      n.y = world(n.y + dy)
      if (state.portrait) n.spec.portrait = [n.x, n.y]
      else { n.spec.x = n.x; n.spec.y = n.y }
    }
  }

  // The counterpart to grouping. A group's box is derived from its members, so
  // dragging one "outside" only stretches the box — there is no outside. Leaving
  // has to be an act, not a position.
  function removeFromGroup(id) {
    const p = parentOf(state, id)
    if (!p) return false
    p.children = (p.children || []).filter(c => c !== id)
    pruneGroups()
    syncScene()
    return true
  }

  function renameGroup(id, label) {
    const g = groupById(state, id)
    if (!g) return
    g.label = label || 'Group'
    syncScene()
  }

  // Membership is explicit, so a deleted node has to be taken out of the list
  // that named it — and a group emptied by that is not a group any more.
  function pruneGroups() {
    for (let pass = 0; pass < 8; pass++) {
      let changed = false
      for (const g of [...state.groups]) {
        const alive = (g.children || []).filter(anyId)
        if (alive.length !== (g.children || []).length) { g.children = alive; changed = true }
        if (!alive.length) { dropGroup(g.id); changed = true }
      }
      if (!changed) break
    }
  }

  function removeNode(id) {
    state.nodes = state.nodes.filter(n => n.id !== id)
    state.edges = state.edges.filter(e => e.from !== id && e.to !== id)
    state.packets = state.packets.filter(p => p.from !== id && p.to !== id)
    if (state.scene.nodes) {
      state.scene.nodes = state.scene.nodes.filter(n => n.id !== id)
    }
    if (state.scene.edges) {
      state.scene.edges = state.scene.edges.filter(e => e.from !== id && e.to !== id)
    }
    pruneGroups()
  }

  // Cards enter in flow order: sources first, then whatever they feed. Reading
  // the diagram and watching it build become the same motion.
  function stageEntrance(from = 0) {
    const depth = new Map()
    const queue = []
    for (const n of state.nodes) {
      if (roleOf(n) === 'source') { depth.set(n.id, 0); queue.push(n.id) }
    }
    if (!queue.length && state.nodes.length) {
      depth.set(state.nodes[0].id, 0); queue.push(state.nodes[0].id)
    }
    while (queue.length) {
      const id = queue.shift()
      for (const e of state.edges) {
        if (e.from !== id || depth.has(e.to)) continue
        depth.set(e.to, depth.get(id) + 1)
        queue.push(e.to)
      }
    }
    let orphan = 0
    for (const n of state.nodes) {
      const d = depth.has(n.id) ? depth.get(n.id) : orphan++
      n.appearAt = from + d * ENTER_STEP
    }
  }

  // 0..1 visibility for a card, raw; the renderer applies the curve.
  // Hiding is animated too: a node that vanishes on the frame a step changes
  // reads as a cut, and a sequence of cuts is why stepping felt abrupt.
  function appearOf(n) {
    if (!n.hidden) return clamp01((state.animTime - n.appearAt) / ENTER_MS)
    if (n.exitAt == null) return 0        // never shown in the first place
    return 1 - clamp01((state.animTime - n.exitAt) / EXIT_MS)
  }

  // Lay the visible nodes out from the live edges instead of trusting positions
  // authored for the full topology. A step that shows two of six nodes was
  // otherwise using coordinates designed for six, which is why composition fell
  // apart mid-story: the positions were static while visibility was not.
  function autoLayout() {
    const live = state.nodes.filter(n => !n.hidden)
    if (!live.length) return
    const ids = new Set(live.map(n => n.id))
    const edges = state.edges.filter(e => !e.off && ids.has(e.from) && ids.has(e.to))

    const depth = new Map()
    const queue = []
    for (const n of live) {
      const hasIncoming = edges.some(e => e.to === n.id)
      if (!hasIncoming) { depth.set(n.id, 0); queue.push(n.id) }
    }
    if (!queue.length) { depth.set(live[0].id, 0); queue.push(live[0].id) }
    while (queue.length) {
      const id = queue.shift()
      for (const e of edges) {
        if (e.from !== id) continue
        const d = depth.get(id) + 1
        if (depth.has(e.to) && depth.get(e.to) >= d) continue
        depth.set(e.to, d)
        queue.push(e.to)
      }
    }

    const layers = new Map()
    for (const n of live) {
      const d = depth.get(n.id) ?? 0
      if (!layers.has(d)) layers.set(d, [])
      layers.get(d).push(n)
    }
    const maxDepth = Math.max(...layers.keys())

    // Along the flow: left to right, or top to bottom in portrait.
    const along = (d) => maxDepth === 0 ? 0.5 : 0.12 + (d / maxDepth) * 0.76
    const across = (i, n) => n === 1 ? 0.5 : 0.16 + (i / (n - 1)) * 0.68

    for (const [d, group] of layers) {
      group.sort((a, b) => a.spec.y - b.spec.y || a.id.localeCompare(b.id))
      group.forEach((n, i) => {
        const a = along(d), c = across(i, group.length)
        if (state.portrait) { n.x = c; n.y = a }
        else { n.x = a; n.y = c }
      })
    }
  }

  // Reveal a node that was hidden, animating it in from now.
  function reveal(id, on = true) {
    const n = byId(id)
    if (!n) return
    const wantHidden = !on
    if (n.hidden === wantHidden) return
    n.hidden = wantHidden
    if (on) { n.appearAt = state.animTime; n.exitAt = null }
    else n.exitAt = state.animTime
  }

  function relayout(portrait) {
    state.portrait = portrait
    for (const n of state.nodes) {
      const at = placement(n.spec, portrait)
      n.x = at.x
      n.y = at.y
    }
  }

  const byId = id => state.nodes.find(n => n.id === id)

  // An edge is no longer just a pair of ids: it carries how the call is made.
  // `off` is runtime (a timeline step muting it), everything else is authored.
  const EDGE_PROPS = ['async', 'protocol', 'latency', 'label']

  function edgeSpec(e) {
    const out = { from: e.from, to: e.to }
    for (const k of EDGE_PROPS) if (e[k] != null && e[k] !== '') out[k] = e[k]
    return out
  }

  const linkBetween = (from, to) =>
    state.edges.find(e => e.from === from && e.to === to) ||
    state.edges.find(e => e.from === to && e.to === from)   // responses retrace the wire

  function setEdgeProp(from, to, key, value) {
    const e = state.edges.find(x => x.from === from && x.to === to)
    if (!e) return
    if (value === '' || value == null) delete e[key]
    else e[key] = value
    syncScene()
  }

  // A replica refuses writes and a primary is where they all end up, so what a
  // node can forward to depends on what it is holding. If nothing accepts this
  // kind, the kind-blind targets are used — a diagram that silently drops every
  // write because nobody declared `accepts` would be worse than a wrong one.
  function liveTargets(n, kind) {
    const all = state.edges
      .filter(e => e.from === n.id && !e.off)
      .map(e => byId(e.to))
      .filter(t => t && !t.dead && !t.hidden)
    if (!kind) return all
    const fit = all.filter(t => { const a = acceptsOf(t); return a == null || a === kind })
    return fit.length ? fit : all.filter(t => acceptsOf(t) == null)
  }

  // Options rather than positional arguments: a packet now carries a kind, a
  // failure flag and an attempt count on top of its trail, and eight positional
  // arguments was already one too many to read.
  function send(from, to, dir, o = {}) {
    const a = byId(from), b = byId(to)
    if (!a || !b) return
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    state.packets.push({
      id: ++seq,
      from, to, dir,
      trail: o.trail ?? [from],
      idx: o.idx ?? 0,
      hit: o.hit ?? false,
      kind: o.kind ?? 'read',         // reads and writes go to different places
      failed: o.failed ?? false,
      attempts: o.attempts ?? 0,
      detached: o.detached ?? false,  // an async hand-off; nobody is waiting on it
      bornAt: o.bornAt ?? state.time, // set once, carried the whole way
      inSystem: o.inSystem ?? 0,      // queue + service time, excluding travel
      progress: 0,
      dur: Math.max(220, (dist / SPEED) * 1000),
      alive: true,
    })
  }

  // Push an arrival into the node's 1s window and report the current rate.
  function record(n) {
    n.rxLog.push(state.time)
    trim(n)
    return n.rxLog.length * (1000 / WINDOW)
  }

  function trim(n) {
    const cutoff = state.time - WINDOW
    while (n.rxLog.length && n.rxLog[0] <= cutoff) n.rxLog.shift()
  }

  const concOf = n => n.spec.concurrency ?? typeOf(n).concurrency ?? 1
  const baseLat = n => n.spec.latency ?? typeOf(n).latency ?? 0
  // Degrading multiplies service time and injects errors. One flag, both
  // symptoms, because that is what a sick service actually looks like.
  const latOf  = n => baseLat(n) * (n.degraded ? DEGRADE_LATENCY : 1)
  const failOf = n => n.degraded ? Math.max(failureOf(n), DEGRADE_FAILURE) : failureOf(n)
  const queueCapOf = n => n.spec.maxQueue ?? typeOf(n).maxQueue ?? 40
  // Backlog. For a queue or a broker this is consumer lag: how far behind the
  // readers are, which is the number people actually put on these diagrams.
  const lagOf = n => n.queue.length

  // ADMISSION. A request arriving at a busy node no longer vanishes or sails
  // through — it waits. This is the whole point of modelling latency: capacity
  // stops being a number that refuses things and becomes a consequence of how
  // long each request takes and how many can be in flight at once.
  function arrive(p) {
    const n = byId(p.to)
    if (!n || n.dead || n.hidden) { state.stats.dropped++; return }
    const def = typeOf(n)

    // Time on the wire is real time in the system, unlike travel animation,
    // which is a rendering choice. It counts in both directions.
    const link = linkBetween(p.from, p.to)
    if (link?.latency > 0) p.inSystem = (p.inSystem ?? 0) + link.latency

    // Responses are work already paid for. They do not queue and do not occupy
    // a server; counting them would double every meter.
    if (p.dir !== 1) { n.pulse = 1; route(n, p); return }

    record(n)
    p.arrivedAt = state.time      // for the queue-plus-service clock

    // A limiter refuses by policy while sitting idle, which is the entire point
    // of one. That is a different thing from being busy, so it is checked first.
    if ((n.spec.rateLimit ?? def.rateLimit) != null) {
      if (n.tokens < 1) { state.stats.dropped++; n.overloaded = true; return refuse(n, p) }
      n.tokens -= 1
    }

    if (n.inService.length < concOf(n)) return startService(n, p)
    if (n.queue.length < queueCapOf(n)) return void n.queue.push(p)

    n.overloaded = true
    state.stats.dropped++
    refuse(n, p)
  }

  // A refused request has to say so. Dropping it silently left the caller
  // waiting forever and made an overloaded service invisible to everything
  // upstream — which also meant overload could never trip a circuit breaker,
  // and that is the single most important interaction between the two.
  // `dropped` still counts what this node refused; `errors` counts what the
  // caller was told about.
  function refuse(n, p) {
    failBack(n, [...p.trail, n.id], p)
  }

  // `from` is when the server actually became free, which is not the same as
  // when we noticed. Completions are only checked once a frame, so without
  // carrying that overshoot forward every request silently loses up to one
  // frame of service time — a 25ms job measured as 33ms, and throughput
  // landing at 27/s instead of the 40/s the numbers promise.
  function startService(n, p, from = state.time) {
    n.pulse = 1
    n.inService.push({ p, doneAt: from + latOf(n) })
  }

  // --- circuit breaker -------------------------------------------------------
  // State lives on the CALLER, one breaker per downstream, because that is where
  // the decision is made: the caller is the one that has to stop calling.

  function breakerFor(n, downId) {
    const cfg = breakerOf(n)
    if (!cfg) return null
    let b = n.breakers.get(downId)
    if (!b) { b = { state: 'closed', log: [], openedAt: 0, probing: false }; n.breakers.set(downId, b) }
    b.cfg = cfg
    return b
  }

  // Open means fail immediately without touching the downstream — that is the
  // whole point, and it is also what stops a retry storm feeding a service that
  // is already drowning.
  function breakerAllows(n, downId) {
    const b = breakerFor(n, downId)
    if (!b || b.state === 'closed') return true
    if (b.state === 'open') {
      if (state.time - b.openedAt < b.cfg.resetAfter) return false
      b.state = 'half'
      b.probing = false
    }
    if (b.state === 'half') {
      if (b.probing) return false      // exactly one probe at a time
      b.probing = true
      return true
    }
    return true
  }

  function noteResult(n, downId, ok) {
    const b = breakerFor(n, downId)
    if (!b) return
    if (b.state === 'half') {
      b.state = ok ? 'closed' : 'open'
      if (!ok) { b.openedAt = state.time; state.stats.tripped++ }
      b.probing = false
      b.log.length = 0
      return
    }
    b.log.push({ t: state.time, ok })
    while (b.log.length && b.log[0].t <= state.time - b.cfg.window) b.log.shift()
    if (b.state !== 'closed' || b.log.length < b.cfg.min) return
    const bad = b.log.reduce((c, x) => c + (x.ok ? 0 : 1), 0) / b.log.length
    if (bad >= b.cfg.threshold) {
      b.state = 'open'
      b.openedAt = state.time
      b.probing = false
      state.stats.tripped++
    }
  }

  // What a caller can see about a downstream, for the wire to draw itself.
  function breakerState(fromId, toId) {
    const n = byId(fromId)
    const b = n?.breakers?.get(toId)
    if (!b) return 'closed'
    if (b.state === 'open' && state.time - b.openedAt >= b.cfg.resetAfter) return 'half'
    return b.state
  }

  // --- completion ------------------------------------------------------------

  // Latency is recorded where the request ENDS, which is back at whoever asked
  // — not at the sink that answered it. Recording at the sink counted only the
  // outbound hops, so a 60ms wire showed up as 60ms instead of the 120ms a
  // round trip actually costs.
  //
  // Declared network latency is a modelled cost and counts; the time a dot
  // spends flying across the screen is a rendering choice and still does not.
  function finish(n, trail, p, { hit = false } = {}) {
    if (p.detached) { state.stats.jobs++; return }   // nobody is waiting on a hand-off
    state.stats.processed++
    const idx = trail.length - 1
    if (idx <= 0) { recordLatency(p.inSystem ?? 0); return }   // it began and ended here
    send(n.id, trail[idx - 1], -1,
      { trail, idx: idx - 1, hit, kind: p.kind, bornAt: p.bornAt, inSystem: p.inSystem })
  }

  // A failure walks back the way the request came, so every caller on the path
  // gets a chance to retry it or give up on it.
  function failBack(n, trail, p) {
    state.stats.errors++
    const idx = trail.length - 1
    if (idx <= 0) { if (!p.detached) state.stats.failed++; return }
    send(n.id, trail[idx - 1], -1,
      { trail, idx: idx - 1, kind: p.kind, failed: true, attempts: p.attempts,
        detached: p.detached, bornAt: p.bornAt, inSystem: p.inSystem })
  }

  function route(n, p) {
    // A response is retracing a path that was already counted on the way out.
    // Falling through to the request logic below counts it a second time and
    // sends it onward again — which is how 70 rps in produced 102 processed.
    if (p.dir !== 1) return handleResponse(n, p)

    const def = typeOf(n)
    const trail = [...p.trail, n.id]

    // This node fumbling the request. Checked before anything downstream,
    // because a service that is failing does not politely forward first.
    if (failOf(n) > 0 && Math.random() < failOf(n)) {
      n.failures++
      return failBack(n, trail, p)
    }

    const outs = liveTargets(n, p.kind)

    // A cache hit turns the request around here and never touches what is
    // behind it. Without this a cache was a box that forwarded everything.
    const hitRate = n.spec.hitRate ?? def.hitRate
    if (hitRate != null && Math.random() < hitRate && outs.length) {
      n.hits++
      state.stats.hits++
      return finish(n, trail, p, { hit: true })   // a hit is a finished request, just a fast one
    }
    if (hitRate != null) n.misses++

    if (roleOf(n) === 'sink' || outs.length === 0) return finish(n, trail, p)

    // Every downstream refusing means fail fast, which is exactly what an open
    // breaker is for: the caller stops calling instead of piling on.
    const allowed = outs.filter(t => breakerAllows(n, t.id))
    if (!allowed.length) return failBack(n, trail, p)

    const next = allowed[n.rrIdx++ % allowed.length]   // round robin
    const link = linkBetween(n.id, next.id)

    // An async hand-off IS the completion. The caller is answered here and the
    // work carries on behind it with a fresh trail, which is the difference
    // between "the gateway called the cart service" and "the gateway dropped a
    // job and walked away".
    if (link?.async) {
      send(n.id, next.id, 1, { trail: [n.id], idx: 0, kind: p.kind, detached: true })
      return finish(n, trail, p)
    }

    send(n.id, next.id, 1,
      { trail, idx: 0, kind: p.kind, attempts: p.attempts,
        detached: p.detached, bornAt: p.bornAt, inSystem: p.inSystem })
  }

  // The caller's side of an answer: score it for the breaker, retry it if the
  // policy says so, otherwise pass it back.
  function handleResponse(n, p) {
    noteResult(n, p.from, !p.failed)

    if (p.failed) {
      const r = retryOf(n)
      if (r && p.attempts < r.max) {
        const k = p.attempts + 1
        // Exponential, with jitter, because synchronised retries are their own
        // outage — every caller coming back at the same instant.
        const wait = r.backoff * Math.pow(2, k - 1) * (1 + (Math.random() * 2 - 1) * r.jitter)
        state.stats.retries++
        n.pending.push({ p, at: state.time + Math.max(0, wait), k })
        return
      }
      if (p.idx <= 0) { if (!p.detached) state.stats.failed++; return }
      send(n.id, p.trail[p.idx - 1], -1,
        { trail: p.trail, idx: p.idx - 1, kind: p.kind, failed: true,
          attempts: p.attempts, detached: p.detached, bornAt: p.bornAt, inSystem: p.inSystem })
      return
    }

    if (p.idx <= 0) { recordLatency(p.inSystem ?? 0); return }   // home; this is the end to end
    send(n.id, p.trail[p.idx - 1], -1,
      { trail: p.trail, idx: p.idx - 1, hit: p.hit, kind: p.kind,
        detached: p.detached, bornAt: p.bornAt, inSystem: p.inSystem })
  }

  // Retries waiting out their backoff. The forward trail is everything up to
  // and including this node, which is exactly the slice the response carried.
  function drainPending() {
    for (const n of state.nodes) {
      if (!n.pending.length) continue
      const due = n.pending.filter(x => x.at <= state.time)
      if (!due.length) continue
      n.pending = n.pending.filter(x => x.at > state.time)
      for (const x of due) {
        const p = x.p
        const trail = p.trail.slice(0, p.idx + 1)
        const outs = liveTargets(n, p.kind).filter(t => breakerAllows(n, t.id))
        if (!outs.length) {
          // Nothing left to try. Give up properly rather than dropping it.
          failBack(n, [...trail, ''], { ...p, attempts: x.k })
          continue
        }
        const next = outs[n.rrIdx++ % outs.length]
        send(n.id, next.id, 1,
          { trail, idx: 0, kind: p.kind, attempts: x.k,
            detached: p.detached, bornAt: p.bornAt, inSystem: p.inSystem })
      }
    }
  }

  // Called every tick: finish what is due, then pull the next waiters in.
  function serviceNodes() {
    for (const n of state.nodes) {
      if (!n.inService.length && !n.queue.length) continue
      let freedAt = state.time
      if (n.inService.length) {
        const due = n.inService.filter(x => x.doneAt <= state.time)
        if (due.length) {
          n.inService = n.inService.filter(x => x.doneAt > state.time)
          for (const x of due) {
            freedAt = Math.min(freedAt, x.doneAt)   // earliest moment a slot opened
            const waited = x.doneAt - (x.p.arrivedAt ?? x.doneAt)
            x.p.inSystem = (x.p.inSystem ?? 0) + waited
            route(n, x.p)
          }
        }
      }
      const conc = concOf(n)
      while (n.inService.length < conc && n.queue.length) {
        const next = n.queue.shift()
        // The slot may have opened before this request even arrived. Starting
        // its service at that earlier moment made doneAt precede arrivedAt and
        // produced negative latencies, which is not a small error — it is time
        // running backwards.
        startService(n, next, Math.max(freedAt, next.arrivedAt ?? freedAt))
        freedAt = state.time                        // only the first inherits the slack
      }
    }
  }

  function step(dt) {
    state.time += dt

    // 1. sources emit on a rate accumulator
    for (const n of state.nodes) {
      if (n.dead || n.hidden || roleOf(n) !== 'source') continue
      if (!(n.rps > 0)) { n.spawnAccum = 0; continue }   // a step may mute a source
      const outs = liveTargets(n)
      if (!outs.length) continue
      n.spawnAccum += dt
      const interval = 1000 / n.rps
      const writeRatio = n.spec.writeRatio ?? 0
      while (n.spawnAccum >= interval) {
        n.spawnAccum -= interval
        // The read/write split decided here is what makes a primary and a
        // replica two different things rather than two boxes.
        const kind = Math.random() < writeRatio ? 'write' : 'read'
        const picks = liveTargets(n, kind)
        if (!picks.length) continue
        const next = picks[n.rrIdx++ % picks.length]
        send(n.id, next.id, 1, { trail: [n.id], idx: 0, kind })
      }
    }

    // 2. nodes finish what they were serving and admit whoever was waiting
    serviceNodes()
    drainPending()   // and retries whose backoff has run out

    // 3. packets are a progress value
    for (const p of state.packets) {
      if (!p.alive) continue
      p.progress += dt / p.dur
      if (p.progress >= 1) { p.alive = false; arrive(p) }
    }
    state.packets = state.packets.filter(p => p.alive)

    // rate limiters refill continuously, which is what makes a burst possible
    for (const n of state.nodes) {
      const def = typeOf(n)
      if (def.effect !== 'bucket') continue
      const burst = def.burst || 20
      n.tokens = Math.min(burst, n.tokens + n.capacity * dt / 1000)
    }

    // 4. a node is overloaded when its queue is full, not when a rate is high
    let hot = 0
    for (const n of state.nodes) {
      trim(n)
      const rate = n.rxLog.length * (1000 / WINDOW)
      n.overloaded = !n.dead && !n.hidden && n.queue.length >= queueCapOf(n)
      if (n.overloaded) hot++
    }
    state.stats.overloaded = hot
  }

  // Presentation only. Runs every frame whether or not the sim is running, so
  // entrances play while paused and meters keep settling after you hit pause.
  function advanceAnim(dt) {
    state.animTime += dt
    for (const n of state.nodes) {
      const measured = state.running ? n.rxLog.length * (1000 / WINDOW) : 0
      n.showRate = damp(n.showRate, measured, RATE_LAMBDA, dt)
      if (Math.abs(n.showRate - measured) < 0.05) n.showRate = measured
      n.hot = damp(n.hot, n.overloaded ? 1 : 0, 7, dt)
      n.dim = damp(n.dim, n.dimTarget, 6, dt)
      if (n.pulse > 0) n.pulse = Math.max(0, n.pulse - dt / 300)
    }
  }

  function reset({ replay = false } = {}) {
    state.packets = []
    state.time = 0
    state.stats = { processed: 0, dropped: 0, overloaded: 0, hits: 0,
                    errors: 0, failed: 0, retries: 0, jobs: 0, tripped: 0 }
    state.latencies = []
    for (const n of state.nodes) {
      n.rxLog = []
      n.overloaded = false
      n.dead = false
      n.hidden = false
      n.exitAt = null
      n.spawnAccum = 0
      n.rrIdx = 0
      n.pulse = 0
      n.showRate = 0
      n.hot = 0
      n.dim = 0
      n.dimTarget = 0
      n.tokens = typeOf(n).burst ?? 0
      n.inService = []
      n.queue = []
      n.hits = 0
      n.misses = 0
      n.degraded = false
      n.failures = 0
      n.pending = []
      n.breakers = new Map()
      n.rps = n.spec.rps ?? DEFAULT_RPS
    }
    if (replay) { state.animTime = 0; stageEntrance(0) }
  }

  function connect(fromId, toId) {
    const from = byId(fromId), to = byId(toId)
    const why = connectionError(from, to, state.edges)
    if (why) return why
    // Wiring into a broker or a queue is asynchronous by definition, so the
    // wire says so without being told. Everything else stays a plain call.
    const link = { from: fromId, to: toId, off: false }
    if (typeOf(to).asyncIn) link.async = true
    state.edges.push(link)
    if (state.scene.edges) state.scene.edges.push(edgeSpec(link))
    if (state.scene.autoLayout) autoLayout()
    return null
  }

  function disconnect(fromId, toId) {
    const gone = e => e.from === fromId && e.to === toId
    state.edges = state.edges.filter(e => !gone(e))
    state.packets = state.packets.filter(p => !gone(p))
    if (state.scene.edges) state.scene.edges = state.scene.edges.filter(e => !gone(e))
  }

  // Alt-click in Play. Kill is binary and honest but rare; this is the failure
  // that actually happens.
  function degrade(id) {
    const n = byId(id)
    if (!n) return
    n.degraded = !n.degraded
  }

  function kill(id) {
    const n = byId(id)
    if (!n) return
    n.dead = !n.dead
    n.rxLog = []
    n.overloaded = false
    // Anything already in flight toward a dead node never lands.
    state.packets = state.packets.filter(p => p.to !== id)
  }

  // The exact measured rate. Renderers should prefer n.showRate, which is this
  // value damped, so a meter fed by a bursty window does not strobe.
  function rateOf(n) {
    return n.rxLog.length * (1000 / WINDOW)
  }

  load()
  return {
    state, load, relayout, step, advanceAnim, reset, kill, byId, rateOf,
    percentile,
    appearOf, reveal, stageEntrance, autoLayout, connect, disconnect,
    addNode, removeNode, addSection, removeSection, moveSection, resizeSection, nodesIn,
    addGroup, removeGroup, setFolded, moveGroup, renameGroup, removeFromGroup,
    degrade, setEdgeProp, linkBetween, breakerState, lagOf,
    parentOf: id => parentOf(state, id),
    snapshot, restore,
  }
}
