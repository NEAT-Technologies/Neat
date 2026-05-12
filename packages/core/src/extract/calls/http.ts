import path from 'node:path'
import Parser from 'tree-sitter'
import JavaScript from 'tree-sitter-javascript'
import Python from 'tree-sitter-python'
import type { GraphEdge } from '@neat.is/types'
import { EdgeType, Provenance } from '@neat.is/types'
import type { NeatGraph } from '../../graph.js'
import {
  isTestPath,
  makeEdgeId,
  urlMatchesHost,
  type DiscoveredService,
} from '../shared.js'
import { loadSourceFiles, lineOf, snippet } from './shared.js'

// JS uses `string_fragment` for the textual interior of a template/string;
// Python uses `string_content` inside a `string` node. Either way we want the
// raw textual content (no quotes), so we accept both.
const STRING_LITERAL_NODE_TYPES = new Set(['string_fragment', 'string_content'])

// ADR-065 #3 — JSX external-link exclusion. Tags whose URL-attr strings are
// user-clickable hyperlinks, not service-to-service calls.
const JSX_EXTERNAL_LINK_TAGS = new Set(['a', 'Link', 'NavLink', 'ExternalLink', 'Anchor'])

// Walk upward from a string-literal node to detect whether it sits inside a
// JSX attribute on an external-link element. Returns true if the literal
// should be filtered.
function isInsideJsxExternalLink(node: Parser.SyntaxNode): boolean {
  let cursor: Parser.SyntaxNode | null = node.parent
  // Step out of the string wrapper if needed (parent is `string` /
  // `template_string`).
  while (cursor) {
    if (cursor.type === 'jsx_attribute') {
      // The element that owns this attribute. jsx_attribute lives inside
      // jsx_opening_element / jsx_self_closing_element.
      let owner: Parser.SyntaxNode | null = cursor.parent
      while (owner && owner.type !== 'jsx_opening_element' && owner.type !== 'jsx_self_closing_element') {
        owner = owner.parent
      }
      if (!owner) return false
      // First named child of an opening/self-closing element is the tag name
      // (`identifier` or `member_expression`).
      const tagNode = owner.namedChild(0)
      const tagName = tagNode?.text ?? ''
      // For `<Foo.Bar>` we just want the rightmost ident; pick after the
      // last dot.
      const right = tagName.includes('.') ? tagName.split('.').pop()! : tagName
      return JSX_EXTERNAL_LINK_TAGS.has(right)
    }
    cursor = cursor.parent
  }
  return false
}

// Collect (literal text, ast-node) pairs so the JSX-context check has the
// node available. Comment tokens have no string_fragment / string_content
// children in tree-sitter — JSDoc text lives inside `comment` nodes — so
// comment-body exclusion comes for free with this AST walk (ADR-065 #2).
function collectStringLiterals(
  node: Parser.SyntaxNode,
  out: { text: string; node: Parser.SyntaxNode }[],
): void {
  if (STRING_LITERAL_NODE_TYPES.has(node.type)) out.push({ text: node.text, node })
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
  const literals: { text: string; node: Parser.SyntaxNode }[] = []
  collectStringLiterals(tree.rootNode, literals)
  const targets = new Set<string>()
  for (const lit of literals) {
    // ADR-065 #3 — JSX external-link exclusion. URL strings on <a>, <Link>,
    // <NavLink>, <ExternalLink>, <Anchor> are user-clickable hyperlinks, not
    // service calls.
    if (isInsideJsxExternalLink(lit.node)) continue
    for (const host of knownHosts) {
      // ADR-065 #5 — exact hostname match (not substring containment).
      // `medusa.cloud` no longer matches `@medusajs/medusa`.
      if (urlMatchesHost(lit.text, host)) {
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
      // ADR-065 #1 — test-scope exclusion.
      if (isTestPath(file.path)) continue
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
