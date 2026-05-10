import { NextRequest } from 'next/server'
import { CORE_URL } from '../../../lib/proxy'

// ADR-057 #5 — SSE stream is project-scoped per ADR-026 + ADR-051.
export async function GET(request: NextRequest): Promise<Response> {
  const project = new URL(request.url).searchParams.get('project') ?? ''
  const base = project && project !== 'default'
    ? `/projects/${encodeURIComponent(project)}/events`
    : '/events'
  try {
    const upstream = await fetch(`${CORE_URL}${base}`, {
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
