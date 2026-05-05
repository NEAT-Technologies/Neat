import type { NeatGraph } from '../../graph.js'
import { type DiscoveredService } from '../shared.js'
import { addComposeInfra } from './docker-compose.js'
import { addDockerfileRuntimes } from './dockerfile.js'
import { addTerraformResources } from './terraform.js'
import { addK8sResources } from './k8s.js'

export interface InfraExtractResult {
  nodesAdded: number
  edgesAdded: number
}

// Phase 5 — infrastructure. Runs after services so RUNS_ON edges have a
// ServiceNode to anchor on. Each sub-source contributes its own nodes/edges
// independently; nothing here mutates ServiceNodes themselves.
export async function addInfra(
  graph: NeatGraph,
  scanPath: string,
  services: DiscoveredService[],
): Promise<InfraExtractResult> {
  const compose = await addComposeInfra(graph, scanPath, services)
  const dockerfile = await addDockerfileRuntimes(graph, services, scanPath)
  const terraform = await addTerraformResources(graph, scanPath)
  const k8s = await addK8sResources(graph, scanPath)

  return {
    nodesAdded:
      compose.nodesAdded + dockerfile.nodesAdded + terraform.nodesAdded + k8s.nodesAdded,
    edgesAdded:
      compose.edgesAdded + dockerfile.edgesAdded + terraform.edgesAdded + k8s.edgesAdded,
  }
}
