import path from 'node:path'
import Parser from 'tree-sitter'
import JavaScript from 'tree-sitter-javascript'
import type { GraphEdge } from '@neat/types'
import { EdgeType, Provenance } from '@neat/types'
import type { NeatGraph } from '../../graph.js'
import { makeEdgeId, type DiscoveredService } from '../shared.js'
import { loadSourceFiles, lineOf, snippet } from './shared.js'

function collectStringLiterals(node: Parser.SyntaxNode, out: string[]): void {
  if (node.type === 'string_fragment') out.push(node.text)
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child) collectStringLiterals(child, out)
  }
}

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

// HTTP CALLS via URL substring match — the original tree-sitter scan, kept
// intact so the demo's CALLS edges are byte-for-byte identical.
export async function addHttpCallEdges(
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
    const files = await loadSourceFiles(service.dir)
    const seenTargets = new Map<string, { file: string; host: string }>()
    for (const file of files) {
      const targets = callsFromSource(file.content, parser, knownHosts)
      for (const t of targets) {
        const targetId = hostToNodeId.get(t)
        if (!targetId || targetId === service.node.id) continue
        if (!seenTargets.has(targetId)) {
          seenTargets.set(targetId, { file: file.path, host: t })
        }
      }
    }
    for (const [targetId, evidenceFile] of seenTargets) {
      const fileContent = files.find((f) => f.path === evidenceFile.file)?.content ?? ''
      const line = lineOf(fileContent, `//${evidenceFile.host}`)
      const edge: GraphEdge = {
        id: makeEdgeId(service.node.id, targetId, EdgeType.CALLS),
        source: service.node.id,
        target: targetId,
        type: EdgeType.CALLS,
        provenance: Provenance.EXTRACTED,
        evidence: {
          file: path.relative(service.dir, evidenceFile.file),
          line,
          snippet: snippet(fileContent, line),
        },
      }
      if (!graph.hasEdge(edge.id)) {
        graph.addEdgeWithKey(edge.id, edge.source, edge.target, edge)
        edgesAdded++
      }
    }
  }
  return edgesAdded
}
