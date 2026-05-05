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
  it.todo('getRootCause skips FRONTIER edges (issue #136)')
  it.todo('getBlastRadius skips FRONTIER edges (issue #136)')
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

  it.todo('getRootCause validates result against RootCauseResultSchema (issue #139)')
  it.todo('getBlastRadius validates result against BlastRadiusResultSchema (issue #139)')
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
// Queued — flipped from todo to live as cleanup issues land
// ──────────────────────────────────────────────────────────────────────────
describe('Queued contracts (issues #131-#145)', () => {
  it.todo('OTel receiver replies before mutation (issue #131)')
  it.todo('lastObserved sourced from span startTimeUnixNano (issue #132)')
  it.todo('parent-span cache correlates cross-service CALLS (issue #133)')
  it.todo('OTel auto-creates ServiceNode/DatabaseNode for unknown peers (issue #134)')
  it.todo('span events with name=exception parsed into ErrorEvent (issue #135)')
  it.todo('FRONTIER edges skipped by traversal (issue #136)')
  it.todo('BlastRadiusAffectedNode carries path and confidence (issue #137)')
  it.todo('BlastRadius distance schema rejects 0 (issue #138)')
  it.todo('Traversal results validated against Zod schemas (issue #139)')
  it.todo('Ghost EXTRACTED edges removed on re-extract (issue #140)')
  it.todo('Source-level DB connection + import detection (issue #141)')
  it.todo('ServiceNode.framework populated from package.json (issue #142)')
  it.todo('MCP tools emit standardized three-part response (issue #143)')
  it.todo('get_dependencies is transitive (issue #144)')
  it.todo('Drop unused graphology-traversal/-shortest-path deps (issue #145)')
})
