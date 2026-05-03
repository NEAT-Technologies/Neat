#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { createHttpClient } from './client.js'
import { registerResources } from './resources.js'
import {
  getBlastRadius,
  getDependencies,
  getGraphDiff,
  getIncidentHistory,
  getObservedDependencies,
  getRecentStaleEdges,
  getRootCause,
  semanticSearch,
} from './tools.js'

const baseUrl = process.env.NEAT_CORE_URL ?? 'http://localhost:8080'
const client = createHttpClient(baseUrl)

const server = new McpServer({
  name: 'neat',
  version: '0.1.0',
})

server.tool(
  'get_root_cause',
  'Trace a failing node up its dependency graph to find the underlying cause. Use this when something is breaking and you want to know which upstream component is the actual culprit.',
  {
    errorNode: z
      .string()
      .describe('Graph node id where the error surfaced, e.g. "database:payments-db"'),
    errorId: z
      .string()
      .optional()
      .describe('Specific error event id from incident history; if set, the result is coloured with that error message'),
  },
  async (input) => getRootCause(client, input),
)

server.tool(
  'get_blast_radius',
  'List every node downstream of the given node — what would break if this node failed or was redeployed.',
  {
    nodeId: z.string().describe('Graph node id to compute blast radius from'),
    depth: z
      .number()
      .int()
      .nonnegative()
      .max(20)
      .optional()
      .describe('Max BFS depth (default 10)'),
  },
  async (input) => getBlastRadius(client, input),
)

server.tool(
  'get_dependencies',
  'List the outgoing dependencies of a node — both static (EXTRACTED from source) and runtime (OBSERVED via OTel), de-duplicated to the most trustworthy provenance per pair.',
  { nodeId: z.string().describe('Graph node id to inspect') },
  async (input) => getDependencies(client, input),
)

server.tool(
  'get_observed_dependencies',
  'List only the runtime (OBSERVED via OTel) outgoing dependencies of a node. Use this to compare what code SAYS the service depends on vs what production actually does.',
  { nodeId: z.string().describe('Graph node id to inspect') },
  async (input) => getObservedDependencies(client, input),
)

server.tool(
  'get_incident_history',
  'Return recent OTel error events recorded against a node, most recent first.',
  {
    nodeId: z.string().describe('Graph node id to query'),
    limit: z.number().int().positive().max(100).optional().describe('Max events to return (default 20)'),
  },
  async (input) => getIncidentHistory(client, input),
)

server.tool(
  'semantic_search',
  'Search nodes by natural-language query. Uses embedding vectors when an embedder is available (Ollama nomic-embed-text → in-process MiniLM → substring fallback) — phrase the query the way you would describe what you want.',
  { query: z.string().describe('Free-text query, e.g. "service handling checkout payments"') },
  async (input) => semanticSearch(client, input),
)

server.tool(
  'get_graph_diff',
  'Diff a saved graph snapshot against the current live graph. Useful for change reviews and post-incidents — answers "what changed in the architecture between then and now." Returns added/removed/changed nodes and edges with both snapshot timestamps.',
  {
    againstSnapshot: z
      .string()
      .describe(
        'Path or http(s) URL of the snapshot to diff against (the "before" state). The current graph is the "after".',
      ),
  },
  async (input) => getGraphDiff(client, input),
)

server.tool(
  'get_recent_stale_edges',
  'List the most recent OBSERVED → STALE edge transitions. Use this to spot integrations that have gone quiet — a CALLS edge that just went stale typically means an upstream stopped calling, not that the link is healthy.',
  {
    limit: z
      .number()
      .int()
      .positive()
      .max(200)
      .optional()
      .describe('Max events to return (default 50)'),
    edgeType: z
      .string()
      .optional()
      .describe('Filter by edge type — e.g. "CALLS" or "CONNECTS_TO"'),
  },
  async (input) => getRecentStaleEdges(client, input),
)

// Resources sit alongside tools — same data, different access pattern. Read
// the per-node resource for raw attrs+edges JSON; subscribe to the incidents
// resource to be notified when new errors land. The eight tools above are
// unchanged.
const incidentsPollMs = process.env.NEAT_RESOURCE_POLL_MS
  ? Number(process.env.NEAT_RESOURCE_POLL_MS)
  : undefined
const resourceRegistration = registerResources(server, client, {
  ...(incidentsPollMs !== undefined ? { incidentsPollMs } : {}),
})

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

const stopPolling = (): void => {
  resourceRegistration.stop()
}
process.on('SIGTERM', stopPolling)
process.on('SIGINT', stopPolling)

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
