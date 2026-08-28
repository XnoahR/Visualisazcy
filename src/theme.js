// Design tokens. Everything visual reads from here, so a rebrand is one edit.

export const theme = {
  // surfaces
  bg:         '#08090d',
  bgDot:      'rgba(255,255,255,0.075)',
  card:       '#14171f',
  cardEdge:   'rgba(255,255,255,0.055)',
  cardEdgeHi: 'rgba(255,255,255,0.13)',

  // ink
  text:     '#f5f6fa',
  textDim:  '#9498ab',
  textMute: '#5a5f74',

  // state
  accent: '#6ea0ff',
  good:   '#6ee7b7',
  warn:   '#fcd34d',
  bad:    '#fca5a5',

  // wires
  wire:       'rgba(255,255,255,0.14)',
  wireActive: 'rgba(110,160,255,0.34)',

  fontDisplay: '"Space Grotesk", system-ui, sans-serif',
  fontMono:    '"JetBrains Mono", ui-monospace, monospace',
}

// Card geometry at scale 1. Scaled per-canvas so one scene fits any aspect.
export const card = {
  w: 168,
  h: 62,
  r: 12,
  pad: 12,
  badge: 34,
  badgeR: 9,
  meterH: 3,
}
