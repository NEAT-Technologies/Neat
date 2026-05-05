import Fastify, { type FastifyInstance } from 'fastify'

// OTLP/HTTP receiver. Listens on /v1/traces and decodes the JSON wire format
// (collector's `otlphttp` exporter with `encoding: json`). Each span is
// flattened into a ParsedSpan and handed to the configured handler. The
// handler is the seam #8 wires its edge mapper into; #7 itself stays decoupled
// from graph mutation.

export interface ParsedSpan {
  service: string
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind?: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  // ISO8601 derived from startTimeUnixNano. Production paths (lastObserved on
  // OBSERVED edges) read this so the recorded time reflects when the span fired,
  // not when the receiver received it. Undefined only when startTimeUnixNano is
  // missing or unparseable — handler falls back to wall-clock in that case.
  // See docs/contracts/otel-ingest.md §lastObserved-from-span-time.
  startTimeIso?: string
  // bigint so the 9-digit-nanos arithmetic doesn't lose precision on long traces.
  durationNanos: bigint
  attributes: Record<string, AttributeValue>
  // Convenience accessors for the attributes #8 cares about.
  dbSystem?: string
  dbName?: string
  // 0 = UNSET, 1 = OK, 2 = ERROR per OTLP. We only care that 2 means error.
  statusCode?: number
  errorMessage?: string
}

export type AttributeValue =
  | string
  | number
  | boolean
  | bigint
  | string[]
  | number[]
  | boolean[]
  | null

export type SpanHandler = (span: ParsedSpan) => void | Promise<void>

export interface BuildOtelReceiverOptions {
  onSpan: SpanHandler
  // Fastify body limit. OTLP batches can be large; default is 16 MB.
  bodyLimit?: number
}

interface OtlpKeyValue {
  key: string
  value?: OtlpAnyValue
}

interface OtlpAnyValue {
  stringValue?: string
  intValue?: string | number
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: { values?: OtlpAnyValue[] }
  // kvlistValue / bytesValue are skipped — neither is on the demo path.
}

interface OtlpStatus {
  code?: number
  message?: string
}

interface OtlpSpan {
  traceId?: string
  spanId?: string
  parentSpanId?: string
  name?: string
  kind?: number
  startTimeUnixNano?: string
  endTimeUnixNano?: string
  attributes?: OtlpKeyValue[]
  status?: OtlpStatus
}

interface OtlpScopeSpans {
  spans?: OtlpSpan[]
}

interface OtlpResourceSpans {
  resource?: { attributes?: OtlpKeyValue[] }
  scopeSpans?: OtlpScopeSpans[]
}

export interface OtlpTracesRequest {
  resourceSpans?: OtlpResourceSpans[]
}

function flattenAttribute(v: OtlpAnyValue | undefined): AttributeValue {
  if (!v) return null
  if (v.stringValue !== undefined) return v.stringValue
  if (v.boolValue !== undefined) return v.boolValue
  if (v.intValue !== undefined) {
    return typeof v.intValue === 'string' ? Number(v.intValue) : v.intValue
  }
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.arrayValue?.values) {
    return v.arrayValue.values.map((x) => flattenAttribute(x)) as AttributeValue
  }
  return null
}

function attrsToRecord(attrs: OtlpKeyValue[] | undefined): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {}
  if (!attrs) return out
  for (const kv of attrs) {
    if (kv.key) out[kv.key] = flattenAttribute(kv.value)
  }
  return out
}

function durationNanos(start?: string, end?: string): bigint {
  if (!start || !end) return 0n
  try {
    return BigInt(end) - BigInt(start)
  } catch {
    return 0n
  }
}

// Convert OTLP's startTimeUnixNano (a base-10 string of nanoseconds since the
// Unix epoch) to ISO8601. Returns undefined when the input is missing, zero,
// or unparseable, so the caller can fall back to wall-clock without surfacing
// a fake timestamp on the edge.
export function isoFromUnixNano(nanos: string | undefined): string | undefined {
  if (!nanos || nanos === '0') return undefined
  try {
    const ms = Number(BigInt(nanos) / 1_000_000n)
    if (!Number.isFinite(ms)) return undefined
    return new Date(ms).toISOString()
  } catch {
    return undefined
  }
}

export function parseOtlpRequest(body: OtlpTracesRequest): ParsedSpan[] {
  const out: ParsedSpan[] = []
  for (const rs of body.resourceSpans ?? []) {
    const resourceAttrs = attrsToRecord(rs.resource?.attributes)
    const service = typeof resourceAttrs['service.name'] === 'string'
      ? (resourceAttrs['service.name'] as string)
      : 'unknown'

    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const attrs = attrsToRecord(span.attributes)
        const parsed: ParsedSpan = {
          service,
          traceId: span.traceId ?? '',
          spanId: span.spanId ?? '',
          parentSpanId: span.parentSpanId || undefined,
          name: span.name ?? '',
          kind: span.kind,
          startTimeUnixNano: span.startTimeUnixNano ?? '0',
          endTimeUnixNano: span.endTimeUnixNano ?? '0',
          startTimeIso: isoFromUnixNano(span.startTimeUnixNano),
          durationNanos: durationNanos(span.startTimeUnixNano, span.endTimeUnixNano),
          attributes: attrs,
          dbSystem: typeof attrs['db.system'] === 'string' ? (attrs['db.system'] as string) : undefined,
          dbName: typeof attrs['db.name'] === 'string' ? (attrs['db.name'] as string) : undefined,
          statusCode: span.status?.code,
          errorMessage: span.status?.message,
        }
        out.push(parsed)
      }
    }
  }
  return out
}

export async function buildOtelReceiver(
  opts: BuildOtelReceiverOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: opts.bodyLimit ?? 16 * 1024 * 1024,
  })

  app.get('/health', async () => ({ ok: true }))

  app.post<{ Body: OtlpTracesRequest }>('/v1/traces', async (req, reply) => {
    const spans = parseOtlpRequest(req.body ?? {})
    for (const span of spans) {
      await opts.onSpan(span)
    }
    // OTLP success response is `{ partialSuccess: {} }` for "all accepted".
    return reply.code(200).send({ partialSuccess: {} })
  })

  return app
}

export function logSpanHandler(span: ParsedSpan): void {
  const parent = span.parentSpanId ? span.parentSpanId.slice(0, 8) : '<root>'
  const status = span.statusCode === 2 ? 'ERROR' : 'OK'
  const db = span.dbSystem ? ` db=${span.dbSystem}/${span.dbName ?? '?'}` : ''
  console.log(
    `otel: ${span.service} ${span.name} parent=${parent} status=${status}${db}`,
  )
}
