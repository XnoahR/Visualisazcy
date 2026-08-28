// The slots renderer: a row or column of cells whose contents change per step,
// with pointers labelling positions.
//
// This one shape covers a surprising amount of what a node graph cannot say —
// LRU caches, the stack and the heap, hash buckets, cache tables, shard maps.
// The reference work leans on it constantly, and it is the reason roughly half
// its scenes are not topologies at all.
//
// A cell that changes between steps flashes; the flash decays. Everything else
// about the frame — chrome, annotations, focus, timing — is the shared shell.

import { registerRenderer } from '../render.js'
import { easeOutBack, easeOutCubic, clamp01, mix, damp } from '../ease.js'

const TONES = s => ({
  good: s.theme.good, bad: s.theme.bad, warn: s.theme.warn,
  accent: s.theme.accent, dim: s.theme.textDim, plain: s.theme.text,
})

registerRenderer('slots', (s, sim, chrome, rt) => {
  const { ctx, S, W, H } = s
  const scene = sim.state.scene
  const cfg = scene.slots || {}
  const step = chrome ? scene.steps[chrome.index - 1] : scene.steps?.[0]
  if (!step) return

  const cells = step.cells || []
  const vertical = cfg.orientation === 'column'
  const tones = TONES(s)

  const cw = (cfg.cellWidth || (vertical ? 150 : 92)) * S
  const ch = (cfg.cellHeight || 62) * S
  const gap = (cfg.gap ?? 10) * S
  const n = Math.max(cells.length, cfg.count || cells.length)

  const spanW = vertical ? cw : n * cw + (n - 1) * gap
  const spanH = vertical ? n * ch + (n - 1) * gap : ch

  // Sits inside whatever the gutter leaves, so a slots scene takes annotations
  // in the same left column a graph scene does.
  const left = s.gutter * W
  const originX = left + ((W - left) - spanW) / 2 + (cfg.dx || 0) * S
  const originY = H / 2 - spanH / 2 + (cfg.dy || 0) * S

  const enter = chrome ? clamp01(chrome.enter / 0.5) : 1

  if (cfg.label) {
    ctx.save()
    ctx.globalAlpha = easeOutCubic(enter)
    s.letterSpace(2 * S)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = s.theme.textMute
    ctx.font = `500 ${10 * S}px ${s.theme.fontMono}`
    ctx.fillText(cfg.label.toUpperCase(), originX, originY - 16 * S)
    s.letterSpace(0)
    ctx.restore()
  }

  const boxes = new Map()

  for (let i = 0; i < n; i++) {
    const cell = cells[i] || null
    const x = vertical ? originX : originX + i * (cw + gap)
    const y = vertical ? originY + i * (ch + gap) : originY
    const cx = x + cw / 2, cy = y + ch / 2
    boxes.set(cfg.ids?.[i] || `slot${i}`, { cx, cy, w: cw, h: ch, hw: cw / 2, hh: ch / 2 })

    // A cell flashes when its contents differ from the previous frame, which is
    // what makes an eviction or a push readable rather than just "now different".
    const text = cell?.text ?? ''
    const prev = rt.store.get(`cell${i}`, { text, flash: 0 })
    if (prev.text !== text) { prev.text = text; prev.flash = 1 }
    prev.flash = Math.max(0, prev.flash - s.dt / 420)

    const t = easeOutCubic(clamp01((chrome ? chrome.enter : 1) / 0.45 - i * 0.16))
    if (t <= 0) continue

    const tone = cell?.tone ? tones[cell.tone] : null
    const scale = mix(0.9, 1, easeOutBack(t)) * (1 + 0.03 * prev.flash)

    ctx.save()
    ctx.globalAlpha = t
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    ctx.translate(-cx, -cy)

    ctx.fillStyle = cell ? s.theme.card : 'rgba(255,255,255,0.018)'
    s.roundRect(x, y, cw, ch, 10 * S)
    ctx.fill()

    ctx.strokeStyle = tone
      ? tone
      : cell ? s.theme.cardEdgeHi : s.theme.cardEdge
    ctx.lineWidth = (tone ? 1.4 : 1) * S
    if (prev.flash > 0.02 && tone) {
      ctx.shadowColor = tone
      ctx.shadowBlur = 14 * S * prev.flash
    }
    s.roundRect(x, y, cw, ch, 10 * S)
    ctx.stroke()
    ctx.shadowBlur = 0

    if (cell?.text) {
      ctx.fillStyle = tone || s.theme.text
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `600 ${(cell.size || 17) * S}px ${s.theme.fontDisplay}`
      ctx.fillText(s.truncate(String(cell.text), cw - 14 * S), cx, cy - (cell.sub ? 7 * S : 0))
      if (cell.sub) {
        ctx.fillStyle = s.theme.textMute
        ctx.font = `500 ${9.5 * S}px ${s.theme.fontMono}`
        ctx.fillText(s.truncate(String(cell.sub), cw - 12 * S), cx, cy + 11 * S)
      }
    }
    ctx.restore()
  }

  // Pointers name a position rather than a value: HEAD, TAIL, NEXT TO EVICT.
  for (const ptr of step.pointers || []) {
    const i = ptr.at
    if (i < 0 || i >= n) continue
    const x = vertical ? originX : originX + i * (cw + gap)
    const y = vertical ? originY + i * (ch + gap) : originY
    const cx = x + cw / 2
    const below = ptr.side !== 'above'
    const t = easeOutCubic(clamp01((chrome ? chrome.enter : 1) / 0.5 - 0.3))
    if (t <= 0) continue

    const tone = ptr.tone ? tones[ptr.tone] : s.theme.textDim
    ctx.save()
    ctx.globalAlpha = t * 0.9
    ctx.strokeStyle = tone
    ctx.lineWidth = 1 * S
    ctx.beginPath()
    if (vertical) {
      ctx.moveTo(x + cw, y + ch / 2)
      ctx.lineTo(x + cw + 16 * S, y + ch / 2)
    } else {
      const y0 = below ? y + ch : y
      ctx.moveTo(cx, y0)
      ctx.lineTo(cx, y0 + (below ? 14 * S : -14 * S))
    }
    ctx.stroke()

    s.letterSpace(1.6 * S)
    ctx.fillStyle = tone
    ctx.font = `500 ${9.5 * S}px ${s.theme.fontMono}`
    if (vertical) {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(ptr.text.toUpperCase(), x + cw + 22 * S, y + ch / 2)
    } else {
      ctx.textAlign = 'center'
      ctx.textBaseline = below ? 'top' : 'alphabetic'
      ctx.fillText(ptr.text.toUpperCase(), cx, below ? y + ch + 20 * S : y - 20 * S)
    }
    s.letterSpace(0)
    ctx.restore()
  }

  return boxes
})
