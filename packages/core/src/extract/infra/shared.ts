import type { InfraNode } from '@neat/types'
import { NodeType } from '@neat/types'

// ADR-010 reserves the `infra:` prefix; the kind segment lets traversal and
// MCP tools sub-type without inventing a new top-level NodeType per source.
export function makeInfraNode(
  kind: string,
  name: string,
  provider = 'self',
  extras?: { region?: string },
): InfraNode {
  return {
    id: `infra:${kind}:${name}`,
    type: NodeType.InfraNode,
    name,
    provider,
    kind,
    ...(extras?.region ? { region: extras.region } : {}),
  }
}

// Stable kind for an image string like "postgres:15-alpine" or "mysql:8".
// The image name itself ends up in the InfraNode `name` field; this function
// only classifies what the image *is*, so callers can group similar runtimes.
export function classifyImage(image: string): string {
  const lower = image.toLowerCase()
  const repo = lower.split(':')[0]!
  const last = repo.split('/').pop() ?? repo
  if (last.startsWith('postgres')) return 'postgres'
  if (last.startsWith('mysql') || last.startsWith('mariadb')) return 'mysql'
  if (last.startsWith('mongo')) return 'mongodb'
  if (last.startsWith('redis')) return 'redis'
  if (last.startsWith('rabbitmq')) return 'rabbitmq'
  if (last.startsWith('kafka') || last.includes('kafka')) return 'kafka'
  if (last.startsWith('memcached')) return 'memcached'
  return 'container'
}
