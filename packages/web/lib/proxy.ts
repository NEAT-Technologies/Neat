export const CORE_URL = process.env.NEAT_CORE_URL ?? 'http://localhost:8080'
export const DEMO = process.env.NEAT_DEMO === '1'

export async function proxyGet(url: string, fallback: () => Response): Promise<Response> {
  try {
    const upstream = await fetch(url, { cache: 'no-store' })
    const body = await upstream.text()
    return new Response(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    if (DEMO) return fallback()
    return Response.json({ error: 'failed to reach neat-core', coreUrl: CORE_URL }, { status: 502 })
  }
}
