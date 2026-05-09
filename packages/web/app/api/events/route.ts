import { NextRequest } from 'next/server'

const CORE_URL = process.env.NEAT_CORE_URL ?? 'http://localhost:8080'

export async function GET(_request: NextRequest): Promise<Response> {
  try {
    const upstream = await fetch(`${CORE_URL}/events`, {
      cache: 'no-store',
      headers: { Accept: 'text/event-stream' },
    })

    if (!upstream.ok || !upstream.body) {
      // Core doesn't have SSE yet (pre-v0.2.8) — send a single unavailable event and close
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('event: error\ndata: {"reason":"unavailable"}\n\n'),
          )
          controller.close()
        },
      })
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      })
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
      },
    })
  } catch {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('event: error\ndata: {"reason":"unavailable"}\n\n'),
        )
        controller.close()
      },
    })
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
  }
}
