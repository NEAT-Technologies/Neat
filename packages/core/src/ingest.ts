import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ErrorEvent, FrontierNode, GraphEdge, ServiceNode } from '@neat/types'
import {
  EdgeType,
  NodeType,
  Provenance,
  databaseId,
  extractedEdgeId,
  frontierEdgeId,
  frontierId,
  inferredEdgeId,
  observedEdgeId,
  serviceId,
  type EdgeTypeValue,
} from '@neat/types'
import type { NeatGraph } from './graph.js'
import type { ParsedSpan } from './otel.js'

// Maps OTel spans to graph signal:
//   * Cross-service span → upsert CALLS edge.
//   * Database span (db.system attr present) → upsert CONNECTS_TO edge to a
//     DatabaseNode resolved by host.
//   * Span with status.code === 2 → ErrorEvent appended to errors.ndjson.
//
// Contract anchors (see /docs/contracts.md):
//   * Rule 1 — Provenance: every edge here carries Provenance.X from @neat/types.
//   * Rule 2 — Coexistence: OBSERVED edges live alongside EXTRACTED ones with a
//     distinct id pattern (`${type}:OBSERVED:src->tgt`). Never write OBSERVED
//     under the EXTRACTED id; that erases the gap NEAT exists to surface.
//   * Rule 4 — Per-edge-type staleness (ADR-024): STALE_THRESHOLDS_BY_EDGE_TYPE
//     governs decay; never hardcode a flat 24h threshold.
//   * Rule 8 — No demo names: derive driver/engine identifiers from node
//     properties, not literals.

export interface IngestContext {
  graph: NeatGraph
  errorsPath: string
  now?: () => number
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// Per-edge-type stale thresholds. HTTP CALLS at 24h is meaningless because
// healthy traffic recurs in seconds; infra DEPENDS_ON is the opposite — a
// docker-compose service can sit idle overnight without anything being wrong.
// Override via NEAT_STALE_THRESHOLDS (JSON, ms-per-edge-type).
const DEFAULT_STALE_THRESHOLDS: Record<string, number> = {
  CALLS: HOUR_MS,
  CONNECTS_TO: 4 * HOUR_MS,
  PUBLISHES_TO: 4 * HOUR_MS,
  CONSUMES_FROM: 4 * HOUR_MS,
  DEPENDS_ON: DAY_MS,
  CONFIGURED_BY: DAY_MS,
  RUNS_ON: DAY_MS,
}
// Fallback for any edge type not in the map (forward compat — adding a new
// EdgeType shouldn't break staleness sweeps).
const FALLBACK_STALE_THRESHOLD_MS = DAY_MS

function loadStaleThresholdsFromEnv(): Record<string, number> {
  const raw = process.env.NEAT_STALE_THRESHOLDS
  if (!raw) return DEFAULT_STALE_THRESHOLDS
  try {
    const overrides = JSON.parse(raw) as Record<string, unknown>
    const merged = { ...DEFAULT_STALE_THRESHOLDS }
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) merged[k] = v
    }
    return merged
  } catch (err) {
    console.warn(
      `[neat] NEAT_STALE_THRESHOLDS could not be parsed (${(err as Error).message}); using defaults`,
    )
    return DEFAULT_STALE_THRESHOLDS
  }
}

export function thresholdForEdgeType(
  edgeType: string,
  overrides?: Record<string, number>,
): number {
  const map = overrides ?? loadStaleThresholdsFromEnv()
  return map[edgeType] ?? FALLBACK_STALE_THRESHOLD_MS
}

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

// Edge id helpers live in @neat/types/identity.ts (ADR-029). The local
// signatures below preserve the (type, source, target) argument order ingest.ts
// has used historically while delegating to the canonical wire-format helpers.
function makeObservedEdgeId(type: EdgeTypeValue, source: string, target: string): string {
  return observedEdgeId(source, target, type)
}

function makeInferredEdgeId(type: EdgeTypeValue, source: string, target: string): string {
  return inferredEdgeId(source, target, type)
}

const INFERRED_CONFIDENCE = 0.6
const STITCH_MAX_DEPTH = 2

function resolveServiceId(graph: NeatGraph, host: string): string | null {
  const direct = serviceId(host)
  if (graph.hasNode(direct)) return direct

  // Service hostnames in the demo can match either the package name (which the
  // node id is built from) or the directory basename — handled by the name
  // check below. Beyond that, anything in `aliases` (compose service names,
  // k8s metadata.name + cluster-DNS variants, Dockerfile labels) should
  // resolve too. Population happens in the extract phases; consumption is
  // here.
  let found: string | null = null
  graph.forEachNode((id, attrs) => {
    if (found) return
    const a = attrs as ServiceNode & { type?: string }
    if (a.type !== NodeType.ServiceNode) return
    if (a.name === host) {
      found = id
      return
    }
    if (a.aliases && a.aliases.includes(host)) {
      found = id
    }
  })
  return found
}

export function frontierIdFor(host: string): string {
  return frontierId(host)
}

function ensureFrontierNode(graph: NeatGraph, host: string, ts: string): string {
  const id = frontierIdFor(host)
  if (graph.hasNode(id)) {
    const existing = graph.getNodeAttributes(id) as FrontierNode
    graph.replaceNodeAttributes(id, { ...existing, lastObserved: ts })
    return id
  }
  const node: FrontierNode = {
    id,
    type: NodeType.FrontierNode,
    name: host,
    host,
    firstObserved: ts,
    lastObserved: ts,
  }
  graph.addNode(id, node)
  return id
}

function upsertFrontierEdge(
  graph: NeatGraph,
  type: EdgeTypeValue,
  source: string,
  target: string,
  ts: string,
): void {
  const id = frontierEdgeId(source, target, type)
  if (graph.hasEdge(id)) {
    const existing = graph.getEdgeAttributes(id) as GraphEdge
    const updated: GraphEdge = {
      ...existing,
      provenance: Provenance.FRONTIER,
      lastObserved: ts,
      callCount: (existing.callCount ?? 0) + 1,
    }
    graph.replaceEdgeAttributes(id, updated)
    return
  }
  const edge: GraphEdge = {
    id,
    source,
    target,
    type,
    provenance: Provenance.FRONTIER,
    confidence: 1.0,
    lastObserved: ts,
    callCount: 1,
  }
  graph.addEdgeWithKey(id, source, target, edge)
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
  isError = false,
): UpsertResult | null {
  if (!graph.hasNode(source) || !graph.hasNode(target)) return null

  const id = makeObservedEdgeId(type, source, target)
  if (graph.hasEdge(id)) {
    const existing = graph.getEdgeAttributes(id) as GraphEdge
    const newSpanCount = (existing.signal?.spanCount ?? existing.callCount ?? 0) + 1
    const newErrorCount = (existing.signal?.errorCount ?? 0) + (isError ? 1 : 0)
    const updated: GraphEdge = {
      ...existing,
      provenance: Provenance.OBSERVED,
      lastObserved: ts,
      callCount: newSpanCount,
      signal: {
        spanCount: newSpanCount,
        errorCount: newErrorCount,
        lastObservedAgeMs: 0,
      },
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
    signal: {
      spanCount: 1,
      errorCount: isError ? 1 : 0,
      lastObservedAgeMs: 0,
    },
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

      // OBSERVED twin already covers this hop with ground truth — no inference
      // needed (ADR-034). Stomping it with INFERRED erases the gap NEAT exists
      // to surface; skipping it keeps the OBSERVED edge as the authoritative
      // record and avoids cluttering the graph with a redundant INFERRED twin.
      if (graph.hasEdge(observedEdgeId(edge.source, edge.target, edge.type))) continue

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
  // lastObserved derives from the span's own startTime per ADR-033 — replayed
  // traces and out-of-order spans get a timestamp that reflects when the call
  // actually fired, not when the receiver received it. Wall-clock is only the
  // fallback for spans whose startTimeUnixNano is missing or unparseable.
  const ts = span.startTimeIso ?? nowIso(ctx)
  const sourceId = serviceId(span.service)
  const isError = span.statusCode === 2

  let affectedNode = sourceId

  if (span.dbSystem) {
    // Database span — try to resolve the DatabaseNode by host.
    const host = pickAddress(span)
    if (host) {
      const targetId = databaseId(host)
      const result = upsertObservedEdge(
        ctx.graph,
        EdgeType.CONNECTS_TO,
        sourceId,
        targetId,
        ts,
        isError,
      )
      if (result) affectedNode = targetId
    }
  } else {
    // Possibly a cross-service call. Resolve the peer; if it matches a known
    // ServiceNode, record an OBSERVED CALLS edge. If it matches nothing — pod
    // IP, ingress hostname, AWS PrivateLink endpoint — drop a FRONTIER
    // placeholder so the call isn't lost. promoteFrontierNodes (run by the
    // extract orchestrator) replaces it once a later round records the host
    // as an alias on a real service.
    const host = pickAddress(span)
    if (host && host !== span.service) {
      const targetId = resolveServiceId(ctx.graph, host)
      if (targetId && targetId !== sourceId) {
        upsertObservedEdge(
          ctx.graph,
          EdgeType.CALLS,
          sourceId,
          targetId,
          ts,
          isError,
        )
        affectedNode = targetId
      } else if (!targetId) {
        const frontierId = ensureFrontierNode(ctx.graph, host, ts)
        if (ctx.graph.hasNode(sourceId)) {
          upsertFrontierEdge(ctx.graph, EdgeType.CALLS, sourceId, frontierId, ts)
        }
        affectedNode = frontierId
      }
    }
  }

  if (span.statusCode === 2) {
    stitchTrace(ctx.graph, sourceId, ts)
    // Exception event data (richer than status.message) wins when present,
    // per ADR-033's exception-data-from-span-events rule.
    const ev: ErrorEvent = {
      id: `${span.traceId}:${span.spanId}`,
      timestamp: ts,
      service: span.service,
      traceId: span.traceId,
      spanId: span.spanId,
      errorMessage:
        span.exception?.message ?? span.errorMessage ?? span.name ?? 'unknown error',
      ...(span.exception?.type ? { exceptionType: span.exception.type } : {}),
      ...(span.exception?.stacktrace
        ? { exceptionStacktrace: span.exception.stacktrace }
        : {}),
      affectedNode,
    }
    await appendErrorEvent(ctx, ev)
  }
}

export { stitchTrace }

// Promote any frontier:<host> placeholder whose host matches an alias on a
// real ServiceNode: re-link inbound/outbound edges to the service, then drop
// the placeholder. Returns the count of nodes promoted, for tests + logs.
//
// Called at the end of every extraction round. Static rounds are when new
// aliases land (compose names, k8s metadata.name, Dockerfile labels), so
// running it there picks up the case the issue describes: ingest fills in a
// frontier when traffic arrives for an unknown host, and the next extraction
// round resolves it.
export function promoteFrontierNodes(graph: NeatGraph): number {
  const aliasIndex = new Map<string, string>()
  graph.forEachNode((id, attrs) => {
    const a = attrs as ServiceNode & { type?: string }
    if (a.type !== NodeType.ServiceNode) return
    aliasIndex.set(a.name, id)
    if (a.aliases) {
      for (const alias of a.aliases) aliasIndex.set(alias, id)
    }
  })

  const toPromote: { frontierId: string; serviceId: string }[] = []
  graph.forEachNode((id, attrs) => {
    const a = attrs as FrontierNode & { type?: string }
    if (a.type !== NodeType.FrontierNode) return
    const target = aliasIndex.get(a.host)
    if (!target) return
    if (target === id) return
    toPromote.push({ frontierId: id, serviceId: target })
  })

  for (const { frontierId, serviceId } of toPromote) {
    rewireFrontierEdges(graph, frontierId, serviceId)
    graph.dropNode(frontierId)
  }
  return toPromote.length
}

function rewireFrontierEdges(graph: NeatGraph, frontierId: string, serviceId: string): void {
  const inbound = [...graph.inboundEdges(frontierId)]
  const outbound = [...graph.outboundEdges(frontierId)]

  for (const edgeId of inbound) {
    const edge = graph.getEdgeAttributes(edgeId) as GraphEdge
    rebuildEdge(graph, edge, edge.source, serviceId, edgeId)
  }
  for (const edgeId of outbound) {
    const edge = graph.getEdgeAttributes(edgeId) as GraphEdge
    rebuildEdge(graph, edge, serviceId, edge.target, edgeId)
  }
}

function rebuildEdge(
  graph: NeatGraph,
  edge: GraphEdge,
  newSource: string,
  newTarget: string,
  oldEdgeId: string,
): void {
  graph.dropEdge(oldEdgeId)
  // FRONTIER provenance gets upgraded to OBSERVED on promotion: the call
  // certainty was always there; only the target identity was unknown, and now
  // it isn't.
  const promotedProvenance =
    edge.provenance === Provenance.FRONTIER ? Provenance.OBSERVED : edge.provenance
  const newId =
    promotedProvenance === Provenance.OBSERVED
      ? observedEdgeId(newSource, newTarget, edge.type)
      : promotedProvenance === Provenance.INFERRED
        ? inferredEdgeId(newSource, newTarget, edge.type)
        : promotedProvenance === Provenance.EXTRACTED
          ? extractedEdgeId(newSource, newTarget, edge.type)
          : frontierEdgeId(newSource, newTarget, edge.type)

  if (graph.hasEdge(newId)) {
    const existing = graph.getEdgeAttributes(newId) as GraphEdge
    const merged: GraphEdge = {
      ...existing,
      callCount: (existing.callCount ?? 0) + (edge.callCount ?? 0),
      lastObserved: pickLater(existing.lastObserved, edge.lastObserved),
    }
    graph.replaceEdgeAttributes(newId, merged)
    return
  }

  const rebuilt: GraphEdge = {
    ...edge,
    id: newId,
    source: newSource,
    target: newTarget,
    provenance: promotedProvenance,
  }
  graph.addEdgeWithKey(newId, newSource, newTarget, rebuilt)
}

function pickLater(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b
  if (!b) return a
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

export function makeSpanHandler(ctx: IngestContext): (span: ParsedSpan) => Promise<void> {
  return (span) => handleSpan(ctx, span)
}

export interface StaleEvent {
  edgeId: string
  source: string
  target: string
  edgeType: string
  thresholdMs: number
  ageMs: number
  lastObserved: string
  transitionedAt: string
}

export interface MarkStaleOptions {
  // Per-edge-type override map. Defaults to DEFAULT_STALE_THRESHOLDS, merged
  // with NEAT_STALE_THRESHOLDS if the env var is set.
  thresholds?: Record<string, number>
  now?: number
  // ndjson path. When set, every OBSERVED → STALE transition appends one
  // line. Skipped if undefined — tests and embedded use cases don't need a
  // log.
  staleEventsPath?: string
}

// Demote OBSERVED edges that haven't been seen in a while. Per-edge-type
// thresholds: HTTP CALLS go stale fast; infra DEPENDS_ON is patient. Returns
// the count of demotions and the events appended to the log.
export async function markStaleEdges(
  graph: NeatGraph,
  options: MarkStaleOptions = {},
): Promise<{ count: number; events: StaleEvent[] }> {
  const thresholds = options.thresholds ?? loadStaleThresholdsFromEnv()
  const now = options.now ?? Date.now()
  const events: StaleEvent[] = []

  graph.forEachEdge((id, attrs) => {
    const e = attrs as GraphEdge
    if (e.provenance !== Provenance.OBSERVED) return
    if (!e.lastObserved) return
    const threshold = thresholdForEdgeType(e.type, thresholds)
    const age = now - new Date(e.lastObserved).getTime()
    if (age > threshold) {
      const updated: GraphEdge = { ...e, provenance: Provenance.STALE, confidence: 0.3 }
      graph.replaceEdgeAttributes(id, updated)
      events.push({
        edgeId: id,
        source: e.source,
        target: e.target,
        edgeType: e.type,
        thresholdMs: threshold,
        ageMs: age,
        lastObserved: e.lastObserved,
        transitionedAt: new Date(now).toISOString(),
      })
    }
  })

  if (options.staleEventsPath && events.length > 0) {
    await appendStaleEvents(options.staleEventsPath, events)
  }

  return { count: events.length, events }
}

async function appendStaleEvents(staleEventsPath: string, events: StaleEvent[]): Promise<void> {
  await fs.mkdir(path.dirname(staleEventsPath), { recursive: true })
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  await fs.appendFile(staleEventsPath, lines, 'utf8')
}

export async function readStaleEvents(staleEventsPath: string): Promise<StaleEvent[]> {
  try {
    const raw = await fs.readFile(staleEventsPath, 'utf8')
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as StaleEvent)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export interface StalenessLoopOptions {
  thresholds?: Record<string, number>
  intervalMs?: number
  staleEventsPath?: string
}

export function startStalenessLoop(
  graph: NeatGraph,
  options: StalenessLoopOptions = {},
): () => void {
  let stopped = false
  const intervalMs = options.intervalMs ?? 60_000
  const tick = (): void => {
    if (stopped) return
    void (async () => {
      try {
        await markStaleEdges(graph, {
          thresholds: options.thresholds,
          staleEventsPath: options.staleEventsPath,
        })
      } catch (err) {
        console.error('staleness tick failed', err)
      }
    })()
  }
  const interval = setInterval(tick, intervalMs)
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
