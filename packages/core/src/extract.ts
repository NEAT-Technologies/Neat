import type { NeatGraph } from './graph.js'

export interface ExtractResult {
  nodesAdded: number
  edgesAdded: number
}

// Just a stub for now. Real tree-sitter extraction lands in #4.
export async function extractFromDirectory(
  _graph: NeatGraph,
  _path: string,
): Promise<ExtractResult> {
  return { nodesAdded: 0, edgesAdded: 0 }
}
