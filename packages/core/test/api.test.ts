import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { resetGraph, getGraph } from '../src/graph.js'
import { buildApi } from '../src/api.js'
import { extractFromDirectory } from '../src/extract.js'

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const DEMO_PATH = path.resolve(__dirname, '../../../demo')

describe('REST API (fastify.inject)', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    resetGraph()
    const graph = getGraph()
    await extractFromDirectory(graph, DEMO_PATH)
    app = await buildApi({ graph, scanPath: DEMO_PATH })
  })

  afterEach(async () => {
    await app.close()
  })

  it('GET /health returns the expected shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      uptime: expect.any(Number),
      nodeCount: expect.any(Number),
      edgeCount: expect.any(Number),
      lastUpdated: expect.any(String),
    })
    expect(body.nodeCount).toBeGreaterThanOrEqual(3)
  })

  it('GET /graph returns nodes and edges arrays', async () => {
    const res = await app.inject({ method: 'GET', url: '/graph' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.nodes.length).toBeGreaterThanOrEqual(3)
    expect(body.edges.length).toBeGreaterThanOrEqual(2)

    const serviceB = body.nodes.find((n: { id: string }) => n.id === 'service:service-b')
    expect(serviceB.pgDriverVersion).toBe('7.4.0')

    const db = body.nodes.find((n: { id: string }) => n.id === 'database:payments-db')
    expect(db.engineVersion).toBe('15')
    expect(db.compatibleDrivers.find((d: { name: string }) => d.name === 'pg').minVersion).toBe(
      '8.0.0',
    )
  })

  it('GET /graph/node/:id returns a single node', async () => {
    const res = await app.inject({ method: 'GET', url: '/graph/node/service:service-b' })
    expect(res.statusCode).toBe(200)
    expect(res.json().pgDriverVersion).toBe('7.4.0')
  })

  it('GET /graph/node/:id returns 404 for an unknown node', async () => {
    const res = await app.inject({ method: 'GET', url: '/graph/node/nope' })
    expect(res.statusCode).toBe(404)
  })

  it('GET /graph/edges/:id returns inbound and outbound', async () => {
    const res = await app.inject({ method: 'GET', url: '/graph/edges/service:service-b' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.inbound.length).toBeGreaterThanOrEqual(1)
    expect(body.outbound.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /incidents returns an empty array (M2 fills this in)', async () => {
    const res = await app.inject({ method: 'GET', url: '/incidents' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('GET /incidents/:nodeId returns [] for a known node', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/incidents/service:service-b',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('GET /search?q=service-b finds the matching node', async () => {
    const res = await app.inject({ method: 'GET', url: '/search?q=service-b' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.query).toBe('service-b')
    expect(body.matches.length).toBeGreaterThanOrEqual(1)
    expect(body.matches.some((n: { id: string }) => n.id === 'service:service-b')).toBe(true)
  })

  it('GET /search with no q returns 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/search' })
    expect(res.statusCode).toBe(400)
  })

  it('POST /graph/scan re-runs extraction (idempotent — adds nothing the second time)', async () => {
    const res = await app.inject({ method: 'POST', url: '/graph/scan' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.scanned).toMatch(/demo$/)
    expect(body.nodesAdded).toBe(0)
    expect(body.edgesAdded).toBe(0)
    expect(body.nodeCount).toBeGreaterThanOrEqual(3)
  })

  it('POST /graph/scan returns 409 when scanPath was not configured', async () => {
    await app.close()
    const graph = getGraph()
    app = await buildApi({ graph })
    const res = await app.inject({ method: 'POST', url: '/graph/scan' })
    expect(res.statusCode).toBe(409)
  })

  it('GET /traverse/root-cause/:nodeId returns the demo pg incompatibility', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/traverse/root-cause/database:payments-db',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.rootCauseNode).toBe('service:service-b')
    expect(body.traversalPath).toEqual([
      'database:payments-db',
      'service:service-b',
      'service:service-a',
    ])
    expect(body.confidence).toBe(0.5)
    expect(body.fixRecommendation).toMatch(/8\.0\.0/)
  })

  it('GET /traverse/root-cause/:nodeId returns 404 for an unknown node', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/traverse/root-cause/database:nope',
    })
    expect(res.statusCode).toBe(404)
  })

  it('GET /traverse/root-cause/:nodeId returns 404 when no root cause is found', async () => {
    // service:service-a is a service node, not a database — getRootCause bails out.
    const res = await app.inject({
      method: 'GET',
      url: '/traverse/root-cause/service:service-a',
    })
    expect(res.statusCode).toBe(404)
  })

  it('GET /traverse/blast-radius/:nodeId returns downstream nodes with distances', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/traverse/blast-radius/service:service-a',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.origin).toBe('service:service-a')
    // service-b sits at distance 1; payments-db and the db-config.yaml ConfigNode
    // are both reachable from service-b at distance 2.
    expect(body.totalAffected).toBe(3)
    expect(body.affectedNodes).toContainEqual({
      nodeId: 'service:service-b',
      distance: 1,
      edgeProvenance: 'EXTRACTED',
    })
    expect(body.affectedNodes).toContainEqual({
      nodeId: 'database:payments-db',
      distance: 2,
      edgeProvenance: 'EXTRACTED',
    })
    expect(body.affectedNodes).toContainEqual({
      nodeId: 'config:service-b/db-config.yaml',
      distance: 2,
      edgeProvenance: 'EXTRACTED',
    })
  })

  it('GET /traverse/blast-radius/:nodeId returns 404 for an unknown node', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/traverse/blast-radius/service:nope',
    })
    expect(res.statusCode).toBe(404)
  })

  it('GET /traverse/blast-radius/:nodeId rejects a negative depth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/traverse/blast-radius/service:service-a?depth=-1',
    })
    expect(res.statusCode).toBe(400)
  })

  it('GET /traverse/blast-radius/:nodeId honours a custom depth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/traverse/blast-radius/service:service-a?depth=1',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.totalAffected).toBe(1)
    expect(body.affectedNodes[0].nodeId).toBe('service:service-b')
  })
})
