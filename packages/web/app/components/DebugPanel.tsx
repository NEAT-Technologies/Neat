'use client'

import { useEffect, useState } from 'react'
import {
  CORE_URL_PUBLIC,
  apiCallBus,
  connectionBus,
  sseEventBus,
  type ApiCallEvent,
  type ConnectionEvent,
  type SseEvent,
} from '../../lib/proxy-client'

interface DebugPanelProps {
  project: string
  onClose: () => void
}

// ADR-058 #4 — read-only diagnostic overlay toggled via Ctrl+Shift+D.
// Subscribes to the in-memory event buses populated by trackedFetch and the
// SSE/health hooks. No POST/PUT/DELETE buttons — observation only.
export function DebugPanel({ project, onClose }: DebugPanelProps) {
  const [calls, setCalls] = useState<ApiCallEvent[]>([])
  const [sseEvents, setSseEvents] = useState<SseEvent[]>([])
  const [heartbeats, setHeartbeats] = useState<ConnectionEvent[]>([])

  useEffect(() => {
    const unsubCalls = apiCallBus.subscribe((e) => {
      setCalls((prev) => [e, ...prev].slice(0, 10))
    })
    const unsubSse = sseEventBus.subscribe((e) => {
      setSseEvents((prev) => [e, ...prev].slice(0, 10))
    })
    const unsubConn = connectionBus.subscribe((e) => {
      setHeartbeats((prev) => [e, ...prev].slice(0, 20))
    })
    return () => {
      unsubCalls()
      unsubSse()
      unsubConn()
    }
  }, [])

  return (
    <div
      role="dialog"
      aria-label="Debug panel"
      style={{
        position: 'fixed',
        top: 60,
        right: 16,
        width: 420,
        maxHeight: '70vh',
        overflow: 'auto',
        background: 'var(--ink-2, #14141a)',
        border: '1px solid var(--rule, #2a2a30)',
        color: 'var(--paper-1, #d8d3c9)',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        padding: 12,
        zIndex: 1000,
        boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <strong style={{ fontFamily: 'Spectral, serif', fontStyle: 'italic' }}>NEAT debug</strong>
        <button onClick={onClose} aria-label="Close debug panel" title="Close (Ctrl+Shift+D)" style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }}>×</button>
      </div>

      <section style={{ marginBottom: 10 }}>
        <div style={{ color: 'var(--paper-3)', marginBottom: 4 }}>environment</div>
        <div>project: <code>{project}</code></div>
        <div>NEAT_API_URL: <code>{CORE_URL_PUBLIC}</code></div>
      </section>

      <section style={{ marginBottom: 10 }}>
        <div style={{ color: 'var(--paper-3)', marginBottom: 4 }}>last {calls.length} api calls</div>
        {calls.length === 0 && <div style={{ opacity: 0.5 }}>none yet</div>}
        {calls.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, lineHeight: 1.5 }}>
            <span style={{ width: 36, color: c.status >= 400 ? '#e87a7a' : c.status === 0 ? '#d3a847' : 'var(--paper-2)' }}>{c.status || '—'}</span>
            <span style={{ width: 50, opacity: 0.6 }}>{c.durationMs}ms</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.path}</span>
          </div>
        ))}
      </section>

      <section style={{ marginBottom: 10 }}>
        <div style={{ color: 'var(--paper-3)', marginBottom: 4 }}>last {sseEvents.length} sse events</div>
        {sseEvents.length === 0 && <div style={{ opacity: 0.5 }}>none yet</div>}
        {sseEvents.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 90 }}>{new Date(e.timestamp).toLocaleTimeString()}</span>
            <span>{e.type}</span>
          </div>
        ))}
      </section>

      <section>
        <div style={{ color: 'var(--paper-3)', marginBottom: 4 }}>heartbeats</div>
        {heartbeats.length === 0 && <div style={{ opacity: 0.5 }}>none yet</div>}
        {heartbeats.map((h, i) => (
          <div key={i} style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 90 }}>{new Date(h.timestamp).toLocaleTimeString()}</span>
            <span style={{ width: 60 }}>{h.state}</span>
            <span style={{ opacity: 0.6 }}>{h.rttMs ? `${h.rttMs}ms` : ''}</span>
          </div>
        ))}
      </section>
    </div>
  )
}
