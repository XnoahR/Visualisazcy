import { scene, node as n, edge as e } from '../src/scene.js'

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

export const SCENES = [request, overload, loadbalancer, replicas, queue]

// ---------------------------------------------------------------------------
// A timeline scene. The topology below holds every node the story will ever
// need; each step then declares which slice of it is on screen, who is sending,
// and what is dead. Servers are routers here so that once the database appears
// in the last step, traffic keeps going instead of stopping at them.

export const scaleStory = {
  id: 'scale_story',
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
    },
    {
      label: 'Traffic triples',
      note: 'Same server, seventy requests a second arriving. Watch the meter fill and the border go red.',
      duration: 4600,
      show: ['client', 's1'],
      edges: ['client>s1'],
      traffic: { client: 70 },
    },
    {
      label: 'Spread the load',
      note: 'A load balancer and two more servers. The same seventy, now round-robined into three shares of twenty-three.',
      duration: 4600,
      show: ['client', 'lb', 's1', 's2', 's3'],
      edges: ['client>lb', 'lb>s1', 'lb>s2', 'lb>s3'],
      traffic: { client: 70 },
      clearPackets: true,
    },
    {
      label: 'Lose one',
      note: 'Server 2 dies. The other two pick up its share and the system does not notice.',
      duration: 4200,
      show: ['client', 'lb', 's1', 's2', 's3'],
      edges: ['client>lb', 'lb>s1', 'lb>s2', 'lb>s3'],
      traffic: { client: 70 },
      dead: ['s2'],
    },
    {
      label: 'Lose another',
      note: 'Now one server is carrying all seventy. This is the same failure as step two, just further along.',
      duration: 4400,
      show: ['client', 'lb', 's1', 's2', 's3'],
      edges: ['client>lb', 'lb>s1', 'lb>s2', 'lb>s3'],
      traffic: { client: 70 },
      dead: ['s2', 's3'],
    },
    {
      label: 'The real bottleneck',
      note: 'All three servers healthy again, and every one of them still writes to a single database with thirty of capacity.',
      duration: 5200,
      show: ['client', 'lb', 's1', 's2', 's3', 'db'],
      edges: ['client>lb', 'lb>s1', 'lb>s2', 'lb>s3', 's1>db', 's2>db', 's3>db'],
      traffic: { client: 70 },
      clearPackets: true,
    },
  ],
}

SCENES.push(scaleStory)
