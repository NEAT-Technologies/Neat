import path from 'node:path'
import Parser from 'tree-sitter'
import JavaScript from 'tree-sitter-javascript'
import Python from 'tree-sitter-python'
import type { GraphEdge } from '@neat.is/types'
import { EdgeType, Provenance } from '@neat.is/types'
import type { NeatGraph } from '../../graph.js'
import { makeEdgeId, type DiscoveredService } from '../shared.js'
import { loadSourceFiles, lineOf, snippet } from './shared.js'

// JS uses `string_fragment` for the textual interior of a template/string;
// Python uses `string_content` inside a `string` node. Either way we want the
// raw textual content (no quotes), so we accept both.
const STRING_LITERAL_NODE_TYPES = new Set(['string_fragment', 'string_content'])

function collectStringLiterals(node: Parser.SyntaxNode, out: string[]): void {
  if (STRING_LITERAL_NODE_TYPES.has(node.type)) out.push(node.text)
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

function makeJsParser(): Parser {
  const p = new Parser()
  p.setLanguage(JavaScript)
  return p
}

function makePyParser(): Parser {
  const p = new Parser()
  p.setLanguage(Python)
  return p
}

// HTTP CALLS via URL substring match. Parser is picked per file extension:
// .py uses tree-sitter-python; everything else uses tree-sitter-javascript.
// The demo's CALLS edges stay byte-for-byte identical to the M1 baseline.
export async function addHttpCallEdges(
  graph: NeatGraph,
  services: DiscoveredService[],
): Promise<number> {
  const jsParser = makeJsParser()
  const pyParser = makePyParser()

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
      const parser = path.extname(file.path) === '.py' ? pyParser : jsParser
      let targets: Set<string>
      try {
        targets = callsFromSource(file.content, parser, knownHosts)
      } catch (err) {
        console.warn(
          `[neat] http call extraction skipped ${file.path}: ${(err as Error).message}`,
        )
        continue
      }
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
