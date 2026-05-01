import { describe, expect, it } from 'vitest'
import { EdgeType, NodeType, Provenance } from '@neat/types'
import { HttpError, type HttpClient } from '../src/client.js'
import {
  getBlastRadius,
  getDependencies,
  getIncidentHistory,
  getObservedDependencies,
  getRootCause,
  semanticSearch,
} from '../src/tools.js'

interface Capture {
  paths: string[]
}

// Decoded lookup so test keys can read like '/incidents/database:payments-db'
// instead of '/incidents/database%3Apayments-db'. Capture records the raw,
// pre-decode path so tests can assert on actual encoding.
function decodePath(p: string): string {
  const [base, ...rest] = p.split('?')
  return decodeURIComponent(base) + (rest.length ? '?' + rest.join('?') : '')
}

function clientFor(map: Record<string, unknown>, capture: Capture = { paths: [] }): {
  client: HttpClient
  capture: Capture
} {
  return {
    capture,
    client: {
      async get<T>(path: string): Promise<T> {
        capture.paths.push(path)
        const decoded = decodePath(path)
        if (decoded in map) return map[decoded] as T
        if (path in map) return map[path] as T
        throw new HttpError(404, `404 on ${path}`)
      },
    },
  }
}

function errorClient(err: Error): HttpClient {
  return {
    async get<T>(): Promise<T> {
      throw err
    },
  }
}

describe('getRootCause', () => {
  it('formats RootCauseResult as natural language with arrow path', async () => {
    const { client, capture } = clientFor({
      '/traverse/root-cause/database:payments-db': {
        rootCauseNode: 'service:service-b',
        rootCauseReason:
          'PostgreSQL 14+ requires scram-sha-256; pg < 8.0.0 only speaks md5.',
        traversalPath: ['database:payments-db', 'service:service-b', 'service:service-a'],
        edgeProvenances: [Provenance.OBSERVED, Provenance.OBSERVED],
        confidence: 1,
        fixRecommendation: 'Upgrade service-b pg driver to >= 8.0.0',
      },
    })
    const res = await getRootCause(client, { errorNode: 'database:payments-db' })
    expect(res.isError).toBeFalsy()
    const text = res.content[0].text
    expect(text).toContain('Root cause identified: service:service-b')
    expect(text).toContain('database:payments-db ← service:service-b ← service:service-a')
    expect(text).toContain('Confidence: 1.00')
    expect(text).toContain('OBSERVED, OBSERVED')
    expect(text).toContain('Recommended fix: Upgrade service-b pg driver to >= 8.0.0')
    expect(capture.paths).toEqual(['/traverse/root-cause/database%3Apayments-db'])
  })

  it('threads errorId through as a query parameter', async () => {
    const { client, capture } = clientFor({
      '/traverse/root-cause/database:payments-db?errorId=trace-1%3Aspan-b': {
        rootCauseNode: 'service:service-b',
        rootCauseReason: 'reason',
        traversalPath: ['database:payments-db', 'service:service-b'],
        edgeProvenances: [Provenance.EXTRACTED],
        confidence: 0.5,
      },
    })
    await getRootCause(client, { errorNode: 'database:payments-db', errorId: 'trace-1:span-b' })
    expect(capture.paths[0]).toBe(
      '/traverse/root-cause/database%3Apayments-db?errorId=trace-1%3Aspan-b',
    )
  })

  it('returns a friendly message on 404', async () => {
    const { client } = clientFor({})
    const res = await getRootCause(client, { errorNode: 'database:nope' })
    expect(res.isError).toBeFalsy()
    expect(res.content[0].text).toContain('No root cause found')
  })

  it('reports a non-404 error as isError', async () => {
    const res = await getRootCause(errorClient(new Error('connect ECONNREFUSED')), {
      errorNode: 'database:payments-db',
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('ECONNREFUSED')
  })
})

describe('getBlastRadius', () => {
  it('lists affected nodes sorted by distance with provenance tags', async () => {
    const { client } = clientFor({
      '/traverse/blast-radius/service:service-a': {
        origin: 'service:service-a',
        totalAffected: 2,
        affectedNodes: [
          {
            nodeId: 'database:payments-db',
            distance: 2,
            edgeProvenance: Provenance.OBSERVED,
          },
          {
            nodeId: 'service:service-b',
            distance: 1,
            edgeProvenance: Provenance.OBSERVED,
          },
        ],
      },
    })
    const res = await getBlastRadius(client, { nodeId: 'service:service-a' })
    const lines = res.content[0].text.split('\n')
    expect(lines[0]).toContain('Blast radius for service:service-a (2 affected)')
    // service-b at distance 1 should appear before payments-db at distance 2
    const bIdx = lines.findIndex((l) => l.includes('service:service-b'))
    const dbIdx = lines.findIndex((l) => l.includes('database:payments-db'))
    expect(bIdx).toBeGreaterThan(0)
    expect(dbIdx).toBeGreaterThan(bIdx)
  })

  it('flags STALE edges explicitly', async () => {
    const { client } = clientFor({
      '/traverse/blast-radius/service:service-a': {
        origin: 'service:service-a',
        totalAffected: 1,
        affectedNodes: [
          {
            nodeId: 'service:service-b',
            distance: 1,
            edgeProvenance: Provenance.STALE,
          },
        ],
      },
    })
    const res = await getBlastRadius(client, { nodeId: 'service:service-a' })
    expect(res.content[0].text).toContain('[STALE')
  })

  it('handles a node with no downstream nodes', async () => {
    const { client } = clientFor({
      '/traverse/blast-radius/database:payments-db': {
        origin: 'database:payments-db',
        totalAffected: 0,
        affectedNodes: [],
      },
    })
    const res = await getBlastRadius(client, { nodeId: 'database:payments-db' })
    expect(res.content[0].text).toContain('no downstream dependencies')
  })

  it('passes depth as a query parameter', async () => {
    const { client, capture } = clientFor({
      '/traverse/blast-radius/service:service-a?depth=1': {
        origin: 'service:service-a',
        totalAffected: 0,
        affectedNodes: [],
      },
    })
    await getBlastRadius(client, { nodeId: 'service:service-a', depth: 1 })
    expect(capture.paths[0]).toBe('/traverse/blast-radius/service%3Aservice-a?depth=1')
  })
})

describe('getDependencies', () => {
  it('returns outgoing edges with the best provenance per pair', async () => {
    const { client } = clientFor({
      '/graph/edges/service:service-a': {
        inbound: [],
        outbound: [
          {
            id: 'CALLS:service:service-a->service:service-b',
            source: 'service:service-a',
            target: 'service:service-b',
            type: EdgeType.CALLS,
            provenance: Provenance.EXTRACTED,
          },
          {
            id: 'CALLS:OBSERVED:service:service-a->service:service-b',
            source: 'service:service-a',
            target: 'service:service-b',
            type: EdgeType.CALLS,
            provenance: Provenance.OBSERVED,
            confidence: 1,
            callCount: 11,
            lastObserved: '2026-05-01T15:51:11.967Z',
          },
        ],
      },
    })
    const res = await getDependencies(client, { nodeId: 'service:service-a' })
    const text = res.content[0].text
    expect(text).toContain('Dependencies of service:service-a')
    expect(text).toContain('service:service-b — CALLS (OBSERVED)')
    expect(text).toContain('callCount=11')
    // The EXTRACTED twin should be deduped out.
    expect(text.split('\n').filter((l) => l.includes('service:service-b'))).toHaveLength(1)
  })

  it('returns a friendly message when there are no outgoing edges', async () => {
    const { client } = clientFor({
      '/graph/edges/database:payments-db': { inbound: [], outbound: [] },
    })
    const res = await getDependencies(client, { nodeId: 'database:payments-db' })
    expect(res.content[0].text).toContain('no outgoing dependencies')
  })
})

describe('getObservedDependencies', () => {
  it('filters to OBSERVED only and includes lastObserved + callCount', async () => {
    const { client } = clientFor({
      '/graph/edges/service:service-a': {
        inbound: [],
        outbound: [
          {
            id: 'CALLS:service:service-a->service:service-b',
            source: 'service:service-a',
            target: 'service:service-b',
            type: EdgeType.CALLS,
            provenance: Provenance.EXTRACTED,
          },
          {
            id: 'CALLS:OBSERVED:service:service-a->service:service-b',
            source: 'service:service-a',
            target: 'service:service-b',
            type: EdgeType.CALLS,
            provenance: Provenance.OBSERVED,
            confidence: 1,
            callCount: 11,
            lastObserved: '2026-05-01T15:51:11.967Z',
          },
        ],
      },
    })
    const res = await getObservedDependencies(client, { nodeId: 'service:service-a' })
    const text = res.content[0].text
    expect(text).toContain('Runtime dependencies of service:service-a')
    expect(text).toContain('service:service-b')
    expect(text).toContain('lastObserved=2026-05-01T15:51:11.967Z')
  })

  it('explains the OTel-down case when only EXTRACTED edges exist', async () => {
    const { client } = clientFor({
      '/graph/edges/service:service-a': {
        inbound: [],
        outbound: [
          {
            id: 'CALLS:service:service-a->service:service-b',
            source: 'service:service-a',
            target: 'service:service-b',
            type: EdgeType.CALLS,
            provenance: Provenance.EXTRACTED,
          },
        ],
      },
    })
    const res = await getObservedDependencies(client, { nodeId: 'service:service-a' })
    expect(res.content[0].text).toContain('OTel running')
  })
})

describe('getIncidentHistory', () => {
  it('returns events newest first with trace and span ids', async () => {
    const { client } = clientFor({
      '/incidents/database:payments-db': [
        {
          id: 'trace-1:span-1',
          timestamp: '2026-05-01T15:00:00.000Z',
          service: 'service-b',
          traceId: 'trace-1',
          spanId: 'span-1',
          errorMessage: 'older',
          affectedNode: 'database:payments-db',
        },
        {
          id: 'trace-2:span-2',
          timestamp: '2026-05-01T15:30:00.000Z',
          service: 'service-b',
          traceId: 'trace-2',
          spanId: 'span-2',
          errorMessage: 'SCRAM-SERVER-FIRST-MESSAGE',
          affectedNode: 'database:payments-db',
        },
      ],
    })
    const res = await getIncidentHistory(client, { nodeId: 'database:payments-db' })
    const text = res.content[0].text
    expect(text).toContain('Recent incidents on database:payments-db (2 of 2)')
    const newerIdx = text.indexOf('SCRAM')
    const olderIdx = text.indexOf('older')
    expect(newerIdx).toBeGreaterThan(0)
    expect(newerIdx).toBeLessThan(olderIdx)
    expect(text).toContain('trace=trace-2 span=span-2')
  })

  it('honours limit', async () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      id: `t:${i}`,
      timestamp: `2026-05-01T15:0${i}:00.000Z`,
      service: 's',
      traceId: `trace-${i}`,
      spanId: `span-${i}`,
      errorMessage: `e${i}`,
      affectedNode: 'database:payments-db',
    }))
    const { client } = clientFor({ '/incidents/database:payments-db': events })
    const res = await getIncidentHistory(client, { nodeId: 'database:payments-db', limit: 2 })
    expect(res.content[0].text).toContain('(2 of 5)')
  })

  it('returns a friendly message for an empty list', async () => {
    const { client } = clientFor({ '/incidents/service:service-a': [] })
    const res = await getIncidentHistory(client, { nodeId: 'service:service-a' })
    expect(res.content[0].text).toContain('No incidents recorded')
  })
})

describe('semanticSearch', () => {
  it('formats matches with id, type, and name', async () => {
    const { client } = clientFor({
      '/search?q=service-b': {
        query: 'service-b',
        matches: [
          {
            id: 'service:service-b',
            type: NodeType.ServiceNode,
            name: 'service-b',
            language: 'javascript',
          },
        ],
      },
    })
    const res = await semanticSearch(client, { query: 'service-b' })
    expect(res.content[0].text).toContain('service:service-b (ServiceNode) — service-b')
  })

  it('returns a friendly message when there are no matches', async () => {
    const { client } = clientFor({
      '/search?q=nothing': { query: 'nothing', matches: [] },
    })
    const res = await semanticSearch(client, { query: 'nothing' })
    expect(res.content[0].text).toContain('No matches')
  })
})
