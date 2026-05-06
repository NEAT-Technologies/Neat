// Standardized three-part response format for every MCP tool (ADR-039,
// issue #143). Output shape:
//
//   {summary — NL paragraph: what was found, why it matters}
//
//   {block — typed payload, formatted}
//
//   confidence: 0.94 · provenance: OBSERVED
//
// Empty result → footer reads "confidence: n/a · provenance: n/a". Every tool
// in packages/mcp/src/tools.ts routes through this helper so consumers get a
// consistent shape — agents can pattern-match on the footer to know how much
// to trust the answer.

export interface ToolResponse {
  [x: string]: unknown
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

export interface FormatToolResponseInput {
  // NL paragraph. One or two sentences. What was found and why it matters.
  summary: string
  // Structured block. The formatted typed payload — usually a bullet list,
  // sometimes a multi-section breakdown. May be empty when the summary
  // already conveys everything.
  block?: string
  // Per-result confidence in [0, 1]. Undefined → footer reads "n/a".
  confidence?: number
  // Per-result provenance. Single value, or an array if the result spans
  // mixed provenances (e.g. a path of OBSERVED + EXTRACTED edges). Undefined
  // → footer reads "n/a".
  provenance?: string | string[]
  // Set on transport / 5xx errors. Routes through ToolResponse.isError so
  // MCP clients can surface a non-"normal" return.
  isError?: boolean
}

function formatFooter(
  confidence: number | undefined,
  provenance: string | string[] | undefined,
): string {
  const c = confidence === undefined ? 'n/a' : confidence.toFixed(2)
  const p =
    provenance === undefined
      ? 'n/a'
      : Array.isArray(provenance)
        ? [...new Set(provenance)].join(', ')
        : provenance
  return `confidence: ${c} · provenance: ${p}`
}

export function formatToolResponse(input: FormatToolResponseInput): ToolResponse {
  const sections: string[] = [input.summary.trim()]
  if (input.block && input.block.trim().length > 0) {
    sections.push(input.block.trimEnd())
  }
  sections.push(formatFooter(input.confidence, input.provenance))
  const text = sections.join('\n\n')
  return {
    content: [{ type: 'text', text }],
    ...(input.isError ? { isError: true } : {}),
  }
}

// Convenience for the "node not found / empty graph" path. Keeps the
// three-part shape (summary still landed) but sets the footer to n/a / n/a
// since there's nothing to confidence-tag or provenance-tag.
export function formatEmptyResponse(summary: string): ToolResponse {
  return formatToolResponse({ summary })
}

// Convenience for transport / 5xx errors at the MCP boundary. isError set
// so MCP clients route the response into their error path.
export function formatErrorResponse(message: string): ToolResponse {
  return formatToolResponse({ summary: message, isError: true })
}
