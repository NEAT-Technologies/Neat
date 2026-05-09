'use client'

import { useState } from 'react'
import { TopBar } from './TopBar'
import { Rail } from './Rail'
import { GraphCanvas } from './GraphCanvas'
import { Inspector } from './Inspector'
import { StatusBar } from './StatusBar'
import type { GraphNode, GraphEdge } from '@neat.is/types'

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export function AppShell() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [project, setProject] = useState<string>('default')

  return (
    <div className="app">
      <TopBar project={project} onProjectChange={setProject} />
      <Rail />
      <GraphCanvas
        project={project}
        onNodeSelect={setSelectedNodeId}
        onGraphLoaded={setGraphData}
      />
      <Inspector selectedNodeId={selectedNodeId} graphData={graphData} />
      <StatusBar graphData={graphData} />
    </div>
  )
}
