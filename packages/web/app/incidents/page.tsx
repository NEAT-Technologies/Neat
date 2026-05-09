'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Incident {
  nodeId: string
  timestamp: string
  type: string
  message: string
  stacktrace?: string
}

interface IncidentsResponse {
  count: number
  total: number
  events: Incident[]
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString() + ' ' + d.toTimeString().slice(0, 8)
  } catch {
    return iso
  }
}

export default function IncidentsPage() {
  const [data, setData] = useState<IncidentsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/incidents?limit=100')
      .then((r) => r.json())
      .then((d: IncidentsResponse) => {
        setData(d)
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  return (
    <div style={{ background: 'var(--ink-0)', minHeight: '100vh' }}>
      {/* minimal topbar */}
      <header className="topbar">
        <div className="brand" title="NEAT">N</div>
        <div className="crumbs">
          <Link href="/" style={{ color: 'var(--paper-2)', textDecoration: 'none', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>graph view</Link>
          <span className="sep">/</span>
          <span className="here">incidents</span>
        </div>
      </header>

      <div className="incidents-page" style={{ marginTop: 44 }}>
        <h1>Incidents</h1>
        <div className="subtitle">
          {data ? `${data.total} total events — showing ${data.events.length}` : 'loading…'}
        </div>

        {loading && (
          <div className="incidents-empty">loading…</div>
        )}

        {error && (
          <div className="incidents-empty" style={{ color: '#e87a7a' }}>
            failed to load: {error}
          </div>
        )}

        {!loading && !error && data && data.events.length === 0 && (
          <div className="incidents-empty">no incidents recorded</div>
        )}

        {!loading && !error && data && data.events.length > 0 && (
          <table className="incidents-table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Time</th>
                <th>Type</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((evt, i) => (
                <tr key={i}>
                  <td className="td-node">{evt.nodeId}</td>
                  <td className="td-time">{formatTs(evt.timestamp)}</td>
                  <td className="td-type">{evt.type}</td>
                  <td className="td-msg">{evt.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
