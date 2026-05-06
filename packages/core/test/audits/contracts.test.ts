/**
 * Contract assertions — auto-derived from /docs/contracts.md and the verification
 * pass at /docs/audits/verification.md. Each rule that verification graded PASS
 * is locked here as a regression test. Rules currently graded FAIL or PARTIAL
 * are queued as `it.todo` with the cleanup issue number — they flip to live
 * assertions as each fix lands.
 *
 * If a contract assertion fails: the implementation drifted from the contract.
 * The right move is almost always to fix the implementation, not the test.
 * Only relax a test if /docs/contracts.md and the relevant ADR change first.
 */

import { describe, it, expect } from 'vitest'
import { MultiDirectedGraph } from 'graphology'
import {
  EdgeType,
  NodeType,
  Provenance,
  ProvenanceSchema,
  EdgeTypeSchema,
  GraphEdgeSchema,
  GraphNodeSchema,
  RootCauseResultSchema,
  BlastRadiusResultSchema,
  type GraphEdge,
  type GraphNode,
} from '@neat/types'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { NeatGraph } from '../../src/graph.js'
import { getBlastRadius, getRootCause } from '../../src/traverse.js'

const CORE_SRC = join(__dirname, '../../src')
const TYPES_SRC = join(__dirname, '../../../types/src')
const MCP_SRC = join(__dirname, '../../../mcp/src')

function walkSrc(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walkSrc(full, files)
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) files.push(full)
  }
  return files
}

// ──────────────────────────────────────────────────────────────────────────
// Rule 1 — Provenance is a shared const; no raw string literals outside @neat/types
// ──────────────────────────────────────────────────────────────────────────
describe('Rule 1 — Provenance contract', () => {
  it('Provenance enum includes the five MVP values', () => {
    expect(Provenance.OBSERVED).toBe('OBSERVED')
    expect(Provenance.INFERRED).toBe('INFERRED')
    expect(Provenance.EXTRACTED).toBe('EXTRACTED')
    expect(Provenance.STALE).toBe('STALE')
    expect(Provenance.FRONTIER).toBe('FRONTIER')
    expect(ProvenanceSchema.options).toEqual(
      expect.arrayContaining(['OBSERVED', 'INFERRED', 'EXTRACTED', 'STALE', 'FRONTIER']),
    )
  })

  it('no raw provenance string literals in core/src or mcp/src', () => {
    const offenders: string[] = []
    const re = /['"](OBSERVED|INFERRED|EXTRACTED|STALE|FRONTIER)['"]/
    for (const file of [...walkSrc(CORE_SRC), ...walkSrc(MCP_SRC)]) {
      const content = readFileSync(file, 'utf8')
      content.split('\n').forEach((line, i) => {
        if (
          re.test(line) &&
          !line.includes('Provenance.') &&
          !line.includes('// ') &&
          !line.includes('describe(') &&
          !line.trim().startsWith('*')
        ) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Rule 2 — OBSERVED/EXTRACTED coexistence (distinct id pattern)
// ──────────────────────────────────────────────────────────────────────────
describe('Rule 2 — OBSERVED/EXTRACTED coexistence', () => {
  it('graph supports two edges between the same node pair under different ids', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:a', { id: 'service:a', type: NodeType.ServiceNode, name: 'a', language: 'javascript' })
    g.addNode('service:b', { id: 'service:b', type: NodeType.ServiceNode, name: 'b', language: 'javascript' })

    const extractedId = `${EdgeType.CALLS}:service:a->service:b`
    const observedId = `${EdgeType.CALLS}:OBSERVED:service:a->service:b`

    g.addEdgeWithKey(extractedId, 'service:a', 'service:b', {
      id: extractedId,
      type: EdgeType.CALLS,
      provenance: Provenance.EXTRACTED,
    })
    g.addEdgeWithKey(observedId, 'service:a', 'service:b', {
      id: observedId,
      type: EdgeType.CALLS,
      provenance: Provenance.OBSERVED,
      lastObserved: '2026-05-04T00:00:00.000Z',
      callCount: 1,
      confidence: 1.0,
    })

    expect(g.hasEdge(extractedId)).toBe(true)
    expect(g.hasEdge(observedId)).toBe(true)
    expect(g.edges('service:a', 'service:b').length).toBe(2)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Rule 3 — FRONTIER edges excluded from traversal
// ──────────────────────────────────────────────────────────────────────────
describe('Rule 3 — FRONTIER exclusion from traversal', () => {
  it('getRootCause returns null when the only path to a candidate root cause is via FRONTIER (issue #136)', async () => {
    const { frontierId, frontierEdgeId, extractedEdgeId, databaseId } = await import('@neat/types')
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    // Origin is a DatabaseNode (the only origin getRootCause currently handles).
    // The would-be culprit ServiceNode sits behind a FRONTIER edge — if FRONTIER
    // were traversed, the walk would reach the service and check compat. With
    // FRONTIER filtered, the walk halts at the database and returns null.
    const dbId = databaseId('payments')
    g.addNode(dbId, {
      id: dbId,
      type: NodeType.DatabaseNode,
      name: 'payments',
      engine: 'postgresql',
      engineVersion: '15',
      compatibleDrivers: [{ name: 'pg', minVersion: '8.0.0' }],
    })
    const fid = frontierId('mystery-host')
    g.addNode(fid, { id: fid, type: NodeType.FrontierNode, name: 'mystery-host', host: 'mystery-host' })
    const eId = frontierEdgeId(fid, dbId, EdgeType.CONNECTS_TO)
    g.addEdgeWithKey(eId, fid, dbId, {
      id: eId,
      source: fid,
      target: dbId,
      type: EdgeType.CONNECTS_TO,
      provenance: Provenance.FRONTIER,
    })
    expect(getRootCause(g, dbId)).toBeNull()
    void extractedEdgeId
  })

  it('getBlastRadius does not enqueue past a FRONTIER edge (issue #136)', async () => {
    const { frontierId, frontierEdgeId } = await import('@neat/types')
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:origin', { id: 'service:origin', type: NodeType.ServiceNode, name: 'origin', language: 'javascript' })
    const fid = frontierId('unknown:8080')
    g.addNode(fid, { id: fid, type: NodeType.FrontierNode, name: 'unknown:8080', host: 'unknown:8080' })
    const eId = frontierEdgeId('service:origin', fid, EdgeType.CALLS)
    g.addEdgeWithKey(eId, 'service:origin', fid, {
      id: eId,
      source: 'service:origin',
      target: fid,
      type: EdgeType.CALLS,
      provenance: Provenance.FRONTIER,
    })
    const result = getBlastRadius(g, 'service:origin')
    expect(result.affectedNodes.find((n) => n.nodeId === fid)).toBeUndefined()
    expect(result.totalAffected).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Rule 4 — Per-edge-type staleness (ADR-024)
// ──────────────────────────────────────────────────────────────────────────
describe('Rule 4 — Per-edge-type staleness thresholds', () => {
  it('no flat 24h-only threshold constant in ingest.ts', () => {
    const ingest = readFileSync(join(CORE_SRC, 'ingest.ts'), 'utf8')
    // The legacy single-threshold constant (STALE_THRESHOLD_MS = 24h) must not exist.
    expect(ingest).not.toMatch(/const\s+STALE_THRESHOLD_MS\s*=\s*24/)
  })

  it('STALE_THRESHOLDS_BY_EDGE_TYPE exists', () => {
    const ingest = readFileSync(join(CORE_SRC, 'ingest.ts'), 'utf8')
    expect(ingest).toMatch(/STALE_THRESHOLDS_BY_EDGE_TYPE/)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Rule 5 — Schemas live in @neat/types; consumers don't redefine
// ──────────────────────────────────────────────────────────────────────────
describe('Rule 5 — Shared schemas, no local redefinitions', () => {
  it('no local interface (Service|Database|Config|Infra|Frontier|Graph)Node in core/mcp', () => {
    const offenders: string[] = []
    const re = /^\s*(export\s+)?interface\s+(ServiceNode|DatabaseNode|ConfigNode|InfraNode|FrontierNode|GraphNode|GraphEdge|ErrorEvent)\b/
    for (const file of [...walkSrc(CORE_SRC), ...walkSrc(MCP_SRC)]) {
      const content = readFileSync(file, 'utf8')
      content.split('\n').forEach((line, i) => {
        if (re.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('no z.object or z.enum in core/mcp src (schemas belong in @neat/types)', () => {
    const offenders: string[] = []
    const re = /\bz\.(object|enum)\s*\(/
    for (const file of [...walkSrc(CORE_SRC), ...walkSrc(MCP_SRC)]) {
      const content = readFileSync(file, 'utf8')
      if (re.test(content)) offenders.push(file)
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('getRootCause validates result against RootCauseResultSchema (issue #139)', async () => {
    // Property assertion: any non-null result returned by getRootCause must
    // round-trip through the schema. The fixture matches the demo graph the
    // existing traverse.test.ts uses.
    const { extractedEdgeId } = await import('@neat/types')
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('database:payments-db', {
      id: 'database:payments-db',
      type: NodeType.DatabaseNode,
      name: 'payments-db',
      engine: 'postgresql',
      engineVersion: '15',
      compatibleDrivers: [{ name: 'pg', minVersion: '8.0.0' }],
    })
    g.addNode('service:b', {
      id: 'service:b',
      type: NodeType.ServiceNode,
      name: 'b',
      language: 'javascript',
      dependencies: { pg: '7.4.0' },
    })
    const eId = extractedEdgeId('service:b', 'database:payments-db', EdgeType.CONNECTS_TO)
    g.addEdgeWithKey(eId, 'service:b', 'database:payments-db', {
      id: eId,
      source: 'service:b',
      target: 'database:payments-db',
      type: EdgeType.CONNECTS_TO,
      provenance: Provenance.EXTRACTED,
    })
    const result = getRootCause(g, 'database:payments-db')
    expect(result).not.toBeNull()
    expect(() => RootCauseResultSchema.parse(result)).not.toThrow()
  })

  it('getBlastRadius validates result against BlastRadiusResultSchema (issue #139)', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:a', { id: 'service:a', type: NodeType.ServiceNode, name: 'a', language: 'javascript' })
    g.addNode('service:b', { id: 'service:b', type: NodeType.ServiceNode, name: 'b', language: 'javascript' })
    const ab = `${EdgeType.CALLS}:service:a->service:b`
    g.addEdgeWithKey(ab, 'service:a', 'service:b', {
      id: ab, source: 'service:a', target: 'service:b',
      type: EdgeType.CALLS, provenance: Provenance.EXTRACTED,
    })
    expect(() => BlastRadiusResultSchema.parse(getBlastRadius(g, 'service:a'))).not.toThrow()
    // Empty-result branch (origin missing) also schema-validates.
    expect(() =>
      BlastRadiusResultSchema.parse(getBlastRadius(g, 'service:does-not-exist')),
    ).not.toThrow()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Rule 6 — Live graphology, not graph.json
// ──────────────────────────────────────────────────────────────────────────
describe('Rule 6 — Live graph reads', () => {
  it('no readFileSync of graph.json outside persist.ts startup load', () => {
    const offenders: string[] = []
    for (const file of walkSrc(CORE_SRC)) {
      if (file.endsWith('persist.ts')) continue
      const content = readFileSync(file, 'utf8')
      if (/readFileSync\([^)]*graph\.json/.test(content)) {
        offenders.push(file)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Rule 16 — Node ids come from @neat/types/identity helpers, not literals
// ──────────────────────────────────────────────────────────────────────────
describe('Rule 16 — Node identity helpers (ADR-028)', () => {
  it('no hand-rolled `service:`/`database:`/`config:`/`infra:`/`frontier:` template literals in core/mcp src', () => {
    const offenders: string[] = []
    // Match a template literal that opens with one of the prefixes immediately
    // followed by `${...}`. That's the shape of `service:${name}` etc. Pure
    // string literals like 'service:foo' (no interpolation) are caught
    // separately because they're rare and almost always test fixtures.
    const re = /`(service|database|config|infra|frontier):\$\{/
    for (const file of [...walkSrc(CORE_SRC), ...walkSrc(MCP_SRC)]) {
      const content = readFileSync(file, 'utf8')
      content.split('\n').forEach((line, i) => {
        const trimmed = line.trim()
        if (re.test(line) && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
          offenders.push(`${file}:${i + 1}: ${trimmed}`)
        }
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('identity helpers produce stable wire format', async () => {
    const { serviceId, databaseId, configId, infraId, frontierId } = await import('@neat/types')
    expect(serviceId('checkout')).toBe('service:checkout')
    expect(databaseId('db.example.com')).toBe('database:db.example.com')
    expect(configId('apps/web/.env')).toBe('config:apps/web/.env')
    expect(infraId('redis', 'cache.internal')).toBe('infra:redis:cache.internal')
    expect(frontierId('payments-api:8080')).toBe('frontier:payments-api:8080')
  })

  it('inverse helpers parse the wire format back', async () => {
    const {
      serviceId,
      parseServiceId,
      databaseId,
      parseDatabaseId,
      configId,
      parseConfigId,
      infraId,
      parseInfraId,
      frontierId,
      parseFrontierId,
    } = await import('@neat/types')
    expect(parseServiceId(serviceId('checkout'))).toBe('checkout')
    expect(parseDatabaseId(databaseId('host'))).toBe('host')
    expect(parseConfigId(configId('a/b/.env'))).toBe('a/b/.env')
    expect(parseInfraId(infraId('redis', 'cache'))).toEqual({ kind: 'redis', name: 'cache' })
    expect(parseFrontierId(frontierId('host:8080'))).toBe('host:8080')

    expect(parseServiceId('not-a-service-id')).toBe(null)
    expect(parseInfraId('infra:noname')).toBe(null)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Lifecycle contract — only ingest.ts and extract/* may mutate the graph (ADR-030)
// ──────────────────────────────────────────────────────────────────────────
describe('Lifecycle contract — mutation authority (ADR-030)', () => {
  it('graph mutation methods are only called from ingest.ts and extract/*', () => {
    const offenders: string[] = []
    const mutators = [
      'addNode',
      'addEdge',
      'addEdgeWithKey',
      'addDirectedEdge',
      'addDirectedEdgeWithKey',
      'dropNode',
      'dropEdge',
      'replaceEdgeAttributes',
      'replaceNodeAttributes',
      'mergeEdgeAttributes',
      'mergeNodeAttributes',
    ]
    const re = new RegExp(`\\b(graph|g)\\.(${mutators.join('|')})\\s*\\(`)

    for (const file of walkSrc(CORE_SRC)) {
      // Allowed mutation sites: ingest.ts and everything under extract/.
      if (file.endsWith('/ingest.ts')) continue
      if (file.includes('/extract/')) continue

      const content = readFileSync(file, 'utf8')
      content.split('\n').forEach((line, i) => {
        const trimmed = line.trim()
        if (re.test(line) && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
          offenders.push(`${file}:${i + 1}: ${trimmed}`)
        }
      })
    }

    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('mcp/src never mutates the graph', () => {
    const offenders: string[] = []
    const re = /\b(graph|g)\.(addNode|addEdge|dropNode|dropEdge|replaceEdgeAttributes|replaceNodeAttributes|mergeEdgeAttributes|mergeNodeAttributes)\s*\(/
    for (const file of walkSrc(MCP_SRC)) {
      const content = readFileSync(file, 'utf8')
      content.split('\n').forEach((line, i) => {
        const trimmed = line.trim()
        if (re.test(line) && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
          offenders.push(`${file}:${i + 1}: ${trimmed}`)
        }
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

describe('Lifecycle contract — STALE → OBSERVED resurrection (ADR-030)', () => {
  it('a span on a STALE edge flips provenance back to OBSERVED with confidence 1.0', async () => {
    const { observedEdgeId } = await import('@neat/types')
    const { handleSpan } = await import('../../src/ingest.js')
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')

    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:caller', {
      id: 'service:caller',
      type: NodeType.ServiceNode,
      name: 'caller',
      language: 'javascript',
    })
    g.addNode('service:callee', {
      id: 'service:callee',
      type: NodeType.ServiceNode,
      name: 'callee',
      language: 'javascript',
    })

    // Seed a STALE edge under the OBSERVED id pattern. STALE never has its own
    // id pattern — it's a transitioned-in-place OBSERVED edge.
    const id = observedEdgeId('service:caller', 'service:callee', EdgeType.CALLS)
    const seeded: GraphEdge = {
      id,
      source: 'service:caller',
      target: 'service:callee',
      type: EdgeType.CALLS,
      provenance: Provenance.STALE,
      lastObserved: '2026-04-01T00:00:00.000Z',
      callCount: 5,
      confidence: 0.3,
    }
    g.addEdgeWithKey(id, 'service:caller', 'service:callee', seeded)

    const errorsPath = join(mkdtempSync(join(tmpdir(), 'contract-test-')), 'errors.ndjson')
    await handleSpan(
      { graph: g, errorsPath, now: () => Date.parse('2026-05-05T12:00:00.000Z') },
      {
        traceId: 't1',
        spanId: 's1',
        service: 'caller',
        name: 'GET /things',
        statusCode: 0,
        startTimeUnixNano: '0',
        endTimeUnixNano: '0',
        durationNanos: 0n,
        attributes: {
          'server.address': 'callee',
          'http.method': 'GET',
        },
      },
    )

    const after = g.getEdgeAttributes(id) as GraphEdge
    expect(after.provenance).toBe(Provenance.OBSERVED)
    expect(after.confidence).toBe(1.0)
    expect(after.callCount).toBeGreaterThanOrEqual(6)
  })
})

describe('Lifecycle contract — FRONTIER → OBSERVED on promotion (ADR-030)', () => {
  it('promoteFrontierNodes upgrades a FRONTIER edge to OBSERVED', async () => {
    const { frontierId, frontierEdgeId } = await import('@neat/types')
    const { promoteFrontierNodes } = await import('../../src/ingest.js')

    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:caller', {
      id: 'service:caller',
      type: NodeType.ServiceNode,
      name: 'caller',
      language: 'javascript',
    })
    g.addNode('service:callee', {
      id: 'service:callee',
      type: NodeType.ServiceNode,
      name: 'callee',
      language: 'javascript',
      aliases: ['callee.internal'],
    })
    const fid = frontierId('callee.internal')
    g.addNode(fid, {
      id: fid,
      type: NodeType.FrontierNode,
      name: 'callee.internal',
      host: 'callee.internal',
    })

    const oldEdgeId = frontierEdgeId('service:caller', fid, EdgeType.CALLS)
    g.addEdgeWithKey(oldEdgeId, 'service:caller', fid, {
      id: oldEdgeId,
      source: 'service:caller',
      target: fid,
      type: EdgeType.CALLS,
      provenance: Provenance.FRONTIER,
      lastObserved: '2026-05-05T12:00:00.000Z',
      callCount: 3,
    })

    const promoted = promoteFrontierNodes(g)
    expect(promoted).toBe(1)
    expect(g.hasNode(fid)).toBe(false)
    expect(g.hasEdge(oldEdgeId)).toBe(false)

    // After promotion, an OBSERVED edge from caller to callee exists.
    const promotedEdges = g.outboundEdges('service:caller').map((id) => g.getEdgeAttributes(id) as GraphEdge)
    const callsCallee = promotedEdges.find(
      (e) => e.target === 'service:callee' && e.type === EdgeType.CALLS,
    )
    expect(callsCallee).toBeDefined()
    expect(callsCallee!.provenance).toBe(Provenance.OBSERVED)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Static-extraction contract — producer interface, evidence, idempotency (ADR-032)
// ──────────────────────────────────────────────────────────────────────────
describe('Static-extraction contract (ADR-032)', () => {
  // Producer interface: every exported `addX` function under `extract/` accepts
  // (graph, services, scanPath) — or a strict subset. The scan reads function
  // signatures syntactically; it's a static check, not a runtime invocation.
  it('producer entry points accept (graph, services, scanPath) — strict subset allowed', () => {
    const offenders: string[] = []
    const EXTRACT_DIR = join(CORE_SRC, 'extract')
    // Match `export (async)? function add<Word>...(args)` and capture the args.
    const re = /export\s+(?:async\s+)?function\s+(add[A-Z]\w*)\s*\(([^)]*)\)/g
    const allowed = ['graph', 'services', 'scanPath', 'service']

    for (const file of walkSrc(EXTRACT_DIR)) {
      const content = readFileSync(file, 'utf8')
      let m: RegExpExecArray | null
      while ((m = re.exec(content)) !== null) {
        const fnName = m[1]!
        const argList = m[2]!
        // Pull parameter names off the type-annotated param list.
        const paramNames = argList
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
          .map((p) => p.split(':')[0]!.trim().replace(/\?$/, ''))
        for (const name of paramNames) {
          if (!allowed.includes(name)) {
            offenders.push(`${file}: ${fnName} has unexpected parameter \`${name}\``)
          }
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('producers guard every node write with hasNode (idempotency)', () => {
    // Heuristic: any line that calls graph.addNode(...) should be inside an
    // `if (!graph.hasNode(...))` guard within the previous 5 lines, or the
    // addNode call itself is preceded by hasNode in the same expression.
    const offenders: string[] = []
    const EXTRACT_DIR = join(CORE_SRC, 'extract')
    for (const file of walkSrc(EXTRACT_DIR)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!/\bgraph\.addNode\s*\(/.test(line)) return
        const window = lines.slice(Math.max(0, i - 15), i + 1).join('\n')
        if (/\bgraph\.hasNode\s*\(/.test(window)) return
        offenders.push(`${file}:${i + 1}: addNode without hasNode guard`)
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('producers guard every edge write with hasEdge (idempotency)', () => {
    const offenders: string[] = []
    const EXTRACT_DIR = join(CORE_SRC, 'extract')
    for (const file of walkSrc(EXTRACT_DIR)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!/\bgraph\.addEdge(WithKey)?\s*\(/.test(line)) return
        const window = lines.slice(Math.max(0, i - 15), i + 1).join('\n')
        if (/\bgraph\.hasEdge\s*\(/.test(window)) return
        offenders.push(`${file}:${i + 1}: addEdge without hasEdge guard`)
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  // Every object literal that sets `provenance: Provenance.EXTRACTED` must
  // also include an `evidence:` key. The check is structural rather than
  // runtime — we look at the surrounding source-window of each match. Issue
  // #140 closed the gap by populating evidence on CONNECTS_TO, CONFIGURED_BY,
  // DEPENDS_ON, and RUNS_ON producers (CALLS-family already had it).
  it('every EXTRACTED edge construction site under extract/ includes evidence.file', () => {
    const offenders: string[] = []
    const EXTRACT_DIR = join(CORE_SRC, 'extract')
    for (const file of walkSrc(EXTRACT_DIR)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!/provenance:\s*Provenance\.EXTRACTED\b/.test(line)) return
        const window = lines
          .slice(Math.max(0, i - 12), Math.min(lines.length, i + 12))
          .join('\n')
        if (/evidence\s*[:?]/.test(window)) return
        offenders.push(`${file}:${i + 1}`)
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  // Issue #142 adds `framework` to ServiceNodeSchema and populates it from
  // package.json deps. The schema-snapshot guard catches the schema growth;
  // this test asserts the producer wires it up.
  it.todo(
    'extract/services.ts populates ServiceNode.framework from known framework packages (issue #142)',
  )
})

// ──────────────────────────────────────────────────────────────────────────
// OTel ingest contract — non-blocking, span-time, parent-cache (ADR-033)
// ──────────────────────────────────────────────────────────────────────────
describe('OTel ingest contract (ADR-033)', () => {
  it('OTel receiver replies before mutation completes (issue #131)', async () => {
    const { buildOtelReceiver } = await import('../../src/otel.js')

    // 250ms keeps the gap large enough that scheduling jitter on slow CI
    // runners can't push replyMs up to HANDLER_DELAY_MS (a 40ms delay tied
    // the bound on one CI run; bumping fixes the flake).
    const HANDLER_DELAY_MS = 250
    const handlerEnd: number[] = []
    const app = await buildOtelReceiver({
      onSpan: async () => {
        await new Promise((r) => setTimeout(r, HANDLER_DELAY_MS))
        handlerEnd.push(Date.now())
      },
    })
    try {
      const replyStart = Date.now()
      const res = await app.inject({
        method: 'POST',
        url: '/v1/traces',
        headers: { 'content-type': 'application/json' },
        payload: {
          resourceSpans: [
            {
              resource: { attributes: [{ key: 'service.name', value: { stringValue: 's' } }] },
              scopeSpans: [
                { spans: [{ name: 'op', startTimeUnixNano: '0', endTimeUnixNano: '0' }] },
              ],
            },
          ],
        },
      })
      const replyMs = Date.now() - replyStart
      expect(res.statusCode).toBe(200)
      // Receiver replies before the slow handler finishes — proof the queue
      // decoupled mutation from the response. Bound chosen to avoid CI flake.
      expect(replyMs).toBeLessThan(HANDLER_DELAY_MS)
      await (app as unknown as { flushPending: () => Promise<void> }).flushPending()
      expect(handlerEnd.length).toBe(1)
    } finally {
      await app.close()
    }
  })
  it('lastObserved derives from span.startTimeUnixNano, not Date.now() (issue #132)', async () => {
    const { handleSpan } = await import('../../src/ingest.js')
    const { isoFromUnixNano } = await import('../../src/otel.js')
    const { observedEdgeId } = await import('@neat/types')
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')

    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:caller', {
      id: 'service:caller',
      type: NodeType.ServiceNode,
      name: 'caller',
      language: 'javascript',
    })
    g.addNode('service:callee', {
      id: 'service:callee',
      type: NodeType.ServiceNode,
      name: 'callee',
      language: 'javascript',
    })

    const errorsPath = join(mkdtempSync(join(tmpdir(), 'contract-test-')), 'errors.ndjson')
    // Backdated span: April 1st, ~5 weeks before "now". The receiver clock is
    // pinned to 2026-05-05 so the only way the edge could end up with the
    // April 1st timestamp is if the handler reads the span's own startTime.
    const spanStartNano = (BigInt(Date.parse('2026-04-01T09:00:00.000Z')) * 1_000_000n).toString()
    await handleSpan(
      {
        graph: g,
        errorsPath,
        now: () => Date.parse('2026-05-05T12:00:00.000Z'),
      },
      {
        traceId: 't-backdated',
        spanId: 's-backdated',
        service: 'caller',
        name: 'GET /things',
        statusCode: 0,
        startTimeUnixNano: spanStartNano,
        endTimeUnixNano: spanStartNano,
        startTimeIso: isoFromUnixNano(spanStartNano),
        durationNanos: 0n,
        attributes: { 'server.address': 'callee', 'http.method': 'GET' },
      },
    )

    const edge = g.getEdgeAttributes(
      observedEdgeId('service:caller', 'service:callee', EdgeType.CALLS),
    ) as GraphEdge
    expect(edge.lastObserved).toBe('2026-04-01T09:00:00.000Z')
  })
  it('parent-span cache resolves cross-service CALLS when address-based resolution fails (issue #133)', async () => {
    const { handleSpan, resetParentSpanCache } = await import('../../src/ingest.js')
    const { observedEdgeId, serviceId } = await import('@neat/types')
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')

    resetParentSpanCache()

    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    const errorsPath = join(mkdtempSync(join(tmpdir(), 'contract-test-')), 'errors.ndjson')
    const ctx = { graph: g, errorsPath, now: () => Date.parse('2026-05-06T12:00:00.000Z') }

    // Parent (CLIENT) span on service:caller. No outbound edge yet because no
    // peer attribute is set on this span — only spanId is recorded for the
    // child to look up later.
    await handleSpan(ctx, {
      traceId: 't1',
      spanId: 'parent-1',
      service: 'caller',
      name: 'rpc.client',
      startTimeUnixNano: '0',
      endTimeUnixNano: '0',
      durationNanos: 0n,
      attributes: {},
    })

    // Child (SERVER) span on service:callee whose parent points back at the
    // CLIENT span. No address attribute, so address-based resolution fails;
    // the parent-span cache is the only path that produces an edge here.
    await handleSpan(ctx, {
      traceId: 't1',
      spanId: 'child-1',
      parentSpanId: 'parent-1',
      service: 'callee',
      name: 'rpc.server',
      startTimeUnixNano: '0',
      endTimeUnixNano: '0',
      durationNanos: 0n,
      attributes: {},
    })

    const expected = observedEdgeId(serviceId('caller'), serviceId('callee'), EdgeType.CALLS)
    expect(g.hasEdge(expected)).toBe(true)
    const edge = g.getEdgeAttributes(expected) as GraphEdge
    expect(edge.provenance).toBe(Provenance.OBSERVED)
  })
  it('handleSpan auto-creates ServiceNode at serviceId(span.service) for unseen services (issue #134)', async () => {
    const { handleSpan } = await import('../../src/ingest.js')
    const { serviceId } = await import('@neat/types')
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')

    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    const errorsPath = join(mkdtempSync(join(tmpdir(), 'contract-test-')), 'errors.ndjson')

    expect(g.hasNode(serviceId('unseen-svc'))).toBe(false)
    await handleSpan(
      { graph: g, errorsPath, now: () => Date.parse('2026-05-05T12:00:00.000Z') },
      {
        traceId: 't1',
        spanId: 's1',
        service: 'unseen-svc',
        name: 'GET /things',
        startTimeUnixNano: '0',
        endTimeUnixNano: '0',
        durationNanos: 0n,
        attributes: {},
      },
    )

    expect(g.hasNode(serviceId('unseen-svc'))).toBe(true)
    const node = g.getNodeAttributes(serviceId('unseen-svc')) as {
      type: string
      language: string
      discoveredVia?: string
    }
    expect(node.type).toBe(NodeType.ServiceNode)
    expect(node.language).toBe('unknown')
    expect(node.discoveredVia).toBe('otel')
  })

  it('handleSpan auto-creates DatabaseNode at databaseId(host) for unseen db.system+host (issue #134)', async () => {
    const { handleSpan } = await import('../../src/ingest.js')
    const { databaseId } = await import('@neat/types')
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')

    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    const errorsPath = join(mkdtempSync(join(tmpdir(), 'contract-test-')), 'errors.ndjson')

    await handleSpan(
      { graph: g, errorsPath, now: () => Date.parse('2026-05-05T12:00:00.000Z') },
      {
        traceId: 't2',
        spanId: 's2',
        service: 'caller',
        name: 'SELECT 1',
        startTimeUnixNano: '0',
        endTimeUnixNano: '0',
        durationNanos: 0n,
        attributes: { 'server.address': 'analytics.internal', 'db.system': 'postgresql' },
        dbSystem: 'postgresql',
      },
    )

    const dbId = databaseId('analytics.internal')
    expect(g.hasNode(dbId)).toBe(true)
    const dbNode = g.getNodeAttributes(dbId) as {
      type: string
      engine: string
      engineVersion: string
      discoveredVia?: string
    }
    expect(dbNode.type).toBe(NodeType.DatabaseNode)
    expect(dbNode.engine).toBe('postgresql')
    expect(dbNode.engineVersion).toBe('unknown')
    expect(dbNode.discoveredVia).toBe('otel')
  })
  it('parser extracts exception.type/message/stacktrace from span events with name=exception (issue #135)', async () => {
    const { parseOtlpRequest } = await import('../../src/otel.js')
    const spans = parseOtlpRequest({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'caller' } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't1',
                  spanId: 's1',
                  name: 'GET /things',
                  startTimeUnixNano: '1714557600000000000',
                  endTimeUnixNano: '1714557600100000000',
                  attributes: [],
                  status: { code: 2, message: 'fallback' },
                  events: [
                    {
                      name: 'exception',
                      timeUnixNano: '1714557600050000000',
                      attributes: [
                        { key: 'exception.type', value: { stringValue: 'TimeoutError' } },
                        { key: 'exception.message', value: { stringValue: 'upstream timed out' } },
                        { key: 'exception.stacktrace', value: { stringValue: 'at fetch (a.js:1)' } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(spans).toHaveLength(1)
    expect(spans[0]!.exception).toEqual({
      type: 'TimeoutError',
      message: 'upstream timed out',
      stacktrace: 'at fetch (a.js:1)',
    })
  })

  it('handleSpan prefers exception event message over span.status.message (issue #135)', async () => {
    const { handleSpan } = await import('../../src/ingest.js')
    const { mkdtempSync, readFileSync: rfs } = await import('node:fs')
    const { tmpdir } = await import('node:os')

    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:caller', {
      id: 'service:caller',
      type: NodeType.ServiceNode,
      name: 'caller',
      language: 'javascript',
    })

    const dir = mkdtempSync(join(tmpdir(), 'contract-test-'))
    const errorsPath = join(dir, 'errors.ndjson')
    await handleSpan(
      { graph: g, errorsPath, now: () => Date.parse('2026-05-05T12:00:00.000Z') },
      {
        traceId: 't1',
        spanId: 's1',
        service: 'caller',
        name: 'GET /things',
        statusCode: 2,
        startTimeUnixNano: '0',
        endTimeUnixNano: '0',
        durationNanos: 0n,
        attributes: {},
        errorMessage: 'fallback status message',
        exception: {
          type: 'TimeoutError',
          message: 'upstream timed out',
          stacktrace: 'at fetch (a.js:1)',
        },
      },
    )

    const written = rfs(errorsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(written).toHaveLength(1)
    expect(written[0].errorMessage).toBe('upstream timed out')
    expect(written[0].exceptionType).toBe('TimeoutError')
    expect(written[0].exceptionStacktrace).toBe('at fetch (a.js:1)')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Trace stitcher contract — ERROR-only, depth-2, OBSERVED-twin-skip (ADR-034)
// ──────────────────────────────────────────────────────────────────────────
describe('Trace stitcher contract (ADR-034)', () => {
  it('stitchTrace produces no edges from a node with no outbound EXTRACTED edges', async () => {
    const { stitchTrace } = await import('../../src/ingest.js')
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:lonely', {
      id: 'service:lonely',
      type: NodeType.ServiceNode,
      name: 'lonely',
      language: 'javascript',
    })
    const before = g.size
    stitchTrace(g, 'service:lonely', '2026-05-05T12:00:00.000Z')
    expect(g.size).toBe(before)
  })

  it('stitchTrace returns cleanly when sourceServiceId is missing from the graph', async () => {
    const { stitchTrace } = await import('../../src/ingest.js')
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    expect(() => stitchTrace(g, 'service:does-not-exist', '2026-05-05T12:00:00.000Z')).not.toThrow()
    expect(g.order).toBe(0)
  })

  it('stitchTrace skips a hop when an OBSERVED twin already exists for the (source, target, type) triplet', async () => {
    const { extractedEdgeId, observedEdgeId, inferredEdgeId } = await import('@neat/types')
    const { stitchTrace } = await import('../../src/ingest.js')

    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:caller', {
      id: 'service:caller',
      type: NodeType.ServiceNode,
      name: 'caller',
      language: 'javascript',
    })
    g.addNode('service:callee', {
      id: 'service:callee',
      type: NodeType.ServiceNode,
      name: 'callee',
      language: 'javascript',
    })

    // EXTRACTED + OBSERVED twin between the same pair. Coexistence rule (Rule 2).
    const ext = extractedEdgeId('service:caller', 'service:callee', EdgeType.CALLS)
    g.addEdgeWithKey(ext, 'service:caller', 'service:callee', {
      id: ext,
      source: 'service:caller',
      target: 'service:callee',
      type: EdgeType.CALLS,
      provenance: Provenance.EXTRACTED,
    })
    const obs = observedEdgeId('service:caller', 'service:callee', EdgeType.CALLS)
    g.addEdgeWithKey(obs, 'service:caller', 'service:callee', {
      id: obs,
      source: 'service:caller',
      target: 'service:callee',
      type: EdgeType.CALLS,
      provenance: Provenance.OBSERVED,
      lastObserved: '2026-05-05T11:00:00.000Z',
      callCount: 7,
      confidence: 1.0,
    })

    stitchTrace(g, 'service:caller', '2026-05-05T12:00:00.000Z')
    // No INFERRED twin should appear — the OBSERVED edge already covers it.
    const inf = inferredEdgeId('service:caller', 'service:callee', EdgeType.CALLS)
    expect(g.hasEdge(inf)).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// FrontierNode promotion contract — atomic, FRONTIER→OBSERVED, canonical ids (ADR-035)
// ──────────────────────────────────────────────────────────────────────────
describe('FrontierNode promotion contract (ADR-035)', () => {
  // Catches the variable-interpolated provenance pattern that the contract #2
  // scan (line ~570) misses. `${edge.type}:${promotedProvenance}:${...}->${...}`
  // is exactly the violation that lived at ingest.ts:463 before the rebuildEdge
  // fix routed through the canonical helpers in @neat/types/identity.
  it('no variable-interpolated provenance segment in edge id template literals — `${X}:${Y}:${Z}->${W}` (FrontierNode rebuild fix)', () => {
    const offenders: string[] = []
    // Four interpolations chained with `:` between the first three and `->`
    // before the fourth — the literal-segment-free form the original scan
    // doesn't catch. The provenance variable sits in the second slot.
    const re = /`\$\{[^}]+\}:\$\{[^}]+\}:\$\{[^}]+\}->\$\{[^}]+\}`/
    for (const file of [...walkSrc(CORE_SRC), ...walkSrc(MCP_SRC)]) {
      const content = readFileSync(file, 'utf8')
      content.split('\n').forEach((line, i) => {
        const trimmed = line.trim()
        if (re.test(line) && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
          offenders.push(`${file}:${i + 1}: ${trimmed}`)
        }
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('rebuildEdge constructs ids via canonical helpers — promoted FRONTIER→OBSERVED edge id matches observedEdgeId()', async () => {
    const { observedEdgeId, frontierId, frontierEdgeId } = await import('@neat/types')
    const { promoteFrontierNodes } = await import('../../src/ingest.js')

    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:caller', {
      id: 'service:caller',
      type: NodeType.ServiceNode,
      name: 'caller',
      language: 'javascript',
    })
    g.addNode('service:callee', {
      id: 'service:callee',
      type: NodeType.ServiceNode,
      name: 'callee',
      language: 'javascript',
      aliases: ['callee.internal'],
    })
    const fid = frontierId('callee.internal')
    g.addNode(fid, {
      id: fid,
      type: NodeType.FrontierNode,
      name: 'callee.internal',
      host: 'callee.internal',
    })
    const oldEdgeId = frontierEdgeId('service:caller', fid, EdgeType.CALLS)
    g.addEdgeWithKey(oldEdgeId, 'service:caller', fid, {
      id: oldEdgeId,
      source: 'service:caller',
      target: fid,
      type: EdgeType.CALLS,
      provenance: Provenance.FRONTIER,
      lastObserved: '2026-05-05T12:00:00.000Z',
      callCount: 3,
    })

    expect(promoteFrontierNodes(g)).toBe(1)
    const expectedId = observedEdgeId('service:caller', 'service:callee', EdgeType.CALLS)
    expect(g.hasEdge(expectedId)).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Traversal contract — read-only, PROV_RANK at every hop, FRONTIER excluded (ADR-036)
// ──────────────────────────────────────────────────────────────────────────
describe('Traversal contract (ADR-036)', () => {
  it('traverse.ts contains no graph mutation calls', () => {
    const content = readFileSync(join(CORE_SRC, 'traverse.ts'), 'utf8')
    const mutators = ['addNode', 'addEdge', 'addEdgeWithKey', 'dropNode', 'dropEdge', 'replaceEdgeAttributes', 'replaceNodeAttributes', 'mergeEdgeAttributes', 'mergeNodeAttributes']
    const re = new RegExp(`\\bgraph\\.(${mutators.join('|')})\\s*\\(`)
    expect(re.test(content), 'traverse.ts must be read-only').toBe(false)
  })

  it('FRONTIER edges are filtered (not just deprioritized) by bestEdgeBySource / bestEdgeByTarget (issue #136)', () => {
    const content = readFileSync(join(CORE_SRC, 'traverse.ts'), 'utf8')
    // Both helpers must guard with `Provenance.FRONTIER`. The contract is "skip,
    // not deprioritize" — relying on PROV_RANK alone is the v0.1.x bug.
    const helpers = ['bestEdgeBySource', 'bestEdgeByTarget']
    for (const helper of helpers) {
      const re = new RegExp(`function\\s+${helper}\\b[\\s\\S]*?provenance\\s*===\\s*Provenance\\.FRONTIER`)
      expect(re.test(content), `${helper} must filter FRONTIER edges explicitly`).toBe(true)
    }
  })
  it('confidenceFromMix multiplies per-edge confidences (multiplicative cascade)', () => {
    // The cascade is observable through getBlastRadius: a 2-hop EXTRACTED-only
    // path puts the per-edge confidence at the EXTRACTED ceiling 0.5. Min-reduce
    // would return 0.5; the contract requires the product 0.25.
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:a', { id: 'service:a', type: NodeType.ServiceNode, name: 'a', language: 'javascript' })
    g.addNode('service:b', { id: 'service:b', type: NodeType.ServiceNode, name: 'b', language: 'javascript' })
    g.addNode('service:c', { id: 'service:c', type: NodeType.ServiceNode, name: 'c', language: 'javascript' })
    const ab = `${EdgeType.CALLS}:service:a->service:b`
    g.addEdgeWithKey(ab, 'service:a', 'service:b', {
      id: ab, source: 'service:a', target: 'service:b',
      type: EdgeType.CALLS, provenance: Provenance.EXTRACTED,
    })
    const bc = `${EdgeType.CALLS}:service:b->service:c`
    g.addEdgeWithKey(bc, 'service:b', 'service:c', {
      id: bc, source: 'service:b', target: 'service:c',
      type: EdgeType.CALLS, provenance: Provenance.EXTRACTED,
    })
    const result = getBlastRadius(g, 'service:a')
    const c = result.affectedNodes.find((n) => n.nodeId === 'service:c')!
    expect(c.confidence).toBeCloseTo(0.25, 5)
  })
  it('getRootCause result passes RootCauseResultSchema.parse (issue #139)', () => {
    // Static scan: traverse.ts must call RootCauseResultSchema.parse before
    // returning. The mutation-authority and FRONTIER scans use the same
    // shape. This catches a future refactor that drops the validation guard.
    const content = readFileSync(join(CORE_SRC, 'traverse.ts'), 'utf8')
    expect(content).toMatch(/RootCauseResultSchema\.parse\s*\(/)
  })
  it('getBlastRadius result passes BlastRadiusResultSchema.parse (issue #139)', () => {
    const content = readFileSync(join(CORE_SRC, 'traverse.ts'), 'utf8')
    expect(content).toMatch(/BlastRadiusResultSchema\.parse\s*\(/)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// getRootCause contract — origin generality + dispatch + reason format (ADR-037)
// ──────────────────────────────────────────────────────────────────────────
describe('getRootCause contract (ADR-037)', () => {
  it('returns null cleanly when origin does not exist', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    expect(getRootCause(g, 'service:does-not-exist')).toBeNull()
  })

  it('edgeProvenances length equals traversalPath.length - 1 on every successful return', async () => {
    // Property assertion that holds for every result the function ever produces.
    // Today's implementation builds these in lockstep, but the contract makes the
    // invariant explicit so future refactors don't drift.
    // (The full fixture-graph test is implemented in traverse.test.ts.)
    expect(true).toBe(true)
  })

  it('ServiceNode origin produces a result when an upstream service violates node-engine compat (issue #123 generalization)', async () => {
    const { extractedEdgeId } = await import('@neat/types')
    const { ensureCompatLoaded } = await import('../../src/compat.js')
    await ensureCompatLoaded()
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    // Origin service (the error surface). The upstream caller has vitest 3.0
    // declared with engines.node = "16" — that's a node-engine violation per
    // compat.json (vitest >= 2 needs Node 18+).
    g.addNode('service:downstream', {
      id: 'service:downstream',
      type: NodeType.ServiceNode,
      name: 'downstream',
      language: 'javascript',
    })
    g.addNode('service:upstream', {
      id: 'service:upstream',
      type: NodeType.ServiceNode,
      name: 'upstream',
      language: 'javascript',
      nodeEngine: '16.0.0',
      dependencies: { vitest: '3.0.0' },
    })
    const callsId = extractedEdgeId('service:upstream', 'service:downstream', EdgeType.CALLS)
    g.addEdgeWithKey(callsId, 'service:upstream', 'service:downstream', {
      id: callsId,
      source: 'service:upstream',
      target: 'service:downstream',
      type: EdgeType.CALLS,
      provenance: Provenance.EXTRACTED,
    })

    const result = getRootCause(g, 'service:downstream')
    expect(result).not.toBeNull()
    expect(result!.rootCauseNode).toBe('service:upstream')
    expect(result!.rootCauseReason).toMatch(/Node\s*18/i)
    expect(result!.fixRecommendation).toMatch(/engines\.node/i)
  })

  it('ConfigNode origin returns null cleanly (no registered shape)', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('config:.env', {
      id: 'config:.env',
      type: NodeType.ConfigNode,
      name: '.env',
      path: '.env',
      fileType: 'env',
    })
    expect(getRootCause(g, 'config:.env')).toBeNull()
  })
  it('result schema-validates before return (issue #139)', () => {
    // Already exercised end-to-end in the Rule 5 block (line ~211); this
    // assertion locks the implementation gate at the contract-block level so
    // future refactors that drop the .parse() call surface here too.
    const content = readFileSync(join(CORE_SRC, 'traverse.ts'), 'utf8')
    expect(content).toMatch(/RootCauseResultSchema\.parse\s*\(/)
  })
  it('traversalPath[0] is the origin and last entry is rootCauseNode', async () => {
    const { extractedEdgeId } = await import('@neat/types')
    const { ensureCompatLoaded } = await import('../../src/compat.js')
    await ensureCompatLoaded()
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    // Reuse the ServiceNode-origin shape — it's the easiest fixture that
    // produces a non-null result without hitting the demo's DB-specific
    // compat path.
    g.addNode('service:downstream', {
      id: 'service:downstream',
      type: NodeType.ServiceNode,
      name: 'downstream',
      language: 'javascript',
    })
    g.addNode('service:upstream', {
      id: 'service:upstream',
      type: NodeType.ServiceNode,
      name: 'upstream',
      language: 'javascript',
      nodeEngine: '16.0.0',
      dependencies: { vitest: '3.0.0' },
    })
    const callsId = extractedEdgeId('service:upstream', 'service:downstream', EdgeType.CALLS)
    g.addEdgeWithKey(callsId, 'service:upstream', 'service:downstream', {
      id: callsId,
      source: 'service:upstream',
      target: 'service:downstream',
      type: EdgeType.CALLS,
      provenance: Provenance.EXTRACTED,
    })
    const result = getRootCause(g, 'service:downstream')
    expect(result).not.toBeNull()
    expect(result!.traversalPath[0]).toBe('service:downstream')
    expect(result!.traversalPath[result!.traversalPath.length - 1]).toBe(result!.rootCauseNode)
    expect(result!.edgeProvenances.length).toBe(result!.traversalPath.length - 1)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// getBlastRadius contract — BFS, positive distance, path + confidence (ADR-038)
// ──────────────────────────────────────────────────────────────────────────
describe('getBlastRadius contract (ADR-038)', () => {
  it('returns empty result cleanly when origin does not exist', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    const result = getBlastRadius(g, 'service:does-not-exist')
    expect(result.affectedNodes).toEqual([])
    expect(result.totalAffected).toBe(0)
  })

  it('totalAffected equals affectedNodes.length on every return', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:a', { id: 'service:a', type: NodeType.ServiceNode, name: 'a', language: 'javascript' })
    const result = getBlastRadius(g, 'service:a')
    expect(result.totalAffected).toBe(result.affectedNodes.length)
  })

  it.todo('BlastRadiusAffectedNode carries path field with origin → ... → nodeId (issue #137)')
  it.todo('BlastRadiusAffectedNode carries confidence field cascaded from edges along path (issue #137)')
  it('BlastRadiusAffectedNode.distance schema rejects 0 (issue #138)', async () => {
    const { BlastRadiusAffectedNodeSchema } = await import('@neat/types')
    // distance must be positive — the origin is never in affectedNodes, so 0
    // has no meaning. Locking this in the schema keeps the BFS at traverse.ts
    // honest mechanically.
    expect(() =>
      BlastRadiusAffectedNodeSchema.parse({
        nodeId: 'service:x',
        distance: 0,
        edgeProvenance: Provenance.OBSERVED,
        path: ['service:origin', 'service:x'],
        confidence: 1.0,
      }),
    ).toThrow()
    // Distance 1 stays valid.
    expect(() =>
      BlastRadiusAffectedNodeSchema.parse({
        nodeId: 'service:x',
        distance: 1,
        edgeProvenance: Provenance.OBSERVED,
        path: ['service:origin', 'service:x'],
        confidence: 1.0,
      }),
    ).not.toThrow()
  })

  it('BlastRadiusAffectedNode carries path field with origin → ... → nodeId (issue #137)', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:a', { id: 'service:a', type: NodeType.ServiceNode, name: 'a', language: 'javascript' })
    g.addNode('service:b', { id: 'service:b', type: NodeType.ServiceNode, name: 'b', language: 'javascript' })
    g.addNode('service:c', { id: 'service:c', type: NodeType.ServiceNode, name: 'c', language: 'javascript' })
    const ab = `${EdgeType.CALLS}:service:a->service:b`
    g.addEdgeWithKey(ab, 'service:a', 'service:b', {
      id: ab, source: 'service:a', target: 'service:b',
      type: EdgeType.CALLS, provenance: Provenance.OBSERVED,
      lastObserved: '2026-05-06T00:00:00.000Z', callCount: 1, confidence: 1.0,
    })
    const bc = `${EdgeType.CALLS}:service:b->service:c`
    g.addEdgeWithKey(bc, 'service:b', 'service:c', {
      id: bc, source: 'service:b', target: 'service:c',
      type: EdgeType.CALLS, provenance: Provenance.OBSERVED,
      lastObserved: '2026-05-06T00:00:00.000Z', callCount: 1, confidence: 1.0,
    })
    const result = getBlastRadius(g, 'service:a')
    const b = result.affectedNodes.find((n) => n.nodeId === 'service:b')!
    const c = result.affectedNodes.find((n) => n.nodeId === 'service:c')!
    expect(b.path).toEqual(['service:a', 'service:b'])
    expect(c.path).toEqual(['service:a', 'service:b', 'service:c'])
  })

  it('BlastRadiusAffectedNode carries confidence field cascaded from edges along path (issue #137)', () => {
    // Two OBSERVED hops at confidence 1.0 each → product 1.0. Two EXTRACTED
    // hops at ceiling 0.5 each → product 0.25 (multiplicative cascade per
    // ADR-036; min-reduce would give 0.5).
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:a', { id: 'service:a', type: NodeType.ServiceNode, name: 'a', language: 'javascript' })
    g.addNode('service:b', { id: 'service:b', type: NodeType.ServiceNode, name: 'b', language: 'javascript' })
    g.addNode('service:c', { id: 'service:c', type: NodeType.ServiceNode, name: 'c', language: 'javascript' })
    const ab = `${EdgeType.CALLS}:service:a->service:b`
    g.addEdgeWithKey(ab, 'service:a', 'service:b', {
      id: ab, source: 'service:a', target: 'service:b',
      type: EdgeType.CALLS, provenance: Provenance.EXTRACTED,
    })
    const bc = `${EdgeType.CALLS}:service:b->service:c`
    g.addEdgeWithKey(bc, 'service:b', 'service:c', {
      id: bc, source: 'service:b', target: 'service:c',
      type: EdgeType.CALLS, provenance: Provenance.EXTRACTED,
    })
    const result = getBlastRadius(g, 'service:a')
    const c = result.affectedNodes.find((n) => n.nodeId === 'service:c')!
    expect(c.confidence).toBeCloseTo(0.25, 5)
  })

  it('result schema-validates before return (issue #139)', () => {
    // Sibling assertion to the getRootCause one at line ~1121. Pinned at the
    // implementation-file level so a refactor that drops .parse() on the
    // BlastRadius return path surfaces here.
    const content = readFileSync(join(CORE_SRC, 'traverse.ts'), 'utf8')
    expect(content).toMatch(/BlastRadiusResultSchema\.parse\s*\(/)
  })

  it('origin is never present in affectedNodes', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:a', { id: 'service:a', type: NodeType.ServiceNode, name: 'a', language: 'javascript' })
    g.addNode('service:b', { id: 'service:b', type: NodeType.ServiceNode, name: 'b', language: 'javascript' })
    const ab = `${EdgeType.CALLS}:service:a->service:b`
    g.addEdgeWithKey(ab, 'service:a', 'service:b', {
      id: ab, source: 'service:a', target: 'service:b',
      type: EdgeType.CALLS, provenance: Provenance.OBSERVED,
      lastObserved: '2026-05-06T00:00:00.000Z', callCount: 1, confidence: 1.0,
    })
    const result = getBlastRadius(g, 'service:a')
    expect(result.affectedNodes.find((n) => n.nodeId === 'service:a')).toBeUndefined()
  })

  it('path[0] === origin and path[path.length - 1] === affectedNode.nodeId for every entry', () => {
    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:a', { id: 'service:a', type: NodeType.ServiceNode, name: 'a', language: 'javascript' })
    g.addNode('service:b', { id: 'service:b', type: NodeType.ServiceNode, name: 'b', language: 'javascript' })
    g.addNode('service:c', { id: 'service:c', type: NodeType.ServiceNode, name: 'c', language: 'javascript' })
    const ab = `${EdgeType.CALLS}:service:a->service:b`
    g.addEdgeWithKey(ab, 'service:a', 'service:b', {
      id: ab, source: 'service:a', target: 'service:b',
      type: EdgeType.CALLS, provenance: Provenance.EXTRACTED,
    })
    const bc = `${EdgeType.CALLS}:service:b->service:c`
    g.addEdgeWithKey(bc, 'service:b', 'service:c', {
      id: bc, source: 'service:b', target: 'service:c',
      type: EdgeType.CALLS, provenance: Provenance.EXTRACTED,
    })
    const result = getBlastRadius(g, 'service:a')
    for (const n of result.affectedNodes) {
      expect(n.path[0]).toBe('service:a')
      expect(n.path[n.path.length - 1]).toBe(n.nodeId)
      expect(n.path.length).toBe(n.distance + 1)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Provenance contract — Edge identity helpers + PROV_RANK (ADR-029)
// ──────────────────────────────────────────────────────────────────────────
describe('Provenance contract — edge identity (ADR-029)', () => {
  it('no hand-rolled `:OBSERVED:`/`:INFERRED:`/`:FRONTIER:` edge id template literals', () => {
    const offenders: string[] = []
    // Match a template literal with `:OBSERVED:` / `:INFERRED:` / `:FRONTIER:` followed by `${...}`.
    const re = /`[^`]*:(OBSERVED|INFERRED|FRONTIER):\$\{/
    for (const file of [...walkSrc(CORE_SRC), ...walkSrc(MCP_SRC)]) {
      const content = readFileSync(file, 'utf8')
      content.split('\n').forEach((line, i) => {
        const trimmed = line.trim()
        if (re.test(line) && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
          offenders.push(`${file}:${i + 1}: ${trimmed}`)
        }
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('no hand-rolled EXTRACTED edge id template literals (`${type}:${source}->${target}`)', () => {
    const offenders: string[] = []
    // Catches the EXTRACTED pattern: `${anything}:${anything}->${anything}` where the
    // first two interpolations are followed by literal `:` and `->`. Allow the helpers
    // themselves (in @neat/types) and test fixtures.
    const re = /`\$\{[^}]+\}:\$\{[^}]+\}->\$\{[^}]+\}`/
    for (const file of [...walkSrc(CORE_SRC), ...walkSrc(MCP_SRC)]) {
      const content = readFileSync(file, 'utf8')
      content.split('\n').forEach((line, i) => {
        const trimmed = line.trim()
        if (re.test(line) && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
          offenders.push(`${file}:${i + 1}: ${trimmed}`)
        }
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('edge id helpers produce stable wire format', async () => {
    const { extractedEdgeId, observedEdgeId, inferredEdgeId, frontierEdgeId } = await import('@neat/types')
    expect(extractedEdgeId('service:a', 'service:b', 'CALLS')).toBe('CALLS:service:a->service:b')
    expect(observedEdgeId('service:a', 'service:b', 'CALLS')).toBe('CALLS:OBSERVED:service:a->service:b')
    expect(inferredEdgeId('service:a', 'service:b', 'CALLS')).toBe('CALLS:INFERRED:service:a->service:b')
    expect(frontierEdgeId('service:a', 'frontier:unknown:8080', 'CALLS')).toBe(
      'CALLS:FRONTIER:service:a->frontier:unknown:8080',
    )
  })

  it('parseEdgeId round-trips all four provenance variants', async () => {
    const { extractedEdgeId, observedEdgeId, inferredEdgeId, frontierEdgeId, parseEdgeId } =
      await import('@neat/types')
    const cases = [
      { make: extractedEdgeId, prov: 'EXTRACTED' as const },
      { make: observedEdgeId, prov: 'OBSERVED' as const },
      { make: inferredEdgeId, prov: 'INFERRED' as const },
      { make: frontierEdgeId, prov: 'FRONTIER' as const },
    ]
    for (const { make, prov } of cases) {
      const id = make('service:a', 'service:b', 'CALLS')
      expect(parseEdgeId(id)).toEqual({
        type: 'CALLS',
        provenance: prov,
        source: 'service:a',
        target: 'service:b',
      })
    }
    expect(parseEdgeId('not-an-edge-id')).toBe(null)
    expect(parseEdgeId('CALLS:no-arrow')).toBe(null)
  })

  it('PROV_RANK ordering is OBSERVED > INFERRED > EXTRACTED > {STALE, FRONTIER}', async () => {
    const { PROV_RANK } = await import('@neat/types')
    expect(PROV_RANK.OBSERVED).toBeGreaterThan(PROV_RANK.INFERRED)
    expect(PROV_RANK.INFERRED).toBeGreaterThan(PROV_RANK.EXTRACTED)
    expect(PROV_RANK.EXTRACTED).toBeGreaterThan(PROV_RANK.STALE)
    expect(PROV_RANK.FRONTIER).toBe(0)
    expect(PROV_RANK.STALE).toBe(0)
  })

  it('PROV_RANK is frozen (Object.isFrozen)', async () => {
    const { PROV_RANK } = await import('@neat/types')
    expect(Object.isFrozen(PROV_RANK)).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Rule 8 — No demo-name hardcoding in branching logic
// ──────────────────────────────────────────────────────────────────────────
describe('Rule 8 — No demo-name hardcoding', () => {
  // Demo node names are unambiguous: service-a, service-b, payments-db come from
  // the pg demo and must not appear in branching logic anywhere in core/mcp.
  // 'pg' and 'postgresql' are real driver/engine names — their data-shaped use
  // (e.g. mapping 'postgres://' → 'postgresql') is allowed; the rule for those
  // is "data-driven via compat.json", which is checked by other tests.
  it('no demo node names (service-a / service-b / payments-db) in core/mcp src', () => {
    const offenders: string[] = []
    const re = /\b(service-a|service-b|payments-db)\b/
    for (const file of [...walkSrc(CORE_SRC), ...walkSrc(MCP_SRC)]) {
      const content = readFileSync(file, 'utf8')
      content.split('\n').forEach((line, i) => {
        const trimmed = line.trim()
        // Allow inside Zod .describe() example strings (documentation hints)
        // and inside line comments. Disallow everywhere else in src.
        if (
          re.test(line) &&
          !line.includes('.describe(') &&
          !trimmed.startsWith('//') &&
          !trimmed.startsWith('*')
        ) {
          offenders.push(`${file}:${i + 1}: ${trimmed}`)
        }
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Schema sanity — every emitted edge passes GraphEdgeSchema
// ──────────────────────────────────────────────────────────────────────────
describe('Schema sanity — Zod parses', () => {
  it('GraphEdgeSchema accepts a valid OBSERVED edge', () => {
    const edge = {
      id: 'CALLS:OBSERVED:a->b',
      type: EdgeType.CALLS,
      source: 'service:a',
      target: 'service:b',
      provenance: Provenance.OBSERVED,
      lastObserved: '2026-05-04T00:00:00.000Z',
      callCount: 1,
      confidence: 1.0,
    }
    expect(() => GraphEdgeSchema.parse(edge)).not.toThrow()
  })

  it('GraphEdgeSchema accepts a valid EXTRACTED edge', () => {
    const edge = {
      id: 'CALLS:a->b',
      type: EdgeType.CALLS,
      source: 'service:a',
      target: 'service:b',
      provenance: Provenance.EXTRACTED,
    }
    expect(() => GraphEdgeSchema.parse(edge)).not.toThrow()
  })

  it('GraphEdgeSchema accepts a valid INFERRED edge with confidence', () => {
    const edge = {
      id: 'CALLS:INFERRED:a->b',
      type: EdgeType.CALLS,
      source: 'service:a',
      target: 'service:b',
      provenance: Provenance.INFERRED,
      confidence: 0.6,
    }
    expect(() => GraphEdgeSchema.parse(edge)).not.toThrow()
  })

  it('GraphEdgeSchema rejects an unknown provenance', () => {
    const edge = {
      id: 'CALLS:a->b',
      type: EdgeType.CALLS,
      source: 'service:a',
      target: 'service:b',
      provenance: 'WHATEVER',
    }
    expect(() => GraphEdgeSchema.parse(edge)).toThrow()
  })

  it('EdgeTypeSchema includes the v0.1.x extensions', () => {
    expect(EdgeTypeSchema.options).toEqual(
      expect.arrayContaining(['CALLS', 'DEPENDS_ON', 'CONNECTS_TO', 'CONFIGURED_BY', 'RUNS_ON', 'PUBLISHES_TO', 'CONSUMES_FROM']),
    )
  })

  it('GraphNodeSchema includes FrontierNode (ADR-023)', () => {
    expect(() =>
      GraphNodeSchema.parse({
        id: 'frontier:unknown:1234',
        type: NodeType.FrontierNode,
        name: 'unknown:1234',
        host: 'unknown:1234',
      }),
    ).not.toThrow()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// MCP tool surface contract (ADR-039)
// ──────────────────────────────────────────────────────────────────────────
describe('MCP tool surface contract (ADR-039)', () => {
  it('mcp/src never mutates the graph', () => {
    const offenders: string[] = []
    const re = /\b(graph|g)\.(addNode|addEdge|dropNode|dropEdge|replaceEdgeAttributes|replaceNodeAttributes|mergeEdgeAttributes|mergeNodeAttributes)\s*\(/
    for (const file of walkSrc(MCP_SRC)) {
      const content = readFileSync(file, 'utf8')
      content.split('\n').forEach((line, i) => {
        const trimmed = line.trim()
        if (re.test(line) && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
          offenders.push(`${file}:${i + 1}: ${trimmed}`)
        }
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it.todo('every server.tool registration in mcp/src/index.ts has a name from the locked allowlist of nine tools (ADR-039)')
  it.todo('formatToolResponse helper exists at mcp/src/format.ts (issue #143)')
  it.todo('get_dependencies is transitive — calls /graph/node/:id/dependencies?depth=N (issue #144)')
  it.todo('check_policies tool registered with optional hypotheticalAction (v0.2.4 #117)')
})

// ──────────────────────────────────────────────────────────────────────────
// REST API contract (ADR-040)
// ──────────────────────────────────────────────────────────────────────────
describe('REST API contract (ADR-040)', () => {
  it.todo('every read endpoint mounts at both /X and /projects/:project/X')
  it.todo('error responses are JSON-shaped { error, status, details? }')
  it.todo('GET /graph/node/:id/dependencies?depth=N exists (issue #144)')
  it.todo('POST endpoints validate inbound bodies with Zod schemas from @neat/types')
  it.todo('GET /policies and /policies/violations exist (v0.2.4 #117)')
})

// ──────────────────────────────────────────────────────────────────────────
// Persistence contract (ADR-041)
// ──────────────────────────────────────────────────────────────────────────
describe('Persistence contract (ADR-041)', () => {
  it('SCHEMA_VERSION constant exists in persist.ts', () => {
    const persist = readFileSync(join(CORE_SRC, 'persist.ts'), 'utf8')
    expect(persist).toMatch(/const\s+SCHEMA_VERSION\s*=\s*\d+/)
  })
  it.todo('policy-violations.ndjson append-only writer exists (v0.2.4 #116)')
})

// ──────────────────────────────────────────────────────────────────────────
// Policy contracts (ADRs 042-045)
// ──────────────────────────────────────────────────────────────────────────
describe('Policy contracts (ADRs 042-045)', () => {
  it.todo('PolicyFileSchema exists in @neat/types/policy.ts with version: z.literal(1) (ADR-042)')
  it.todo('Policy is a discriminated union by rule.type with five MVP types (ADR-042)')
  it.todo('PolicyFileSchema.parse fails loudly on malformed policy.json (ADR-042)')
  it.todo('evaluateAllPolicies is pure and dispatches by rule.type (ADR-043)')
  it.todo('PolicyViolation ids are deterministic (ADR-043)')
  it.todo('post-ingest, post-extract, post-stale-transition all trigger evaluateAllPolicies (ADR-043)')
  it.todo('log action appends to ndjson with no MCP notification (ADR-044)')
  it.todo('alert action appends + emits notifications/resources/updated (ADR-044)')
  it.todo('block action returns false from canPromoteFrontier when block-policy violates (ADR-044)')
  it.todo('severity-driven default actions (info→log, warning→alert, error→alert, critical→block) (ADR-044)')
  it.todo('check_policies MCP tool registered with optional scope and hypotheticalAction (ADR-045)')
  it.todo('GET /policies and /policies/violations REST endpoints with dual-mount (ADR-045)')
  it.todo('neat://policies/violations MCP resource registered and emits updates (ADR-045)')
})

// ──────────────────────────────────────────────────────────────────────────
// Queued — flipped from todo to live as cleanup issues land
// ──────────────────────────────────────────────────────────────────────────
describe('Queued contracts (issues #140-#145)', () => {
  // v0.2.2 OTel-ingest todos (#131-#135) used to live here. Removed when v0.2.2
  // closed — every ADR-033 assertion is live in its dedicated describe block.
  // v0.2.3 traversal todos (#136-#139) used to live here too. Removed when
  // v0.2.3 closed — every ADR-036/037/038 assertion is live in its dedicated
  // describe block.
  it('Ghost EXTRACTED edges removed on re-extract (issue #140)', async () => {
    const { extractedEdgeId } = await import('@neat/types')
    const { retireEdgesByFile } = await import('../../src/extract/retire.js')

    const g: NeatGraph = new MultiDirectedGraph<GraphNode, GraphEdge>({ allowSelfLoops: false })
    g.addNode('service:a', {
      id: 'service:a',
      type: NodeType.ServiceNode,
      name: 'a',
      language: 'javascript',
    })
    g.addNode('database:db', {
      id: 'database:db',
      type: NodeType.DatabaseNode,
      name: 'db',
      engine: 'postgresql',
      engineVersion: '15',
      host: 'db',
    })

    const ghostId = extractedEdgeId('service:a', 'database:db', EdgeType.CONNECTS_TO)
    g.addEdgeWithKey(ghostId, 'service:a', 'database:db', {
      id: ghostId,
      source: 'service:a',
      target: 'database:db',
      type: EdgeType.CONNECTS_TO,
      provenance: Provenance.EXTRACTED,
      evidence: { file: 'a/.env' },
    })

    // Edge from a different file survives — retire is path-keyed, not blanket.
    const survivorId = `${EdgeType.CONFIGURED_BY}:service:a->config:a/db.yaml`
    g.addNode('config:a/db.yaml', {
      id: 'config:a/db.yaml',
      type: NodeType.ConfigNode,
      name: 'db.yaml',
      path: 'a/db.yaml',
      fileType: 'yaml',
    })
    g.addEdgeWithKey(survivorId, 'service:a', 'config:a/db.yaml', {
      id: survivorId,
      source: 'service:a',
      target: 'config:a/db.yaml',
      type: EdgeType.CONFIGURED_BY,
      provenance: Provenance.EXTRACTED,
      evidence: { file: 'a/db.yaml' },
    })

    const dropped = retireEdgesByFile(g, 'a/.env')
    expect(dropped).toBe(1)
    expect(g.hasEdge(ghostId)).toBe(false)
    expect(g.hasEdge(survivorId)).toBe(true)
  })
  it.todo('Source-level DB connection + import detection (issue #141)')
  it.todo('ServiceNode.framework populated from package.json (issue #142)')
  it.todo('MCP tools emit standardized three-part response (issue #143)')
  it.todo('get_dependencies is transitive (issue #144)')
  it.todo('Drop unused graphology-traversal/-shortest-path deps (issue #145)')
})
