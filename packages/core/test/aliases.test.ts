import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MultiDirectedGraph } from 'graphology'
import {
  EdgeType,
  type GraphEdge,
  type GraphNode,
  NodeType,
  Provenance,
  type ServiceNode,
} from '@neat.is/types'
import type { NeatGraph } from '../src/graph.js'
import { extractFromDirectory } from '../src/extract.js'
import { handleSpan, type IngestContext } from '../src/ingest.js'

function newGraph(): NeatGraph {
  return new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
}

async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const abs = path.join(dir, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
}

async function makeTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'neat-aliases-'))
}

function getServiceNode(graph: NeatGraph, id: string): ServiceNode {
  return graph.getNodeAttributes(id) as ServiceNode
}

describe('addServiceAliases — docker-compose', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await makeTmp()
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('records compose service name + container_name + hostname as aliases', async () => {
    await writeFile(tmp, 'web/package.json', JSON.stringify({ name: 'fixture-web' }))
    await writeFile(
      tmp,
      'docker-compose.yml',
      `services:\n  web:\n    build: ./web\n    container_name: web-prod\n    hostname: web-internal\n`,
    )
    const graph = newGraph()
    await extractFromDirectory(graph, tmp)
    const node = getServiceNode(graph, 'service:fixture-web')
    expect(node.aliases).toBeDefined()
    expect(node.aliases).toEqual(expect.arrayContaining(['web', 'web-prod', 'web-internal']))
  })
})

describe('addServiceAliases — Dockerfile labels', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await makeTmp()
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('records LABEL service= and friends as aliases', async () => {
    await writeFile(tmp, 'api/package.json', JSON.stringify({ name: 'fixture-api' }))
    await writeFile(
      tmp,
      'api/Dockerfile',
      `FROM node:20
LABEL service=payments-api
LABEL service.name="payments-api.cluster.local"
LABEL org.opencontainers.image.title=payments
WORKDIR /app
`,
    )
    const graph = newGraph()
    await extractFromDirectory(graph, tmp)
    const node = getServiceNode(graph, 'service:fixture-api')
    expect(node.aliases).toEqual(
      expect.arrayContaining(['payments-api', 'payments-api.cluster.local', 'payments']),
    )
  })

  it('ignores unrelated LABEL keys', async () => {
    await writeFile(tmp, 'api/package.json', JSON.stringify({ name: 'fixture-api' }))
    await writeFile(
      tmp,
      'api/Dockerfile',
      `FROM node:20
LABEL maintainer="ops@example.com"
LABEL version=1.0
`,
    )
    const graph = newGraph()
    await extractFromDirectory(graph, tmp)
    const node = getServiceNode(graph, 'service:fixture-api')
    expect(node.aliases ?? []).toEqual([])
  })
})

describe('addServiceAliases — k8s', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await makeTmp()
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('records k8s metadata.name + cluster-DNS variants when selector targets the service', async () => {
    await writeFile(
      tmp,
      'svc/package.json',
      JSON.stringify({ name: 'fixture-svc' }),
    )
    await writeFile(
      tmp,
      'k8s/manifests.yaml',
      `apiVersion: v1
kind: Service
metadata:
  name: payments
  namespace: prod
spec:
  selector:
    app: fixture-svc
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fixture-svc
  namespace: prod
`,
    )
    const graph = newGraph()
    await extractFromDirectory(graph, tmp)
    const node = getServiceNode(graph, 'service:fixture-svc')
    expect(node.aliases).toEqual(
      expect.arrayContaining([
        'payments',
        'payments.prod',
        'payments.prod.svc',
        'payments.prod.svc.cluster.local',
        'fixture-svc.prod',
        'fixture-svc.prod.svc',
        'fixture-svc.prod.svc.cluster.local',
      ]),
    )
  })
})

describe('FRONTIER end-to-end via extractFromDirectory', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await makeTmp()
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('promotes a frontier once a later extraction round records the host as an alias', async () => {
    await writeFile(
      tmp,
      'service-a/package.json',
      JSON.stringify({ name: 'service-a' }),
    )
    await writeFile(
      tmp,
      'service-b/package.json',
      JSON.stringify({ name: 'service-b' }),
    )

    const graph = newGraph()
    const result1 = await extractFromDirectory(graph, tmp)
    expect(result1.frontiersPromoted).toBe(0)

    const errorsPath = path.join(tmp, 'errors.ndjson')
    const ctx: IngestContext = { graph, errorsPath }

    await handleSpan(ctx, {
      service: 'service-a',
      traceId: 't',
      spanId: 's',
      name: 'GET',
      kind: 3,
      startTimeUnixNano: '0',
      endTimeUnixNano: '0',
      durationNanos: 0n,
      attributes: { 'server.address': 'payments-api.cluster.local' },
      statusCode: 0,
    })

    expect(graph.hasNode('frontier:payments-api.cluster.local')).toBe(true)

    await writeFile(
      tmp,
      'docker-compose.yml',
      `services:\n  service-b:\n    build: ./service-b\n    hostname: payments-api.cluster.local\n`,
    )

    const result2 = await extractFromDirectory(graph, tmp)
    expect(result2.frontiersPromoted).toBe(1)
    expect(graph.hasNode('frontier:payments-api.cluster.local')).toBe(false)
    expect(
      graph.hasEdge(
        `${EdgeType.CALLS}:OBSERVED:service:service-a->service:service-b`,
      ),
    ).toBe(true)

    const promoted = graph.getEdgeAttributes(
      `${EdgeType.CALLS}:OBSERVED:service:service-a->service:service-b`,
    ) as GraphEdge
    expect(promoted.provenance).toBe(Provenance.OBSERVED)
  })

  it('still records direct service-name OBSERVED edges (regression check)', async () => {
    await writeFile(
      tmp,
      'service-a/package.json',
      JSON.stringify({ name: 'service-a' }),
    )
    await writeFile(
      tmp,
      'service-b/package.json',
      JSON.stringify({ name: 'service-b' }),
    )
    const graph = newGraph()
    await extractFromDirectory(graph, tmp)

    const ctx: IngestContext = {
      graph,
      errorsPath: path.join(tmp, 'errors.ndjson'),
    }
    await handleSpan(ctx, {
      service: 'service-a',
      traceId: 't',
      spanId: 's',
      name: 'GET',
      kind: 3,
      startTimeUnixNano: '0',
      endTimeUnixNano: '0',
      durationNanos: 0n,
      attributes: { 'server.address': 'service-b' },
      statusCode: 0,
    })

    expect(
      graph.hasEdge(`${EdgeType.CALLS}:OBSERVED:service:service-a->service:service-b`),
    ).toBe(true)
    let frontiers = 0
    graph.forEachNode((id, attrs) => {
      if ((attrs as { type: string }).type === NodeType.FrontierNode) frontiers++
      void id
    })
    expect(frontiers).toBe(0)
  })
})
