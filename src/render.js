// Canvas 2D renderer. No SVG, no animation library, no dependencies.
// Cards are rounded rects; wires are straight lines clipped to the card edge;
// packets are dots at a lerped position. That is the entire visual system.

import { theme, card as C } from './theme.js'
import { typeOf, roleOf, canGive, declaredOf, colorOf, iconOf, subtitleOf } from './registry.js'
import { failureOf, breakerOf, retryOf } from './registry.js'
import { easeOutBack, easeOutCubic, clamp01, mix, damp } from './ease.js'
import { inFrame } from './scene.js'
import { drawAnnotations } from './annotate.js'
import { viewGraph, childItemsOf, openGroups, groupById } from './groups.js'

// Scene-kind registry. 'graph' is built in; anything else registers into it.
const SCENE_KINDS = {}
const HANDLE_R = 7
const SECTION_HEAD = 24
const GROUP_W = 1.15     // a folded card is wider than a node, so the two never read alike
const GROUP_PAD = 17     // room between an open group's edge and its contents
const STACK = 4.5        // how far the cards behind a folded one peek out

export function registerRenderer(kind, fn) {
  SCENE_KINDS[kind] = fn
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d')
  let W = 0, H = 0, S = 1, dt = 16
  let Z = 1   // S times the camera zoom: the scale everything on a card uses

  // A step can reserve the left edge for its annotations. The diagram then maps
  // its fractional x into the remaining width instead of being drawn over. This
  // is the layout language the reference work uses: commentary column on one
  // side, system on the other.
  let gutter = 0

  // Interaction state the renderer needs to draw: which node is under the
  // cursor (so its + handles show) and any connection being dragged.
  let hoverId = null
  let hoverEdge = null
  let hoverSection = null
  let hoverGroup = null
  let pending = null
  let guides = []            // alignment lines shown while dragging
  let selection = new Set()  // ids the editor has selected
  let marquee = null         // { x0, y0, x1, y1 } in frame coords, while dragging one
  let showFrame = true       // the dashed export bounds; noise while sketching

  // Camera. Frame coordinates are what every scene is authored in — the export
  // bounds. The camera is a view transform on top, so at zoom 1 centred on the
  // frame the output is pixel-identical to having no camera at all, and zooming
  // out simply reveals the room around it.
  const cam = { x: 0, y: 0, zoom: 1 }
  const ZOOM_MIN = 0.2, ZOOM_MAX = 4
  let camTouched = false   // once the user moves the camera, stop re-centring it

  const toScreen = (fx, fy) => ({
    x: (fx - cam.x) * cam.zoom + W / 2,
    y: (fy - cam.y) * cam.zoom + H / 2,
  })
  const toFrame = (sx, sy) => ({
    x: (sx - W / 2) / cam.zoom + cam.x,
    y: (sy - H / 2) / cam.zoom + cam.y,
  })

  // The resting view is slightly pulled back, so there is visible board around
  // the export frame. At zoom 1 the canvas WAS the frame, which is why placing
  // anything outside it felt walled off — there was nowhere visible to put it.
  const REST_ZOOM = 0.78

  function resetCamera(zoom = REST_ZOOM) {
    cam.x = W / 2
    cam.y = H / 2
    cam.zoom = zoom
    camTouched = false
  }

  // Export ignores wherever you happen to be looking and renders the frame.
  function frameCamera() {
    const keep = { ...cam }
    resetCamera(1)
    return () => { cam.x = keep.x; cam.y = keep.y; cam.zoom = keep.zoom; camTouched = true }
  }

  function panBy(dxScreen, dyScreen) {
    camTouched = true
    cam.x -= dxScreen / cam.zoom
    cam.y -= dyScreen / cam.zoom
  }

  // Zoom about a screen point, so the thing under the cursor stays put.
  function zoomAt(sx, sy, factor) {
    camTouched = true
    const before = toFrame(sx, sy)
    cam.zoom = clamp(cam.zoom * factor, ZOOM_MIN, ZOOM_MAX)
    const after = toFrame(sx, sy)
    cam.x += before.x - after.x
    cam.y += before.y - after.y
  }

  // Numbers in annotations count toward their target instead of snapping. Values
  // are keyed per step, so each beat starts its counters fresh.
  const counterVals = new Map()
  let counterEpoch = null
  // Scratch space for renderers that need damped state between frames (a cell
  // that just changed, a pointer sliding). Cleared when the step changes so a
  // beat always starts clean.
  const scratch = new Map()
  let scratchEpoch = null
  const store = {
    epoch(key) {
      if (scratchEpoch === key) return
      scratchEpoch = key
      scratch.clear()
    },
    get(key, init) {
      if (!scratch.has(key)) scratch.set(key, init)
      return scratch.get(key)
    },
    set(key, v) { scratch.set(key, v); return v },
  }

  const counters = {
    epoch(key) {
      if (counterEpoch === key) return
      counterEpoch = key
      counterVals.clear()
    },
    read(key, target) {
      const cur = counterVals.get(key) ?? 0
      const next = damp(cur, target, 4.5, dt)
      counterVals.set(key, Math.abs(next - target) < 0.5 ? target : next)
      return counterVals.get(key)
    },
  }

  // Everything drawn and everything hit-tested comes from here. Rebuilt per
  // call rather than cached: a cached view goes stale the moment a node is
  // added, and hit tests run between draws.
  const view = sim => viewGraph(sim.state, n => sim.appearOf(n))

  function resize() {
    const dpr = window.devicePixelRatio || 1
    const r = canvas.getBoundingClientRect()
    W = r.width
    H = r.height
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Cards are wide, so horizontal room is what constrains them; scaling off
    // min(W,H) made a square canvas draw BIGGER cards than a wider 16:9 one.
    // A portrait layout is mostly a single column and can afford more per card.
    const portrait = H > W
    S = clamp(W / (portrait ? 430 : 880), 0.5, 1.35)
    if (!camTouched) resetCamera()
  }

  // Shrink until no two cards collide. Positions are fractions, so how much room
  // a layout actually has only becomes knowable once the canvas is sized — this
  // is what keeps a scene authored for 16:9 legible at 1:1.
  // Only a composition shrinks to fit. A free board keeps its cards at full
  // size and lets you zoom — objects that shrink as you add more is the wrong
  // model for a canvas, and it is why nine objects made every icon unreadable.
  function fit(sim, compose = false) {
    if (!compose) return
    const gap = 16
    // View items, not raw nodes: a folded service is one box to keep clear of,
    // which is most of why folding fixes a crowded composition at all.
    const visible = view(sim).items.filter(it => it.appear > 0 && inFrame(it))
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const dx = Math.abs(visible[i].x - visible[j].x) * W * (1 - gutter)
        const dy = Math.abs(visible[i].y - visible[j].y) * H
        // The pair is clear if it separates on either axis; take the roomier one.
        const wide = visible[i].kind === 'group' || visible[j].kind === 'group'
        const room = Math.max((dx - gap) / (C.w * (wide ? GROUP_W : 1)), (dy - gap) / C.h)
        if (room < S) S = Math.max(0.42, room)
      }
    }
  }

  // Pixel geometry for a node, derived from its fractional position.
  const toPx = fx => (gutter + fx * (1 - gutter)) * W
  const fromPx = px => (px / W - gutter) / (1 - gutter)

  // Frame coordinates throughout. The camera is applied once as a canvas
  // transform around the whole composition, so every painter below — cards,
  // wires, packets, annotations, chrome — keeps working in the space it was
  // written for and the artboard zooms as one piece.
  // No clamping. Pinning cards inside the frame is what made the pan/zoom
  // canvas a lie: you could travel to empty space but nothing could live there.
  // Takes a node or a view item; a group item is wider, and nothing else about
  // the geometry differs.
  function boxOf(n) {
    const w = C.w * S * (n.kind === 'group' ? GROUP_W : 1), h = C.h * S
    return { cx: toPx(n.x), cy: n.y * H, w, h, hw: w / 2, hh: h / 2 }
  }

  // A selected card wears a ring outside its border, so selection reads even on
  // a card that is already red from being overloaded.
  function paintSelection(boxes) {
    if (!selection.size) return
    ctx.save()
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 1.5 * S
    for (const id of selection) {
      const b = boxes.get(id)
      if (!b) continue
      roundRect(b.cx - b.hw - 5 * S, b.cy - b.hh - 5 * S,
                b.w + 10 * S, b.h + 10 * S, (C.r + 5) * S)
      ctx.stroke()
    }
    ctx.restore()
  }

  function paintMarquee() {
    if (!marquee) return
    const x = Math.min(marquee.x0, marquee.x1)
    const y = Math.min(marquee.y0, marquee.y1)
    const w = Math.abs(marquee.x1 - marquee.x0)
    const h = Math.abs(marquee.y1 - marquee.y0)
    ctx.save()
    ctx.fillStyle = 'rgba(110,160,255,0.09)'
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 1 / cam.zoom
    ctx.strokeRect(x, y, w, h)
    ctx.restore()
  }

  // Which nodes a marquee has caught. Rectangle overlap, not containment —
  // dragging a band across a row should take the whole row.
  function nodesInMarquee(sim) {
    if (!marquee) return []
    const x = Math.min(marquee.x0, marquee.x1), X = Math.max(marquee.x0, marquee.x1)
    const y = Math.min(marquee.y0, marquee.y1), Y = Math.max(marquee.y0, marquee.y1)
    return view(sim).items.filter(n => {
      if (n.appear <= 0) return false
      const b = boxOf(n)
      return b.cx + b.hw >= x && b.cx - b.hw <= X &&
             b.cy + b.hh >= y && b.cy - b.hh <= Y
    })
  }

  // Snapping lives here because the renderer owns the geometry. Alignment with
  // a neighbour beats the grid: lining two things up is a deliberate act, and a
  // grid that overrides it feels like fighting the tool.
  const GRID = 26
  const SNAP = 7

  function snapNode(node, others) {
    const gx = GRID * S, gy = GRID * S
    let fx = toPx(node.x), fy = node.y * H
    const found = []

    let bestX = null, bestY = null
    for (const o of others) {
      if (o.id === node.id || o.appear <= 0 || o.hidden) continue
      const ox = toPx(o.x), oy = o.y * H
      if (Math.abs(ox - fx) < SNAP && (bestX === null || Math.abs(ox - fx) < Math.abs(bestX - fx))) bestX = ox
      if (Math.abs(oy - fy) < SNAP && (bestY === null || Math.abs(oy - fy) < Math.abs(bestY - fy))) bestY = oy
    }

    if (bestX !== null) { fx = bestX; found.push({ axis: 'x', at: bestX }) }
    else fx = Math.round(fx / gx) * gx
    if (bestY !== null) { fy = bestY; found.push({ axis: 'y', at: bestY }) }
    else fy = Math.round(fy / gy) * gy

    guides = found
    return { x: fromPx(fx), y: fy / H }
  }

  function clearGuides() { guides = [] }

  function paintGuides() {
    if (!guides.length) return
    ctx.save()
    ctx.strokeStyle = theme.accent
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1 / cam.zoom
    ctx.setLineDash([4 / cam.zoom, 4 / cam.zoom])
    for (const g of guides) {
      ctx.beginPath()
      if (g.axis === 'x') { ctx.moveTo(g.at, -H); ctx.lineTo(g.at, H * 2) }
      else { ctx.moveTo(-W, g.at); ctx.lineTo(W * 2, g.at) }
      ctx.stroke()
    }
    ctx.restore()
  }

  // A scene declares its kind; the kind decides how the body of the frame is
  // drawn. Everything around it — background, annotations, chrome, easing, the
  // timeline — is shared, which is the whole point of the split: a new visual
  // vocabulary costs one function, not a second engine.
  function drawGraph(surf, sim) {
    const st = sim.state
    // Everything below draws the VIEW graph. A folded group is one item here and
    // its members are simply absent, which is why no painter needs to know that
    // folding exists.
    const vg = view(sim)
    for (const sec of st.sections || []) paintSection(sim, sec)

    const boxes = new Map(vg.items.map(it => [it.id, boxOf(it)]))
    const rects = groupRects(sim, vg, boxes)
    for (const g of vg.open) paintGroupBox(sim, vg, g, rects)

    for (const e of vg.edges) paintWire(sim, boxes, e)
    for (const p of st.packets) paintPacket(sim, boxes, vg, p)
    for (const it of vg.items) {
      if (it.appear <= 0) continue
      if (it.kind === 'group') paintGroupCard(sim, it, boxes.get(it.id))
      else paintCard(sim, it.node, boxes.get(it.id))
    }
    // Handles last, so they sit above neighbouring cards.
    for (const it of vg.items) {
      if (it.id !== hoverId || it.kind !== 'node' || it.node.hidden) continue
      if (!canGive(it.node) || it.appear < 1) continue
      paintHandles(boxes.get(it.id))
    }
    return boxes
  }

  // --- groups ---------------------------------------------------------------

  // An open group's rectangle is the union of what it holds, padded — computed
  // innermost first, so a parent encloses its children's BOXES rather than
  // reaching past them to their contents. A folded child contributes its card.
  function groupRects(sim, vg, boxes) {
    const out = new Map()
    const walk = (g, seen = new Set()) => {
      if (out.has(g.id)) return out.get(g.id)
      if (seen.has(g.id)) return null
      seen.add(g.id)
      let r = null
      for (const it of childItemsOf(sim.state, g, vg.idx)) {
        let b = null
        const item = vg.byId.get(it.id)
        if (item) {
          if (item.appear <= 0.01) continue
          const bx = boxes.get(it.id) || boxOf(item)
          b = { x0: bx.cx - bx.hw, y0: bx.cy - bx.hh, x1: bx.cx + bx.hw, y1: bx.cy + bx.hh }
        } else if (it.kind === 'group') {
          const inner = walk(it.group, seen)
          if (inner) b = { x0: inner.x, y0: inner.y, x1: inner.x + inner.w, y1: inner.y + inner.h }
        }
        if (!b) continue
        r = r ? { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0),
                  x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) } : b
      }
      if (!r) { out.set(g.id, null); return null }
      const pad = GROUP_PAD * S
      const head = headHeight()
      const rect = { x: r.x0 - pad, y: r.y0 - pad - head,
                     w: (r.x1 - r.x0) + pad * 2, h: (r.y1 - r.y0) + pad * 2 + head }
      out.set(g.id, rect)
      return rect
    }
    for (const g of vg.open) walk(g)
    return out
  }

  const CHEV = 17
  function chevronRect(r) {
    const k = CHEV * S
    return { x: r.x + r.w - k - 9 * S, y: r.y + (headHeight() - k) / 2, w: k, h: k }
  }

  // Solid edge, unlike a section's dashed one: a section is a region label, a
  // group is a boundary with a membership list, and they must not read alike.
  // Outermost paints first so nested boxes stack correctly.
  function paintGroupBox(sim, vg, g, rects) {
    const r = rects.get(g.id)
    if (r) {
      const tone = g.tone ? (theme[g.tone] || theme.accent) : theme.accent
      const armed = hoverGroup === g.id
      ctx.save()
      ctx.fillStyle = withAlpha(tone, 0.035)
      roundRect(r.x, r.y, r.w, r.h, 16 * S)
      ctx.fill()
      ctx.strokeStyle = withAlpha(tone, armed ? 0.72 : 0.34)
      ctx.lineWidth = 1.2 * S
      roundRect(r.x, r.y, r.w, r.h, 16 * S)
      ctx.stroke()

      const sh = headHeight()
      ctx.fillStyle = withAlpha(tone, armed ? 0.16 : 0.09)
      roundRect(r.x, r.y, Math.min(r.w, ctxTextWidth(g.label) + 30 * S), sh, 10 * S)
      ctx.fill()

      letterSpace(1.8 * S)
      ctx.fillStyle = tone
      ctx.font = `600 ${Math.max(9, 9.5 * S)}px ${theme.fontMono}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(g.label).toUpperCase(), r.x + 12 * S, r.y + sh / 2 + 0.5)
      letterSpace(0)

      // The fold control. Drawn always, not only on hover: it is the only way
      // back to the folded view, and a hidden affordance is one you never find.
      const c = chevronRect(r)
      ctx.fillStyle = armed ? withAlpha(tone, 0.2) : 'rgba(255,255,255,0.04)'
      roundRect(c.x, c.y, c.w, c.h, 5 * S)
      ctx.fill()
      ctx.strokeStyle = withAlpha(tone, armed ? 0.8 : 0.4)
      ctx.lineWidth = 1.3 * S
      const m = c.w * 0.28
      ctx.beginPath()
      ctx.moveTo(c.x + m, c.y + c.h / 2)
      ctx.lineTo(c.x + c.w - m, c.y + c.h / 2)
      ctx.stroke()
      ctx.restore()
    }
    for (const it of childItemsOf(sim.state, g, vg.idx)) {
      if (it.kind === 'group' && !it.group.folded) paintGroupBox(sim, vg, it.group, rects)
    }
  }

  // A folded group must not read as a node, because it opens. Two rectangles
  // peeking out behind it say "there is more in here" before the label has been
  // read, which is the one job this card has.
  function paintGroupCard(sim, it, box) {
    if (!box) return
    const { cx, cy, w, h, hw, hh } = box
    const x = cx - hw, y = cy - hh
    const tone = it.group.tone ? (theme[it.group.tone] || theme.accent) : theme.accent

    const enter = it.appear
    const scale = mix(0.88, 1, easeOutBack(enter)) * (1 + 0.02 * it.pulse)
    const lift = mix(10 * S, 0, easeOutCubic(enter))

    ctx.save()
    ctx.globalAlpha = (it.dead ? 0.35 : 1) * easeOutCubic(enter) * mix(1, 0.2, it.dim)
      * (inFrame(it) ? 1 : 0.4)
    ctx.translate(cx, cy + lift)
    ctx.scale(scale, scale)
    ctx.translate(-cx, -cy)

    // The cards behind. Full opacity and a tinted hairline, because the first
    // attempt faded them to a fifth and outlined them in the 5.5% card edge —
    // both slivers disappeared into the background and a folded group ended up
    // looking exactly like the node it is not.
    for (let i = 2; i >= 1; i--) {
      const k = i * STACK * S
      ctx.fillStyle = theme.card
      roundRect(x + k * 1.7, y - k, w - k * 3.4, h, C.r * S)
      ctx.fill()
      ctx.strokeStyle = withAlpha(tone, 0.42 - i * 0.1)
      ctx.lineWidth = 1 * S
      roundRect(x + k * 1.7, y - k, w - k * 3.4, h, C.r * S)
      ctx.stroke()
    }

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 11 * S
    ctx.shadowOffsetY = 4 * S
    ctx.fillStyle = theme.card
    roundRect(x, y, w, h, C.r * S)
    ctx.fill()
    ctx.restore()

    ctx.strokeStyle = it.pulse > 0 ? theme.cardEdgeHi : theme.cardEdge
    ctx.lineWidth = 1 * S
    roundRect(x, y, w, h, C.r * S)
    ctx.stroke()

    if (it.hot > 0.01) {
      ctx.save()
      ctx.globalAlpha *= it.hot
      ctx.shadowColor = theme.bad
      ctx.shadowBlur = 14 * S
      ctx.strokeStyle = theme.bad
      ctx.lineWidth = 1.6 * S
      roundRect(x, y, w, h, C.r * S)
      ctx.stroke()
      ctx.restore()
    }

    // The badge counts what is hidden, which is the question a folded card is
    // asked most. It counts LEAVES, so a folded region reports objects and not
    // the services between.
    const bs = C.badge * S
    const bx = x + C.pad * S
    const by = cy - bs / 2
    ctx.fillStyle = withAlpha(tone, 0.16)
    roundRect(bx, by, bs, bs, C.badgeR * S)
    ctx.fill()
    ctx.strokeStyle = withAlpha(tone, 0.38)
    ctx.lineWidth = 1 * S
    roundRect(bx, by, bs, bs, C.badgeR * S)
    ctx.stroke()

    ctx.fillStyle = tone
    ctx.font = `600 ${9.5 * S}px ${theme.fontMono}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`×${it.count}`, bx + bs / 2, by + bs / 2 + 0.5 * S)

    const tx = bx + bs + 10 * S
    const tw = x + w - C.pad * S - tx
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.text
    ctx.font = `600 ${12.5 * S}px ${theme.fontDisplay}`
    ctx.fillText(truncate(it.label, tw), tx, cy - 7 * S)

    ctx.font = `500 ${9.5 * S}px ${theme.fontMono}`
    if (sim.state.running) {
      ctx.fillStyle = it.hot > 0.5 ? theme.bad : theme.textDim
      ctx.fillText(`${Math.round(it.showRate)} rps in`, tx, cy + 8 * S)
    } else {
      ctx.fillStyle = theme.textMute
      ctx.fillText(`${it.count} object${it.count === 1 ? '' : 's'}`, tx, cy + 8 * S)
    }

    // Worst member utilisation. Not an invented group capacity: a fan-out has
    // more throughput than its slowest member and a cache short-circuits most
    // requests, so any single derived number here would be a lie.
    if (sim.state.running || it.worst > 0.001) {
      const frac = clamp(it.worst, 0, 1)
      const mw = w - C.pad * 2 * S
      const mx = x + C.pad * S
      const my = y + h - C.meterH * S - 5 * S
      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      roundRect(mx, my, mw, C.meterH * S, C.meterH * S / 2)
      ctx.fill()
      ctx.fillStyle = frac > 0.95 ? theme.bad : frac > 0.7 ? theme.warn : theme.good
      roundRect(mx, my, Math.max(2 * S, mw * frac), C.meterH * S, C.meterH * S / 2)
      ctx.fill()
    }
    ctx.restore()
  }

  function groupGeom(sim) {
    const vg = view(sim)
    const boxes = new Map(vg.items.map(it => [it.id, boxOf(it)]))
    return groupRects(sim, vg, boxes)
  }

  // Innermost first: a nested group's strip sits on top of its parent's box, so
  // the smaller rectangle has to win.
  function openByArea(sim) {
    return [...groupGeom(sim).entries()]
      .filter(([, r]) => r)
      .sort((a, b) => a[1].w * a[1].h - b[1].w * b[1].h)
  }

  function groupHeadAt(sim, sx, sy) {
    const p = toFrame(sx, sy)
    for (const [id, r] of openByArea(sim)) {
      const g = groupById(sim.state, id)
      if (!g) continue
      const sh = headHeight()
      const hw = Math.min(r.w, ctxTextWidth(g.label) + 30 * S)
      if (p.x >= r.x && p.x <= r.x + hw && p.y >= r.y && p.y <= r.y + sh) return g
    }
    return null
  }

  function groupChevronAt(sim, sx, sy) {
    const p = toFrame(sx, sy)
    for (const [id, r] of openByArea(sim)) {
      const c = chevronRect(r)
      const s2 = 4 * S
      if (p.x >= c.x - s2 && p.x <= c.x + c.w + s2 &&
          p.y >= c.y - s2 && p.y <= c.y + c.h + s2) return groupById(sim.state, id)
    }
    return null
  }

  // Sections sit behind everything: a tinted rectangle and a title strip. The
  // strip is the drag handle — grabbing the body would fight panning and node
  // selection, which is the mistake every canvas tool only makes once.
  function paintSection(sim, sec) {
    const r = sectionRect(sec)
    const tone = sec.tone ? (theme[sec.tone] || theme.accent) : null
    const armed = hoverSection === sec.id

    // Fade with the contents, so focus dims a section along with its nodes.
    const inside = sim.nodesIn(sec)
    const dim = inside.length
      ? inside.reduce((m, n) => Math.min(m, 1 - n.dim), 1)
      : 1

    ctx.save()
    ctx.globalAlpha = mix(0.25, 1, dim)

    ctx.fillStyle = tone ? withAlpha(tone, 0.05) : 'rgba(255,255,255,0.016)'
    roundRect(r.x, r.y, r.w, r.h, 14 * S)
    ctx.fill()
    ctx.strokeStyle = armed ? theme.cardEdgeHi : (tone ? withAlpha(tone, 0.3) : theme.cardEdge)
    ctx.lineWidth = 1 * S
    ctx.setLineDash([7 * S, 5 * S])
    roundRect(r.x, r.y, r.w, r.h, 14 * S)
    ctx.stroke()
    ctx.setLineDash([])

    // title strip. Floored, because it is chrome rather than content: on a dense
    // board the card scale drops to 0.42 and an unfloored strip becomes a 10px
    // target, which is the only handle a section has.
    const sh = headHeight()
    ctx.fillStyle = armed ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.028)'
    roundRect(r.x, r.y, Math.min(r.w, ctxTextWidth(sec.label) + 30 * S), sh, 10 * S)
    ctx.fill()

    letterSpace(1.8 * S)
    ctx.fillStyle = tone || theme.textMute
    ctx.font = `600 ${Math.max(9, 9.5 * S)}px ${theme.fontMono}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(sec.label).toUpperCase(), r.x + 12 * S, r.y + sh / 2 + 0.5)
    letterSpace(0)

    if (armed) {
      ctx.fillStyle = theme.textMute
      ctx.font = `500 ${Math.max(8.5, 9 * S)}px ${theme.fontMono}`
      ctx.textAlign = 'right'
      ctx.fillText(`${inside.length}`, r.x + r.w - 12 * S, r.y + sh / 2 + 0.5)
      paintSectionGrips(sec)
    }
    ctx.restore()
  }

  function ctxTextWidth(label) {
    ctx.save()
    letterSpace(1.8 * S)
    ctx.font = `600 ${Math.max(9, 9.5 * S)}px ${theme.fontMono}`
    const w = ctx.measureText(String(label).toUpperCase()).width
    letterSpace(0)
    ctx.restore()
    return w
  }

  const headHeight = () => Math.max(21, SECTION_HEAD * S)
  const GRIP = 9

  // Corners only. Edge handles on a rectangle this size are more targets than
  // help, and a corner already reaches both axes.
  function sectionCorners(sec) {
    const r = sectionRect(sec)
    return [
      { id: 'nw', x: r.x,         y: r.y },
      { id: 'ne', x: r.x + r.w,   y: r.y },
      { id: 'sw', x: r.x,         y: r.y + r.h },
      { id: 'se', x: r.x + r.w,   y: r.y + r.h },
    ]
  }

  function paintSectionGrips(sec) {
    const tone = sec.tone ? (theme[sec.tone] || theme.accent) : theme.accent
    ctx.save()
    for (const c of sectionCorners(sec)) {
      ctx.fillStyle = theme.bg
      ctx.strokeStyle = tone
      ctx.lineWidth = 1.2 * S
      const g = GRIP * S
      roundRect(c.x - g / 2, c.y - g / 2, g, g, 2 * S)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  // Only the hovered section offers grips, because only the hovered section
  // draws them. Adjacent sections have overlapping corners, and letting an
  // invisible grip win means you resize something you were not pointing at.
  function sectionGripAt(sim, sx, sy) {
    const p = toFrame(sx, sy)
    const candidates = (sim.state.sections || [])
      .filter(sec => !hoverSection || sec.id === hoverSection)
    for (const sec of [...candidates].reverse()) {
      for (const c of sectionCorners(sec)) {
        if (Math.hypot(p.x - c.x, p.y - c.y) <= (GRIP + 4) * S) {
          return { id: sec.id, corner: c.id }
        }
      }
    }
    return null
  }

  function sectionRect(sec) {
    return {
      x: toPx(sec.x), y: sec.y * H,
      w: sec.w * W * (1 - gutter), h: sec.h * H,
    }
  }

  // Only the title strip is grabbable.
  function sectionHeadAt(sim, sx, sy) {
    const p = toFrame(sx, sy)
    for (const sec of [...(sim.state.sections || [])].reverse()) {
      const r = sectionRect(sec)
      const sh = headHeight()
      const hw = Math.min(r.w, ctxTextWidth(sec.label) + 30 * S)
      if (p.x >= r.x && p.x <= r.x + hw && p.y >= r.y && p.y <= r.y + sh) return sec
    }
    return null
  }

  // The + affordances. Only nodes that may give traffic get them, which is how
  // "this one is receive-only" becomes visible rather than a rule you discover
  // by being refused.
  function paintHandles(box) {
    if (!box) return
    for (const h of handlePoints(box)) {
      ctx.save()
      ctx.fillStyle = theme.bg
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = 1.2 * S
      ctx.beginPath()
      ctx.arc(h.x, h.y, HANDLE_R * S, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = 1.4 * S
      const k = 3.4 * S
      ctx.beginPath()
      ctx.moveTo(h.x - k, h.y); ctx.lineTo(h.x + k, h.y)
      ctx.moveTo(h.x, h.y - k); ctx.lineTo(h.x, h.y + k)
      ctx.stroke()
      ctx.restore()
    }
  }

  function handlePoints(box) {
    const d = 13 * S
    return [
      { x: box.cx + box.hw + d, y: box.cy, side: 'right' },
      { x: box.cx - box.hw - d, y: box.cy, side: 'left' },
      { x: box.cx, y: box.cy - box.hh - d, side: 'top' },
      { x: box.cx, y: box.cy + box.hh + d, side: 'bottom' },
    ]
  }

  // Which wire is under a screen point. Distance from the segment, in frame
  // space, so zoom does not change how easy a wire is to grab.
  function edgeHitTest(sim, sx, sy) {
    const p = toFrame(sx, sy)
    const vg = view(sim)
    const boxes = new Map(vg.items.map(it => [it.id, boxOf(it)]))
    let best = null, bestD = 10 * S
    for (const e of vg.edges) {
      if (e.off) continue
      const a = boxes.get(e.from), b = boxes.get(e.to)
      if (!a || !b) continue
      const p1 = edgePoint(a, b.cx, b.cy)
      const p2 = edgePoint(b, a.cx, a.cy)
      const d = distToSegment(p, p1, p2)
      if (d < bestD) { bestD = d; best = e }
    }
    return best
  }

  function distToSegment(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y
    const len2 = vx * vx + vy * vy
    if (!len2) return Math.hypot(p.x - a.x, p.y - a.y)
    let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t))
  }

  // Hover has to survive the cursor leaving the card on its way to a handle.
  // The handles sit outside the card, so testing the card alone means reaching
  // for a + is the gesture that dismisses it — the control is unusable.
  function hoverTargetAt(sim, sx, sy) {
    const direct = hitTest(sim, sx, sy)
    if (direct) return direct.kind === 'group' ? null : direct
    if (!hoverId) return null
    const n = sim.byId(hoverId)
    if (!n || n.hidden || !canGive(n)) return null
    const p = toFrame(sx, sy)
    const box = boxOf(n)
    const pad = (13 + HANDLE_R + 7) * S     // handle offset + radius + slack
    const inHalo = Math.abs(p.x - box.cx) <= box.hw + pad &&
                   Math.abs(p.y - box.cy) <= box.hh + pad
    return inHalo ? n : null
  }

  // Which + handle is under a screen point, if any.
  function handleAt(sim, sx, sy) {
    if (!hoverId) return null
    const n = sim.byId(hoverId)
    if (!n || !canGive(n)) return null
    const p = toFrame(sx, sy)
    const box = boxOf(n)
    for (const h of handlePoints(box)) {
      if (Math.hypot(p.x - h.x, p.y - h.y) <= (HANDLE_R + 4) * S) return { node: n, ...h }
    }
    return null
  }

  function draw(sim, chrome = null, frameDt = 16) {
    dt = frameDt
    gutter = chrome?.gutter || 0
    const st = sim.state
    ctx.clearRect(0, 0, W, H)
    paintBackground()

    ctx.save()
    applyCamera()
    paintFrameEdge((st.nodes || []).some(n => !n.hidden && !inFrame(n)))

    // 'graph' stays a closure over this renderer's card painters; registered
    // kinds get the surface and draw whatever they like on it.
    const kind = st.scene.kind || 'graph'
    if (chrome) store.epoch(chrome.key)
    const external = kind !== 'graph' && SCENE_KINDS[kind]
    const boxes = external
      ? (external(surface(new Map()), sim, chrome, { store, counters }) || new Map())
      : drawGraph(null, sim)

    if (chrome) {
      if (chrome.annotations) {
        counters.epoch(chrome.key)
        drawAnnotations(surface(boxes), chrome.annotations, chrome.enter, counters)
      }
      paintChrome(chrome)
    }
    paintSelection(boxes)
    paintGuides()
    paintMarquee()
    if (pending) paintPending(boxes)
    ctx.restore()
  }

  function applyCamera() {
    ctx.translate(W / 2, H / 2)
    ctx.scale(cam.zoom, cam.zoom)
    ctx.translate(-cam.x, -cam.y)
  }

  // The export bounds, visible only once you zoom out past them.
  function paintFrameEdge(anyOutside) {
    if (!showFrame) return
    const parked = cam.zoom <= 0.995 || Math.abs(cam.x - W / 2) >= 1 ||
                   Math.abs(cam.y - H / 2) >= 1 || anyOutside
    if (!parked) return
    ctx.save()
    ctx.strokeStyle = theme.cardEdgeHi
    ctx.lineWidth = 1 / cam.zoom
    ctx.setLineDash([6 / cam.zoom, 6 / cam.zoom])
    ctx.strokeRect(0, 0, W, H)
    ctx.restore()
  }

  // Rubber band while dragging a new connection out of a + handle.
  function paintPending(boxes) {
    const from = boxes.get(pending.from)
    if (!from) return
    const p1 = edgePoint(from, pending.x, pending.y)
    ctx.save()
    ctx.strokeStyle = pending.ok === false ? theme.bad : theme.accent
    ctx.lineWidth = 1.6 * S
    ctx.setLineDash([5 * S, 5 * S])
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(pending.x, pending.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(pending.x, pending.y, 3.5 * S, 0, Math.PI * 2)
    ctx.fillStyle = pending.ok === false ? theme.bad : theme.accent
    ctx.fill()
    ctx.restore()
  }

  // The drawing surface handed to the annotation layer: enough to place a mark
  // against a node without letting it reach into renderer internals.
  function surface(boxes) {
    return {
      ctx, W, H, dt,
      get S() { return S },
      get gutter() { return gutter },
      roundRect, truncate, letterSpace, theme,
      nodeBox: id => boxes.get(id) || null,
      allBoxes: () => boxes.entries(),
    }
  }

  // Per-type effect widget, drawn in a reserved strip on the right of a card.
  // This is what makes a pooler read differently from a rate limiter rather
  // than being the same box in another colour.
  function paintEffect(def, n, x, y, w, h) {
    const ew = 26 * S
    const ex = x + w - 11 * S - ew
    const cy = y + h / 2
    const col = colorOf(n)
    ctx.save()

    if (def.effect === 'slots') {
      const total = def.slots || 8
      const used = Math.min(total, Math.round(n.busy))
      const bh = Math.max(1.5 * S, (h - 26 * S) / total - 1.5 * S)
      for (let i = 0; i < total; i++) {
        ctx.fillStyle = i < used ? col : 'rgba(255,255,255,0.09)'
        ctx.fillRect(ex, y + 13 * S + i * (bh + 1.5 * S), ew, bh)
      }
    } else if (def.effect === 'bucket') {
      const burst = def.burst || 20
      const frac = clamp(n.tokens / burst, 0, 1)
      const bh = h - 24 * S
      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      roundRect(ex + ew / 2 - 4 * S, y + 12 * S, 8 * S, bh, 3 * S); ctx.fill()
      ctx.fillStyle = frac < 0.15 ? theme.bad : col
      const fh = Math.max(1.5 * S, bh * frac)
      roundRect(ex + ew / 2 - 4 * S, y + 12 * S + bh - fh, 8 * S, fh, 3 * S); ctx.fill()
    } else if (def.effect === 'hitrate' || def.effect === 'globe') {
      const total = n.hits + n.misses
      const frac = total ? n.hits / total : (n.spec.hitRate ?? def.hitRate ?? 0)
      const r = 10 * S
      ctx.lineWidth = 3 * S
      ctx.strokeStyle = 'rgba(255,255,255,0.09)'
      ctx.beginPath(); ctx.arc(ex + ew / 2, cy, r, 0, Math.PI * 2); ctx.stroke()
      ctx.strokeStyle = theme.good
      ctx.beginPath()
      ctx.arc(ex + ew / 2, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = theme.textDim
      ctx.font = `600 ${7.5 * S}px ${theme.fontMono}`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(`${Math.round(frac * 100)}`, ex + ew / 2, cy + 0.5 * S)
    } else if (def.effect === 'depth') {
      const bh = h - 24 * S
      const frac = clamp(n.showRate / Math.max(1, n.capacity * 0.02), 0, 1)
      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      roundRect(ex + ew / 2 - 5 * S, y + 12 * S, 10 * S, bh, 3 * S); ctx.fill()
      ctx.fillStyle = col
      const fh = Math.max(1.5 * S, bh * frac)
      roundRect(ex + ew / 2 - 5 * S, y + 12 * S + bh - fh, 10 * S, fh, 3 * S); ctx.fill()
    } else if (def.effect === 'rr' || def.effect === 'fan') {
      // a tick that steps round the dial as the round robin advances
      const r = 9 * S
      const a = (n.rrIdx % 8) / 8 * Math.PI * 2 - Math.PI / 2
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1.2 * S
      ctx.beginPath(); ctx.arc(ex + ew / 2, cy, r, 0, Math.PI * 2); ctx.stroke()
      ctx.strokeStyle = col
      ctx.lineWidth = 2.2 * S
      ctx.beginPath()
      ctx.moveTo(ex + ew / 2, cy)
      ctx.lineTo(ex + ew / 2 + Math.cos(a) * r, cy + Math.sin(a) * r)
      ctx.stroke()
    } else if (def.effect === 'disk') {
      const r = 9 * S
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1.2 * S
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(ex + ew / 2, cy, r - i * 3.2 * S, 0, Math.PI * 2); ctx.stroke()
      }
      if (n.pulse > 0.02) {
        ctx.strokeStyle = col
        ctx.globalAlpha *= n.pulse
        ctx.lineWidth = 2 * S
        ctx.beginPath(); ctx.arc(ex + ew / 2, cy, r * (1 + (1 - n.pulse) * 0.5), 0, Math.PI * 2); ctx.stroke()
      }
    }
    ctx.restore()
  }

  // Frame furniture for timeline scenes: step label and narration top-left,
  // author top-right, section bottom-left, step counter bottom-right, and a hair
  // of progress along the very top.
  function paintChrome(c) {
    const m = 26 * S
    ctx.save()
    ctx.textBaseline = 'alphabetic'
    letterSpace(2.2 * S)

    if (c.progress > 0) {
      ctx.fillStyle = theme.accent
      ctx.globalAlpha = 0.5
      ctx.fillRect(0, 0, W * c.progress, 2 * S)
      ctx.globalAlpha = 1
    }

    if (c.label) {
      ctx.textAlign = 'left'
      ctx.fillStyle = theme.textDim
      ctx.font = `500 ${10 * S}px ${theme.fontMono}`
      ctx.fillText(c.label.toUpperCase(), m, m + 4 * S)
      ctx.strokeStyle = theme.cardEdge
      ctx.lineWidth = 1 * S
      ctx.beginPath()
      ctx.moveTo(m, m + 14 * S)
      ctx.lineTo(m + Math.min(240 * S, W * 0.32), m + 14 * S)
      ctx.stroke()
    }

    if (c.note) {
      letterSpace(0)
      ctx.textAlign = 'left'
      ctx.fillStyle = theme.text
      ctx.font = `500 ${13 * S}px ${theme.fontDisplay}`
      wrapText(c.note, m, m + 34 * S, Math.min(430 * S, W * 0.5), 18 * S)
      letterSpace(2.2 * S)
    }

    if (c.watermark) {
      ctx.textAlign = 'right'
      ctx.fillStyle = theme.text
      ctx.globalAlpha = 0.82
      ctx.font = `600 ${10 * S}px ${theme.fontMono}`
      ctx.fillText(c.watermark.toUpperCase(), W - m, m + 4 * S)
      ctx.globalAlpha = 1
    }

    if (c.title) {
      ctx.textAlign = 'left'
      ctx.strokeStyle = theme.warn
      ctx.lineWidth = 1.5 * S
      ctx.beginPath()
      ctx.moveTo(m, H - m - 4 * S)
      ctx.lineTo(m + 16 * S, H - m - 4 * S)
      ctx.stroke()
      ctx.fillStyle = theme.textDim
      ctx.font = `500 ${10 * S}px ${theme.fontMono}`
      ctx.fillText(c.title.toUpperCase(), m + 26 * S, H - m)
    }

    ctx.textAlign = 'right'
    ctx.fillStyle = theme.textMute
    ctx.font = `500 ${10 * S}px ${theme.fontMono}`
    ctx.fillText(`${c.index} / ${c.total}`, W - m, H - m)

    letterSpace(0)
    ctx.restore()
  }

  // ctx.letterSpacing is Chromium-only; everywhere else this is a no-op and the
  // type just sits tighter.
  function letterSpace(px) {
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`
  }

  function wrapText(text, x, y, maxW, lineH) {
    const words = String(text).split(' ')
    let line = ''
    for (const w of words) {
      const test = line ? line + ' ' + w : w
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y)
        y += lineH
        line = w
      } else {
        line = test
      }
    }
    if (line) ctx.fillText(line, x, y)
  }

  function paintBackground() {
    ctx.fillStyle = theme.bg
    ctx.fillRect(0, 0, W, H)
    const gap = 26 * S
    ctx.fillStyle = theme.bgDot
    for (let x = gap; x < W; x += gap) {
      for (let y = gap; y < H; y += gap) {
        ctx.fillRect(x, y, 1.2, 1.2)
      }
    }
  }

  // Takes a VIEW edge: its endpoints may be nodes or folded cards, and it may
  // stand for several real edges that collapsed onto the same pair.
  function paintWire(sim, boxes, e) {
    const st = sim.state
    if (e.off) return
    const a = boxes.get(e.from), b = boxes.get(e.to)
    if (!a || !b) return
    const na = e.a, nb = e.b
    const dead = na?.dead || nb?.dead

    // A wire draws itself only as far as its two endpoints have arrived, so the
    // topology assembles in flow order instead of snapping into place.
    const reveal = easeOutCubic(Math.min(na.appear, nb.appear))
    if (reveal <= 0.01) return

    const p1 = edgePoint(a, b.cx, b.cy)
    const full = edgePoint(b, a.cx, a.cy)
    const p2 = { x: mix(p1.x, full.x, reveal), y: mix(p1.y, full.y, reveal) }

    // A wire under the cursor with nothing else over it goes red, so what a
    // right-click would remove is visible before the click.
    const armed = hoverEdge && hoverEdge.from === e.from && hoverEdge.to === e.to
    // An open breaker is the loudest thing a wire can say, so it outranks
    // everything else the wire might be trying to show.
    const trip = breakerOn(sim, e)

    ctx.save()
    const faded = Math.max(na?.dim || 0, nb?.dim || 0)
    ctx.globalAlpha = (dead ? 0.22 : reveal) * mix(1, 0.18, faded)
    ctx.strokeStyle = trip === 'open' ? theme.bad
      : armed ? theme.bad
      : e.async ? theme.wireAsync
      : st.running ? theme.wireActive : theme.wire
    ctx.lineWidth = (armed || trip === 'open' ? 2.4 : 1.5) * S
    ctx.lineCap = 'round'
    // Dashed means nobody is waiting: a hand-off, or a call that is not being
    // made at all right now.
    if (e.async || trip !== 'closed') ctx.setLineDash([7 * S, 5 * S])
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.stroke()
    ctx.setLineDash([])

    if (reveal < 0.995) { ctx.restore(); return }

    // A small chevron so direction reads even when nothing is moving.
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x)
    const t = 0.62
    const mx = p1.x + (p2.x - p1.x) * t
    const my = p1.y + (p2.y - p1.y) * t
    const k = 5 * S
    ctx.globalAlpha *= 0.55
    ctx.beginPath()
    ctx.moveTo(mx - Math.cos(ang - 0.5) * k, my - Math.sin(ang - 0.5) * k)
    ctx.lineTo(mx, my)
    ctx.lineTo(mx - Math.cos(ang + 0.5) * k, my - Math.sin(ang + 0.5) * k)
    ctx.stroke()
    ctx.globalAlpha /= 0.55

    // What the wire is called, and what it is doing. Shown on hover, or always
    // when the author asked for it — a chip on every edge is noise on any board
    // big enough to need groups.
    // Short, because the gap between two cards is often only ~35px wide and a
    // chip that does not fit sits on top of the card next to it.
    const tag = trip === 'open' ? 'OPEN'
      : trip === 'half' ? 'PROBE'
      : armed ? [e.protocol, e.async ? 'async' : null].filter(Boolean).join(' · ')
      : e.label ? e.label
      : null
    if (tag) {
      // Offset perpendicular to the wire, so even a chip wider than the gap
      // clears the cards at both ends instead of landing on one.
      const nx = -Math.sin(ang), ny = Math.cos(ang)
      const off = 13 * S
      wireChip(tag, (p1.x + p2.x) / 2 + nx * off, (p1.y + p2.y) / 2 + ny * off,
               trip !== 'closed' ? theme.bad : e.async ? theme.write : theme.textMute)
    }
    ctx.restore()
  }

  function wireChip(text, x, y, colour) {
    ctx.save()
    letterSpace(0.8 * S)
    ctx.font = `600 ${Math.max(7.5, 8 * S)}px ${theme.fontMono}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const w = ctx.measureText(text).width + 10 * S
    const h = 13 * S
    ctx.fillStyle = theme.bg
    ctx.globalAlpha *= 0.92
    roundRect(x - w / 2, y - h / 2, w, h, 4 * S)
    ctx.fill()
    ctx.strokeStyle = withAlpha(colour === theme.textMute ? '#8087a0' : colour, 0.35)
    ctx.lineWidth = 1 * S
    roundRect(x - w / 2, y - h / 2, w, h, 4 * S)
    ctx.stroke()
    ctx.fillStyle = colour
    ctx.fillText(text, x, y + 0.5 * S)
    letterSpace(0)
    ctx.restore()
  }

  // Worst breaker among the real calls this wire stands for. A folded group can
  // hide several, and one open breaker is the fact worth surfacing.
  function breakerOn(sim, e) {
    if (!sim.breakerState || !e.real) return 'closed'
    let worst = 'closed'
    for (const r of e.real) {
      const st = sim.breakerState(r.from, r.to)
      if (st === 'open') return 'open'
      if (st === 'half') worst = 'half'
    }
    return worst
  }

  function paintPacket(sim, boxes, vg, p) {
    // A hop between two members of the same folded group has both ends on one
    // card and nowhere to travel. It still runs and still counts — it is simply
    // not drawn, which is the whole of what folding does.
    const from = vg.map(p.from), to = vg.map(p.to)
    if (from === to) return
    const a = boxes.get(from), b = boxes.get(to)
    if (!a || !b) return
    const p1 = edgePoint(a, b.cx, b.cy)
    const p2 = edgePoint(b, a.cx, a.cy)

    // Position stays linear: this is a stream, and easing each dot would make
    // the flow clump. Only the dot's size and glow ease, at the two ends.
    const x = p1.x + (p2.x - p1.x) * p.progress
    const y = p1.y + (p2.y - p1.y) * p.progress
    const edge = clamp01(Math.min(p.progress, 1 - p.progress) / 0.11)
    const grow = mix(0.5, 1, easeOutCubic(edge))
    // Four things a dot can be, and they must be told apart at 3.4px: a failure
    // going home, a write on its way out, a read on its way out, an answer.
    const color = p.failed ? theme.bad
      : p.dir === 1 ? (p.kind === 'write' ? theme.write : theme.accent)
      : p.hit ? theme.warn : theme.good

    ctx.save()
    ctx.globalAlpha = mix(0.35, 1, easeOutCubic(edge))
    ctx.shadowColor = color
    ctx.shadowBlur = 10 * S * grow
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, 3.4 * S * grow, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  function paintCard(sim, n, box) {
    const def = typeOf(n)
    const { cx, cy, w, h, hw, hh } = box
    const x = cx - hw, y = cy - hh
    const rate = n.showRate            // damped, so the meter never strobes

    // Entrance: rise, overshoot slightly, settle. Arrival adds a small bump on
    // top of whatever the entrance is already doing.
    const enter = sim.appearOf(n)
    const scale = mix(0.88, 1, easeOutBack(enter)) * (1 + 0.02 * n.pulse)
    const lift = mix(10 * S, 0, easeOutCubic(enter))

    ctx.save()
    ctx.globalAlpha = (n.dead ? 0.35 : 1) * easeOutCubic(enter) * mix(1, 0.2, n.dim)
      * (inFrame(n) ? 1 : 0.4)   // parked outside the export frame
    ctx.translate(cx, cy + lift)
    ctx.scale(scale, scale)
    ctx.translate(-cx, -cy)

    // body
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 11 * S
    ctx.shadowOffsetY = 4 * S
    ctx.fillStyle = theme.card
    roundRect(x, y, w, h, C.r * S)
    ctx.fill()
    ctx.restore()

    // Border. The overload red is layered over the normal edge at n.hot, a
    // damped 0..1, so a node that tips over fades red instead of snapping.
    ctx.strokeStyle = n.pulse > 0 ? theme.cardEdgeHi : theme.cardEdge
    ctx.lineWidth = 1 * S
    roundRect(x, y, w, h, C.r * S)
    ctx.stroke()

    if (n.hot > 0.01) {
      ctx.save()
      ctx.globalAlpha *= n.hot
      ctx.shadowColor = theme.bad
      ctx.shadowBlur = 14 * S
      ctx.strokeStyle = theme.bad
      ctx.lineWidth = 1.6 * S
      roundRect(x, y, w, h, C.r * S)
      ctx.stroke()
      ctx.restore()
    }

    // Degraded is amber and overloaded is red, and they are different problems:
    // one is answering badly, the other has stopped accepting. A single colour
    // for both is how a diagram stops being useful exactly when it matters.
    if (n.degraded) {
      ctx.save()
      ctx.shadowColor = theme.warn
      ctx.shadowBlur = 12 * S
      ctx.strokeStyle = theme.warn
      ctx.lineWidth = 1.6 * S
      roundRect(x, y, w, h, C.r * S)
      ctx.stroke()
      ctx.restore()
    }

    // badge
    const bs = C.badge * S
    const bx = x + C.pad * S
    const by = cy - bs / 2
    const col = colorOf(n)
    ctx.fillStyle = withAlpha(col, 0.16)
    roundRect(bx, by, bs, bs, C.badgeR * S)
    ctx.fill()
    ctx.strokeStyle = withAlpha(col, 0.38)
    ctx.lineWidth = 1 * S
    roundRect(bx, by, bs, bs, C.badgeR * S)
    ctx.stroke()

    ctx.fillStyle = col
    ctx.font = `600 ${8.5 * S}px ${theme.fontMono}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(iconOf(n), bx + bs / 2, by + bs / 2 + 0.5 * S)

    // text block
    const tx = bx + bs + 10 * S
    const hasEffect = !!def.effect && sim.state.running
    const tw = x + w - C.pad * S - tx - (hasEffect ? 34 * S : 0)
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.text
    ctx.font = `600 ${12.5 * S}px ${theme.fontDisplay}`
    // A shorter real word says more than an ellipsis, so the short name is used
    // whenever the full one does not fit. This used to key off a scale
    // threshold, which guessed: at S=1.02 "Message Broker" still did not fit a
    // card with an effect gauge on it, and rendered as "Message…".
    let label = n.label
    if (!n.spec.label && def.short && ctx.measureText(label).width > tw) label = def.short
    ctx.fillText(truncate(label, tw), tx, cy - 7 * S)

    if (sim.state.running && roleOf(n) !== 'source') {
      ctx.fillStyle = n.degraded ? theme.warn : n.hot > 0.5 ? theme.bad : theme.textDim
      ctx.font = `500 ${9.5 * S}px ${theme.fontMono}`
      // Consumer lag is the number people actually put on these diagrams, and
      // it is already sitting in the queue — it just was never shown. Shown on
      // ANY node holding a real backlog, not only a queue: in a broker pipeline
      // the messages pile up at whoever is too slow to read them, and pointing
      // at the broker while the worker is the one drowning would be a lie.
      const lag = sim.lagOf ? sim.lagOf(n) : 0
      const cap = Number.isFinite(n.capacity) ? `/${n.capacity}` : ''
      // Truncation cuts the end, so the word that matters goes first: on a
      // narrow card `12 rps · slow` became `12 rps · sl…` and said nothing.
      const line = n.degraded ? `slow · ${Math.round(rate)} rps`
        : lag >= 5 ? `lag ${lag} · ${Math.round(rate)} rps`
        : `${Math.round(rate)}${cap} rps`
      ctx.fillText(truncate(line, tw), tx, cy + 8 * S)
    } else {
      // Declared facts take the subtitle's place when present, in mono rather
      // than the display face, so they never read as a measurement.
      const declared = declaredOf(n)
      ctx.fillStyle = theme.textMute
      if (declared.length) {
        ctx.font = `500 ${9 * S}px ${theme.fontMono}`
        ctx.fillText(truncate(declared.join(' · '), tw), tx, cy + 8 * S)
      } else {
        ctx.font = `500 ${9.5 * S}px ${theme.fontDisplay}`
        ctx.fillText(truncate(subtitleOf(n), tw), tx, cy + 8 * S)
      }
    }

    // load meter; stays up while the damped rate is still bleeding off so
    // pausing does not make it vanish mid-transition
    if ((sim.state.running || rate > 0.05) && Number.isFinite(n.capacity) && roleOf(n) !== 'source') {
      const frac = clamp(rate / n.capacity, 0, 1)
      const mw = w - C.pad * 2 * S
      const mx = x + C.pad * S
      const my = y + h - C.meterH * S - 5 * S
      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      roundRect(mx, my, mw, C.meterH * S, C.meterH * S / 2)
      ctx.fill()
      ctx.fillStyle = frac > 0.95 ? theme.bad : frac > 0.7 ? theme.warn : theme.good
      roundRect(mx, my, Math.max(2 * S, mw * frac), C.meterH * S, C.meterH * S / 2)
      ctx.fill()
    }

    if (hasEffect) paintEffect(def, n, x, y, w, h)
    paintPolicy(n, x, y, w, h)

    // Drawn inside the card transform so it rides the entrance with everything
    // else rather than floating at the untransformed position.
    if (n.dead) {
      ctx.strokeStyle = theme.bad
      ctx.lineWidth = 2 * S
      ctx.lineCap = 'round'
      const k = 8 * S
      ctx.beginPath()
      ctx.moveTo(bx + bs / 2 - k, cy - k); ctx.lineTo(bx + bs / 2 + k, cy + k)
      ctx.moveTo(bx + bs / 2 + k, cy - k); ctx.lineTo(bx + bs / 2 - k, cy + k)
      ctx.stroke()
    }
    ctx.restore()
  }

  // Returns a VIEW ITEM, not a node: on a folded board the thing under the
  // cursor may be a group card. Callers read `.kind` to tell them apart.
  // Reversed, so a card drawn on top of another wins the click.
  // Small marks in the card's top-right for the policies that change behaviour
  // without changing the shape of the diagram: a retry budget, a breaker, an
  // injected failure rate. Without these they are invisible until they fire.
  function paintPolicy(n, x, y, w, h) {
    const marks = []
    const r = retryOf(n)
    if (r) marks.push({ t: `↻${r.max}`, c: theme.accent })
    if (breakerOf(n)) marks.push({ t: '⦸', c: theme.warn })
    const f = failureOf(n)
    if (f > 0) marks.push({ t: `${Math.round(f * 100)}%`, c: theme.bad })
    if (!marks.length) return

    ctx.save()
    ctx.font = `600 ${Math.max(7, 7.5 * S)}px ${theme.fontMono}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    let px = x + w - 7 * S
    for (const m of marks) {
      const tw2 = ctx.measureText(m.t).width
      ctx.globalAlpha = 0.85
      ctx.fillStyle = m.c
      ctx.fillText(m.t, px, y + 5 * S)
      px -= tw2 + 5 * S
    }
    ctx.restore()
  }

  function hitTest(sim, sx, py0) {
    const { x: px, y: py } = toFrame(sx, py0)
    const items = view(sim).items
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.appear <= 0) continue
      const b = boxOf(it)
      if (Math.abs(px - b.cx) <= b.hw && Math.abs(py - b.cy) <= b.hh) return it
    }
    return null
  }

  // --- geometry helpers -----------------------------------------------------

  // Where the line toward (tx,ty) leaves the card's rectangle.
  function edgePoint(box, tx, ty) {
    const dx = tx - box.cx, dy = ty - box.cy
    if (dx === 0 && dy === 0) return { x: box.cx, y: box.cy }
    const pad = 5
    const sx = dx === 0 ? Infinity : (box.hw + pad) / Math.abs(dx)
    const sy = dy === 0 ? Infinity : (box.hh + pad) / Math.abs(dy)
    const t = Math.min(sx, sy)
    return { x: box.cx + dx * t, y: box.cy + dy * t }
  }

  function roundRect(x, y, w, h, r) {
    const k = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + k, y)
    ctx.lineTo(x + w - k, y);      ctx.quadraticCurveTo(x + w, y, x + w, y + k)
    ctx.lineTo(x + w, y + h - k);  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h)
    ctx.lineTo(x + k, y + h);      ctx.quadraticCurveTo(x, y + h, x, y + h - k)
    ctx.lineTo(x, y + k);          ctx.quadraticCurveTo(x, y, x + k, y)
    ctx.closePath()
  }

  function truncate(text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text
    let s = text
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
    return s + '…'
  }

  resize()
  return {
    draw, resize, fit, hitTest, hoverTargetAt, fromPx, handleAt, edgeHitTest, sectionHeadAt,
    snapNode, clearGuides, nodesInMarquee, sectionGripAt,
    groupHeadAt, groupChevronAt,
    setHoverGroup: id => { hoverGroup = id },
    view,
    setShowFrame: v => { showFrame = v },
    get showFrame() { return showFrame },
    setSelection: set => { selection = set },
    setMarquee: m => { marquee = m },
    toFrame, resetCamera, frameCamera, panBy, zoomAt,
    setHover: id => { hoverId = id },
    setHoverEdge: e => { hoverEdge = e },
    setHoverSection: id => { hoverSection = id },
    setPending: p => { pending = p },
    get camera() { return cam },
    get guides() { return guides },
    get scale() { return S },
    get gutter() { return gutter },
    get size() { return { W, H } },
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
