import { z } from 'zod'

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
  affectedNode: z.string(),
})
export type ErrorEvent = z.infer<typeof ErrorEventSchema>
