import type { GraphEdge, InfraNode } from '@neat.is/types'
import { EdgeType, NodeType, Provenance } from '@neat.is/types'
import type { NeatGraph } from '../../graph.js'
import {
  isTestPath,
  makeEdgeId,
  maskCommentsInSource,
  type DiscoveredService,
} from '../shared.js'
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

function isAwsKind(kind: string): boolean {
  return (
    kind.startsWith('aws-') ||
    kind.startsWith('s3') ||
    kind.startsWith('dynamodb')
  )
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
      // ADR-065 #1 — test-scope exclusion. Tests stay registered as
      // service-internal (via the file walk earlier); only outbound
      // endpoint inference from them is filtered.
      if (isTestPath(file.path)) continue
      // ADR-065 #2 — comment-body exclusion. The regex-based extractors
      // (redis / kafka / aws / grpc) scan raw file.content; URLs inside
      // JSDoc / line / block comments leaked through to the graph in the
      // v0.3.0 medusa run. Mask comments while preserving line/column for
      // evidence line-mapping.
      const masked = maskCommentsInSource(file.content)
      const maskedFile = { path: file.path, content: masked }
      endpoints.push(...kafkaEndpointsFromFile(maskedFile, service.dir))
      endpoints.push(...redisEndpointsFromFile(maskedFile, service.dir))
      endpoints.push(...awsEndpointsFromFile(maskedFile, service.dir))
      endpoints.push(...grpcEndpointsFromFile(maskedFile, service.dir))
    }
    if (endpoints.length === 0) continue

    const seenEdges = new Set<string>()
    for (const ep of endpoints) {
      if (!graph.hasNode(ep.infraId)) {
        const node: InfraNode = {
          id: ep.infraId,
          type: NodeType.InfraNode,
          name: ep.name,
          // #238 — `aws-*` covers AWS-SDK client kinds (aws-s3, aws-dynamodb,
          // aws-cognito-identity-provider, …); `s3-` / `dynamodb-` cover the
          // bucket / table kinds from aws.ts.
          provider: isAwsKind(ep.kind) ? 'aws' : 'self',
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
