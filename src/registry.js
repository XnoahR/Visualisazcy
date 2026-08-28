// Node types. Three fields drive the whole simulation:
//   role     — source spawns traffic, router forwards it, sink consumes it
//   capacity — requests/sec this node can absorb before it starts dropping
//   color    — its identity everywhere (badge, wire tint, packet)

export const NODE_TYPES = {
  client: {
    name: 'Client', subtitle: 'User device', icon: 'WEB',
    color: '#6ea8ff', role: 'source', capacity: Infinity,
    hint: 'Sends incoming requests',
  },
  dns: {
    name: 'DNS Resolver', subtitle: 'Recursive', icon: 'DNS',
    color: '#06b6d4', role: 'router', capacity: 10000,
    hint: 'Turns a name into an address',
  },
  edge: {
    name: 'Edge / CDN', subtitle: 'Near the user', icon: 'EDGE',
    color: '#14b8a6', role: 'router', capacity: 5000,
    hint: 'Caches static assets globally',
  },
  lb: {
    name: 'Load Balancer', subtitle: 'Routes traffic', icon: 'ALB',
    color: '#8b5cf6', role: 'router', capacity: 1000,
    hint: 'Fans traffic out to backends',
  },
  server: {
    name: 'App Server', subtitle: 'Application', icon: 'EC2',
    color: '#22c55e', role: 'sink', capacity: 40,
    hint: 'Runs your application code',
  },
  cache: {
    name: 'Cache', subtitle: 'In-memory', icon: 'CACHE',
    color: '#f59e0b', role: 'router', capacity: 500,
    hint: 'Holds recent answers in RAM',
  },
  db: {
    name: 'Database', subtitle: 'Persistent', icon: 'RDS',
    color: '#ec4899', role: 'sink', capacity: 30,
    hint: 'Disk-backed storage, and slow',
  },
  replica: {
    name: 'Read Replica', subtitle: 'Reads only', icon: 'RDS',
    color: '#f472b6', role: 'sink', capacity: 40,
    hint: 'Read-only copy of the primary',
  },
  queue: {
    name: 'Message Queue', subtitle: 'Buffered work', icon: 'QUEUE',
    color: '#a78bfa', role: 'router', capacity: 10000,
    hint: 'Absorbs spikes so workers never drown',
  },
  worker: {
    name: 'Worker', subtitle: 'Background job', icon: 'JOB',
    color: '#34d399', role: 'sink', capacity: 25,
    hint: 'Drains the queue at its own pace',
  },
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
