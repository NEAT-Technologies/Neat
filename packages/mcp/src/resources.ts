// MCP Resources — additive surface alongside the eight tools. Two resources:
//
//   neat://node/<id>          — one resource per graph node. Read returns the
//                                node attributes plus its outbound edges.
//   neat://incidents/recent   — most recent error events. Pollable by the SDK
//                                via subscribe; we send `notifications/resources/
//                                updated` when /incidents grows.
//
// Pure read helpers are exported so tests can exercise them without spinning up
// an MCP transport. `registerResources()` does the SDK wiring + the poll loop.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  ListResourcesResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { ErrorEvent, GraphEdge, GraphNode } from '@neat/types'
import { HttpError, type HttpClient } from './client.js'

interface EdgesResponse {
  inbound: GraphEdge[]
  outbound: GraphEdge[]
}

interface SerializedGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const NODE_RESOURCE_MIME = 'application/json'
const INCIDENTS_URI = 'neat://incidents/recent'
const INCIDENTS_DEFAULT_LIMIT = 50

function nodeUri(id: string): string {
  // Node ids contain `:` which RFC 6570 percent-encodes; doing it explicitly
  // here keeps the URI we hand the SDK identical to what `list` produces.
  return `neat://node/${encodeURIComponent(id)}`
}

function nameFromAttrs(attrs: GraphNode): string {
  return (attrs as { name?: string }).name ?? attrs.id
}

export async function listNodeResources(client: HttpClient): Promise<ListResourcesResult> {
  const graph = await client.get<SerializedGraph>('/graph')
  return {
    resources: graph.nodes.map((n) => ({
      uri: nodeUri(n.id),
      name: nameFromAttrs(n),
      description: `${n.type} — ${nameFromAttrs(n)}`,
      mimeType: NODE_RESOURCE_MIME,
    })),
  }
}

export async function readNodeResource(
  client: HttpClient,
  id: string,
): Promise<ReadResourceResult> {
  const uri = nodeUri(id)
  try {
    const [attrs, edges] = await Promise.all([
      client.get<GraphNode>(`/graph/node/${encodeURIComponent(id)}`),
      client.get<EdgesResponse>(`/graph/edges/${encodeURIComponent(id)}`),
    ])
    const body = {
      node: attrs,
      // Outbound only — the issue spec says "attrs + outbound edges". Inbound
      // edges are still reachable via the other endpoint and would double the
      // payload for hub nodes (e.g. a shared database).
      outboundEdges: edges.outbound,
    }
    return {
      contents: [
        {
          uri,
          mimeType: NODE_RESOURCE_MIME,
          text: JSON.stringify(body, null, 2),
        },
      ],
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      return {
        contents: [
          {
            uri,
            mimeType: NODE_RESOURCE_MIME,
            text: JSON.stringify({ error: 'node not found', id }),
          },
        ],
      }
    }
    throw err
  }
}

export async function readRecentIncidentsResource(
  client: HttpClient,
  limit: number = INCIDENTS_DEFAULT_LIMIT,
): Promise<ReadResourceResult> {
  const events = await client.get<ErrorEvent[]>('/incidents')
  // ndjson order is append-time = oldest first. Reverse so most-recent leads.
  const ordered = [...events].reverse().slice(0, limit)
  return {
    contents: [
      {
        uri: INCIDENTS_URI,
        mimeType: NODE_RESOURCE_MIME,
        text: JSON.stringify(
          { count: ordered.length, total: events.length, events: ordered },
          null,
          2,
        ),
      },
    ],
  }
}

// Pure helper so the poll loop can be tested without timers. Returns true when
// the visible state of /incidents has changed in a way subscribers should hear
// about. Compares total count + the id of the newest event — either is enough
// on its own, but the pair makes deletes (if they ever happen) survive a
// missed update.
export function incidentsChanged(
  prev: { total: number; lastId?: string } | null,
  next: { total: number; lastId?: string },
): boolean {
  if (!prev) return false // first observation seeds, doesn't notify
  if (prev.total !== next.total) return true
  if (prev.lastId !== next.lastId) return true
  return false
}

export interface RegisterResourcesOptions {
  // Poll interval for /incidents in ms. 5s by default; 0 disables polling.
  incidentsPollMs?: number
}

export interface ResourceRegistration {
  // Stops the poll loop. The SDK keeps the registered resources around as
  // long as the server is alive — calling stop() doesn't unregister them.
  stop: () => void
}

export function registerResources(
  server: McpServer,
  client: HttpClient,
  options: RegisterResourcesOptions = {},
): ResourceRegistration {
  const pollMs = options.incidentsPollMs ?? 5000

  // neat://node/<id> — templated. The list callback enumerates current nodes;
  // the read callback resolves a specific id.
  server.registerResource(
    'graph-node',
    new ResourceTemplate('neat://node/{id}', {
      list: async () => listNodeResources(client),
    }),
    {
      description:
        'A single graph node by id. Reading returns the node attributes plus its outbound edges as JSON.',
      mimeType: NODE_RESOURCE_MIME,
    },
    async (_uri, variables) => {
      const raw = variables.id
      const id = Array.isArray(raw) ? raw[0] : raw
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error('neat://node/{id} requires an id')
      }
      // RFC 6570 hands us a percent-decoded value, but be defensive in case a
      // client double-encoded the colon.
      const decoded = id.includes('%') ? decodeURIComponent(id) : id
      return readNodeResource(client, decoded)
    },
  )

  // neat://incidents/recent — static. Subscribers get notifications/resources/
  // updated on each tick where /incidents has changed.
  server.registerResource(
    'incidents-recent',
    INCIDENTS_URI,
    {
      description:
        'Most recent error events recorded by neat-core, newest first. JSON: { count, total, events[] }.',
      mimeType: NODE_RESOURCE_MIME,
    },
    async () => readRecentIncidentsResource(client),
  )

  let stopped = false
  let timer: NodeJS.Timeout | null = null
  let last: { total: number; lastId?: string } | null = null

  const tick = async (): Promise<void> => {
    if (stopped) return
    try {
      const events = await client.get<ErrorEvent[]>('/incidents')
      const next = {
        total: events.length,
        lastId: events.length > 0 ? events[events.length - 1].id : undefined,
      }
      if (incidentsChanged(last, next)) {
        // Underlying low-level Server has the notification senders. The
        // McpServer high-level wrapper exposes it via .server.
        await server.server.sendResourceUpdated({ uri: INCIDENTS_URI }).catch(() => {
          // No transport connected yet, or the client dropped — either way we
          // just skip this notification rather than crashing the poll loop.
        })
      }
      last = next
    } catch {
      // Core down or not reachable — keep polling, the next tick will catch up.
    }
  }

  if (pollMs > 0) {
    // Seed `last` on first tick so we don't fire an "updated" notification
    // when the server first comes up.
    timer = setInterval(() => {
      void tick()
    }, pollMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  return {
    stop: (): void => {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
