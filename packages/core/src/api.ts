import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type { ErrorEvent, GraphEdge, GraphNode } from '@neat/types'
import type { NeatGraph } from './graph.js'
import { extractFromDirectory } from './extract.js'
import { readErrorEvents, readStaleEvents } from './ingest.js'
import { getBlastRadius, getRootCause } from './traverse.js'
import { computeGraphDiff, loadSnapshotForDiff } from './diff.js'
import type { SearchIndex } from './search.js'

export interface BuildApiOptions {
  graph: NeatGraph
  startedAt?: number
  // Path the POST /graph/scan endpoint should re-extract from. Optional for tests.
  scanPath?: string
  // ndjson path the /incidents endpoints read from. Optional for tests.
  errorsPath?: string
  // ndjson path /incidents/stale reads from. Optional for tests.
  staleEventsPath?: string
  // Optional embedding-backed search index. When absent, /search falls back
  // to the substring path inline so the route always works.
  searchIndex?: SearchIndex
}

interface SerializedGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function serializeGraph(graph: NeatGraph): SerializedGraph {
  const nodes: GraphNode[] = []
  graph.forEachNode((_id, attrs) => {
    nodes.push(attrs)
  })
  const edges: GraphEdge[] = []
  graph.forEachEdge((_id, attrs) => {
    edges.push(attrs)
  })
  return { nodes, edges }
}

export async function buildApi(opts: BuildApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(cors, { origin: true })

  const startedAt = opts.startedAt ?? Date.now()
  const { graph } = opts

  app.get('/health', async () => ({
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    nodeCount: graph.order,
    edgeCount: graph.size,
    lastUpdated: new Date().toISOString(),
  }))

  app.get('/graph', async () => serializeGraph(graph))

  app.get<{ Params: { id: string } }>('/graph/node/:id', async (req, reply) => {
    const { id } = req.params
    if (!graph.hasNode(id)) {
      return reply.code(404).send({ error: 'node not found', id })
    }
    return graph.getNodeAttributes(id) as GraphNode
  })

  app.get<{ Params: { id: string } }>('/graph/edges/:id', async (req, reply) => {
    const { id } = req.params
    if (!graph.hasNode(id)) {
      return reply.code(404).send({ error: 'node not found', id })
    }
    const inbound = graph.inboundEdges(id).map((e) => graph.getEdgeAttributes(e) as GraphEdge)
    const outbound = graph.outboundEdges(id).map((e) => graph.getEdgeAttributes(e) as GraphEdge)
    return { inbound, outbound }
  })

  app.get('/incidents', async () => {
    if (!opts.errorsPath) return []
    return readErrorEvents(opts.errorsPath)
  })
  app.get<{ Querystring: { limit?: string; edgeType?: string } }>(
    '/incidents/stale',
    async (req) => {
      if (!opts.staleEventsPath) return []
      const events = await readStaleEvents(opts.staleEventsPath)
      const filtered = req.query.edgeType
        ? events.filter((e) => e.edgeType === req.query.edgeType)
        : events
      // Most-recent first; ndjson is append-time so the tail is newest.
      const ordered = [...filtered].reverse()
      const limit = req.query.limit ? Number(req.query.limit) : 50
      return ordered.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50)
    },
  )
  app.get<{ Params: { nodeId: string } }>('/incidents/:nodeId', async (req, reply) => {
    const { nodeId } = req.params
    if (!graph.hasNode(nodeId)) {
      return reply.code(404).send({ error: 'node not found', id: nodeId })
    }
    if (!opts.errorsPath) return []
    const events = await readErrorEvents(opts.errorsPath)
    return events.filter((e) => e.affectedNode === nodeId || e.service === nodeId.replace(/^service:/, ''))
  })

  app.get<{ Params: { nodeId: string }; Querystring: { errorId?: string } }>(
    '/traverse/root-cause/:nodeId',
    async (req, reply) => {
      const { nodeId } = req.params
      if (!graph.hasNode(nodeId)) {
        return reply.code(404).send({ error: 'node not found', id: nodeId })
      }
      let errorEvent: ErrorEvent | undefined
      if (req.query.errorId && opts.errorsPath) {
        const events = await readErrorEvents(opts.errorsPath)
        errorEvent = events.find((e) => e.id === req.query.errorId)
        if (!errorEvent) {
          return reply.code(404).send({ error: 'error event not found', id: req.query.errorId })
        }
      }
      const result = getRootCause(graph, nodeId, errorEvent)
      if (!result) return reply.code(404).send({ error: 'no root cause found', id: nodeId })
      return result
    },
  )

  app.get<{ Params: { nodeId: string }; Querystring: { depth?: string } }>(
    '/traverse/blast-radius/:nodeId',
    async (req, reply) => {
      const { nodeId } = req.params
      if (!graph.hasNode(nodeId)) {
        return reply.code(404).send({ error: 'node not found', id: nodeId })
      }
      const depth = req.query.depth ? Number(req.query.depth) : undefined
      if (depth !== undefined && (!Number.isFinite(depth) || depth < 0)) {
        return reply.code(400).send({ error: 'depth must be a non-negative number' })
      }
      return getBlastRadius(graph, nodeId, depth)
    },
  )

  app.get<{ Querystring: { q?: string; limit?: string } }>('/search', async (req, reply) => {
    const raw = (req.query.q ?? '').trim()
    if (!raw) return reply.code(400).send({ error: 'query parameter `q` is required' })
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    const safeLimit = limit !== undefined && Number.isFinite(limit) && limit > 0 ? limit : undefined

    if (opts.searchIndex) {
      const result = await opts.searchIndex.search(raw, safeLimit)
      return {
        query: result.query,
        provider: result.provider,
        matches: result.matches.map((m) => ({ ...m.node, score: m.score })),
      }
    }

    // Substring fallback for callers (mainly tests) that build the API
    // without an attached index. Same shape as the index path so consumers
    // don't branch.
    const q = raw.toLowerCase()
    const matches: (GraphNode & { score: number })[] = []
    graph.forEachNode((id, attrs) => {
      const name = (attrs as { name?: string }).name ?? ''
      if (id.toLowerCase().includes(q) || name.toLowerCase().includes(q)) {
        matches.push({ ...(attrs as GraphNode), score: 1 })
      }
    })
    return { query: q, provider: 'substring' as const, matches: matches.slice(0, safeLimit) }
  })

  app.get<{ Querystring: { against?: string } }>('/graph/diff', async (req, reply) => {
    const against = req.query.against
    if (!against) {
      return reply.code(400).send({ error: 'query parameter `against` is required' })
    }
    try {
      const snapshot = await loadSnapshotForDiff(against)
      return computeGraphDiff(graph, snapshot)
    } catch (err) {
      return reply
        .code(400)
        .send({ error: 'failed to load snapshot', against, detail: (err as Error).message })
    }
  })

  app.post('/graph/scan', async (_req, reply) => {
    if (!opts.scanPath) {
      return reply.code(409).send({ error: 'NEAT_SCAN_PATH not configured on this server' })
    }
    const result = await extractFromDirectory(graph, opts.scanPath)
    return {
      scanned: opts.scanPath,
      nodesAdded: result.nodesAdded,
      edgesAdded: result.edgesAdded,
      nodeCount: graph.order,
      edgeCount: graph.size,
    }
  })

  return app
}
