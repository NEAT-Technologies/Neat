import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ServiceNode } from '@neat/types'

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
  if (name === '.env' || name.startsWith('.env.')) return { match: true, fileType: 'env' }
  return { match: false, fileType: '' }
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

export function makeEdgeId(source: string, target: string, type: string): string {
  return `${type}:${source}->${target}`
}
