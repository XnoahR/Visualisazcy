// Providers: where a request goes and what it is called there.
//
// The same idea opencode uses — named providers, each with a protocol, a base
// URL, a key and a model, and exactly one of them active. Two protocols cover
// everything that matters: Anthropic's Messages API, and the OpenAI-style
// chat/completions shape that OpenAI, OpenRouter, Groq, Gemini, Ollama, LM
// Studio and most self-hosted servers all speak.
//
// Keys live in this browser's localStorage and go to the base URL of their own
// provider and nowhere else. They are never logged, never put into a scene,
// and never saved with a board.

const KEY = 'visualisazcy:ai'
const LEGACY_KEY = 'visualisazcy:ai-key'
const LEGACY_MODEL = 'visualisazcy:ai-model'

const safe = (fn, fb) => { try { return fn() } catch { return fb } }
const uid = () => 'p_' + Math.random().toString(36).slice(2, 8)

// Presets fill in the parts that are the same for everyone. Model lists are
// suggestions, not truth — "Fetch models" asks the provider itself. Only the
// Anthropic ids are stated with confidence.
export const PRESETS = [
  // From ~/.config/opencode/opencode.json — the gateway this app's owner uses.
  // Model ids are the gateway's own, spaces included; the key is not here and
  // never will be. First in the list because it is the one that gets picked.
  { preset: 'aizcy', name: 'AiZcy', protocol: 'openai',
    baseUrl: 'https://a.izcy.tech/v1',
    models: ['DeepSeek V4 Flash', 'DeepSeek V4 Pro', 'GLM-4.7', 'GLM-5 Series', 'GLM-5.2', 'Claude'],
    model: 'DeepSeek V4 Flash',
    hint: 'Your gateway, as configured in opencode. Paste the same key.' },
  { preset: 'anthropic', name: 'Anthropic', protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'], model: 'claude-opus-5',
    keyUrl: 'https://platform.claude.com/settings/keys' },
  { preset: 'openai', name: 'OpenAI', protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1', models: [], model: '',
    keyUrl: 'https://platform.openai.com/api-keys' },
  { preset: 'openrouter', name: 'OpenRouter', protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1', models: [], model: '',
    keyUrl: 'https://openrouter.ai/keys',
    hint: 'One key, every model. Model ids look like anthropic/claude-sonnet-4.5.' },
  { preset: 'groq', name: 'Groq', protocol: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1', models: [], model: '',
    keyUrl: 'https://console.groq.com/keys' },
  { preset: 'gemini', name: 'Google Gemini', protocol: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: [], model: '',
    keyUrl: 'https://aistudio.google.com/apikey',
    hint: 'Through Google’s OpenAI-compatible endpoint.' },
  { preset: 'ollama', name: 'Ollama (local)', protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1', models: [], model: '', noKey: true,
    hint: 'Start it with OLLAMA_ORIGINS=* so a browser page may call it.' },
  { preset: 'lmstudio', name: 'LM Studio (local)', protocol: 'openai',
    baseUrl: 'http://localhost:1234/v1', models: [], model: '', noKey: true,
    hint: 'Turn on CORS in the local server settings.' },
  { preset: 'custom', name: 'Custom (OpenAI-compatible)', protocol: 'openai',
    baseUrl: '', models: [], model: '',
    hint: 'Any server that speaks POST {baseUrl}/chat/completions.' },
]

export const presetOf = p => PRESETS.find(x => x.preset === p.preset) || PRESETS.at(-1)

// --- config ---------------------------------------------------------------

function empty() { return { version: 1, active: null, providers: [] } }

export function load() {
  const cfg = safe(() => JSON.parse(localStorage.getItem(KEY) || 'null'), null)
  if (cfg && cfg.version === 1) return cfg
  return migrate()
}

// The first version kept one Anthropic key and one model under their own
// names. Fold them into a provider so nobody has to type the key twice.
function migrate() {
  const cfg = empty()
  const key = safe(() => localStorage.getItem(LEGACY_KEY), null)
  if (key) {
    const model = safe(() => localStorage.getItem(LEGACY_MODEL), null) || 'claude-opus-5'
    const p = fromPreset('anthropic', { apiKey: key, model })
    cfg.providers.push(p)
    cfg.active = p.id
    safe(() => { localStorage.removeItem(LEGACY_KEY); localStorage.removeItem(LEGACY_MODEL) })
  } else {
    // Nothing configured at all: seed the owner's gateway, key blank, so the
    // first visit to settings is one paste rather than a form.
    const p = fromPreset('aizcy')
    cfg.providers.push(p)
    cfg.active = p.id
  }
  save(cfg)
  return cfg
}

export function save(cfg) {
  return safe(() => { localStorage.setItem(KEY, JSON.stringify(cfg)); return true }, false)
}

export function fromPreset(preset, over = {}) {
  const base = PRESETS.find(x => x.preset === preset) || PRESETS.at(-1)
  return {
    id: uid(), preset: base.preset, name: base.name, protocol: base.protocol,
    baseUrl: base.baseUrl, apiKey: '', model: base.model || '', models: [...base.models],
    jsonMode: null,      // learned on first successful call: 'schema' | 'object' | 'text'
    lastTest: null,
    ...over,
  }
}

export function active(cfg = load()) {
  return cfg.providers.find(p => p.id === cfg.active) || null
}

// A provider is usable when it has somewhere to send to, something to ask for,
// and — unless it is a local server — a key to send with.
export function ready(p) {
  if (!p) return false
  if (!p.baseUrl || !p.model) return false
  if (presetOf(p).noKey) return true
  return !!p.apiKey
}

export const masked = k => !k ? '' : k.length <= 8 ? '••••' : k.slice(0, 7) + '…' + k.slice(-4)

// --- the two protocols ------------------------------------------------------

const trimSlash = u => u.replace(/\/+$/, '')

function anthropicHeaders(p) {
  return {
    'content-type': 'application/json',
    'x-api-key': p.apiKey,
    'anthropic-version': '2023-06-01',
    // Browser calls are refused without this. The name is the warning: the
    // key is in the page, so it is only ever this person's own key on their
    // own machine, and it goes nowhere but their own provider.
    'anthropic-dangerous-direct-browser-access': 'true',
  }
}

function openaiHeaders(p) {
  const h = { 'content-type': 'application/json' }
  if (p.apiKey) h.authorization = `Bearer ${p.apiKey}`
  return h
}

async function readJson(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || body?.error || `${res.status} ${res.statusText}`
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

// Structured output, Anthropic style: the schema goes in output_config and the
// answer is a text block that parses.
async function callAnthropic(p, { system, messages, schema, maxTokens, signal }) {
  const res = await fetch(`${trimSlash(p.baseUrl)}/v1/messages`, {
    method: 'POST', signal, headers: anthropicHeaders(p),
    body: JSON.stringify({
      model: p.model, max_tokens: maxTokens, system, messages,
      output_config: { format: { type: 'json_schema', schema } },
    }),
  })
  const body = await readJson(res)
  if (body.stop_reason === 'refusal') throw new Error('the model declined this request')
  if (body.stop_reason === 'max_tokens') throw new Error('the answer was too long to finish; ask for something smaller')
  const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  const parsed = parseJson(text)
  if (!parsed.ok) throw new Error(`${parsed.why} (via ${p.model}): ${preview(text)}`)
  return { text: parsed.text, usage: { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 }, model: body.model }
}

// OpenAI's strict mode wants EVERY property listed in `required`, with
// optional ones expressed as nullable. Same schema, different dialect.
export function strictify(schema) {
  if (!schema || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(strictify)
  const out = { ...schema }
  if (out.type === 'object' && out.properties) {
    const req = new Set(out.required || [])
    const props = {}
    for (const [k, v] of Object.entries(out.properties)) {
      const inner = strictify(v)
      props[k] = req.has(k) ? inner : { anyOf: [inner, { type: 'null' }] }
    }
    out.properties = props
    out.required = Object.keys(props)
    out.additionalProperties = false
  }
  if (out.items) out.items = strictify(out.items)
  return out
}

// Chat completions, with three ways to ask for JSON in descending order of
// guarantee. Which one a server accepts is learned once and remembered, so the
// second call goes straight there.
async function callOpenAI(p, { system, messages, schema, maxTokens, signal }, learn) {
  const url = `${trimSlash(p.baseUrl)}/chat/completions`
  const msgs = [{ role: 'system', content: system }, ...messages]
  // The dialect that worked last time goes first; the others stay behind it,
  // so a server that changes its mind costs one extra request, not a failure.
  const ALL = ['schema', 'object', 'text']
  const modes = p.jsonMode ? [p.jsonMode, ...ALL.filter(m => m !== p.jsonMode)] : ALL
  let lastErr = null

  // Gateways cap output at all sorts of numbers and say so with a 400. Step
  // down rather than fail; a scene fits comfortably in 8k.
  let cap = maxTokens

  for (const mode of modes) {
    const body = { model: p.model, messages: msgs, max_tokens: cap }
    if (mode === 'schema') body.response_format = { type: 'json_schema', json_schema: { name: 'scene', strict: true, schema: strictify(schema) } }
    if (mode === 'object') body.response_format = { type: 'json_object' }
    // Without a schema to hold it, a model that narrates will narrate. Say
    // plainly what the reply must look like — and where it must start.
    const ONLY = '\n\nReply with ONLY the JSON object. No reasoning, no explanation, no markdown, nothing before the opening { or after the closing }.'
    if (mode !== 'schema') body.messages = [...msgs.slice(0, -1), { ...msgs.at(-1), content: msgs.at(-1).content + ONLY }]

    let res
    try {
      res = await readJson(await fetch(url, { method: 'POST', signal, headers: openaiHeaders(p), body: JSON.stringify(body) }))
    } catch (err) {
      const tooMany = err.status === 400 && /max_tokens|maximum.*tokens|output.*limit|too (many|large)/i.test(err.message)
      if (tooMany && cap > 4096) {
        cap = Math.max(4096, Math.floor(cap / 2))
        body.max_tokens = cap
        try { res = await readJson(await fetch(url, { method: 'POST', signal, headers: openaiHeaders(p), body: JSON.stringify(body) })) }
        catch (again) { if (!(again.status === 400 && mode !== 'text')) throw again; lastErr = again; continue }
      } else {
        // A 400 about the format means "try the next dialect"; anything else is real.
        const about = /response_format|json_schema|json_object|schema|unsupported|not supported/i.test(err.message)
        if (err.status === 400 && about && mode !== 'text') { lastErr = err; continue }
        throw err
      }
    }
    const choice = res.choices?.[0]
    if (!choice) throw new Error(`the server returned no choices: ${preview(JSON.stringify(res))}`)
    if (choice.message?.refusal) throw new Error('the model declined: ' + choice.message.refusal)
    if (choice.finish_reason === 'length') throw new Error('the answer was cut off at the token limit; ask for something smaller')

    const text = messageText(choice.message)
    const parsed = parseJson(text)
    if (parsed.ok) {
      if (p.jsonMode !== mode) learn?.(mode)
      return { text: parsed.text, usage: { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 }, model: res.model }
    }
    // Not JSON in this dialect. That is a reason to try the next one, not to
    // give up — and if every dialect fails, say what actually came back.
    const fields = Object.keys(choice.message || {}).filter(k => choice.message[k]).join(',')
    lastErr = new Error(`${parsed.why} (${mode} mode via ${p.model}; finish=${choice.finish_reason ?? '?'}; fields=${fields}): ${preview(text)}`)
    lastErr.kind = parsed.kind
    if (p.jsonMode === mode) { p.jsonMode = null; learn?.(null) }   // whatever we had learned is wrong now
  }
  throw lastErr || new Error('no JSON mode worked')
}

// Where the answer is depends on the server. Reasoner models put their
// thinking in reasoning_content and sometimes the answer with it; a few
// servers hand JSON back as a tool call; some return content as an array of
// parts. Look in all of them before deciding there is nothing.
function messageText(m) {
  if (!m) return ''
  const c = m.content
  if (typeof c === 'string' && c.trim()) return c
  if (Array.isArray(c)) {
    const t = c.map(x => (typeof x === 'string' ? x : x?.text || '')).join('')
    if (t.trim()) return t
  }
  const call = m.tool_calls?.[0]?.function?.arguments
  if (typeof call === 'string' && call.trim()) return call
  if (typeof m.reasoning_content === 'string' && m.reasoning_content.trim()) return m.reasoning_content
  if (typeof m.reasoning === 'string' && m.reasoning.trim()) return m.reasoning
  return ''
}

// Tolerant parse: strip fences and prose, drop trailing commas, and tell
// truncation apart from garbage — an answer that stops mid-object was cut off,
// which is a different problem from one that was never JSON.
export function parseJson(text) {
  const raw = String(text ?? '')
  if (!raw.trim()) return { ok: false, why: 'the model returned an empty answer', kind: 'empty' }
  const t = looseJson(raw)
  try { JSON.parse(t); return { ok: true, text: t } } catch {}
  const fixed = t.replace(/,\s*([}\]])/g, '$1')
  try { JSON.parse(fixed); return { ok: true, text: fixed } } catch {}
  const scan = lastObject(stripThinking(raw))
  if (scan?.cutOff) return { ok: false, why: 'the answer was cut off before the JSON was complete', kind: 'cut' }
  // No object at all, and it reads like thinking: the model spent its whole
  // reply reasoning and never got to the answer — usually a gateway output cap
  // the model does not know about, or a thinking model narrating in `content`.
  if (!scan && /^\s*(the user|let me|okay|first|so |i need|i'll|we need|looking at)/i.test(stripThinking(raw))) {
    return { ok: false, why: 'the model reasoned out loud and never wrote the JSON', kind: 'reasoning' }
  }
  return { ok: false, why: 'the model returned something that was not JSON', kind: 'garbage' }
}

const preview = t => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > 220 ? `"${s.slice(0, 220)}…"` : `"${s}"` }

// Reasoning models narrate before they answer, and the narration is full of
// JSON fragments ("each node has {id, type}…"). Taking first-{ to last-} across
// that produced garbage, so: drop any tagged thinking, then take the LAST
// complete top-level object — the answer comes after the thinking, never
// before it. A text that ends inside an object was cut off.
const THINK = /<(think|thinking|reasoning|reflection)>[\s\S]*?<\/\1>/gi
export const stripThinking = t => String(t ?? '').replace(THINK, '').replace(/<(think|thinking)>[\s\S]*$/i, '')

export function lastObject(text) {
  const t = String(text ?? '')
  let depth = 0, inStr = false, esc = false, start = -1, last = null
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
    if (ch === '"') { if (depth > 0) inStr = true; continue }
    if (ch === '{') { if (depth === 0) start = i; depth++ }
    else if (ch === '}') { if (depth > 0) { depth--; if (depth === 0) last = t.slice(start, i + 1) } }
  }
  if (depth > 0) return { cutOff: true, partial: t.slice(start) }
  return last ? { json: last } : null
}

export function looseJson(text) {
  const t = stripThinking(text).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) { const inner = lastObject(fence[1]); if (inner?.json) return inner.json }
  const found = lastObject(t)
  return found?.json ?? (found?.cutOff ? found.partial : t)
}

export async function call(p, req, learn) {
  if (p.protocol === 'anthropic') return callAnthropic(p, req)
  return callOpenAI(p, req, learn)
}

// --- the dashboard's two buttons --------------------------------------------

// A one-word request, timed. Enough to know the URL is right, the key works,
// and the model exists — the three things that go wrong.
export async function test(p, signal) {
  const t0 = performance.now()
  const probe = { system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'OK?' }], maxTokens: 16, signal }
  if (p.protocol === 'anthropic') {
    const res = await fetch(`${trimSlash(p.baseUrl)}/v1/messages`, {
      method: 'POST', signal, headers: anthropicHeaders(p),
      body: JSON.stringify({ model: p.model, max_tokens: 16, system: probe.system, messages: probe.messages }),
    })
    const body = await readJson(res)
    return { ok: true, ms: Math.round(performance.now() - t0), model: body.model }
  }
  const res = await fetch(`${trimSlash(p.baseUrl)}/chat/completions`, {
    method: 'POST', signal, headers: openaiHeaders(p),
    body: JSON.stringify({ model: p.model, max_tokens: 16,
      messages: [{ role: 'system', content: probe.system }, ...probe.messages] }),
  })
  const body = await readJson(res)
  return { ok: true, ms: Math.round(performance.now() - t0), model: body.model || p.model }
}

// What the provider says it can serve. Both protocols have a models endpoint
// with the same shape, which is a small mercy.
export async function listModels(p, signal) {
  const url = p.protocol === 'anthropic' ? `${trimSlash(p.baseUrl)}/v1/models?limit=100` : `${trimSlash(p.baseUrl)}/models`
  const headers = p.protocol === 'anthropic' ? anthropicHeaders(p) : openaiHeaders(p)
  delete headers['content-type']
  const body = await readJson(await fetch(url, { method: 'GET', signal, headers }))
  const rows = body.data || body.models || []
  return rows.map(m => m.id || m.name).filter(Boolean).sort()
}
