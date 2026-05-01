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
  if (e.callCount !== undefined) bits.push(`callCount=${e.callCount}`)
  if (e.lastObserved) bits.push(`lastObserved=${e.lastObserved}`)
  if (e.confidence !== undefined) bits.push(`confidence=${e.confidence}`)
  return bits.length ? ` [${bits.join(', ')}]` : ''
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
  matches: GraphNode[]
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
    const lines = [`Search results for "${input.query}":`, '']
    for (const n of result.matches) {
      lines.push(`  • ${n.id} (${n.type}) — ${n.name}`)
    }
    return text(lines.join('\n'))
  } catch (err) {
    return errorText(`Error talking to neat-core: ${(err as Error).message}`)
  }
}
