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

// Everything in `opts` is carried through. This used to allow-list five fields
// and silently drop the rest, so a scene asking for `latency`, `concurrency`,
// `retry` or `breaker` got the type default instead and never said so —
// thirteen such options across the built-in scenes were being thrown away.
//
// Common ones, all optional: rps and writeRatio on a source; label, role,
// latency, concurrency, maxQueue, hitRate, failureRate, retry, breaker,
// accepts; icon/color/subtitle for appearance; portrait: [x, y] for when the
// canvas is taller than it is wide. validate.js is what checks them.
export function node(id, type, x, y, opts = {}) {
  return { id, type, x, y, ...opts }
}

// An edge carries how the call is made, not just who calls whom:
//   edge('api', 'bus', { async: true, protocol: 'AMQP', latency: 8 })
export function edge(from, to, opts = {}) {
  return { from, to, ...opts }
}

// A section is a labelled rectangle behind the nodes — grouping, nothing more.
// Membership is geometric: whatever sits inside the rectangle belongs to it.
// That is how a canvas tool behaves, and it means there is no membership list
// to drift out of sync with where things actually are.
export function section(id, label, x, y, w, h, opts = {}) {
  return { id, label, x, y, w, h, tone: opts.tone ?? null }
}

// A group is an explicit set of members that folds into one card. Unlike a
// section its membership is a list rather than a rectangle, because a service
// is a named set and not a location — and unlike a section it may hold other
// groups, so a Region can contain Services.
export function group(id, label, children, opts = {}) {
  return {
    id, label, children,
    folded: opts.folded ?? false,
    x: opts.x ?? 0.5, y: opts.y ?? 0.5,
    portrait: opts.portrait ?? null,   // [x, y] when the canvas is taller than wide
    tone: opts.tone ?? null,
  }
}

// nodes/edges are optional: a slots scene has neither, and the simulation
// simply has nothing to run.
export function scene(def) {
  const nodes = def.nodes || []
  const edges = def.edges || []
  const sections = def.sections || []
  const groups = def.groups || []
  const ids = new Set(nodes.map(n => n.id))
  for (const e of edges) {
    if (!ids.has(e.from)) throw new Error(`${def.id}: edge from unknown node "${e.from}"`)
    if (!ids.has(e.to))   throw new Error(`${def.id}: edge to unknown node "${e.to}"`)
  }
  return { ...def, nodes, edges, sections, groups }
}

// Resolve a node's fractional position for the current canvas shape.
export function placement(n, portraitMode) {
  if (portraitMode && n.portrait) return { x: n.portrait[0], y: n.portrait[1] }
  return { x: n.x, y: n.y }
}
