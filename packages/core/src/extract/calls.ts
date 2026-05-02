import { promises as fs } from 'node:fs'
import path from 'node:path'
import Parser from 'tree-sitter'
import JavaScript from 'tree-sitter-javascript'
import type { GraphEdge } from '@neat/types'
import { EdgeType, Provenance } from '@neat/types'
import type { NeatGraph } from '../graph.js'
import {
  IGNORED_DIRS,
  SERVICE_FILE_EXTENSIONS,
  makeEdgeId,
  type DiscoveredService,
} from './shared.js'

export async function walkSourceFiles(dir: string): Promise<string[]> {
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
export function callsFromSource(
  source: string,
  parser: Parser,
  knownHosts: Set<string>,
): Set<string> {
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

// Phase 4 — service-to-service CALLS via tree-sitter URL-literal scan.
export async function addCallEdges(
  graph: NeatGraph,
  services: DiscoveredService[],
): Promise<number> {
  const parser = new Parser()
  parser.setLanguage(JavaScript)

  const knownHosts = new Set<string>()
  const hostToNodeId = new Map<string, string>()
  for (const service of services) {
    knownHosts.add(path.basename(service.dir))
    knownHosts.add(service.pkg.name)
    hostToNodeId.set(path.basename(service.dir), service.node.id)
    hostToNodeId.set(service.pkg.name, service.node.id)
  }

  let edgesAdded = 0
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
        edgesAdded++
      }
    }
  }
  return edgesAdded
}
