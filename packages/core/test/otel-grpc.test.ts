import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { startOtelGrpcReceiver, type OtelGrpcReceiver } from '../src/otel-grpc.js'
import type { ParsedSpan } from '../src/otel.js'

// Same shape as the canned HTTP body in otel.test.ts, just expressed in the
// gRPC-side snake_case + Buffer format.
const TRACE_ID = Buffer.from('aabbccddeeff00112233445566778899', 'hex')
const SPAN_A = Buffer.from('1111111111111111', 'hex')
const SPAN_B = Buffer.from('2222222222222222', 'hex')

const SAMPLE_GRPC_REQUEST = {
  resource_spans: [
    {
      resource: {
        attributes: [{ key: 'service.name', value: { string_value: 'service-a' } }],
      },
      scope_spans: [
        {
          spans: [
            {
              trace_id: TRACE_ID,
              span_id: SPAN_A,
              name: 'GET /data',
              kind: 2,
              start_time_unix_nano: '1000000000000000000',
              end_time_unix_nano: '1000000000050000000',
              attributes: [
                { key: 'http.method', value: { string_value: 'GET' } },
                { key: 'http.status_code', value: { int_value: '500' } },
              ],
              status: { code: 0 },
            },
          ],
        },
      ],
    },
    {
      resource: {
        attributes: [{ key: 'service.name', value: { string_value: 'service-b' } }],
      },
      scope_spans: [
        {
          spans: [
            {
              trace_id: TRACE_ID,
              span_id: SPAN_B,
              parent_span_id: SPAN_A,
              name: 'pg.query',
              kind: 3,
              start_time_unix_nano: '1000000000010000000',
              end_time_unix_nano: '1000000000040000000',
              attributes: [
                { key: 'db.system', value: { string_value: 'postgresql' } },
                { key: 'db.name', value: { string_value: 'neatdemo' } },
              ],
              status: { code: 2, message: 'SASL: SCRAM-SERVER-FIRST-MESSAGE' },
            },
          ],
        },
      ],
    },
  ],
}

function loadClientStub(): {
  TraceService: grpc.ServiceClientConstructor
} {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const protoRoot = path.resolve(here, '..', 'proto')
  const def = protoLoader.loadSync(
    'opentelemetry/proto/collector/trace/v1/trace_service.proto',
    {
      keepCase: true,
      longs: String,
      enums: Number,
      defaults: true,
      oneofs: true,
      includeDirs: [protoRoot],
    },
  )
  const pkg = grpc.loadPackageDefinition(def) as unknown as {
    opentelemetry: {
      proto: { collector: { trace: { v1: { TraceService: grpc.ServiceClientConstructor } } } }
    }
  }
  return { TraceService: pkg.opentelemetry.proto.collector.trace.v1.TraceService }
}

describe('startOtelGrpcReceiver', () => {
  let receiver: OtelGrpcReceiver
  let collected: ParsedSpan[]

  beforeEach(async () => {
    collected = []
    receiver = await startOtelGrpcReceiver({
      onSpan: (s) => {
        collected.push(s)
      },
      port: 0,
    })
  })

  afterEach(async () => {
    await receiver.stop()
  })

  it('decodes a gRPC Export request and dispatches each span via onSpan', async () => {
    const { TraceService } = loadClientStub()
    const client = new TraceService(receiver.address, grpc.credentials.createInsecure())

    const response = await new Promise<unknown>((resolve, reject) => {
      ;(client as unknown as { Export: Function }).Export(
        SAMPLE_GRPC_REQUEST,
        (err: grpc.ServiceError | null, res: unknown) => {
          if (err) return reject(err)
          resolve(res)
        },
      )
    })
    client.close()

    expect(response).toMatchObject({ partial_success: {} })
    expect(collected).toHaveLength(2)
    expect(collected[0].service).toBe('service-a')
    expect(collected[1].service).toBe('service-b')
    expect(collected[1].dbSystem).toBe('postgresql')
    expect(collected[1].dbName).toBe('neatdemo')
    expect(collected[1].statusCode).toBe(2)
    expect(collected[1].errorMessage).toMatch(/SCRAM/)
    // bytes → hex round-trip preserves trace/span identity.
    expect(collected[0].traceId).toBe('aabbccddeeff00112233445566778899')
    expect(collected[0].spanId).toBe('1111111111111111')
    expect(collected[1].parentSpanId).toBe('1111111111111111')
  })

  it('binds on an ephemeral port (port=0) and reports the resolved address', async () => {
    expect(receiver.address).toMatch(/^0\.0\.0\.0:\d+$/)
    const port = Number(receiver.address.split(':')[1])
    expect(port).toBeGreaterThan(0)
  })

  it('handles an empty request without erroring', async () => {
    const { TraceService } = loadClientStub()
    const client = new TraceService(receiver.address, grpc.credentials.createInsecure())

    await new Promise<void>((resolve, reject) => {
      ;(client as unknown as { Export: Function }).Export(
        { resource_spans: [] },
        (err: grpc.ServiceError | null) => {
          if (err) return reject(err)
          resolve()
        },
      )
    })
    client.close()

    expect(collected).toEqual([])
  })
})
