import { scene, node as n, edge as e, section as g } from '../src/scene.js'

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
    n('api',    'server', 0.34, 0.5,  { role: 'router', label: 'API', capacity: 2000, portrait: [0.5, 0.3] }),
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
    n('client',  'client',    0.09, 0.5,  { rps: 120, portrait: [0.5, 0.08] }),
    n('gw',      'gateway',   0.26, 0.5,  { portrait: [0.5, 0.22] }),
    n('rl',      'ratelimit', 0.42, 0.26, { portrait: [0.27, 0.38] }),
    n('cache',   'cache',     0.42, 0.74, { portrait: [0.73, 0.38] }),
    n('lb',      'lb',        0.58, 0.5,  { portrait: [0.5, 0.54] }),
    n('s1',      'server',    0.74, 0.28, { label: 'Server 1', role: 'router', portrait: [0.27, 0.7] }),
    n('s2',      'server',    0.74, 0.72, { label: 'Server 2', role: 'router', portrait: [0.73, 0.7] }),
    n('pool',    'pooler',    0.88, 0.5,  { portrait: [0.5, 0.85] }),
    n('db',      'db',        0.97, 0.5,  { capacity: 60, portrait: [0.5, 0.95] }),
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

export const SCENES = [request, overload, loadbalancer, replicas, queue, sandbox]

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
    n('db',     'db',     0.88, 0.5,  { capacity: 30,     portrait: [0.5, 0.88] }),
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

SCENES.push(lru)
