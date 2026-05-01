#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// Stub server. The six tools below match issues #14–#19 — each one returns
// a placeholder string for now so Claude Code can connect, list_tools, and
// see all six surfaces wired up. Real implementations land per-issue.

const server = new McpServer({
  name: 'neat',
  version: '0.1.0',
})

const stub = (issue: number) => async () => ({
  content: [
    {
      type: 'text' as const,
      text: `not yet implemented — see issue #${issue}`,
    },
  ],
})

server.tool(
  'get_root_cause',
  'Trace a failing node up its dependency graph to find the underlying cause.',
  { nodeId: z.string().describe('Graph node id to start tracing from') },
  stub(14),
)

server.tool(
  'get_blast_radius',
  'List every node downstream of the given node — what would break if it failed.',
  { nodeId: z.string().describe('Graph node id to compute blast radius from') },
  stub(15),
)

server.tool(
  'get_dependencies',
  'List the static (extracted from source) dependencies of a node.',
  { nodeId: z.string().describe('Graph node id to inspect') },
  stub(16),
)

server.tool(
  'get_observed_dependencies',
  'List the runtime (observed via OTel) dependencies of a node.',
  { nodeId: z.string().describe('Graph node id to inspect') },
  stub(17),
)

server.tool(
  'get_incident_history',
  'Return recent OTel error events recorded against a node.',
  {
    nodeId: z.string().describe('Graph node id to query'),
    limit: z.number().int().positive().max(100).optional().describe('Max events to return'),
  },
  stub(18),
)

server.tool(
  'semantic_search',
  'Search nodes and edges by free-text query (keyword stub for MVP).',
  { query: z.string().describe('Search text') },
  stub(19),
)

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
