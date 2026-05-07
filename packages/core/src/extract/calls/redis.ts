import path from 'node:path'
import { infraId } from '@neat.is/types'
import { lineOf, snippet, type ExternalEndpoint, type SourceFile } from './shared.js'

// Redis URLs in source — `redis://host[:port]` or `rediss://...`. We only
// catch literal strings; env-driven URLs go through the database parsers
// (.env, ormconfig, etc.) and don't need a CALLS edge.
const REDIS_URL_RE = /redis(?:s)?:\/\/(?:[^@'"`\s]+@)?([^:/'"`\s]+)(?::(\d+))?/g

export function redisEndpointsFromFile(
  file: SourceFile,
  serviceDir: string,
): ExternalEndpoint[] {
  const out: ExternalEndpoint[] = []
  const seen = new Set<string>()
  REDIS_URL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = REDIS_URL_RE.exec(file.content)) !== null) {
    const host = m[1]!
    if (seen.has(host)) continue
    seen.add(host)
    const line = lineOf(file.content, host)
    out.push({
      infraId: infraId('redis', host),
      name: host,
      kind: 'redis',
      edgeType: 'CALLS',
      evidence: {
        file: path.relative(serviceDir, file.path),
        line,
        snippet: snippet(file.content, line),
      },
    })
  }
  return out
}
