// Annotations are what turn a diagram into an explanation.
//
// A card can only ever say what it is. An annotation says what to notice about
// it — the number that matters, the comparison, the sentence that lands. In the
// reference work this layer carries most of the frame, and it is all typography
// and geometry: no illustration required.
//
// Every mark is declared as data on a timeline step and anchors either to a node
// id (so it follows drags and relayouts) or to a fractional position.

import { theme } from './theme.js'
import { easeOutCubic, clamp01, mix } from './ease.js'

const TONES = {
  good: theme.good, bad: theme.bad, warn: theme.warn,
  accent: theme.accent, dim: theme.textDim, plain: theme.text,
}
const toneOf = t => TONES[t] || theme.text

export function drawAnnotations(s, list, enter, counters) {
  if (!list || !list.length) return
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    // Marks stagger in after the step lands, so the eye gets the diagram first
    // and the commentary second.
    const t = easeOutCubic(clamp01((enter - i * 0.12) / 0.55))
    if (t <= 0) continue
    s.ctx.save()
    s.ctx.globalAlpha = t
    s.ctx.translate(0, mix(8 * s.S, 0, t))
    const fn = MARKS[a.type]
    if (fn) fn(s, a, i, counters)
    s.ctx.restore()
  }
}

// Resolve an anchor: a node id, or [x, y] as fractions of the canvas.
function anchor(s, at) {
  if (Array.isArray(at)) return { x: at[0] * s.W, y: at[1] * s.H, box: null }
  const box = s.nodeBox(at)
  return box ? { x: box.cx, y: box.cy, box } : { x: s.W / 2, y: s.H / 2, box: null }
}

const MARKS = {
  // A bordered box of text with a short leader line back to what it describes.
  // The side is chosen, not assumed: a callout that lands on another card is
  // worse than no callout, and which side is free depends on the topology.
  callout(s, a) {
    const { ctx, S } = s
    const p = anchor(s, a.at)
    const pad = 9 * S
    const maxW = (a.width || 190) * S

    ctx.font = `500 ${11.5 * S}px ${theme.fontDisplay}`
    const lines = wrap(ctx, a.text, maxW - pad * 2)
    const lineH = 15 * S
    const boxW = maxW
    const boxH = lines.length * lineH + pad * 2 - 3 * S

    const hw = p.box ? p.box.hw : 0
    const hh = p.box ? p.box.hh : 0
    const gapX = hw + 26 * S
    const gapY = hh + 20 * S

    const candidates = {
      right: [p.x + gapX, p.y - boxH / 2],
      left:  [p.x - gapX - boxW, p.y - boxH / 2],
      below: [p.x - boxW / 2, p.y + gapY],
      above: [p.x - boxW / 2, p.y - gapY - boxH],
    }
    const order = a.side && a.side !== 'auto'
      ? [a.side, ...Object.keys(candidates).filter(k => k !== a.side)]
      : ['right', 'left', 'below', 'above']

    let best = null, bestCost = Infinity
    for (const name of order) {
      let [cx, cy] = candidates[name]
      cx = Math.max(8 * S, Math.min(s.W - boxW - 8 * S, cx))
      cy = Math.max(8 * S, Math.min(s.H - boxH - 8 * S, cy))
      const cost = overlapArea(s, cx, cy, boxW, boxH, a.at)
      if (cost < bestCost) { bestCost = cost; best = { name, cx, cy } }
      if (cost === 0) break
    }

    const side = best.name === 'left' ? 'left' : 'right'
    let bx = best.cx
    let by = best.cy

    // leader
    const tone = toneOf(a.tone || 'accent')
    ctx.strokeStyle = tone
    ctx.globalAlpha *= 0.75
    ctx.lineWidth = 1 * S
    ctx.beginPath()
    if (best.name === 'above' || best.name === 'below') {
      const edgeY = best.name === 'below' ? p.y + hh : p.y - hh
      ctx.moveTo(p.x, edgeY)
      ctx.lineTo(p.x, best.name === 'below' ? by : by + boxH)
    } else {
      ctx.moveTo(side === 'left' ? p.x - hw : p.x + hw, p.y)
      ctx.lineTo(side === 'left' ? bx + boxW : bx, p.y)
    }
    ctx.stroke()
    ctx.globalAlpha /= 0.75

    ctx.fillStyle = 'rgba(14,16,24,0.94)'
    s.roundRect(bx, by, boxW, boxH, 9 * S)
    ctx.fill()
    ctx.strokeStyle = tone
    ctx.lineWidth = 1 * S
    s.roundRect(bx, by, boxW, boxH, 9 * S)
    ctx.stroke()

    ctx.fillStyle = theme.text
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    lines.forEach((ln, i) => ctx.fillText(ln, bx + pad, by + pad + i * lineH))
  },

  // A big number that counts rather than jumps, with a caption under it.
  stat(s, a, i, counters) {
    const { ctx, S } = s
    const p = anchor(s, a.at)
    const key = a.key || `stat${i}`
    const shown = counters ? counters.read(key, a.value) : a.value
    const tone = toneOf(a.tone || 'plain')

    ctx.textAlign = a.align || 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = tone
    ctx.font = `700 ${(a.size || 34) * S}px ${theme.fontDisplay}`
    const text = a.format === 'comma'
      ? Math.round(shown).toLocaleString('en-US')
      : String(Math.round(shown))
    ctx.fillText(text, p.x, p.y)

    if (a.label) {
      ctx.fillStyle = theme.textDim
      ctx.font = `500 ${11.5 * S}px ${theme.fontDisplay}`
      ctx.fillText(a.label, p.x, p.y + 17 * S)
    }
  },

  // Two or more quantities as one proportional bar. This is the mark that makes
  // a comparison land without a chart.
  bar(s, a) {
    const { ctx, S } = s
    const p = anchor(s, a.at)
    const w = (a.width || 220) * S
    const h = (a.height || 6) * S
    const total = a.parts.reduce((n, q) => n + q.value, 0) || 1
    let x = p.x
    for (const part of a.parts) {
      ctx.fillStyle = toneOf(part.tone)
      const pw = (part.value / total) * w
      ctx.fillRect(x, p.y, pw, h)
      x += pw
    }
    if (a.label) {
      ctx.fillStyle = theme.textMute
      ctx.textAlign = 'left'
      ctx.font = `500 ${11 * S}px ${theme.fontDisplay}`
      ctx.fillText(a.label, p.x, p.y + h + 15 * S)
    }
  },

  // A square bracket spanning a group of nodes, with a label on the outside.
  bracket(s, a) {
    const { ctx, S } = s
    const boxes = a.nodes.map(id => s.nodeBox(id)).filter(Boolean)
    if (!boxes.length) return
    const top = Math.min(...boxes.map(b => b.cy - b.hh))
    const bottom = Math.max(...boxes.map(b => b.cy + b.hh))
    const right = Math.max(...boxes.map(b => b.cx + b.hw))
    const x = right + 18 * S
    const arm = 8 * S

    ctx.strokeStyle = toneOf(a.tone || 'dim')
    ctx.lineWidth = 1.2 * S
    ctx.beginPath()
    ctx.moveTo(x - arm, top); ctx.lineTo(x, top)
    ctx.lineTo(x, bottom);    ctx.lineTo(x - arm, bottom)
    ctx.stroke()

    if (a.text) {
      ctx.save()
      ctx.translate(x + 14 * S, (top + bottom) / 2)
      ctx.rotate(Math.PI / 2)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = toneOf(a.tone || 'dim')
      ctx.font = `500 ${11 * S}px ${theme.fontDisplay}`
      ctx.fillText(a.text, 0, 0)
      ctx.restore()
    }
  },

  // The sentence that closes the beat.
  note(s, a) {
    const { ctx, S } = s
    const p = anchor(s, a.at)
    ctx.textAlign = a.align || 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = toneOf(a.tone || 'dim')
    ctx.font = `500 ${(a.size || 12.5) * S}px ${theme.fontDisplay}`
    const lines = wrap(ctx, a.text, (a.width || 260) * S)
    lines.forEach((ln, i) => ctx.fillText(ln, p.x, p.y + i * 17 * S))
  },
}

// How much of a proposed callout rect lands on top of other cards.
function overlapArea(s, x, y, w, h, exceptId) {
  let total = 0
  for (const [id, b] of s.allBoxes()) {
    if (id === exceptId) continue
    const ox = Math.min(x + w, b.cx + b.hw) - Math.max(x, b.cx - b.hw)
    const oy = Math.min(y + h, b.cy + b.hh) - Math.max(y, b.cy - b.hh)
    if (ox > 0 && oy > 0) total += ox * oy
  }
  return total
}

// The escape hatch. A scene that needs one odd mark registers a plain function
// instead of anyone inventing a scripting language for it.
export function registerMark(type, fn) {
  MARKS[type] = fn
}

export function markTypes() {
  return Object.keys(MARKS)
}

function wrap(ctx, text, maxW) {
  const out = []
  let line = ''
  for (const word of String(text).split(' ')) {
    const test = line ? line + ' ' + word : word
    if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word }
    else line = test
  }
  if (line) out.push(line)
  return out
}
