import { promises as fs } from 'node:fs'
import type { GraphEdge, GraphNode } from '@neat.is/types'
import type { NeatGraph } from './graph.js'

// Diff a snapshot on disk (or fetched over HTTP) against the live in-memory
// graph. The "base" is the snapshot you supplied; the "current" is whatever
// the server has loaded right now. Symmetric in shape, but consumers usually
// want to read it as "what changed since base."
//
// The shape mirrors the issue's spec (#77):
//   { added: { nodes, edges }, removed: { nodes, edges },
//     changed: { nodes: [{id, before, after}], edges: [{id, before, after}] } }
//
// Both timestamps are echoed back so the caller doesn't have to track them
// separately.

interface PersistedNodeEntry {
  key?: string
  attributes?: Record<string, unknown>
}

interface PersistedEdgeEntry {
  key?: string
  source?: string
  target?: string
  attributes?: Record<string, unknown>
}

export interface PersistedSnapshot {
  schemaVersion?: number
  exportedAt?: string
  graph?: {
    nodes?: PersistedNodeEntry[]
    edges?: PersistedEdgeEntry[]
  }
}

export interface GraphDiff {
  base: { exportedAt?: string }
  current: { exportedAt: string }
  added: { nodes: GraphNode[]; edges: GraphEdge[] }
  removed: { nodes: GraphNode[]; edges: GraphEdge[] }
  changed: {
    nodes: { id: string; before: GraphNode; after: GraphNode }[]
    edges: { id: string; before: GraphEdge; after: GraphEdge }[]
  }
}

export async function loadSnapshotForDiff(target: string): Promise<PersistedSnapshot> {
  if (/^https?:\/\//i.test(target)) {
    const res = await fetch(target)
    if (!res.ok) {
      throw new Error(`fetch ${target} failed: ${res.status} ${res.statusText}`)
    }
    return (await res.json()) as PersistedSnapshot
  }
  const raw = await fs.readFile(target, 'utf8')
  return JSON.parse(raw) as PersistedSnapshot
}

function indexEntries<T>(
  entries: { key?: string; attributes?: Record<string, unknown> }[] | undefined,
): Map<string, T> {
  const m = new Map<string, T>()
  if (!entries) return m
  for (const entry of entries) {
    const id = (entry.attributes?.id as string | undefined) ?? entry.key
    if (!id) continue
    m.set(id, entry.attributes as T)
  }
  return m
}

export function computeGraphDiff(
  liveGraph: NeatGraph,
  baseSnapshot: PersistedSnapshot,
  currentExportedAt: string = new Date().toISOString(),
): GraphDiff {
  const baseNodes = indexEntries<GraphNode>(baseSnapshot.graph?.nodes)
  const baseEdges = indexEntries<GraphEdge>(baseSnapshot.graph?.edges)

  const liveNodes = new Map<string, GraphNode>()
  liveGraph.forEachNode((id, attrs) => liveNodes.set(id, attrs as GraphNode))
  const liveEdges = new Map<string, GraphEdge>()
  liveGraph.forEachEdge((id, attrs) => liveEdges.set(id, attrs as GraphEdge))

  const result: GraphDiff = {
    base: { exportedAt: baseSnapshot.exportedAt },
    current: { exportedAt: currentExportedAt },
    added: { nodes: [], edges: [] },
    removed: { nodes: [], edges: [] },
    changed: { nodes: [], edges: [] },
  }

  for (const [id, after] of liveNodes) {
    const before = baseNodes.get(id)
    if (!before) {
      result.added.nodes.push(after)
    } else if (!shallowEqual(before, after)) {
      result.changed.nodes.push({ id, before, after })
    }
  }
  for (const [id, before] of baseNodes) {
    if (!liveNodes.has(id)) result.removed.nodes.push(before)
  }
  for (const [id, after] of liveEdges) {
    const before = baseEdges.get(id)
    if (!before) {
      result.added.edges.push(after)
    } else if (!shallowEqual(before, after)) {
      result.changed.edges.push({ id, before, after })
    }
  }
  for (const [id, before] of baseEdges) {
    if (!liveEdges.has(id)) result.removed.edges.push(before)
  }

  return result
}

// Stable JSON comparison. Snapshot order isn't guaranteed, so canonicalising
// keys before stringify keeps the comparison robust against re-ordered fields.
function shallowEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k]
          return acc
        }, {})
    }
    return v
  })
}
