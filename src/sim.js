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

import { typeOf, roleOf, connectionError, NODE_TYPES, capacityOf } from './registry.js'
import { placement } from './scene.js'
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
    packets: [],
    running: false,
    time: 0,        // simulation clock; only advances while running
    animTime: 0,    // presentation clock; always advances
    portrait: !!opts.portrait,
    stats: { processed: 0, dropped: 0, overloaded: 0, hits: 0 },
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
      }
  }

  function load(def = state.scene) {
    state.scene = def
    state.nodes = (def.nodes || []).map(makeNode)
    state.edges = (def.edges || []).map(e => ({ ...e, off: false }))
    state.sections = (def.sections || []).map(x => ({ ...x, spec: x }))
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
      edges: state.edges.map(e => ({ from: e.from, to: e.to })),
      sections: state.sections.map(x => ({
        id: x.id, label: x.label, x: x.x, y: x.y, w: x.w, h: x.h, tone: x.tone ?? null,
      })),
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
        found.capacity = spec.capacity ?? typeOf(found).capacity
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
    state.packets = state.packets.filter(p => byId(p.from) && byId(p.to))
    syncScene()
  }

  // The scene definition is the thing the editor and the layout copy read, so
  // it has to follow every structural change rather than only the ones that
  // remembered to write through.
  function syncScene() {
    state.scene.nodes = state.nodes.map(n => n.spec)
    state.scene.edges = state.edges.map(e => ({ from: e.from, to: e.to }))
    state.scene.sections = state.sections.map(x => x.spec)
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

  function removeSection(id) {
    state.sections = state.sections.filter(s2 => s2.id !== id)
    if (state.scene.sections) {
      state.scene.sections = state.scene.sections.filter(s2 => s2.id !== id)
    }
  }

  // Moving a section carries its contents. That is the whole point of grouping,
  // and it is why membership is resolved before the move, not after.
  function moveSection(id, dx, dy) {
    const sec = state.sections.find(s2 => s2.id === id)
    if (!sec) return
    const carried = nodesIn(sec)
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

  function liveTargets(n) {
    return state.edges
      .filter(e => e.from === n.id && !e.off)
      .map(e => byId(e.to))
      .filter(t => t && !t.dead && !t.hidden)
  }

  function send(from, to, dir, trail, idx, hit = false, bornAt = null, inSystem = 0) {
    const a = byId(from), b = byId(to)
    if (!a || !b) return
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    state.packets.push({
      id: ++seq,
      from, to, dir, trail, idx, hit,
      bornAt: bornAt ?? state.time,   // set once, carried the whole way
      inSystem,                       // queue + service time, excluding travel
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
  const latOf  = n => n.spec.latency ?? typeOf(n).latency ?? 0
  const queueCapOf = n => n.spec.maxQueue ?? typeOf(n).maxQueue ?? 40

  // ADMISSION. A request arriving at a busy node no longer vanishes or sails
  // through — it waits. This is the whole point of modelling latency: capacity
  // stops being a number that refuses things and becomes a consequence of how
  // long each request takes and how many can be in flight at once.
  function arrive(p) {
    const n = byId(p.to)
    if (!n || n.dead || n.hidden) { state.stats.dropped++; return }
    const def = typeOf(n)

    // Responses are work already paid for. They do not queue and do not occupy
    // a server; counting them would double every meter.
    if (p.dir !== 1) { n.pulse = 1; route(n, p); return }

    record(n)
    p.arrivedAt = state.time      // for the queue-plus-service clock

    // A limiter refuses by policy while sitting idle, which is the entire point
    // of one. That is a different thing from being busy, so it is checked first.
    if ((n.spec.rateLimit ?? def.rateLimit) != null) {
      if (n.tokens < 1) { n.overloaded = true; state.stats.dropped++; return }
      n.tokens -= 1
    }

    if (n.inService.length < concOf(n)) return startService(n, p)
    if (n.queue.length < queueCapOf(n)) return void n.queue.push(p)

    n.overloaded = true
    state.stats.dropped++
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

  // COMPLETION. Everything below used to run the instant a packet landed.
  function route(n, p) {
    // A response is retracing a path that was already counted on the way out.
    // Falling through to the request logic below counts it a second time and
    // sends it onward again — which is how 70 rps in produced 102 processed.
    if (p.dir !== 1) {
      if (p.idx <= 0) return
      send(n.id, p.trail[p.idx - 1], -1, p.trail, p.idx - 1, p.hit, p.bornAt, p.inSystem)
      return
    }

    const def = typeOf(n)
    const trail = [...p.trail, n.id]
    const outs = liveTargets(n)

    // A cache hit turns the request around here and never touches what is
    // behind it. Without this a cache was a box that forwarded everything.
    const hitRate = n.spec.hitRate ?? def.hitRate
    if (hitRate != null && Math.random() < hitRate && outs.length) {
      n.hits++
      state.stats.processed++
      state.stats.hits++
      const idx = trail.length - 1
      if (idx > 0) send(n.id, trail[idx - 1], -1, trail, idx - 1, true, p.bornAt, p.inSystem)
      return
    }
    if (hitRate != null) n.misses++

    if (roleOf(n) === 'sink' || outs.length === 0) {
      state.stats.processed++
      recordLatency(p.inSystem ?? 0)
      const idx = trail.length - 1
      if (idx === 0) return
      send(n.id, trail[idx - 1], -1, trail, idx - 1, false, p.bornAt, p.inSystem)
      return
    }

    const next = outs[n.rrIdx++ % outs.length]   // round robin
    send(n.id, next.id, 1, trail, 0, false, p.bornAt, p.inSystem)
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
        startService(n, n.queue.shift(), freedAt)
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
      while (n.spawnAccum >= interval) {
        n.spawnAccum -= interval
        const next = outs[n.rrIdx++ % outs.length]
        send(n.id, next.id, 1, [n.id], 0)
      }
    }

    // 2. nodes finish what they were serving and admit whoever was waiting
    serviceNodes()

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
    state.stats = { processed: 0, dropped: 0, overloaded: 0, hits: 0 }
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
      n.rps = n.spec.rps ?? DEFAULT_RPS
    }
    if (replay) { state.animTime = 0; stageEntrance(0) }
  }

  function connect(fromId, toId) {
    const from = byId(fromId), to = byId(toId)
    const why = connectionError(from, to, state.edges)
    if (why) return why
    state.edges.push({ from: fromId, to: toId, off: false })
    if (state.scene.edges) state.scene.edges.push({ from: fromId, to: toId })
    if (state.scene.autoLayout) autoLayout()
    return null
  }

  function disconnect(fromId, toId) {
    const gone = e => e.from === fromId && e.to === toId
    state.edges = state.edges.filter(e => !gone(e))
    state.packets = state.packets.filter(p => !gone(p))
    if (state.scene.edges) state.scene.edges = state.scene.edges.filter(e => !gone(e))
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
    addNode, removeNode, addSection, removeSection, moveSection, nodesIn,
    snapshot, restore,
  }
}
