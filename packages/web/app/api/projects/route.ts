import { CORE_URL, proxyGet } from '../../../lib/proxy'
import { FIXTURE_PROJECTS } from '../../../lib/fixtures'

export async function GET(): Promise<Response> {
  return proxyGet(`${CORE_URL}/projects`, () => Response.json(FIXTURE_PROJECTS))
}
