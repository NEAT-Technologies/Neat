import type { GraphEdge } from '@neat.is/types'
import { Provenance } from '@neat.is/types'
import type { NeatGraph } from '../graph.js'

// Drop every EXTRACTED edge whose evidence.file matches the given path.
// Called from watch.ts before re-running an extract phase, so the producer's
// idempotent re-write recreates only the edges that still apply. Edges from
// the deleted code stay deleted. See docs/contracts/static-extraction.md
// §Ghost-edge cleanup. Mutation authority lives under extract/* per
// ADR-030, so the dropEdge call must happen here, not in watch.ts.
export function retireEdgesByFile(graph: NeatGraph, file: string): number {
  const normalized = file.split('\\').join('/')
  const toDrop: string[] = []
  graph.forEachEdge((id, attrs) => {
    const edge = attrs as GraphEdge
    if (edge.provenance !== Provenance.EXTRACTED) return
    if (!edge.evidence?.file) return
    if (edge.evidence.file === normalized) toDrop.push(id)
  })
  for (const id of toDrop) graph.dropEdge(id)
  return toDrop.length
}
