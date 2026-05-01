import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type { NeatGraph } from './graph.js'

export interface BuildApiOptions {
  graph: NeatGraph
  startedAt?: number
}

// Skeleton API. Real routes (graph, incidents, search, scan) land in #9; traversal in #12.
export async function buildApi(opts: BuildApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(cors, { origin: true })

  const startedAt = opts.startedAt ?? Date.now()

  app.get('/health', async () => {
    return {
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      nodeCount: opts.graph.order,
      edgeCount: opts.graph.size,
      lastUpdated: new Date().toISOString(),
    }
  })

  return app
}
