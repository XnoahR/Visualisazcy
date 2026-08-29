// Saving boards.
//
// Everything a board is already lives in the scene definition, so this is
// serialisation and an index — not a format. That was the whole argument for
// keeping scenes as data.
//
// localStorage can be unavailable (private windows, blocked site data) and can
// throw on write when the quota is gone. Every call here is guarded and returns
// a result rather than throwing, because losing a board is bad but taking the
// app down with it is worse.

const KEY = 'visualizcy:boards'
const ITEM = id => `visualizcy:board:${id}`

function safe(fn, fallback) {
  try { return fn() } catch { return fallback }
}

export function available() {
  return safe(() => {
    const k = '__vz_probe'
    localStorage.setItem(k, '1')
    localStorage.removeItem(k)
    return true
  }, false)
}

// The index is titles and timestamps only, so the start screen never has to
// parse every board just to list them.
export function list() {
  return safe(() => JSON.parse(localStorage.getItem(KEY) || '[]'), [])
}

function writeIndex(rows) {
  return safe(() => { localStorage.setItem(KEY, JSON.stringify(rows)); return true }, false)
}

export function save(def) {
  const id = def.id
  const body = safe(() => JSON.stringify(strip(def)), null)
  if (!body) return { ok: false, reason: 'could not serialise this board' }

  const wrote = safe(() => { localStorage.setItem(ITEM(id), body); return true }, false)
  if (!wrote) return { ok: false, reason: 'browser storage is full or unavailable' }

  const rows = list().filter(r => r.id !== id)
  rows.unshift({ id, title: def.title || 'Untitled board', at: Date.now(),
                 nodes: (def.nodes || []).length })
  writeIndex(rows.slice(0, 60))
  return { ok: true }
}

export function load(id) {
  return safe(() => JSON.parse(localStorage.getItem(ITEM(id)) || 'null'), null)
}

export function remove(id) {
  safe(() => localStorage.removeItem(ITEM(id)))
  writeIndex(list().filter(r => r.id !== id))
}

// What actually belongs to a board. Runtime state is rebuilt on load, so
// storing it would only give it a chance to go stale.
function strip(def) {
  const out = {
    id: def.id, kind: def.kind, title: def.title, caption: def.caption,
    watermark: def.watermark, autoLayout: def.autoLayout,
  }
  if (def.nodes?.length) out.nodes = def.nodes
  if (def.edges?.length) out.edges = def.edges.map(e => ({ from: e.from, to: e.to }))
  if (def.sections?.length) out.sections = def.sections
  if (def.groups?.length) out.groups = def.groups
  if (def.steps?.length) out.steps = def.steps
  if (def.lanes?.length) out.lanes = def.lanes
  if (def.slots) out.slots = def.slots
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out
}

export function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
