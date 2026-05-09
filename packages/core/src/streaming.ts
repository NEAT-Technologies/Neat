// SSE handler for the frontend-facing event stream (ADR-051 #1).
// Subscribes to the bus in events.ts, filters by project, writes
// `event: <type>\ndata: <json>\n\n` frames to the client.
//
// Backpressure: per-connection queue cap of 1000 outstanding writes; once
// hit, the connection is dropped with `event: error data: { reason:
// 'backpressure' }` per ADR-051 #8. Heartbeat: comment line every 30s
// keeps proxies from idle-timing out (ADR-051 #3).

import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  EVENT_BUS_CHANNEL,
  eventBus,
  type NeatEventEnvelope,
} from './events.js'

export const SSE_HEARTBEAT_MS = 30_000
export const SSE_BACKPRESSURE_CAP = 1000

export interface HandleSseOptions {
  project: string
  heartbeatMs?: number
  backpressureCap?: number
}

export function handleSse(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: HandleSseOptions,
): void {
  const heartbeatMs = opts.heartbeatMs ?? SSE_HEARTBEAT_MS
  const backpressureCap = opts.backpressureCap ?? SSE_BACKPRESSURE_CAP

  reply.raw.setHeader('Content-Type', 'text/event-stream')
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
  reply.raw.setHeader('Connection', 'keep-alive')
  reply.raw.setHeader('X-Accel-Buffering', 'no')
  reply.raw.flushHeaders?.()

  let pending = 0
  let dropped = false

  const closeConnection = (): void => {
    if (dropped) return
    dropped = true
    eventBus.off(EVENT_BUS_CHANNEL, listener)
    clearInterval(heartbeat)
    if (!reply.raw.writableEnded) reply.raw.end()
  }

  const writeFrame = (frame: string): void => {
    if (dropped) return
    if (pending >= backpressureCap) {
      // Past the cap — emit one final error frame and drop. Don't try to
      // gracefully drain; a slow consumer that's already 1000 frames behind
      // is not going to catch up.
      const errFrame = `event: error\ndata: ${JSON.stringify({ reason: 'backpressure' })}\n\n`
      reply.raw.write(errFrame)
      closeConnection()
      return
    }
    pending++
    reply.raw.write(frame, () => {
      pending = Math.max(0, pending - 1)
    })
  }

  const listener = (envelope: NeatEventEnvelope): void => {
    if (envelope.project !== opts.project) return
    writeFrame(`event: ${envelope.type}\ndata: ${JSON.stringify(envelope.payload)}\n\n`)
  }

  eventBus.on(EVENT_BUS_CHANNEL, listener)

  const heartbeat = setInterval(() => {
    if (dropped) return
    reply.raw.write(':heartbeat\n\n')
  }, heartbeatMs)
  if (typeof heartbeat.unref === 'function') heartbeat.unref()

  req.raw.on('close', closeConnection)
  reply.raw.on('close', closeConnection)
  reply.raw.on('error', closeConnection)
}
