// Tool implementations. Each one takes an HttpClient + the validated input and
// returns an MCP CallToolResult (always shape `{ content: [{ type, text }] }`).
// Keeping these as pure functions of (client, input) means tests don't need a
// running server — just a stub client that returns canned JSON.

import type {
  BlastRadiusAffectedNode,
  BlastRadiusResult,
  ErrorEvent,
  GraphEdge,
  GraphNode,
  RootCauseResult,
} from '@neat/types'
import { Provenance } from '@neat/types'
import { HttpError, type HttpClient } from './client.js'

export interface ToolResponse {
  [x: string]: unknown
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

function text(s: string): ToolResponse {
  return { content: [{ type: 'text', text: s }] }
}

function errorText(s: string): ToolResponse {
  return { content: [{ type: 'text', text: s }], isError: true }
}

// Most tools want "node missing → friendly message, anything else → real error".
async function withMissingNodeFallback(
  fn: () => Promise<ToolResponse>,
  notFoundMessage: string,
): Promise<ToolResponse> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      return text(notFoundMessage)
    }
    return errorText(`Error talking to neat-core: ${(err as Error).message}`)
  }
}

export interface RootCauseInput {
  errorNode: string
  errorId?: string
}

export async function getRootCause(client: HttpClient, input: RootCauseInput): Promise<ToolResponse> {
  const qs = input.errorId ? `?errorId=${encodeURIComponent(input.errorId)}` : ''
  const path = `/traverse/root-cause/${encodeURIComponent(input.errorNode)}${qs}`

  return withMissingNodeFallback(async () => {
    const result = await client.get<RootCauseResult>(path)
    const arrowPath = result.traversalPath.join(' ← ')
    const provenances = result.edgeProvenances.length
      ? result.edgeProvenances.join(', ')
      : '(direct, no edges traversed)'
    const lines = [
      `Root cause identified: ${result.rootCauseNode}.`,
      result.rootCauseReason,
      '',
      `Traversal path: ${arrowPath}`,
      `Edge provenances: ${provenances}`,
      `Confidence: ${result.confidence.toFixed(2)}`,
    ]
    if (result.fixRecommendation) {
      lines.push('', `Recommended fix: ${result.fixRecommendation}`)
    }
    return text(lines.join('\n'))
  }, `No root cause found for ${input.errorNode}. The node may be healthy, or it may not exist in the graph.`)
}

export interface BlastRadiusInput {
  nodeId: string
  depth?: number
}

export async function getBlastRadius(
  client: HttpClient,
  input: BlastRadiusInput,
): Promise<ToolResponse> {
  const qs = input.depth !== undefined ? `?depth=${input.depth}` : ''
  const path = `/traverse/blast-radius/${encodeURIComponent(input.nodeId)}${qs}`

  return withMissingNodeFallback(async () => {
    const result = await client.get<BlastRadiusResult>(path)
    if (result.totalAffected === 0) {
      return text(
        `${result.origin} has no downstream dependencies. Nothing else would break if it failed.`,
      )
    }
    const sorted = [...result.affectedNodes].sort(
      (a, b) => a.distance - b.distance || a.nodeId.localeCompare(b.nodeId),
    )
    const lines = [`Blast radius for ${result.origin} (${result.totalAffected} affected):`, '']
    for (const n of sorted) {
      lines.push(formatBlastEntry(n))
    }
    return text(lines.join('\n'))
  }, `Node ${input.nodeId} not found in the graph.`)
}

function formatBlastEntry(n: BlastRadiusAffectedNode): string {
  const tag = n.edgeProvenance === Provenance.STALE ? ' [STALE — last seen too long ago]' : ''
  return `  • ${n.nodeId} (distance ${n.distance}, ${n.edgeProvenance})${tag}`
}

interface EdgesResponse {
  inbound: GraphEdge[]
  outbound: GraphEdge[]
}

export interface DependenciesInput {
  nodeId: string
}

export async function getDependencies(
  client: HttpClient,
  input: DependenciesInput,
): Promise<ToolResponse> {
  return withMissingNodeFallback(async () => {
    const edges = await client.get<EdgesResponse>(
      `/graph/edges/${encodeURIComponent(input.nodeId)}`,
    )
    const outbound = edges.outbound
    if (outbound.length === 0) {
      return text(`${input.nodeId} has no outgoing dependencies in the graph.`)
    }
    const lines = [`Dependencies of ${input.nodeId}:`, '']
    for (const e of dedupeBestProvenance(outbound)) {
      lines.push(`  • ${e.target} — ${e.type} (${e.provenance})${edgeMeta(e)}`)
    }
    return text(lines.join('\n'))
  }, `Node ${input.nodeId} not found in the graph.`)
}

export async function getObservedDependencies(
  client: HttpClient,
  input: DependenciesInput,
): Promise<ToolResponse> {
  return withMissingNodeFallback(async () => {
    const edges = await client.get<EdgesResponse>(
      `/graph/edges/${encodeURIComponent(input.nodeId)}`,
    )
    const observed = edges.outbound.filter((e) => e.provenance === Provenance.OBSERVED)
    if (observed.length === 0) {
      const hasExtracted = edges.outbound.some((e) => e.provenance === Provenance.EXTRACTED)
      const note = hasExtracted
        ? ' Static (EXTRACTED) dependencies exist but no runtime traffic has been seen — is OTel running?'
        : ''
      return text(`No OBSERVED dependencies for ${input.nodeId}.${note}`)
    }
    const lines = [`Runtime dependencies of ${input.nodeId} (OBSERVED):`, '']
    for (const e of observed) {
      lines.push(`  • ${e.target} — ${e.type}${edgeMeta(e)}`)
    }
    return text(lines.join('\n'))
  }, `Node ${input.nodeId} not found in the graph.`)
}

function edgeMeta(e: GraphEdge): string {
  const bits: string[] = []
  if (e.signal) {
    // Prefer the runtime signal numbers — "saw 1,247 calls, 3 errors" reads
    // better than a derived 0.94 confidence.
    bits.push(`spans=${e.signal.spanCount}`)
    if (e.signal.errorCount > 0) bits.push(`errors=${e.signal.errorCount}`)
    if (e.signal.lastObservedAgeMs !== undefined) {
      bits.push(`age=${formatDuration(e.signal.lastObservedAgeMs)}`)
    }
  } else if (e.callCount !== undefined) {
    bits.push(`callCount=${e.callCount}`)
  }
  if (e.lastObserved) bits.push(`lastObserved=${e.lastObserved}`)
  if (e.confidence !== undefined) bits.push(`confidence=${e.confidence}`)
  return bits.length ? ` [${bits.join(', ')}]` : ''
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

// Two services can have an EXTRACTED edge AND an OBSERVED edge AND an INFERRED
// edge between the same pair. For "dependencies" output we want one line per
// (target, type), preferring the most-trustworthy provenance.
function dedupeBestProvenance(edges: GraphEdge[]): GraphEdge[] {
  const rank: Record<string, number> = {
    OBSERVED: 3,
    INFERRED: 2,
    EXTRACTED: 1,
    STALE: 0,
    FRONTIER: 0,
  }
  const best = new Map<string, GraphEdge>()
  for (const e of edges) {
    const key = `${e.target}|${e.type}`
    const cur = best.get(key)
    if (!cur || rank[e.provenance] > rank[cur.provenance]) best.set(key, e)
  }
  return [...best.values()]
}

export interface IncidentHistoryInput {
  nodeId: string
  limit?: number
}

export async function getIncidentHistory(
  client: HttpClient,
  input: IncidentHistoryInput,
): Promise<ToolResponse> {
  return withMissingNodeFallback(async () => {
    const events = await client.get<ErrorEvent[]>(
      `/incidents/${encodeURIComponent(input.nodeId)}`,
    )
    if (events.length === 0) {
      return text(`No incidents recorded against ${input.nodeId}.`)
    }
    // ndjson order is append-time = oldest first. Reverse so the most recent
    // event leads, then trim to the requested limit.
    const ordered = [...events].reverse().slice(0, input.limit ?? 20)
    const lines = [
      `Recent incidents on ${input.nodeId} (${ordered.length} of ${events.length}):`,
      '',
    ]
    for (const ev of ordered) {
      lines.push(`  ${ev.timestamp} — ${ev.service}: ${ev.errorMessage}`)
      lines.push(`    trace=${ev.traceId} span=${ev.spanId}`)
    }
    return text(lines.join('\n'))
  }, `Node ${input.nodeId} not found in the graph.`)
}

export interface SemanticSearchInput {
  query: string
}

interface SearchResponse {
  query: string
  provider?: 'ollama' | 'transformers' | 'substring'
  matches: (GraphNode & { score?: number })[]
}

export async function semanticSearch(
  client: HttpClient,
  input: SemanticSearchInput,
): Promise<ToolResponse> {
  try {
    const result = await client.get<SearchResponse>(
      `/search?q=${encodeURIComponent(input.query)}`,
    )
    if (result.matches.length === 0) {
      return text(`No matches for "${input.query}".`)
    }
    const provider = result.provider ?? 'substring'
    const lines = [
      `Search results for "${input.query}" (${provider}):`,
      '',
    ]
    for (const n of result.matches) {
      // Embedding tiers attach a cosine score in [0,1]; substring fallback
      // doesn't, so we elide the score when it's the placeholder 1.
      const scoreBit =
        provider !== 'substring' && typeof n.score === 'number'
          ? ` [score=${n.score.toFixed(2)}]`
          : ''
      lines.push(`  • ${n.id} (${n.type}) — ${(n as { name?: string }).name ?? n.id}${scoreBit}`)
    }
    return text(lines.join('\n'))
  } catch (err) {
    return errorText(`Error talking to neat-core: ${(err as Error).message}`)
  }
}

export interface GraphDiffInput {
  againstSnapshot: string
}

interface GraphDiffResponse {
  base: { exportedAt?: string }
  current: { exportedAt: string }
  added: { nodes: GraphNode[]; edges: GraphEdge[] }
  removed: { nodes: GraphNode[]; edges: GraphEdge[] }
  changed: {
    nodes: { id: string; before: GraphNode; after: GraphNode }[]
    edges: { id: string; before: GraphEdge; after: GraphEdge }[]
  }
}

export async function getGraphDiff(
  client: HttpClient,
  input: GraphDiffInput,
): Promise<ToolResponse> {
  try {
    const result = await client.get<GraphDiffResponse>(
      `/graph/diff?against=${encodeURIComponent(input.againstSnapshot)}`,
    )
    const total =
      result.added.nodes.length +
      result.added.edges.length +
      result.removed.nodes.length +
      result.removed.edges.length +
      result.changed.nodes.length +
      result.changed.edges.length
    const baseLabel = result.base.exportedAt ?? 'unknown'
    if (total === 0) {
      return text(
        `No differences between the current graph and ${input.againstSnapshot} (base exportedAt=${baseLabel}).`,
      )
    }
    const lines = [
      `Diff against ${input.againstSnapshot}:`,
      `  base exportedAt:    ${baseLabel}`,
      `  current exportedAt: ${result.current.exportedAt}`,
      '',
    ]
    if (result.added.nodes.length || result.added.edges.length) {
      lines.push('Added:')
      for (const n of result.added.nodes) lines.push(`  + node ${n.id} (${n.type})`)
      for (const e of result.added.edges)
        lines.push(`  + edge ${e.id} — ${e.source} -> ${e.target} (${e.type}, ${e.provenance})`)
      lines.push('')
    }
    if (result.removed.nodes.length || result.removed.edges.length) {
      lines.push('Removed:')
      for (const n of result.removed.nodes) lines.push(`  - node ${n.id} (${n.type})`)
      for (const e of result.removed.edges)
        lines.push(`  - edge ${e.id} — ${e.source} -> ${e.target} (${e.type}, ${e.provenance})`)
      lines.push('')
    }
    if (result.changed.nodes.length || result.changed.edges.length) {
      lines.push('Changed:')
      for (const c of result.changed.nodes) {
        lines.push(`  ~ node ${c.id} — ${summariseAttrDiff(c.before, c.after)}`)
      }
      for (const c of result.changed.edges) {
        const provBit =
          c.before.provenance !== c.after.provenance
            ? `provenance ${c.before.provenance} → ${c.after.provenance}`
            : summariseAttrDiff(c.before, c.after)
        lines.push(`  ~ edge ${c.id} — ${provBit}`)
      }
    }
    return text(lines.join('\n').trimEnd())
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) {
      return errorText(`Could not load snapshot ${input.againstSnapshot}: ${err.message}`)
    }
    return errorText(`Error talking to neat-core: ${(err as Error).message}`)
  }
}

function summariseAttrDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k)
  }
  return changed.length === 0
    ? 'attributes differ'
    : `fields changed: ${changed.sort().join(', ')}`
}

export interface RecentStaleEdgesInput {
  limit?: number
  edgeType?: string
}

interface StaleEventResponse {
  edgeId: string
  source: string
  target: string
  edgeType: string
  thresholdMs: number
  ageMs: number
  lastObserved: string
  transitionedAt: string
}

export async function getRecentStaleEdges(
  client: HttpClient,
  input: RecentStaleEdgesInput,
): Promise<ToolResponse> {
  const params = new URLSearchParams()
  if (input.limit !== undefined) params.set('limit', String(input.limit))
  if (input.edgeType) params.set('edgeType', input.edgeType)
  const qs = params.size > 0 ? `?${params.toString()}` : ''

  try {
    const events = await client.get<StaleEventResponse[]>(`/incidents/stale${qs}`)
    if (events.length === 0) {
      return text(
        input.edgeType
          ? `No stale ${input.edgeType} edges recorded.`
          : 'No stale-edge transitions recorded yet.',
      )
    }
    const lines = [`Recent stale-edge transitions (${events.length}):`, '']
    for (const e of events) {
      lines.push(
        `  ${e.transitionedAt} — ${e.source} -[${e.edgeType}]-> ${e.target}` +
          ` (last seen ${e.lastObserved}, threshold ${formatDuration(e.thresholdMs)})`,
      )
    }
    return text(lines.join('\n'))
  } catch (err) {
    return errorText(`Error talking to neat-core: ${(err as Error).message}`)
  }
}
