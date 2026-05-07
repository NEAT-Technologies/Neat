import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { GraphEdge } from '@neat.is/types'
import { EdgeType, Provenance } from '@neat.is/types'
import type { NeatGraph } from '../../graph.js'
import { exists, makeEdgeId, type DiscoveredService } from '../shared.js'
import { makeInfraNode } from './shared.js'

// Pull the first non-`scratch` `FROM` line out of a Dockerfile, ignoring
// multi-stage `as` aliases. Returns the image including tag (e.g. `node:20`,
// `python:3.11-slim`). Multi-stage builds report the *runtime* image — the
// last FROM that isn't aliasing a previous stage.
function runtimeImage(content: string): string | null {
  const lines = content.split('\n')
  let last: string | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (!/^from\s+/i.test(line)) continue
    const tokens = line.split(/\s+/)
    const image = tokens[1]
    if (!image || image.toLowerCase() === 'scratch') continue
    last = image
  }
  return last
}

// For each ServiceNode that has a Dockerfile in its dir, emit a
// `infra:container-image:<image>` InfraNode and a RUNS_ON edge from the
// service to the image.
export async function addDockerfileRuntimes(
  graph: NeatGraph,
  services: DiscoveredService[],
  scanPath: string,
): Promise<{ nodesAdded: number; edgesAdded: number }> {
  let nodesAdded = 0
  let edgesAdded = 0

  for (const service of services) {
    const dockerfilePath = path.join(service.dir, 'Dockerfile')
    if (!(await exists(dockerfilePath))) continue
    const content = await fs.readFile(dockerfilePath, 'utf8')
    const image = runtimeImage(content)
    if (!image) continue

    const node = makeInfraNode('container-image', image)
    if (!graph.hasNode(node.id)) {
      graph.addNode(node.id, node)
      nodesAdded++
    }

    const edgeId = makeEdgeId(service.node.id, node.id, EdgeType.RUNS_ON)
    if (!graph.hasEdge(edgeId)) {
      const edge: GraphEdge = {
        id: edgeId,
        source: service.node.id,
        target: node.id,
        type: EdgeType.RUNS_ON,
        provenance: Provenance.EXTRACTED,
        evidence: {
          file: path.relative(scanPath, dockerfilePath).split(path.sep).join('/'),
        },
      }
      graph.addEdgeWithKey(edgeId, edge.source, edge.target, edge)
      edgesAdded++
    }
  }

  return { nodesAdded, edgesAdded }
}
