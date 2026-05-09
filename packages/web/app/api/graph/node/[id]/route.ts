const CORE_URL = process.env.NEAT_CORE_URL ?? 'http://localhost:8080'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const upstream = await fetch(`${CORE_URL}/graph/node/${encodeURIComponent(params.id)}`, {
      cache: 'no-store',
    })
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
