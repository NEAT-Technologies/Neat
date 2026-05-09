import { CORE_URL, proxyGet } from '../../../../../lib/proxy'
import { fixtureNodeDetail } from '../../../../../lib/fixtures'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  return proxyGet(
    `${CORE_URL}/graph/node/${encodeURIComponent(params.id)}`,
    () => Response.json(fixtureNodeDetail(params.id)),
  )
}
