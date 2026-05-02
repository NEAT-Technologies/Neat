import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MultiDirectedGraph } from 'graphology'
import type { GraphEdge, GraphNode, ServiceNode } from '@neat/types'
import type { NeatGraph } from '../src/graph.js'
import { extractFromDirectory } from '../src/extract.js'

function newGraph(): NeatGraph {
  return new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
}

async function writeFile(dir: string, rel: string, content: string): Promise<void> {
  const abs = path.join(dir, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
}

describe('extract — extended compat checks', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'neat-compat-'))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('flags a node-engine conflict when engines.node is too low for a declared dep', async () => {
    await writeFile(
      tmp,
      'pkg/package.json',
      JSON.stringify({
        name: 'fixture-low-node',
        engines: { node: '>=16' },
        dependencies: { next: '14.2.0' },
      }),
    )
    const graph = newGraph()
    await extractFromDirectory(graph, tmp)
    const svc = graph.getNodeAttributes('service:fixture-low-node') as ServiceNode
    const incs = svc.incompatibilities ?? []
    const nodeEngine = incs.find((i) => i.kind === 'node-engine')
    expect(nodeEngine).toBeDefined()
    if (nodeEngine && nodeEngine.kind === 'node-engine') {
      expect(nodeEngine.package).toBe('next')
      expect(nodeEngine.requiredNodeVersion).toBe('18.17.0')
      expect(nodeEngine.declaredNodeEngine).toBe('>=16')
    }
  })

  it('does not flag node-engine when engines.node admits the requirement', async () => {
    await writeFile(
      tmp,
      'pkg/package.json',
      JSON.stringify({
        name: 'fixture-ok-node',
        engines: { node: '>=20' },
        dependencies: { next: '14.2.0', react: '18.2.0' },
      }),
    )
    const graph = newGraph()
    await extractFromDirectory(graph, tmp)
    const svc = graph.getNodeAttributes('service:fixture-ok-node') as ServiceNode
    const incs = svc.incompatibilities ?? []
    expect(incs.find((i) => i.kind === 'node-engine')).toBeUndefined()
  })

  it('flags a package-conflict (react-query 5 + react 17)', async () => {
    await writeFile(
      tmp,
      'pkg/package.json',
      JSON.stringify({
        name: 'fixture-rq-conflict',
        dependencies: {
          '@tanstack/react-query': '5.18.0',
          react: '17.0.2',
        },
      }),
    )
    const graph = newGraph()
    await extractFromDirectory(graph, tmp)
    const svc = graph.getNodeAttributes('service:fixture-rq-conflict') as ServiceNode
    const incs = svc.incompatibilities ?? []
    const conflict = incs.find((i) => i.kind === 'package-conflict')
    expect(conflict).toBeDefined()
    if (conflict && conflict.kind === 'package-conflict') {
      expect(conflict.package).toBe('@tanstack/react-query')
      expect(conflict.foundVersion).toBe('17.0.2')
      expect(conflict.requires.name).toBe('react')
    }
  })

  it('flags a deprecated-api when a deprecated package is declared', async () => {
    await writeFile(
      tmp,
      'pkg/package.json',
      JSON.stringify({
        name: 'fixture-deprecated',
        dependencies: { 'node-uuid': '1.4.0' },
      }),
    )
    const graph = newGraph()
    await extractFromDirectory(graph, tmp)
    const svc = graph.getNodeAttributes('service:fixture-deprecated') as ServiceNode
    const incs = svc.incompatibilities ?? []
    const dep = incs.find((i) => i.kind === 'deprecated-api')
    expect(dep).toBeDefined()
    if (dep && dep.kind === 'deprecated-api') {
      expect(dep.package).toBe('node-uuid')
    }
  })

  it('runs compat checks even when the service has no database connection', async () => {
    await writeFile(
      tmp,
      'pkg/package.json',
      JSON.stringify({
        name: 'fixture-no-db',
        dependencies: { 'node-uuid': '1.4.0' },
      }),
    )
    const graph = newGraph()
    await extractFromDirectory(graph, tmp)
    const svc = graph.getNodeAttributes('service:fixture-no-db') as ServiceNode
    expect(svc.incompatibilities ?? []).toHaveLength(1)
  })
})
