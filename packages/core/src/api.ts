import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type { GraphEdge, GraphNode } from '@neat/types'
import type { NeatGraph } from './graph.js'
import { extractFromDirectory } from './extract.js'

export interface BuildApiOptions {
  graph: NeatGraph
  startedAt?: number
  // Path the POST /graph/scan endpoint should re-extract from. Optional for tests.
  scanPath?: string
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

  // Incidents come online with M2 (OTel ingest). Stub the routes so clients can
  // wire against the final URL shape today.
  app.get('/incidents', async () => [])
  app.get<{ Params: { nodeId: string } }>('/incidents/:nodeId', async (req, reply) => {
    const { nodeId } = req.params
    if (!graph.hasNode(nodeId)) {
      return reply.code(404).send({ error: 'node not found', id: nodeId })
    }
    return []
  })

  app.get<{ Querystring: { q?: string } }>('/search', async (req, reply) => {
    const q = (req.query.q ?? '').trim().toLowerCase()
    if (!q) return reply.code(400).send({ error: 'query parameter `q` is required' })
    const matches: GraphNode[] = []
    graph.forEachNode((id, attrs) => {
      const name = (attrs as { name?: string }).name ?? ''
      if (id.toLowerCase().includes(q) || name.toLowerCase().includes(q)) {
        matches.push(attrs)
      }
    })
    return { query: q, matches }
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
