import { CORE_URL, proxyGet } from '../../../../../lib/proxy'
import { fixtureRootCause } from '../../../../../lib/fixtures'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  return proxyGet(
    `${CORE_URL}/graph/root-cause/${encodeURIComponent(params.id)}`,
    () => Response.json(fixtureRootCause(params.id)),
  )
}
