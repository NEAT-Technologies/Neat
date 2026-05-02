import path from 'node:path'
import { exists, readYaml } from '../shared.js'
import type { DbConfig } from './shared.js'

interface DbConfigYaml {
  host: string
  port?: number
  database: string
  engine: string
  engineVersion?: string | number
}

// The original db-config.yaml format, kept as a parser so the demo continues
// to work. Engine + version are explicit here, so this is the one source that
// can produce a real engineVersion without inference.
export async function parse(serviceDir: string): Promise<DbConfig[]> {
  const yamlPath = path.join(serviceDir, 'db-config.yaml')
  if (!(await exists(yamlPath))) return []
  const raw = await readYaml<DbConfigYaml>(yamlPath)
  return [
    {
      host: raw.host,
      port: raw.port,
      database: raw.database,
      engine: raw.engine,
      engineVersion: raw.engineVersion !== undefined ? String(raw.engineVersion) : 'unknown',
    },
  ]
}

export const dbConfigYamlParser = { name: 'db-config.yaml', parse }
