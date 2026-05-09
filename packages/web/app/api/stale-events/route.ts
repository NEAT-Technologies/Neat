const CORE_URL = process.env.NEAT_CORE_URL ?? 'http://localhost:8080'

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const limit = searchParams.get('limit') ?? '50'
  try {
    const upstream = await fetch(`${CORE_URL}/stale-events?limit=${limit}`, { cache: 'no-store' })
    const body = await upstream.text()
    return new Response(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    return Response.json(
      { error: 'failed to reach neat-core', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    )
  }
}
