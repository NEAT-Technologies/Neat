import type { NeatGraph } from '../graph.js'
import { promoteFrontierNodes } from '../ingest.js'
import { addServiceNodes, discoverServices } from './services.js'
import { addServiceAliases } from './aliases.js'
import { addDatabasesAndCompat } from './databases/index.js'
import { addConfigNodes } from './configs.js'
import { addCallEdges } from './calls/index.js'
import { addInfra } from './infra/index.js'

export interface ExtractResult {
  nodesAdded: number
  edgesAdded: number
  frontiersPromoted: number
}

export async function extractFromDirectory(
  graph: NeatGraph,
  scanPath: string,
): Promise<ExtractResult> {
  const services = await discoverServices(scanPath)

  const phase1Nodes = addServiceNodes(graph, services)
  await addServiceAliases(graph, scanPath, services)
  const phase2 = await addDatabasesAndCompat(graph, services)
  const phase3 = await addConfigNodes(graph, services, scanPath)
  const phase4 = await addCallEdges(graph, services)
  const phase5 = await addInfra(graph, scanPath, services)
  const frontiersPromoted = promoteFrontierNodes(graph)

  return {
    nodesAdded:
      phase1Nodes +
      phase2.nodesAdded +
      phase3.nodesAdded +
      phase4.nodesAdded +
      phase5.nodesAdded,
    edgesAdded:
      phase2.edgesAdded + phase3.edgesAdded + phase4.edgesAdded + phase5.edgesAdded,
    frontiersPromoted,
  }
}
