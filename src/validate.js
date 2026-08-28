// Scene validation.
//
// The point of this file is not safety, it is generation. A scene is data, which
// means it can be written by a tool or a model rather than by hand — but only if
// a wrong scene fails loudly and specifically. "unknown node type 'postgres',
// known types are: client, dns, ..." is a fixable message. "undefined is not an
// object" is not.
//
// Errors block; warnings are things that will render but probably are not what
// the author meant.

import { NODE_TYPES } from './registry.js'
import { markTypes } from './annotate.js'

const TONES = ['good', 'bad', 'warn', 'accent', 'dim', 'plain']
const KINDS = ['graph', 'slots']
const ROLES = ['source', 'router', 'sink']
const STACKABLE = ['stat', 'bar', 'note']   // may omit `at` and be auto-stacked

export function validateScene(def) {
  const errors = []
  const warnings = []
  const err = (path, message) => errors.push({ path, message })
  const warn = (path, message) => warnings.push({ path, message })

  if (!def || typeof def !== 'object') {
    return { errors: [{ path: '', message: 'scene must be an object' }], warnings: [] }
  }
  if (!def.id) err('id', 'scene needs an id')
  if (!def.title) warn('title', 'scene has no title; the picker will show nothing useful')

  const kind = def.kind || 'graph'
  if (!KINDS.includes(kind)) {
    err('kind', `unknown kind "${kind}". known kinds: ${KINDS.join(', ')}`)
  }

  const nodes = def.nodes || []
  const ids = new Set()
  for (const [i, n] of nodes.entries()) {
    const at = `nodes[${i}]`
    if (!n.id) { err(at, 'node needs an id'); continue }
    if (ids.has(n.id)) err(at, `duplicate node id "${n.id}"`)
    ids.add(n.id)
    if (!NODE_TYPES[n.type]) {
      err(`${at}.type`, `unknown node type "${n.type}". known types: ${Object.keys(NODE_TYPES).join(', ')}`)
    }
    if (n.role && !ROLES.includes(n.role)) {
      err(`${at}.role`, `unknown role "${n.role}". known roles: ${ROLES.join(', ')}`)
    }
    for (const axis of ['x', 'y']) {
      if (typeof n[axis] !== 'number') err(`${at}.${axis}`, `${axis} must be a number`)
      else if (n[axis] < 0 || n[axis] > 1) {
        err(`${at}.${axis}`, `${axis} is ${n[axis]}; positions are fractions of the canvas, so 0..1`)
      }
    }
    if (n.portrait && (!Array.isArray(n.portrait) || n.portrait.length !== 2)) {
      err(`${at}.portrait`, 'portrait must be [x, y]')
    }
  }

  for (const [i, e] of (def.edges || []).entries()) {
    if (!ids.has(e.from)) err(`edges[${i}].from`, `edge from unknown node "${e.from}"`)
    if (!ids.has(e.to)) err(`edges[${i}].to`, `edge to unknown node "${e.to}"`)
    if (e.from === e.to) err(`edges[${i}]`, `edge points at itself ("${e.from}")`)
  }

  const secIds = new Set()
  for (const [i, x] of (def.sections || []).entries()) {
    const at = `sections[${i}]`
    if (!x.id) err(at, 'section needs an id')
    else if (secIds.has(x.id)) err(at, `duplicate section id "${x.id}"`)
    secIds.add(x.id)
    if (!x.label) warn(`${at}.label`, 'section has no label, so its title strip is blank')
    for (const f of ['x', 'y', 'w', 'h']) {
      if (typeof x[f] !== 'number') err(`${at}.${f}`, `${f} must be a number`)
      else if (x[f] < 0 || x[f] > 1) {
        err(`${at}.${f}`, `${f} is ${x[f]}; sections are fractions of the canvas, so 0..1`)
      }
    }
    if (x.w <= 0 || x.h <= 0) err(at, 'a section needs a positive width and height')
    if (x.tone && !TONES.includes(x.tone)) {
      err(`${at}.tone`, `unknown tone "${x.tone}". known tones: ${TONES.join(', ')}`)
    }
  }

  if (kind === 'graph' && nodes.length) {
    // An empty board is where every new canvas starts, so emptiness is not an
    // error. Having nodes but no source still is worth flagging.
    if (!nodes.some(n => (n.role || NODE_TYPES[n.type]?.role) === 'source')) {
      warn('nodes', 'no source node, so nothing will ever emit traffic')
    }
  }

  if (kind === 'slots') {
    const cfg = def.slots
    if (!cfg) err('slots', 'a slots scene needs a `slots` config')
    else {
      if (cfg.orientation && !['row', 'column'].includes(cfg.orientation)) {
        err('slots.orientation', `must be "row" or "column", got "${cfg.orientation}"`)
      }
      if (!cfg.count && !def.steps?.some(s => s.cells?.length)) {
        err('slots.count', 'set slots.count, or give at least one step some cells')
      }
    }
  }

  validateSteps(def, kind, ids, err, warn)
  return { errors, warnings, ok: errors.length === 0 }
}

function validateSteps(def, kind, ids, err, warn) {
  if (!def.steps) return
  if (!Array.isArray(def.steps) || !def.steps.length) {
    return err('steps', 'steps must be a non-empty array when present')
  }
  const knownMarks = markTypes()
  const edgeKeys = new Set((def.edges || []).map(e => `${e.from}>${e.to}`))

  for (const [i, s] of def.steps.entries()) {
    const at = `steps[${i}]`
    if (!(s.duration > 0)) err(`${at}.duration`, 'duration must be a positive number of ms')
    if (!s.label) warn(`${at}.label`, 'step has no label, so the chrome header will be blank')

    for (const field of ['show', 'dead', 'focus']) {
      for (const id of s[field] || []) {
        if (!ids.has(id)) err(`${at}.${field}`, `references unknown node "${id}"`)
      }
    }

    for (const id of Object.keys(s.traffic || {})) {
      if (!ids.has(id)) err(`${at}.traffic`, `references unknown node "${id}"`)
      else if (s.show && !s.show.includes(id) && s.traffic[id] > 0) {
        warn(`${at}.traffic`, `"${id}" sends ${s.traffic[id]} rps but is not in this step's show list`)
      }
    }

    for (const key of s.edges || []) {
      if (!edgeKeys.has(key)) {
        err(`${at}.edges`, `"${key}" is not an edge in this scene. declared edges: ${[...edgeKeys].join(', ') || 'none'}`)
      }
    }

    if (s.gutter != null && (s.gutter < 0 || s.gutter >= 0.9)) {
      err(`${at}.gutter`, `gutter is ${s.gutter}; it is a fraction of the width, so 0..0.9`)
    }

    if (kind === 'slots' && !s.cells) {
      warn(`${at}.cells`, 'slots step has no cells, so every slot renders empty')
    }
    for (const [j, p] of (s.pointers || []).entries()) {
      if (typeof p.at !== 'number') err(`${at}.pointers[${j}].at`, 'pointer needs a numeric slot index')
      if (!p.text) err(`${at}.pointers[${j}].text`, 'pointer needs text')
    }

    for (const [j, a] of (s.annotations || []).entries()) {
      const ap = `${at}.annotations[${j}]`
      if (!knownMarks.includes(a.type)) {
        err(`${ap}.type`, `unknown mark "${a.type}". known marks: ${knownMarks.join(', ')}`)
        continue
      }
      if (a.tone && !TONES.includes(a.tone)) {
        err(`${ap}.tone`, `unknown tone "${a.tone}". known tones: ${TONES.join(', ')}`)
      }
      if (a.type === 'bracket') {
        if (!a.nodes?.length) err(`${ap}.nodes`, 'bracket needs a nodes array')
        for (const id of a.nodes || []) {
          if (!ids.has(id)) err(`${ap}.nodes`, `references unknown node "${id}"`)
        }
      } else if (a.at == null) {
        // stat, bar and note may omit `at`: they are stacked down the gutter on
        // a shared rhythm instead of each picking its own y.
        if (!STACKABLE.includes(a.type)) {
          err(`${ap}.at`, `${a.type} needs \`at\`: a node id, or [x, y] as fractions`)
        } else if (!s.gutter) {
          warn(`${ap}.at`, `${a.type} will be stacked in the gutter, but this step sets no gutter`)
        }
      } else if (Array.isArray(a.at)) {
        if (a.at.length !== 2) err(`${ap}.at`, 'positional `at` must be [x, y]')
      } else if (!ids.has(a.at)) {
        err(`${ap}.at`, `anchored to unknown node "${a.at}"`)
      }
      if (a.type === 'stat' && typeof a.value !== 'number') {
        err(`${ap}.value`, 'stat needs a numeric value')
      }
      if (a.type === 'bar') {
        if (!a.parts?.length) err(`${ap}.parts`, 'bar needs a parts array')
        for (const [k, part] of (a.parts || []).entries()) {
          if (typeof part.value !== 'number') err(`${ap}.parts[${k}].value`, 'part needs a numeric value')
        }
      }
      if ((a.type === 'note' || a.type === 'callout') && !a.text) {
        err(`${ap}.text`, `${a.type} needs text`)
      }
    }
  }
}

// One-line-per-problem report, for a console or a panel.
export function formatReport(scene, result) {
  const lines = []
  for (const e of result.errors) lines.push(`  ERROR  ${scene.id}.${e.path}: ${e.message}`)
  for (const w of result.warnings) lines.push(`  warn   ${scene.id}.${w.path}: ${w.message}`)
  return lines.join('\n')
}

export function validateAll(scenes) {
  const report = []
  let errors = 0, warnings = 0
  for (const s of scenes) {
    const r = validateScene(s)
    errors += r.errors.length
    warnings += r.warnings.length
    if (r.errors.length || r.warnings.length) report.push(formatReport(s, r))
  }
  return { errors, warnings, text: report.join('\n') }
}
