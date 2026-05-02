import path from 'node:path'
import { exists, readYaml } from '../shared.js'
import { engineFromImage, type DbConfig } from './shared.js'

interface ComposeService {
  image?: string
  ports?: (string | number)[]
  environment?: Record<string, string> | string[]
}

interface ComposeFile {
  services?: Record<string, ComposeService>
}

function portFromService(svc: ComposeService): number | undefined {
  for (const raw of svc.ports ?? []) {
    const str = String(raw)
    // "5432:5432", "5432", or "host:5432" → take the trailing port.
    const last = str.split(':').pop()
    const n = Number(last)
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

function databaseFromEnv(svc: ComposeService): string {
  const env = svc.environment
  const get = (key: string): string | undefined => {
    if (!env) return undefined
    if (Array.isArray(env)) {
      for (const line of env) {
        const [k, v] = line.split('=')
        if (k === key) return v
      }
      return undefined
    }
    return env[key]
  }
  return get('POSTGRES_DB') ?? get('MYSQL_DATABASE') ?? get('MONGO_INITDB_DATABASE') ?? ''
}

// Service-local docker-compose.yml — every service whose image we recognise
// becomes a candidate DB. The compose service name doubles as the host since
// that's how peer services on the same compose network reach it.
export async function parse(serviceDir: string): Promise<DbConfig[]> {
  for (const name of ['docker-compose.yml', 'docker-compose.yaml']) {
    const abs = path.join(serviceDir, name)
    if (!(await exists(abs))) continue
    const raw = await readYaml<ComposeFile>(abs)
    if (!raw?.services) return []

    const out: DbConfig[] = []
    for (const [serviceName, svc] of Object.entries(raw.services)) {
      if (!svc.image) continue
      const meta = engineFromImage(svc.image)
      if (!meta) continue
      out.push({
        host: serviceName,
        port: portFromService(svc),
        database: databaseFromEnv(svc),
        engine: meta.engine,
        engineVersion: meta.engineVersion,
      })
    }
    return out
  }
  return []
}

export const dockerComposeParser = { name: 'docker-compose', parse }
