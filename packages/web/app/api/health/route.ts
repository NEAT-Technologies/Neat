// Proxies the core /health endpoint so the web shell can show liveness without
// the browser hitting core directly. The graph + incidents proxy routes land
// alongside the dashboard work (post-MVP per the design doc).

const CORE_URL = process.env.NEAT_CORE_URL ?? 'http://localhost:8080'

export async function GET(): Promise<Response> {
  try {
    const upstream = await fetch(`${CORE_URL}/health`, { cache: 'no-store' })
    const body = await upstream.text()
    return new Response(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    )
  }
}
