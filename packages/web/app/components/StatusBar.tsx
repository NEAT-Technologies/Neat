'use client'

import { useEffect, useState } from 'react'
import type { GraphData } from './AppShell'

interface StatusBarProps {
  project: string
  graphData: GraphData | null
}

function formatTime(d: Date): string {
  return d.toTimeString().slice(0, 8) + ' ' + d.toTimeString().slice(9, 12)
}

export function StatusBar({ project, graphData }: StatusBarProps) {
  const [now, setNow] = useState(() => formatTime(new Date()))
  const [healthy, setHealthy] = useState<boolean | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(formatTime(new Date())), 1000)
    return () => clearInterval(id)
  }, [])

  // ADR-057 #3 — re-check health when project changes so the indicator
  // reflects the active project's daemon state.
  useEffect(() => {
    const check = () =>
      fetch(`/api/health?project=${encodeURIComponent(project)}`)
        .then((r) => r.json())
        .then((d: { ok: boolean }) => setHealthy(d.ok === true))
        .catch(() => setHealthy(false))
    check()
    const id = setInterval(check, 15_000)
    return () => clearInterval(id)
  }, [project])

  const nodeCount = graphData?.nodes.length ?? '—'
  const edgeCount = graphData?.edges.length ?? '—'

  return (
    <footer className="status">
      <div className={`st-item${healthy ? ' live' : ' live-dead'}`}>
        <span className="k">neat</span>
        <span className="v">{project}</span>
      </div>
      <div className="st-item">
        <span className="k">nodes</span>
        <span className="v" id="st-nodes">{nodeCount}</span>
      </div>
      <div className="st-item">
        <span className="k">edges</span>
        <span className="v" id="st-edges">{edgeCount}</span>
      </div>
      {healthy === false && (
        <div className="st-item">
          <span className="k" style={{ color: '#e87a7a' }}>core offline</span>
        </div>
      )}

      <div className="st-spacer" />

      <div className="scrub">
        <span className="k">t</span>
        <div className="bar">
          <div className="fill" />
          <div className="head" />
        </div>
        <span className="now">now ⌐ {now}</span>
      </div>
    </footer>
  )
}
