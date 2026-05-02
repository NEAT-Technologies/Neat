import { findFirst, readIfExists, parseConnectionString, type DbConfig } from './shared.js'

const CLIENT_TO_ENGINE: Record<string, string> = {
  pg: 'postgresql',
  postgres: 'postgresql',
  postgresql: 'postgresql',
  mysql: 'mysql',
  mysql2: 'mysql',
  sqlite3: 'sqlite',
  'better-sqlite3': 'sqlite',
}

// knexfile.{js,ts} declares a client (one of pg/mysql/sqlite/...) plus a
// connection string or host/port object. We pick whichever shape is in the
// file and ignore environment-driven values we can't resolve statically.
export async function parse(serviceDir: string): Promise<DbConfig[]> {
  const filePath = await findFirst(serviceDir, [
    'knexfile.js',
    'knexfile.ts',
    'knexfile.cjs',
    'knexfile.mjs',
  ])
  if (!filePath) return []
  const content = await readIfExists(filePath)
  if (!content) return []

  const clientMatch = content.match(/client\s*:\s*['"`]([^'"`]+)['"`]/)
  if (!clientMatch) return []
  const engine = CLIENT_TO_ENGINE[clientMatch[1]!.toLowerCase()]
  if (!engine) return []

  const urlMatch = content.match(
    /connection\s*:\s*['"`]([a-z][a-z+]*:\/\/[^'"`]+)['"`]/i,
  )
  if (urlMatch) {
    const config = parseConnectionString(urlMatch[1]!)
    if (config) return [config]
  }

  const host = content.match(/host\s*:\s*['"`]([^'"`]+)['"`]/)?.[1]
  if (host) {
    const port = content.match(/port\s*:\s*(\d+)/)?.[1]
    const database = content.match(/database\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? ''
    return [
      {
        host,
        port: port ? Number(port) : undefined,
        database,
        engine,
        engineVersion: 'unknown',
      },
    ]
  }

  return [{ host: `${engine}-knex`, database: '', engine, engineVersion: 'unknown' }]
}

export const knexParser = { name: 'knex', parse }
