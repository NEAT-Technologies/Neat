'use client'

import { useEffect, useRef, useState } from 'react'
import cytoscape, { type Core, type ElementDefinition, type StylesheetStyle } from 'cytoscape'
import type { GraphEdge, GraphNode } from '@neat.is/types'

interface GraphResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const NODE_COLOURS: Record<string, string> = {
  ServiceNode: '#3b82f6', // blue
  DatabaseNode: '#10b981', // emerald
  ConfigNode: '#f59e0b', // amber
  InfraNode: '#a855f7', // purple
  FrontierNode: '#6b7280', // grey — placeholder shape
}

const EDGE_COLOURS: Record<string, string> = {
  OBSERVED: '#10b981', // green — runtime, trustworthy
  INFERRED: '#3b82f6', // blue — derived
  EXTRACTED: '#9ca3af', // grey — static
  STALE: '#f59e0b', // amber — was OBSERVED, gone quiet
  FRONTIER: '#6b7280', // dark grey — placeholder
}

// Cytoscape's TypeScript types are strict about px-flavoured values being
// strings while the runtime accepts numbers happily. Cast at the boundary
// rather than strewing string conversions through the style block.
const STYLES = [
  {
    selector: 'node',
    style: {
      'background-color': (node: cytoscape.NodeSingular) =>
        NODE_COLOURS[node.data('type') as string] ?? '#9ca3af',
      label: 'data(label)',
      color: '#111827',
      'font-size': 11,
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 6,
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.85,
      'text-background-padding': 2,
      width: 32,
      height: 32,
      'border-width': 1,
      'border-color': '#1f2937',
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      'target-arrow-shape': 'triangle',
      'line-color': (edge: cytoscape.EdgeSingular) =>
        EDGE_COLOURS[edge.data('provenance') as string] ?? '#9ca3af',
      'target-arrow-color': (edge: cytoscape.EdgeSingular) =>
        EDGE_COLOURS[edge.data('provenance') as string] ?? '#9ca3af',
      width: 2,
      label: 'data(type)',
      'font-size': 9,
      color: '#374151',
      'text-rotation': 'autorotate',
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.85,
      'text-background-padding': 2,
    },
  },
  {
    selector: 'edge[provenance = "STALE"], edge[provenance = "FRONTIER"]',
    style: { 'line-style': 'dashed' },
  },
] as unknown as StylesheetStyle[]

function toElements(graph: GraphResponse): ElementDefinition[] {
  const nodes = graph.nodes.map((n) => ({
    data: {
      id: n.id,
      label: (n as { name?: string }).name ?? n.id,
      type: n.type,
    },
  }))
  const edges = graph.edges.map((e) => ({
    data: {
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
      provenance: e.provenance,
    },
  }))
  return [...nodes, ...edges]
}

export function GraphView(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<Core | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ nodes: number; edges: number } | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  const fetchGraph = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/graph', { cache: 'no-store' })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
      }
      const graph = (await res.json()) as GraphResponse
      setMeta({ nodes: graph.nodes.length, edges: graph.edges.length })
      const cy = cyRef.current
      if (!cy) return
      cy.elements().remove()
      cy.add(toElements(graph))
      cy.layout({ name: 'cose', animate: false, padding: 30 }).run()
      cy.fit(undefined, 30)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!containerRef.current) return
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: STYLES,
      wheelSensitivity: 0.2,
    })
    cyRef.current = cy
    void fetchGraph()
    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [])

  return (
    <div className="relative h-screen w-screen">
      <div ref={containerRef} className="h-full w-full bg-slate-50" />
      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-2">
        <div className="pointer-events-auto rounded bg-white/90 px-3 py-2 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">NEAT graph</div>
          <div className="mt-1 text-xs text-slate-600">
            {loading
              ? 'loading…'
              : meta
                ? `${meta.nodes} nodes, ${meta.edges} edges`
                : '—'}
          </div>
          {error ? (
            <div className="mt-1 max-w-xs text-xs text-red-600">{error}</div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void fetchGraph()
            }}
            className="mt-2 rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700"
          >
            refresh
          </button>
        </div>
        <Legend />
      </div>
    </div>
  )
}

function Legend(): JSX.Element {
  return (
    <div className="pointer-events-auto rounded bg-white/90 px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-slate-900">Nodes</div>
      <ul className="mt-1 space-y-1">
        {Object.entries(NODE_COLOURS).map(([k, c]) => (
          <li key={k} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full border border-slate-700"
              style={{ backgroundColor: c }}
            />
            <span className="text-slate-700">{k}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 font-semibold text-slate-900">Edges</div>
      <ul className="mt-1 space-y-1">
        {Object.entries(EDGE_COLOURS).map(([k, c]) => (
          <li key={k} className="flex items-center gap-2">
            <span
              className="inline-block h-[2px] w-5"
              style={{
                backgroundColor: c,
                ...(k === 'STALE' || k === 'FRONTIER'
                  ? { backgroundImage: `linear-gradient(90deg, ${c} 50%, transparent 50%)`, backgroundSize: '6px 2px' }
                  : {}),
              }}
            />
            <span className="text-slate-700">{k}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
