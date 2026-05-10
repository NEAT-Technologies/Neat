import { CORE_URL, proxyGet } from '../../../../lib/proxy'
import { FIXTURE_VIOLATIONS } from '../../../../lib/fixtures'

export async function GET(): Promise<Response> {
  return proxyGet(`${CORE_URL}/policies/violations`, () => Response.json(FIXTURE_VIOLATIONS))
}
