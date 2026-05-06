// Tool implementations. Each one takes an HttpClient + the validated input and
// returns an MCP CallToolResult routed through formatToolResponse for the
// three-part shape (NL + structured + footer) per ADR-039 / contract #12.
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
import {
  formatEmptyResponse,
  formatErrorResponse,
  formatToolResponse,
  type ToolResponse,
} from './format.js'

export type { ToolResponse } from './format.js'

// Project-aware path builder. When `project` is set, route through
// /projects/<name>/...; otherwise hit the legacy root URL (which the core
// resolves to project=`default`). Keeping the legacy path means callers
// running an older core still talk to a known route.
function projectPath(project: string | undefined, suffix: string): string {
  if (!project) return suffix
  return `/projects/${encodeURIComponent(project)}${suffix}`
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
      return formatEmptyResponse(notFoundMessage)
    }
    return formatErrorResponse(`Error talking to neat-core: ${(err as Error).message}`)
  }
}

export interface RootCauseInput {
  errorNode: string
  errorId?: string
  project?: string
}

export async function getRootCause(client: HttpClient, input: RootCauseInput): Promise<ToolResponse> {
  const qs = input.errorId ? `?errorId=${encodeURIComponent(input.errorId)}` : ''
  const path = projectPath(
    input.project,
    `/traverse/root-cause/${encodeURIComponent(input.errorNode)}${qs}`,
  )

  return withMissingNodeFallback(async () => {
    const result = await client.get<RootCauseResult>(path)
    const arrowPath = result.traversalPath.join(' ← ')
    const provenances = result.edgeProvenances.length
      ? result.edgeProvenances.join(', ')
      : '(direct, no edges traversed)'
    const summary =
      `Root cause for ${input.errorNode} is ${result.rootCauseNode}. ` +
      result.rootCauseReason +
      (result.fixRecommendation ? ` Recommended fix: ${result.fixRecommendation}.` : '')
    const blockLines = [
      `Traversal path: ${arrowPath}`,
      `Edge provenances: ${provenances}`,
    ]
    if (result.fixRecommendation) {
      blockLines.push(`Recommended fix: ${result.fixRecommendation}`)
    }
    return formatToolResponse({
      summary,
      block: blockLines.join('\n'),
      confidence: result.confidence,
      provenance: result.edgeProvenances.length ? result.edgeProvenances : undefined,
    })
  }, `No root cause found for ${input.errorNode}. The node may be healthy, or it may not exist in the graph.`)
}

export interface BlastRadiusInput {
  nodeId: string
  depth?: number
  project?: string
}

export async function getBlastRadius(
  client: HttpClient,
  input: BlastRadiusInput,
): Promise<ToolResponse> {
  const qs = input.depth !== undefined ? `?depth=${input.depth}` : ''
  const path = projectPath(
    input.project,
    `/traverse/blast-radius/${encodeURIComponent(input.nodeId)}${qs}`,
  )

  return withMissingNodeFallback(async () => {
    const result = await client.get<BlastRadiusResult>(path)
    if (result.totalAffected === 0) {
      return formatEmptyResponse(
        `${result.origin} has no downstream dependencies. Nothing else would break if it failed.`,
      )
    }
    const sorted = [...result.affectedNodes].sort(
      (a, b) => a.distance - b.distance || a.nodeId.localeCompare(b.nodeId),
    )
    const blockLines = sorted.map(formatBlastEntry)
    // Worst-case confidence — the path with the lowest cascaded confidence
    // is the headline number; agents should treat this as "what's the
    // weakest reachability NEAT actually knows about?"
    const minConfidence = sorted.reduce(
      (m, n) => Math.min(m, n.confidence),
      Number.POSITIVE_INFINITY,
    )
    const provenances = [...new Set(sorted.map((n) => n.edgeProvenance))]
    return formatToolResponse({
      summary: `Blast radius for ${result.origin}: ${result.totalAffected} affected node${result.totalAffected === 1 ? '' : 's'} reachable downstream.`,
      block: blockLines.join('\n'),
      confidence: Number.isFinite(minConfidence) ? minConfidence : undefined,
      provenance: provenances.length ? provenances : undefined,
    })
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
  project?: string
}

export async function getDependencies(
  client: HttpClient,
  input: DependenciesInput,
): Promise<ToolResponse> {
  return withMissingNodeFallback(async () => {
    const edges = await client.get<EdgesResponse>(
      projectPath(input.project, `/graph/edges/${encodeURIComponent(input.nodeId)}`),
    )
    const outbound = edges.outbound
    if (outbound.length === 0) {
      return formatEmptyResponse(`${input.nodeId} has no outgoing dependencies in the graph.`)
    }
    const deduped = dedupeBestProvenance(outbound)
    const blockLines = deduped.map(
      (e) => `  • ${e.target} — ${e.type} (${e.provenance})${edgeMeta(e)}`,
    )
    const provenances = [...new Set(deduped.map((e) => e.provenance))]
    return formatToolResponse({
      summary: `${input.nodeId} has ${deduped.length} dependenc${deduped.length === 1 ? 'y' : 'ies'} in the graph.`,
      block: blockLines.join('\n'),
      provenance: provenances,
    })
  }, `Node ${input.nodeId} not found in the graph.`)
}

export async function getObservedDependencies(
  client: HttpClient,
  input: DependenciesInput,
): Promise<ToolResponse> {
  return withMissingNodeFallback(async () => {
    const edges = await client.get<EdgesResponse>(
      projectPath(input.project, `/graph/edges/${encodeURIComponent(input.nodeId)}`),
    )
    const observed = edges.outbound.filter((e) => e.provenance === Provenance.OBSERVED)
    if (observed.length === 0) {
      const hasExtracted = edges.outbound.some((e) => e.provenance === Provenance.EXTRACTED)
      const note = hasExtracted
        ? ' Static (EXTRACTED) dependencies exist but no runtime traffic has been seen — is OTel running?'
        : ''
      return formatEmptyResponse(`No OBSERVED dependencies for ${input.nodeId}.${note}`)
    }
    const blockLines = observed.map((e) => `  • ${e.target} — ${e.type}${edgeMeta(e)}`)
    return formatToolResponse({
      summary: `${input.nodeId} has ${observed.length} runtime dependenc${observed.length === 1 ? 'y' : 'ies'} confirmed by OTel.`,
      block: blockLines.join('\n'),
      provenance: Provenance.OBSERVED,
    })
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
  project?: string
}

export async function getIncidentHistory(
  client: HttpClient,
  input: IncidentHistoryInput,
): Promise<ToolResponse> {
  return withMissingNodeFallback(async () => {
    const events = await client.get<ErrorEvent[]>(
      projectPath(input.project, `/incidents/${encodeURIComponent(input.nodeId)}`),
    )
    if (events.length === 0) {
      return formatEmptyResponse(`No incidents recorded against ${input.nodeId}.`)
    }
    // ndjson order is append-time = oldest first. Reverse so the most recent
    // event leads, then trim to the requested limit.
    const ordered = [...events].reverse().slice(0, input.limit ?? 20)
    const blockLines: string[] = []
    for (const ev of ordered) {
      blockLines.push(`  ${ev.timestamp} — ${ev.service}: ${ev.errorMessage}`)
      blockLines.push(`    trace=${ev.traceId} span=${ev.spanId}`)
    }
    return formatToolResponse({
      summary: `${input.nodeId} has ${events.length} recorded incident${events.length === 1 ? '' : 's'}; showing the ${ordered.length} most recent.`,
      block: blockLines.join('\n'),
      // ErrorEvents are observation records, not graph edges — provenance is
      // OBSERVED by definition (the OTel span happened).
      provenance: Provenance.OBSERVED,
    })
  }, `Node ${input.nodeId} not found in the graph.`)
}

export interface SemanticSearchInput {
  query: string
  project?: string
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
      projectPath(input.project, `/search?q=${encodeURIComponent(input.query)}`),
    )
    if (result.matches.length === 0) {
      return formatEmptyResponse(`No matches for "${input.query}".`)
    }
    const provider = result.provider ?? 'substring'
    const blockLines: string[] = []
    let topScore: number | undefined
    for (const n of result.matches) {
      // Embedding tiers attach a cosine score in [0,1]; substring fallback
      // doesn't, so we elide the score when it's the placeholder 1.
      const score = provider !== 'substring' && typeof n.score === 'number' ? n.score : undefined
      const scoreBit = score !== undefined ? ` [score=${score.toFixed(2)}]` : ''
      if (score !== undefined && (topScore === undefined || score > topScore)) topScore = score
      blockLines.push(
        `  • ${n.id} (${n.type}) — ${(n as { name?: string }).name ?? n.id}${scoreBit}`,
      )
    }
    return formatToolResponse({
      summary: `Found ${result.matches.length} match${result.matches.length === 1 ? '' : 'es'} for "${input.query}" via ${provider} provider.`,
      block: blockLines.join('\n'),
      // Top similarity score doubles as a "how confident is the embedder
      // about the best match" signal. Substring provider returns no score —
      // the footer shows n/a in that case.
      confidence: topScore,
    })
  } catch (err) {
    return formatErrorResponse(`Error talking to neat-core: ${(err as Error).message}`)
  }
}

export interface GraphDiffInput {
  againstSnapshot: string
  project?: string
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
      projectPath(
        input.project,
        `/graph/diff?against=${encodeURIComponent(input.againstSnapshot)}`,
      ),
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
      return formatEmptyResponse(
        `No differences between the current graph and ${input.againstSnapshot} (base exportedAt=${baseLabel}).`,
      )
    }
    const blockLines: string[] = [
      `  base exportedAt:    ${baseLabel}`,
      `  current exportedAt: ${result.current.exportedAt}`,
      '',
    ]
    if (result.added.nodes.length || result.added.edges.length) {
      blockLines.push('Added:')
      for (const n of result.added.nodes) blockLines.push(`  + node ${n.id} (${n.type})`)
      for (const e of result.added.edges)
        blockLines.push(`  + edge ${e.id} — ${e.source} -> ${e.target} (${e.type}, ${e.provenance})`)
      blockLines.push('')
    }
    if (result.removed.nodes.length || result.removed.edges.length) {
      blockLines.push('Removed:')
      for (const n of result.removed.nodes) blockLines.push(`  - node ${n.id} (${n.type})`)
      for (const e of result.removed.edges)
        blockLines.push(`  - edge ${e.id} — ${e.source} -> ${e.target} (${e.type}, ${e.provenance})`)
      blockLines.push('')
    }
    if (result.changed.nodes.length || result.changed.edges.length) {
      blockLines.push('Changed:')
      for (const c of result.changed.nodes) {
        blockLines.push(`  ~ node ${c.id} — ${summariseAttrDiff(c.before, c.after)}`)
      }
      for (const c of result.changed.edges) {
        const provBit =
          c.before.provenance !== c.after.provenance
            ? `provenance ${c.before.provenance} → ${c.after.provenance}`
            : summariseAttrDiff(c.before, c.after)
        blockLines.push(`  ~ edge ${c.id} — ${provBit}`)
      }
    }
    return formatToolResponse({
      summary: `Diff against ${input.againstSnapshot}: ${total} change${total === 1 ? '' : 's'} between the snapshot and the live graph.`,
      block: blockLines.join('\n').trimEnd(),
      // Diff results don't have a per-result provenance — the diff spans
      // every edge type and provenance kind. Footer shows n/a.
    })
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) {
      return formatErrorResponse(
        `Could not load snapshot ${input.againstSnapshot}: ${err.message}`,
      )
    }
    return formatErrorResponse(`Error talking to neat-core: ${(err as Error).message}`)
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
  project?: string
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
    const events = await client.get<StaleEventResponse[]>(
      projectPath(input.project, `/incidents/stale${qs}`),
    )
    if (events.length === 0) {
      return formatEmptyResponse(
        input.edgeType
          ? `No stale ${input.edgeType} edges recorded.`
          : 'No stale-edge transitions recorded yet.',
      )
    }
    const blockLines = events.map(
      (e) =>
        `  ${e.transitionedAt} — ${e.source} -[${e.edgeType}]-> ${e.target}` +
        ` (last seen ${e.lastObserved}, threshold ${formatDuration(e.thresholdMs)})`,
    )
    return formatToolResponse({
      summary: `${events.length} stale-edge transition${events.length === 1 ? '' : 's'} recorded${input.edgeType ? ` for ${input.edgeType}` : ''}.`,
      block: blockLines.join('\n'),
      // STALE by definition — every event is a transition into STALE.
      provenance: Provenance.STALE,
    })
  } catch (err) {
    return formatErrorResponse(`Error talking to neat-core: ${(err as Error).message}`)
  }
}
