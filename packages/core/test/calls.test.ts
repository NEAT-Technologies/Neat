import { describe, it, expect, beforeEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resetGraph, getGraph } from '../src/graph.js'
import { extractFromDirectory } from '../src/extract.js'
import type { GraphEdge, InfraNode } from '@neat/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, 'fixtures', 'calls')

describe('call extraction beyond HTTP', () => {
  beforeEach(() => resetGraph())

  it('emits PUBLISHES_TO + CONSUMES_FROM kafka edges with evidence', async () => {
    const graph = getGraph()
    await extractFromDirectory(graph, FIXTURES)

    expect(graph.hasNode('infra:kafka-topic:orders')).toBe(true)
    expect(graph.hasNode('infra:kafka-topic:shipments')).toBe(true)

    const ordersTopic = graph.getNodeAttributes('infra:kafka-topic:orders') as InfraNode
    expect(ordersTopic.kind).toBe('kafka-topic')
    expect(ordersTopic.name).toBe('orders')

    const publishEdgeId =
      'PUBLISHES_TO:service:fixture-kafka-service->infra:kafka-topic:orders'
    expect(graph.hasEdge(publishEdgeId)).toBe(true)
    const publishEdge = graph.getEdgeAttributes(publishEdgeId) as GraphEdge
    expect(publishEdge.evidence?.file).toBe('index.js')
    expect(publishEdge.evidence?.line).toBeGreaterThan(0)
    expect(publishEdge.evidence?.snippet).toContain('orders')

    const consumeEdgeId =
      'CONSUMES_FROM:service:fixture-kafka-service->infra:kafka-topic:shipments'
    expect(graph.hasEdge(consumeEdgeId)).toBe(true)
  })

  it('emits redis InfraNode + CALLS edge from a redis:// URL', async () => {
    const graph = getGraph()
    await extractFromDirectory(graph, FIXTURES)

    expect(graph.hasNode('infra:redis:cache.internal')).toBe(true)
    const redisNode = graph.getNodeAttributes('infra:redis:cache.internal') as InfraNode
    expect(redisNode.kind).toBe('redis')

    const edgeId = 'CALLS:service:fixture-redis-service->infra:redis:cache.internal'
    expect(graph.hasEdge(edgeId)).toBe(true)
  })

  it('emits S3 + DynamoDB InfraNodes from AWS SDK calls', async () => {
    const graph = getGraph()
    await extractFromDirectory(graph, FIXTURES)

    const bucket = graph.getNodeAttributes('infra:s3-bucket:invoices') as InfraNode
    expect(bucket.provider).toBe('aws')
    expect(bucket.kind).toBe('s3-bucket')

    const table = graph.getNodeAttributes('infra:dynamodb-table:orders-table') as InfraNode
    expect(table.kind).toBe('dynamodb-table')
  })

  it('emits a gRPC infra node + CALLS edge', async () => {
    const graph = getGraph()
    await extractFromDirectory(graph, FIXTURES)

    expect(graph.hasNode('infra:grpc-service:orders.internal:50051')).toBe(true)
    const edgeId =
      'CALLS:service:fixture-grpc-service->infra:grpc-service:orders.internal:50051'
    expect(graph.hasEdge(edgeId)).toBe(true)
  })
})
