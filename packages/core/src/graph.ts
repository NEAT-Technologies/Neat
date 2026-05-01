import { MultiDirectedGraph } from 'graphology'
import type { GraphEdge, GraphNode } from '@neat/types'

// Multi because two nodes can have edges of different types simultaneously
// (e.g. CALLS and DEPENDS_ON between the same pair of services).
export type NeatGraph = MultiDirectedGraph<GraphNode, GraphEdge>

let instance: NeatGraph | null = null

export function getGraph(): NeatGraph {
  if (!instance) {
    instance = new MultiDirectedGraph<GraphNode, GraphEdge>({
      allowSelfLoops: false,
    })
  }
  return instance
}

export function resetGraph(): void {
  instance = null
}
