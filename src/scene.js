// A scene is plain data. Positions are fractions of the canvas (0..1), never
// pixels, so the same scene lays out at 16:9, 9:16 or 1:1 with no rework.
//
//   node('client', 'client', 0.18, 0.5, { rps: 6, portrait: [0.5, 0.14] })
//   edge('client', 'lb')

// The frame (0..1) is the EXPORT bounds, not the world. Objects may be parked
// outside it — they stay on the board and simply do not appear in the render,
// which is what an off-canvas area is for. Bounded so a stray drag cannot fling
// something a thousand screens away.
export const WORLD_MIN = -1.5
export const WORLD_MAX = 2.5
export const inFrame = (n) => n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1

export function node(id, type, x, y, opts = {}) {
  return {
    id, type, x, y,
    rps: opts.rps ?? null,           // sources only; defaults applied by the sim
    capacity: opts.capacity ?? null, // overrides the registry default
    label: opts.label ?? null,       // overrides the registry name
    role: opts.role ?? null,         // overrides the registry role
    portrait: opts.portrait ?? null, // [x, y] used when the canvas is taller than wide
  }
}

export function edge(from, to) {
  return { from, to }
}

// A section is a labelled rectangle behind the nodes — grouping, nothing more.
// Membership is geometric: whatever sits inside the rectangle belongs to it.
// That is how a canvas tool behaves, and it means there is no membership list
// to drift out of sync with where things actually are.
export function section(id, label, x, y, w, h, opts = {}) {
  return { id, label, x, y, w, h, tone: opts.tone ?? null }
}

// nodes/edges are optional: a slots scene has neither, and the simulation
// simply has nothing to run.
export function scene(def) {
  const nodes = def.nodes || []
  const edges = def.edges || []
  const sections = def.sections || []
  const ids = new Set(nodes.map(n => n.id))
  for (const e of edges) {
    if (!ids.has(e.from)) throw new Error(`${def.id}: edge from unknown node "${e.from}"`)
    if (!ids.has(e.to))   throw new Error(`${def.id}: edge to unknown node "${e.to}"`)
  }
  return { ...def, nodes, edges, sections }
}

// Resolve a node's fractional position for the current canvas shape.
export function placement(n, portraitMode) {
  if (portraitMode && n.portrait) return { x: n.portrait[0], y: n.portrait[1] }
  return { x: n.x, y: n.y }
}
