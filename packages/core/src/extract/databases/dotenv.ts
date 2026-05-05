import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isConfigFile } from '../shared.js'
import { parseConnectionString, type DbConfig } from './shared.js'

const CONNECTION_KEYS = new Set([
  'DATABASE_URL',
  'DB_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'MYSQL_URL',
  'MONGODB_URI',
  'MONGO_URL',
  'MONGO_URI',
  'REDIS_URL',
])

// Per ADR-016, .env contents do not land in any snapshot. We read them here
// only to derive a transient DbConfig — the value never reaches a ConfigNode.
function parseDotenvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const eq = trimmed.indexOf('=')
  if (eq < 0) return null
  const key = trimmed.slice(0, eq).trim()
  let value = trimmed.slice(eq + 1).trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  return { key, value }
}

export async function parse(serviceDir: string): Promise<DbConfig[]> {
  const entries = await fs.readdir(serviceDir, { withFileTypes: true }).catch(() => [])
  const configs: DbConfig[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = isConfigFile(entry.name)
    if (!match.match || match.fileType !== 'env') continue

    const filePath = path.join(serviceDir, entry.name)
    const content = await fs.readFile(filePath, 'utf8')
    for (const line of content.split('\n')) {
      const parsed = parseDotenvLine(line)
      if (!parsed) continue
      if (!CONNECTION_KEYS.has(parsed.key.toUpperCase())) continue
      const config = parseConnectionString(parsed.value)
      if (!config) continue
      const key = `${config.engine}://${config.host}:${config.port ?? ''}/${config.database}`
      if (seen.has(key)) continue
      seen.add(key)
      configs.push({ ...config, sourceFile: filePath })
    }
  }
  return configs
}

export const dotenvParser = { name: '.env', parse }
