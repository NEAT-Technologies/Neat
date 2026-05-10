import { CORE_URL, proxyGet } from '../../../lib/proxy'
import { FIXTURE_HEALTH } from '../../../lib/fixtures'

export async function GET(): Promise<Response> {
  return proxyGet(`${CORE_URL}/health`, () => Response.json(FIXTURE_HEALTH))
}
