import { CORE_URL, proxyGet } from '../../../lib/proxy'
import { fixtureSearch } from '../../../lib/fixtures'

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') ?? ''
  return proxyGet(
    `${CORE_URL}/search?q=${encodeURIComponent(q)}`,
    () => Response.json(fixtureSearch(q)),
  )
}
