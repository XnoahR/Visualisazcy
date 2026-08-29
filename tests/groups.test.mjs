// Groups: does folding change anything it must not?
//
// No framework, matching the rest of the project. Run with `node tests/groups.test.mjs`.
//
// The headline test is IDENTITY: the same scene, run for the same simulated
// time, in three fold states, must report the same numbers. Folding is a view
// operation, so if a single count moves the feature is wrong.

import { createSim } from '../src/sim.js'
import { viewGraph, proxyOf, openGroups, openRoots, wouldCycle } from '../src/groups.js'
import { validateScene } from '../src/validate.js'
import { scene, node as n, edge as e, group as grp } from '../src/scene.js'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '   ' + detail : ''}`)
  if (!ok) failures++
}
const eq = (name, a, b) => check(name, a === b, a === b ? '' : `got ${a}, want ${b}`)

// Node has no seedable RNG, and cache hit rates call Math.random. Seeding it
// is what makes "identical" mean identical rather than approximately equal.
function seeded(s) {
  let a = s
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A realistic microservice board: 24 objects, four services, one region.
const board = () => scene({
  id: 'micro', title: 'Microservices',
  nodes: [
    n('client', 'client', 0.06, 0.50, { rps: 90 }),
    n('cdn', 'edge', 0.14, 0.50),
    n('lb', 'lb', 0.22, 0.50),
    n('rl', 'ratelimit', 0.30, 0.50),
    n('gateway', 'gateway', 0.38, 0.50),

    n('cart_api', 'server', 0.52, 0.16, { role: 'router' }),
    n('cart_cache', 'cache', 0.62, 0.10),
    n('cart_db', 'db', 0.72, 0.10),
    n('cart_q', 'queue', 0.62, 0.22),
    n('cart_worker', 'worker', 0.72, 0.22, { role: 'router' }),
    n('cart_blob', 'blob', 0.82, 0.22),

    n('sms_api', 'server', 0.52, 0.38, { role: 'router' }),
    n('sms_q', 'queue', 0.62, 0.38),
    n('sms_worker', 'worker', 0.72, 0.38, { role: 'router' }),
    n('sms_db', 'db', 0.82, 0.38),

    n('srch_api', 'server', 0.52, 0.62, { role: 'router' }),
    n('srch_idx', 'search', 0.62, 0.56),
    n('srch_q', 'queue', 0.62, 0.68),
    n('srch_worker', 'worker', 0.72, 0.68),

    n('auth_api', 'server', 0.52, 0.86, { role: 'router' }),
    n('auth_cache', 'cache', 0.62, 0.86),
    n('auth_db', 'db', 0.72, 0.86),

    n('metrics', 'topic', 0.90, 0.50),
    n('logs', 'blob', 0.96, 0.50),
  ],
  edges: [
    e('client', 'cdn'), e('cdn', 'lb'), e('lb', 'rl'), e('rl', 'gateway'),
    e('gateway', 'cart_api'), e('gateway', 'cart_q'),
    e('gateway', 'sms_api'), e('gateway', 'srch_api'), e('gateway', 'auth_api'),
    e('cart_api', 'cart_cache'), e('cart_cache', 'cart_db'),
    e('cart_q', 'cart_worker'), e('cart_worker', 'cart_blob'),
    e('sms_api', 'sms_q'), e('sms_q', 'sms_worker'), e('sms_worker', 'sms_db'),
    e('srch_api', 'srch_idx'), e('srch_api', 'srch_q'), e('srch_q', 'srch_worker'),
    e('auth_api', 'auth_cache'), e('auth_cache', 'auth_db'),
    e('cart_worker', 'metrics'), e('metrics', 'logs'),
  ],
  groups: [
    grp('cart', 'Cart Service', ['cart_api', 'cart_cache', 'cart_db', 'cart_q', 'cart_worker', 'cart_blob']),
    grp('sms', 'SMS Service', ['sms_api', 'sms_q', 'sms_worker', 'sms_db']),
    grp('srch', 'Search Service', ['srch_api', 'srch_idx', 'srch_q', 'srch_worker']),
    grp('auth', 'Auth Service', ['auth_api', 'auth_cache', 'auth_db']),
    grp('region', 'EU Region', ['cart', 'sms', 'srch', 'auth']),
  ],
})

const DT = 1000 / 60
const FRAMES = 600      // ten seconds of simulated time

function run(folded) {
  const real = Math.random
  Math.random = seeded(20260829)
  const sim = createSim(board(), { portrait: false })
  for (const id of folded) sim.setFolded(id, true)
  sim.state.running = true
  for (let i = 0; i < FRAMES; i++) sim.step(DT)
  const out = {
    processed: sim.state.stats.processed,
    dropped: sim.state.stats.dropped,
    hits: sim.state.stats.hits,
    p50: sim.percentile(0.5),
    p99: sim.percentile(0.99),
    rates: sim.state.nodes.map(x => `${x.id}=${sim.rateOf(x)}`).sort().join(' '),
  }
  Math.random = real
  return { sim, out }
}

console.log('\n1. identity — folding must not change a single number')
const open = run([])
const svcs = run(['cart', 'sms', 'srch', 'auth'])
const region = run(['region'])
const both = run(['cart', 'sms', 'srch', 'auth', 'region'])

for (const [name, r] of [['services folded', svcs], ['region folded', region], ['nested folded', both]]) {
  for (const k of ['processed', 'dropped', 'hits', 'p50', 'p99']) {
    eq(`${name}: ${k}`, r.out[k], open.out[k])
  }
  check(`${name}: per-node rps`, r.out.rates === open.out.rates)
}
check('the run actually did work', open.out.processed > 100, `processed ${open.out.processed}, p50 ${open.out.p50}ms`)

console.log('\n2. density — the point of the feature')
const st = open.sim.state
const cards = f => { for (const g of st.groups) g.folded = f.includes(g.id); return viewGraph(st).items.length }
eq('fully open', cards([]), 24)
eq('four services folded', cards(['cart', 'sms', 'srch', 'auth']), 11)
eq('region folded', cards(['region']), 8)

console.log('\n3. edges through the substitution')
st.groups.forEach(g => { g.folded = ['cart', 'sms', 'srch', 'auth'].includes(g.id) })
let vg = viewGraph(st)
const wires = (a, b) => vg.edges.filter(x => x.from === a && x.to === b)
eq('gateway->cart deduped from two edges', wires('gateway', 'cart').length, 1)
eq('  and it remembers both', wires('gateway', 'cart')[0].real.length, 2)
check('no wire between two internals', !vg.edges.some(x =>
  ['cart_api', 'cart_cache', 'cart_db', 'cart_q'].includes(x.from)))
eq('cart still reaches metrics', wires('cart', 'metrics').length, 1)

st.groups.forEach(g => { g.folded = g.id === 'region' })
vg = viewGraph(st)
eq('region folded: one wire from gateway', vg.edges.filter(x => x.to === 'region').length, 1)
eq('region folded: one wire out to metrics', vg.edges.filter(x => x.from === 'region').length, 1)
eq('proxyOf picks the outermost fold', proxyOf(st, 'cart_api').id, 'region')

st.groups.forEach(g => { g.folded = ['region', 'cart'].includes(g.id) })
eq('outermost wins over an inner fold', proxyOf(st, 'cart_api').id, 'region')
st.groups.forEach(g => { g.folded = g.id === 'cart' })
eq('region open: the inner fold takes it', proxyOf(st, 'cart_api').id, 'cart')
eq('geometry starts at the outermost box only', openRoots(st).map(g => g.id).join(','), 'region')
eq('but all four are hit-testable', openGroups(st).length, 4)

console.log('\n4. three edges into one service collapse to one wire')
const tiny = {
  nodes: [{ id: 'gw', x: 0, y: 0 }, { id: 'a', x: 1, y: 0 }, { id: 'b', x: 1, y: 1 }, { id: 'c', x: 1, y: 2 }],
  edges: [{ from: 'gw', to: 'a' }, { from: 'gw', to: 'b' }, { from: 'gw', to: 'c' }],
  groups: [{ id: 'svc', label: 'S', children: ['a', 'b', 'c'], folded: true, x: 1, y: 1 }],
}
eq('three become one', viewGraph(tiny).edges.length, 1)
eq('and the card counts three', viewGraph(tiny).byId.get('svc').count, 3)

console.log('\n5. mutations')
{
  const sim = createSim(board(), {})
  const before = sim.snapshot()
  const r = sim.addGroup('Infra', ['lb', 'rl'])
  check('addGroup returns the group', !!r.group, r.group?.id)
  check('spanning two groups is refused',
    !!sim.addGroup('X', ['cart_api', 'sms_api']).error,
    sim.addGroup('X', ['cart_api', 'sms_api']).error)
  check('one object is not a group', !!sim.addGroup('X', ['lb']).error)

  sim.restore(before)
  eq('undo restores the group list', sim.state.groups.length, 5)

  sim.setFolded('cart', true)
  const card = sim.state.groups.find(g => g.id === 'cart')
  const leaf = sim.byId('cart_api')
  const lx = leaf.x, cx = card.x
  sim.moveGroup('cart', 0.1, 0)
  check('moving a folded card carries its members',
    Math.abs(leaf.x - (lx + 0.1)) < 1e-9 && Math.abs(card.x - (cx + 0.1)) < 1e-9)
  sim.setFolded('cart', false)
  sim.setFolded('cart', true)
  check('refolding lands where it was', Math.abs(card.x - (cx + 0.1)) < 1e-9,
    `${card.x.toFixed(4)} vs ${(cx + 0.1).toFixed(4)}`)

  sim.removeNode('cart_api')
  check('a deleted node leaves its group', !sim.state.groups.find(g => g.id === 'cart').children.includes('cart_api'))

  sim.removeGroup('auth')
  check('ungroup keeps the nodes', !!sim.byId('auth_db') && !sim.state.groups.some(g => g.id === 'auth'))
  check('and hands them to the parent',
    sim.state.groups.find(g => g.id === 'region').children.includes('auth_db'))

  sim.removeGroup('sms', { deep: true })
  check('deep delete removes the members', !sim.byId('sms_api') && !sim.byId('sms_db'))

  const empty = createSim(board(), {})
  for (const id of ['auth_api', 'auth_cache', 'auth_db']) empty.removeNode(id)
  check('an emptied group is deleted', !empty.state.groups.some(g => g.id === 'auth'))
}

console.log('\n6. cycles and validation')
check('wouldCycle catches an ancestor', wouldCycle(st, 'cart', 'region'))
check('and allows a sibling', !wouldCycle(st, 'cart', 'sms'))
const v = validateScene(board())
check('the demo board validates', v.ok, v.errors.map(x => x.message).join('; '))

console.log(failures ? `\n${failures} failing\n` : '\nall passing\n')
process.exit(failures ? 1 : 0)
