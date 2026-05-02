import path from 'node:path'
import { exists, readJson, readYaml } from '../shared.js'
import { schemeToEngine, type DbConfig } from './shared.js'

interface OrmConfigEntry {
  type?: string
  host?: string
  port?: number
  database?: string
}

// ormconfig.{json,yaml,yml} — TypeORM's legacy config file. Single object or
// an array of named connections; we walk both.
export async function parse(serviceDir: string): Promise<DbConfig[]> {
  for (const candidate of ['ormconfig.json', 'ormconfig.yaml', 'ormconfig.yml']) {
    const abs = path.join(serviceDir, candidate)
    if (!(await exists(abs))) continue
    const raw = candidate.endsWith('.json')
      ? await readJson<OrmConfigEntry | OrmConfigEntry[]>(abs)
      : await readYaml<OrmConfigEntry | OrmConfigEntry[]>(abs)
    const entries = Array.isArray(raw) ? raw : [raw]

    const out: DbConfig[] = []
    for (const entry of entries) {
      if (!entry?.type || !entry.host) continue
      const engine = schemeToEngine(entry.type)
      if (!engine) continue
      out.push({
        host: entry.host,
        port: entry.port,
        database: entry.database ?? '',
        engine,
        engineVersion: 'unknown',
      })
    }
    if (out.length > 0) return out
  }
  return []
}

export const ormconfigParser = { name: 'ormconfig', parse }
