import type { GraphEdge, InfraNode } from '@neat/types'
import { EdgeType, NodeType, Provenance } from '@neat/types'
import type { NeatGraph } from '../../graph.js'
import { makeEdgeId, type DiscoveredService } from '../shared.js'
import { addHttpCallEdges } from './http.js'
import { loadSourceFiles, type ExternalEndpoint } from './shared.js'
import { kafkaEndpointsFromFile } from './kafka.js'
import { redisEndpointsFromFile } from './redis.js'
import { awsEndpointsFromFile } from './aws.js'
import { grpcEndpointsFromFile } from './grpc.js'

export interface CallExtractResult {
  nodesAdded: number
  edgesAdded: number
}

function edgeTypeFromEndpoint(ep: ExternalEndpoint): (typeof EdgeType)[keyof typeof EdgeType] {
  switch (ep.edgeType) {
    case 'PUBLISHES_TO':
      return EdgeType.PUBLISHES_TO
    case 'CONSUMES_FROM':
      return EdgeType.CONSUMES_FROM
    default:
      return EdgeType.CALLS
  }
}

async function addExternalEndpointEdges(
  graph: NeatGraph,
  services: DiscoveredService[],
): Promise<CallExtractResult> {
  let nodesAdded = 0
  let edgesAdded = 0

  for (const service of services) {
    const files = await loadSourceFiles(service.dir)
    const endpoints: ExternalEndpoint[] = []
    for (const file of files) {
      endpoints.push(...kafkaEndpointsFromFile(file, service.dir))
      endpoints.push(...redisEndpointsFromFile(file, service.dir))
      endpoints.push(...awsEndpointsFromFile(file, service.dir))
      endpoints.push(...grpcEndpointsFromFile(file, service.dir))
    }
    if (endpoints.length === 0) continue

    const seenEdges = new Set<string>()
    for (const ep of endpoints) {
      if (!graph.hasNode(ep.infraId)) {
        const node: InfraNode = {
          id: ep.infraId,
          type: NodeType.InfraNode,
          name: ep.name,
          provider: ep.kind.startsWith('s3') || ep.kind.startsWith('dynamodb') ? 'aws' : 'self',
          kind: ep.kind,
        }
        graph.addNode(node.id, node)
        nodesAdded++
      }

      const edgeType = edgeTypeFromEndpoint(ep)
      const edgeId = makeEdgeId(service.node.id, ep.infraId, edgeType)
      if (seenEdges.has(edgeId)) continue
      seenEdges.add(edgeId)
      if (!graph.hasEdge(edgeId)) {
        const edge: GraphEdge = {
          id: edgeId,
          source: service.node.id,
          target: ep.infraId,
          type: edgeType,
          provenance: Provenance.EXTRACTED,
          evidence: ep.evidence,
        }
        graph.addEdgeWithKey(edgeId, edge.source, edge.target, edge)
        edgesAdded++
      }
    }
  }
  return { nodesAdded, edgesAdded }
}

export async function addCallEdges(
  graph: NeatGraph,
  services: DiscoveredService[],
): Promise<CallExtractResult> {
  const httpEdges = await addHttpCallEdges(graph, services)
  const ext = await addExternalEndpointEdges(graph, services)
  return {
    nodesAdded: ext.nodesAdded,
    edgesAdded: httpEdges + ext.edgesAdded,
  }
}
