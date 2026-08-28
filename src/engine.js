// Wires the simulation to the renderer and owns the animation loop.

import { createSim } from './sim.js'
import { createRenderer } from './render.js'
import { createTimeline } from './timeline.js'
import { clamp01 } from './ease.js'

export function createEngine(canvas, sceneDef, opts = {}) {
  const renderer = createRenderer(canvas)
  const sim = createSim(sceneDef, { portrait: isPortrait() })
  let timeline = sceneDef.steps ? createTimeline(sim, sceneDef) : null

  let raf = null
  let last = 0
  const onStats = opts.onStats || (() => {})

  function isPortrait() {
    const r = canvas.getBoundingClientRect()
    return r.height > r.width
  }

  function frame(now) {
    const dt = Math.min(64, now - (last || now))   // clamp so tab switches don't teleport
    last = now
    if (sim.state.running) {
      if (timeline) timeline.step(dt)
      sim.step(dt)
      onStats(sim.state.stats)
    }
    sim.advanceAnim(dt)   // always: entrances and meters keep easing while paused
    renderer.draw(sim, timeline ? timeline.chrome() : null)
    raf = requestAnimationFrame(frame)
  }

  function start() {
    if (raf == null) { last = 0; raf = requestAnimationFrame(frame) }
  }

  function stop() {
    if (raf != null) { cancelAnimationFrame(raf); raf = null }
  }

  function play() {
    sim.state.running = true
    if (timeline) {
      // Replaying from the end restarts the story rather than sitting on the
      // last frame doing nothing.
      if (timeline.state.done) { sim.reset({ replay: true }); timeline.restart() }
      else timeline.state.playing = true
    }
  }

  function pause() {
    sim.state.running = false
    if (timeline) timeline.state.playing = false
  }
  function toggle() { sim.state.running ? pause() : play() }

  function reset() {
    sim.reset({ replay: true })   // replay the build-in, not just zero the counters
    sim.state.running = false
    if (timeline) { timeline.state.playing = false; timeline.goTo(0) }
    onStats(sim.state.stats)
  }

  function load(def) {
    sim.load(def)
    sim.relayout(isPortrait())
    sim.state.running = false
    timeline = def.steps ? createTimeline(sim, def) : null
    renderer.fit(sim.state.nodes)
    onStats(sim.state.stats)
  }

  // Stepping by hand is how you author and how you screenshot a single beat.
  function goToStep(i) {
    if (!timeline) return
    timeline.goTo(i)
    onStats(sim.state.stats)
  }

  function resize() {
    renderer.resize()
    sim.relayout(isPortrait())
    renderer.fit(sim.state.nodes)
  }

  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  // One gesture, two meanings: press and release without moving is a kill,
  // press and drag repositions. The 4px threshold is what separates them, so a
  // slightly shaky click still reads as a click.
  const DRAG_SLOP = 4
  let drag = null

  const pointAt = ev => {
    const r = canvas.getBoundingClientRect()
    return { x: ev.clientX - r.left, y: ev.clientY - r.top }
  }

  // Dragging writes back into the scene spec for the layout currently on screen,
  // so switching aspect and back does not throw the arrangement away.
  function writeBack(n) {
    if (sim.state.portrait) n.spec.portrait = [n.x, n.y]
    else { n.spec.x = n.x; n.spec.y = n.y }
  }

  canvas.addEventListener('pointerdown', ev => {
    const { x, y } = pointAt(ev)
    const n = renderer.hitTest(sim, x, y)
    if (!n) return
    const { W, H } = renderer.size
    drag = {
      node: n, startX: x, startY: y, moved: false,
      offX: x - n.x * W, offY: y - n.y * H,
    }
    try { canvas.setPointerCapture(ev.pointerId) } catch {}
  })

  canvas.addEventListener('pointermove', ev => {
    const { x, y } = pointAt(ev)
    if (!drag) {
      canvas.style.cursor = renderer.hitTest(sim, x, y) ? 'grab' : 'default'
      return
    }
    if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) > DRAG_SLOP) {
      drag.moved = true
      canvas.style.cursor = 'grabbing'
    }
    if (!drag.moved) return
    const { W, H } = renderer.size
    drag.node.x = clamp01((x - drag.offX) / W)
    drag.node.y = clamp01((y - drag.offY) / H)
    writeBack(drag.node)
  })

  function endDrag(ev) {
    if (!drag) return
    if (!drag.moved) { sim.kill(drag.node.id); onStats(sim.state.stats) }
    else renderer.fit(sim.state.nodes)
    canvas.style.cursor = 'grab'
    try { canvas.releasePointerCapture(ev.pointerId) } catch {}
    drag = null
  }

  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)

  // The fractional coordinates for whatever is currently on screen, ready to
  // paste back into a scene file.
  function layout() {
    return sim.state.nodes.map(n => ({
      id: n.id, x: +n.x.toFixed(3), y: +n.y.toFixed(3),
    }))
  }

  function destroy() {
    stop()
    ro.disconnect()
  }

  resize()
  start()
  return {
    sim, renderer, play, pause, toggle, reset, load, resize, destroy,
    goToStep, layout, state: sim.state,
    get timeline() { return timeline },
  }
}
