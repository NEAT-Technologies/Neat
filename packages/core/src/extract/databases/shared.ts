import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface DbConfig {
  host: string
  port?: number
  database: string
  engine: string
  engineVersion: string // "unknown" when not statically determinable
  // Absolute path to the file the parser read this config from. Used to
  // populate evidence.file on the resulting CONNECTS_TO edge. Optional so
  // synthesized configs (e.g. prisma's env() fallback) can omit it; the
  // CONNECTS_TO writer emits evidence only when present.
  sourceFile?: string
}

// Map a connection-string scheme to the engine name our compat matrix uses.
// Schemes like "postgres+asyncpg" are normalised by stripping the dialect
// suffix; anything we don't recognise returns null so the parser can decline.
export function schemeToEngine(scheme: string): string | null {
  const s = scheme.toLowerCase().split('+')[0]
  switch (s) {
    case 'postgres':
    case 'postgresql':
      return 'postgresql'
    case 'mysql':
    case 'mariadb':
      return 'mysql'
    case 'mongodb':
    case 'mongodb+srv':
      return 'mongodb'
    case 'redis':
    case 'rediss':
      return 'redis'
    case 'sqlite':
      return 'sqlite'
    default:
      return null
  }
}

export function parseConnectionString(url: string): DbConfig | null {
  const m = url.match(
    /^(?<scheme>[a-z][a-z+]*):\/\/(?:[^@/]+(?::[^@]*)?@)?(?<host>[^:/?]+)(?::(?<port>\d+))?(?:\/(?<db>[^?#]*))?/i,
  )
  if (!m || !m.groups) return null
  const engine = schemeToEngine(m.groups.scheme!)
  if (!engine) return null
  return {
    host: m.groups.host!,
    port: m.groups.port ? Number(m.groups.port) : undefined,
    database: m.groups.db ?? '',
    engine,
    engineVersion: 'unknown',
  }
}

export async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

export async function findFirst(
  serviceDir: string,
  candidates: string[],
): Promise<string | null> {
  for (const rel of candidates) {
    const abs = path.join(serviceDir, rel)
    const content = await readIfExists(abs)
    if (content !== null) return abs
  }
  return null
}

// Engine name from a docker-compose `image:` value like "postgres:15-alpine"
// or "mysql/mysql-server:8.0". Returns the engine + version when both are
// resolvable, or null if the image isn't one we recognise.
export function engineFromImage(
  image: string,
): { engine: string; engineVersion: string } | null {
  const lower = image.toLowerCase()
  const colon = lower.lastIndexOf(':')
  const repo = colon >= 0 ? lower.slice(0, colon) : lower
  const tag = colon >= 0 ? lower.slice(colon + 1) : 'latest'
  const last = repo.split('/').pop() ?? repo
  let engine: string | null = null
  if (last.startsWith('postgres')) engine = 'postgresql'
  else if (last.startsWith('mysql') || last.startsWith('mariadb')) engine = 'mysql'
  else if (last.startsWith('mongo')) engine = 'mongodb'
  else if (last.startsWith('redis')) engine = 'redis'
  else if (last.startsWith('sqlite')) engine = 'sqlite'
  if (!engine) return null
  // Strip everything after the major version digit run; "15-alpine" -> "15".
  const versionMatch = tag.match(/^(\d+(?:\.\d+){0,2})/)
  return {
    engine,
    engineVersion: versionMatch ? versionMatch[1]! : 'unknown',
  }
}
