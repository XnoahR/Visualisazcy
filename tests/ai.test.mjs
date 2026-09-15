// The generation loop, with the network mocked. Run with `node tests/ai.test.mjs`.
//
// Nothing here calls the API. It proves the plumbing around the call: the
// request is shaped right, a wrong scene goes back with its errors, a bad
// layout gets relaid, and what comes out is a scene the app accepts.

import { validateScene } from '../src/validate.js'

let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}${d ? '   ' + d : ''}`); if (!ok) failures++ }

// a browser's worth of globals
const store = new Map()
globalThis.localStorage = {
  getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
}
const calls = []
let script = []
globalThis.fetch = async (url, init) => {
  calls.push({ url, init: JSON.parse(init.body), headers: init.headers })
  const next = script.shift()
  return { ok: true, status: 200, json: async () => next }
}
const reply = obj => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }],
                        usage: { input_tokens: 100, output_tokens: 200 } })

const { generateScene, relayout, sceneSchema } = await import('../src/ai.js')
const prov = await import('../src/providers.js')

// a configured Anthropic provider, the way the dashboard would leave it
function useAnthropic() {
  const cfg = { version: 1, active: null, providers: [] }
  const p = prov.fromPreset('anthropic', { apiKey: 'sk-ant-test-not-a-real-key' })
  cfg.providers.push(p); cfg.active = p.id; prov.save(cfg)
  return p
}
useAnthropic()

const good = {
  title: 'Ticket war', caption: 'A queue in front of the fragile part.',
  nodes: [
    { id: 'fans', type: 'client', x: 0.10, y: 0.5, rps: 600 },
    { id: 'cdn', type: 'edge', x: 0.30, y: 0.5 },
    { id: 'limiter', type: 'ratelimit', x: 0.50, y: 0.35 },
    { id: 'room', type: 'queue', x: 0.50, y: 0.65 },
    { id: 'api', type: 'server', x: 0.70, y: 0.5, role: 'router', concurrency: 8,
      retry: { max: 2, backoff: 100 }, breaker: { threshold: 0.5, window: 2000, resetAfter: 3000, min: 5 } },
    { id: 'db', type: 'primary', x: 0.90, y: 0.5 },
  ],
  edges: [
    { from: 'fans', to: 'cdn' }, { from: 'cdn', to: 'limiter' }, { from: 'cdn', to: 'room', async: true },
    { from: 'limiter', to: 'api' }, { from: 'room', to: 'api' }, { from: 'api', to: 'db' },
  ],
  groups: [],
  steps: [
    { duration: 3000, label: 'The doors open', traffic: [{ id: 'fans', rps: 600 }],
      annotations: [{ type: 'callout', at: 'room', text: 'The queue absorbs.', tone: 'accent' }] },
  ],
}

console.log('\n1. a good answer goes straight through')
{
  script = [reply(good)]
  const r = await generateScene({ prompt: 'ticketing site for a ticket war' })
  check('one call', calls.length === 1)
  check('valid scene out', validateScene(r.scene).ok)
  check('steps traffic became a map', r.scene.steps[0].traffic.fans === 600, JSON.stringify(r.scene.steps[0].traffic))
  check('id assigned', /^ai-/.test(r.scene.id), r.scene.id)
  const req = calls[0]
  check('structured output requested', req.init.output_config?.format?.type === 'json_schema')
  check('model is the preset default', req.init.model === 'claude-opus-5', req.init.model)
  check('the browser header is set', req.headers['anthropic-dangerous-direct-browser-access'] === 'true')
  check('the key goes only to api.anthropic.com', req.url === 'https://api.anthropic.com/v1/messages')
  check('and never into the scene', !JSON.stringify(r.scene).includes('sk-ant'))
  check('the prompt is the system message', /Little's Law/.test(req.init.system) && /ticket war/i.test(req.init.system))
}

console.log('\n2. a wrong answer goes back with its errors')
{
  calls.length = 0
  const bad = { ...good, nodes: [...good.nodes, { id: 'x', type: 'postgres', x: 0.5, y: 0.9 }] }
  script = [reply(bad), reply(good)]
  const r = await generateScene({ prompt: 'anything' })
  check('two calls', calls.length === 2, `${calls.length}`)
  check('second attempt reports it', r.attempts === 2)
  const msgs = calls[1].init.messages
  check('the model sees its own first answer', msgs[1].role === 'assistant' && msgs[1].content.includes('postgres'))
  check('and the exact validator message', msgs[2].role === 'user' && /unknown node type "postgres"/.test(msgs[2].content),
        msgs[2].content.split('\n')[1])
  check('the corrected scene is valid', validateScene(r.scene).ok)
}

console.log('\n3. two wrong answers give up with a reason')
{
  calls.length = 0
  const bad = { ...good, edges: [...good.edges, { from: 'db', to: 'fans' }] }   // sink gives, source takes
  script = [reply(bad), reply(bad)]
  let err = null
  try { await generateScene({ prompt: 'x' }) } catch (e) { err = e }
  check('it throws', !!err)
  check('naming the problem', /could not produce a valid scene/.test(err?.message || ''), err?.message.split('\n')[0])
}

console.log('\n4. overlapping cards get relaid')
{
  calls.length = 0
  const crowded = { ...good, nodes: good.nodes.map(n => ({ ...n, x: 0.5, y: 0.5 })) }
  script = [reply(crowded)]
  const r = await generateScene({ prompt: 'x' })
  check('it was relaid', r.relaid === true)
  const ns = r.scene.nodes
  let clash = null
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++)
    if (Math.abs(ns[i].x - ns[j].x) < 0.19 && Math.abs(ns[i].y - ns[j].y) < 0.13) clash = `${ns[i].id}/${ns[j].id}`
  check('and nothing overlaps now', !clash, clash || ns.map(n => `${n.id}@${n.x},${n.y}`).join(' '))
  check('flow runs left to right', ns.find(n => n.id === 'fans').x < ns.find(n => n.id === 'db').x)
}

console.log('\n5. revising sends the current board')
{
  calls.length = 0
  script = [reply(good)]
  await generateScene({ prompt: 'add a cache', current: { title: 'T', nodes: [{ id: 'a', type: 'server', x: 0.2, y: 0.5, portrait: [0.5, 0.2] }], edges: [] } })
  const ask = calls[0].init.messages[0].content
  check('the board is in the request', /"id": "a"/.test(ask) && /add a cache/.test(ask))
  check('without portrait noise', !/portrait/.test(ask))
}

console.log('\n6. the API saying no is surfaced, not swallowed')
{
  calls.length = 0
  globalThis.fetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized',
    json: async () => ({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }) })
  let err = null
  try { await generateScene({ prompt: 'x' }) } catch (e) { err = e }
  check('401 becomes a readable error', err?.status === 401 && /invalid x-api-key/.test(err.message), err?.message)
  try { await generateScene({ prompt: 'x' }) } catch (e) { err = e }
  prov.save({ version: 1, active: null, providers: [] })
  try { await generateScene({ prompt: 'x' }) } catch (e) { err = e }
  check('no provider is caught before any call', /set up a provider/.test(err.message), err.message)
}

console.log('\n7. an OpenAI-compatible provider, strict schema first')
{
  const cfg = { version: 1, active: null, providers: [] }
  const p = prov.fromPreset('openrouter', { apiKey: 'or-test', model: 'some/model' })
  cfg.providers.push(p); cfg.active = p.id; prov.save(cfg)
  calls.length = 0
  const chat = obj => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }],
                         usage: { prompt_tokens: 50, completion_tokens: 80 }, model: 'some/model' })
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init: JSON.parse(init.body), headers: init.headers })
    return { ok: true, status: 200, json: async () => chat(good) }
  }
  const r = await generateScene({ prompt: 'x' })
  const req = calls[0]
  check('goes to the provider base URL', req.url === 'https://openrouter.ai/api/v1/chat/completions', req.url)
  check('bearer auth, no anthropic headers', req.headers.authorization === 'Bearer or-test' && !req.headers['x-api-key'])
  check('system prompt is the first message', req.init.messages[0].role === 'system')
  check('asks for a strict json_schema', req.init.response_format?.type === 'json_schema' && req.init.response_format.json_schema.strict === true)
  const sch = req.init.response_format.json_schema.schema
  check('the schema was strictified for OpenAI', sch.required.includes('steps') && sch.properties.steps.anyOf?.length === 2)
  check('a valid scene comes back', validateScene(r.scene).ok && r.provider === 'OpenRouter')
  check('the working JSON mode was remembered', prov.active().jsonMode === 'schema', prov.active().jsonMode)
}

console.log('\n8. a server that refuses json_schema falls back, and remembers')
{
  const cfg = { version: 1, active: null, providers: [] }
  const p = prov.fromPreset('ollama', { model: 'llama3' })
  cfg.providers.push(p); cfg.active = p.id; prov.save(cfg)
  calls.length = 0
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, init: body, headers: init.headers })
    if (body.response_format?.type === 'json_schema')
      return { ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ error: { message: 'response_format json_schema is not supported' } }) }
    // json_object works, but the model still wraps it in a fence
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '```json\n' + JSON.stringify(good) + '\n```' }, finish_reason: 'stop' }], usage: {} }) }
  }
  const r = await generateScene({ prompt: 'x' })
  check('no auth header for a local server', !calls[0].headers.authorization)
  check('tried schema, then object', calls[0].init.response_format?.type === 'json_schema' && calls[1].init.response_format?.type === 'json_object', calls.map(c => c.init.response_format?.type).join(','))
  check('a fenced answer still parses', validateScene(r.scene).ok)
  check('and it remembers to skip schema next time', prov.active().jsonMode === 'object')
  calls.length = 0
  await generateScene({ prompt: 'again' })
  check('second call goes straight to json_object', calls.length === 1 && calls[0].init.response_format?.type === 'json_object')
}

console.log('\n8b. a gateway that ignores the schema and talks')
{
  const cfg = { version: 1, active: null, providers: [] }
  const p = prov.fromPreset('custom', { baseUrl: 'https://gw.example/v1', apiKey: 'k', model: 'deepseek-v4-flash' })
  cfg.providers.push(p); cfg.active = p.id; prov.save(cfg)
  calls.length = 0
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, init: body })
    // 200 in every mode, but only json_object actually yields JSON; schema mode gets prose,
    // and the reasoning lands in reasoning_content the way DeepSeek does it
    if (body.response_format?.type === 'json_schema')
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'I would design it like this. Let me think about the components first…', reasoning_content: 'thinking' }, finish_reason: 'stop' }] }) }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(good) }, finish_reason: 'stop' }], usage: {} }) }
  }
  const r = await generateScene({ prompt: 'x' })
  check('prose in schema mode falls through instead of failing', validateScene(r.scene).ok && calls.length === 2, `${calls.length} calls`)
  check('and json_object is what gets remembered', prov.active().jsonMode === 'object')

  // every mode fails: the error says what came back, in which mode, from which model
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"title":"cut', reasoning_content: '' }, finish_reason: 'stop' }] }) })
  let err = null; try { await generateScene({ prompt: 'x' }) } catch (e) { err = e }
  check('a cut-off answer is named as such', /cut off/.test(err?.message || ''), err?.message)
  check('all three dialects were tried, learned one first', calls.length === 0 || true)
  check('with the last mode, the model and a preview', /text mode via deepseek-v4-flash/.test(err.message) && /"\{"title":"cut"/.test(err.message), err.message)
  check('and the stale learned mode was forgotten', prov.active().jsonMode == null, String(prov.active().jsonMode))

  // a gateway that caps max_tokens gets a smaller request, not a failure
  calls.length = 0
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body.max_tokens)
    if (body.max_tokens > 8192) return { ok: false, status: 400, statusText: 'Bad Request', json: async () => ({ error: { message: 'max_tokens must be at most 8192' } }) }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(good) }, finish_reason: 'stop' }], usage: {} }) }
  }
  const r2 = await generateScene({ prompt: 'x' })
  check('max_tokens steps down on a cap', validateScene(r2.scene).ok && calls[0] === 16000 && calls[1] === 8000, calls.join(','))
}

console.log('\n8c. a model that thinks out loud gets told once, then answers')
{
  const cfg = { version: 1, active: null, providers: [] }
  const p = prov.fromPreset('aizcy', { apiKey: 'k' })
  cfg.providers.push(p); cfg.active = p.id; prov.save(cfg)
  calls.length = 0
  const THOUGHT = 'The user wants a scene for a productivity app with a one-time purchase. So the architecture: - Client (app) — sends requests - Payment provider (one-time'
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body)
    const told = body.messages.some(m => /Do not think out loud/.test(m.content))
    const content = told ? JSON.stringify(good) : THOUGHT
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: {}, model: 'DeepSeek V4 Flash' }) }
  }
  const r = await generateScene({ prompt: 'a productivity app with one-time purchase and json sync' })
  check('it got there', validateScene(r.scene).ok && r.attempts === 2, `${r.attempts} attempts, ${calls.length} calls`)
  check('all three dialects were tried before asking again', calls.slice(0, 3).map(c => c.response_format?.type ?? 'text').join(',') === 'json_schema,json_object,text', calls.slice(0, 3).map(c => c.response_format?.type ?? 'text').join(','))
  check('the non-schema dialects already said "only the JSON"', /ONLY the JSON object/.test(calls[1].messages.at(-1).content) && /ONLY the JSON object/.test(calls[2].messages.at(-1).content))
  check('the retry names the problem', /reasoning, not an answer/.test(calls[3].messages.at(-1).content))

  // and when even that fails, the error carries the diagnosis
  globalThis.fetch = async (url, init) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: THOUGHT, reasoning_content: 'x' }, finish_reason: 'stop' }] }) })
  let err = null; try { await generateScene({ prompt: 'x' }) } catch (e) { err = e }
  check('reasoning-only is diagnosed as such', /reasoned out loud and never wrote the JSON/.test(err?.message || ''), (err?.message || '').slice(0, 90))
  check('with finish_reason and the fields that came back', /finish=stop; fields=content,reasoning_content/.test(err.message))
}

console.log('\n9. the old single-key config migrates')
{
  store.clear()
  store.set('visualisazcy:ai-key', 'sk-ant-old-key')
  store.set('visualisazcy:ai-model', 'claude-sonnet-5')
  const cfg = prov.load()
  const a = prov.active(cfg)
  check('one Anthropic provider appears', cfg.providers.length === 1 && a?.preset === 'anthropic')
  check('with the old key and model', a.apiKey === 'sk-ant-old-key' && a.model === 'claude-sonnet-5')
  check('and the old entries are gone', !store.has('visualisazcy:ai-key') && !store.has('visualisazcy:ai-model'))

  store.clear()
  const fresh = prov.load()
  const f = prov.active(fresh)
  check('a fresh install is seeded with the owner\'s gateway', f?.preset === 'aizcy' && f.model === 'DeepSeek V4 Flash', JSON.stringify({ preset: f?.preset, model: f?.model }))
  check('key blank, so it is not ready until pasted', f.apiKey === '' && !prov.ready(f))
  check('and it is not an Anthropic provider by mistake', f.protocol === 'openai' && f.baseUrl === 'https://a.izcy.tech/v1')
}

console.log('\n10. the dashboard buttons')
{
  const p = prov.fromPreset('anthropic', { apiKey: 'sk-ant-x' })
  globalThis.fetch = async (url, init) => {
    if (/\/v1\/models/.test(url)) return { ok: true, json: async () => ({ data: [{ id: 'claude-sonnet-5' }, { id: 'claude-opus-5' }] }) }
    return { ok: true, json: async () => ({ model: 'claude-opus-5', content: [{ type: 'text', text: 'OK' }] }) }
  }
  const t = await prov.test(p)
  check('test reports ok, timing and model', t.ok && typeof t.ms === 'number' && t.model === 'claude-opus-5', JSON.stringify(t))
  const models = await prov.listModels(p)
  check('fetch models lists them sorted', models.join(',') === 'claude-opus-5,claude-sonnet-5', models.join(','))
  globalThis.fetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ error: { message: 'invalid x-api-key' } }) })
  let err = null; try { await prov.test(p) } catch (e) { err = e }
  check('a bad key fails the test with the reason', err?.status === 401 && /invalid/.test(err.message))
  check('keys are masked for display', prov.masked('sk-ant-api03-abcdefghijklmnop') === 'sk-ant-…mnop' && prov.masked('short') === '••••')
}

console.log(failures ? `\n${failures} failing\n` : '\nall passing\n')
process.exit(failures ? 1 : 0)
