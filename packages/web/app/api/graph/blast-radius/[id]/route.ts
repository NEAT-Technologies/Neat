import { CORE_URL, proxyGet } from '../../../../../lib/proxy'
import { fixtureBlastRadius } from '../../../../../lib/fixtures'

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { searchParams } = new URL(request.url)
  const depth = searchParams.get('depth') ?? '10'
  return proxyGet(
    `${CORE_URL}/graph/blast-radius/${encodeURIComponent(params.id)}?depth=${depth}`,
    () => Response.json(fixtureBlastRadius(params.id)),
  )
}
