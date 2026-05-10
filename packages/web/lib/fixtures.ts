// Fixture data returned when NEAT_DEMO=1 and core is unreachable.
// Represents a realistic microservices graph for standalone frontend dev.

export const FIXTURE_GRAPH = {
  nodes: [
    { id: 'service:checkout', type: 'ServiceNode', name: 'checkout', language: 'TypeScript', version: '2.4.1' },
    { id: 'service:payments', type: 'ServiceNode', name: 'payments', language: 'Go', version: '1.2.0' },
    { id: 'service:auth', type: 'ServiceNode', name: 'auth', language: 'TypeScript', version: '3.0.0' },
    { id: 'service:api-gateway', type: 'ServiceNode', name: 'api/gateway', language: 'TypeScript', version: '1.0.5' },
    { id: 'service:notifications', type: 'ServiceNode', name: 'notifications', language: 'Python', version: '1.1.0' },
    { id: 'database:payments-db.internal', type: 'DatabaseNode', name: 'payments-db', host: 'payments-db.internal', port: '5432', engine: 'postgresql', engineVersion: '15.2' },
    { id: 'database:auth-db.internal', type: 'DatabaseNode', name: 'auth-db', host: 'auth-db.internal', port: '5432', engine: 'postgresql', engineVersion: '14.8' },
    { id: 'infra:redis:cache.internal', type: 'InfraNode', name: 'cache', kind: 'cache', host: 'cache.internal', port: '6379' },
  ],
  edges: [
    { id: 'CALLS:OBSERVED:service:api-gateway->service:checkout', source: 'service:api-gateway', target: 'service:checkout', type: 'CALLS', provenance: 'OBSERVED', confidence: 1.0, callCount: 42891 },
    { id: 'CALLS:OBSERVED:service:api-gateway->service:auth', source: 'service:api-gateway', target: 'service:auth', type: 'CALLS', provenance: 'OBSERVED', confidence: 1.0, callCount: 18204 },
    { id: 'CALLS:OBSERVED:service:checkout->service:payments', source: 'service:checkout', target: 'service:payments', type: 'CALLS', provenance: 'OBSERVED', confidence: 1.0, callCount: 9341 },
    { id: 'CALLS:EXTRACTED:service:checkout->service:notifications', source: 'service:checkout', target: 'service:notifications', type: 'CALLS', provenance: 'EXTRACTED', confidence: 0.9 },
    { id: 'CONNECTS_TO:OBSERVED:service:payments->database:payments-db.internal', source: 'service:payments', target: 'database:payments-db.internal', type: 'CONNECTS_TO', provenance: 'OBSERVED', confidence: 1.0 },
    { id: 'CONNECTS_TO:EXTRACTED:service:auth->database:auth-db.internal', source: 'service:auth', target: 'database:auth-db.internal', type: 'CONNECTS_TO', provenance: 'EXTRACTED', confidence: 0.95 },
    { id: 'CONNECTS_TO:INFERRED:service:checkout->infra:redis:cache.internal', source: 'service:checkout', target: 'infra:redis:cache.internal', type: 'CONNECTS_TO', provenance: 'INFERRED', confidence: 0.6 },
    { id: 'CONNECTS_TO:INFERRED:service:auth->infra:redis:cache.internal', source: 'service:auth', target: 'infra:redis:cache.internal', type: 'CONNECTS_TO', provenance: 'INFERRED', confidence: 0.6 },
  ],
}

export const FIXTURE_INCIDENTS = {
  count: 3,
  total: 3,
  events: [
    {
      nodeId: 'service:payments',
      timestamp: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
      type: 'ERR_VERSION_MISMATCH',
      message: 'pg driver 7.4.0 incompatible with PostgreSQL 15 — connection failed',
      stacktrace: 'Error: connect ECONNREFUSED\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1187:16)\n    at pg.Client.connect (/app/node_modules/pg/lib/client.js:54:9)',
    },
    {
      nodeId: 'service:checkout',
      timestamp: new Date(Date.now() - 1000 * 60 * 38).toISOString(),
      type: 'ERR_TIMEOUT',
      message: 'upstream payments service exceeded 5s timeout on /charge',
    },
    {
      nodeId: 'service:auth',
      timestamp: new Date(Date.now() - 1000 * 60 * 91).toISOString(),
      type: 'ERR_RATE_LIMIT',
      message: 'Redis rate-limit key expired — 429 burst on /token',
    },
  ],
}

export const FIXTURE_HEALTH = { ok: true, project: 'demo' }

export const FIXTURE_PROJECTS = [
  { name: 'demo', path: '/workspace/demo', status: 'active' as const },
]

export const FIXTURE_VIOLATIONS = { violations: [] }

export function fixtureSearch(q: string) {
  const lower = q.toLowerCase()
  const results = FIXTURE_GRAPH.nodes
    .filter((n) => n.name.toLowerCase().includes(lower) || n.id.toLowerCase().includes(lower))
    .map((n) => ({ node: { id: n.id, type: n.type, name: n.name }, score: 0.95 }))
  return { results }
}

export function fixtureNodeDetail(id: string) {
  const node = FIXTURE_GRAPH.nodes.find((n) => n.id === id)
  if (!node) return { error: 'not found' }
  return { node }
}

export function fixtureRootCause(id: string) {
  if (id === 'service:payments') {
    return {
      origin: id,
      rootCauseNode: 'database:payments-db.internal',
      reason: 'pg driver 7.4.0 is incompatible with PostgreSQL 15 — protocol mismatch causes connection failure',
      fixRecommendation: 'upgrade pg to ^8.x (supports PostgreSQL 15 protocol)',
      confidence: 0.87,
      traversalPath: [id, 'database:payments-db.internal'],
    }
  }
  return { origin: id, rootCauseNode: null, reason: '', fixRecommendation: null, confidence: 0, traversalPath: [] }
}

export function fixtureBlastRadius(id: string) {
  const downstream = FIXTURE_GRAPH.edges
    .filter((e) => e.source === id)
    .map((e) => ({ nodeId: e.target, distance: 1, confidence: e.confidence, path: [id, e.target] }))
  return { origin: id, affectedNodes: downstream, violationCount: 0 }
}
