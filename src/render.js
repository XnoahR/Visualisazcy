// Canvas 2D renderer. No SVG, no animation library, no dependencies.
// Cards are rounded rects; wires are straight lines clipped to the card edge;
// packets are dots at a lerped position. That is the entire visual system.

import { theme, card as C } from './theme.js'
import { typeOf, roleOf } from './registry.js'
import { easeOutBack, easeOutCubic, clamp01, mix, damp } from './ease.js'
import { drawAnnotations } from './annotate.js'

// Scene-kind registry. 'graph' is built in; anything else registers into it.
const SCENE_KINDS = {}

export function registerRenderer(kind, fn) {
  SCENE_KINDS[kind] = fn
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d')
  let W = 0, H = 0, S = 1, dt = 16

  // A step can reserve the left edge for its annotations. The diagram then maps
  // its fractional x into the remaining width instead of being drawn over. This
  // is the layout language the reference work uses: commentary column on one
  // side, system on the other.
  let gutter = 0

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
  }

  // Shrink until no two cards collide. Positions are fractions, so how much room
  // a layout actually has only becomes knowable once the canvas is sized — this
  // is what keeps a scene authored for 16:9 legible at 1:1.
  function fit(nodes) {
    const gap = 16
    const visible = nodes.filter(n => !n.hidden)
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const dx = Math.abs(visible[i].x - visible[j].x) * W * (1 - gutter)
        const dy = Math.abs(visible[i].y - visible[j].y) * H
        // The pair is clear if it separates on either axis; take the roomier one.
        const room = Math.max((dx - gap) / C.w, (dy - gap) / C.h)
        if (room < S) S = Math.max(0.42, room)
      }
    }
  }

  // Pixel geometry for a node, derived from its fractional position.
  const toPx = fx => (gutter + fx * (1 - gutter)) * W
  const fromPx = px => (px / W - gutter) / (1 - gutter)

  function boxOf(n) {
    const w = C.w * S, h = C.h * S
    const cx = clamp(toPx(n.x), w / 2 + 4 + gutter * W, W - w / 2 - 4)
    const cy = clamp(n.y * H, h / 2 + 4, H - h / 2 - 4)
    return { cx, cy, w, h, hw: w / 2, hh: h / 2 }
  }

  // A scene declares its kind; the kind decides how the body of the frame is
  // drawn. Everything around it — background, annotations, chrome, easing, the
  // timeline — is shared, which is the whole point of the split: a new visual
  // vocabulary costs one function, not a second engine.
  function drawGraph(surf, sim) {
    const st = sim.state
    const boxes = new Map(st.nodes.map(n => [n.id, boxOf(n)]))
    for (const e of st.edges) paintWire(sim, boxes, e)
    for (const p of st.packets) paintPacket(sim, boxes, p)
    for (const n of st.nodes) {
      if (sim.appearOf(n) <= 0) continue
      paintCard(sim, n, boxes.get(n.id))
    }
    return boxes
  }

  function draw(sim, chrome = null, frameDt = 16) {
    dt = frameDt
    gutter = chrome?.gutter || 0
    const st = sim.state
    ctx.clearRect(0, 0, W, H)
    paintBackground()

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

  function paintWire(sim, boxes, e) {
    const st = sim.state
    if (e.off) return
    const a = boxes.get(e.from), b = boxes.get(e.to)
    if (!a || !b) return
    const na = sim.byId(e.from)
    const nb = sim.byId(e.to)
    const dead = na?.dead || nb?.dead

    // A wire draws itself only as far as its two endpoints have arrived, so the
    // topology assembles in flow order instead of snapping into place.
    const reveal = easeOutCubic(Math.min(sim.appearOf(na), sim.appearOf(nb)))
    if (reveal <= 0.01) return

    const p1 = edgePoint(a, b.cx, b.cy)
    const full = edgePoint(b, a.cx, a.cy)
    const p2 = { x: mix(p1.x, full.x, reveal), y: mix(p1.y, full.y, reveal) }

    ctx.save()
    const faded = Math.max(na?.dim || 0, nb?.dim || 0)
    ctx.globalAlpha = (dead ? 0.22 : reveal) * mix(1, 0.18, faded)
    ctx.strokeStyle = st.running ? theme.wireActive : theme.wire
    ctx.lineWidth = 1.5 * S
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.stroke()

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
    ctx.restore()
  }

  function paintPacket(sim, boxes, p) {
    const a = boxes.get(p.from), b = boxes.get(p.to)
    if (!a || !b) return
    const p1 = edgePoint(a, b.cx, b.cy)
    const p2 = edgePoint(b, a.cx, a.cy)

    // Position stays linear: this is a stream, and easing each dot would make
    // the flow clump. Only the dot's size and glow ease, at the two ends.
    const x = p1.x + (p2.x - p1.x) * p.progress
    const y = p1.y + (p2.y - p1.y) * p.progress
    const edge = clamp01(Math.min(p.progress, 1 - p.progress) / 0.11)
    const grow = mix(0.5, 1, easeOutCubic(edge))
    const color = p.dir === 1 ? theme.accent : theme.good

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

    // badge
    const bs = C.badge * S
    const bx = x + C.pad * S
    const by = cy - bs / 2
    ctx.fillStyle = withAlpha(def.color, 0.16)
    roundRect(bx, by, bs, bs, C.badgeR * S)
    ctx.fill()
    ctx.strokeStyle = withAlpha(def.color, 0.38)
    ctx.lineWidth = 1 * S
    roundRect(bx, by, bs, bs, C.badgeR * S)
    ctx.stroke()

    ctx.fillStyle = def.color
    ctx.font = `600 ${8.5 * S}px ${theme.fontMono}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(def.icon, bx + bs / 2, by + bs / 2 + 0.5 * S)

    // text block
    const tx = bx + bs + 10 * S
    const tw = x + w - C.pad * S - tx
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.text
    ctx.font = `600 ${12.5 * S}px ${theme.fontDisplay}`
    ctx.fillText(truncate(n.label, tw), tx, cy - 7 * S)

    if (sim.state.running && roleOf(n) !== 'source') {
      ctx.fillStyle = n.hot > 0.5 ? theme.bad : theme.textDim
      ctx.font = `500 ${9.5 * S}px ${theme.fontMono}`
      const cap = Number.isFinite(n.capacity) ? `/${n.capacity}` : ''
      ctx.fillText(`${Math.round(rate)}${cap} rps`, tx, cy + 8 * S)
    } else {
      ctx.fillStyle = theme.textMute
      ctx.font = `500 ${9.5 * S}px ${theme.fontDisplay}`
      ctx.fillText(truncate(def.subtitle, tw), tx, cy + 8 * S)
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

  function hitTest(sim, px, py) {
    for (const n of sim.state.nodes) {
      const b = boxOf(n)
      if (Math.abs(px - b.cx) <= b.hw && Math.abs(py - b.cy) <= b.hh) return n
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
    draw, resize, fit, hitTest, fromPx,
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
