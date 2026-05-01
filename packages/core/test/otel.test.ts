import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  buildOtelReceiver,
  parseOtlpRequest,
  type OtlpTracesRequest,
  type ParsedSpan,
} from '../src/otel.js'

// Canned OTLP/HTTP JSON body: one trace, one root span on service-a calling
// service-b, plus a child span on service-b that errored against the database.
const SAMPLE_BODY: OtlpTracesRequest = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'service-a' } },
          { key: 'telemetry.sdk.language', value: { stringValue: 'nodejs' } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: 'aabbccddeeff00112233445566778899',
              spanId: '1111111111111111',
              name: 'GET /data',
              kind: 2,
              startTimeUnixNano: '1000000000000000000',
              endTimeUnixNano: '1000000000050000000',
              attributes: [
                { key: 'http.method', value: { stringValue: 'GET' } },
                { key: 'http.status_code', value: { intValue: '500' } },
              ],
              status: { code: 0 },
            },
          ],
        },
      ],
    },
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: 'service-b' } }],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: 'aabbccddeeff00112233445566778899',
              spanId: '2222222222222222',
              parentSpanId: '1111111111111111',
              name: 'pg.query',
              kind: 3,
              startTimeUnixNano: '1000000000010000000',
              endTimeUnixNano: '1000000000040000000',
              attributes: [
                { key: 'db.system', value: { stringValue: 'postgresql' } },
                { key: 'db.name', value: { stringValue: 'neatdemo' } },
                { key: 'db.statement', value: { stringValue: 'SELECT now()' } },
              ],
              status: { code: 2, message: 'SASL: SCRAM-SERVER-FIRST-MESSAGE' },
            },
          ],
        },
      ],
    },
  ],
}

describe('parseOtlpRequest', () => {
  it('flattens resource + scope + span into ParsedSpan list', () => {
    const spans = parseOtlpRequest(SAMPLE_BODY)
    expect(spans).toHaveLength(2)
  })

  it('extracts service.name from resource attributes', () => {
    const spans = parseOtlpRequest(SAMPLE_BODY)
    expect(spans[0].service).toBe('service-a')
    expect(spans[1].service).toBe('service-b')
  })

  it('keeps parent/child span linkage', () => {
    const spans = parseOtlpRequest(SAMPLE_BODY)
    expect(spans[0].parentSpanId).toBeUndefined()
    expect(spans[1].parentSpanId).toBe('1111111111111111')
  })

  it('hoists db.system and db.name onto the parsed span', () => {
    const spans = parseOtlpRequest(SAMPLE_BODY)
    expect(spans[0].dbSystem).toBeUndefined()
    expect(spans[1].dbSystem).toBe('postgresql')
    expect(spans[1].dbName).toBe('neatdemo')
  })

  it('preserves the full attribute bag', () => {
    const spans = parseOtlpRequest(SAMPLE_BODY)
    expect(spans[0].attributes['http.method']).toBe('GET')
    expect(spans[0].attributes['http.status_code']).toBe(500)
    expect(spans[1].attributes['db.statement']).toBe('SELECT now()')
  })

  it('captures status.code = 2 as the error signal', () => {
    const spans = parseOtlpRequest(SAMPLE_BODY)
    expect(spans[0].statusCode).toBe(0)
    expect(spans[1].statusCode).toBe(2)
    expect(spans[1].errorMessage).toMatch(/SCRAM/)
  })

  it('computes durationNanos as endTime - startTime', () => {
    const spans = parseOtlpRequest(SAMPLE_BODY)
    expect(spans[0].durationNanos).toBe(50_000_000n)
    expect(spans[1].durationNanos).toBe(30_000_000n)
  })

  it('returns [] for an empty body', () => {
    expect(parseOtlpRequest({})).toEqual([])
    expect(parseOtlpRequest({ resourceSpans: [] })).toEqual([])
  })

  it('falls back to "unknown" service when service.name is missing', () => {
    const spans = parseOtlpRequest({
      resourceSpans: [
        {
          scopeSpans: [
            { spans: [{ traceId: 'a', spanId: 'b', name: 'x' }] },
          ],
        },
      ],
    })
    expect(spans[0].service).toBe('unknown')
  })
})

describe('buildOtelReceiver', () => {
  let app: FastifyInstance
  let collected: ParsedSpan[]

  beforeEach(async () => {
    collected = []
    app = await buildOtelReceiver({
      onSpan: (s) => {
        collected.push(s)
      },
    })
  })

  afterEach(async () => {
    await app.close()
  })

  it('POST /v1/traces accepts JSON OTLP and dispatches each span', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/traces',
      headers: { 'content-type': 'application/json' },
      payload: SAMPLE_BODY,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ partialSuccess: {} })
    expect(collected).toHaveLength(2)
    expect(collected[0].service).toBe('service-a')
    expect(collected[1].service).toBe('service-b')
  })

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('handles an empty payload without erroring', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/traces',
      headers: { 'content-type': 'application/json' },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(collected).toEqual([])
  })

  it('awaits async handlers before returning', async () => {
    await app.close()
    const observed: string[] = []
    app = await buildOtelReceiver({
      onSpan: async (s) => {
        await new Promise((r) => setTimeout(r, 5))
        observed.push(s.spanId)
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/traces',
      headers: { 'content-type': 'application/json' },
      payload: SAMPLE_BODY,
    })
    expect(res.statusCode).toBe(200)
    expect(observed).toEqual(['1111111111111111', '2222222222222222'])
  })
})
