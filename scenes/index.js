import { scene, node as n, edge as e, section as g, group as grp } from '../src/scene.js'
import { captcha, captchaShort } from './captcha.js'

// Positions are fractions of the canvas. `portrait` is the fallback layout used
// when the canvas is taller than it is wide, which is what makes one scene
// render at 16:9 and 9:16 without being rebuilt.

export const request = scene({
  id: 'request',
  title: 'One request, end to end',
  caption: 'Every dot is one request going out, or one response coming back.',
  nodes: [
    n('client', 'client', 0.16, 0.5,  { rps: 4, portrait: [0.5, 0.16] }),
    n('srv',    'server', 0.5,  0.5,  { role: 'router', portrait: [0.5, 0.5] }),
    n('db',     'db',     0.84, 0.5,  { portrait: [0.5, 0.84] }),
  ],
  edges: [e('client', 'srv'), e('srv', 'db')],
})

export const overload = scene({
  id: 'overload',
  title: 'Push it until it breaks',
  caption: 'One server, 40 rps of capacity, far more than that arriving. Watch Dropped climb.',
  nodes: [
    n('client', 'client', 0.2,  0.5, { rps: 70, portrait: [0.5, 0.24] }),
    n('srv',    'server', 0.72, 0.5, { portrait: [0.5, 0.7] }),
  ],
  edges: [e('client', 'srv')],
})

export const loadbalancer = scene({
  id: 'loadbalancer',
  title: 'Spread it across three',
  caption: 'Same 70 rps, now round-robined. Tap a server to kill it and watch the rest absorb its share.',
  nodes: [
    n('client', 'client', 0.12, 0.5,  { rps: 70, portrait: [0.5, 0.1] }),
    n('lb',     'lb',     0.42, 0.5,  { portrait: [0.5, 0.34] }),
    n('s1',     'server', 0.8,  0.22, { label: 'Server 1', portrait: [0.3, 0.63] }),
    n('s2',     'server', 0.8,  0.5,  { label: 'Server 2', portrait: [0.5, 0.77] }),
    n('s3',     'server', 0.8,  0.78, { label: 'Server 3', portrait: [0.7, 0.91] }),
  ],
  edges: [
    e('client', 'lb'),
    e('lb', 's1'), e('lb', 's2'), e('lb', 's3'),
  ],
})

export const replicas = scene({
  id: 'replicas',
  title: 'One writes, many read',
  caption: 'The primary takes writes it cannot share. Reads fan out to replicas.',
  nodes: [
    n('client', 'client',  0.12, 0.5,  { rps: 60, portrait: [0.5, 0.1] }),
    n('lb',     'lb',      0.4,  0.5,  { portrait: [0.5, 0.32] }),
    n('pri',    'db',      0.78, 0.2,  { label: 'Primary DB', portrait: [0.3, 0.63] }),
    n('r1',     'replica', 0.78, 0.5,  { label: 'Replica 1',  portrait: [0.5, 0.77] }),
    n('r2',     'replica', 0.78, 0.8,  { label: 'Replica 2',  portrait: [0.7, 0.91] }),
  ],
  edges: [
    e('client', 'lb'),
    e('lb', 'pri'), e('lb', 'r1'), e('lb', 'r2'),
  ],
})

export const queue = scene({
  id: 'queue',
  title: 'Let the queue absorb the spike',
  caption: 'The queue takes 10,000 rps without blinking. Workers drain it at 25 each.',
  nodes: [
    n('client', 'client', 0.1,  0.5,  { rps: 45, portrait: [0.5, 0.09] }),
    n('api',    'server', 0.34, 0.5,  { role: 'router', label: 'API', latency: 2, concurrency: 4, portrait: [0.5, 0.3] }),
    n('q',      'queue',  0.6,  0.5,  { portrait: [0.5, 0.52] }),
    n('w1',     'worker', 0.87, 0.32, { label: 'Worker 1', portrait: [0.29, 0.82] }),
    n('w2',     'worker', 0.87, 0.68, { label: 'Worker 2', portrait: [0.71, 0.82] }),
  ],
  edges: [
    e('client', 'api'), e('api', 'q'),
    e('q', 'w1'), e('q', 'w2'),
  ],
})

// A wide board to plug things together on. Drag from a + handle to connect;
// only nodes that may give traffic show them.
export const sandbox = scene({
  id: 'sandbox',
  title: 'Sandbox: plug things together',
  caption: 'Drag to move, + to connect, wheel to zoom, drag empty space to pan.',
  nodes: [
    // Seven columns of 168px cards do not fit an 880px frame, so the pooler and
    // the database share the last one. client/gw and pool/db used to sit
    // 0.17 and 0.09 apart on the same row and overlapped outright.
    n('client',  'client',    0.10, 0.50, { rps: 120, portrait: [0.5, 0.08] }),
    n('gw',      'gateway',   0.30, 0.50, { portrait: [0.5, 0.22] }),
    n('rl',      'ratelimit', 0.44, 0.26, { portrait: [0.27, 0.38] }),
    n('cache',   'cache',     0.44, 0.74, { portrait: [0.73, 0.38] }),
    n('lb',      'lb',        0.58, 0.50, { portrait: [0.5, 0.54] }),
    n('s1',      'server',    0.72, 0.18, { label: 'Server 1', role: 'router', portrait: [0.27, 0.7] }),
    n('s2',      'server',    0.72, 0.82, { label: 'Server 2', role: 'router', portrait: [0.73, 0.7] }),
    n('pool',    'pooler',    0.89, 0.34, { portrait: [0.5, 0.85] }),
    n('db',      'db',        0.89, 0.66, { latency: 100, concurrency: 6, portrait: [0.5, 0.95] }),
  ],
  sections: [
    g('sec_edge', 'Edge',    0.19, 0.13, 0.32, 0.76, { tone: 'accent' }),
    g('sec_app',  'App tier', 0.53, 0.13, 0.28, 0.76, { tone: 'good' }),
    g('sec_data', 'Data',     0.82, 0.13, 0.16, 0.76, { tone: 'warn' }),
  ],
  edges: [
    e('client', 'gw'), e('gw', 'rl'), e('gw', 'cache'),
    e('rl', 'lb'), e('cache', 'lb'),
    e('lb', 's1'), e('lb', 's2'),
    e('s1', 'pool'), e('s2', 'pool'), e('pool', 'db'),
  ],
})

// A fresh board. Built by a factory rather than exported as a constant so each
// new canvas starts clean instead of inheriting whatever the last one became.
let untitled = 0
export function blankScene() {
  untitled += 1
  return scene({
    id: `board_${Date.now().toString(36)}`,
    title: untitled === 1 ? 'Untitled board' : `Untitled board ${untitled}`,
    caption: 'Drag objects from the palette, wire them with the ＋ handles, then press play.',
    nodes: [], edges: [], sections: [],
  })
}


// The board folding exists for. Twenty objects is what a modest microservice
// diagram costs; four cards is what it should look like until you ask about one
// of them. Double-click a service to open it.
//
// Positions are spaced for the card, not for the dot: a card is 168px wide and
// a folded one 193px, which on a 16:9 frame is ~0.19 of the width. Anything
// closer than that overlaps, and no amount of fitting saves it on a free board.
export const microservices = scene({
  id: 'microservices',
  title: 'Four services, one gateway',
  caption: 'Twenty objects folded into four cards. Double-click one to see inside it.',
  nodes: [
    n('client',  'client',  0.11, 0.50, { rps: 80, portrait: [0.5, 0.045] }),
    n('gateway', 'gateway', 0.34, 0.50, { portrait: [0.5, 0.135] }),

    n('cart_api',    'server', 0.49, 0.09, { label: 'Cart API', role: 'router' , portrait: [0.28, 0.25] }),
    n('cart_cache',  'cache',  0.69, 0.09, { portrait: [0.72, 0.25] }),
    n('cart_worker', 'worker', 0.49, 0.23, { role: 'router' , portrait: [0.28, 0.35] }),
    n('cart_db',     'db',     0.69, 0.23, { portrait: [0.72, 0.35] }),

    n('sms_api',    'server', 0.49, 0.31, { label: 'SMS API', role: 'router' , portrait: [0.28, 0.38] }),
    n('sms_q',      'queue',  0.69, 0.31, { portrait: [0.72, 0.38] }),
    n('sms_worker', 'worker', 0.49, 0.45, { role: 'router' , portrait: [0.28, 0.48] }),
    n('sms_db',     'db',     0.69, 0.45, { portrait: [0.72, 0.48] }),

    n('srch_api',    'server', 0.49, 0.53, { label: 'Search API', role: 'router' , portrait: [0.28, 0.51] }),
    n('srch_idx',    'search', 0.69, 0.53, { portrait: [0.72, 0.51] }),
    n('srch_q',      'queue',  0.49, 0.67, { portrait: [0.28, 0.61] }),
    n('srch_worker', 'worker', 0.69, 0.67, { portrait: [0.72, 0.61] }),

    n('auth_api',     'server',  0.49, 0.75, { label: 'Auth API', role: 'router' , portrait: [0.28, 0.64] }),
    n('auth_cache',   'cache',   0.69, 0.75, { portrait: [0.72, 0.64] }),
    n('auth_replica', 'replica', 0.49, 0.89, { portrait: [0.28, 0.74] }),
    n('auth_db',      'db',      0.69, 0.89, { portrait: [0.72, 0.74] }),

    n('metrics', 'topic', 0.90, 0.44, { portrait: [0.5, 0.83] }),
    n('logs',    'blob',  0.90, 0.62, { portrait: [0.5, 0.93] }),
  ],
  edges: [
    e('client', 'gateway'),
    // Two ways into the cart service: the read path and the background job.
    // Folded, they are one wire — which is the honest picture at that level.
    e('gateway', 'cart_api'), e('gateway', 'cart_worker'),
    e('gateway', 'sms_api'), e('gateway', 'srch_api'), e('gateway', 'auth_api'),
    e('cart_api', 'cart_cache'), e('cart_cache', 'cart_db'), e('cart_worker', 'metrics'),
    e('sms_api', 'sms_q'), e('sms_q', 'sms_worker'), e('sms_worker', 'sms_db'),
    e('srch_api', 'srch_idx'), e('srch_api', 'srch_q'), e('srch_q', 'srch_worker'),
    e('auth_api', 'auth_cache'), e('auth_cache', 'auth_db'), e('auth_api', 'auth_replica'),
    e('metrics', 'logs'),
  ],
  // A folded card sits on the centroid of its members, so these coordinates are
  // that centroid — authored, not guessed, so folding again never makes it jump.
  groups: [
    grp('cart', 'Cart Service', ['cart_api', 'cart_cache', 'cart_worker', 'cart_db'],
        { folded: true, x: 0.59, y: 0.16, portrait: [0.5, 0.30], tone: 'accent' }),
    grp('sms', 'SMS Service', ['sms_api', 'sms_q', 'sms_worker', 'sms_db'],
        { folded: true, x: 0.59, y: 0.38, portrait: [0.5, 0.43], tone: 'good' }),
    grp('srch', 'Search Service', ['srch_api', 'srch_idx', 'srch_q', 'srch_worker'],
        { folded: true, x: 0.59, y: 0.60, portrait: [0.5, 0.56], tone: 'warn' }),
    grp('auth', 'Auth Service', ['auth_api', 'auth_cache', 'auth_replica', 'auth_db'],
        { folded: true, x: 0.59, y: 0.82, portrait: [0.5, 0.69], tone: 'accent' }),
    grp('region', 'EU Region', ['cart', 'sms', 'srch', 'auth'], { x: 0.59, y: 0.49, portrait: [0.5, 0.495] }),
  ],
})


// The finding that made this feature worth building: retrying a failing
// dependency does not ride out the outage, it deepens it — every attempt is
// more load on the thing that is already drowning. The breaker is what turns
// that around, and you can watch it happen in one take.
export const retryStorm = scene({
  id: 'retry-storm',
  title: 'When retries make it worse',
  caption: 'A sick database, a gateway that retries, and the breaker that stops the pile-on.',
  nodes: [
    n('client', 'client',  0.10, 0.50, { rps: 60, portrait: [0.5, 0.10] }),
    n('gw',     'gateway', 0.33, 0.50, { concurrency: 40, portrait: [0.5, 0.34],
        retry: { max: 3, backoff: 120 },
        breaker: { threshold: 0.5, window: 1800, resetAfter: 1500, min: 6 } }),
    n('api',    'server',  0.57, 0.50, { role: 'router', concurrency: 24, portrait: [0.5, 0.58] }),
    n('db',     'db',      0.82, 0.50, { concurrency: 12, portrait: [0.5, 0.84] }),
  ],
  edges: [e('client', 'gw'), e('gw', 'api'), e('api', 'db')],
  steps: [
    { duration: 2400, label: 'Steady state', traffic: { client: 60 },
      annotations: [{ type: 'callout', at: 'db', text: 'Healthy. Everything comes back.', tone: 'good' }] },
    { duration: 3000, label: 'The database goes bad', traffic: { client: 60 }, degraded: ['db'],
      annotations: [{ type: 'callout', at: 'db', text: 'Six times slower. A third of calls fail.', tone: 'warn' }] },
    { duration: 3000, label: 'Retries pile on', traffic: { client: 60 }, degraded: ['db'], focus: ['gw', 'api', 'db'],
      annotations: [{ type: 'callout', at: 'db', text: 'More load than the client sends.', tone: 'bad' }] },
    { duration: 3000, label: 'The breaker trips', traffic: { client: 60 }, degraded: ['db'], focus: ['gw', 'api'],
      annotations: [{ type: 'callout', at: 'gw', text: 'It stops calling. Load collapses.', tone: 'accent' }] },
    { duration: 4200, label: 'Recovered', traffic: { client: 60 },
      annotations: [{ type: 'callout', at: 'gw', text: 'One probe gets through. It closes.', tone: 'good' }] },
  ],
})

// A primary and a replica are only two boxes until the requests know which of
// them they are for.
export const readWrite = scene({
  id: 'read-write',
  title: 'Reads one way, writes the other',
  caption: 'Thirty percent writes. They all funnel to the one primary; the reads spread out.',
  nodes: [
    n('client',  'client',  0.11, 0.50, { rps: 70, writeRatio: 0.3, portrait: [0.5, 0.08] }),
    n('lb',      'lb',      0.35, 0.50, { concurrency: 40, portrait: [0.5, 0.26] }),
    n('primary', 'primary', 0.64, 0.20, { portrait: [0.5, 0.48] }),
    n('r1',      'replica', 0.64, 0.50, { label: 'Replica 1', portrait: [0.28, 0.72] }),
    n('r2',      'replica', 0.64, 0.80, { label: 'Replica 2', portrait: [0.72, 0.72] }),
  ],
  edges: [e('client', 'lb'), e('lb', 'primary'), e('lb', 'r1'), e('lb', 'r2')],
})

// Async is the difference between "the gateway called the service" and "the
// gateway dropped a job and walked away", and those are not the same diagram.
export const fireAndForget = scene({
  id: 'fire-and-forget',
  title: 'Fire and forget',
  caption: 'The caller is answered at the broker. The slow work happens behind it, and the lag shows.',
  nodes: [
    n('client', 'client',  0.09, 0.50, { rps: 90, portrait: [0.5, 0.07] }),
    n('api',    'gateway', 0.30, 0.50, { concurrency: 40, portrait: [0.5, 0.25] }),
    n('bus',    'broker',  0.56, 0.50, { maxQueue: 4000, portrait: [0.5, 0.45] }),
    // Two consumers at 40/s against 90/s arriving: they fall behind steadily
    // rather than falling over, which is what lag looks like.
    n('w1', 'worker', 0.82, 0.30, { label: 'Worker 1', latency: 150, concurrency: 6, maxQueue: 600, portrait: [0.28, 0.70] }),
    n('w2', 'worker', 0.82, 0.70, { label: 'Worker 2', latency: 150, concurrency: 6, maxQueue: 600, portrait: [0.72, 0.70] }),
  ],
  edges: [
    e('client', 'api'),
    e('api', 'bus', { async: true, protocol: 'AMQP', label: 'async' }),
    e('bus', 'w1'), e('bus', 'w2'),
  ],
})

// The ten-second single-page take that folding was built for: three services as
// three cards, then one of them opens.
export const insideOne = scene({
  id: 'inside-one',
  title: 'Inside one service',
  caption: 'Three services, one gateway. Then one of them opens up.',
  nodes: [
    n('client', 'client',  0.10, 0.50, { rps: 70, portrait: [0.5, 0.05] }),
    n('gw',     'gateway', 0.30, 0.50, { concurrency: 40, portrait: [0.5, 0.15] }),

    n('ord_api',   'server', 0.52, 0.11, { label: 'Orders API', role: 'router', portrait: [0.28, 0.27] }),
    n('ord_cache', 'cache',  0.72, 0.11, { portrait: [0.72, 0.27] }),
    n('ord_q',     'queue',  0.52, 0.25, { portrait: [0.28, 0.37] }),
    n('ord_db',    'db',     0.72, 0.25, { portrait: [0.72, 0.37] }),

    n('pay_api',    'server', 0.52, 0.43, { label: 'Payments API', role: 'router', portrait: [0.28, 0.50] }),
    n('pay_cache',  'cache',  0.72, 0.43, { portrait: [0.72, 0.50] }),
    n('pay_worker', 'worker', 0.52, 0.57, { portrait: [0.28, 0.60] }),
    n('pay_db',     'db',     0.72, 0.57, { portrait: [0.72, 0.60] }),

    n('ship_api',    'server', 0.52, 0.75, { label: 'Shipping API', role: 'router', portrait: [0.28, 0.73] }),
    n('ship_q',      'queue',  0.72, 0.75, { portrait: [0.72, 0.73] }),
    n('ship_worker', 'worker', 0.52, 0.89, { portrait: [0.28, 0.83] }),
    n('ship_db',     'db',     0.72, 0.89, { portrait: [0.72, 0.83] }),
  ],
  edges: [
    e('client', 'gw'),
    e('gw', 'ord_api'), e('gw', 'pay_api'), e('gw', 'ship_api'),
    e('ord_api', 'ord_cache'), e('ord_cache', 'ord_db'), e('ord_api', 'ord_q'),
    e('pay_api', 'pay_cache'), e('pay_cache', 'pay_db'), e('pay_api', 'pay_worker'),
    e('ship_api', 'ship_q'), e('ship_q', 'ship_worker'), e('ship_worker', 'ship_db'),
  ],
  groups: [
    grp('ord', 'Orders', ['ord_api', 'ord_cache', 'ord_q', 'ord_db'],
        { folded: true, x: 0.62, y: 0.18, portrait: [0.5, 0.32], tone: 'accent' }),
    grp('pay', 'Payments', ['pay_api', 'pay_cache', 'pay_worker', 'pay_db'],
        { folded: true, x: 0.62, y: 0.50, portrait: [0.5, 0.55], tone: 'good' }),
    grp('ship', 'Shipping', ['ship_api', 'ship_q', 'ship_worker', 'ship_db'],
        { folded: true, x: 0.62, y: 0.82, portrait: [0.5, 0.78], tone: 'warn' }),
  ],
  steps: [
    { duration: 3000, label: 'Three services', traffic: { client: 70 }, expand: [],
      annotations: [{ type: 'callout', at: 'gw', text: 'Three services. Twelve objects.', tone: 'dim' }] },
    { duration: 4000, label: 'Open the orders service', traffic: { client: 70 }, expand: ['ord'],
      focus: ['ord_api', 'ord_cache', 'ord_db', 'ord_q', 'gw'],
      annotations: [{ type: 'callout', at: 'ord_db', text: 'A cache in front, a queue behind.', tone: 'accent' }] },
    { duration: 3000, label: 'Fold it back', traffic: { client: 70 }, expand: [],
      annotations: [{ type: 'callout', at: 'gw', text: 'Same numbers either way.', tone: 'good' }] },
  ],
})

export const SCENES = [request, overload, loadbalancer, replicas, readWrite,
                       fireAndForget, retryStorm, microservices, queue, sandbox]

// ---------------------------------------------------------------------------
// A timeline scene. The topology below holds every node the story will ever
// need; each step then declares which slice of it is on screen, who is sending,
// and what is dead. Servers are routers here so that once the database appears
// in the last step, traffic keeps going instead of stopping at them.

export const scaleStory = {
  id: 'scale_story',
  autoLayout: true,   // positions come from the live edges of each step
  title: 'From one server to a bottleneck',
  caption: 'A six-step story. Use ‹ › to step through it by hand.',
  watermark: 'Visualizcy',
  nodes: [
    n('client', 'client', 0.13, 0.5,  { rps: 20,          portrait: [0.5, 0.1] }),
    n('lb',     'lb',     0.38, 0.5,  {                   portrait: [0.5, 0.3] }),
    n('s1',     'server', 0.63, 0.22, { role: 'router', label: 'Server 1', portrait: [0.28, 0.52] }),
    n('s2',     'server', 0.63, 0.5,  { role: 'router', label: 'Server 2', portrait: [0.5,  0.64] }),
    n('s3',     'server', 0.63, 0.78, { role: 'router', label: 'Server 3', portrait: [0.72, 0.52] }),
    n('db',     'db',     0.88, 0.5,  { portrait: [0.5, 0.88] }),
  ],
  edges: [
    e('client', 'lb'), e('client', 's1'),
    e('lb', 's1'), e('lb', 's2'), e('lb', 's3'),
    e('s1', 'db'), e('s2', 'db'), e('s3', 'db'),
  ],
  steps: [
    {
      label: 'Step one · the shape',
      note: 'One client, one server. Twenty requests a second, and forty of capacity. Nothing is wrong yet.',
      duration: 4200,
      show: ['client', 's1'],
      edges: ['client>s1'],
      traffic: { client: 20 },
      annotations: [
        { type: 'callout', at: 's1', side: 'right', tone: 'good',
          text: 'Forty requests a second before this one starts refusing work.' },
      ],
    },
    {
      label: 'Traffic triples',
      gutter: 0.33,
      note: 'Same server, seventy requests a second arriving. Watch the meter fill and the border go red.',
      duration: 4600,
      show: ['client', 's1'],
      edges: ['client>s1'],
      traffic: { client: 70 },
      focus: ['s1'],
      annotations: [
        { type: 'stat', value: 70, tone: 'bad', size: 38,
          label: 'arriving every second', key: 'in' },
        { type: 'stat', value: 40, tone: 'dim', size: 38,
          label: 'it can actually take', key: 'cap' },
        { type: 'bar', width: 200, label: 'the rest is dropped',
          parts: [{ value: 40, tone: 'good' }, { value: 30, tone: 'bad' }] },
        { type: 'note', width: 210, tone: 'dim',
          text: 'Nothing crashed. It just stopped answering thirty people a second.' },
      ],
    },
    {
      label: 'Spread the load',
      gutter: 0.3,
      note: 'A load balancer and two more servers. The same seventy, now round-robined into three shares of twenty-three.',
      duration: 4600,
      show: ['client', 'lb', 's1', 's2', 's3'],
      edges: ['client>lb', 'lb>s1', 'lb>s2', 'lb>s3'],
      traffic: { client: 70 },
      clearPackets: true,
      annotations: [
        { type: 'bracket', nodes: ['s1', 's2', 's3'], tone: 'good',
          text: 'three shares of twenty-three' },
        { type: 'note', width: 240, tone: 'dim',
          text: 'Same seventy. Nobody is near their limit now.' },
      ],
    },
    {
      label: 'Lose one',
      gutter: 0.33,
      note: 'Server 2 dies. The other two pick up its share and the system does not notice.',
      duration: 4200,
      show: ['client', 'lb', 's1', 's2', 's3'],
      edges: ['client>lb', 'lb>s1', 'lb>s2', 'lb>s3'],
      traffic: { client: 70 },
      dead: ['s2'],
      annotations: [
        { type: 'callout', at: 's2', side: 'right', tone: 'bad', dy: 0,
          text: 'Gone. Its share is redistributed on the next request.' },
        { type: 'stat', value: 35, tone: 'good', size: 34,
          label: 'each of the survivors', key: 'each' },
        { type: 'note', width: 200, tone: 'dim',
          text: 'Still under forty. Nobody outside notices anything happened.' },
      ],
    },
    {
      label: 'Lose another',
      gutter: 0.33,
      note: 'Now one server is carrying all seventy. This is the same failure as step two, just further along.',
      duration: 4400,
      show: ['client', 'lb', 's1', 's2', 's3'],
      edges: ['client>lb', 'lb>s1', 'lb>s2', 'lb>s3'],
      traffic: { client: 70 },
      dead: ['s2', 's3'],
      focus: ['client', 'lb', 's1'],
      annotations: [
        { type: 'stat', value: 70, tone: 'bad', size: 38,
          label: 'onto one server again', key: 'all' },
        { type: 'note', width: 210, tone: 'dim',
          text: 'This is step two wearing a load balancer. Spreading load buys you headroom, not immunity.' },
      ],
    },
    {
      label: 'The real bottleneck',
      gutter: 0.33,
      note: 'All three servers healthy again, and every one of them still writes to a single database with thirty of capacity.',
      duration: 5200,
      show: ['client', 'lb', 's1', 's2', 's3', 'db'],
      edges: ['client>lb', 'lb>s1', 'lb>s2', 'lb>s3', 's1>db', 's2>db', 's3>db'],
      traffic: { client: 70 },
      clearPackets: true,
      focus: ['db'],
      annotations: [
        { type: 'callout', at: 'db', side: 'left', tone: 'bad', width: 180,
          text: 'Thirty of capacity. Seventy arriving. Every server you added ends here.' },
        { type: 'note', width: 230, tone: 'warn',
          text: 'You can add servers all day. The bottleneck just moved.' },
      ],
    },
  ],
}

SCENES.push(scaleStory)

// ---------------------------------------------------------------------------
// A slots scene. No nodes, no edges, no simulation — just cells whose contents
// change per step. Position 0 is the most recently used; the last position is
// whatever gets evicted next.

const cell = (text, sub, tone) => (text ? { text, sub, tone } : null)

export const lru = scene({
  id: 'lru',
  kind: 'slots',
  title: 'LRU: what gets evicted',
  caption: 'Five slots, and a rule about which one loses.',
  watermark: 'Visualizcy',
  slots: { count: 5, label: 'Cache', cellWidth: 96, cellHeight: 66 },
  steps: [
    {
      label: 'Five slots',
      note: 'An empty cache. Every read that misses will put something here.',
      duration: 3400,
      cells: [],
      pointers: [{ at: 0, text: 'most recent' }, { at: 4, text: 'next to evict' }],
    },
    {
      label: 'Three reads',
      note: 'A, then B, then C. Each new read goes to the front, so the order is the reverse of how you asked.',
      duration: 4200,
      cells: [cell('C', 'just now', 'good'), cell('B', '1s ago'), cell('A', '2s ago')],
      pointers: [{ at: 0, text: 'most recent' }, { at: 4, text: 'next to evict' }],
    },
    {
      label: 'Now it is full',
      note: 'D and E arrive. Five slots, five values, and A has drifted to the far end.',
      duration: 4200,
      cells: [cell('E', 'just now', 'good'), cell('D', '1s ago'), cell('C', '2s ago'),
              cell('B', '3s ago'), cell('A', '4s ago', 'warn')],
      pointers: [{ at: 0, text: 'most recent' }, { at: 4, text: 'next to evict' }],
      gutter: 0.28,
      annotations: [
        { type: 'note', width: 200, tone: 'dim',
          text: 'Nothing has been evicted yet. A is simply the one with the most to lose.' },
      ],
    },
    {
      label: 'Read B again',
      note: 'B was fourth. Reading it moves it to the front, and everything it passed slides down one.',
      duration: 4400,
      cells: [cell('B', 'just now', 'accent'), cell('E', '1s ago'), cell('D', '2s ago'),
              cell('C', '3s ago'), cell('A', '5s ago', 'warn')],
      pointers: [{ at: 0, text: 'moved here' }, { at: 4, text: 'next to evict' }],
      gutter: 0.28,
      annotations: [
        { type: 'note', width: 200, tone: 'dim',
          text: 'This is the whole algorithm. Use something, and it stops being the candidate.' },
      ],
    },
    {
      label: 'F arrives',
      note: 'The cache is full and F is new. Something has to go, and the rule already decided which.',
      duration: 5000,
      cells: [cell('F', 'just now', 'good'), cell('B', '1s ago'), cell('E', '2s ago'),
              cell('D', '3s ago'), cell('C', '4s ago')],
      pointers: [{ at: 0, text: 'new' }, { at: 4, text: 'next to evict' }],
      gutter: 0.28,
      annotations: [
        { type: 'stat', value: 1, tone: 'bad', size: 34,
          label: 'evicted: A', key: 'ev' },
        { type: 'note', width: 200, tone: 'warn',
          text: 'A was not the oldest thing you stored. It was the oldest thing you used.' },
      ],
    },
  ],
})

SCENES.push(insideOne)
SCENES.push(lru)
SCENES.push(captcha)
SCENES.push(captchaShort)
