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

import { typeOf, roleOf } from './registry.js'
import { placement } from './scene.js'
import { damp, clamp01 } from './ease.js'

const WINDOW = 1000        // ms; equal to 1s so rxLog.length reads as rps
const DEFAULT_RPS = 6
const SPEED = 0.55         // fractions of the canvas travelled per second
const ENTER_MS = 460       // card entrance duration
const ENTER_STEP = 105     // stagger between successive hops
const RATE_LAMBDA = 5.5    // how hard the displayed rps chases the measured one

export function createSim(sceneDef, opts = {}) {
  const state = {
    scene: sceneDef,
    nodes: [],
    edges: [],
    packets: [],
    running: false,
    time: 0,        // simulation clock; only advances while running
    animTime: 0,    // presentation clock; always advances
    portrait: !!opts.portrait,
    stats: { processed: 0, dropped: 0, overloaded: 0 },
  }

  let seq = 0

  function load(def = state.scene) {
    state.scene = def
    state.nodes = def.nodes.map(n => {
      const at = placement(n, state.portrait)
      return {
        id: n.id,
        type: n.type,
        spec: n,
        x: at.x,
        y: at.y,
        rps: n.rps ?? DEFAULT_RPS,
        capacity: n.capacity ?? typeOf(n).capacity,
        label: n.label ?? typeOf(n).name,
        rxLog: [],
        overloaded: false,
        dead: false,
        hidden: false,
        spawnAccum: 0,
        rrIdx: 0,
        // presentation only
        appearAt: 0,      // animTime at which this card starts entering
        pulse: 0,         // 1 on arrival, decays
        showRate: 0,      // damped rps, what the meter and label actually show
        hot: 0,           // damped 0..1 overload blend, so the red fades in
      }
    })
    state.edges = def.edges.map(e => ({ ...e, off: false }))
    reset()
    stageEntrance(state.animTime)
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

  // 0..1 entrance progress for a card, raw; the renderer applies the curve.
  function appearOf(n) {
    if (n.hidden) return 0
    return clamp01((state.animTime - n.appearAt) / ENTER_MS)
  }

  // Reveal a node that was hidden, animating it in from now.
  function reveal(id, on = true) {
    const n = byId(id)
    if (!n) return
    const wantHidden = !on
    if (n.hidden === wantHidden) return
    n.hidden = wantHidden
    if (on) n.appearAt = state.animTime
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

  function send(from, to, dir, trail, idx) {
    const a = byId(from), b = byId(to)
    if (!a || !b) return
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    state.packets.push({
      id: ++seq,
      from, to, dir, trail, idx,
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

  function arrive(p) {
    const n = byId(p.to)
    if (!n || n.dead || n.hidden) { state.stats.dropped++; return }

    // Only requests consume capacity. Responses are already-paid-for work
    // riding back down the trail, so counting them would double every meter.
    if (p.dir === 1) {
      const rate = record(n)
      if (rate > n.capacity) {
        n.overloaded = true
        state.stats.dropped++
        return
      }
    }
    n.pulse = 1

    if (p.dir === 1) {
      const trail = [...p.trail, n.id]
      const outs = liveTargets(n)
      if (roleOf(n) === 'sink' || outs.length === 0) {
        // Terminal hop. Turn the request into a response and retrace.
        state.stats.processed++
        const idx = trail.length - 1
        if (idx === 0) return
        send(n.id, trail[idx - 1], -1, trail, idx - 1)
      } else {
        const next = outs[n.rrIdx++ % outs.length]   // round robin
        send(n.id, next.id, 1, trail, 0)
      }
      return
    }

    // Response walking back down the forward trail.
    if (p.idx <= 0) return
    send(n.id, p.trail[p.idx - 1], -1, p.trail, p.idx - 1)
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

    // 2. packets are a progress value
    for (const p of state.packets) {
      if (!p.alive) continue
      p.progress += dt / p.dur
      if (p.progress >= 1) { p.alive = false; arrive(p) }
    }
    state.packets = state.packets.filter(p => p.alive)

    // 3. sliding window decides who is overloaded
    let hot = 0
    for (const n of state.nodes) {
      trim(n)
      const rate = n.rxLog.length * (1000 / WINDOW)
      n.overloaded = !n.dead && !n.hidden && rate > n.capacity
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
      if (n.pulse > 0) n.pulse = Math.max(0, n.pulse - dt / 300)
    }
  }

  function reset({ replay = false } = {}) {
    state.packets = []
    state.time = 0
    state.stats = { processed: 0, dropped: 0, overloaded: 0 }
    for (const n of state.nodes) {
      n.rxLog = []
      n.overloaded = false
      n.dead = false
      n.hidden = false
      n.spawnAccum = 0
      n.rrIdx = 0
      n.pulse = 0
      n.showRate = 0
      n.hot = 0
      n.rps = n.spec.rps ?? DEFAULT_RPS
    }
    if (replay) { state.animTime = 0; stageEntrance(0) }
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
    appearOf, reveal, stageEntrance,
  }
}
