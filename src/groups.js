// Groups — folding a set of objects into one card.
//
// The whole feature rests on one split: the SIMULATION runs on the real graph,
// and everything you SEE is drawn from a view graph derived from it. sim.js
// never learns the word "fold", so routing, queueing, capacity and percentiles
// cannot regress — a folded board is the same board with a different picture.
//
// Nesting lives in exactly one function, proxyOf: the card a thing is actually
// inside of is its OUTERMOST folded ancestor. Walking to the top and keeping
// the last folded one is what makes a folded Region win over a folded Service
// inside it, and it is why nesting costs one loop rather than a recursive case
// in every rule.

// Children are ids, and an id may name a node or another group, so the
// structure is a forest. Everything below assumes one parent and no cycles;
// addGroup and validate.js are what keep that true.
function index(state) {
  const groups = state.groups || []
  const byGroup = new Map(groups.map(g => [g.id, g]))
  const byNode = new Map((state.nodes || []).map(n => [n.id, n]))
  const parent = new Map()
  for (const g of groups) for (const c of g.children || []) parent.set(c, g)
  return { groups, byGroup, byNode, parent }
}

const upFolded = (idx, id) => {
  let out = null
  for (let g = idx.parent.get(id); g; g = idx.parent.get(g.id)) if (g.folded) out = g
  return out
}

// A group carries both layouts on one object, the way a node carries `portrait`
// alongside x/y. Keeping them on a single object rather than splitting runtime
// from spec is what stops the two drifting — the mistake sections make you
// watch for.
export const posOf = (g, portrait) =>
  portrait && g.portrait ? { x: g.portrait[0], y: g.portrait[1] } : { x: g.x, y: g.y }

export const groupsOf = state => state.groups || []
export const groupById = (state, id) => groupsOf(state).find(g => g.id === id) || null

export function parentOf(state, id) {
  return index(state).parent.get(id) || null
}

// The card this thing is actually inside of, or null if it is on the surface.
export function proxyOf(state, id) {
  return upFolded(index(state), id)
}

// Visible means "drawn at the top level": nothing folded above it.
export const isVisible = (state, id) => proxyOf(state, id) == null

// Children resolved to what they actually are, in declaration order. Unknown
// ids are skipped rather than thrown on — a group that outlived one of its
// members should still draw.
export function childItemsOf(state, group, idx = index(state)) {
  const out = []
  for (const id of group.children || []) {
    const g = idx.byGroup.get(id)
    if (g) { out.push({ kind: 'group', id, group: g }); continue }
    const n = idx.byNode.get(id)
    if (n) out.push({ kind: 'node', id, node: n })
  }
  return out
}

// Every node underneath, however deep. This is what the badge counts and what
// the meter measures, because "how many objects are hidden in here" does not
// care about the shape of the tree.
export function leavesOf(state, group, idx = index(state), seen = new Set()) {
  if (seen.has(group.id)) return []          // a cycle would otherwise not return
  seen.add(group.id)
  const out = []
  for (const it of childItemsOf(state, group, idx)) {
    if (it.kind === 'node') out.push(it.node)
    else out.push(...leavesOf(state, it.group, idx, seen))
  }
  return out
}

export function subgroupsOf(state, group, idx = index(state), seen = new Set()) {
  if (seen.has(group.id)) return []
  seen.add(group.id)
  const out = []
  for (const it of childItemsOf(state, group, idx)) {
    if (it.kind !== 'group') continue
    out.push(it.group, ...subgroupsOf(state, it.group, idx, seen))
  }
  return out
}

// Every group currently drawing an outline: open, and not buried inside a
// folded one. This is the set to hit-test against.
export function openGroups(state) {
  const idx = index(state)
  return idx.groups.filter(g => !g.folded && !upFolded(idx, g.id))
}

// Only the outermost of those. Geometry starts here and recurses inward,
// because a parent's rectangle is the union of its children's — computing it in
// that order is what makes nested boxes nest with no depth rule, and what stops
// an inner group being drawn twice.
export function openRoots(state) {
  const idx = index(state)
  return idx.groups.filter(g => !g.folded && !idx.parent.get(g.id))
}

// Would adding `childId` to `parentId` close a loop? True if they are the same
// thing, or if the parent is already somewhere underneath the child.
export function wouldCycle(state, parentId, childId) {
  if (parentId === childId) return true
  const idx = index(state)
  const child = idx.byGroup.get(childId)
  if (!child) return false
  return subgroupsOf(state, child, idx).some(g => g.id === parentId)
}

// --- the view graph ---------------------------------------------------------
// One pass, everything the renderer needs. `appearOf` comes from the sim
// because entrance timing is presentation state that lives there.

export function viewGraph(state, appearOf = () => 1) {
  const idx = index(state)
  const items = []
  const byId = new Map()

  const push = it => { items.push(it); byId.set(it.id, it) }

  for (const n of state.nodes || []) {
    if (upFolded(idx, n.id)) continue
    push({
      id: n.id, kind: 'node', node: n, x: n.x, y: n.y,
      appear: appearOf(n), dim: n.dim, dead: n.dead, pulse: n.pulse,
    })
  }

  for (const g of idx.groups) {
    if (!g.folded || upFolded(idx, g.id)) continue
    push(foldedItem(state, g, idx, appearOf, state.portrait))
  }

  // Edges are rewritten through the substitution, then deduped. A gateway wired
  // to three nodes inside one service is one wire to the folded card, not three
  // stacked on top of each other.
  const map = id => upFolded(idx, id)?.id ?? id
  const seen = new Map()
  for (const e of state.edges || []) {
    const from = map(e.from), to = map(e.to)
    if (from === to) continue                     // internal to a folded group
    const key = `${from}>${to}`
    const found = seen.get(key)
    if (found) { found.real.push(e); continue }
    seen.set(key, { from, to, real: [e] })
  }

  const edges = []
  for (const v of seen.values()) {
    const a = byId.get(v.from), b = byId.get(v.to)
    if (!a || !b) continue
    edges.push({
      ...v, a, b,
      off: v.real.every(r => r.off),
      // A drawn wire is only a hand-off if every real call behind it is one;
      // one synchronous call among them means somebody is still waiting.
      async: v.real.every(r => r.async),
      protocol: v.real.length === 1 ? v.real[0].protocol : null,
      label: v.real.length === 1 ? v.real[0].label : null,
    })
  }

  // Where a real id lands in the view. Packets are addressed in real ids, so
  // the renderer needs this to know that both ends of a hop are now the same
  // card and the dot has nowhere to travel.
  const mapId = id => upFolded(idx, id)?.id ?? id

  return { items, byId, edges, open: openRoots(state), idx, map: mapId }
}

// What a folded card knows about itself. Every number here is MEASURED from the
// members that just ran — there is no aggregate latency and no invented group
// capacity, because neither survives a fan-out or a cache hit rate.
function foldedItem(state, g, idx, appearOf, portrait) {
  const leaves = leavesOf(state, g, idx)
  const inside = new Set(leaves.map(n => n.id))

  // Rate INTO the group: what arrives at the members that outsiders talk to.
  const entry = leaves.filter(n =>
    (state.edges || []).some(e => e.to === n.id && !e.off && !inside.has(e.from)))
  const rate = (entry.length ? entry : []).reduce((s, n) => s + n.showRate, 0)

  let worst = 0, hot = 0, pulse = 0, dim = 1, appear = 0
  for (const n of leaves) {
    if (Number.isFinite(n.capacity) && n.capacity > 0) {
      worst = Math.max(worst, n.showRate / n.capacity)
    }
    hot = Math.max(hot, n.hot)
    pulse = Math.max(pulse, n.pulse)
    dim = Math.min(dim, n.dim)          // one focused member undims the card
    appear = Math.max(appear, appearOf(n))
  }

  return {
    id: g.id, kind: 'group', group: g, ...posOf(g, portrait),
    label: g.label, count: leaves.length,
    appear: leaves.length ? appear : 1,
    dim: leaves.length ? dim : 0,
    dead: leaves.length > 0 && leaves.every(n => n.dead),
    pulse, hot, worst, showRate: rate,
    overloaded: leaves.some(n => n.overloaded),
  }
}
