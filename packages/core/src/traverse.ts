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
import { NodeType } from '@neat/types'
import type { NeatGraph } from './graph.js'
import { checkCompatibility, compatPairs } from './compat.js'

// Contract anchors (see /docs/contracts.md):
//   * Rule 2 — Coexistence: walk by provenance priority, never collapse edges.
//   * Rule 3 — FRONTIER edges must be skipped, not merely deprioritized.
//     If a node's only edges are FRONTIER, traversal stops there.
//   * Rule 5 — Validate results against RootCauseResultSchema /
//     BlastRadiusResultSchema before returning.
//   * Rule 8 — No demo-name hardcoding: driver/engine identifiers come from
//     node properties + compatPairs(), never literals.
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

// Per-edge confidence is provenance × volume × recency × cleanliness.
//   * provenance gives a ceiling: OBSERVED 1.0, INFERRED 0.7, EXTRACTED 0.5,
//     STALE/FRONTIER 0.3.
//   * volume: log-scaled span count, saturating quickly so 1 span ≈ 0.55 and
//     ~1k spans ≈ 1.0.
//   * recency: 1.0 within an hour; decays toward 0.5 by 24h, toward 0.3 past.
//   * cleanliness: error rate above ~10% pulls the score down — a flapping
//     edge with thousands of spans shouldn't outrank a clean low-traffic one.
// Bounded to [0, 1]. Walks of multiple edges multiply per-edge confidences.
const PROVENANCE_CEILING: Record<string, number> = {
  OBSERVED: 1.0,
  INFERRED: 0.7,
  EXTRACTED: 0.5,
  STALE: 0.3,
  FRONTIER: 0.3,
}

function volumeWeight(spanCount: number | undefined): number {
  if (!spanCount || spanCount <= 0) return 0.5
  // log10 saturating around ~1000 spans → ~1.0.
  const w = 0.5 + Math.log10(spanCount + 1) / 3
  return Math.min(1, w)
}

function recencyWeight(ageMs: number | undefined): number {
  if (ageMs === undefined) return 0.8
  const hour = 60 * 60 * 1000
  if (ageMs <= hour) return 1.0
  if (ageMs <= 24 * hour) {
    const t = (ageMs - hour) / (23 * hour)
    return 1.0 - 0.5 * t
  }
  return 0.3
}

function cleanlinessWeight(spanCount: number | undefined, errorCount: number | undefined): number {
  if (!spanCount || spanCount <= 0) return 1
  const rate = (errorCount ?? 0) / spanCount
  if (rate <= 0.01) return 1
  if (rate >= 0.5) return 0.3
  return 1 - rate * 1.4
}

export function confidenceForEdge(edge: GraphEdge, now = Date.now()): number {
  const ceiling = PROVENANCE_CEILING[edge.provenance] ?? 0.5

  // No runtime signal yet → the provenance ceiling is all we have. This keeps
  // EXTRACTED-only graphs returning the same coarse 0.3/0.5/0.7/1.0 ladder
  // they always have, while letting OBSERVED edges with real OTel data move
  // off the ceiling once ingest starts populating signal counters.
  const spanCount = edge.signal?.spanCount ?? edge.callCount
  const ageMs = edge.signal?.lastObservedAgeMs ?? lastObservedAge(edge, now)
  if (spanCount === undefined && ageMs === undefined && edge.signal === undefined) {
    return ceiling
  }

  const v = volumeWeight(spanCount)
  const r = recencyWeight(ageMs)
  const c = cleanlinessWeight(spanCount, edge.signal?.errorCount)
  return Math.max(0, Math.min(1, ceiling * v * r * c))
}

function lastObservedAge(edge: GraphEdge, now: number): number | undefined {
  if (!edge.lastObserved) return undefined
  const t = Date.parse(edge.lastObserved)
  if (!Number.isFinite(t)) return undefined
  return Math.max(0, now - t)
}

// Path-level confidence is the bottleneck along the walk: the weakest edge
// dictates the result. Multiplying would punish long-but-strong walks;
// taking the min keeps the existing semantics while letting per-edge signal
// pull the number down where it matters.
function confidenceFromMix(edges: GraphEdge[], now = Date.now()): number {
  if (edges.length === 0) return 1.0
  let min = 1
  for (const e of edges) {
    const c = confidenceForEdge(e, now)
    if (c < min) min = c
  }
  return Math.max(0, Math.min(1, min))
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
  // Driver/engine mismatches are still the only shape the compat matrix
  // describes, so root-cause traversal only fires when the error surfaces at
  // a database node. Other root-cause shapes (config drift, version skew
  // between services) would key off different node types and live behind a
  // separate dispatch.
  if (startAttrs.type !== NodeType.DatabaseNode) return null
  const targetDb = startAttrs as DatabaseNode

  const walk = longestIncomingWalk(graph, errorNodeId, ROOT_CAUSE_MAX_DEPTH)

  let rootCauseNode: string | null = null
  let rootCauseReason: string | null = null
  let fixRecommendation: string | undefined

  // Pairs that could possibly hit on this engine — narrowed once outside the
  // walk so we don't re-scan the matrix for every service we visit.
  const candidatePairs = compatPairs().filter((p) => p.engine === targetDb.engine)
  if (candidatePairs.length === 0) return null

  outer: for (const id of walk.path) {
    const attrs = graph.getNodeAttributes(id) as GraphNode
    if (attrs.type !== NodeType.ServiceNode) continue
    const svc = attrs as ServiceNode
    const deps = svc.dependencies ?? {}
    for (const pair of candidatePairs) {
      const declared = deps[pair.driver]
      if (!declared) continue
      const result = checkCompatibility(
        pair.driver,
        declared,
        targetDb.engine,
        targetDb.engineVersion,
      )
      if (!result.compatible) {
        rootCauseNode = id
        rootCauseReason = result.reason ?? 'incompatible driver'
        if (result.minDriverVersion) {
          fixRecommendation = `Upgrade ${svc.name} ${pair.driver} driver to >= ${result.minDriverVersion}`
        }
        break outer
      }
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
