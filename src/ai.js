// Describe a system in a sentence; get a board.
//
// The scene format was designed for this. validate.js says it outright: "the
// point of this file is not safety, it is generation" — a scene is data, so a
// model can write one, as long as a wrong one fails loudly and specifically.
// That is the whole loop here: ask for a scene, validate it, and if it is
// wrong, hand the exact errors back and ask once more.
//
// Which model, and where, is the active provider's business (providers.js).
// This file only knows what to ask for and how to tell whether the answer is
// any good. Raw fetch rather than an SDK, deliberately: this app is
// zero-dependency with no build step, and any SDK would be its first.

import { NODE_TYPES, EDGE_PROTOCOLS } from './registry.js'
import { validateScene } from './validate.js'
import { scene as makeScene } from './scene.js'
import * as providers from './providers.js'

export const isReady = () => providers.ready(providers.active())
export const activeProvider = () => providers.active()

// --- what the model is told ---------------------------------------------------
// Built from the registry every time, so the prompt can never describe a type
// that does not exist or miss one that does.

const TONES = ['good', 'bad', 'warn', 'accent', 'dim', 'plain']

function typeCatalogue() {
  return Object.entries(NODE_TYPES).map(([k, d]) => {
    const bits = [`role=${d.role}`]
    if (d.latency) bits.push(`${d.latency}ms × ${Number.isFinite(d.concurrency) ? d.concurrency : '∞'} → ${cap(d)} rps`)
    if (d.hitRate != null) bits.push(`hitRate ${d.hitRate}`)
    if (d.accepts) bits.push(`accepts ${d.accepts} only`)
    if (d.asyncIn) bits.push('edges INTO it are async')
    if (d.rateLimit) bits.push(`policy cap ${d.rateLimit} rps`)
    return `- ${k}: ${d.name}. ${d.hint}. (${bits.join(', ')})`
  }).join('\n')
}

const cap = d => !d.latency ? '∞' : Math.round(d.concurrency / (d.latency / 1000))

export function systemPrompt() {
  return `You design system architecture diagrams that RUN. You output a scene: objects with capacities, wires between them, and traffic that flows and breaks realistically. The user will describe a system in plain language; you return the scene as JSON matching the schema exactly.

## Object types (use the key as \`type\`)
${typeCatalogue()}

Capacity is DERIVED — throughput = concurrency ÷ latency (Little's Law). Never invent a capacity number; set latency and concurrency and the throughput follows. Override a type's defaults only when the story needs it (e.g. a payment provider at 300ms; a beefy server at concurrency 8).

## Roles and wiring
- source gives only, sink takes only, router does both. A server is a sink by default; give it role "router" when it must call something behind it (a cache, a database).
- Every edge from→to must be legal: from must not be a sink, to must not be a source.
- Reads and writes: a source may set writeRatio (0..1). A "primary" accepts only writes, a "replica" only reads; routing honours this. Use them together to show the read/write split.

## Edge properties (all optional)
- async: true — a hand-off, not a call. The caller is answered immediately and the work continues behind it. Wires into a queue, broker or topic should be async. Draws dashed.
- protocol: one of ${EDGE_PROTOCOLS.join(', ')}.
- latency: network hop in ms, counts in p50 both ways. Use it for cross-region or third-party calls (payment provider, SMS gateway), otherwise omit.

## Failure and resilience (optional, on objects)
- failureRate 0..1 — a share of calls that fail. Use sparingly and only where the story is about failure.
- retry: { max, backoff } — the CALLER retries; backoff in ms, exponential with jitter.
- breaker: { threshold, window, resetAfter, min } — the CALLER stops calling a downstream that keeps failing. Put retry and breaker on the object that makes the call (a gateway, an API), never on the thing being called.
- Retry without a breaker makes an outage worse. If you add retry, add a breaker.

## Groups
A group is a named set of object ids that folds into one card ("Ticketing Service"). Use groups to fold a service's internals (its api, cache, queue, workers, db) so the board reads at the service level. Groups may nest (a region holding services). Set folded: true for services so the board is legible; the user can open them. Every id in children must exist; each id belongs to at most one group. Every group needs x and y for its folded card — put it at the centre of its members.

## Layout — this matters
Coordinates are fractions of the frame, 0..1. A card is about 0.19 of the frame wide and 0.13 tall. Two objects in the same row closer than 0.20 apart in x OVERLAP. Rules:
- Arrange in COLUMNS by flow. Prefer FOUR columns at x = 0.12, 0.38, 0.62, 0.88 — that leaves room between cards. Five (0.10, 0.30, 0.50, 0.70, 0.90) only when unavoidable, and never more: fold a service's internals into a group to stay within that.
- Objects in the same column go in rows: y values at least 0.16 apart, centred around 0.5 (e.g. two rows at 0.35/0.65, three at 0.22/0.50/0.78, four at 0.16/0.38/0.60/0.82).
- Members of a folded group: lay them out in a compact 2-wide grid (x at c−0.10 and c+0.10, rows 0.14 apart) around the group's x,y so the group's card lands on their centroid.
- Keep every object inside 0.08..0.92 on both axes.

## Traffic
The first source should carry the load the story is about. A "ticket war" or "flash sale" is 300–1000 rps against a stack that sustains far less — that is the point. A normal web app is 20–80 rps. Set rps on sources only.

## Design vocabulary — use it
- High-traffic spike: put a rate limiter and/or a queue ("virtual waiting room") in front of the fragile part. The queue absorbs; the workers drain; the limiter refuses politely.
- Read-heavy: cache in front of the database; replica for reads, primary for writes.
- Anything that calls a third party (payment, SMS, email): async through a queue/broker, or a breaker on the caller, and an edge latency.
- Session state on the request path: a session store, small and fast.
- Static assets: edge/CDN first.

## Stories (optional)
If the user asks for a story, demo, video, or "show what happens when…", add steps: 3–6 of them, 2500–4500ms each, each with a short label and one callout. Steps are FULL state: traffic lists every source's rps for that step; degraded/dead list object ids; expand lists the group ids that are OPEN in that step (others fold). Use degraded to make something go bad, then show the resilience responding. Otherwise omit steps entirely.

## Output
- ids: short lowercase snake_case, unique across objects AND groups.
- title: 3–6 words. caption: one sentence saying what the board shows.
- Set a label on objects when the default name is wrong for the story ("Seat Map Cache", "Payment Provider").
- Return the complete scene. Do not explain.`
}

// --- the schema ------------------------------------------------------------
// Structured output: additionalProperties:false and required on every object,
// no numeric bounds (validate.js checks those), no dynamic-key maps — so a
// step's traffic is a list of {id, rps} and gets folded into a map afterwards.

const str = { type: 'string' }
const num = { type: 'number' }
const bool = { type: 'boolean' }
const ids = { type: 'array', items: str }
const obj = (props, required) => ({ type: 'object', properties: props, required, additionalProperties: false })

export function sceneSchema() {
  const node = obj({
    id: str, type: { type: 'string', enum: Object.keys(NODE_TYPES) }, x: num, y: num,
    label: str, subtitle: str, role: { type: 'string', enum: ['source', 'router', 'sink'] },
    rps: num, writeRatio: num, latency: num, concurrency: num, maxQueue: num,
    hitRate: num, failureRate: num, accepts: { type: 'string', enum: ['read', 'write'] },
    retry: obj({ max: num, backoff: num }, ['max', 'backoff']),
    breaker: obj({ threshold: num, window: num, resetAfter: num, min: num },
                 ['threshold', 'window', 'resetAfter', 'min']),
    tech: str, region: str,
  }, ['id', 'type', 'x', 'y'])

  const edge = obj({
    from: str, to: str, async: bool,
    protocol: { type: 'string', enum: EDGE_PROTOCOLS }, latency: num,
  }, ['from', 'to'])

  const group = obj({
    id: str, label: str, children: ids, folded: bool, x: num, y: num,
    tone: { type: 'string', enum: TONES },
  }, ['id', 'label', 'children', 'folded', 'x', 'y'])

  const annotation = obj({
    type: { type: 'string', enum: ['callout'] }, at: str, text: str,
    tone: { type: 'string', enum: TONES },
  }, ['type', 'at', 'text'])

  const step = obj({
    duration: num, label: str,
    traffic: { type: 'array', items: obj({ id: str, rps: num }, ['id', 'rps']) },
    dead: ids, degraded: ids, focus: ids, expand: ids,
    annotations: { type: 'array', items: annotation },
  }, ['duration', 'label', 'traffic'])

  return obj({
    title: str, caption: str,
    nodes: { type: 'array', items: node },
    edges: { type: 'array', items: edge },
    groups: { type: 'array', items: group },
    steps: { type: 'array', items: step },
  }, ['title', 'caption', 'nodes', 'edges', 'groups'])
}

// --- from model output to a scene the app accepts ---------------------------

function toScene(raw) {
  const def = {
    id: 'ai-' + Date.now().toString(36),
    title: raw.title, caption: raw.caption,
    nodes: (raw.nodes || []).map(clean),
    edges: (raw.edges || []).map(clean),
    groups: (raw.groups || []).map(clean),
    generated: true,
  }
  if (raw.steps?.length) {
    def.steps = raw.steps.map(s => {
      const out = clean(s)
      out.traffic = Object.fromEntries((s.traffic || []).map(t => [t.id, t.rps]))
      return out
    })
  }
  return def
}

// Structured output fills every optional key it decides to use; blanks and
// zeros where the type default was meant are noise the validator would flag.
function clean(o) {
  const out = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === '' || v == null) continue
    if (Array.isArray(v) && !v.length && k !== 'children') continue
    out[k] = v
  }
  return out
}

// Two objects closer than a card in both axes overlap. If the model got the
// layout wrong the board is relaid deterministically rather than shipped ugly.
const CARD_W = 0.19, CARD_H = 0.13
function overlaps(def) {
  const visible = def.nodes.filter(n => !inFoldedGroup(def, n.id))
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j]
      if (Math.abs(a.x - b.x) < CARD_W && Math.abs(a.y - b.y) < CARD_H) return `${a.id}/${b.id}`
    }
  }
  return null
}

function inFoldedGroup(def, id) {
  return (def.groups || []).some(g => g.folded && g.children.includes(id))
}

// Columns by flow depth, rows spread within a column. The same idea as
// sim.autoLayout, on the spec rather than the runtime, and spaced by the card.
export function relayout(def) {
  const ids = new Set(def.nodes.map(n => n.id))
  const edges = def.edges.filter(e => ids.has(e.from) && ids.has(e.to))
  const depth = new Map()
  const queue = []
  for (const n of def.nodes) {
    if (!edges.some(e => e.to === n.id)) { depth.set(n.id, 0); queue.push(n.id) }
  }
  if (!queue.length && def.nodes.length) { depth.set(def.nodes[0].id, 0); queue.push(def.nodes[0].id) }
  while (queue.length) {
    const id = queue.shift()
    for (const e of edges) {
      if (e.from !== id) continue
      const d = depth.get(id) + 1
      if (depth.has(e.to) && depth.get(e.to) >= d) continue
      if (d > 12) continue
      depth.set(e.to, d); queue.push(e.to)
    }
  }
  const cols = new Map()
  for (const n of def.nodes) {
    const d = depth.get(n.id) ?? 0
    if (!cols.has(d)) cols.set(d, [])
    cols.get(d).push(n)
  }
  const maxD = Math.max(...cols.keys())
  // Four columns or fewer get the roomy grid the prompt recommends; five is the
  // most that fits at all, so anything deeper gets squeezed to 0.10..0.90.
  const along = d => maxD === 0 ? 0.5
    : maxD <= 3 ? 0.12 + (d / maxD) * 0.76
    : 0.10 + (d / maxD) * 0.80
  for (const [d, group] of cols) {
    group.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || a.id.localeCompare(b.id))
    const n = group.length
    group.forEach((node, i) => {
      node.x = +along(d).toFixed(3)
      node.y = +(n === 1 ? 0.5 : 0.16 + (i / (n - 1)) * 0.68).toFixed(3)
    })
  }
  for (const g of def.groups || []) {
    const pts = g.children.map(c => def.nodes.find(n => n.id === c)).filter(Boolean)
    if (pts.length) {
      g.x = +(pts.reduce((s, p) => s + p.x, 0) / pts.length).toFixed(3)
      g.y = +(pts.reduce((s, p) => s + p.y, 0) / pts.length).toFixed(3)
    }
  }
  return def
}

// --- the loop -----------------------------------------------------------------
// Ask, validate, and if it is wrong, ask once more with the exact errors. The
// second attempt sees its own first answer, so it corrects rather than restarts.
export async function generateScene({ prompt, current = null, onStatus = () => {}, signal } = {}) {
  const cfg = providers.load()
  const p = providers.active(cfg)
  if (!providers.ready(p)) throw new Error('set up a provider first (⚙ settings)')
  const system = systemPrompt()
  const schema = sceneSchema()

  // What a server accepted is worth remembering, so the next call skips the
  // dialects it already refused.
  const learn = mode => { p.jsonMode = mode; providers.save(cfg) }

  const ask = current
    ? `Here is the current board as JSON:\n\n${JSON.stringify(stripForPrompt(current), null, 1)}\n\nRevise it as follows, keeping everything that still applies and returning the COMPLETE scene:\n\n${prompt}`
    : prompt

  const messages = [{ role: 'user', content: ask }]
  let attempt = 0, lastErrors = null, raw = null

  while (attempt < 2) {
    attempt++
    onStatus(attempt === 1 ? `designing with ${p.model}…` : 'asking again, more firmly…')
    let text, usage
    try {
      ({ text, usage } = await providers.call(p, { system, messages, schema, maxTokens: 16000, signal }, learn))
    } catch (err) {
      // A model that narrated instead of answering, or ran out of room, gets
      // one more go with the instruction it evidently needed. Anything else
      // (auth, network, refusal) is not going to improve by asking twice.
      if (attempt === 1 && (err.kind === 'reasoning' || err.kind === 'cut')) {
        lastErrors = [err.message]
        messages.push({ role: 'user', content:
          err.kind === 'cut'
            ? 'Your previous reply was cut off before the JSON was complete. Make the design smaller — fewer objects, no steps — and reply with ONLY the JSON object.'
            : 'Your previous reply was reasoning, not an answer. Do not think out loud. Reply with ONLY the JSON object, starting with { and ending with }.' })
        continue
      }
      throw err
    }
    raw = JSON.parse(text)   // providers.call only returns text that parses

    const def = toScene(raw)
    const report = validateScene(def)
    const clash = report.ok ? overlaps(def) : null
    if (report.ok) {
      if (clash) { onStatus(`objects ${clash} overlapped; laying it out again`); relayout(def) }
      return { scene: makeScene(def), usage, attempts: attempt, relaid: !!clash, provider: p.name, model: p.model }
    }

    lastErrors = report.errors.map(e => `${e.path}: ${e.message}`)
    messages.push({ role: 'assistant', content: text })
    messages.push({ role: 'user', content:
      `That scene failed validation. Fix every problem below and return the complete corrected scene:\n- ${lastErrors.join('\n- ')}` })
  }
  throw new Error(`the model could not produce a valid scene:\n${(lastErrors || []).slice(0, 6).join('\n')}`)
}

// What the model needs to revise a board — not runtime state, not positions
// to three decimals, not the generated flag.
function stripForPrompt(def) {
  const out = { title: def.title, caption: def.caption }
  out.nodes = (def.nodes || []).map(n => { const c = { ...n }; delete c.portrait; return c })
  out.edges = def.edges || []
  if (def.groups?.length) out.groups = def.groups
  if (def.steps?.length) out.steps = def.steps
  return out
}
