import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ErrorEvent, GraphEdge } from '@neat/types'
import { EdgeType, NodeType, Provenance, type EdgeTypeValue } from '@neat/types'
import type { NeatGraph } from './graph.js'
import type { ParsedSpan } from './otel.js'

// Maps OTel spans to graph signal:
//   * Cross-service span → upsert CALLS edge.
//   * Database span (db.system attr present) → upsert CONNECTS_TO edge to a
//     DatabaseNode resolved by host.
//   * Span with status.code === 2 → ErrorEvent appended to errors.ndjson.
//
// Observed edges live alongside extracted ones with a distinct id pattern
// (`${type}:OBSERVED:...`) so static and runtime signal coexist instead of
// stomping each other. Provenance, lastObserved, callCount, and confidence
// are set on the OBSERVED edge; the static edge is untouched.

export interface IngestContext {
  graph: NeatGraph
  errorsPath: string
  now?: () => number
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

function nowIso(ctx: IngestContext): string {
  return new Date(ctx.now ? ctx.now() : Date.now()).toISOString()
}

function pickAttr(span: ParsedSpan, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = span.attributes[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return undefined
}

function hostFromUrl(u: string | undefined): string | undefined {
  if (!u) return undefined
  try {
    return new URL(u).hostname
  } catch {
    return undefined
  }
}

// OTel HTTP/db semconv has gone through several names for "the host on the
// other end of this call." Try the modern ones first, fall back to the legacy
// ones, then last resort parse out of a full URL.
function pickAddress(span: ParsedSpan): string | undefined {
  return (
    pickAttr(span, 'server.address', 'net.peer.name', 'net.host.name') ??
    hostFromUrl(pickAttr(span, 'url.full', 'http.url'))
  )
}

function makeObservedEdgeId(type: EdgeTypeValue, source: string, target: string): string {
  return `${type}:OBSERVED:${source}->${target}`
}

function makeInferredEdgeId(type: EdgeTypeValue, source: string, target: string): string {
  return `${type}:INFERRED:${source}->${target}`
}

const INFERRED_CONFIDENCE = 0.6
const STITCH_MAX_DEPTH = 2

function resolveServiceId(graph: NeatGraph, host: string): string | null {
  const direct = `service:${host}`
  if (graph.hasNode(direct)) return direct

  // Service hostnames in the demo can match either the package name (which the
  // node id is built from) or the directory basename. We've already tried the
  // direct id; fall back to scanning service nodes for a matching name.
  let found: string | null = null
  graph.forEachNode((id, attrs) => {
    if (found) return
    const a = attrs as { type?: string; name?: string }
    if (a.type === NodeType.ServiceNode && a.name === host) found = id
  })
  return found
}

interface UpsertResult {
  edge: GraphEdge
  created: boolean
}

function upsertObservedEdge(
  graph: NeatGraph,
  type: EdgeTypeValue,
  source: string,
  target: string,
  ts: string,
): UpsertResult | null {
  if (!graph.hasNode(source) || !graph.hasNode(target)) return null

  const id = makeObservedEdgeId(type, source, target)
  if (graph.hasEdge(id)) {
    const existing = graph.getEdgeAttributes(id) as GraphEdge
    const updated: GraphEdge = {
      ...existing,
      provenance: Provenance.OBSERVED,
      lastObserved: ts,
      callCount: (existing.callCount ?? 0) + 1,
      confidence: 1.0,
    }
    graph.replaceEdgeAttributes(id, updated)
    return { edge: updated, created: false }
  }

  const edge: GraphEdge = {
    id,
    source,
    target,
    type,
    provenance: Provenance.OBSERVED,
    confidence: 1.0,
    lastObserved: ts,
    callCount: 1,
  }
  graph.addEdgeWithKey(id, source, target, edge)
  return { edge, created: true }
}

// When a span errors, the system is exercising its dependencies right now even
// if some of them aren't auto-instrumented (pg 7.4.0 in the demo, see ADR-014).
// Walk EXTRACTED edges out from the erroring service for a couple of hops and
// promote them to INFERRED twins so traversal can prefer them over the bare
// static edges without claiming OBSERVED-grade certainty.
function stitchTrace(graph: NeatGraph, sourceServiceId: string, ts: string): void {
  if (!graph.hasNode(sourceServiceId)) return

  const visited = new Set<string>([sourceServiceId])
  const queue: { nodeId: string; depth: number }[] = [{ nodeId: sourceServiceId, depth: 0 }]

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!
    if (depth >= STITCH_MAX_DEPTH) continue

    const outbound = graph.outboundEdges(nodeId)
    for (const edgeId of outbound) {
      const edge = graph.getEdgeAttributes(edgeId) as GraphEdge
      if (edge.provenance !== Provenance.EXTRACTED) continue

      upsertInferredEdge(graph, edge.type, edge.source, edge.target, ts)

      if (!visited.has(edge.target)) {
        visited.add(edge.target)
        queue.push({ nodeId: edge.target, depth: depth + 1 })
      }
    }
  }
}

function upsertInferredEdge(
  graph: NeatGraph,
  type: EdgeTypeValue,
  source: string,
  target: string,
  ts: string,
): void {
  const id = makeInferredEdgeId(type, source, target)
  if (graph.hasEdge(id)) {
    const existing = graph.getEdgeAttributes(id) as GraphEdge
    const updated: GraphEdge = { ...existing, lastObserved: ts }
    graph.replaceEdgeAttributes(id, updated)
    return
  }

  const edge: GraphEdge = {
    id,
    source,
    target,
    type,
    provenance: Provenance.INFERRED,
    confidence: INFERRED_CONFIDENCE,
    lastObserved: ts,
  }
  graph.addEdgeWithKey(id, source, target, edge)
}

async function appendErrorEvent(ctx: IngestContext, ev: ErrorEvent): Promise<void> {
  await fs.mkdir(path.dirname(ctx.errorsPath), { recursive: true })
  await fs.appendFile(ctx.errorsPath, JSON.stringify(ev) + '\n', 'utf8')
}

export async function handleSpan(ctx: IngestContext, span: ParsedSpan): Promise<void> {
  const ts = nowIso(ctx)
  const sourceId = `service:${span.service}`

  let affectedNode = sourceId

  if (span.dbSystem) {
    // Database span — try to resolve the DatabaseNode by host.
    const host = pickAddress(span)
    if (host) {
      const targetId = `database:${host}`
      const result = upsertObservedEdge(ctx.graph, EdgeType.CONNECTS_TO, sourceId, targetId, ts)
      if (result) affectedNode = targetId
    }
  } else {
    // Possibly a cross-service call — only if the address resolves to a known
    // service node, and isn't ourselves.
    const host = pickAddress(span)
    if (host && host !== span.service) {
      const targetId = resolveServiceId(ctx.graph, host)
      if (targetId && targetId !== sourceId) {
        upsertObservedEdge(ctx.graph, EdgeType.CALLS, sourceId, targetId, ts)
        affectedNode = targetId
      }
    }
  }

  if (span.statusCode === 2) {
    stitchTrace(ctx.graph, sourceId, ts)
    const ev: ErrorEvent = {
      id: `${span.traceId}:${span.spanId}`,
      timestamp: ts,
      service: span.service,
      traceId: span.traceId,
      spanId: span.spanId,
      errorMessage: span.errorMessage ?? span.name ?? 'unknown error',
      affectedNode,
    }
    await appendErrorEvent(ctx, ev)
  }
}

export { stitchTrace }

export function makeSpanHandler(ctx: IngestContext): (span: ParsedSpan) => Promise<void> {
  return (span) => handleSpan(ctx, span)
}

// Demote OBSERVED edges that haven't been seen in a while. Returns the count
// of demotions for visibility in tests + logs.
export function markStaleEdges(
  graph: NeatGraph,
  thresholdMs = STALE_THRESHOLD_MS,
  now = Date.now(),
): number {
  let count = 0
  graph.forEachEdge((id, attrs) => {
    const e = attrs as GraphEdge
    if (e.provenance !== Provenance.OBSERVED) return
    if (!e.lastObserved) return
    const age = now - new Date(e.lastObserved).getTime()
    if (age > thresholdMs) {
      const updated: GraphEdge = { ...e, provenance: Provenance.STALE, confidence: 0.3 }
      graph.replaceEdgeAttributes(id, updated)
      count++
    }
  })
  return count
}

export function startStalenessLoop(
  graph: NeatGraph,
  thresholdMs = STALE_THRESHOLD_MS,
  intervalMs = 60_000,
): () => void {
  let stopped = false
  const tick = (): void => {
    if (stopped) return
    try {
      markStaleEdges(graph, thresholdMs)
    } catch (err) {
      console.error('staleness tick failed', err)
    }
  }
  const interval = setInterval(tick, intervalMs)
  // Don't keep the process alive just for this.
  if (typeof interval.unref === 'function') interval.unref()
  return () => {
    stopped = true
    clearInterval(interval)
  }
}

export async function readErrorEvents(errorsPath: string): Promise<ErrorEvent[]> {
  try {
    const raw = await fs.readFile(errorsPath, 'utf8')
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ErrorEvent)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}
