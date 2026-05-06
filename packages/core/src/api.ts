import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify'
import cors from '@fastify/cors'
import type { ErrorEvent, GraphEdge, GraphNode } from '@neat/types'
import type { NeatGraph } from './graph.js'
import { DEFAULT_PROJECT } from './graph.js'
import { extractFromDirectory } from './extract.js'
import { readErrorEvents, readStaleEvents } from './ingest.js'
import {
  getBlastRadius,
  getRootCause,
  getTransitiveDependencies,
  TRANSITIVE_DEPENDENCIES_DEFAULT_DEPTH,
  TRANSITIVE_DEPENDENCIES_MAX_DEPTH,
} from './traverse.js'
import { computeGraphDiff, loadSnapshotForDiff } from './diff.js'
import type { SearchIndex } from './search.js'
import type { Projects, ProjectContext } from './projects.js'
import { Projects as ProjectsClass, pathsForProject } from './projects.js'

export interface BuildApiOptions {
  // Multi-project shape. Optional — when absent we synthesise a single-
  // project registry from the legacy fields below so existing callers
  // (mainly tests) keep working unchanged.
  projects?: Projects
  startedAt?: number

  // Legacy single-project shape. Mapped to project=`default` if `projects`
  // isn't provided.
  graph?: NeatGraph
  scanPath?: string
  errorsPath?: string
  staleEventsPath?: string
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

function projectFromReq(req: FastifyRequest): string {
  // `:project` is optional in the URL — the request hits either
  // /projects/:project/X or /X (which means default). Coerce the missing
  // param to DEFAULT_PROJECT here so handlers don't repeat the fallback.
  const params = req.params as { project?: string }
  return params.project ?? DEFAULT_PROJECT
}

function resolveProject(
  registry: Projects,
  req: FastifyRequest,
  reply: FastifyReply,
): ProjectContext | null {
  const name = projectFromReq(req)
  const ctx = registry.get(name)
  if (!ctx) {
    void reply.code(404).send({ error: 'project not found', project: name })
    return null
  }
  return ctx
}

function buildLegacyRegistry(opts: BuildApiOptions): Projects {
  if (opts.projects) return opts.projects
  if (!opts.graph) {
    throw new Error('buildApi: either `projects` or `graph` must be provided')
  }
  const registry = new ProjectsClass()
  // pathsForProject only matters here for the snapshot/embeddings paths
  // routes never read; the ingest paths come from explicit options below.
  const paths = pathsForProject(DEFAULT_PROJECT, '')
  registry.set(DEFAULT_PROJECT, {
    graph: opts.graph,
    scanPath: opts.scanPath,
    paths: {
      snapshotPath: paths.snapshotPath,
      errorsPath: opts.errorsPath ?? paths.errorsPath,
      staleEventsPath: opts.staleEventsPath ?? paths.staleEventsPath,
      embeddingsCachePath: paths.embeddingsCachePath,
    },
    searchIndex: opts.searchIndex,
  })
  return registry
}

interface RouteContext {
  registry: Projects
  startedAt: number
  // Legacy callers passed `errorsPath`/`staleEventsPath` explicitly and
  // expected absent values to disable the read. Track that intent so the
  // /incidents handlers don't accidentally read a phantom file.
  errorsPathFor: (ctx: ProjectContext) => string | undefined
  staleEventsPathFor: (ctx: ProjectContext) => string | undefined
}

// Registers every project-scoped route on `scope`. Called twice from
// buildApi: once on the root app (so /graph etc. land at default), once
// inside a `register(_, { prefix: '/projects/:project' })` plugin so the
// same handlers run when the URL names a project explicitly.
function registerRoutes(scope: FastifyInstance, ctx: RouteContext): void {
  const { registry, startedAt, errorsPathFor, staleEventsPathFor } = ctx

  scope.get<{ Params: { project?: string } }>('/health', async (req, reply) => {
    const proj = resolveProject(registry, req, reply)
    if (!proj) return
    return {
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      project: proj.name,
      nodeCount: proj.graph.order,
      edgeCount: proj.graph.size,
      lastUpdated: new Date().toISOString(),
    }
  })

  scope.get<{ Params: { project?: string } }>('/graph', async (req, reply) => {
    const proj = resolveProject(registry, req, reply)
    if (!proj) return
    return serializeGraph(proj.graph)
  })

  scope.get<{ Params: { project?: string; id: string } }>(
    '/graph/node/:id',
    async (req, reply) => {
      const proj = resolveProject(registry, req, reply)
      if (!proj) return
      const { id } = req.params
      if (!proj.graph.hasNode(id)) {
        return reply.code(404).send({ error: 'node not found', id })
      }
      return proj.graph.getNodeAttributes(id) as GraphNode
    },
  )

  scope.get<{ Params: { project?: string; id: string } }>(
    '/graph/edges/:id',
    async (req, reply) => {
      const proj = resolveProject(registry, req, reply)
      if (!proj) return
      const { id } = req.params
      if (!proj.graph.hasNode(id)) {
        return reply.code(404).send({ error: 'node not found', id })
      }
      const inbound = proj.graph
        .inboundEdges(id)
        .map((e) => proj.graph.getEdgeAttributes(e) as GraphEdge)
      const outbound = proj.graph
        .outboundEdges(id)
        .map((e) => proj.graph.getEdgeAttributes(e) as GraphEdge)
      return { inbound, outbound }
    },
  )

  // Transitive dependencies (issue #144). BFS outbound to depth N, returning
  // a flat list with distance + edgeType + provenance per dependency.
  // Default depth 3, max 10. The MCP get_dependencies tool calls this.
  scope.get<{
    Params: { project?: string; id: string }
    Querystring: { depth?: string }
  }>('/graph/node/:id/dependencies', async (req, reply) => {
    const proj = resolveProject(registry, req, reply)
    if (!proj) return
    const { id } = req.params
    if (!proj.graph.hasNode(id)) {
      return reply.code(404).send({ error: 'node not found', id })
    }
    const depth = req.query.depth ? Number(req.query.depth) : TRANSITIVE_DEPENDENCIES_DEFAULT_DEPTH
    if (!Number.isFinite(depth) || depth < 1 || depth > TRANSITIVE_DEPENDENCIES_MAX_DEPTH) {
      return reply.code(400).send({
        error: `depth must be an integer in [1, ${TRANSITIVE_DEPENDENCIES_MAX_DEPTH}]`,
      })
    }
    return getTransitiveDependencies(proj.graph, id, depth)
  })

  scope.get<{ Params: { project?: string } }>('/incidents', async (req, reply) => {
    const proj = resolveProject(registry, req, reply)
    if (!proj) return
    const epath = errorsPathFor(proj)
    if (!epath) return []
    return readErrorEvents(epath)
  })

  scope.get<{
    Params: { project?: string }
    Querystring: { limit?: string; edgeType?: string }
  }>('/incidents/stale', async (req, reply) => {
    const proj = resolveProject(registry, req, reply)
    if (!proj) return
    const spath = staleEventsPathFor(proj)
    if (!spath) return []
    const events = await readStaleEvents(spath)
    const filtered = req.query.edgeType
      ? events.filter((e) => e.edgeType === req.query.edgeType)
      : events
    const ordered = [...filtered].reverse()
    const limit = req.query.limit ? Number(req.query.limit) : 50
    return ordered.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50)
  })

  scope.get<{ Params: { project?: string; nodeId: string } }>(
    '/incidents/:nodeId',
    async (req, reply) => {
      const proj = resolveProject(registry, req, reply)
      if (!proj) return
      const { nodeId } = req.params
      if (!proj.graph.hasNode(nodeId)) {
        return reply.code(404).send({ error: 'node not found', id: nodeId })
      }
      const epath = errorsPathFor(proj)
      if (!epath) return []
      const events = await readErrorEvents(epath)
      return events.filter(
        (e) =>
          e.affectedNode === nodeId || e.service === nodeId.replace(/^service:/, ''),
      )
    },
  )

  scope.get<{
    Params: { project?: string; nodeId: string }
    Querystring: { errorId?: string }
  }>('/traverse/root-cause/:nodeId', async (req, reply) => {
    const proj = resolveProject(registry, req, reply)
    if (!proj) return
    const { nodeId } = req.params
    if (!proj.graph.hasNode(nodeId)) {
      return reply.code(404).send({ error: 'node not found', id: nodeId })
    }
    let errorEvent: ErrorEvent | undefined
    const epath = errorsPathFor(proj)
    if (req.query.errorId && epath) {
      const events = await readErrorEvents(epath)
      errorEvent = events.find((e) => e.id === req.query.errorId)
      if (!errorEvent) {
        return reply
          .code(404)
          .send({ error: 'error event not found', id: req.query.errorId })
      }
    }
    const result = getRootCause(proj.graph, nodeId, errorEvent)
    if (!result) return reply.code(404).send({ error: 'no root cause found', id: nodeId })
    return result
  })

  scope.get<{
    Params: { project?: string; nodeId: string }
    Querystring: { depth?: string }
  }>('/traverse/blast-radius/:nodeId', async (req, reply) => {
    const proj = resolveProject(registry, req, reply)
    if (!proj) return
    const { nodeId } = req.params
    if (!proj.graph.hasNode(nodeId)) {
      return reply.code(404).send({ error: 'node not found', id: nodeId })
    }
    const depth = req.query.depth ? Number(req.query.depth) : undefined
    if (depth !== undefined && (!Number.isFinite(depth) || depth < 0)) {
      return reply.code(400).send({ error: 'depth must be a non-negative number' })
    }
    return getBlastRadius(proj.graph, nodeId, depth)
  })

  scope.get<{
    Params: { project?: string }
    Querystring: { q?: string; limit?: string }
  }>('/search', async (req, reply) => {
    const proj = resolveProject(registry, req, reply)
    if (!proj) return
    const raw = (req.query.q ?? '').trim()
    if (!raw) return reply.code(400).send({ error: 'query parameter `q` is required' })
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    const safeLimit =
      limit !== undefined && Number.isFinite(limit) && limit > 0 ? limit : undefined
    if (proj.searchIndex) {
      const result = await proj.searchIndex.search(raw, safeLimit)
      return {
        query: result.query,
        provider: result.provider,
        matches: result.matches.map((m) => ({ ...m.node, score: m.score })),
      }
    }
    const q = raw.toLowerCase()
    const matches: (GraphNode & { score: number })[] = []
    proj.graph.forEachNode((id, attrs) => {
      const name = (attrs as { name?: string }).name ?? ''
      if (id.toLowerCase().includes(q) || name.toLowerCase().includes(q)) {
        matches.push({ ...(attrs as GraphNode), score: 1 })
      }
    })
    return {
      query: q,
      provider: 'substring' as const,
      matches: matches.slice(0, safeLimit),
    }
  })

  scope.get<{ Params: { project?: string }; Querystring: { against?: string } }>(
    '/graph/diff',
    async (req, reply) => {
      const proj = resolveProject(registry, req, reply)
      if (!proj) return
      const against = req.query.against
      if (!against) {
        return reply.code(400).send({ error: 'query parameter `against` is required' })
      }
      try {
        const snapshot = await loadSnapshotForDiff(against)
        return computeGraphDiff(proj.graph, snapshot)
      } catch (err) {
        return reply
          .code(400)
          .send({ error: 'failed to load snapshot', against, detail: (err as Error).message })
      }
    },
  )

  scope.post<{ Params: { project?: string } }>('/graph/scan', async (req, reply) => {
    const proj = resolveProject(registry, req, reply)
    if (!proj) return
    if (!proj.scanPath) {
      return reply
        .code(409)
        .send({ error: 'scan path not configured for this project', project: proj.name })
    }
    const result = await extractFromDirectory(proj.graph, proj.scanPath)
    return {
      project: proj.name,
      scanned: proj.scanPath,
      nodesAdded: result.nodesAdded,
      edgesAdded: result.edgesAdded,
      nodeCount: proj.graph.order,
      edgeCount: proj.graph.size,
    }
  })
}

export async function buildApi(opts: BuildApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(cors, { origin: true })

  const startedAt = opts.startedAt ?? Date.now()
  const registry = buildLegacyRegistry(opts)

  const legacyErrorsExplicit = !opts.projects && opts.errorsPath !== undefined
  const legacyStaleExplicit = !opts.projects && opts.staleEventsPath !== undefined

  const errorsPathFor = (proj: ProjectContext): string | undefined => {
    if (proj.name === DEFAULT_PROJECT && !opts.projects) {
      return legacyErrorsExplicit ? opts.errorsPath : undefined
    }
    return proj.paths.errorsPath
  }
  const staleEventsPathFor = (proj: ProjectContext): string | undefined => {
    if (proj.name === DEFAULT_PROJECT && !opts.projects) {
      return legacyStaleExplicit ? opts.staleEventsPath : undefined
    }
    return proj.paths.staleEventsPath
  }

  const routeCtx: RouteContext = { registry, startedAt, errorsPathFor, staleEventsPathFor }

  // Top-level discovery — only meaningful at the root.
  app.get('/projects', async () => ({
    projects: registry.list().map((name) => {
      const proj = registry.get(name) as ProjectContext
      return {
        name,
        nodeCount: proj.graph.order,
        edgeCount: proj.graph.size,
        scanPath: proj.scanPath,
      }
    }),
  }))

  // Default mount: /health, /graph, /incidents, etc. all hit project=default.
  registerRoutes(app, routeCtx)

  // Project-scoped mount: same handlers, URL params include `:project`.
  await app.register(
    async (scope) => {
      registerRoutes(scope, routeCtx)
    },
    { prefix: '/projects/:project' },
  )

  return app
}
