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
    accepts: 'read',
    hint: 'Read-only copy of the primary — reads route here, writes never do',
  },
  primary: {
    name: 'Write Primary', short: 'Primary', subtitle: 'Takes writes', icon: 'PRI',
    color: '#db2777', role: 'sink', latency: 110, concurrency: 2,
    effect: 'disk', accepts: 'write',
    hint: 'The single writer. Every write funnels here, which is why it runs out first',
  },
  queue: {
    name: 'Message Queue', short: 'Queue', subtitle: 'Buffered work', icon: 'QUEUE',
    color: '#a78bfa', role: 'router', latency: 1, concurrency: 10,
    effect: 'depth', asyncIn: true,
    hint: 'Absorbs spikes so workers never drown',
  },
  broker: {
    name: 'Message Broker', short: 'Broker', subtitle: 'Partitioned log', icon: 'MSK',
    color: '#7c3aed', role: 'router', latency: 2, concurrency: 30,
    effect: 'depth', asyncIn: true, partitions: 6,
    hint: 'A durable partitioned log. Consumers read at their own pace, and the gap is lag',
  },
  stream: {
    name: 'Stream Processor', short: 'Stream', subtitle: 'Windowed', icon: 'STRM',
    color: '#22d3ee', role: 'router', latency: 20, concurrency: 6,
    hint: 'Reads a log continuously and writes derived results',
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
  session_store: {
    name: 'Session Store', short: 'Sessions', subtitle: 'Hot, tiny', icon: 'SESS',
    color: '#fb923c', role: 'sink', latency: 3, concurrency: 12,
    hint: 'Who is logged in. Small, and on the path of every single request',
  },
  coordinator: {
    name: 'Coordinator', short: 'Consensus', subtitle: 'Quorum', icon: 'ETCD',
    color: '#2dd4bf', role: 'sink', latency: 15, concurrency: 5,
    hint: 'Leader election and config. Slow on purpose — it votes before it answers',
  },
  waf: {
    name: 'WAF / Firewall', short: 'WAF', subtitle: 'Filters traffic', icon: 'WAF',
    color: '#ef4444', role: 'router', latency: 3, concurrency: 20,
    hint: 'Drops the obviously bad before it costs you anything',
  },
  mesh: {
    name: 'Sidecar Proxy', short: 'Sidecar', subtitle: 'Service mesh', icon: 'MESH',
    color: '#38bdf8', role: 'router', latency: 1, concurrency: 40,
    hint: 'mTLS, retries and telemetry lifted out of your code',
  },
  cron: {
    name: 'Scheduler', short: 'Cron', subtitle: 'On a timer', icon: 'CRON',
    color: '#84cc16', role: 'source', latency: 0, concurrency: Infinity,
    hint: 'Emits work on a schedule instead of because someone asked',
  },
  // A blank object. Everything about it is meant to be overridden per instance:
  // name, badge, colour, role and numbers. The defaults are deliberately
  // unremarkable so an unedited one reads as "not filled in yet".
  custom: {
    name: 'Custom', short: 'Custom', subtitle: 'Your own', icon: 'NEW',
    color: '#94a3b8', role: 'router', latency: 10, concurrency: 4,
    hint: 'A blank object — rename it, recolour it, give it your own numbers',
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

// Failure and resilience. All optional, all off unless a scene or the inspector
// asks for them — a diagram that fails by default would be lying just as loudly
// as one that never fails.
export const failureOf = node => node.spec?.failureRate ?? typeOf(node).failureRate ?? 0

// A degraded node is not a dead one. It answers, slowly and unreliably, which is
// the failure that actually happens and the one a diagram never shows.
export const DEGRADE_LATENCY = 6
export const DEGRADE_FAILURE = 0.35

export function retryOf(node) {
  const r = node.spec?.retry ?? typeOf(node).retry
  if (!r) return null
  return { max: r.max ?? 2, backoff: r.backoff ?? 100, jitter: r.jitter ?? 0.2 }
}

// Closed → open when too many recent calls fail; open → half after resetAfter;
// half lets exactly one probe through and its result decides. `min` exists so a
// single unlucky call cannot trip a breaker.
export function breakerOf(node) {
  const b = node.spec?.breaker ?? typeOf(node).breaker
  if (!b) return null
  return {
    threshold: b.threshold ?? 0.5, window: b.window ?? 2000,
    resetAfter: b.resetAfter ?? 3000, min: b.min ?? 5,
  }
}

// Which requests a node will take. A replica refuses writes; a primary is where
// they all end up. Null means it does not care.
export const acceptsOf = node => node.spec?.accepts ?? typeOf(node).accepts ?? null

// Edges carry properties too, which is half of what a diagram says and all of
// what ours could not say before.
export const EDGE_PROTOCOLS = ['HTTP', 'gRPC', 'TCP', 'WebSocket', 'AMQP', 'SQL', 'internal']

export function declaredOf(node) {
  const out = []
  for (const k of DECLARED) {
    const v = node.spec?.[k] ?? typeOf(node)[k]
    if (v != null && v !== '') out.push(String(v))
  }
  return out
}

// Appearance can be overridden per instance, which is what makes one `custom`
// type enough: two custom objects are two sets of overrides, not two types.
// Every reader goes through these, so a scene, the palette and the card can
// never disagree about what something looks like.
const HEX = /^#[0-9a-fA-F]{6}$/

export function colorOf(node) {
  const c = node.spec?.color
  // A bad colour from hand-edited JSON would reach withAlpha() and paint NaN,
  // so it falls back rather than failing.
  return HEX.test(c || '') ? c : typeOf(node).color
}

export const iconOf = node =>
  String(node.spec?.icon ?? typeOf(node).icon).slice(0, 4).toUpperCase()

export const subtitleOf = node => node.spec?.subtitle ?? typeOf(node).subtitle

export const APPEARANCE = ['icon', 'color', 'subtitle']

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
