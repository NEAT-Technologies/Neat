import { CORE_URL, proxyGet } from '../../../lib/proxy'

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const limit = searchParams.get('limit') ?? '50'
  return proxyGet(
    `${CORE_URL}/stale-events?limit=${limit}`,
    () => Response.json({ events: [], count: 0, total: 0 }),
  )
}
