// Proxies the core /graph endpoint so the browser hits the web app's own
// origin (avoids needing CORS configuration on neat-core for local dev) and
// so a future deployment can route the call through whichever core URL the
// web app is configured against.
//
// v0.1.3 stays single-project: hits the default project's /graph route. The
// project-aware path (/projects/:project/graph) lands with the v0.2.0
// project switcher (#106).

const CORE_URL = process.env.NEAT_CORE_URL ?? 'http://localhost:8080'

export async function GET(): Promise<Response> {
  try {
    const upstream = await fetch(`${CORE_URL}/graph`, { cache: 'no-store' })
    const body = await upstream.text()
    return new Response(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch (err) {
    return Response.json(
      {
        error: 'failed to reach neat-core',
        coreUrl: CORE_URL,
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 502 },
    )
  }
}
