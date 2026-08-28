// Wires the simulation to the renderer and owns the animation loop.

import { createSim } from './sim.js'
import { createRenderer } from './render.js'
import { createTimeline } from './timeline.js'
import { clamp01 } from './ease.js'
import { connectionError } from './registry.js'

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
    renderer.draw(sim, timeline ? timeline.chrome() : null, dt)
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
    clearHistory()
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
    if (sim.state.scene.autoLayout) sim.autoLayout()
    renderer.fit(sim.state.nodes)
  }

  function onKey(ev) {
    const mod = ev.metaKey || ev.ctrlKey
    if (!mod || ev.key.toLowerCase() !== 'z') return
    const t = ev.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    ev.preventDefault()
    ev.shiftKey ? redo() : undo()
  }
  window.addEventListener('keydown', onKey)

  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  // One gesture, two meanings: press and release without moving is a kill,
  // press and drag repositions. The 4px threshold is what separates them, so a
  // slightly shaky click still reads as a click.
  // --- undo -----------------------------------------------------------------
  // mark() is called BEFORE a mutation, once per gesture: a drag marks at
  // pointerdown, not on every move, so one drag is one undo step.
  const past = []
  const future = []
  const HISTORY = 80

  function mark() {
    past.push(sim.snapshot())
    if (past.length > HISTORY) past.shift()
    future.length = 0
    onHistory(canUndo(), canRedo())
  }

  const canUndo = () => past.length > 0
  const canRedo = () => future.length > 0

  function undo() {
    if (!past.length) return false
    future.push(sim.snapshot())
    sim.restore(past.pop())
    afterHistory()
    return true
  }

  function redo() {
    if (!future.length) return false
    past.push(sim.snapshot())
    sim.restore(future.pop())
    afterHistory()
    return true
  }

  function afterHistory() {
    if (sim.state.scene.autoLayout) sim.autoLayout()
    renderer.fit(sim.state.nodes)
    renderer.setHover(null)
    renderer.setHoverEdge(null)
    renderer.setHoverSection(null)
    onStats(sim.state.stats)
    onHistory(canUndo(), canRedo())
  }

  function clearHistory() {
    past.length = 0
    future.length = 0
    onHistory(false, false)
  }

  const DRAG_SLOP = 4
  let drag = null
  let panning = null
  let wire = null
  let secDrag = null
  const onNotice = opts.onNotice || (() => {})
  const onHistory = opts.onHistory || (() => {})

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

    // A + handle wins over the card under it, so grabbing a handle never starts
    // a move by accident.
    const handle = renderer.handleAt(sim, x, y)
    if (handle) {
      const f = renderer.toFrame(x, y)
      wire = { from: handle.node.id, x: f.x, y: f.y, ok: null }
      renderer.setPending(wire)
      try { canvas.setPointerCapture(ev.pointerId) } catch {}
      return
    }

    const n = renderer.hitTest(sim, x, y)
    if (!n) {
      // A section's title strip moves the section and everything inside it.
      const sec = renderer.sectionHeadAt(sim, x, y)
      if (sec) {
        const f = renderer.toFrame(x, y)
        mark()
        secDrag = { id: sec.id, fx: f.x, fy: f.y, moved: false }
        try { canvas.setPointerCapture(ev.pointerId) } catch {}
        return
      }
      // Empty space pans the camera, the way any canvas tool behaves.
      panning = { x, y }
      try { canvas.setPointerCapture(ev.pointerId) } catch {}
      return
    }
    const { W, H } = renderer.size
    const f = renderer.toFrame(x, y)
    mark()
    drag = {
      node: n, startX: x, startY: y, moved: false,
      offX: f.x - (renderer.gutter + n.x * (1 - renderer.gutter)) * W,
      offY: f.y - n.y * H,
    }
    try { canvas.setPointerCapture(ev.pointerId) } catch {}
  })

  canvas.addEventListener('pointermove', ev => {
    const { x, y } = pointAt(ev)

    if (wire) {
      const f = renderer.toFrame(x, y)
      wire.x = f.x
      wire.y = f.y
      const target = renderer.hitTest(sim, x, y)
      wire.ok = target
        ? !connectionError(sim.byId(wire.from), target, sim.state.edges)
        : null
      canvas.style.cursor = wire.ok === false ? 'not-allowed' : 'crosshair'
      return
    }

    if (secDrag) {
      const f = renderer.toFrame(x, y)
      const { W, H } = renderer.size
      const dx = (f.x - secDrag.fx) / (W * (1 - renderer.gutter))
      const dy = (f.y - secDrag.fy) / H
      if (dx || dy) {
        sim.moveSection(secDrag.id, dx, dy)
        secDrag.fx = f.x
        secDrag.fy = f.y
        secDrag.moved = true
      }
      canvas.style.cursor = 'grabbing'
      return
    }

    if (panning) {
      renderer.panBy(x - panning.x, y - panning.y)
      panning = { x, y }
      canvas.style.cursor = 'grabbing'
      return
    }

    if (!drag) {
      // Hover uses the halo so the handles stay up while you reach for one;
      // everything else still targets the card itself.
      const over = renderer.hoverTargetAt(sim, x, y)
      renderer.setHover(over ? over.id : null)
      // Only arm a wire for deletion when nothing else is under the cursor.
      const onCard = renderer.hitTest(sim, x, y)
      renderer.setHoverEdge(over || renderer.handleAt(sim, x, y)
        ? null : renderer.edgeHitTest(sim, x, y))
      const head = onCard ? null : renderer.sectionHeadAt(sim, x, y)
      renderer.setHoverSection(head ? head.id : null)
      canvas.style.cursor = renderer.handleAt(sim, x, y) ? 'crosshair'
        : onCard || head ? 'grab' : 'default'
      return
    }
    if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) > DRAG_SLOP) {
      drag.moved = true
      canvas.style.cursor = 'grabbing'
    }
    if (!drag.moved) return
    const { H } = renderer.size
    const f = renderer.toFrame(x, y)
    drag.node.x = clamp01(renderer.fromPx(f.x - drag.offX))
    drag.node.y = clamp01((f.y - drag.offY) / H)
    writeBack(drag.node)
  })

  function endDrag(ev) {
    if (secDrag) {
      secDrag = null
      canvas.style.cursor = 'default'
      try { canvas.releasePointerCapture(ev.pointerId) } catch {}
      return
    }
    if (wire) {
      const { x, y } = pointAt(ev)
      const target = renderer.hitTest(sim, x, y)
      if (target) {
        mark()
        const why = sim.connect(wire.from, target.id)
        if (why) { past.pop(); onNotice(why) }   // a refused wire is not a step
        else onStats(sim.state.stats)
      }
      renderer.setPending(null)
      wire = null
      canvas.style.cursor = 'default'
      try { canvas.releasePointerCapture(ev.pointerId) } catch {}
      return
    }
    if (panning) {
      panning = null
      canvas.style.cursor = 'default'
      try { canvas.releasePointerCapture(ev.pointerId) } catch {}
      return
    }
    if (!drag) return
    if (!drag.moved) { sim.kill(drag.node.id); onStats(sim.state.stats) }
    else renderer.fit(sim.state.nodes)
    canvas.style.cursor = 'grab'
    try { canvas.releasePointerCapture(ev.pointerId) } catch {}
    drag = null
  }

  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)

  canvas.addEventListener('wheel', ev => {
    ev.preventDefault()
    const { x, y } = pointAt(ev)
    renderer.zoomAt(x, y, ev.deltaY < 0 ? 1.12 : 1 / 1.12)
  }, { passive: false })

  canvas.addEventListener('dblclick', () => renderer.resetCamera())

  // Right-click removes: a node with its wires, or a single wire. The same
  // gesture on both, which is what the cursor highlight is telling you.
  canvas.addEventListener('contextmenu', ev => {
    ev.preventDefault()
    const { x, y } = pointAt(ev)
    const node = renderer.hitTest(sim, x, y)
    if (node) {
      mark()
      sim.removeNode(node.id)
      renderer.setHover(null)
    } else {
      const sec = renderer.sectionHeadAt(sim, x, y)
      if (sec) {
        // Removing the grouping never removes what was grouped.
        mark()
        sim.removeSection(sec.id)
        renderer.setHoverSection(null)
      } else {
        const edge = renderer.edgeHitTest(sim, x, y)
        if (!edge) return
        mark()
        sim.disconnect(edge.from, edge.to)
        renderer.setHoverEdge(null)
      }
    }
    if (sim.state.scene.autoLayout) sim.autoLayout()
    renderer.fit(sim.state.nodes)
    onStats(sim.state.stats)
  })

  // Drop a type from the palette onto the board.
  canvas.addEventListener('dragover', ev => { ev.preventDefault() })
  canvas.addEventListener('drop', ev => {
    ev.preventDefault()
    const type = ev.dataTransfer?.getData('text/visualizcy-type')
    if (!type) return
    const { x, y } = pointAt(ev)
    const f = renderer.toFrame(x, y)
    const { W, H } = renderer.size
    mark()
    const n = sim.addNode(type, renderer.fromPx(f.x), f.y / H)
    if (n) { renderer.fit(sim.state.nodes); onStats(sim.state.stats) }
    else past.pop()
  })

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
    window.removeEventListener('keydown', onKey)
  }

  resize()
  start()
  return {
    sim, renderer, play, pause, toggle, reset, load, resize, destroy,
    goToStep, layout, state: sim.state,
    undo, redo, canUndo, canRedo, clearHistory,
    resetCamera: () => renderer.resetCamera(),
    addSection: (label, x, y, w, h) => {
      mark()
      const sec = sim.addSection(label, x, y, w, h)
      onStats(sim.state.stats)
      return sec
    },
    addNode: (type, fx, fy) => {
      mark()
      const n = sim.addNode(type, fx, fy)
      if (n) { renderer.fit(sim.state.nodes); onStats(sim.state.stats) }
      return n
    },
    get timeline() { return timeline },
  }
}
