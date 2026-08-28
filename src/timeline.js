// A timeline turns a topology into a story.
//
// Each step declares the FULL state it wants — which nodes exist, who is
// sending, what is dead — rather than a delta from the step before. That makes
// any step reachable directly: jump to step 7 and you get exactly what step 7
// looks like, whether you arrived by playing through or by seeking. The same
// property is what makes deterministic frame-by-frame video export possible
// later, so it is worth the small amount of repetition in the scene data.

import { clamp01 } from './ease.js'

export function createTimeline(sim, def) {
  const steps = def.steps
  const state = {
    idx: 0,
    elapsed: 0,
    total: steps.length,
    playing: false,
    done: false,
    appliedAt: 0,
  }

  function apply(i) {
    const s = steps[i]
    const show = s.show ? new Set(s.show) : null
    const dead = new Set(s.dead || [])

    for (const n of sim.state.nodes) {
      if (show) sim.reveal(n.id, show.has(n.id))

      if (n.dead !== dead.has(n.id)) {
        n.dead = dead.has(n.id)
        n.rxLog = []
        n.overloaded = false
      }

      // A step that names any traffic owns all of it: nodes it does not mention
      // fall silent. Otherwise a source switched on in step 2 would still be
      // running in step 6 and nobody would have written that down.
      if (s.traffic) n.rps = s.traffic[n.id] ?? 0

      // Focus dims everything the step is not talking about. Cheapest way to
      // aim the viewer's eye, and it costs the scene author one array.
      n.dimTarget = s.focus && !s.focus.includes(n.id) ? 1 : 0
    }

    // A step may narrow the topology to just the path it is talking about, so
    // a client does not quietly split its traffic down a route the story has
    // not introduced yet.
    if (s.edges) {
      const on = new Set(s.edges)
      for (const e of sim.state.edges) e.off = !on.has(`${e.from}>${e.to}`)
    }

    if (s.clearPackets) sim.state.packets = []
    state.appliedAt = sim.state.animTime
  }

  function goTo(i) {
    state.idx = Math.max(0, Math.min(steps.length - 1, i))
    state.elapsed = 0
    state.done = false
    apply(state.idx)
  }

  function step(dt) {
    if (!state.playing || state.done) return
    state.elapsed += dt
    const cur = steps[state.idx]
    if (state.elapsed < cur.duration) return
    if (state.idx < steps.length - 1) {
      goTo(state.idx + 1)
    } else {
      state.elapsed = cur.duration
      state.playing = false
      state.done = true
    }
  }

  const next = () => goTo(state.idx + 1)
  const prev = () => goTo(state.idx - 1)
  const progress = () => clamp01(state.elapsed / steps[state.idx].duration)

  function restart() {
    state.playing = true
    state.done = false
    goTo(0)
  }

  // What the renderer needs to draw the frame chrome.
  function chrome() {
    const s = steps[state.idx]
    return {
      watermark: def.watermark || '',
      title: def.title || '',
      label: s.label || '',
      note: s.note || '',
      index: state.idx + 1,
      total: steps.length,
      progress: progress(),
      annotations: s.annotations || null,
      gutter: s.gutter || 0,
      // seconds since this step landed, for annotation entrances
      enter: (sim.state.animTime - state.appliedAt) / 1000,
      key: state.idx,
    }
  }

  goTo(0)
  return { state, steps, apply, goTo, step, next, prev, progress, restart, chrome,
           get current() { return steps[state.idx] } }
}
