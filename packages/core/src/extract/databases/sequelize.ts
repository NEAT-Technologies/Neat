import path from 'node:path'
import { exists, readJson } from '../shared.js'
import { schemeToEngine, type DbConfig } from './shared.js'

interface SequelizeConfigEntry {
  dialect?: string
  host?: string
  port?: number
  database?: string
}

type SequelizeConfig = Record<string, SequelizeConfigEntry>

// Sequelize stores per-environment configs under config/config.json. We read
// every named environment so a service that declares production + staging
// surfaces both DB targets.
export async function parse(serviceDir: string): Promise<DbConfig[]> {
  const configPath = path.join(serviceDir, 'config', 'config.json')
  if (!(await exists(configPath))) return []
  const raw = await readJson<SequelizeConfig>(configPath)

  const out: DbConfig[] = []
  const seen = new Set<string>()
  for (const entry of Object.values(raw)) {
    if (!entry?.dialect || !entry.host) continue
    const engine = schemeToEngine(entry.dialect)
    if (!engine) continue
    const key = `${engine}://${entry.host}:${entry.port ?? ''}/${entry.database ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      host: entry.host,
      port: entry.port,
      database: entry.database ?? '',
      engine,
      engineVersion: 'unknown',
    })
  }
  return out
}

export const sequelizeParser = { name: 'sequelize', parse }
