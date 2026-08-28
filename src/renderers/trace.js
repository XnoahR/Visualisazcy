// The 'trace' scene kind, drawn in a blueprint style.
//
// Blueprint here means a small set of rules held consistently, not a mood:
//   - stroke, do not fill; the subject is solid, the structure is not
//   - dashed for containers and guides, solid for the thing being measured
//   - depth comes from opacity, never from a shadow or a gradient
//   - every label is monospace, uppercase, widely letter-spaced
//   - two accents and no third: one for "fine", one for "look here"
//
// Those rules are the whole difference between this and the filled cards of the
// graph renderer. Nothing here needs an ability the engine did not already have.

import { registerRenderer } from '../render.js'
import { easeOutCubic, clamp01, mix } from '../ease.js'

const INK_LINE = 'rgba(255,255,255,0.16)'
const INK_GUIDE = 'rgba(255,255,255,0.09)'

registerRenderer('trace', (s, sim, chrome) => {
  const { ctx, S, W, H } = s
  const scene = sim.state.scene
  const step = chrome ? scene.steps[chrome.index - 1] : scene.steps?.[0]
  if (!step) return

  const visible = scene.lanes.filter(l => (step.lanes || []).includes(l.id))
  if (!visible.length) return

  const panels = step.panels || []
  const enter = chrome ? clamp01(chrome.enter / 0.5) : 1

  // How much of each trace is drawn. 'play' ties it to the step's own progress,
  // so the path draws itself while the narration is being read.
  const drawn = step.trace === 'play'
    ? easeOutCubic(clamp01((chrome ? chrome.progress : 1) / 0.72))
    : (typeof step.trace === 'number' ? step.trace : 1)

  const portrait = H > W
  const left = s.gutter * W
  const usable = W - left
  const pad = 30 * S
  const n = visible.length

  // How much room the panels under a trace actually need. The first version
  // guessed with a fixed ratio, which is why portrait overflowed the frame:
  // four metric rows and a verdict do not fit in half a stacked lane.
  function panelHeight(lane) {
    let h = 0
    if (panels.includes('metrics')) h += 4 * 19 * S + 12 * S
    if (panels.includes('score')) h += 47 * S
    if (panels.includes('verdict')) h += 26 * S + (lane.score >= 0.5 ? 10 * S : 38 * S)
    return h ? h + 26 * S : 0
  }

  // Chrome owns the top (label plus a narration that wraps to two lines) and a
  // strip at the bottom for the section line and step counter. Lanes get what
  // is left, never more.
  const top = portrait ? H * 0.20 : H * 0.245
  const bottom = portrait ? H * 0.09 : H * 0.06
  const avail = H - top - bottom

  const lanes = visible.map((lane, i) => {
    if (portrait) {
      const gap = 18 * S
      const h = (avail - gap * (n - 1)) / n
      return { lane, x: left + pad, y: top + i * (h + gap), w: usable - pad * 2, h }
    }
    const w = (usable - pad * (n + 1)) / n
    return { lane, x: left + pad + i * (w + pad), y: top, w, h: avail }
  })

  for (const slot of lanes) paintLane(slot)

  function paintLane({ lane, x, y, w, h }) {
    const tone = s.theme[lane.tone] || s.theme.accent
    // Whatever the panels do not need, the trace box gets — with a floor, so a
    // crowded frame shrinks the picture rather than pushing it off the edge.
    const boxH = Math.max(h * 0.22, h - panelHeight(lane))

    ctx.save()
    ctx.globalAlpha = easeOutCubic(enter)

    // --- lane title -------------------------------------------------------
    s.letterSpace(2.2 * S)
    ctx.font = `600 ${Math.max(9, 10 * S)}px ${s.theme.fontMono}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = tone
    ctx.fillText(lane.label.toUpperCase(), x, y - 11 * S)
    s.letterSpace(0)

    // --- the container: dashed, because it is a boundary, not a thing -----
    ctx.strokeStyle = INK_GUIDE
    ctx.lineWidth = 1
    ctx.setLineDash([5 * S, 5 * S])
    s.roundRect(x, y, w, boxH, 3 * S)
    ctx.stroke()
    ctx.setLineDash([])

    // corner ticks: pure instrument furniture, carries no information
    const t = 9 * S
    ctx.strokeStyle = INK_LINE
    ctx.beginPath()
    ctx.moveTo(x, y + t); ctx.lineTo(x, y); ctx.lineTo(x + t, y)
    ctx.moveTo(x + w - t, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + t)
    ctx.moveTo(x, y + boxH - t); ctx.lineTo(x, y + boxH); ctx.lineTo(x + t, y + boxH)
    ctx.moveTo(x + w - t, y + boxH); ctx.lineTo(x + w, y + boxH); ctx.lineTo(x + w, y + boxH - t)
    ctx.stroke()

    const P = (p) => ({ x: x + p.x * w, y: y + p.y * boxH })
    const pts = lane.points
    const head = Math.max(1, Math.floor(drawn * (pts.length - 1)))

    // --- the target ------------------------------------------------------
    const target = P(pts[pts.length - 1])
    const bx = 15 * S
    const ticked = panels.includes('verdict') && lane.score >= 0.5

    ctx.strokeStyle = ticked ? s.theme.good : INK_LINE
    ctx.lineWidth = 1.3
    s.roundRect(target.x - bx, target.y - bx, bx * 2, bx * 2, 3 * S)
    ctx.stroke()

    if (ticked) {
      ctx.strokeStyle = s.theme.good
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(target.x - bx * 0.45, target.y)
      ctx.lineTo(target.x - bx * 0.08, target.y + bx * 0.4)
      ctx.lineTo(target.x + bx * 0.5, target.y - bx * 0.42)
      ctx.stroke()
    }

    s.letterSpace(1.4 * S)
    ctx.font = `500 ${Math.max(8, 8.5 * S)}px ${s.theme.fontMono}`
    ctx.fillStyle = s.theme.textMute
    const cap = 'I AM NOT A ROBOT'
    const capW = ctx.measureText(cap).width
    // Beside the box if it fits inside the lane, underneath it if not.
    if (target.x + bx + 9 * S + capW <= x + w) {
      ctx.textAlign = 'left'
      ctx.fillText(cap, target.x + bx + 9 * S, target.y + 3 * S)
    } else {
      ctx.textAlign = 'center'
      ctx.fillText(cap, Math.min(Math.max(target.x, x + capW / 2), x + w - capW / 2), target.y + bx + 15 * S)
    }
    s.letterSpace(0)

    // --- the straight line, for comparison --------------------------------
    if (drawn > 0.02) {
      const a = P(pts[0]), b = P(pts[pts.length - 1])
      ctx.strokeStyle = INK_GUIDE
      ctx.lineWidth = 1
      ctx.setLineDash([3 * S, 4 * S])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // --- the trace itself: the one solid stroke in the frame --------------
    if (drawn > 0.005) {
      ctx.strokeStyle = tone
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      const first = P(pts[0])
      ctx.moveTo(first.x, first.y)
      for (let i = 1; i <= head; i++) {
        const p = P(pts[i])
        ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()

      // start marker
      ctx.strokeStyle = INK_LINE
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(first.x, first.y, 3.5 * S, 0, Math.PI * 2)
      ctx.stroke()

      // cursor at the head
      const c = P(pts[head])
      ctx.fillStyle = tone
      ctx.beginPath()
      ctx.arc(c.x, c.y, 2.6 * S, 0, Math.PI * 2)
      ctx.fill()
      if (drawn < 0.999) {
        ctx.strokeStyle = tone
        ctx.globalAlpha *= 0.45
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(c.x, c.y, 7 * S, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha /= 0.45
      }
    }

    // --- panels -----------------------------------------------------------
    let py = y + boxH + 26 * S
    if (panels.includes('metrics')) py = paintMetrics(lane, x, py, w, tone)
    if (panels.includes('score')) py = paintScore(lane, x, py, w, tone)
    if (panels.includes('verdict')) paintVerdict(lane, x, py, w)
    ctx.restore()
  }

  function paintMetrics(lane, x, y, w, tone) {
    const m = lane.metrics
    const rows = [
      ['PATH VS STRAIGHT', m.tortuosity.toFixed(3), m.tortuosity > 1.001],
      ['DIRECTION CHANGES', String(m.turns), m.turns > 0],
      ['SPEED VARIATION', m.speedVar.toFixed(3), m.speedVar > 0.001],
      ['TIME TO CLICK', `${m.duration} MS`, m.duration > 400],
    ]
    const lh = 19 * S
    for (const [label, value, notable] of rows) {
      s.letterSpace(1.5 * S)
      ctx.font = `500 ${Math.max(8, 8.5 * S)}px ${s.theme.fontMono}`
      ctx.fillStyle = s.theme.textMute
      ctx.textAlign = 'left'
      ctx.fillText(label, x, y)

      ctx.font = `600 ${Math.max(9.5, 11 * S)}px ${s.theme.fontMono}`
      ctx.fillStyle = notable ? tone : s.theme.textDim
      ctx.textAlign = 'right'
      ctx.fillText(value, x + w, y)
      s.letterSpace(0)

      ctx.strokeStyle = INK_GUIDE
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, y + 6 * S)
      ctx.lineTo(x + w, y + 6 * S)
      ctx.stroke()
      y += lh
    }
    return y + 12 * S
  }

  function paintScore(lane, x, y, w, tone) {
    s.letterSpace(1.5 * S)
    ctx.font = `500 ${Math.max(8, 8.5 * S)}px ${s.theme.fontMono}`
    ctx.fillStyle = s.theme.textMute
    ctx.textAlign = 'left'
    ctx.fillText('CONFIDENCE', x, y)
    s.letterSpace(0)

    ctx.font = `700 ${Math.max(15, 19 * S)}px ${s.theme.fontDisplay}`
    ctx.fillStyle = tone
    ctx.textAlign = 'right'
    ctx.fillText(lane.score.toFixed(2), x + w, y + 2 * S)

    const by = y + 13 * S
    ctx.strokeStyle = INK_GUIDE
    ctx.lineWidth = 1
    ctx.strokeRect(x, by, w, 5 * S)
    ctx.fillStyle = tone
    ctx.fillRect(x, by, Math.max(1, w * lane.score), 5 * S)

    // the threshold, marked rather than described
    const tx = x + w * 0.5
    ctx.strokeStyle = s.theme.textMute
    ctx.beginPath()
    ctx.moveTo(tx, by - 4 * S)
    ctx.lineTo(tx, by + 9 * S)
    ctx.stroke()
    return by + 34 * S
  }

  function paintVerdict(lane, x, y, w) {
    const pass = lane.score >= 0.5
    const label = pass ? 'TICKED, NO PUZZLE' : 'PUZZLE SHOWN'
    const tone = pass ? s.theme.good : s.theme.bad

    ctx.strokeStyle = tone
    ctx.lineWidth = 1
    s.roundRect(x, y, w, 26 * S, 3 * S)
    ctx.stroke()

    s.letterSpace(1.8 * S)
    ctx.font = `600 ${Math.max(8.5, 9.5 * S)}px ${s.theme.fontMono}`
    ctx.fillStyle = tone
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + w / 2, y + 13 * S + 0.5)
    s.letterSpace(0)
    ctx.textBaseline = 'alphabetic'

    if (!pass) {
      // a 3x3 grid: the follow-up question, not the test
      const g = 7 * S, gap = 2 * S
      const gx = x + w / 2 - (g * 3 + gap * 2) / 2
      const gy = y + 36 * S
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          ctx.strokeRect(gx + c * (g + gap), gy + r * (g + gap), g, g)
        }
      }
    }
  }
})
