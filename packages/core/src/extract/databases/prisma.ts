import path from 'node:path'
import { readIfExists, parseConnectionString, schemeToEngine, type DbConfig } from './shared.js'

// Prisma's schema file declares datasources of the form:
//
//   datasource db {
//     provider = "postgresql"
//     url      = env("DATABASE_URL")
//   }
//
// We match the provider directly. URLs come in via env() so we can't resolve
// them statically; host/database fall back to placeholders so the DatabaseNode
// id remains deterministic per service.
export async function parse(serviceDir: string): Promise<DbConfig[]> {
  const schemaPath = path.join(serviceDir, 'prisma', 'schema.prisma')
  const content = await readIfExists(schemaPath)
  if (!content) return []

  const block = content.match(/datasource\s+\w+\s*\{([^}]*)\}/s)
  if (!block) return []
  const body = block[1] ?? ''

  const providerMatch = body.match(/provider\s*=\s*"([^"]+)"/)
  if (!providerMatch) return []
  const engine = schemeToEngine(providerMatch[1]!)
  if (!engine) return []

  const urlMatch = body.match(/url\s*=\s*"([^"]+)"/)
  if (urlMatch) {
    const config = parseConnectionString(urlMatch[1]!)
    if (config) return [config]
  }

  return [
    {
      host: `${engine}-prisma`,
      database: '',
      engine,
      engineVersion: 'unknown',
    },
  ]
}

export const prismaParser = { name: 'prisma', parse }
