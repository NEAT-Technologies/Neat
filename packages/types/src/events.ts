import { z } from 'zod'

export const ErrorEventSchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  service: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  errorType: z.string().optional(),
  errorMessage: z.string(),
  affectedNode: z.string(),
})
export type ErrorEvent = z.infer<typeof ErrorEventSchema>
