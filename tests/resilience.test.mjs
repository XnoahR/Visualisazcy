// Failure, retry, circuit breaking, async edges and read/write routing.
//
// Every number below is measured from a run, not asserted from the source. Run
// with `node tests/resilience.test.mjs`.

import { createSim } from '../src/sim.js'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '   ' + detail : ''}`)
  if (!ok) failures++
}
const near = (name, got, want, tol, unit = '') =>
  check(name, Math.abs(got - want) <= tol, `${got}${unit} (want ${want}±${tol})`)

function seeded(s) {
  let a = s
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DT = 1000 / 60
function run(def, frames = 900, seed = 424242, after = null) {
  const real = Math.random
  Math.random = seeded(seed)
  const sim = createSim(def, {})
  sim.state.running = true
  for (let i = 0; i < frames; i++) {
    sim.step(DT)
    if (after) after(sim, i)
  }
  Math.random = real
  return sim
}

const N = (id, type, x, y, o = {}) => ({ id, type, x, y, ...o })

console.log('\n1. a node that fails')
{
  const s = run({ id: 'f', nodes: [
    N('c', 'client', 0.1, 0.5, { rps: 40 }),
    N('s', 'server', 0.5, 0.5, { failureRate: 0.3, concurrency: 20 }),
  ], edges: [{ from: 'c', to: 's' }] })
  const { errors, processed, failed } = s.state.stats
  const rate = errors / (errors + processed)
  near('roughly the declared share fails', +(rate * 100).toFixed(1), 30, 6, '%')
  // The gap is exactly the failure responses still travelling when the run ends.
  const flying = s.state.packets.filter(x => x.failed).length
  check('and each one reaches the caller', failed + flying === errors,
        `failed ${failed} + ${flying} in flight = ${errors} errors`)
  check('the rest still complete', processed > 200, `${processed} processed`)
}

console.log('\n2. retry recovers them')
{
  const base = { id: 'r', nodes: [
    N('c', 'client', 0.1, 0.5, { rps: 40 }),
    N('g', 'gateway', 0.35, 0.5, { concurrency: 40 }),
    N('s', 'server', 0.7, 0.5, { failureRate: 0.4, concurrency: 20 }),
  ], edges: [{ from: 'c', to: 'g' }, { from: 'g', to: 's' }] }
  const plain = run(base)
  const withRetry = run({ ...base, nodes: base.nodes.map(n =>
    n.id === 'g' ? { ...n, retry: { max: 3, backoff: 40 } } : n) })
  check('retries actually happen', withRetry.state.stats.retries > 100,
        `${withRetry.state.stats.retries} retries`)
  check('and fewer requests give up',
        withRetry.state.stats.failed < plain.state.stats.failed / 3,
        `${withRetry.state.stats.failed} failed vs ${plain.state.stats.failed} without`)
  check('at the cost of extra load on the failing node',
        withRetry.state.stats.errors > plain.state.stats.errors,
        `${withRetry.state.stats.errors} errors vs ${plain.state.stats.errors} — the retry storm`)
}

console.log('\n3. a breaker stops the storm')
{
  const nodes = [
    N('c', 'client', 0.1, 0.5, { rps: 40 }),
    N('g', 'gateway', 0.35, 0.5, { concurrency: 40, retry: { max: 3, backoff: 40 },
                                   breaker: { threshold: 0.5, window: 1500, resetAfter: 2000, min: 6 } }),
    N('s', 'server', 0.7, 0.5, { failureRate: 1, concurrency: 20 }),
  ]
  const edges = [{ from: 'c', to: 'g' }, { from: 'g', to: 's' }]
  let openedAt = null
  const s = run({ id: 'b', nodes, edges }, 900, 7, (sim) => {
    if (openedAt == null && sim.breakerState('g', 's') === 'open') openedAt = sim.state.time
  })
  check('it trips', openedAt != null, openedAt ? `after ${Math.round(openedAt)}ms` : 'never')
  check('and the counter says so', s.state.stats.tripped > 0, `${s.state.stats.tripped} trips`)
  const hitRate = s.byId('s').rxLog.length
  check('the drowning node stops being called', hitRate < 25, `${hitRate} arrivals in the last second`)

  // and it recovers once the downstream does
  const heal = createSim({ id: 'b2', nodes, edges }, {})
  const real = Math.random; Math.random = seeded(9)
  heal.state.running = true
  for (let i = 0; i < 400; i++) heal.step(DT)
  const tripped = heal.breakerState('g', 's')
  heal.byId('s').spec.failureRate = 0          // the downstream comes back
  for (let i = 0; i < 700; i++) heal.step(DT)
  Math.random = real
  check('and closes again once the downstream recovers',
        tripped !== 'closed' && heal.breakerState('g', 's') === 'closed',
        `${tripped} -> ${heal.breakerState('g', 's')}`)
}

console.log('\n4. async edges hand off instead of waiting')
{
  const nodes = [
    N('c', 'client', 0.1, 0.5, { rps: 30 }),
    N('g', 'gateway', 0.35, 0.5, { concurrency: 40 }),
    N('q', 'queue', 0.6, 0.5),
    N('w', 'worker', 0.85, 0.5, { latency: 200, concurrency: 2 }),
  ]
  const edges = k => [{ from: 'c', to: 'g' }, { from: 'g', to: 'q', ...k }, { from: 'q', to: 'w' }]
  const sync = run({ id: 'a1', nodes, edges: edges({}) }, 600)
  const async = run({ id: 'a2', nodes, edges: edges({ async: true }) }, 600)
  check('waiting on the worker is slow', sync.percentile(0.5) > 150, `p50 ${sync.percentile(0.5)}ms`)
  check('handing off is not', async.percentile(0.5) < 20, `p50 ${async.percentile(0.5)}ms`)
  check('the work still happens behind it', async.state.stats.jobs > 50,
        `${async.state.stats.jobs} jobs finished after the caller left`)
  check('and it is not double counted as a response',
        async.state.stats.processed > 100 && sync.state.stats.jobs === 0,
        `processed ${async.state.stats.processed}, sync jobs ${sync.state.stats.jobs}`)
}

console.log('\n5. the wire costs time')
{
  const nodes = [N('c', 'client', 0.1, 0.5, { rps: 20 }), N('s', 'server', 0.6, 0.5, { concurrency: 20 })]
  const near0 = run({ id: 'l1', nodes, edges: [{ from: 'c', to: 's' }] }, 400)
  const far = run({ id: 'l2', nodes, edges: [{ from: 'c', to: 's', latency: 60 }] }, 400)
  near('a 60ms hop shows up in p50, twice for the round trip',
       far.percentile(0.5) - near0.percentile(0.5), 120, 12, 'ms')
}

console.log('\n6. reads and writes go to different places')
{
  const s = run({ id: 'rw', nodes: [
    N('c', 'client', 0.1, 0.5, { rps: 60, writeRatio: 0.25 }),
    N('lb', 'lb', 0.35, 0.5, { concurrency: 40 }),
    N('p', 'primary', 0.7, 0.3, { concurrency: 20 }),
    N('r', 'replica', 0.7, 0.7, { concurrency: 20 }),
  ], edges: [{ from: 'c', to: 'lb' }, { from: 'lb', to: 'p' }, { from: 'lb', to: 'r' }] }, 700)
  const p = s.byId('p').rxLog.length, r = s.byId('r').rxLog.length
  check('the primary only sees writes', p > 5 && p < r, `primary ${p}/s, replica ${r}/s`)
  near('and roughly the declared share of them', +(p / (p + r) * 100).toFixed(0), 25, 12, '%')
}

console.log('\n7. degraded is not dead')
{
  const nodes = [N('c', 'client', 0.1, 0.5, { rps: 25 }), N('s', 'server', 0.6, 0.5, { concurrency: 20 })]
  const edges = [{ from: 'c', to: 's' }]
  const well = run({ id: 'd1', nodes, edges }, 500)
  const sick = createSim({ id: 'd2', nodes, edges }, {})
  const real = Math.random; Math.random = seeded(11)
  sick.degrade('s')
  sick.state.running = true
  for (let i = 0; i < 500; i++) sick.step(DT)
  Math.random = real
  check('it still answers', sick.state.stats.processed > 20, `${sick.state.stats.processed} processed`)
  check('but slowly', sick.percentile(0.5) > well.percentile(0.5) * 3,
        `${sick.percentile(0.5)}ms vs ${well.percentile(0.5)}ms healthy`)
  check('and unreliably', sick.state.stats.errors > 20, `${sick.state.stats.errors} errors`)
}

console.log('\n8. lag is the backlog')
{
  const s = run({ id: 'lag', nodes: [
    N('c', 'client', 0.1, 0.5, { rps: 120 }),
    N('b', 'broker', 0.4, 0.5, { maxQueue: 4000 }),
    N('w', 'worker', 0.8, 0.5, { latency: 200, concurrency: 1 }),
  ], edges: [{ from: 'c', to: 'b' }, { from: 'b', to: 'w' }] }, 600)
  check('a slow consumer builds lag', s.lagOf(s.byId('w')) > 20, `lag ${s.lagOf(s.byId('w'))}`)
}

console.log('\n9. an edge into a broker is async without being told')
{
  const sim = createSim({ id: 'ai', nodes: [
    N('g', 'gateway', 0.2, 0.5), N('b', 'broker', 0.6, 0.5), N('s', 'server', 0.9, 0.5),
  ], edges: [] }, {})
  sim.connect('g', 'b')
  sim.connect('g', 's')
  check('into a broker: async', sim.state.edges.find(e => e.to === 'b')?.async === true)
  check('into a server: not', sim.state.edges.find(e => e.to === 's')?.async === undefined)
  const round = JSON.parse(JSON.stringify(sim.state.scene.edges))
  check('and it survives serialisation', round.find(e => e.to === 'b')?.async === true,
        JSON.stringify(round))
}

console.log('\n10. a refused request says so')
{
  const s = run({ id: 'ref', nodes: [
    N('c', 'client', 0.1, 0.5, { rps: 80 }),
    N('s', 'server', 0.6, 0.5),                       // 40 rps of capacity
  ], edges: [{ from: 'c', to: 's' }] }, 600)
  const st = s.state.stats
  check('overload still counts as dropped', st.dropped > 200, `${st.dropped} dropped`)
  check('and the caller is told about every one', st.errors === st.dropped,
        `${st.errors} errors vs ${st.dropped} dropped`)

  // The point of telling the caller: overload can now trip a breaker, which it
  // could not when a refused request simply vanished.
  const guarded = run({ id: 'ref2', nodes: [
    N('c', 'client', 0.1, 0.5, { rps: 80 }),
    N('g', 'gateway', 0.35, 0.5, { concurrency: 40,
        breaker: { threshold: 0.4, window: 1500, resetAfter: 2500, min: 8 } }),
    N('s', 'server', 0.7, 0.5),
  ], edges: [{ from: 'c', to: 'g' }, { from: 'g', to: 's' }] }, 900)
  check('an overloaded downstream trips a breaker', guarded.state.stats.tripped > 0,
        `${guarded.state.stats.tripped} trips`)
}

console.log(failures ? `\n${failures} failing\n` : '\nall passing\n')
process.exit(failures ? 1 : 0)
