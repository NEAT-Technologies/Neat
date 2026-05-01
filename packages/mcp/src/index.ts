#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { createHttpClient } from './client.js'
import {
  getBlastRadius,
  getDependencies,
  getIncidentHistory,
  getObservedDependencies,
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
  'Search nodes by free-text query. Currently a keyword match over node ids and names; vector search lands post-MVP.',
  { query: z.string().describe('Search text') },
  async (input) => semanticSearch(client, input),
)

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
