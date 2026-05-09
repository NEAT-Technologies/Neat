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
  const [openRow, setOpenRow] = useState<string | null>(null)

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
      <header className="topbar">
        <div className="brand" title="NEAT">N</div>
        <div className="crumbs">
          <Link href="/" className="incidents-nav-link">graph view</Link>
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
              {data.events.map((evt, i) => {
                const rowKey = `${i}-${evt.nodeId}`
                const isOpen = openRow === rowKey
                return (
                  <>
                    <tr
                      key={rowKey}
                      style={{ cursor: evt.stacktrace ? 'pointer' : undefined }}
                      onClick={() => evt.stacktrace && setOpenRow(isOpen ? null : rowKey)}
                      title={evt.stacktrace ? (isOpen ? 'Collapse stacktrace' : 'Expand stacktrace') : undefined}
                    >
                      <td className="td-node">
                        <Link href={`/?node=${encodeURIComponent(evt.nodeId)}`} className="incidents-node-link">
                          {evt.nodeId}
                        </Link>
                      </td>
                      <td className="td-time">{formatTs(evt.timestamp)}</td>
                      <td className="td-type">{evt.type}</td>
                      <td className="td-msg">
                        {evt.message}
                        {evt.stacktrace && (
                          <span className="stack-toggle">{isOpen ? ' ▲' : ' ▼'}</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && evt.stacktrace && (
                      <tr key={`${rowKey}-stack`}>
                        <td colSpan={4} className="td-stacktrace">
                          <pre className="stacktrace-pre">{evt.stacktrace}</pre>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
