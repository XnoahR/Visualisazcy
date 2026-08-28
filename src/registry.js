// Node types. Three fields drive the whole simulation:
//   role     — source spawns traffic, router forwards it, sink consumes it
//   capacity — requests/sec this node can absorb before it starts dropping
//   color    — its identity everywhere (badge, wire tint, packet)

export const NODE_TYPES = {
  client: {
    name: 'Client', subtitle: 'User device', icon: 'WEB',
    color: '#6ea8ff', role: 'source', latency: 0, concurrency: Infinity,
    hint: 'Sends incoming requests',
  },
  dns: {
    name: 'DNS Resolver', short: 'DNS', subtitle: 'Recursive', icon: 'DNS',
    color: '#06b6d4', role: 'router', latency: 1, concurrency: 10,
    hint: 'Turns a name into an address',
  },
  edge: {
    name: 'Edge / CDN', short: 'Edge', subtitle: 'Near the user', icon: 'EDGE',
    color: '#14b8a6', role: 'router', latency: 2, concurrency: 10,
    effect: 'globe', hitRate: 0.9,
    hint: 'Caches static assets globally',
  },
  lb: {
    name: 'Load Balancer', short: 'Balancer', subtitle: 'Routes traffic', icon: 'ALB',
    color: '#8b5cf6', role: 'router', latency: 2, concurrency: 2,
    effect: 'rr',
    hint: 'Fans traffic out to backends',
  },
  server: {
    name: 'App Server', short: 'Server', subtitle: 'Application', icon: 'EC2',
    color: '#22c55e', role: 'sink', latency: 25, concurrency: 1,
    hint: 'Runs your application code',
  },
  cache: {
    name: 'Cache', subtitle: 'In-memory', icon: 'CACHE',
    color: '#f59e0b', role: 'router', latency: 2, concurrency: 1,
    effect: 'hitrate', hitRate: 0.8,
    hint: 'Holds recent answers in RAM',
  },
  db: {
    name: 'Database', subtitle: 'Persistent', icon: 'RDS',
    color: '#ec4899', role: 'sink', latency: 100, concurrency: 3,
    effect: 'disk',
    hint: 'Disk-backed storage, and slow',
  },
  replica: {
    name: 'Read Replica', short: 'Replica', subtitle: 'Reads only', icon: 'RDS',
    color: '#f472b6', role: 'sink', latency: 75, concurrency: 3,
    hint: 'Read-only copy of the primary',
  },
  queue: {
    name: 'Message Queue', short: 'Queue', subtitle: 'Buffered work', icon: 'QUEUE',
    color: '#a78bfa', role: 'router', latency: 1, concurrency: 10,
    effect: 'depth',
    hint: 'Absorbs spikes so workers never drown',
  },
  gateway: {
    name: 'API Gateway', short: 'Gateway', subtitle: 'Entry point', icon: 'GW',
    color: '#f97316', role: 'router', latency: 2, concurrency: 6,
    effect: 'fan',
    hint: 'Terminates TLS and routes by path',
  },
  ratelimit: {
    name: 'Rate Limiter', short: 'Limiter', subtitle: 'Token bucket', icon: 'RATE',
    color: '#fbbf24', role: 'router', latency: 1, concurrency: 1,
    effect: 'bucket', burst: 20, rateLimit: 60,
    hint: 'Refills at capacity per second; the bucket is your burst',
  },
  pooler: {
    name: 'Conn Pooler', short: 'Pooler', subtitle: 'Pooled clients', icon: 'POOL',
    color: '#60a5fa', role: 'router', latency: 20, concurrency: 8,
    effect: 'slots', slots: 8,
    hint: 'A fixed set of connections shared by everyone',
  },
  blob: {
    name: 'Object Store', short: 'Blobs', subtitle: 'Blobs, cold', icon: 'S3',
    color: '#94a3b8', role: 'sink', latency: 40, concurrency: 8,
    effect: 'disk',
    hint: 'Cheap, large, and slower than you remember',
  },
  search: {
    name: 'Search Index', short: 'Index', subtitle: 'Inverted index', icon: 'IDX',
    color: '#c084fc', role: 'sink', latency: 25, concurrency: 3,
    effect: 'disk',
    hint: 'Fast to read, expensive to write',
  },
  topic: {
    name: 'Pub/Sub Topic', short: 'Topic', subtitle: 'Fan-out', icon: 'TOPIC',
    color: '#818cf8', role: 'router', latency: 1, concurrency: 20,
    effect: 'fan',
    hint: 'Every subscriber gets a copy',
  },
  worker: {
    name: 'Worker', subtitle: 'Background job', icon: 'JOB',
    color: '#34d399', role: 'sink', latency: 120, concurrency: 3,
    hint: 'Drains the queue at its own pace',
  },
}

// Capacity is no longer declared, it is derived. Little's Law: a node serving
// `concurrency` requests at `latency` each can sustain concurrency/latency per
// second, and nothing you type can contradict that. A rate limiter is the one
// exception — its ceiling is a policy it applies while sitting idle, so it
// carries `rateLimit` on top of the physical model rather than instead of it.
export function capacityOf(node) {
  const def = typeOf(node)
  const lat = node.spec?.latency ?? def.latency
  const con = node.spec?.concurrency ?? def.concurrency
  const physical = !lat ? Infinity : con / (lat / 1000)
  const policy = node.spec?.rateLimit ?? def.rateLimit
  return policy != null ? Math.min(physical, policy) : physical
}

// Declared facts. These describe the architecture but change nothing in the
// simulation, so they are rendered differently — dim mono, no meter — and never
// sit next to a measured number as if they were one. Mixing the two is how a
// diagram starts lying.
export const DECLARED = ['tech', 'storage', 'region', 'instances', 'cost']

export function declaredOf(node) {
  const out = []
  for (const k of DECLARED) {
    const v = node.spec?.[k] ?? typeOf(node)[k]
    if (v != null && v !== '') out.push(String(v))
  }
  return out
}

export function typeOf(node) {
  const def = NODE_TYPES[node.type]
  if (!def) throw new Error(`unknown node type: ${node.type}`)
  return def
}

// A scene may override a type's role (an App Server is a sink in one topology
// and a router in another), so always ask through this.
export function roleOf(node) {
  return node.spec?.role ?? typeOf(node).role
}

// Plug rules. A source only gives, a sink only receives, a router does both —
// so the role a scene already declares is also the wiring contract.
export const canGive = node => roleOf(node) !== 'sink'
export const canReceive = node => roleOf(node) !== 'source'

// Why a proposed connection is not allowed, or null if it is.
export function connectionError(from, to, edges) {
  if (!from || !to) return 'no target'
  if (from.id === to.id) return 'a node cannot feed itself'
  if (!canGive(from)) return `${typeOf(from).name} only receives`
  if (!canReceive(to)) return `${typeOf(to).name} only sends`
  if (edges.some(e => e.from === from.id && e.to === to.id)) return 'already connected'
  return null
}
