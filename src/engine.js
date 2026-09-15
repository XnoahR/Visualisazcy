// Wires the simulation to the renderer and owns the animation loop.

import { createSim } from './sim.js'
import { createRenderer } from './render.js'
import { createTimeline } from './timeline.js'
import { typeOf } from './registry.js'
import { clamp01 } from './ease.js'
import { WORLD_MIN, WORLD_MAX } from './scene.js'
import { connectionError } from './registry.js'
import { groupById } from './groups.js'

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
    renderer.fit(sim, true)     // an export is always a composition
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
    renderer.fit(sim, !!timeline)
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
    renderer.fit(sim, !!timeline)
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
    if (mod && ev.key.toLowerCase() === 'g') {
      ev.preventDefault()
      return ev.shiftKey ? ungroupSelection() : groupSelection()
    }
    if (ev.code === 'Space') { spaceDown = true; canvas.style.cursor = 'grab'; return }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selection.size) {
      ev.preventDefault()
      mark()
      // Deleting a folded card deletes what it stands for. That is what the
      // card represents, and undo is what makes it safe to mean it.
      for (const id of [...selection]) {
        if (groupById(sim.state, id)) sim.removeGroup(id, { deep: true })
        else sim.removeNode(id)
      }
      clearSelection()
      if (sim.state.scene.autoLayout) sim.autoLayout()
      renderer.fit(sim, !!timeline)
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
    renderer.fit(sim, !!timeline)
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
    renderer.fit(sim, !!timeline)
    renderer.setHover(null)
    renderer.setHoverEdge(null)
    renderer.setHoverSection(null)
    renderer.setHoverGroup(null)
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
  // An edge is a pair, not an id, so it cannot live in `selection` — but it has
  // properties now and the inspector has to be able to reach it.
  let selectedEdge = null
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
    selectedEdge = null
    renderer.setSelection(selection)
    onSelection([...selection])
  }

  function select(ids, { add = false } = {}) {
    if (ids.length) selectedEdge = null
    if (!add) selection.clear()
    for (const id of ids) add && selection.has(id) ? selection.delete(id) : selection.add(id)
    renderer.setSelection(selection)
    onSelection([...selection])
  }

  const onSelection = opts.onSelection || (() => {})

  // --- groups ---------------------------------------------------------------
  // Grouping is the same gesture at every level: select two folded services and
  // it builds a region out of them, exactly as it builds a service out of nodes.
  function groupSelection() {
    if (mode !== 'edit') return onNotice('grouping is an Edit-mode action')
    const ids = [...selection]
    if (ids.length < 2) return onNotice('select at least two objects to group')
    mark()
    const r = sim.addGroup(opts.groupName?.() || 'Service', ids)
    if (r.error) { past.pop(); onHistory(canUndo(), canRedo()); return onNotice(r.error) }
    select([r.group.id])
    renderer.fit(sim, !!timeline)
    onStats(sim.state.stats)
    return r.group
  }

  // Two jobs, one gesture: dissolve a selected group, or take a selected object
  // out of the group holding it.
  function ungroupSelection() {
    const ids = [...selection]
    const groups = ids.filter(id => groupById(sim.state, id))
    const members = ids.filter(id => !groupById(sim.state, id) && sim.parentOf(id))
    if (!groups.length && !members.length) return onNotice('nothing selected belongs to a group')
    mark()
    for (const id of groups) sim.removeGroup(id)
    for (const id of members) sim.removeFromGroup(id)
    renderer.fit(sim, !!timeline)
    onSelection([...selection])
    onStats(sim.state.stats)
  }

  function removeFromGroup(id) {
    if (!sim.parentOf(id)) return
    mark()
    sim.removeFromGroup(id)
    renderer.fit(sim, !!timeline)
    onSelection([...selection])
    onStats(sim.state.stats)
  }

  // A section dropped at a fixed spot in the middle lands on top of whatever is
  // already there and silently adopts it — and then moving it hauls objects you
  // never grouped. So it wraps the selection when there is one, and otherwise
  // goes looking for a clear patch.
  function addSectionAuto(label = 'Section') {
    const items = renderer.view(sim).items.filter(i => i.appear > 0)
    const { W, H } = renderer.size
    const padX = (168 * renderer.scale / 2) / W + 0.035
    const padY = (62 * renderer.scale / 2) / H + 0.05
    const picked = items.filter(i => selection.has(i.id))

    let r
    if (picked.length) {
      const xs = picked.map(i => i.x), ys = picked.map(i => i.y)
      r = { x: Math.min(...xs) - padX, y: Math.min(...ys) - padY,
            w: Math.max(...xs) - Math.min(...xs) + padX * 2,
            h: Math.max(...ys) - Math.min(...ys) + padY * 2 }
    } else {
      r = emptiestRect(items)
    }
    r.x = clamp01(r.x); r.y = clamp01(r.y)
    r.w = Math.min(Math.max(r.w, 0.1), 1 - r.x)
    r.h = Math.min(Math.max(r.h, 0.1), 1 - r.y)
    mark()
    const sec = sim.addSection(label, r.x, r.y, r.w, r.h)
    onStats(sim.state.stats)
    return sec
  }

  // The nearest clear patch to the middle, because the middle is where you are
  // looking. Scanning from a corner instead is predictable but puts a new
  // section where nobody asked for it.
  function emptiestRect(items) {
    const w = 0.3, h = 0.32
    const spots = []
    for (let x = 0.02; x <= 1 - w; x += 0.05) {
      for (let y = 0.02; y <= 1 - h; y += 0.05) {
        spots.push({ x, y, d: Math.hypot(x + w / 2 - 0.5, y + h / 2 - 0.5) })
      }
    }
    spots.sort((a, b) => a.d - b.d)
    let best = { x: 0.35, y: 0.34, n: Infinity }
    for (const p of spots) {
      const n = items.filter(i => i.x >= p.x && i.x <= p.x + w && i.y >= p.y && i.y <= p.y + h).length
      if (n === 0) return { x: p.x, y: p.y, w, h }
      if (n < best.n) best = { x: p.x, y: p.y, n }
    }
    return { x: best.x, y: best.y, w, h }
  }

  function setFolded(id, folded) {
    if (!groupById(sim.state, id)) return
    mark()
    sim.setFolded(id, folded)
    renderer.setHoverGroup(null)
    renderer.fit(sim, !!timeline)
    onStats(sim.state.stats)
  }

  const DRAG_SLOP = 4
  let drag = null
  let panning = null
  let wire = null
  let secDrag = null
  let secResize = null
  let grpDrag = null
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
      // The fold control first: it sits inside the group's title strip, which
      // would otherwise start a drag on the way to clicking it.
      const chev = renderer.groupChevronAt(sim, x, y)
      if (chev) { setFolded(chev.id, true); return }

      // A group's title strip moves the group and everything it holds, the same
      // deal a section's strip offers.
      const grp = renderer.groupHeadAt(sim, x, y)
      if (grp) {
        const f = renderer.toFrame(x, y)
        // Select as well as drag. Without this an open group could never be
        // reached by the inspector, so there was no way to rename one.
        if (mode === 'edit') select([grp.id])
        mark()
        grpDrag = { id: grp.id, fx: f.x, fy: f.y }
        try { canvas.setPointerCapture(ev.pointerId) } catch {}
        return
      }

      // A corner grip resizes; the title strip moves. Checked first because the
      // grips sit on the section's outline, which the strip also touches.
      const grip = renderer.sectionGripAt(sim, x, y)
      if (grip) {
        const f = renderer.toFrame(x, y)
        mark()
        secResize = { ...grip, fx: f.x, fy: f.y }
        try { canvas.setPointerCapture(ev.pointerId) } catch {}
        return
      }

      // A section's title strip moves the section and everything inside it.
      const sec = renderer.sectionHeadAt(sim, x, y)
      if (sec) {
        const f = renderer.toFrame(x, y)
        mark()
        secDrag = { id: sec.id, fx: f.x, fy: f.y, moved: false, alone: ev.altKey }
        try { canvas.setPointerCapture(ev.pointerId) } catch {}
        return
      }
      // In Edit, empty space draws a selection band; hold space or use the
      // middle button to pan instead. In Play there is nothing to select, so
      // dragging just moves the camera.
      // A wire under the cursor is a thing you meant to click, not empty space
      // to drag a band across.
      const onWire = mode === 'edit' && !spaceDown && ev.button === 0
        ? renderer.edgeHitTest(sim, x, y) : null
      if (onWire && onWire.real?.length === 1) {
        clearSelection()
        selectedEdge = sim.linkBetween(onWire.real[0].from, onWire.real[0].to) || null
        onSelection([])
        try { canvas.setPointerCapture(ev.pointerId) } catch {}
        return
      }

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
    // A view item, which may be a node or a folded group card. What the drag
    // does differs; where it starts does not.
    drag = {
      item: n, startX: x, startY: y, moved: false, alt: ev.altKey,
      offX: f.x - (renderer.gutter + n.x * (1 - renderer.gutter)) * W,
      offY: f.y - n.y * H,
    }
    try { canvas.setPointerCapture(ev.pointerId) } catch {}
  })

  // Live position for a view item. An item is a snapshot taken at pointerdown,
  // so reading x off it mid-drag reads a stale number.
  function liveOf(item) {
    return item.kind === 'group' ? groupById(sim.state, item.id) : sim.byId(item.id)
  }

  // Moving anything selected by the same delta, whichever kind it is.
  function nudge(id, dx, dy, world) {
    if (groupById(sim.state, id)) return sim.moveGroup(id, dx, dy)
    const o = sim.byId(id)
    if (!o) return
    o.x = world(o.x + dx)
    o.y = world(o.y + dy)
    writeBack(o)
  }

  canvas.addEventListener('pointermove', ev => {
    const { x, y } = pointAt(ev)

    if (wire) {
      const f = renderer.toFrame(x, y)
      wire.x = f.x
      wire.y = f.y
      const target = renderer.hitTest(sim, x, y)
      // A folded card cannot take a wire: there is no way to know which member
      // inside it the connection is meant for. Unfold to rewire.
      wire.ok = !target ? null
        : target.kind === 'group' ? false
        : !connectionError(sim.byId(wire.from), target.node, sim.state.edges)
      canvas.style.cursor = wire.ok === false ? 'not-allowed' : 'crosshair'
      return
    }

    if (grpDrag) {
      const f = renderer.toFrame(x, y)
      const { W, H } = renderer.size
      const dx = (f.x - grpDrag.fx) / (W * (1 - renderer.gutter))
      const dy = (f.y - grpDrag.fy) / H
      if (dx || dy) {
        sim.moveGroup(grpDrag.id, dx, dy)
        grpDrag.fx = f.x
        grpDrag.fy = f.y
      }
      canvas.style.cursor = 'grabbing'
      return
    }

    if (secResize) {
      const f = renderer.toFrame(x, y)
      const { W, H } = renderer.size
      sim.resizeSection(secResize.id, secResize.corner,
        (f.x - secResize.fx) / (W * (1 - renderer.gutter)), (f.y - secResize.fy) / H)
      secResize.fx = f.x
      secResize.fy = f.y
      canvas.style.cursor = 'nwse-resize'
      return
    }

    if (secDrag) {
      const f = renderer.toFrame(x, y)
      const { W, H } = renderer.size
      const dx = (f.x - secDrag.fx) / (W * (1 - renderer.gutter))
      const dy = (f.y - secDrag.fy) / H
      if (dx || dy) {
        sim.moveSection(secDrag.id, dx, dy, { carry: !secDrag.alone })
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
      const chev = onCard ? null : renderer.groupChevronAt(sim, x, y)
      const gHead = onCard ? null : renderer.groupHeadAt(sim, x, y)
      renderer.setHoverGroup(chev ? chev.id : gHead ? gHead.id : null)

      const grip = onCard || chev || gHead ? null : renderer.sectionGripAt(sim, x, y)
      const head = onCard || chev || gHead ? null : renderer.sectionHeadAt(sim, x, y)
      // Hovering a grip keeps its section armed, so the grips stay drawn while
      // you reach for one — the same trap the + handles fell into.
      renderer.setHoverSection(grip ? grip.id : head ? head.id : null)
      if (grip) { canvas.style.cursor = 'nwse-resize'; return }
      if (chev) { canvas.style.cursor = 'pointer'; return }
      canvas.style.cursor = renderer.handleAt(sim, x, y) ? 'crosshair'
        : onCard || head || gHead ? 'grab' : 'default'
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
    const live = liveOf(drag.item)
    if (!live) return
    const beforeX = live.x, beforeY = live.y

    // Snap against everything on the surface, folded cards included.
    const want = {
      id: drag.item.id, kind: drag.item.kind,
      x: world(renderer.fromPx(f.x - drag.offX)),
      y: world((f.y - drag.offY) / H),
    }
    const snapped = renderer.snapNode(want, renderer.view(sim).items)
    const nx = world(snapped.x), ny = world(snapped.y)

    // Dragging a folded card carries every member by the same delta, which is
    // what keeps the card sitting on its own centroid when it is folded again.
    if (drag.item.kind === 'group') sim.moveGroup(drag.item.id, nx - live.x, ny - live.y)
    else { live.x = nx; live.y = ny; writeBack(live) }

    const dx = live.x - beforeX, dy = live.y - beforeY
    if ((dx || dy) && selection.size > 1) {
      for (const id of selection) {
        if (id === drag.item.id) continue
        nudge(id, dx, dy, world)
      }
    }
  })

  function endDrag(ev) {
    if (marquee) {
      const caught = renderer.nodesInMarquee(sim).map(n => n.id)
      if (caught.length) select(caught, { add: marquee.add })
      marquee = null
      renderer.setMarquee(null)
      canvas.style.cursor = 'default'
      try { canvas.releasePointerCapture(ev.pointerId) } catch {}
      return
    }
    if (grpDrag) {
      grpDrag = null
      canvas.style.cursor = 'default'
      try { canvas.releasePointerCapture(ev.pointerId) } catch {}
      return
    }
    if (secResize) {
      secResize = null
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
      if (target?.kind === 'group') {
        onNotice('unfold the group to wire into it')
      } else if (target) {
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
    // Killing is a node idea; there is no meaning to killing a boundary.
    // Alt is the difference between "this is gone" and "this has gone bad",
    // which are different outages and look different on the board.
    if (!drag.moved && mode === 'play' && drag.item.kind === 'node') {
      if (drag.alt) sim.degrade(drag.item.id)
      else sim.kill(drag.item.id)
      onStats(sim.state.stats)
    } else renderer.fit(sim, !!timeline)
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

  // Double-click opens a folded card. Edit only: in Play the first of the two
  // clicks has already killed something, so the gesture cannot mean this there.
  canvas.addEventListener('dblclick', ev => {
    const { x, y } = pointAt(ev)
    const it = mode === 'edit' ? renderer.hitTest(sim, x, y) : null
    if (it?.kind === 'group') { setFolded(it.id, false); clearSelection(); return }
    renderer.resetCamera()
  })

  // Right-click removes: a node with its wires, or a single wire. The same
  // gesture on both, which is what the cursor highlight is telling you.
  canvas.addEventListener('contextmenu', ev => {
    ev.preventDefault()
    const { x, y } = pointAt(ev)
    const node = renderer.hitTest(sim, x, y)
    const grp = node ? null : renderer.groupHeadAt(sim, x, y)
    const sec = node || grp ? null : renderer.sectionHeadAt(sim, x, y)
    if (node) {
      mark()
      if (node.kind === 'group') sim.removeGroup(node.id, { deep: true })
      else sim.removeNode(node.id)
      renderer.setHover(null)
    } else if (grp) {
      // Dissolving a boundary never removes what it held — the same promise a
      // section's strip makes. Deleting the members is the folded card's menu.
      mark()
      sim.removeGroup(grp.id)
      renderer.setHoverGroup(null)
    } else if (sec) {
      // Removing the grouping never removes what was grouped.
      mark()
      sim.removeSection(sec.id)
      renderer.setHoverSection(null)
    } else {
      const edge = renderer.edgeHitTest(sim, x, y)
      if (!edge) return
      // A drawn wire may stand for several real ones that collapsed onto the
      // same pair of cards, and then there is no single thing to remove.
      const only = edge.real.length === 1 ? edge.real[0] : null
      if (!only || only.from !== edge.from || only.to !== edge.to) {
        return onNotice('unfold the group to edit this connection')
      }
      mark()
      sim.disconnect(only.from, only.to)
      renderer.setHoverEdge(null)
    }
    if (sim.state.scene.autoLayout) sim.autoLayout()
    renderer.fit(sim, !!timeline)
    onStats(sim.state.stats)
  })

  // Drop a type from the palette onto the board.
  canvas.addEventListener('dragover', ev => { ev.preventDefault() })
  canvas.addEventListener('drop', ev => {
    ev.preventDefault()
    const type = ev.dataTransfer?.getData('text/visualisazcy-type')
    if (!type) return
    const { x, y } = pointAt(ev)
    const f = renderer.toFrame(x, y)
    const { W, H } = renderer.size
    mark()
    const n = sim.addNode(type, renderer.fromPx(f.x), f.y / H)
    if (n) { renderer.fit(sim, !!timeline); onStats(sim.state.stats) }
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
    get selectedEdge() { return selectedEdge },
    setEdgeProp: (from, to, key, value) => { mark(); sim.setEdgeProp(from, to, key, value) },
    degrade: id => { sim.degrade(id); onStats(sim.state.stats) },
    groupSelection, ungroupSelection, setFolded, removeFromGroup, addSectionAuto,
    parentOf: id => sim.parentOf(id),
    groupById: id => groupById(sim.state, id),
    renameGroup: (id, label) => { mark(); sim.renameGroup(id, label) },
    setShowFrame: v => renderer.setShowFrame(v),
    get showFrame() { return renderer.showFrame },
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
      if (n) { renderer.fit(sim, !!timeline); onStats(sim.state.stats) }
      return n
    },
    get timeline() { return timeline },
  }
}
