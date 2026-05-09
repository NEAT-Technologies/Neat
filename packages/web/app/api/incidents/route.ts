import { CORE_URL, proxyGet } from '../../../lib/proxy'
import { FIXTURE_INCIDENTS } from '../../../lib/fixtures'

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const limit = searchParams.get('limit') ?? '50'
  return proxyGet(
    `${CORE_URL}/incidents?limit=${limit}`,
    () => Response.json(FIXTURE_INCIDENTS),
  )
}
