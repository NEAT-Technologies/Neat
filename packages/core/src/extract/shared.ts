import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ServiceNode } from '@neat.is/types'

export interface PackageJson {
  name: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  engines?: { node?: string }
}

export interface DiscoveredService {
  pkg: PackageJson
  dir: string
  node: ServiceNode
}

export const SERVICE_FILE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.py'])
export const CONFIG_FILE_EXTENSIONS = new Set(['.yaml', '.yml'])
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  'dist',
  'build',
  '.next',
])

export function isConfigFile(name: string): { match: boolean; fileType: string } {
  const ext = path.extname(name)
  if (CONFIG_FILE_EXTENSIONS.has(ext)) return { match: true, fileType: ext.slice(1) }
  // .env, .env.local, .env.production. Bare filename or any dotted-suffix
  // variant; folder names get filtered upstream by walking files only.
  // ADR-065 #4 filters .env.template / .env.example / .env.sample (and the
  // dotted-suffix variants) at the producer level — those are documentation,
  // not runtime config.
  if (name === '.env' || name.startsWith('.env.')) {
    if (isEnvTemplateFile(name)) return { match: false, fileType: '' }
    return { match: true, fileType: 'env' }
  }
  return { match: false, fileType: '' }
}

// ─────────────────────────────────────────────────────────────────────────
// ADR-065 precision-filter helpers. Pre-emit gates inside the producer pass.
// Filtered candidates are never written to the graph (idempotency intact).
// ─────────────────────────────────────────────────────────────────────────

// ADR-065 #1 — test-scope exclusion. Returns true when the file path matches
// any test-scope pattern. Path is normalised to forward slashes before
// matching so callers can pass either form.
//
// Patterns:
//   - any segment named __tests__, __fixtures__, or integration-tests
//   - basename matches *.spec.{ts,tsx,js,jsx,mjs,cjs,py}
//   - basename matches *.test.{ts,tsx,js,jsx,mjs,cjs,py}
export function isTestPath(filePath: string): boolean {
  const normalised = filePath.replace(/\\/g, '/')
  const segments = normalised.split('/')
  for (const seg of segments) {
    if (seg === '__tests__' || seg === '__fixtures__' || seg === 'integration-tests') {
      return true
    }
  }
  const base = segments[segments.length - 1] ?? ''
  return /\.(spec|test)\.(?:tsx?|jsx?|mjs|cjs|py)$/i.test(base)
}

// ADR-065 #4 — `.env.template` exclusion. Matches:
//   .env.template / .env.example / .env.sample
//   .env.*.template / .env.*.example / .env.*.sample
// These are docs/onboarding artifacts, not runtime config. ConfigNodes are
// bound to runtime existence (ADR-016); templates fail that test.
export function isEnvTemplateFile(name: string): boolean {
  if (
    name === '.env.template' ||
    name === '.env.example' ||
    name === '.env.sample'
  ) {
    return true
  }
  // `.env.*.template` / `.env.*.example` / `.env.*.sample`
  return /^\.env\.[^.]+\.(?:template|example|sample)$/i.test(name)
}

// ADR-065 #2 — comment-body exclusion. Replaces every JS/TS comment span in
// the source with an equal-length run of spaces, preserving line/column for
// downstream line-mapping. Strings that contain `//` sequences (URLs) are
// preserved by tracking the string context as we scan.
//
// Not a full parser — good enough for the medusa-shape failures. The HTTP
// extractor's AST walk already gets comment-awareness for free; this helper
// is for the regex-based extractors (redis, kafka, aws, grpc).
export function maskCommentsInSource(src: string): string {
  const len = src.length
  const out: string[] = new Array(len)
  let i = 0
  // String context: ' " ` (template) — open-quote char, 0 when not in a string.
  let inString: string | 0 = 0
  let escaped = false
  while (i < len) {
    const c = src[i]!
    if (inString !== 0) {
      out[i] = c
      if (escaped) {
        escaped = false
      } else if (c === '\\') {
        escaped = true
      } else if (c === inString) {
        inString = 0
      }
      i++
      continue
    }
    if (c === '/' && i + 1 < len) {
      const next = src[i + 1]!
      if (next === '/') {
        out[i] = ' '
        out[i + 1] = ' '
        let j = i + 2
        while (j < len && src[j] !== '\n') {
          out[j] = ' '
          j++
        }
        i = j
        continue
      }
      if (next === '*') {
        out[i] = ' '
        out[i + 1] = ' '
        let j = i + 2
        while (j < len) {
          if (src[j] === '\n') {
            out[j] = '\n'
            j++
            continue
          }
          if (src[j] === '*' && j + 1 < len && src[j + 1] === '/') {
            out[j] = ' '
            out[j + 1] = ' '
            j += 2
            break
          }
          out[j] = ' '
          j++
        }
        i = j
        continue
      }
    }
    out[i] = c
    if (c === "'" || c === '"' || c === '`') inString = c
    i++
  }
  return out.join('')
}

// ADR-065 #5 — exact hostname match for cross-service URL inference. Returns
// true if `urlString` parses as a URL whose hostname equals `host` exactly
// (case-insensitive). No `.includes()` containment.
//
// Accepts a `host` that may include a port (`api.example.com:8080`); in that
// case the URL's hostname AND port must both match.
export function urlMatchesHost(urlString: string, host: string): boolean {
  const [wantedHost, wantedPort] = host.split(':')
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    try {
      parsed = new URL(`http://${urlString.replace(/^\/\//, '')}`)
    } catch {
      return false
    }
  }
  if (parsed.hostname.toLowerCase() !== (wantedHost ?? '').toLowerCase()) return false
  if (wantedPort && parsed.port !== wantedPort) return false
  return true
}

// Strip semver range prefixes (^, ~, >=, etc.) and bare "v" so the extracted
// version is usable for compat checks. We don't try to resolve ranges to actual
// installed versions — that's a published-lockfile concern, not extraction's job.
export function cleanVersion(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  return raw.replace(/^[\^~><=v\s]+/, '').trim() || undefined
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw) as T
}

export async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8')
  return parseYaml(raw) as T
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

// Thin re-export so existing callers (calls/, configs.ts, databases/, infra/)
// keep their import path. Wire format lives in @neat.is/types/identity.ts per
// ADR-029.
export { extractedEdgeId as makeEdgeId } from '@neat.is/types'
