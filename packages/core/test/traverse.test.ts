import { describe, it, expect } from 'vitest'
import { MultiDirectedGraph } from 'graphology'
import {
  EdgeType,
  NodeType,
  Provenance,
  type ErrorEvent,
  type GraphEdge,
  type GraphNode,
} from '@neat/types'
import type { NeatGraph } from '../src/graph.js'
import { getBlastRadius, getRootCause } from '../src/traverse.js'

function makeNode(id: string, attrs: GraphNode): GraphNode {
  return { ...attrs, id }
}

function newDemoGraph(): NeatGraph {
  const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
  g.addNode(
    'service:service-a',
    makeNode('service:service-a', {
      id: 'service:service-a',
      type: NodeType.ServiceNode,
      name: 'service-a',
      language: 'javascript',
    }),
  )
  g.addNode(
    'service:service-b',
    makeNode('service:service-b', {
      id: 'service:service-b',
      type: NodeType.ServiceNode,
      name: 'service-b',
      language: 'javascript',
      dependencies: { pg: '7.4.0' },
    }),
  )
  g.addNode(
    'database:payments-db',
    makeNode('database:payments-db', {
      id: 'database:payments-db',
      type: NodeType.DatabaseNode,
      name: 'payments',
      engine: 'postgresql',
      engineVersion: '15',
      compatibleDrivers: [{ name: 'pg', minVersion: '8.0.0' }],
    }),
  )
  return g
}

function addEdge(g: NeatGraph, e: GraphEdge): void {
  g.addEdgeWithKey(e.id, e.source, e.target, e)
}

function callsEdge(provenance: GraphEdge['provenance'], suffix = ''): GraphEdge {
  const id =
    provenance === Provenance.EXTRACTED
      ? `${EdgeType.CALLS}:service:service-a->service:service-b`
      : `${EdgeType.CALLS}:${provenance}${suffix}:service:service-a->service:service-b`
  return {
    id,
    source: 'service:service-a',
    target: 'service:service-b',
    type: EdgeType.CALLS,
    provenance,
  }
}

function connectsEdge(provenance: GraphEdge['provenance'], suffix = ''): GraphEdge {
  const id =
    provenance === Provenance.EXTRACTED
      ? `${EdgeType.CONNECTS_TO}:service:service-b->database:payments-db`
      : `${EdgeType.CONNECTS_TO}:${provenance}${suffix}:service:service-b->database:payments-db`
  return {
    id,
    source: 'service:service-b',
    target: 'database:payments-db',
    type: EdgeType.CONNECTS_TO,
    provenance,
  }
}

describe('getRootCause', () => {
  it('returns the pg-driver mismatch with the full incoming path on the demo graph', () => {
    const g = newDemoGraph()
    addEdge(g, callsEdge(Provenance.EXTRACTED))
    addEdge(g, connectsEdge(Provenance.EXTRACTED))

    const result = getRootCause(g, 'database:payments-db')
    expect(result).not.toBeNull()
    expect(result!.rootCauseNode).toBe('service:service-b')
    expect(result!.traversalPath).toEqual([
      'database:payments-db',
      'service:service-b',
      'service:service-a',
    ])
    expect(result!.rootCauseReason).toMatch(/pg|scram|postgres/i)
    expect(result!.fixRecommendation).toMatch(/8\.0\.0/)
  })

  it('reports confidence 0.5 when every edge along the path is EXTRACTED only', () => {
    const g = newDemoGraph()
    addEdge(g, callsEdge(Provenance.EXTRACTED))
    addEdge(g, connectsEdge(Provenance.EXTRACTED))

    const result = getRootCause(g, 'database:payments-db')
    expect(result!.confidence).toBe(0.5)
    expect(result!.edgeProvenances).toEqual([Provenance.EXTRACTED, Provenance.EXTRACTED])
  })

  it('reports confidence 1.0 when both edges along the path are OBSERVED', () => {
    const g = newDemoGraph()
    addEdge(g, callsEdge(Provenance.EXTRACTED))
    addEdge(g, connectsEdge(Provenance.EXTRACTED))
    addEdge(g, callsEdge(Provenance.OBSERVED))
    addEdge(g, connectsEdge(Provenance.OBSERVED))

    const result = getRootCause(g, 'database:payments-db')
    expect(result!.confidence).toBe(1.0)
    expect(result!.edgeProvenances).toEqual([Provenance.OBSERVED, Provenance.OBSERVED])
  })

  it('reports confidence 0.7 when any edge along the path is INFERRED', () => {
    const g = newDemoGraph()
    addEdge(g, callsEdge(Provenance.EXTRACTED))
    addEdge(g, callsEdge(Provenance.OBSERVED))
    // Only an INFERRED CONNECTS_TO exists for service-b -> db (the pg < 8 case).
    addEdge(g, connectsEdge(Provenance.INFERRED))

    const result = getRootCause(g, 'database:payments-db')
    expect(result!.confidence).toBe(0.7)
    // OBSERVED CALLS beats EXTRACTED CALLS; INFERRED is the only CONNECTS_TO option.
    expect(result!.edgeProvenances).toEqual([Provenance.INFERRED, Provenance.OBSERVED])
  })

  it('colours rootCauseReason with the observed error message when one is supplied', () => {
    const g = newDemoGraph()
    addEdge(g, callsEdge(Provenance.EXTRACTED))
    addEdge(g, connectsEdge(Provenance.EXTRACTED))

    const ev: ErrorEvent = {
      id: 'trace-1:span-b',
      timestamp: new Date().toISOString(),
      service: 'service-b',
      traceId: 'trace-1',
      spanId: 'span-b',
      errorMessage: 'SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string',
      affectedNode: 'database:payments-db',
    }
    const result = getRootCause(g, 'database:payments-db', ev)
    expect(result!.rootCauseReason).toContain('SCRAM')
  })

  it('returns null when the error node does not exist in the graph', () => {
    const g = newDemoGraph()
    addEdge(g, connectsEdge(Provenance.EXTRACTED))
    expect(getRootCause(g, 'database:does-not-exist')).toBeNull()
  })

  it('returns null when the error node is not a database', () => {
    const g = newDemoGraph()
    addEdge(g, callsEdge(Provenance.EXTRACTED))
    addEdge(g, connectsEdge(Provenance.EXTRACTED))
    expect(getRootCause(g, 'service:service-a')).toBeNull()
  })

  it('returns null when no service in the path has a known incompatibility', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:happy', {
      id: 'service:happy',
      type: NodeType.ServiceNode,
      name: 'happy',
      language: 'javascript',
      dependencies: { pg: '8.11.0' },
    })
    g.addNode('database:payments-db', {
      id: 'database:payments-db',
      type: NodeType.DatabaseNode,
      name: 'payments',
      engine: 'postgresql',
      engineVersion: '15',
      compatibleDrivers: [{ name: 'pg', minVersion: '8.0.0' }],
    })
    g.addEdgeWithKey(
      'CONNECTS_TO:service:happy->database:payments-db',
      'service:happy',
      'database:payments-db',
      {
        id: 'CONNECTS_TO:service:happy->database:payments-db',
        source: 'service:happy',
        target: 'database:payments-db',
        type: EdgeType.CONNECTS_TO,
        provenance: Provenance.EXTRACTED,
      },
    )
    expect(getRootCause(g, 'database:payments-db')).toBeNull()
  })

  it('finds a mysql2 / MySQL 8 incompatibility — second failure scenario, no code change required', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:orders', {
      id: 'service:orders',
      type: NodeType.ServiceNode,
      name: 'orders',
      language: 'javascript',
      dependencies: { mysql2: '1.7.0' },
    })
    g.addNode('database:orders-db', {
      id: 'database:orders-db',
      type: NodeType.DatabaseNode,
      name: 'orders',
      engine: 'mysql',
      engineVersion: '8',
      compatibleDrivers: [{ name: 'mysql2', minVersion: '3.0.0' }],
    })
    g.addEdgeWithKey(
      'CONNECTS_TO:service:orders->database:orders-db',
      'service:orders',
      'database:orders-db',
      {
        id: 'CONNECTS_TO:service:orders->database:orders-db',
        source: 'service:orders',
        target: 'database:orders-db',
        type: EdgeType.CONNECTS_TO,
        provenance: Provenance.EXTRACTED,
      },
    )

    const result = getRootCause(g, 'database:orders-db')
    expect(result).not.toBeNull()
    expect(result!.rootCauseNode).toBe('service:orders')
    expect(result!.rootCauseReason).toMatch(/mysql|caching_sha2/i)
    expect(result!.fixRecommendation).toMatch(/mysql2/)
    expect(result!.fixRecommendation).toMatch(/3\.0\.0/)
  })

  it('reads driver versions out of dependencies', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:reports', {
      id: 'service:reports',
      type: NodeType.ServiceNode,
      name: 'reports',
      language: 'javascript',
      dependencies: { pg: '7.4.0' },
    })
    g.addNode('database:reports-db', {
      id: 'database:reports-db',
      type: NodeType.DatabaseNode,
      name: 'reports',
      engine: 'postgresql',
      engineVersion: '15',
      compatibleDrivers: [{ name: 'pg', minVersion: '8.0.0' }],
    })
    g.addEdgeWithKey(
      'CONNECTS_TO:service:reports->database:reports-db',
      'service:reports',
      'database:reports-db',
      {
        id: 'CONNECTS_TO:service:reports->database:reports-db',
        source: 'service:reports',
        target: 'database:reports-db',
        type: EdgeType.CONNECTS_TO,
        provenance: Provenance.EXTRACTED,
      },
    )

    const result = getRootCause(g, 'database:reports-db')
    expect(result).not.toBeNull()
    expect(result!.rootCauseNode).toBe('service:reports')
    expect(result!.fixRecommendation).toMatch(/pg/)
  })
})

describe('getBlastRadius', () => {
  it('returns service-b and payments-db downstream of service-a on the demo graph', () => {
    const g = newDemoGraph()
    addEdge(g, callsEdge(Provenance.EXTRACTED))
    addEdge(g, connectsEdge(Provenance.EXTRACTED))

    const result = getBlastRadius(g, 'service:service-a')
    expect(result.origin).toBe('service:service-a')
    expect(result.totalAffected).toBe(2)
    expect(result.affectedNodes).toEqual([
      {
        nodeId: 'service:service-b',
        distance: 1,
        edgeProvenance: Provenance.EXTRACTED,
      },
      {
        nodeId: 'database:payments-db',
        distance: 2,
        edgeProvenance: Provenance.EXTRACTED,
      },
    ])
  })

  it('reports OBSERVED provenance when an OBSERVED edge sits alongside the EXTRACTED one', () => {
    const g = newDemoGraph()
    addEdge(g, callsEdge(Provenance.EXTRACTED))
    addEdge(g, callsEdge(Provenance.OBSERVED))
    addEdge(g, connectsEdge(Provenance.EXTRACTED))
    addEdge(g, connectsEdge(Provenance.OBSERVED))

    const result = getBlastRadius(g, 'service:service-a')
    expect(result.affectedNodes.find((n) => n.nodeId === 'service:service-b')!.edgeProvenance).toBe(
      Provenance.OBSERVED,
    )
    expect(
      result.affectedNodes.find((n) => n.nodeId === 'database:payments-db')!.edgeProvenance,
    ).toBe(Provenance.OBSERVED)
  })

  it('returns nothing for a node with no outgoing edges', () => {
    const g = newDemoGraph()
    addEdge(g, callsEdge(Provenance.EXTRACTED))
    addEdge(g, connectsEdge(Provenance.EXTRACTED))

    const result = getBlastRadius(g, 'database:payments-db')
    expect(result.affectedNodes).toEqual([])
    expect(result.totalAffected).toBe(0)
    expect(result.origin).toBe('database:payments-db')
  })

  it('returns an empty result for a node that does not exist', () => {
    const g = newDemoGraph()
    const result = getBlastRadius(g, 'service:nope')
    expect(result.affectedNodes).toEqual([])
    expect(result.totalAffected).toBe(0)
    expect(result.origin).toBe('service:nope')
  })

  it('respects the depth limit', () => {
    const g = newDemoGraph()
    addEdge(g, callsEdge(Provenance.EXTRACTED))
    addEdge(g, connectsEdge(Provenance.EXTRACTED))

    const result = getBlastRadius(g, 'service:service-a', 1)
    expect(result.affectedNodes).toEqual([
      {
        nodeId: 'service:service-b',
        distance: 1,
        edgeProvenance: Provenance.EXTRACTED,
      },
    ])
  })

  it('records the BFS-shortest distance when two paths reach the same node', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:a', {
      id: 'service:a',
      type: NodeType.ServiceNode,
      name: 'a',
      language: 'javascript',
    })
    g.addNode('service:b', {
      id: 'service:b',
      type: NodeType.ServiceNode,
      name: 'b',
      language: 'javascript',
    })
    g.addNode('service:c', {
      id: 'service:c',
      type: NodeType.ServiceNode,
      name: 'c',
      language: 'javascript',
    })
    // a -> c (direct, distance 1) and a -> b -> c (distance 2). Direct should win.
    g.addEdgeWithKey('CALLS:service:a->service:c', 'service:a', 'service:c', {
      id: 'CALLS:service:a->service:c',
      source: 'service:a',
      target: 'service:c',
      type: EdgeType.CALLS,
      provenance: Provenance.EXTRACTED,
    })
    g.addEdgeWithKey('CALLS:service:a->service:b', 'service:a', 'service:b', {
      id: 'CALLS:service:a->service:b',
      source: 'service:a',
      target: 'service:b',
      type: EdgeType.CALLS,
      provenance: Provenance.EXTRACTED,
    })
    g.addEdgeWithKey('CALLS:service:b->service:c', 'service:b', 'service:c', {
      id: 'CALLS:service:b->service:c',
      source: 'service:b',
      target: 'service:c',
      type: EdgeType.CALLS,
      provenance: Provenance.EXTRACTED,
    })

    const result = getBlastRadius(g, 'service:a')
    const c = result.affectedNodes.find((n) => n.nodeId === 'service:c')
    expect(c!.distance).toBe(1)
  })
})
