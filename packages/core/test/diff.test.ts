import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MultiDirectedGraph } from 'graphology'
import {
  EdgeType,
  type GraphEdge,
  type GraphNode,
  NodeType,
  Provenance,
} from '@neat/types'
import { computeGraphDiff, loadSnapshotForDiff } from '../src/diff.js'
import { saveGraphToDisk } from '../src/persist.js'
import type { NeatGraph } from '../src/graph.js'

function newGraph(): NeatGraph {
  return new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
}

function addServiceA(g: NeatGraph): void {
  g.addNode('service:service-a', {
    id: 'service:service-a',
    type: NodeType.ServiceNode,
    name: 'service-a',
    language: 'javascript',
  })
}

function addServiceB(g: NeatGraph): void {
  g.addNode('service:service-b', {
    id: 'service:service-b',
    type: NodeType.ServiceNode,
    name: 'service-b',
    language: 'javascript',
  })
}

describe('computeGraphDiff', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'neat-diff-'))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('reports an added node, no removed, and a changed edge', async () => {
    // Base = service-a + service-b + EXTRACTED edge between them
    const baseGraph = newGraph()
    addServiceA(baseGraph)
    addServiceB(baseGraph)
    baseGraph.addEdgeWithKey(
      'CALLS:service:service-a->service:service-b',
      'service:service-a',
      'service:service-b',
      {
        id: 'CALLS:service:service-a->service:service-b',
        source: 'service:service-a',
        target: 'service:service-b',
        type: EdgeType.CALLS,
        provenance: Provenance.EXTRACTED,
      },
    )
    const basePath = path.join(tmp, 'base.json')
    await saveGraphToDisk(baseGraph, basePath)

    // Current = base + an extra service-c, and the original edge is now STALE
    const currentGraph = newGraph()
    addServiceA(currentGraph)
    addServiceB(currentGraph)
    currentGraph.addNode('service:service-c', {
      id: 'service:service-c',
      type: NodeType.ServiceNode,
      name: 'service-c',
      language: 'javascript',
    })
    currentGraph.addEdgeWithKey(
      'CALLS:service:service-a->service:service-b',
      'service:service-a',
      'service:service-b',
      {
        id: 'CALLS:service:service-a->service:service-b',
        source: 'service:service-a',
        target: 'service:service-b',
        type: EdgeType.CALLS,
        provenance: Provenance.STALE,
        confidence: 0.3,
      },
    )

    const baseSnapshot = await loadSnapshotForDiff(basePath)
    const diff = computeGraphDiff(currentGraph, baseSnapshot)

    expect(diff.base.exportedAt).toBeTruthy()
    expect(diff.current.exportedAt).toBeTruthy()
    expect(diff.added.nodes.map((n) => n.id)).toEqual(['service:service-c'])
    expect(diff.added.edges).toEqual([])
    expect(diff.removed.nodes).toEqual([])
    expect(diff.removed.edges).toEqual([])
    expect(diff.changed.edges).toHaveLength(1)
    expect(diff.changed.edges[0].id).toBe('CALLS:service:service-a->service:service-b')
    expect(diff.changed.edges[0].before.provenance).toBe(Provenance.EXTRACTED)
    expect(diff.changed.edges[0].after.provenance).toBe(Provenance.STALE)
  })

  it('reports a removed node when the live graph dropped it', async () => {
    const baseGraph = newGraph()
    addServiceA(baseGraph)
    addServiceB(baseGraph)
    const basePath = path.join(tmp, 'base.json')
    await saveGraphToDisk(baseGraph, basePath)

    const currentGraph = newGraph()
    addServiceA(currentGraph)

    const diff = computeGraphDiff(currentGraph, await loadSnapshotForDiff(basePath))
    expect(diff.removed.nodes.map((n) => n.id)).toEqual(['service:service-b'])
    expect(diff.added.nodes).toEqual([])
  })

  it('returns an empty diff for two structurally identical graphs', async () => {
    const baseGraph = newGraph()
    addServiceA(baseGraph)
    addServiceB(baseGraph)
    const basePath = path.join(tmp, 'base.json')
    await saveGraphToDisk(baseGraph, basePath)

    const currentGraph = newGraph()
    addServiceA(currentGraph)
    addServiceB(currentGraph)

    const diff = computeGraphDiff(currentGraph, await loadSnapshotForDiff(basePath))
    expect(diff.added.nodes).toEqual([])
    expect(diff.added.edges).toEqual([])
    expect(diff.removed.nodes).toEqual([])
    expect(diff.removed.edges).toEqual([])
    expect(diff.changed.nodes).toEqual([])
    expect(diff.changed.edges).toEqual([])
  })
})

describe('loadSnapshotForDiff', () => {
  it('reads a local snapshot file', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'neat-diff-load-'))
    try {
      const g = newGraph()
      addServiceA(g)
      const p = path.join(tmp, 's.json')
      await saveGraphToDisk(g, p)
      const snap = await loadSnapshotForDiff(p)
      expect(snap.exportedAt).toBeTruthy()
      expect(snap.graph?.nodes?.length).toBe(1)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
