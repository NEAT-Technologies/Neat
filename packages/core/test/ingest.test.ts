import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { MultiDirectedGraph } from 'graphology'
import {
  EdgeType,
  type ErrorEvent,
  type GraphEdge,
  type GraphNode,
  NodeType,
  Provenance,
} from '@neat/types'
import {
  handleSpan,
  markStaleEdges,
  readErrorEvents,
  type IngestContext,
} from '../src/ingest.js'
import type { ParsedSpan } from '../src/otel.js'
import type { NeatGraph } from '../src/graph.js'

function newGraph(): NeatGraph {
  const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
  g.addNode('service:service-a', {
    id: 'service:service-a',
    type: NodeType.ServiceNode,
    name: 'service-a',
    language: 'javascript',
  })
  g.addNode('service:service-b', {
    id: 'service:service-b',
    type: NodeType.ServiceNode,
    name: 'service-b',
    language: 'javascript',
  })
  g.addNode('database:payments-db', {
    id: 'database:payments-db',
    type: NodeType.DatabaseNode,
    name: 'neatdemo',
    engine: 'postgresql',
    engineVersion: '15',
    compatibleDrivers: [],
  })
  return g
}

function clientHttpSpan(overrides: Partial<ParsedSpan> = {}): ParsedSpan {
  return {
    service: 'service-a',
    traceId: 'trace-1',
    spanId: 'span-a',
    name: 'GET /query',
    kind: 3,
    startTimeUnixNano: '0',
    endTimeUnixNano: '0',
    durationNanos: 0n,
    attributes: {
      'http.method': 'GET',
      'server.address': 'service-b',
      'server.port': 3001,
    },
    statusCode: 0,
    ...overrides,
  }
}

function dbSpan(overrides: Partial<ParsedSpan> = {}): ParsedSpan {
  return {
    service: 'service-b',
    traceId: 'trace-1',
    spanId: 'span-b',
    parentSpanId: 'span-a',
    name: 'pg.query',
    kind: 3,
    startTimeUnixNano: '0',
    endTimeUnixNano: '0',
    durationNanos: 0n,
    attributes: {
      'db.system': 'postgresql',
      'db.name': 'neatdemo',
      'server.address': 'payments-db',
    },
    dbSystem: 'postgresql',
    dbName: 'neatdemo',
    statusCode: 0,
    ...overrides,
  }
}

describe('handleSpan', () => {
  let tmpDir: string
  let ctx: IngestContext

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neat-ingest-'))
    ctx = {
      graph: newGraph(),
      errorsPath: path.join(tmpDir, 'errors.ndjson'),
    }
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('upserts an OBSERVED CALLS edge for a cross-service HTTP client span', async () => {
    await handleSpan(ctx, clientHttpSpan())
    const id = `${EdgeType.CALLS}:OBSERVED:service:service-a->service:service-b`
    expect(ctx.graph.hasEdge(id)).toBe(true)
    const edge = ctx.graph.getEdgeAttributes(id) as GraphEdge
    expect(edge.provenance).toBe(Provenance.OBSERVED)
    expect(edge.callCount).toBe(1)
    expect(edge.confidence).toBe(1)
    expect(edge.lastObserved).toBeTruthy()
  })

  it('increments callCount on repeat observations without duplicating the edge', async () => {
    await handleSpan(ctx, clientHttpSpan())
    await handleSpan(ctx, clientHttpSpan({ spanId: 'span-a2' }))
    await handleSpan(ctx, clientHttpSpan({ spanId: 'span-a3' }))
    const id = `${EdgeType.CALLS}:OBSERVED:service:service-a->service:service-b`
    expect(ctx.graph.hasEdge(id)).toBe(true)
    const edge = ctx.graph.getEdgeAttributes(id) as GraphEdge
    expect(edge.callCount).toBe(3)
    // No duplicate edges.
    const keys: string[] = []
    ctx.graph.forEachEdge((k) => keys.push(k))
    expect(keys.filter((k) => k.startsWith(`${EdgeType.CALLS}:OBSERVED:`))).toHaveLength(1)
  })

  it('upserts an OBSERVED CONNECTS_TO edge for a database span', async () => {
    await handleSpan(ctx, dbSpan())
    const id = `${EdgeType.CONNECTS_TO}:OBSERVED:service:service-b->database:payments-db`
    expect(ctx.graph.hasEdge(id)).toBe(true)
    const edge = ctx.graph.getEdgeAttributes(id) as GraphEdge
    expect(edge.provenance).toBe(Provenance.OBSERVED)
    expect(edge.callCount).toBe(1)
  })

  it('falls back to net.peer.name when server.address is missing', async () => {
    const span = dbSpan({
      attributes: {
        'db.system': 'postgresql',
        'db.name': 'neatdemo',
        'net.peer.name': 'payments-db',
      },
    })
    await handleSpan(ctx, span)
    expect(
      ctx.graph.hasEdge(`${EdgeType.CONNECTS_TO}:OBSERVED:service:service-b->database:payments-db`),
    ).toBe(true)
  })

  it('parses host out of url.full when peer attrs are absent', async () => {
    const span = clientHttpSpan({
      attributes: {
        'http.method': 'GET',
        'url.full': 'http://service-b:3001/query',
      },
    })
    await handleSpan(ctx, span)
    expect(
      ctx.graph.hasEdge(`${EdgeType.CALLS}:OBSERVED:service:service-a->service:service-b`),
    ).toBe(true)
  })

  it('skips spans whose target service node does not exist in the graph', async () => {
    await handleSpan(ctx, clientHttpSpan({ attributes: { 'server.address': 'unknown-service' } }))
    let calls = 0
    ctx.graph.forEachEdge((k) => {
      if (k.startsWith(`${EdgeType.CALLS}:OBSERVED:`)) calls++
    })
    expect(calls).toBe(0)
  })

  it('does not touch a pre-existing EXTRACTED edge between the same services', async () => {
    const staticId = `${EdgeType.CALLS}:service:service-a->service:service-b`
    ctx.graph.addEdgeWithKey(staticId, 'service:service-a', 'service:service-b', {
      id: staticId,
      source: 'service:service-a',
      target: 'service:service-b',
      type: EdgeType.CALLS,
      provenance: Provenance.EXTRACTED,
    })
    await handleSpan(ctx, clientHttpSpan())
    const staticEdge = ctx.graph.getEdgeAttributes(staticId) as GraphEdge
    expect(staticEdge.provenance).toBe(Provenance.EXTRACTED)
    expect(staticEdge.callCount).toBeUndefined()
    expect(
      ctx.graph.hasEdge(`${EdgeType.CALLS}:OBSERVED:service:service-a->service:service-b`),
    ).toBe(true)
  })

  it('writes an ErrorEvent line to the ndjson file when status.code === 2', async () => {
    await handleSpan(
      ctx,
      dbSpan({ statusCode: 2, errorMessage: 'SASL: SCRAM-SERVER-FIRST-MESSAGE' }),
    )
    const events = await readErrorEvents(ctx.errorsPath)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      service: 'service-b',
      traceId: 'trace-1',
      spanId: 'span-b',
      affectedNode: 'database:payments-db',
      errorMessage: expect.stringContaining('SCRAM'),
    } as ErrorEvent)
  })

  it('does not log an ErrorEvent for a successful span', async () => {
    await handleSpan(ctx, clientHttpSpan())
    expect(await readErrorEvents(ctx.errorsPath)).toEqual([])
  })
})

describe('markStaleEdges', () => {
  it('demotes OBSERVED edges whose lastObserved is older than the threshold to STALE', async () => {
    const graph = newGraph()
    const fresh = new Date()
    const old = new Date(fresh.getTime() - 25 * 60 * 60 * 1000)
    graph.addEdgeWithKey(
      'CALLS:OBSERVED:service:service-a->service:service-b',
      'service:service-a',
      'service:service-b',
      {
        id: 'CALLS:OBSERVED:service:service-a->service:service-b',
        source: 'service:service-a',
        target: 'service:service-b',
        type: EdgeType.CALLS,
        provenance: Provenance.OBSERVED,
        lastObserved: old.toISOString(),
        callCount: 7,
        confidence: 1,
      },
    )
    graph.addEdgeWithKey(
      'CONNECTS_TO:OBSERVED:service:service-b->database:payments-db',
      'service:service-b',
      'database:payments-db',
      {
        id: 'CONNECTS_TO:OBSERVED:service:service-b->database:payments-db',
        source: 'service:service-b',
        target: 'database:payments-db',
        type: EdgeType.CONNECTS_TO,
        provenance: Provenance.OBSERVED,
        lastObserved: fresh.toISOString(),
        callCount: 3,
        confidence: 1,
      },
    )
    const demoted = markStaleEdges(graph, 24 * 60 * 60 * 1000, fresh.getTime())
    expect(demoted).toBe(1)
    const stale = graph.getEdgeAttributes('CALLS:OBSERVED:service:service-a->service:service-b') as GraphEdge
    expect(stale.provenance).toBe(Provenance.STALE)
    expect(stale.confidence).toBe(0.3)
    const still = graph.getEdgeAttributes(
      'CONNECTS_TO:OBSERVED:service:service-b->database:payments-db',
    ) as GraphEdge
    expect(still.provenance).toBe(Provenance.OBSERVED)
  })

  it('leaves EXTRACTED edges alone', () => {
    const graph = newGraph()
    graph.addEdgeWithKey(
      'CALLS:service:service-a->service:service-b',
      'service:service-a',
      'service:service-b',
      {
        id: 'CALLS:service:service-a->service:service-b',
        source: 'service:service-a',
        target: 'service:service-b',
        type: EdgeType.CALLS,
        provenance: Provenance.EXTRACTED,
      },
    )
    expect(markStaleEdges(graph, 0, Date.now())).toBe(0)
  })
})

describe('readErrorEvents', () => {
  it('returns [] when the file does not exist yet', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neat-ingest-read-'))
    expect(await readErrorEvents(path.join(tmpDir, 'absent.ndjson'))).toEqual([])
    await fs.rm(tmpDir, { recursive: true, force: true })
  })
})
