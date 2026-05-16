import { z } from 'zod'

// Passthrough of OTel span attributes. Records source-attribution
// (`code.filepath`, `code.lineno`, `code.function`), HTTP context
// (`http.method`, `http.target`, `http.status_code`), DB context
// (`db.system`, `db.statement`), and any other span attribute the SDK
// emitted. Consumers (incident UI, MCP getRootCause) filter what they
// surface. Schema growth per ADR-031 — optional, additive only.
export const SpanAttributesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()), z.array(z.number()), z.array(z.boolean())]),
)
export type SpanAttributes = z.infer<typeof SpanAttributesSchema>

export const ErrorEventSchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  service: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  errorType: z.string().optional(),
  errorMessage: z.string(),
  // OTLP span events with name="exception" carry richer error data than
  // status.message. When present, these fields capture the exception type
  // and stacktrace from the SDK that recorded the error. ADR-031 schema
  // growth — added without a shape change because both fields are optional.
  exceptionType: z.string().optional(),
  exceptionStacktrace: z.string().optional(),
  // Span attributes passthrough (ADR-068 follow-up). Surfaces `code.*`
  // semconv attributes for source attribution, plus the rest of the
  // attribute set for downstream filtering.
  attributes: SpanAttributesSchema.optional(),
  affectedNode: z.string(),
})
export type ErrorEvent = z.infer<typeof ErrorEventSchema>

// Appended one-per-line to stale-events.ndjson whenever ingest.ts demotes
// an OBSERVED edge to STALE (per-edge-type thresholds, ADR-024). Surfaces
// on GET /stale-events for incident triage.
export const StaleEventSchema = z.object({
  edgeId: z.string(),
  source: z.string(),
  target: z.string(),
  edgeType: z.string(),
  thresholdMs: z.number().nonnegative(),
  ageMs: z.number().nonnegative(),
  lastObserved: z.string(),
  transitionedAt: z.string(),
})
export type StaleEvent = z.infer<typeof StaleEventSchema>
