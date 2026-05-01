import type {
  BlastRadiusAffectedNode,
  BlastRadiusResult,
  DatabaseNode,
  ErrorEvent,
  GraphEdge,
  GraphNode,
  ProvenanceValue,
  RootCauseResult,
  ServiceNode,
} from '@neat/types'
import { NodeType, Provenance } from '@neat/types'
import type { NeatGraph } from './graph.js'
import { checkCompatibility } from './compat.js'

const PROV_RANK: Record<ProvenanceValue, number> = {
  OBSERVED: 3,
  INFERRED: 2,
  EXTRACTED: 1,
  STALE: 0,
  FRONTIER: 0,
}

const ROOT_CAUSE_MAX_DEPTH = 5
const BLAST_RADIUS_DEFAULT_DEPTH = 10

// Multiple edges between the same pair coexist by provenance (EXTRACTED next to
// OBSERVED next to INFERRED). Traversal walks the system as the graph "sees it
// best", so for any neighbour pair we pick the highest-provenance edge.
function bestEdgeBySource(graph: NeatGraph, edgeIds: string[]): Map<string, GraphEdge> {
  const best = new Map<string, GraphEdge>()
  for (const id of edgeIds) {
    const e = graph.getEdgeAttributes(id) as GraphEdge
    const cur = best.get(e.source)
    if (!cur || PROV_RANK[e.provenance] > PROV_RANK[cur.provenance]) {
      best.set(e.source, e)
    }
  }
  return best
}

function bestEdgeByTarget(graph: NeatGraph, edgeIds: string[]): Map<string, GraphEdge> {
  const best = new Map<string, GraphEdge>()
  for (const id of edgeIds) {
    const e = graph.getEdgeAttributes(id) as GraphEdge
    const cur = best.get(e.target)
    if (!cur || PROV_RANK[e.provenance] > PROV_RANK[cur.provenance]) {
      best.set(e.target, e)
    }
  }
  return best
}

function confidenceFromMix(edges: GraphEdge[]): number {
  if (edges.length === 0) return 1.0
  if (edges.every((e) => e.provenance === Provenance.OBSERVED)) return 1.0
  if (edges.some((e) => e.provenance === Provenance.INFERRED)) return 0.7
  return 0.5
}

interface Walk {
  path: string[]
  edges: GraphEdge[]
}

// DFS along incoming edges from start, depth-bounded. Returns the longest path
// reachable, picking best-provenance edges per neighbour pair so the walk
// reflects the system as the graph knows it most reliably.
function longestIncomingWalk(graph: NeatGraph, start: string, maxDepth: number): Walk {
  let best: Walk = { path: [start], edges: [] }
  const visited = new Set<string>([start])

  function step(node: string, path: string[], edges: GraphEdge[]): void {
    if (path.length > best.path.length) {
      best = { path: [...path], edges: [...edges] }
    }
    if (path.length - 1 >= maxDepth) return

    const incoming = bestEdgeBySource(graph, graph.inboundEdges(node))
    for (const [srcId, edge] of incoming) {
      if (visited.has(srcId)) continue
      visited.add(srcId)
      path.push(srcId)
      edges.push(edge)
      step(srcId, path, edges)
      path.pop()
      edges.pop()
      visited.delete(srcId)
    }
  }

  step(start, [start], [])
  return best
}

export function getRootCause(
  graph: NeatGraph,
  errorNodeId: string,
  errorEvent?: ErrorEvent,
): RootCauseResult | null {
  if (!graph.hasNode(errorNodeId)) return null

  const startAttrs = graph.getNodeAttributes(errorNodeId) as GraphNode
  // Today the only failure mode the compat matrix catches is driver/engine, so
  // we only walk in if the error surfaced at a database. Other root-cause
  // shapes (config drift, version skew between services) come with M5.
  if (startAttrs.type !== NodeType.DatabaseNode) return null
  const targetDb = startAttrs as DatabaseNode

  const walk = longestIncomingWalk(graph, errorNodeId, ROOT_CAUSE_MAX_DEPTH)

  let rootCauseNode: string | null = null
  let rootCauseReason: string | null = null
  let fixRecommendation: string | undefined

  for (const id of walk.path) {
    const attrs = graph.getNodeAttributes(id) as GraphNode
    if (attrs.type !== NodeType.ServiceNode) continue
    const svc = attrs as ServiceNode
    if (!svc.pgDriverVersion) continue
    const result = checkCompatibility(
      'pg',
      svc.pgDriverVersion,
      targetDb.engine,
      targetDb.engineVersion,
    )
    if (!result.compatible) {
      rootCauseNode = id
      rootCauseReason = result.reason ?? 'incompatible driver'
      if (result.minDriverVersion) {
        fixRecommendation = `Upgrade ${svc.name} pg driver to >= ${result.minDriverVersion}`
      }
      break
    }
  }

  if (!rootCauseNode || !rootCauseReason) return null

  const reason = errorEvent
    ? `${rootCauseReason} (observed error: ${errorEvent.errorMessage})`
    : rootCauseReason

  return {
    rootCauseNode,
    rootCauseReason: reason,
    traversalPath: walk.path,
    edgeProvenances: walk.edges.map((e) => e.provenance),
    confidence: confidenceFromMix(walk.edges),
    fixRecommendation,
  }
}

// BFS along outgoing edges from origin. Records each reachable node with the
// shortest distance back to origin and the provenance of the edge that brought
// us to it. Best-provenance edge selection per pair mirrors getRootCause.
export function getBlastRadius(
  graph: NeatGraph,
  nodeId: string,
  maxDepth = BLAST_RADIUS_DEFAULT_DEPTH,
): BlastRadiusResult {
  if (!graph.hasNode(nodeId)) {
    return { origin: nodeId, affectedNodes: [], totalAffected: 0 }
  }

  interface Frame {
    nodeId: string
    distance: number
    edge: GraphEdge | null
  }

  const seen = new Map<string, BlastRadiusAffectedNode>()
  const queue: Frame[] = [{ nodeId, distance: 0, edge: null }]
  const enqueued = new Set<string>([nodeId])

  while (queue.length > 0) {
    const frame = queue.shift()!
    if (frame.distance > 0 && frame.edge) {
      seen.set(frame.nodeId, {
        nodeId: frame.nodeId,
        distance: frame.distance,
        edgeProvenance: frame.edge.provenance,
      })
    }
    if (frame.distance >= maxDepth) continue

    const outgoing = bestEdgeByTarget(graph, graph.outboundEdges(frame.nodeId))
    for (const [tgtId, edge] of outgoing) {
      if (enqueued.has(tgtId)) continue
      enqueued.add(tgtId)
      queue.push({ nodeId: tgtId, distance: frame.distance + 1, edge })
    }
  }

  const affectedNodes = [...seen.values()].sort(
    (a, b) => a.distance - b.distance || a.nodeId.localeCompare(b.nodeId),
  )
  return {
    origin: nodeId,
    affectedNodes,
    totalAffected: affectedNodes.length,
  }
}
