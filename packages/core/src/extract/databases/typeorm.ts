import { findFirst, readIfExists, schemeToEngine, type DbConfig } from './shared.js'

// TypeORM's modern shape: `new DataSource({ type: 'postgres', host, port, ... })`
// in a data-source.ts (or .js). We regex for the type/host/port/database keys
// in the first DataSource literal we find.
export async function parse(serviceDir: string): Promise<DbConfig[]> {
  const filePath = await findFirst(serviceDir, [
    'data-source.ts',
    'data-source.js',
    'src/data-source.ts',
    'src/data-source.js',
  ])
  if (!filePath) return []
  const content = await readIfExists(filePath)
  if (!content) return []

  const block = content.match(/new\s+DataSource\s*\(\s*\{([\s\S]*?)\}\s*\)/)
  const body = block ? block[1]! : content

  const typeMatch = body.match(/type\s*:\s*['"`]([^'"`]+)['"`]/)
  const host = body.match(/host\s*:\s*['"`]([^'"`]+)['"`]/)?.[1]
  if (!typeMatch || !host) return []

  const engine = schemeToEngine(typeMatch[1]!)
  if (!engine) return []

  const port = body.match(/port\s*:\s*(\d+)/)?.[1]
  const database = body.match(/database\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? ''

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

export const typeormParser = { name: 'typeorm', parse }
