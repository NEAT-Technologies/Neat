import { promises as fs } from 'node:fs'
import path from 'node:path'
import Parser from 'tree-sitter'
import JavaScript from 'tree-sitter-javascript'
import { parse as parseYaml } from 'yaml'
import type {
  DatabaseNode,
  GraphEdge,
  GraphNode,
  ServiceNode,
  CompatibleDriver,
} from '@neat/types'
import { EdgeType, NodeType, Provenance } from '@neat/types'
import type { NeatGraph } from './graph.js'
import { checkCompatibility, compatPairs } from './compat.js'

export interface ExtractResult {
  nodesAdded: number
  edgesAdded: number
}

interface PackageJson {
  name: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface DbConfig {
  host: string
  port?: number
  database: string
  engine: string
  engineVersion: string
}

interface DiscoveredService {
  pkg: PackageJson
  dir: string
  node: ServiceNode
}

const SERVICE_FILE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx'])
const IGNORED_DIRS = new Set(['node_modules', '.git', '.turbo', 'dist', 'build', '.next'])

// Strip semver range prefixes (^, ~, >=, etc.) and bare "v" so the extracted
// version is usable for compat checks. We don't try to resolve ranges to actual
// installed versions — that's a published-lockfile concern, not extraction's job.
function cleanVersion(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  return raw.replace(/^[\^~><=v\s]+/, '').trim() || undefined
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw) as T
}

async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8')
  return parseYaml(raw) as T
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function discoverServices(scanPath: string): Promise<DiscoveredService[]> {
  const out: DiscoveredService[] = []
  const entries = await fs.readdir(scanPath, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue
    const dir = path.join(scanPath, entry.name)
    const pkgPath = path.join(dir, 'package.json')
    if (!(await exists(pkgPath))) continue

    const pkg = await readJson<PackageJson>(pkgPath)
    const deps = pkg.dependencies ?? {}
    const node: ServiceNode = {
      id: `service:${pkg.name}`,
      type: NodeType.ServiceNode,
      name: pkg.name,
      language: 'javascript',
      version: pkg.version,
      dependencies: deps,
      repoPath: path.relative(scanPath, dir),
    }
    if (deps.pg) {
      node.pgDriverVersion = cleanVersion(deps.pg)
    }
    out.push({ pkg, dir, node })
  }
  return out
}

function compatibleDriversFor(engine: string): CompatibleDriver[] {
  return compatPairs()
    .filter((p) => p.engine === engine)
    .map((p) => ({ name: p.driver, minVersion: p.minDriverVersion }))
}

async function extractDatabaseFromConfig(
  service: DiscoveredService,
): Promise<{ node: DatabaseNode; config: DbConfig } | null> {
  const yamlPath = path.join(service.dir, 'db-config.yaml')
  if (!(await exists(yamlPath))) return null

  const config = await readYaml<DbConfig>(yamlPath)
  const node: DatabaseNode = {
    id: `database:${config.host}`,
    type: NodeType.DatabaseNode,
    name: config.database,
    engine: config.engine,
    engineVersion: config.engineVersion,
    compatibleDrivers: compatibleDriversFor(config.engine),
    host: config.host,
    port: config.port,
  }
  return { node, config }
}

function attachIncompatibilities(service: DiscoveredService, dbConfig: DbConfig): void {
  const deps = service.pkg.dependencies ?? {}
  const incompatibilities: NonNullable<ServiceNode['incompatibilities']> = []

  for (const pair of compatPairs()) {
    if (pair.engine !== dbConfig.engine) continue
    const declaredVersion = cleanVersion(deps[pair.driver])
    if (!declaredVersion) continue
    const result = checkCompatibility(
      pair.driver,
      declaredVersion,
      dbConfig.engine,
      dbConfig.engineVersion,
    )
    if (!result.compatible && result.reason) {
      incompatibilities.push({
        driver: pair.driver,
        driverVersion: declaredVersion,
        engine: dbConfig.engine,
        engineVersion: dbConfig.engineVersion,
        reason: result.reason,
      })
    }
  }

  if (incompatibilities.length > 0) {
    service.node.incompatibilities = incompatibilities
  }
}

async function walkSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(full)
      } else if (entry.isFile() && SERVICE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
        out.push(full)
      }
    }
  }
  await walk(dir)
  return out
}

function collectStringLiterals(node: Parser.SyntaxNode, out: string[]): void {
  if (node.type === 'string_fragment') out.push(node.text)
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child) collectStringLiterals(child, out)
  }
}

// Find URL-like literals in the AST that point at one of the known service
// hostnames (the directory name OR the package.json name). Each match implies a
// CALLS edge from the file's owning service to the target.
function callsFromSource(source: string, parser: Parser, knownHosts: Set<string>): Set<string> {
  const tree = parser.parse(source)
  const literals: string[] = []
  collectStringLiterals(tree.rootNode, literals)
  const targets = new Set<string>()
  for (const lit of literals) {
    for (const host of knownHosts) {
      if (lit.includes(`//${host}`) || lit.includes(`//${host}:`)) {
        targets.add(host)
      }
    }
  }
  return targets
}

function makeEdgeId(source: string, target: string, type: string): string {
  return `${type}:${source}->${target}`
}

export async function extractFromDirectory(
  graph: NeatGraph,
  scanPath: string,
): Promise<ExtractResult> {
  const result: ExtractResult = { nodesAdded: 0, edgesAdded: 0 }
  const services = await discoverServices(scanPath)

  // Phase 1 — service nodes (also: collect db configs for the next phases).
  for (const service of services) {
    if (!graph.hasNode(service.node.id)) {
      graph.addNode(service.node.id, service.node)
      result.nodesAdded++
    }
  }

  // Phase 2 — database nodes from db-config.yaml + CONNECTS_TO edges + compat
  // checks. Each service can have at most one db-config.yaml in this MVP scope.
  for (const service of services) {
    const db = await extractDatabaseFromConfig(service)
    if (!db) continue

    if (!graph.hasNode(db.node.id)) {
      graph.addNode(db.node.id, db.node)
      result.nodesAdded++
    }

    const edge: GraphEdge = {
      id: makeEdgeId(service.node.id, db.node.id, EdgeType.CONNECTS_TO),
      source: service.node.id,
      target: db.node.id,
      type: EdgeType.CONNECTS_TO,
      provenance: Provenance.EXTRACTED,
    }
    if (!graph.hasEdge(edge.id)) {
      graph.addEdgeWithKey(edge.id, edge.source, edge.target, edge)
      result.edgesAdded++
    }

    attachIncompatibilities(service, db.config)
    // Re-set the node attributes after mutating incompatibilities.
    graph.replaceNodeAttributes(service.node.id, service.node as unknown as GraphNode)
  }

  // Phase 3 — service-to-service CALLS via tree-sitter scan of every source
  // file in each service directory.
  const parser = new Parser()
  parser.setLanguage(JavaScript)
  const knownHosts = new Set<string>()
  for (const service of services) {
    knownHosts.add(path.basename(service.dir))
    knownHosts.add(service.pkg.name)
  }
  // Map host → service node id so we can resolve URL → target.
  const hostToNodeId = new Map<string, string>()
  for (const service of services) {
    hostToNodeId.set(path.basename(service.dir), service.node.id)
    hostToNodeId.set(service.pkg.name, service.node.id)
  }

  for (const service of services) {
    const files = await walkSourceFiles(service.dir)
    const seenTargets = new Set<string>()
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8')
      const targets = callsFromSource(source, parser, knownHosts)
      for (const t of targets) {
        const targetId = hostToNodeId.get(t)
        if (!targetId || targetId === service.node.id) continue
        seenTargets.add(targetId)
      }
    }
    for (const targetId of seenTargets) {
      const edge: GraphEdge = {
        id: makeEdgeId(service.node.id, targetId, EdgeType.CALLS),
        source: service.node.id,
        target: targetId,
        type: EdgeType.CALLS,
        provenance: Provenance.EXTRACTED,
      }
      if (!graph.hasEdge(edge.id)) {
        graph.addEdgeWithKey(edge.id, edge.source, edge.target, edge)
        result.edgesAdded++
      }
    }
  }

  return result
}
