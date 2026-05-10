import { promises as fs } from 'node:fs'
import path from 'node:path'
import { minimatch } from 'minimatch'
import { exists, readJson } from './shared.js'

export interface CodeownersRule {
  pattern: string
  owners: string
}

export interface CodeownersFile {
  rules: CodeownersRule[]
}

interface PackageJsonAuthor {
  author?: string | { name?: string }
}

// Read CODEOWNERS at <scanPath>/CODEOWNERS first, then <scanPath>/.github/CODEOWNERS.
// Returns null when neither exists. ADR-054 #2.1.
export async function loadCodeowners(scanPath: string): Promise<CodeownersFile | null> {
  const candidates = [
    path.join(scanPath, 'CODEOWNERS'),
    path.join(scanPath, '.github', 'CODEOWNERS'),
  ]
  for (const file of candidates) {
    if (await exists(file)) {
      const raw = await fs.readFile(file, 'utf8')
      return parseCodeowners(raw)
    }
  }
  return null
}

function parseCodeowners(raw: string): CodeownersFile {
  const rules: CodeownersRule[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^(\S+)\s+(.+)$/.exec(trimmed)
    if (!match) continue
    rules.push({ pattern: match[1]!, owners: match[2]!.trim() })
  }
  return { rules }
}

// First matching pattern wins; returns the literal RHS or null. ADR-054 #2.1.
// Pattern matcher is minimal per ADR-054 #6 — handles `*`, `**`, and exact
// paths; not a full gitignore-style parser.
export function matchOwner(file: CodeownersFile, repoPath: string): string | null {
  const normalized = repoPath.split(path.sep).join('/')
  for (const rule of file.rules) {
    if (matchesPattern(rule.pattern, normalized)) return rule.owners
  }
  return null
}

function matchesPattern(rawPattern: string, repoPath: string): boolean {
  let pattern = rawPattern.startsWith('/') ? rawPattern.slice(1) : rawPattern
  if (pattern === '*') return !repoPath.includes('/')
  if (pattern === '**' || pattern === '') return true
  // Trailing slash means "everything in this directory".
  if (pattern.endsWith('/')) pattern = pattern + '**'
  if (minimatch(repoPath, pattern, { dot: true })) return true
  // A pattern that names a directory should match files beneath it too.
  if (!pattern.includes('*') && minimatch(repoPath, pattern + '/**', { dot: true })) return true
  return false
}

// Read <serviceDir>/package.json and return the `author` field as a literal
// string. Accepts either string form ("Cem D <cem@example.com>") or object
// form ({ name: 'Cem D' }). Returns null when missing or unparseable.
// ADR-054 #2.2.
export async function readPackageJsonAuthor(serviceDir: string): Promise<string | null> {
  const pkgPath = path.join(serviceDir, 'package.json')
  if (!(await exists(pkgPath))) return null
  try {
    const pkg = await readJson<PackageJsonAuthor>(pkgPath)
    if (!pkg.author) return null
    if (typeof pkg.author === 'string') return pkg.author
    if (typeof pkg.author === 'object' && typeof pkg.author.name === 'string') return pkg.author.name
    return null
  } catch {
    return null
  }
}

// Compute owner per ADR-054 priority: CODEOWNERS first, package.json `author`
// fallback, undefined otherwise. Literal source value, no normalization (#3).
export async function computeServiceOwner(
  codeowners: CodeownersFile | null,
  repoPath: string | undefined,
  serviceDir: string,
): Promise<string | undefined> {
  if (codeowners && repoPath !== undefined) {
    const owner = matchOwner(codeowners, repoPath)
    if (owner) return owner
  }
  const author = await readPackageJsonAuthor(serviceDir)
  return author ?? undefined
}
