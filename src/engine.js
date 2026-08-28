// Wires the simulation to the renderer and owns the animation loop.

import { createSim } from './sim.js'
import { createRenderer } from './render.js'
import { createTimeline } from './timeline.js'
import { typeOf } from './registry.js'
import { clamp01 } from './ease.js'
import { WORLD_MIN, WORLD_MAX } from './scene.js'
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

  // --- deterministic stepping, for export ------------------------------------
  // The rAF loop hands the sim whatever dt the display gave it. Export needs the
  // opposite: a dt we choose, so the same clip renders identically anywhere.

  let restoreCamera = null

  function beginExport() {
    stop()                       // take the rAF loop out of the way
    // A recording must be the export frame, not whatever you were looking at.
    // Without this, panning before pressing record silently changed the video.
    restoreCamera = renderer.frameCamera()
    renderer.fit(sim.state.nodes, true)     // an export is always a composition
    sim.reset({ replay: true })
    sim.state.running = true
    if (timeline) { timeline.restart(); timeline.state.playing = true }
  }

  function stepFrame(dt) {
    if (sim.state.running) {
      if (timeline) timeline.step(dt)
      sim.step(dt)
    }
    sim.advanceAnim(dt)
    renderer.draw(sim, timeline ? timeline.chrome() : null, dt)
  }

  function endExport() {
    if (restoreCamera) { restoreCamera(); restoreCamera = null }
    sim.state.running = false
    if (timeline) timeline.state.playing = false
    onStats(sim.state.stats)
    start()                      // hand the loop back
  }

  function play() {
    if (mode !== 'play') { mode = 'play'; clearSelection(); onMode(mode) }
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
    // Opening a board is an editing act. Without this you inherited Play from
    // whatever ran last, and your first click killed something.
    if (mode !== 'edit') { mode = 'edit'; onMode(mode) }
    clearSelection()
    sim.load(def)
    sim.relayout(isPortrait())
    sim.state.running = false
    timeline = def.steps ? createTimeline(sim, def) : null
    renderer.fit(sim.state.nodes, !!timeline)
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
    renderer.fit(sim.state.nodes, !!timeline)
  }

  const typing = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

  function onKey(ev) {
    if (typing(ev.target)) return
    const mod = ev.metaKey || ev.ctrlKey

    if (mod && ev.key.toLowerCase() === 'z') {
      ev.preventDefault()
      return void (ev.shiftKey ? redo() : undo())
    }
    if (mod && ev.key.toLowerCase() === 'd') {
      ev.preventDefault()
      return duplicateSelection()
    }
    if (ev.code === 'Space') { spaceDown = true; canvas.style.cursor = 'grab'; return }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selection.size) {
      ev.preventDefault()
      mark()
      for (const id of [...selection]) sim.removeNode(id)
      clearSelection()
      if (sim.state.scene.autoLayout) sim.autoLayout()
      renderer.fit(sim.state.nodes, !!timeline)
      onStats(sim.state.stats)
    }
    if (ev.key === 'Escape') clearSelection()
  }

  function onKeyUp(ev) {
    if (ev.code === 'Space') { spaceDown = false; canvas.style.cursor = 'default' }
  }

  // Copies sit down-right of their originals, the way every canvas tool does it,
  // so the copy is visible instead of hiding exactly behind the thing it copied.
  // One place that writes a property, so the runtime node and the scene spec can
  // never drift apart. Blank clears the override and the type's default returns.
  function setNodeProp(id, key, value) {
    const n = sim.byId(id)
    if (!n) return
    mark()
    if (value === '' || value == null) delete n.spec[key]
    else n.spec[key] = value
    if (key === 'label') n.label = value || typeOf(n).name
    if (key === 'rps') n.rps = Number(value) || 0
    onStats(sim.state.stats)
  }

  function duplicateSelection() {
    if (!selection.size) return
    mark()
    const made = []
    for (const id of [...selection]) {
      const n = sim.byId(id)
      if (!n) continue
      const copy = sim.addNode(n.type, n.x + 0.04, n.y + 0.06)
      if (!copy) continue
      Object.assign(copy.spec, { ...n.spec, id: copy.id, x: copy.x, y: copy.y })
      copy.label = n.label
      made.push(copy.id)
    }
    select(made)
    renderer.fit(sim.state.nodes, !!timeline)
    onStats(sim.state.stats)
  }

  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)

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
    renderer.fit(sim.state.nodes, !!timeline)
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

  // --- modes -----------------------------------------------------------------
  // Edit and Play were fused, and their gestures collided: a click could not
  // both select a node and kill it. Splitting them is what makes selection —
  // and everything selection unlocks — possible at all.
  let mode = 'edit'
  const selection = new Set()
  const onMode = opts.onMode || (() => {})

  function setMode(m) {
    if (m === mode) return
    mode = m
    if (m === 'edit') pause()
    clearSelection()
    onMode(mode)
  }

  function clearSelection() {
    selection.clear()
    renderer.setSelection(selection)
    onSelection([...selection])
  }

  function select(ids, { add = false } = {}) {
    if (!add) selection.clear()
    for (const id of ids) add && selection.has(id) ? selection.delete(id) : selection.add(id)
    renderer.setSelection(selection)
    onSelection([...selection])
  }

  const onSelection = opts.onSelection || (() => {})

  const DRAG_SLOP = 4
  let drag = null
  let panning = null
  let wire = null
  let secDrag = null
  let marquee = null
  let spaceDown = false
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
      // In Edit, empty space draws a selection band; hold space or use the
      // middle button to pan instead. In Play there is nothing to select, so
      // dragging just moves the camera.
      const wantsPan = mode === 'play' || spaceDown || ev.button === 1
      if (wantsPan) {
        panning = { x, y }
      } else {
        const f = renderer.toFrame(x, y)
        marquee = { x0: f.x, y0: f.y, x1: f.x, y1: f.y, add: ev.shiftKey }
        renderer.setMarquee(marquee)
        if (!ev.shiftKey) clearSelection()
      }
      try { canvas.setPointerCapture(ev.pointerId) } catch {}
      return
    }

    // Selecting is an Edit-mode idea. In Play, a click still kills.
    if (mode === 'edit') {
      if (ev.shiftKey) select([n.id], { add: true })
      else if (!selection.has(n.id)) select([n.id])
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

    if (marquee) {
      const f = renderer.toFrame(x, y)
      marquee.x1 = f.x
      marquee.y1 = f.y
      renderer.setMarquee(marquee)
      canvas.style.cursor = 'crosshair'
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
    const world = v => Math.max(WORLD_MIN, Math.min(WORLD_MAX, v))
    const beforeX = drag.node.x, beforeY = drag.node.y
    drag.node.x = world(renderer.fromPx(f.x - drag.offX))
    drag.node.y = world((f.y - drag.offY) / H)
    const snapped = renderer.snapNode(drag.node, sim.state.nodes)
    drag.node.x = world(snapped.x)
    drag.node.y = world(snapped.y)
    writeBack(drag.node)

    // Everything else selected moves by the same delta, so a group keeps its shape.
    const dx = drag.node.x - beforeX, dy = drag.node.y - beforeY
    if ((dx || dy) && selection.size > 1) {
      for (const id of selection) {
        if (id === drag.node.id) continue
        const o = sim.byId(id)
        if (!o) continue
        o.x = world(o.x + dx)
        o.y = world(o.y + dy)
        writeBack(o)
      }
    }
  })

  function endDrag(ev) {
    if (marquee) {
      const caught = renderer.nodesInMarquee(sim.state.nodes).map(n => n.id)
      if (caught.length) select(caught, { add: marquee.add })
      marquee = null
      renderer.setMarquee(null)
      canvas.style.cursor = 'default'
      try { canvas.releasePointerCapture(ev.pointerId) } catch {}
      return
    }
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
    if (!drag.moved && mode === 'play') { sim.kill(drag.node.id); onStats(sim.state.stats) }
    else renderer.fit(sim.state.nodes, !!timeline)
    renderer.clearGuides()
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
    renderer.fit(sim.state.nodes, !!timeline)
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
    if (n) { renderer.fit(sim.state.nodes, !!timeline); onStats(sim.state.stats) }
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
    window.removeEventListener('keyup', onKeyUp)
  }

  resize()
  start()
  return {
    sim, renderer, play, pause, toggle, reset, load, resize, destroy,
    goToStep, layout, state: sim.state,
    undo, redo, canUndo, canRedo, clearHistory,
    setNodeProp, setMode, get mode() { return mode }, select, clearSelection,
    get selection() { return [...selection] }, duplicateSelection,
    beginExport, stepFrame, endExport,
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
      if (n) { renderer.fit(sim.state.nodes, !!timeline); onStats(sim.state.stats) }
      return n
    },
    get timeline() { return timeline },
  }
}
