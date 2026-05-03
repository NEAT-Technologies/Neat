import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { NodeType, EdgeType, Provenance } from '@neat/types'
import { DEFAULT_PROJECT, getGraph, listProjects, resetGraph } from '../src/graph.js'
import { Projects, parseExtraProjects, pathsForProject } from '../src/projects.js'
import { buildApi } from '../src/api.js'

let tmpDir: string

beforeEach(async () => {
  resetGraph()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neat-projects-'))
})

afterEach(async () => {
  resetGraph()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('graph project map', () => {
  it('returns the same instance for the same project name', () => {
    const a1 = getGraph('alpha')
    const a2 = getGraph('alpha')
    expect(a1).toBe(a2)
  })

  it('returns distinct instances for distinct projects', () => {
    const a = getGraph('alpha')
    const b = getGraph('beta')
    expect(a).not.toBe(b)
  })

  it('default project is the legacy `default` key', () => {
    const d = getGraph()
    const named = getGraph(DEFAULT_PROJECT)
    expect(d).toBe(named)
  })

  it('listProjects returns the names that have been touched, sorted', () => {
    getGraph('beta')
    getGraph('alpha')
    expect(listProjects()).toEqual(['alpha', 'beta'])
  })

  it('resetGraph(name) drops just that project', () => {
    const a1 = getGraph('alpha')
    a1.addNode('marker', { id: 'marker', type: NodeType.ServiceNode, name: 'marker', language: 'js' })
    resetGraph('alpha')
    const a2 = getGraph('alpha')
    expect(a2.hasNode('marker')).toBe(false)
  })
})

describe('pathsForProject', () => {
  it('default project keeps the legacy filenames (back-compat)', () => {
    const p = pathsForProject(DEFAULT_PROJECT, '/base')
    expect(p.snapshotPath).toBe(path.join('/base', 'graph.json'))
    expect(p.errorsPath).toBe(path.join('/base', 'errors.ndjson'))
    expect(p.staleEventsPath).toBe(path.join('/base', 'stale-events.ndjson'))
    expect(p.embeddingsCachePath).toBe(path.join('/base', 'embeddings.json'))
  })

  it('named projects fan out by name', () => {
    const p = pathsForProject('alpha', '/base')
    expect(p.snapshotPath).toBe(path.join('/base', 'alpha.json'))
    expect(p.errorsPath).toBe(path.join('/base', 'errors.alpha.ndjson'))
    expect(p.staleEventsPath).toBe(path.join('/base', 'stale-events.alpha.ndjson'))
    expect(p.embeddingsCachePath).toBe(path.join('/base', 'embeddings.alpha.json'))
  })
})

describe('parseExtraProjects', () => {
  it('returns [] for undefined or empty', () => {
    expect(parseExtraProjects(undefined)).toEqual([])
    expect(parseExtraProjects('')).toEqual([])
    expect(parseExtraProjects('  ')).toEqual([])
  })

  it('splits comma-delimited names and trims whitespace', () => {
    expect(parseExtraProjects(' a , b ,c')).toEqual(['a', 'b', 'c'])
  })

  it('drops the implicit `default` even if listed', () => {
    expect(parseExtraProjects('default,alpha,default,beta')).toEqual(['alpha', 'beta'])
  })
})

describe('buildApi multi-project routing', () => {
  function seedDefault(): void {
    const g = getGraph(DEFAULT_PROJECT)
    g.addNode('service:default-svc', {
      id: 'service:default-svc',
      type: NodeType.ServiceNode,
      name: 'default-svc',
      language: 'javascript',
    })
  }

  function seedAlpha(): void {
    const g = getGraph('alpha')
    g.addNode('service:alpha-svc', {
      id: 'service:alpha-svc',
      type: NodeType.ServiceNode,
      name: 'alpha-svc',
      language: 'javascript',
    })
    g.addNode('database:alpha-db', {
      id: 'database:alpha-db',
      type: NodeType.DatabaseNode,
      name: 'alpha-db',
      engine: 'postgresql',
      engineVersion: '15',
    })
    g.addEdgeWithKey(
      'CONNECTS_TO:service:alpha-svc->database:alpha-db',
      'service:alpha-svc',
      'database:alpha-db',
      {
        id: 'CONNECTS_TO:service:alpha-svc->database:alpha-db',
        source: 'service:alpha-svc',
        target: 'database:alpha-db',
        type: EdgeType.CONNECTS_TO,
        provenance: Provenance.EXTRACTED,
      },
    )
  }

  it('mounts the same handler at /graph and /projects/default/graph', async () => {
    seedDefault()
    const registry = new Projects()
    registry.set(DEFAULT_PROJECT, {
      paths: pathsForProject(DEFAULT_PROJECT, tmpDir),
    })

    const app = await buildApi({ projects: registry })

    const root = await app.inject({ method: 'GET', url: '/graph' })
    const prefixed = await app.inject({ method: 'GET', url: '/projects/default/graph' })
    expect(root.statusCode).toBe(200)
    expect(prefixed.statusCode).toBe(200)
    expect(root.json()).toEqual(prefixed.json())
    expect(root.json().nodes).toHaveLength(1)

    await app.close()
  })

  it('isolates state across projects', async () => {
    seedDefault()
    seedAlpha()
    const registry = new Projects()
    registry.set(DEFAULT_PROJECT, { paths: pathsForProject(DEFAULT_PROJECT, tmpDir) })
    registry.set('alpha', { paths: pathsForProject('alpha', tmpDir) })

    const app = await buildApi({ projects: registry })

    const def = await app.inject({ method: 'GET', url: '/graph' })
    const alpha = await app.inject({ method: 'GET', url: '/projects/alpha/graph' })
    expect(def.json().nodes.map((n: { id: string }) => n.id)).toEqual([
      'service:default-svc',
    ])
    expect(alpha.json().nodes.map((n: { id: string }) => n.id).sort()).toEqual([
      'database:alpha-db',
      'service:alpha-svc',
    ])

    await app.close()
  })

  it('GET /projects lists every registered project', async () => {
    seedDefault()
    seedAlpha()
    const registry = new Projects()
    registry.set(DEFAULT_PROJECT, { paths: pathsForProject(DEFAULT_PROJECT, tmpDir) })
    registry.set('alpha', { paths: pathsForProject('alpha', tmpDir) })

    const app = await buildApi({ projects: registry })
    const res = await app.inject({ method: 'GET', url: '/projects' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { projects: { name: string; nodeCount: number }[] }
    const byName = Object.fromEntries(body.projects.map((p) => [p.name, p]))
    expect(byName.default.nodeCount).toBe(1)
    expect(byName.alpha.nodeCount).toBe(2)
    await app.close()
  })

  it('returns 404 with the project name when an unknown project is requested', async () => {
    seedDefault()
    const registry = new Projects()
    registry.set(DEFAULT_PROJECT, { paths: pathsForProject(DEFAULT_PROJECT, tmpDir) })

    const app = await buildApi({ projects: registry })
    const res = await app.inject({ method: 'GET', url: '/projects/missing/graph' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'project not found', project: 'missing' })
    await app.close()
  })

  it('legacy single-graph callers (no `projects` arg) still work', async () => {
    seedDefault()
    const app = await buildApi({ graph: getGraph(DEFAULT_PROJECT) })
    const res = await app.inject({ method: 'GET', url: '/graph' })
    expect(res.statusCode).toBe(200)
    expect(res.json().nodes.map((n: { id: string }) => n.id)).toEqual(['service:default-svc'])
    await app.close()
  })

  it('search routes scope to the requested project', async () => {
    seedAlpha()
    seedDefault()
    const registry = new Projects()
    registry.set(DEFAULT_PROJECT, { paths: pathsForProject(DEFAULT_PROJECT, tmpDir) })
    registry.set('alpha', { paths: pathsForProject('alpha', tmpDir) })

    const app = await buildApi({ projects: registry })
    const def = await app.inject({ method: 'GET', url: '/search?q=svc' })
    const alpha = await app.inject({ method: 'GET', url: '/projects/alpha/search?q=svc' })
    expect(def.json().matches.map((m: { id: string }) => m.id)).toEqual([
      'service:default-svc',
    ])
    expect(alpha.json().matches.map((m: { id: string }) => m.id)).toEqual([
      'service:alpha-svc',
    ])

    await app.close()
  })
})
